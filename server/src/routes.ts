// REST API: accounts, projects, chat messages.
import type { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isValidProjectId, testerPersonProblem, type TesterPerson } from '../../shared/protocol';
import { hasCredentials } from './agent';
import { config } from './config';
import * as db from './db';
import * as direct from './direct';
import { forget } from './live';
import { STARTER_FILES } from './prompt';
import { accountStatus, connectAccount, disconnectAccount } from './apple';
import { draftListing } from './listing';
import { accountChanged, publishState, startPublish } from './publish';
import { isOperator } from './routing';
import * as testlink from './testlink';
import { renderPage } from './pages';
import { capture, choicesFrom, contactFrom, listingFrom, pagesFrom, saveIcon, startSubmit, startSync, storeState } from './store';
import { isRunning, startRun, stopRun } from './runs';
import * as workers from './workers';

const COOKIE = 'sid';
const MAX_PROMPT_CHARS = 8000;

// --- Sessions ----------------------------------------------------------------

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function userFromRequest(req: IncomingMessage): db.User | null {
  const token = readCookie(req.headers.cookie, COOKIE);
  return token ? db.userForSession(token) : null;
}

function setSession(res: Response, userId: string): void {
  res.cookie(COOKIE, db.createSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.production,
    maxAge: 30 * 24 * 3600_000,
    path: '/',
  });
}

type Authed = Request & { user: db.User };

function requireUser(req: Request, res: Response, next: NextFunction): void {
  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  (req as Authed).user = user;
  next();
}

/** Loads the project in :id and checks that it belongs to the signed-in user. */
function ownProject(req: Request, res: Response): db.Project | null {
  const id = req.params.id;
  const project = isValidProjectId(id) ? db.getProject(id) : null;
  if (!project || project.userId !== (req as Authed).user.id) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return project;
}

// --- Brute-force protection for the auth endpoints ---------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();

function authLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  } else if (++entry.count > 20) {
    res.status(429).json({ error: 'too_many_attempts' });
    return;
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
}, 60_000).unref();

function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// --- Routes ------------------------------------------------------------------

export const api = express.Router();

api.get('/config', (_req, res) => {
  res.json({ inviteRequired: Boolean(config.inviteCode) });
});

api.get('/me', (req, res) => {
  res.json({ user: userFromRequest(req) });
});

function credentials(body: unknown): { email: string; password: string } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return null;
  if (password.length < 8 || password.length > 200) return null;
  return { email, password };
}

api.post('/auth/signup', authLimiter, (req, res) => {
  const creds = credentials(req.body);
  if (!creds) {
    res.status(400).json({ error: 'invalid_credentials_format' });
    return;
  }
  if (config.inviteCode && !sameSecret(String(req.body?.inviteCode ?? ''), config.inviteCode)) {
    res.status(403).json({ error: 'bad_invite' });
    return;
  }
  const user = db.createUser(creds.email, creds.password);
  if (!user) {
    res.status(409).json({ error: 'email_taken' });
    return;
  }
  setSession(res, user.id);
  res.json({ user });
});

api.post('/auth/login', authLimiter, (req, res) => {
  const creds = credentials(req.body);
  const user = creds ? db.checkLogin(creds.email, creds.password) : null;
  if (!user) {
    res.status(401).json({ error: 'wrong_login' });
    return;
  }
  setSession(res, user.id);
  res.json({ user });
});

api.post('/auth/logout', (req, res) => {
  const token = readCookie(req.headers.cookie, COOKIE);
  if (token) db.deleteSession(token);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

api.get('/status', requireUser, (_req, res) => {
  res.json({ workers: workers.workerCount(), agentReady: hasCredentials() });
});

const publicProject = (p: db.Project) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt });

api.get('/projects', requireUser, (req, res) => {
  res.json({ projects: db.listProjects((req as Authed).user.id).map(publicProject) });
});

