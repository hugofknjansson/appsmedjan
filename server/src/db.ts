import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CHOICES,
  EMPTY_CONTACT,
  EMPTY_LISTING,
  type ChatMessage,
  type Part,
  type PublishError,
  type PublishTester,
  type ReviewContact,
  type StoreBuild,
  type StoreChoices,
  type StoreListing,
  type StoreSyncError,
} from '../../shared/protocol';
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
  CREATE TABLE IF NOT EXISTS apple_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    issuer_id TEXT NOT NULL,
    key_enc TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS publishes (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT,
    build TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_listings (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_screenshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_icons (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_submits (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT,
    detail TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review_contacts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_syncs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT,
    detail TEXT,
    attached TEXT,
    updated_at INTEGER NOT NULL
  );
`);

// Columns added after a table first shipped. SQLite has no "ADD COLUMN IF NOT EXISTS".
function addColumn(table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('publishes', 'tester', 'TEXT');
addColumn('store_listings', 'choices', 'TEXT');

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

export function getUser(id: string): User | null {
  const row = db.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as { id: string; email: string } | undefined;
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

// --- Apple developer accounts ------------------------------------------------

export interface AppleAccountRow {
  teamId: string;
  keyId: string;
  issuerId: string;
  /** The private key, encrypted (see secrets.ts). */
  keyEnc: string;
  createdAt: number;
}

export function getAppleAccount(userId: string): AppleAccountRow | null {
  const row = db
    .prepare('SELECT team_id, key_id, issuer_id, key_enc, created_at FROM apple_accounts WHERE user_id = ?')
    .get(userId) as
    | { team_id: string; key_id: string; issuer_id: string; key_enc: string; created_at: number }
    | undefined;
  if (!row) return null;
  return { teamId: row.team_id, keyId: row.key_id, issuerId: row.issuer_id, keyEnc: row.key_enc, createdAt: row.created_at };
}

export function setAppleAccount(userId: string, account: Omit<AppleAccountRow, 'createdAt'>): void {
  db.prepare(
    `INSERT INTO apple_accounts (user_id, team_id, key_id, issuer_id, key_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       team_id = excluded.team_id, key_id = excluded.key_id, issuer_id = excluded.issuer_id,
       key_enc = excluded.key_enc, created_at = excluded.created_at`,
  ).run(userId, account.teamId, account.keyId, account.issuerId, account.keyEnc, Date.now());
}

export function deleteAppleAccount(userId: string): void {
  db.prepare('DELETE FROM apple_accounts WHERE user_id = ?').run(userId);
}

// --- TestFlight ----------------------------------------------------------------

export interface Publish {
  status: 'uploaded' | 'failed';
  error: PublishError | null;
  build: string;
  /** Whether the account holder was made a TestFlight tester automatically. */
  tester: PublishTester | null;
  updatedAt: number;
}

/** The outcome of the latest upload attempt, if there has been one. */
export function getPublish(projectId: string): Publish | null {
  const row = db.prepare('SELECT status, error, build, tester, updated_at FROM publishes WHERE project_id = ?').get(projectId) as
    | { status: string; error: string | null; build: string; tester: string | null; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    status: row.status === 'uploaded' ? 'uploaded' : 'failed',
    error: row.error as PublishError | null,
    build: row.build,
    tester: row.tester === 'added' || row.tester === 'manual' ? row.tester : null,
    updatedAt: row.updated_at,
  };
}

export function setPublish(
  projectId: string,
  outcome: { status: Publish['status']; error: PublishError | null; build: string; tester: PublishTester | null },
): void {
  db.prepare(
    `INSERT INTO publishes (project_id, status, error, build, tester, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       status = excluded.status, error = excluded.error, build = excluded.build,
       tester = excluded.tester, updated_at = excluded.updated_at`,
  ).run(projectId, outcome.status, outcome.error, outcome.build, outcome.tester, Date.now());
}

// --- App Store page ------------------------------------------------------------

export function getListing(projectId: string): StoreListing {
  const row = db.prepare('SELECT data FROM store_listings WHERE project_id = ?').get(projectId) as { data: string } | undefined;
  if (!row) return { ...EMPTY_LISTING };
  // Fields added later are filled in from the empty listing.
  return { ...EMPTY_LISTING, ...(JSON.parse(row.data) as Partial<StoreListing>) };
}

export function getChoices(projectId: string): StoreChoices {
  const row = db.prepare('SELECT choices FROM store_listings WHERE project_id = ?').get(projectId) as { choices: string | null } | undefined;
  return { ...DEFAULT_CHOICES, ...(row?.choices ? (JSON.parse(row.choices) as Partial<StoreChoices>) : {}) };
}

export function setListing(projectId: string, listing: StoreListing, choices: StoreChoices): void {
  db.prepare(
    `INSERT INTO store_listings (project_id, data, choices, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET data = excluded.data, choices = excluded.choices, updated_at = excluded.updated_at`,
  ).run(projectId, JSON.stringify(listing), JSON.stringify(choices), Date.now());
}

/** When the page, or the contact details sent with it, were last saved. 0 when never. */
export function pageSavedAt(projectId: string, userId: string): number {
  const page = db.prepare('SELECT updated_at FROM store_listings WHERE project_id = ?').get(projectId) as { updated_at: number } | undefined;
  const contact = db.prepare('SELECT updated_at FROM review_contacts WHERE user_id = ?').get(userId) as { updated_at: number } | undefined;
  return Math.max(page?.updated_at ?? 0, contact?.updated_at ?? 0);
}

/** The person's contact details for Apple's review, shared by all their apps. */
export function getReviewContact(userId: string): ReviewContact {
  const row = db.prepare('SELECT data FROM review_contacts WHERE user_id = ?').get(userId) as { data: string } | undefined;
  return { ...EMPTY_CONTACT, ...(row ? (JSON.parse(row.data) as Partial<ReviewContact>) : {}) };
}

export function setReviewContact(userId: string, contact: ReviewContact): void {
  db.prepare(
    `INSERT INTO review_contacts (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(contact), Date.now());
}

/** Ids of the project's App Store screenshots, oldest first: the order they are shown in. */
export function listScreenshots(projectId: string): string[] {
  const rows = db.prepare('SELECT id FROM store_screenshots WHERE project_id = ? ORDER BY created_at, id').all(projectId) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export function addScreenshot(projectId: string, mime: string, data: Uint8Array): string {
  const id = randomId(12);
  db.prepare('INSERT INTO store_screenshots (id, project_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, projectId, mime, data, Date.now());
  return id;
}

export function getScreenshot(projectId: string, id: string): { mime: string; data: Uint8Array } | null {
  const row = db.prepare('SELECT mime, data FROM store_screenshots WHERE project_id = ? AND id = ?').get(projectId, id) as
    | { mime: string; data: Uint8Array }
    | undefined;
  return row ?? null;
}

export function deleteScreenshot(projectId: string, id: string): boolean {
  return db.prepare('DELETE FROM store_screenshots WHERE project_id = ? AND id = ?').run(projectId, id).changes > 0;
}

export function getIcon(projectId: string): Uint8Array | null {
  const row = db.prepare('SELECT data FROM store_icons WHERE project_id = ?').get(projectId) as { data: Uint8Array } | undefined;
  return row?.data ?? null;
}

export function hasIcon(projectId: string): boolean {
  return db.prepare('SELECT 1 FROM store_icons WHERE project_id = ?').get(projectId) !== undefined;
}

export function setIcon(projectId: string, data: Uint8Array): void {
  db.prepare(
    `INSERT INTO store_icons (project_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(projectId, data, Date.now());
}

export function deleteIcon(projectId: string): void {
  db.prepare('DELETE FROM store_icons WHERE project_id = ?').run(projectId);
}

export interface StoreSync {
  status: 'done' | 'failed';
  error: StoreSyncError | null;
  detail: string | null;
  attached: StoreBuild | null;
  updatedAt: number;
}

/** The outcome of the latest attempt to send the page to App Store Connect, if there has been one. */
export function getStoreSync(projectId: string): StoreSync | null {
  const row = db.prepare('SELECT status, error, detail, attached, updated_at FROM store_syncs WHERE project_id = ?').get(projectId) as
    | { status: string; error: string | null; detail: string | null; attached: string | null; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    status: row.status === 'done' ? 'done' : 'failed',
    error: row.error as StoreSyncError | null,
    detail: row.detail,
    attached: row.attached as StoreBuild | null,
    updatedAt: row.updated_at,
  };
}

export interface StoreSubmit {
  status: 'done' | 'failed';
  error: StoreSyncError | null;
  detail: string | null;
  updatedAt: number;
}

/** The outcome of the latest attempt to submit the app for review, if there has been one. */
export function getStoreSubmit(projectId: string): StoreSubmit | null {
  const row = db.prepare('SELECT status, error, detail, updated_at FROM store_submits WHERE project_id = ?').get(projectId) as
    | { status: string; error: string | null; detail: string | null; updated_at: number }
    | undefined;
  if (!row) return null;
  return { status: row.status === 'done' ? 'done' : 'failed', error: row.error as StoreSyncError | null, detail: row.detail, updatedAt: row.updated_at };
}

export function setStoreSubmit(projectId: string, outcome: Omit<StoreSubmit, 'updatedAt'>): void {
  db.prepare(
    `INSERT INTO store_submits (project_id, status, error, detail, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       status = excluded.status, error = excluded.error, detail = excluded.detail, updated_at = excluded.updated_at`,
  ).run(projectId, outcome.status, outcome.error, outcome.detail, Date.now());
}

export function setStoreSync(projectId: string, outcome: Omit<StoreSync, 'updatedAt'>): void {
  db.prepare(
    `INSERT INTO store_syncs (project_id, status, error, detail, attached, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       status = excluded.status, error = excluded.error, detail = excluded.detail,
       attached = excluded.attached, updated_at = excluded.updated_at`,
  ).run(projectId, outcome.status, outcome.error, outcome.detail, outcome.attached, Date.now());
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
