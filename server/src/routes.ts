// REST API: accounts, projects, chat messages.
import type { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isValidProjectId } from '../../shared/protocol';
import { hasCredentials } from './agent';
import { config } from './config';
import * as db from './db';
import { forget } from './live';
import { STARTER_FILES } from './prompt';
import { accountStatus, connectAccount, disconnectAccount } from './apple';
import { draftListing } from './listing';
import { accountChanged, startPublish } from './publish';
import { capture, choicesFrom, contactFrom, listingFrom, saveIcon, startSubmit, startSync, storeState } from './store';
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

// --- The app's App Store page ---------------------------------------------------

api.get('/projects/:id/store', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  res.json(storeState(project, (req as Authed).user));
});

api.put('/projects/:id/store/listing', requireUser, (req, res) => {
  const project = ownProject(req, res);
  if (!project) return;
  const body = (req.body ?? {}) as { listing?: unknown; choices?: unknown; contact?: unknown };
  const listing = listingFrom(body.listing);
  const contact = contactFrom(body.contact);
  if (!listing || !contact) {
    res.status(400).json({ error: 'bad_listing' });
    return;
  }
  db.setListing(project.id, listing, choicesFrom(body.choices));
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
  res.json({ draft: result.draft, ageRatingNotes: result.ageRatingNotes });
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