function promptFrom(body: unknown): string | null {
  const text = (body as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed && trimmed.length <= MAX_PROMPT_CHARS ? trimmed : null;
}

/** Creates a project from the first prompt and starts building straight away. */
api.post('/projects', requireUser, (req, res) => {
  const user = (req as Authed).user;
  const text = promptFrom(req.body);
  if (!text) {
    res.status(400).json({ error: 'bad_prompt' });
    return;
  }
  if (db.listProjects(user.id).length >= 50) {
    res.status(403).json({ error: 'project_limit' });
    return;
  }
  if (!db.consumeMessage(user.id)) {
    res.status(429).json({ error: 'daily_limit' });
    return;
  }
  const fallbackName = typeof req.body?.name === 'string' ? req.body.name.slice(0, 30) : 'App';
  const project = db.createProject(user.id, fallbackName || 'App', STARTER_FILES);
  startRun(project.id, text);
  res.json({ project: publicProject(project) });
});

api.delete('/projects/:id', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  stopRun(project.id);
  workers.release(project.id);
  db.deleteProject(project.id);
  direct.forget(project.id);
  forget(project.id);
  res.json({ ok: true });
});

api.get('/projects/:id/files', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  res.json({ files: db.getFiles(project.id) });
});

api.post('/projects/:id/messages', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const text = promptFrom(req.body);
  if (!text) {
    res.status(400).json({ error: 'bad_prompt' });
    return;
  }
  if (isRunning(project.id)) {
    res.status(409).json({ error: 'busy' });
    return;
  }
  if (!db.consumeMessage((req as Authed).user.id)) {
    res.status(429).json({ error: 'daily_limit' });
    return;
  }
  startRun(project.id, text);
  res.status(202).json({ ok: true });
});

api.post('/projects/:id/stop', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  stopRun(project.id);
  res.json({ ok: true });
});

// --- The person's own Apple developer account ---------------------------------

api.get('/apple-account', requireUser, (req, res) => {
  res.json(accountStatus((req as Authed).user.id));
});

/** Connects an App Store Connect API key. The key is checked against Apple before it is stored. */
api.put('/apple-account', requireUser, authLimiter, async (req, res) => {
  const user = (req as Authed).user;
  const result = await connectAccount(user.id, req.body);
  if (!result.ok) {
    res.status(result.error === 'apple_unreachable' ? 502 : 400).json({ error: result.error });
    return;
  }
  accountChanged(user.id);
  res.json(accountStatus(user.id));
});

api.delete('/apple-account', requireUser, (req, res) => {
  const user = (req as Authed).user;
  disconnectAccount(user.id);
  accountChanged(user.id);
  res.json(accountStatus(user.id));
});

/** Sends the app to TestFlight. Progress and the outcome arrive over the project's WebSocket. */
api.post('/projects/:id/testflight', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  switch (startPublish(project, (req as Authed).user)) {
    case 'forbidden':
      res.status(403).json({ error: 'publish_forbidden' });
      return;
    case 'unavailable':
      res.status(503).json({ error: 'publish_unavailable' });
      return;
    case 'busy':
      res.status(409).json({ error: 'busy' });
      return;
    default:
      res.status(202).json({ ok: true });
  }
});

// --- Getting the app onto a phone ---------------------------------------------------

/**
 * Prepares the public TestFlight link again for the latest upload. Used when it stopped for want of
 * contact details (which may come along here) or failed.
 */
api.post('/projects/:id/testlink', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const user = (req as Authed).user;
  const given = (req.body ?? {}) as { contact?: unknown };
  if (given.contact !== undefined) {
    const contact = contactFrom(given.contact);
    if (!contact) {
      res.status(400).json({ error: 'bad_contact' });
      return;
    }
    db.setReviewContact(user.id, contact);
  }
  if (db.getPublish(project.id)?.status !== 'uploaded') {
    res.status(409).json({ error: 'not_uploaded' });
    return;
  }
  testlink.startShare(project);
  res.status(202).json({ publish: publishState(project) });
});

