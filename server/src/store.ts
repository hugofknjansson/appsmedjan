// The app's App Store page: its texts, screenshots and icon are kept here, and sent to App Store
// Connect through a worker that holds the account's key. Sending the page changes only a draft.
// Submitting the app for review is a separate step that happens only when its owner asks for it.
import {
  DEFAULT_CHOICES,
  DEFAULT_PAGES,
  EMPTY_CONTACT,
  MAX_POLICY_CHARS,
  EMPTY_LISTING,
  STORE_ICON_SIZE,
  STORE_SHOT,
  contactComplete,
  listingProblems,
  type AppleAccount,
  type ReviewContact,
  type StoreChoices,
  type StoreListing,
  type StorePages,
  type StoreState,
} from '../../shared/protocol';
import { pngInfo } from '../../shared/png';
import { credentialsFor } from './apple';
import * as db from './db';
import { live } from './live';
import { route } from './routing';
import * as workers from './workers';

/** Syncs in progress. Finished ones are read from the database. */
const working = new Map<string, StoreState['sync']>();
/** Projects being submitted for review right now. */
const submitting = new Map<string, number>();

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

/** Reads the person's statements about the app. Anything that is not plainly "true" counts as not stated. */
export function choicesFrom(body: unknown): StoreChoices {
  const given = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const out = { ...DEFAULT_CHOICES };
  for (const key of Object.keys(DEFAULT_CHOICES) as (keyof StoreChoices)[]) out[key] = given[key] === true;
  return out;
}

/** Reads the settings for the hosted pages sent by the browser. Null when they are not that. */
export function pagesFrom(body: unknown): StorePages | null {
  const given = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { supportEmail = '', privacyText = '' } = given;
  if (typeof supportEmail !== 'string' || supportEmail.length > 200) return null;
  if (typeof privacyText !== 'string' || privacyText.length > MAX_POLICY_CHARS) return null;
  return {
    ...DEFAULT_PAGES,
    hosted: given.hosted === true,
    supportEmail: supportEmail.trim(),
    privacyText: privacyText.replace(/\r\n/g, '\n').trim(),
    lang: given.lang === 'sv' ? 'sv' : 'en',
  };
}

/** Reads contact details sent by the browser. Null when they are not that. */
export function contactFrom(body: unknown): ReviewContact | null {
  if (typeof body !== 'object' || body === null) return null;
  const out = { ...EMPTY_CONTACT };
  for (const key of Object.keys(EMPTY_CONTACT) as (keyof ReviewContact)[]) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.length > 200) return null;
    out[key] = value.replace(/\s+/g, ' ').trim();
  }
  return out;
}

export function storeState(project: db.Project, user: db.User): StoreState {
  const routing = route(user);
  const listing = db.getListing(project.id);
  const screenshots = db.listScreenshots(project.id);
  const published = db.getPublish(project.id);
  const saved = db.getStoreSync(project.id);
  const contact = db.getReviewContact(user.id);
  const submitted = db.getStoreSubmit(project.id);
  const busy = working.has(project.id) || submitting.has(project.id);
  const { pages } = db.getPages(project.id);
  return {
    choices: db.getChoices(project.id),
    pages,
    contact,
    // What Apple has is what is saved here: sent with a build selected and the contact details, and
    // nothing changed since.
    canSubmit:
      routing.available &&
      !busy &&
      saved?.status === 'done' &&
      saved.attached === 'attached' &&
      contactComplete(contact) &&
      saved.updatedAt >= db.pageSavedAt(project.id, user.id),
    submit: submitting.has(project.id)
      ? { status: 'working', at: submitting.get(project.id) }
      : submitted
        ? {
            status: submitted.status,
            error: submitted.error ?? undefined,
            detail: submitted.error === 'rejected' ? (submitted.detail ?? undefined) : undefined,
            at: submitted.updatedAt,
          }
        : { status: 'idle' },
    listing,
    screenshots,
    hasIcon: db.hasIcon(project.id),
    canCapture: workers.hasSimulator(project.id) && screenshots.length < STORE_SHOT.max,
    available: routing.available,
    account: routing.account,
    problems: listingProblems(listing, screenshots.length, pages),
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
  if (working.has(project.id) || submitting.has(project.id) || live(project.id).running) return 'busy';

  const listing = db.getListing(project.id);
  const ids = db.listScreenshots(project.id);
  if (listingProblems(listing, ids.length, db.getPages(project.id).pages).length > 0) return 'incomplete';

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

  const contact = db.getReviewContact(user.id);
  const page = { listing, screenshots, build, choices: db.getChoices(project.id), contact: contactComplete(contact) ? contact : undefined };

  working.set(project.id, { status: 'working', stage: 'queued', at: Date.now() });
  void run(project, page, account);
  return 'started';
}

export type SubmitStart = 'started' | 'forbidden' | 'unavailable' | 'busy' | 'not_ready';

/** Submits the app for Apple's review. Called only when the app's owner has pressed the button for it. */
export function startSubmit(project: db.Project, user: db.User): SubmitStart {
  const routing = route(user);
  if (routing.account === 'none') return 'forbidden';
  if (!routing.available) return 'unavailable';
  if (working.has(project.id) || submitting.has(project.id)) return 'busy';
  if (!storeState(project, user).canSubmit) return 'not_ready';

  let account: AppleAccount | undefined;
  if (routing.account === 'own') {
    const credentials = credentialsFor(user.id);
    if (!credentials) return 'unavailable';
    account = credentials;
  }
  submitting.set(project.id, Date.now());
  void runSubmit(project, account);
  return 'started';
}

async function runSubmit(project: db.Project, account: AppleAccount | undefined): Promise<void> {
  let outcome: Awaited<ReturnType<typeof workers.submit>>;
  try {
    outcome = await workers.submit(project, account);
  } catch (err) {
    outcome = {
      ok: false,
      error: err instanceof workers.WorkerUnavailable ? 'unavailable' : 'internal',
      detail: (err as Error).message,
    };
  }
  submitting.delete(project.id);
  const target = account ? `team ${account.teamId}` : "the operator's account";
  if (outcome.ok) console.log(`[store] ${project.id} (${project.bundleId}): submitted for review in ${target}`);
  else console.warn(`[store] ${project.id} (${project.bundleId}) submit in ${target}: failed, ${outcome.error}\n${outcome.detail ?? ''}`);
  if (!db.getProject(project.id)) return;
  db.setStoreSubmit(project.id, {
    status: outcome.ok ? 'done' : 'failed',
    error: outcome.ok ? null : (outcome.error ?? 'internal'),
    detail: outcome.ok ? null : (outcome.detail ?? null),
  });
}

async function run(
  project: db.Project,
  page: Parameters<typeof workers.store>[1],
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
