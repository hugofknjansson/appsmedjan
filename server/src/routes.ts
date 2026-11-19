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

api.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});