/**
 * The fast way: invites the person to the operator's team as an internal tester of this app. Only
 * where the operator has turned that on, and only at the person's own request.
 */
api.post('/projects/:id/fasttrack', requireUser, authLimiter, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const given = (req.body ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof given[key] === 'string' ? (given[key] as string).replace(/\s+/g, ' ').trim().slice(0, 200) : '');
  const person: TesterPerson = { email: text('email').toLowerCase(), firstName: text('firstName'), lastName: text('lastName') };
  if (testerPersonProblem(person) !== null) {
    res.status(400).json({ error: 'bad_contact' });
    return;
  }
  if (!testlink.startFastTrack(project, person)) {
    res.status(409).json({ error: 'fast_unavailable' });
    return;
  }
  res.status(202).json({ publish: publishState(project) });
});

/** Sign-in tickets for opening a project on another device: used once, within a few minutes. */
const tickets = new Map<string, { userId: string; projectId: string; expiresAt: number }>();
const TICKET_MS = 5 * 60_000;
const ticketKey = (ticket: string) => crypto.createHash('sha256').update(ticket).digest('hex');

setInterval(() => {
  const now = Date.now();
  for (const [key, ticket] of tickets) if (ticket.expiresAt < now) tickets.delete(key);
}, 60_000).unref();

/**
 * A link that opens this project on the person's phone, already signed in: it goes into a QR code
 * on their own screen. Whoever opens it within five minutes is signed in as them, once.
 */
api.post('/projects/:id/handoff', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticketKey(ticket), { userId: (req as Authed).user.id, projectId: project.id, expiresAt: Date.now() + TICKET_MS });
  res.json({ path: `/api/handoff/${ticket}`, expiresInMs: TICKET_MS });
});

api.get('/handoff/:ticket', authLimiter, (req, res) => {
  const key = ticketKey(String(req.params.ticket));
  const ticket = tickets.get(key);
  tickets.delete(key);
  if (!ticket || ticket.expiresAt < Date.now() || !db.getUser(ticket.userId)) {
    // Back to the ordinary front page, which asks them to sign in.
    res.redirect(302, '/');
    return;
  }
  setSession(res, ticket.userId);
  res.redirect(302, `/p/${ticket.projectId}`);
});

/** For the people who run the service: apps that people are waiting for them to create in App Store Connect. */
api.get('/operator/requests', requireUser, (req, res) => {
  if (!isOperator((req as Authed).user.email)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  res.json({ requests: db.listAppRequests() });
});

// --- Straight onto the phone -------------------------------------------------------

/** The phones the person has added. The identifiers themselves stay on the server. */
api.get('/phones', requireUser, (req, res) => {
  res.json({ phones: direct.phonesOf((req as Authed).user.id), max: config.maxPhones });
});

/**
 * A link for adding a phone: it goes into a QR code, or is opened right away on the phone itself.
 * The phone needs no sign-in to use it, so it is only good for half an hour.
 */
api.post('/phones/ticket', requireUser, authLimiter, (req, res) => {
  res.json(direct.newTicket((req as Authed).user.id));
});

/** Builds the app for the person's own phones. The result is an install link in the publish state. */
api.post('/projects/:id/direct', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const outcome = direct.start(project, (req as Authed).user);
  if (outcome === 'forbidden') {
    res.status(403).json({ error: 'direct_not_offered' });
    return;
  }
  if (outcome !== 'started') {
    res.status(409).json({ error: outcome === 'no_phones' ? 'no_phones' : outcome === 'busy' ? 'busy' : 'publish_unavailable' });
    return;
  }
  res.status(202).json({ publish: publishState(project) });
});

/**
 * What a phone opens while it is added and when it installs. Open to everyone, because the phone is
 * not signed in: the ticket or token in the address is what lets it in.
 */
export const directPages = express.Router();

