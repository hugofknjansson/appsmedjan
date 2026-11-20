// The app's App Store page: its texts, screenshots and icon are kept here, and sent to App Store
// Connect through a worker that holds the account's key. Nothing is ever submitted for review from
// here; that last step stays with the account's owner.
import {
  EMPTY_LISTING,
  STORE_ICON_SIZE,
  STORE_SHOT,
  listingProblems,
  type AppleAccount,
  type StoreListing,
  type StoreState,
} from '../../shared/protocol';
import { pngInfo } from '../../shared/png';
import { credentialsFor } from './apple';
import * as db from './db';
import { live } from './live';
import { route } from './publish';
import * as workers from './workers';

/** Syncs in progress. Finished ones are read from the database. */
const working = new Map<string, StoreState['sync']>();

/** Far above Apple's limits, so an over-long draft can still be saved and trimmed by its author. */
const MAX_FIELD_CHARS = 8000;

/** Reads a listing sent by the browser. Null when it is not one. */
export function listingFrom(body: unknown): StoreListing | null {
  if (typeof body !== 'object' || body === null) return null;
  const out = { ...EMPTY_LISTING };
  for (const key of Object.keys(EMPTY_LISTING) as (keyof StoreListing)[]) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.length > MAX_FIELD_CHARS) return null;
    // Links and single-line fields never hold line breaks; the description keeps its own.
    out[key] = key === 'description' ? value.replace(/\r\n/g, '\n') : value.replace(/\s+/g, ' ').trim();
  }
  return out;
}

export function storeState(project: db.Project, user: db.User): StoreState {
  const routing = route(user);
  const listing = db.getListing(project.id);
  const screenshots = db.listScreenshots(project.id);
  const published = db.getPublish(project.id);
  const saved = db.getStoreSync(project.id);
  return {
    listing,
    screenshots,
    hasIcon: db.hasIcon(project.id),
    canCapture: workers.hasSimulator(project.id) && screenshots.length < STORE_SHOT.max,
    available: routing.available,
    account: routing.account,
    problems: listingProblems(listing, screenshots.length),
    build: published?.status === 'uploaded' ? published.build : undefined,
    sync:
      working.get(project.id) ??
      (saved
        ? {
            status: saved.status,
            error: saved.error ?? undefined,
            // Only Apple's own explanation is for the person; other details stay in the log.
            detail: saved.error === 'rejected' ? (saved.detail ?? undefined) : undefined,
            attached: saved.attached ?? undefined,
            at: saved.updatedAt,
          }
        : { status: 'idle' }),
  };
}

export type CaptureResult = 'saved' | 'no_preview' | 'full' | 'failed';

/** Saves what the simulator shows right now as an App Store screenshot. */
export async function capture(project: db.Project): Promise<CaptureResult> {
  if (db.listScreenshots(project.id).length >= STORE_SHOT.max) return 'full';
  if (!workers.hasSimulator(project.id)) return 'no_preview';
  let shot: { mime: string; data: string } | null;
  try {
    shot = await workers.screenshot(project.id, true);
  } catch (err) {
    console.warn(`[store] screenshot for ${project.id} failed: ${(err as Error).message}`);
    return 'failed';
  }
  if (!shot || !['image/jpeg', 'image/png', 'image/svg+xml'].includes(shot.mime)) return 'failed';
  db.addScreenshot(project.id, shot.mime, Buffer.from(shot.data, 'base64'));
  return 'saved';
}

export type IconResult = 'saved' | 'not_png' | 'wrong_size';

export function saveIcon(project: db.Project, data: Uint8Array): IconResult {
  const info = pngInfo(data);
  if (!info) return 'not_png';
  if (info.width !== STORE_ICON_SIZE || info.height !== STORE_ICON_SIZE) return 'wrong_size';
  db.setIcon(project.id, data);
  return 'saved';
}

export type SyncStart = 'started' | 'forbidden' | 'unavailable' | 'busy' | 'incomplete';

export function startSync(project: db.Project, user: db.User): SyncStart {
  const routing = route(user);
  if (routing.account === 'none') return 'forbidden';
  if (!routing.available) return 'unavailable';
  if (working.has(project.id) || live(project.id).running) return 'busy';

  const listing = db.getListing(project.id);
  const ids = db.listScreenshots(project.id);
  if (listingProblems(listing, ids.length).length > 0) return 'incomplete';

  let account: AppleAccount | undefined;
  if (routing.account === 'own') {
    const credentials = credentialsFor(user.id);
    if (!credentials) return 'unavailable';
    account = credentials;
  }
  const screenshots = ids
    .map((id) => db.getScreenshot(project.id, id))
    .filter((shot) => shot !== null)
    .map((shot) => Buffer.from(shot.data).toString('base64'));
  const published = db.getPublish(project.id);
  const build = published?.status === 'uploaded' ? published.build : undefined;

  working.set(project.id, { status: 'working', stage: 'queued', at: Date.now() });
  void run(project, { listing, screenshots, build }, account);
  return 'started';
}

async function run(
  project: db.Project,
  page: { listing: StoreListing; screenshots: string[]; build?: string },
  account: AppleAccount | undefined,
): Promise<void> {
  let outcome: Awaited<ReturnType<typeof workers.store>>;
  try {
    outcome = await workers.store(project, page, account, (stage) => {
      const current = working.get(project.id);
      if (current) working.set(project.id, { ...current, stage });
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
    console.log(`[store] ${project.id} (${project.bundleId}): page sent to ${target}, build ${outcome.attached ?? 'none'}`);
  } else {
    console.warn(`[store] ${project.id} (${project.bundleId}) to ${target}: failed, ${outcome.error}\n${outcome.detail ?? ''}`);
  }
  // The project may have been deleted while this was running.
  if (!db.getProject(project.id)) return;
  db.setStoreSync(project.id, {
    status: outcome.ok ? 'done' : 'failed',
    error: outcome.ok ? null : (outcome.error ?? 'internal'),
    detail: outcome.ok ? null : (outcome.detail ?? null),
    attached: outcome.ok ? (outcome.attached ?? 'none') : null,
  });
}
