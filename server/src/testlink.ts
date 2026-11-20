// The public TestFlight link of a project: anyone who opens it can install the app on their phone.
// After an upload the build is handed to Apple's beta review, and Apple is asked now and then how
// that is going until the link works.
import { contactComplete, parseContact, type ReviewContact, type TestLink } from '../../shared/protocol';
import { config } from './config';
import * as db from './db';
import { accountFor } from './routing';
import * as workers from './workers';

/** Projects whose link is being prepared or checked right now. */
const busy = new Set<string>();

// The two waits can be shortened for trying the flow out locally.
const PROCESSING_EVERY_MS = Number(process.env.TESTLINK_PROCESSING_MS ?? 60_000);
const REVIEW_EVERY_MS = Number(process.env.TESTLINK_REVIEW_MS ?? 5 * 60_000);
/** A review that has not finished in this time is not asked about any more. */
const GIVE_UP_AFTER_MS = 14 * 24 * 3600_000;

let changed: (projectId: string) => void = () => undefined;

/** Calls back when a project's link has moved on, so open browsers can be told. */
export function onChange(listener: (projectId: string) => void): void {
  changed = listener;
}

export function testLink(projectId: string): TestLink {
  const saved = db.getTestLink(projectId);
  if (!saved) return { status: busy.has(projectId) ? 'working' : 'none' };
  const { projectId: _id, checkedAt: _checked, ...link } = saved;
  // Only Apple's own explanation is for the person; other details stay in the log.
  return { ...link, detail: link.error === 'rejected' ? link.detail : undefined };
}

/** Who Apple may contact about the test: the app's maker when they have said, otherwise the operator. */
function contactFor(project: db.Project, ownAccount: boolean): ReviewContact | null {
  const own = db.getReviewContact(project.userId);
  if (contactComplete(own)) return own;
  // The operator answers for what is tested from the operator's account, not for other people's.
  return ownAccount ? null : parseContact(config.betaContact);
}

function save(projectId: string, link: Omit<TestLink, 'at'>): void {
  db.setTestLink(projectId, link);
  changed(projectId);
}

/**
 * Prepares the link for the project's latest uploaded build. Called after every upload, and again
 * when the person has filled in the contact details that were missing.
 */
export function startShare(project: db.Project): void {
  const published = db.getPublish(project.id);
  if (published?.status !== 'uploaded' || busy.has(project.id)) return;
  const build = published.build;
  const routed = accountFor(db.getUser(project.userId));
  const url = db.getTestLink(project.id)?.url;
  if (!routed) {
    save(project.id, { status: 'failed', error: 'unavailable', build, url });
    return;
  }
  const contact = contactFor(project, routed.account !== undefined);
  if (!contact) {
    save(project.id, { status: 'needs_contact', build, url });
    return;
  }
  // Apple needs some minutes with a new build before anything can be done with it.
  save(project.id, { status: 'processing', build, url });
  void run(project, build, { contact, description: db.getListing(project.id).description }, routed.account);
}

async function run(
  project: db.Project,
  build: string,
  job: { check?: boolean; contact?: ReviewContact; description?: string },
  account: Parameters<typeof workers.share>[2],
): Promise<void> {
  if (busy.has(project.id)) return;
  busy.add(project.id);
  const before = db.getTestLink(project.id);
  let outcome: Awaited<ReturnType<typeof workers.share>>;
  try {
    outcome = await workers.share(project, { build, ...job }, account);
  } catch (err) {
    // A worker that is away for a moment is no reason to give the link up: it is asked again later.
    outcome = err instanceof workers.WorkerUnavailable ? { ok: true, state: undefined } : { ok: false, error: 'internal', detail: (err as Error).message };
  } finally {
    busy.delete(project.id);
  }
  if (!db.getProject(project.id)) return;
  // A newer upload has taken over while this one was asked about.
  if (db.getPublish(project.id)?.build !== build) return;

  if (!outcome.ok) {
    // "Not there yet" while a check runs is a hiccup; while preparing, it is the answer.
    console.warn(`[testlink] ${project.id} (${build}): failed, ${outcome.error}\n${outcome.detail ?? ''}`);
    save(project.id, { status: 'failed', error: outcome.error ?? 'internal', detail: outcome.detail, build, url: before?.url });
    return;
  }
  const status = outcome.state ?? before?.status ?? 'processing';
  const url = outcome.url ?? before?.url;
  if (status === before?.status && url === before?.url) {
    db.setTestLink(project.id, { status, build, url }, false);
    return;
  }
  console.log(`[testlink] ${project.id} (${build}): ${status}`);
  save(project.id, { status: status as TestLink['status'], build, url });
}

/** Asks Apple about the builds it is still working on: often while processing, seldom while reviewing. */
function tick(): void {
  const now = Date.now();
  for (const link of db.pendingTestLinks()) {
    if (busy.has(link.projectId) || !link.build) continue;
    const project = db.getProject(link.projectId);
    if (!project) continue;
    if (now - (link.at ?? now) > GIVE_UP_AFTER_MS) {
      save(project.id, { status: 'failed', error: 'internal', build: link.build, url: link.url });
      continue;
    }
    if (now - link.checkedAt < (link.status === 'processing' ? PROCESSING_EVERY_MS : REVIEW_EVERY_MS)) continue;
    const routed = accountFor(db.getUser(project.userId));
    if (!routed) continue;
    if (link.status === 'processing') {
      // Once the build is ready the rest has to be set up, which a check alone does not do.
      const contact = contactFor(project, routed.account !== undefined);
      if (contact) void run(project, link.build, { contact, description: db.getListing(project.id).description }, routed.account);
    } else {
      void run(project, link.build, { check: true }, routed.account);
    }
  }
}

setInterval(tick, Math.min(20_000, PROCESSING_EVERY_MS)).unref();
