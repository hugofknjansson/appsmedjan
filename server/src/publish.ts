// Sends a project to TestFlight through a worker that can sign and upload, and tracks how it went.
import {
  buildNumberFor,
  type AppleAccount,
  type PublishError,
  type PublishState,
  type PublishTester,
} from '../../shared/protocol';
import { credentialsFor } from './apple';
import * as db from './db';
import * as direct from './direct';
import { ensureIcon } from './icon';
import { live, liveProjectIds, send } from './live';
import { isOperator, route } from './routing';
import * as testlink from './testlink';
import * as workers from './workers';

/** Uploads in progress. Finished ones are read from the database. */
const working = new Map<string, PublishState>();

export function publishState(project: db.Project): PublishState {
  const owner = db.getUser(project.userId);
  const routing = {
    ...route(owner),
    test: testlink.testLink(project.id),
    fast: testlink.fastTrack(project),
    operator: owner ? isOperator(owner.email) : false,
    direct: direct.state(project),
  };
  const current = working.get(project.id);
  if (current) {
    // While the upload waits for the app to be created, the person needs to know which bundle id to pick.
    const bundleId = current.stage === 'waiting_for_app' ? project.bundleId : undefined;
    return { ...current, ...routing, bundleId };
  }
  const saved = db.getPublish(project.id);
  if (!saved) return { ...routing, status: 'idle' };
  return {
    ...routing,
    status: saved.status,
    error: saved.error ?? undefined,
    // Whoever creates the app in App Store Connect needs to know which bundle id to pick.
    bundleId: saved.error === 'no_app_record' ? project.bundleId : undefined,
    build: saved.build,
    tester: saved.tester ?? undefined,
    at: saved.updatedAt,
  };
}

function push(projectId: string): void {
  const project = db.getProject(projectId);
  if (project) send(projectId, { type: 'publish', publish: publishState(project) });
}

// The test link moves on by itself while Apple reviews; the open project follows along.
testlink.onChange(push);

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

// A build for the person's own phone moves on by itself, and a phone they add shows up in their open projects.
direct.onChange(push, accountChanged);

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
  let outcome: { ok: boolean; error?: PublishError; detail?: string; tester?: PublishTester };
  try {
    ensureIcon(project.id);
    const icon = db.getIcon(project.id);
    const iconText = icon ? Buffer.from(icon).toString('base64') : undefined;
    outcome = await workers.publish(project, db.getFiles(project.id), build, account, iconText, (stage) => {
      const current = working.get(project.id);
      if (!current) return;
      // In the operator's account only the operator can create the app: note that it is waited for.
      if (stage === 'waiting_for_app' && !account) db.requestApp(project.id);
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
  db.setPublish(project.id, {
    status: outcome.ok ? 'uploaded' : 'failed',
    error: outcome.ok ? null : (outcome.error ?? 'internal'),
    build,
    tester: outcome.ok ? (outcome.tester ?? null) : null,
  });
  if (outcome.ok) {
    db.clearAppRequest(project.id);
    // Straight on to the link that lets anyone install it.
    testlink.startShare(project);
  }
  push(project.id);
}