const langOf = (req: Request): 'sv' | 'en' => (req.acceptsLanguages('sv', 'en') === 'en' ? 'en' : 'sv');
const baseOf = (req: Request): string => config.publicUrl || `${req.protocol}://${req.get('host')}`;
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

directPages.get('/add/:ticket', (req, res) => {
  res.set(PAGE_HEADERS).send(direct.addPage(String(req.params.ticket), langOf(req)));
});

directPages.get('/enroll/:file', (req, res) => {
  const ticket = /^([A-Za-z0-9_-]{20,64})\.mobileconfig$/.exec(String(req.params.file))?.[1];
  const profile = ticket ? direct.enrollProfile(ticket, baseOf(req), langOf(req)) : null;
  if (!profile) {
    res.status(404).send('Not found.');
    return;
  }
  // As bytes: for text Express adds a charset to the type, and iOS is particular about this one.
  res.set({ 'content-type': 'application/x-apple-aspen-config', 'cache-control': 'no-store' }).send(Buffer.from(profile));
});

// The phone's answer: its identifier, in a signed envelope. Then it is sent on to a page that says how it went.
directPages.post('/enrolled/:ticket', authLimiter, express.raw({ type: () => true, limit: '64kb' }), (req, res) => {
  const ticket = String(req.params.ticket);
  if (Buffer.isBuffer(req.body)) direct.enroll(ticket, req.body);
  // iOS follows a permanent redirect out of Settings and into Safari.
  res.redirect(301, `${baseOf(req)}/d/done/${encodeURIComponent(ticket)}`);
});

directPages.get('/done/:ticket', (req, res) => {
  res.set(PAGE_HEADERS).send(direct.donePage(String(req.params.ticket), langOf(req)));
});

directPages.get('/i/:token', (req, res) => {
  const { html, found } = direct.installPage(String(req.params.token), baseOf(req), langOf(req));
  res.status(found ? 200 : 404).set(PAGE_HEADERS).send(html);
});

directPages.get('/app/:token/:file', (req, res) => {
  const build = db.directBuildByToken(String(req.params.token));
  const project = build ? db.getProject(build.projectId) : null;
  const file = direct.ipaPath(build?.projectId ?? '');
  if (!build || !project || !fs.existsSync(file)) {
    res.status(404).send('Not found.');
    return;
  }
  if (req.params.file === 'manifest.plist') {
    res.set({ 'content-type': 'text/xml', 'cache-control': 'no-store' }).send(Buffer.from(direct.manifest(build, project.bundleId, baseOf(req))));
  } else if (req.params.file === 'app.ipa') {
    res.set({ 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }).sendFile(file);
  } else {
    res.status(404).send('Not found.');
  }
});

// --- Public pages for an app: support and privacy policy -------------------------

/**
 * Open to everyone, because Apple and the app's users have to be able to read them. They exist only
 * for projects whose owner has turned them on, and show only what the owner wrote for them.
 */
export const publicPages = express.Router();

publicPages.get('/:id/:page', (req, res) => {
  const { id, page } = req.params;
  const project = isValidProjectId(id) ? db.getProject(id) : null;
  const html = project && (page === 'support' || page === 'privacy') ? renderPage(project, page) : null;
  res.set({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'public, max-age=300',
  });
  res.status(html ? 200 : 404).send(html ?? '<!doctype html><title>Not found</title><p>Not found.</p>');
});

// --- The app's App Store page ---------------------------------------------------

api.get('/projects/:id/store', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  res.json(storeState(project, (req as Authed).user));
});

api.put('/projects/:id/store/listing', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const body = (req.body ?? {}) as { listing?: unknown; choices?: unknown; contact?: unknown; pages?: unknown };
  const listing = listingFrom(body.listing);
  const contact = contactFrom(body.contact);
  const pages = pagesFrom(body.pages);
  if (!listing || !contact || !pages) {
    res.status(400).json({ error: 'bad_listing' });
    return;
  }
  db.setListing(project.id, listing, choicesFrom(body.choices), pages);
  // The contact belongs to the person, not the app: saved once, used for all their apps.
  db.setReviewContact((req as Authed).user.id, contact);
  res.json(storeState(project, (req as Authed).user));
});

