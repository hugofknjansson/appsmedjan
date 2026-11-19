import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, Part } from '../../shared/protocol';
import { config } from './config';

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'appsmedjan.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bundle_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, path)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    parts TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    messages INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
`);

export interface User {
  id: string;
  email: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  bundleId: string;
  createdAt: number;
  updatedAt: number;
}

export function randomId(length = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < length) {
    for (const b of crypto.randomBytes(length)) {
      // 252 is the largest multiple of 36 below 256; skipping the rest avoids bias.
      if (b < 252 && out.length < length) out += alphabet[b % 36];
    }
  }
  return out;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// --- Users and sessions ----------------------------------------------------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function createUser(email: string, password: string): User | null {
  const id = randomId(16);
  try {
    db.prepare('INSERT INTO users (id, email, password, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      email,
      hashPassword(password),
      Date.now(),
    );
  } catch {
    return null; // Email already registered.
  }
  return { id, email };
}

export function checkLogin(email: string, password: string): User | null {
  const row = db.prepare('SELECT id, email, password FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; password: string }
    | undefined;
  if (!row) {
    // Spend the same time as a real check so response time doesn't reveal which emails exist.
    crypto.scryptSync(password, 'no-such-user-salt', 64);
    return null;
  }
  return verifyPassword(password, row.password) ? { id: row.id, email: row.email } : null;
}

const SESSION_MS = 30 * 24 * 3600_000;

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + SESSION_MS,
  );
  return token;
}

export function userForSession(token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as { id: string; email: string } | undefined;
  return row ?? null;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

// --- Usage limits ----------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

/** Counts one message against the user's daily allowance. Returns false when the allowance is used up. */
export function consumeMessage(userId: string): boolean {
  const row = db.prepare('SELECT messages FROM usage WHERE user_id = ? AND day = ?').get(userId, today()) as
    | { messages: number }
    | undefined;
  if ((row?.messages ?? 0) >= config.dailyMessageLimit) return false;
  db.prepare(
    `INSERT INTO usage (user_id, day, messages) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET messages = messages + 1`,
  ).run(userId, today());
  return true;
}

// --- Projects ----------------------------------------------------------------

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  bundle_id: string;
  created_at: number;
  updated_at: number;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  bundleId: r.bundle_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createProject(userId: string, name: string, files: Record<string, string>): Project {
  const id = randomId(12);
  const now = Date.now();
  const bundleId = `${config.bundleIdPrefix}.p${id}`;
  db.prepare(
    'INSERT INTO projects (id, user_id, name, bundle_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, name, bundleId, now, now);
  for (const [p, content] of Object.entries(files)) putFile(id, p, content);
  return { id, userId, name, bundleId, createdAt: now, updatedAt: now };
}

export function listProjects(userId: string): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as unknown as ProjectRow[];
  return rows.map(toProject);
}

export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function renameProject(id: string, name: string): void {
  db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id);
}

export function touchProject(id: string): void {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), id);
}

export function deleteProject(id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// --- Files -------------------------------------------------------------------

export function getFiles(projectId: string): Record<string, string> {
  const rows = db
    .prepare('SELECT path, content FROM files WHERE project_id = ? ORDER BY path')
    .all(projectId) as unknown as { path: string; content: string }[];
  return Object.fromEntries(rows.map((r) => [r.path, r.content]));
}

export function getFile(projectId: string, filePath: string): string | null {
  const row = db.prepare('SELECT content FROM files WHERE project_id = ? AND path = ?').get(projectId, filePath) as
    | { content: string }
    | undefined;
  return row ? row.content : null;
}

export function countFiles(projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM files WHERE project_id = ?').get(projectId) as { n: number };
  return row.n;
}

export function putFile(projectId: string, filePath: string, content: string): void {
  db.prepare(
    `INSERT INTO files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
  ).run(projectId, filePath, content, Date.now());
}

export function deleteFile(projectId: string, filePath: string): boolean {
  const res = db.prepare('DELETE FROM files WHERE project_id = ? AND path = ?').run(projectId, filePath);
  return Number(res.changes) > 0;
}

// --- Messages ----------------------------------------------------------------

interface MessageRow {
  id: number;
  role: string;
  text: string;
  parts: string;
  created_at: number;
}

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  role: r.role === 'user' ? 'user' : 'assistant',
  text: r.text,
  parts: JSON.parse(r.parts) as Part[],
  createdAt: r.created_at,
});

export function addMessage(projectId: string, role: 'user' | 'assistant', text: string, parts: Part[]): ChatMessage {
  const now = Date.now();
  const res = db
    .prepare('INSERT INTO messages (project_id, role, text, parts, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, role, text, JSON.stringify(parts), now);
  touchProject(projectId);
  return { id: Number(res.lastInsertRowid), role, text, parts, createdAt: now };
}

export function listMessages(projectId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT id, role, text, parts, created_at FROM messages WHERE project_id = ? ORDER BY id')
    .all(projectId) as unknown as MessageRow[];
  return rows.map(toMessage);
}
