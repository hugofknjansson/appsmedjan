// Sends a project to TestFlight through a worker that can sign and upload, and tracks how it went.
import { buildNumberFor, type AppleAccount, type PublishError, type PublishState } from '../../shared/protocol';
import { accountStatus, credentialsFor } from './apple';
import { config } from './config';
import * as db from './db';
import { live, liveProjectIds, send } from './live';
import * as workers from './workers';

/** Uploads in progress. Finished ones are read from the database. */
const working = new Map<string, PublishState>();

/**
 * Uploads to the operator's own Apple developer account are opt-in per person:
 * TESTFLIGHT_USERS lists the emails that may use it ("*" for everyone).
 */
export function userMayPublish(email: string): boolean {
  const allowed = config.testflightUsers;
  return allowed.includes('*') || allowed.includes(email.toLowerCase());
}

/**
 * Whose developer account an upload from this person goes to. Their own, once connected, always wins:
 * that is the account the app should live in.
 */
function route(owner: db.User | null): Pick<PublishState, 'account' | 'available' | 'canConnect'> {
  const own = owner ? accountStatus(owner.id) : { enabled: false, connected: false };
  if (own.connected) return { account: 'own', available: workers.canPublish('own'), canConnect: true };
  if (owner && userMayPublish(owner.email)) {
    return { account: 'operator', available: workers.canPublish('operator'), canConnect: own.enabled };
  }
  return { account: 'none', available: false, canConnect: own.enabled };
}

export function publishState(project: db.Project): PublishState {
  const routing = route(db.getUser(project.userId));
  const current = working.get(project.id);
  if (current) return { ...current, ...routing };
  const saved = db.getPublish(project.id);
  if (!saved) return { ...routing, status: 'idle' };
  return {
    ...routing,
    status: saved.status,
    error: saved.error ?? undefined,
    // Whoever creates the app in App Store Connect needs to know which bundle id to pick.
    bundleId: saved.error === 'no_app_record' ? project.bundleId : undefined,
    build: saved.build,
    at: saved.updatedAt,
  };
}

function push(projectId: string): void {
  const project = db.getProject(projectId);
  if (project) send(projectId, { type: 'publish', publish: publishState(project) });
}

// A publishing worker connecting or leaving changes whether the button is offered.
workers.onChange(() => {
  for (const projectId of liveProjectIds()) push(projectId);
});

/** Call when a person connects or disconnects their Apple account, so their open projects follow along. */
export function accountChanged(userId: string): void {
  for (const projectId of liveProjectIds()) {
    if (db.getProject(projectId)?.userId === userId) push(projectId);
  }
}

export type StartResult = 'started' | 'forbidden' | 'unavailable' | 'busy';

export function startPublish(project: db.Project, user: db.User): StartResult {
  const routing = route(user);
  if (routing.account === 'none') return 'forbidden';
  if (!routing.available) return 'unavailable';
  // While the agent is editing, the files may be half-way through a change.
  if (working.has(project.id) || live(project.id).running) return 'busy';

  let account: AppleAccount | undefined;
  if (routing.account === 'own') {
    const credentials = credentialsFor(user.id);
    if (!credentials) return 'unavailable';
    account = credentials;
  }

  const build = buildNumberFor(new Date());
  working.set(project.id, { ...routing, status: 'working', stage: 'queued', build, at: Date.now() });
  push(project.id);
  void run(project, build, account);
  return 'started';
}

async function run(project: db.Project, build: string, account: AppleAccount | undefined): Promise<void> {
  let outcome: { ok: boolean; error?: PublishError; detail?: string };
  try {
    outcome = await workers.publish(project, db.getFiles(project.id), build, account, (stage) => {
      const current = working.get(project.id);
      if (!current) return;
      working.set(project.id, { ...current, stage });
      push(project.id);
    });
  } catch (err) {
    outcome = {
      ok: false,
      error: err instanceof workers.WorkerUnavailable ? 'unavailable' : 'internal',
      detail: (err as Error).message,
    };
  }
  working.delete(project.id);

  const target = account ? `team ${account.teamId}` : "the operator's account";
  if (outcome.ok) {
    console.log(`[publish] ${project.id} (${project.bundleId}): build ${build} uploaded to ${target}`);
  } else {
    // The tools' own output stays in the operator's log; the person only sees a short explanation.
    console.warn(`[publish] ${project.id} (${project.bundleId}) to ${target}: failed, ${outcome.error}\n${outcome.detail ?? ''}`);
  }
  // The project may have been deleted while the upload was running.
  if (!db.getProject(project.id)) return;
  db.setPublish(project.id, outcome.ok ? 'uploaded' : 'failed', outcome.ok ? null : (outcome.error ?? 'internal'), build);
  push(project.id);
}