/** Suggests the page's texts from the app's code. Nothing is saved: the person reads them through first. */
api.post('/projects/:id/store/draft', requireUser, async (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  if (!hasCredentials()) {
    res.status(503).json({ error: 'no_api_key' });
    return;
  }
  // It is a model request like a chat message, and counts as one.
  if (!db.consumeMessage((req as Authed).user.id)) {
    res.status(429).json({ error: 'daily_limit' });
    return;
  }
  const result = await draftListing(project.name, db.getFiles(project.id));
  if (!result.ok) {
    res.status(result.error === 'rate_limited' || result.error === 'overloaded' ? 503 : 502).json({ error: result.error });
    return;
  }
  res.json({ draft: result.draft, ageRatingNotes: result.ageRatingNotes, privacyPolicy: result.privacyPolicy });
});

/** Saves what the simulator shows right now as a screenshot for the App Store. */
api.post('/projects/:id/store/screenshots', requireUser, async (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const result = await capture(project);
  if (result !== 'saved') {
    const status = { no_preview: 409, full: 409, failed: 502 }[result];
    res.status(status).json({ error: `screenshot_${result}` });
    return;
  }
  res.status(201).json(storeState(project, (req as Authed).user));
});

/** An image the service produced itself is still never allowed to run anything when opened directly. */
function sendImage(res: Response, mime: string, data: Uint8Array): void {
  res.set({
    'content-type': mime,
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.send(Buffer.from(data));
}

api.get('/projects/:id/store/screenshots/:shot', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const shot = db.getScreenshot(project.id, String(req.params.shot));
  if (!shot) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  sendImage(res, shot.mime, shot.data);
});

api.delete('/projects/:id/store/screenshots/:shot', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  db.deleteScreenshot(project.id, String(req.params.shot));
  res.json(storeState(project, (req as Authed).user));
});

/** The app's own icon, used for the next TestFlight upload. Sent as the PNG file itself. */
api.put('/projects/:id/store/icon', requireUser, express.raw({ type: 'image/png', limit: '4mb' }), (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const result = Buffer.isBuffer(req.body) ? saveIcon(project, req.body) : 'not_png';
  if (result !== 'saved') {
    res.status(400).json({ error: `icon_${result}` });
    return;
  }
  res.json(storeState(project, (req as Authed).user));
});

api.get('/projects/:id/store/icon', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const icon = db.getIcon(project.id);
  if (!icon) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  sendImage(res, 'image/png', icon);
});

api.delete('/projects/:id/store/icon', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  db.deleteIcon(project.id);
  res.json(storeState(project, (req as Authed).user));
});

/** Sends the page to App Store Connect. The browser follows the progress by asking for the state again. */
api.post('/projects/:id/store/sync', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const user = (req as Authed).user;
  const started = startSync(project, user);
  if (started !== 'started') {
    const status = { forbidden: 403, unavailable: 503, busy: 409, incomplete: 400 }[started];
    res.status(status).json({ error: started === 'busy' ? 'busy' : `store_${started}` });
    return;
  }
  res.status(202).json(storeState(project, user));
});

/**
 * Submits the app for Apple's review. This is the one step that is hard to take back, so it only
 * ever happens here, on the owner's own request.
 */
api.post('/projects/:id/store/submit', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const user = (req as Authed).user;
  const started = startSubmit(project, user);
  if (started !== 'started') {
    const status = { forbidden: 403, unavailable: 503, busy: 409, not_ready: 400 }[started];
    res.status(status).json({ error: started === 'busy' ? 'busy' : `store_${started}` });
    return;
  }
  res.status(202).json(storeState(project, user));
});

api.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});
