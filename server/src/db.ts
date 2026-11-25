import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type DirectError,
  DEFAULT_CHOICES,
  DEFAULT_PAGES,
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
  type StorePages,
  type StoreSyncError,
  type TesterPerson,
  type TestLink,
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
  CREATE TABLE IF NOT EXISTS test_links (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    url TEXT,
    build TEXT,
    error TEXT,
    detail TEXT,
    checked_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fast_tracks (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    detail TEXT,
    checked_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_plans (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    period TEXT,
    amount INTEGER NOT NULL,
    left INTEGER NOT NULL,
    expires_at INTEGER,
    note TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, period)
  );
  CREATE TABLE IF NOT EXISTS credit_spends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT,
    what TEXT NOT NULL,
    dollars REAL NOT NULL,
    credits INTEGER NOT NULL,
    charged INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_spends_user ON credit_spends (user_id, created_at);
  CREATE TABLE IF NOT EXISTS plan_requests (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    requested_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    subscription_id TEXT,
    plan TEXT,
    status TEXT,
    period_start INTEGER,
    period_end INTEGER,
    ends INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subscriptions_customer ON subscriptions (customer_id);
  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sandbox INTEGER NOT NULL,
    lang TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS phones (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    udid TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, udid)
  );
  CREATE TABLE IF NOT EXISTS direct_builds (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    error TEXT,
    build TEXT NOT NULL,
    token TEXT,
    app_name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_requests (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL
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
// When the person confirmed their email address; null while they have not.
addColumn('users', 'email_verified_at', 'INTEGER');
addColumn('store_listings', 'choices', 'TEXT');
addColumn('store_listings', 'pages', 'TEXT');
// Whose icon it is: the person's own choice (as every icon was before this column), the builder's drawing, or the stand-in.
addColumn('store_icons', 'source', "TEXT NOT NULL DEFAULT 'own'");

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

/** Whether the person's password is this one. */
export function passwordIs(userId: string, password: string): boolean {
  const row = db.prepare('SELECT password FROM users WHERE id = ?').get(userId) as { password: string } | undefined;
  return row ? verifyPassword(password, row.password) : false;
}

export function setPassword(userId: string, password: string): void {
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), userId);
}

/** Signs the person out everywhere. */
export function deleteSessionsOf(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Removes the person and, with them, everything that is theirs in the database. */
export function deleteUser(userId: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function emailVerified(userId: string): boolean {
  const row = db.prepare('SELECT email_verified_at AS at FROM users WHERE id = ?').get(userId) as { at: number | null } | undefined;
  return row?.at != null;
}

export function setEmailVerified(userId: string): void {
  db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(Date.now(), userId);
}

/** A link for a mail: good once, until it runs out. Earlier links of the same kind stop working. */
export function createEmailToken(userId: string, kind: 'verify' | 'reset', validMs: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
  db.prepare('INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    kind,
    Date.now() + validMs,
    Date.now(),
  );
  return token;
}

/** When the latest link of this kind was made for the person, or null when there is none. */
export function lastEmailTokenAt(userId: string, kind: 'verify' | 'reset'): number | null {
  const row = db.prepare('SELECT created_at AS at FROM email_tokens WHERE user_id = ? AND kind = ?').get(userId, kind) as { at: number } | undefined;
  return row?.at ?? null;
}

/** Uses up a link: the person it was for, or null when it is not one, or has run out. */
export function useEmailToken(token: string, kind: 'verify' | 'reset'): string | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const hash = sha256(token);
  const row = db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM email_tokens WHERE token_hash = ? AND kind = ?').get(hash, kind) as
    | { userId: string; expiresAt: number }
    | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').run(hash);
  return row.expiresAt > Date.now() ? row.userId : null;
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

/** How many messages the person has sent this calendar month (UTC). */
export function messagesThisMonth(userId: string): number {
  const row = db.prepare('SELECT SUM(messages) AS messages FROM usage WHERE user_id = ? AND day LIKE ?').get(userId, `${today().slice(0, 7)}-%`) as
    | { messages: number | null }
    | undefined;
  return row?.messages ?? 0;
}

// --- Plans -------------------------------------------------------------------

/** The plan the person has been given, or null when they have the default one. */
export function getPlan(userId: string): string | null {
  const row = db.prepare('SELECT plan FROM user_plans WHERE user_id = ?').get(userId) as { plan: string } | undefined;
  return row?.plan ?? null;
}

/** Gives the person a plan. A request they had waiting is answered by it. */
export function setPlan(userId: string, plan: string): void {
  db.prepare(
    `INSERT INTO user_plans (user_id, plan, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at`,
  ).run(userId, plan, Date.now());
  db.prepare('DELETE FROM plan_requests WHERE user_id = ?').run(userId);
}

/** Takes the person's plan away: they have the default one again. */
export function clearPlan(userId: string): void {
  db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
}

/**
 * What the payment provider knows about a person: who they are there, and the subscription they pay
 * for, if any. `ends`: the person has cancelled, and the plan stops at the end of the period.
 */
export interface Subscription {
  userId: string;
  customerId: string;
  subscriptionId: string | null;
  plan: string | null;
  status: string | null;
  periodStart: number | null;
  periodEnd: number | null;
  ends: boolean;
}

const SUBSCRIPTION = `SELECT user_id AS userId, customer_id AS customerId, subscription_id AS subscriptionId, plan, status,
  period_start AS periodStart, period_end AS periodEnd, ends FROM subscriptions`;
const asSubscription = (row: unknown): Subscription | null => (row ? { ...(row as Subscription), ends: Boolean((row as { ends: number }).ends) } : null);

export function subscriptionOf(userId: string): Subscription | null {
  return asSubscription(db.prepare(`${SUBSCRIPTION} WHERE user_id = ?`).get(userId));
}

export function subscriptionOfCustomer(customerId: string): Subscription | null {
  return asSubscription(db.prepare(`${SUBSCRIPTION} WHERE customer_id = ?`).get(customerId));
}

export function saveSubscription(sub: Subscription): void {
  db.prepare(
    `INSERT INTO subscriptions (user_id, customer_id, subscription_id, plan, status, period_start, period_end, ends, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET customer_id = excluded.customer_id, subscription_id = excluded.subscription_id,
       plan = excluded.plan, status = excluded.status, period_start = excluded.period_start, period_end = excluded.period_end,
       ends = excluded.ends, updated_at = excluded.updated_at`,
  ).run(sub.userId, sub.customerId, sub.subscriptionId, sub.plan, sub.status, sub.periodStart, sub.periodEnd, sub.ends ? 1 : 0, Date.now());
}

export function getPlanRequest(userId: string): string | null {
  const row = db.prepare('SELECT plan FROM plan_requests WHERE user_id = ?').get(userId) as { plan: string } | undefined;
  return row?.plan ?? null;
}

export function requestPlan(userId: string, plan: string): void {
  db.prepare(
    `INSERT INTO plan_requests (user_id, plan, requested_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, requested_at = excluded.requested_at`,
  ).run(userId, plan, Date.now());
}

export function userByEmail(email: string): User | null {
  const row = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.trim().toLowerCase()) as User | undefined;
  return row ?? null;
}

export interface PlanRow {
  userId: string;
  email: string;
  /** Null for a person on the default plan. */
  plan: string | null;
  requested: string | null;
  requestedAt: number | null;
  apps: number;
  messages: number;
  /** Credits the person can spend now. */
  credits: number;
  /** What the model's work for them cost this month, in dollars, whether credits are counted or not. */
  dollars: number;
}

/** Everyone with an account, with their plan, what they have asked for and what they have used this month. Newest requests first. */
export function listPlans(limit = 500): PlanRow[] {
  const rows = db
    .prepare(
      `SELECT u.id AS userId, u.email AS email, p.plan AS plan, r.plan AS requested, r.requested_at AS requestedAt,
         (SELECT COUNT(*) FROM projects WHERE user_id = u.id) AS apps,
         (SELECT COALESCE(SUM(messages), 0) FROM usage WHERE user_id = u.id AND day LIKE ?) AS messages,
         (SELECT COALESCE(SUM(left), 0) FROM credit_grants WHERE user_id = u.id AND (expires_at IS NULL OR expires_at > ?)) AS credits,
         (SELECT COALESCE(SUM(dollars), 0) FROM credit_spends WHERE user_id = u.id AND created_at >= ?) AS dollars
       FROM users u
       LEFT JOIN user_plans p ON p.user_id = u.id
       LEFT JOIN plan_requests r ON r.user_id = u.id
       ORDER BY r.requested_at IS NULL, r.requested_at DESC, u.created_at DESC
       LIMIT ?`,
    )
    .all(`${today().slice(0, 7)}-%`, Date.now(), monthStart(), limit) as unknown as PlanRow[];
  return rows;
}

/** The first moment of this calendar month (UTC). */
function monthStart(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

// --- Credits -------------------------------------------------------------------

export interface GrantRow {
  id: number;
  kind: string;
  period: string | null;
  amount: number;
  left: number;
  expiresAt: number | null;
}

/** The person's grants that still have credits in them and have not run out. */
export function liveGrants(userId: string, now = Date.now()): GrantRow[] {
  return db
    .prepare(
      `SELECT id, kind, period, amount, left, expires_at AS expiresAt FROM credit_grants
       WHERE user_id = ? AND left > 0 AND (expires_at IS NULL OR expires_at > ?) ORDER BY id`,
    )
    .all(userId, now) as unknown as GrantRow[];
}

/** The grant for a period ("2026-11", or "once" for credits a plan gives only to start with), if there is one. */
export function periodGrant(userId: string, period: string): GrantRow | null {
  const row = db
    .prepare('SELECT id, kind, period, amount, left, expires_at AS expiresAt FROM credit_grants WHERE user_id = ? AND period = ?')
    .get(userId, period) as GrantRow | undefined;
  return row ?? null;
}

/**
 * Makes sure the period's grant holds at least `amount` credits: a new grant, or more credits in the
 * one there is (a larger plan in the middle of a month gives the difference). Never takes any away.
 */
export function topUpPeriod(userId: string, period: string, kind: string, amount: number, expiresAt: number | null): void {
  db.prepare(
    `INSERT INTO credit_grants (user_id, kind, period, amount, left, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, period) DO UPDATE SET
       left = left + MAX(0, excluded.amount - amount),
       amount = MAX(amount, excluded.amount)`,
  ).run(userId, kind, period, amount, amount, expiresAt, Date.now());
}

/** Credits given outside a plan: bought, or handed out by the people who run the service. */
export function addGrant(userId: string, kind: string, amount: number, expiresAt: number | null, note: string): void {
  db.prepare('INSERT INTO credit_grants (user_id, kind, amount, left, expires_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    userId,
    kind,
    amount,
    amount,
    expiresAt,
    note.slice(0, 200),
    Date.now(),
  );
}

/**
 * Records what a piece of work cost and takes the charged credits from the grants named, all at once:
 * either everything is written or nothing is.
 */
export function recordSpend(
  spend: { userId: string; projectId: string | null; what: string; dollars: number; credits: number },
  takes: Array<{ id: number; take: number }>,
): number {
  const charged = takes.reduce((sum, t) => sum + t.take, 0);
  db.exec('BEGIN IMMEDIATE');
  try {
    const take = db.prepare('UPDATE credit_grants SET left = left - ? WHERE id = ? AND user_id = ? AND left >= ?');
    for (const t of takes) {
      const done = take.run(t.take, t.id, spend.userId, t.take);
      if (Number(done.changes) !== 1) throw new Error(`grant ${t.id} no longer holds ${t.take} credits`);
    }
    db.prepare('INSERT INTO credit_spends (user_id, project_id, what, dollars, credits, charged, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      spend.userId,
      spend.projectId,
      spend.what,
      spend.dollars,
      spend.credits,
      charged,
      Date.now(),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return charged;
}

/** The person's latest charges, newest first, with the name of the app each was about when it still exists. */
export function recentSpends(userId: string, limit = 8): Array<{ at: number; app: string | null; what: string; charged: number }> {
  return db
    .prepare(
      `SELECT s.created_at AS at, p.name AS app, s.what AS what, s.charged AS charged
       FROM credit_spends s LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.user_id = ? AND s.charged > 0 ORDER BY s.id DESC LIMIT ?`,
    )
    .all(userId, limit) as unknown as Array<{ at: number; app: string | null; what: string; charged: number }>;
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

/** When any of the project's files was last written, or 0 for a project without files. */
export function filesChangedAt(projectId: string): number {
  const row = db.prepare('SELECT MAX(updated_at) AS at FROM files WHERE project_id = ?').get(projectId) as { at: number | null } | undefined;
  return row?.at ?? 0;
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

/** The project's hosted support and privacy pages, and when they were last saved. */
export function getPages(projectId: string): { pages: StorePages; savedAt: number } {
  const row = db.prepare('SELECT pages, updated_at FROM store_listings WHERE project_id = ?').get(projectId) as
    | { pages: string | null; updated_at: number }
    | undefined;
  return { pages: { ...DEFAULT_PAGES, ...(row?.pages ? (JSON.parse(row.pages) as Partial<StorePages>) : {}) }, savedAt: row?.updated_at ?? 0 };
}

export function setListing(projectId: string, listing: StoreListing, choices: StoreChoices, pages: StorePages): void {
  db.prepare(
    `INSERT INTO store_listings (project_id, data, choices, pages, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       data = excluded.data, choices = excluded.choices, pages = excluded.pages, updated_at = excluded.updated_at`,
  ).run(projectId, JSON.stringify(listing), JSON.stringify(choices), JSON.stringify(pages), Date.now());
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

export type IconSource = 'own' | 'drawn' | 'default';

/** `own`: the person chose it. `drawn`: the builder drew it. `default`: the stand-in every app gets. */
export function setIcon(projectId: string, data: Uint8Array, source: IconSource): void {
  db.prepare(
    `INSERT INTO store_icons (project_id, data, source, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET data = excluded.data, source = excluded.source, updated_at = excluded.updated_at`,
  ).run(projectId, data, source, Date.now());
}

export function iconSource(projectId: string): IconSource | null {
  const row = db.prepare('SELECT source FROM store_icons WHERE project_id = ?').get(projectId) as { source: IconSource } | undefined;
  return row?.source ?? null;
}

/** When the icon last changed, for telling a browser that its copy is old. Null without an icon. */
export function iconChangedAt(projectId: string): number | null {
  const row = db.prepare('SELECT updated_at AS at FROM store_icons WHERE project_id = ?').get(projectId) as { at: number } | undefined;
  return row?.at ?? null;
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

// --- Public TestFlight link ------------------------------------------------------

export interface TestLinkRow extends TestLink {
  projectId: string;
  /** When Apple was last asked how the build is doing. */
  checkedAt: number;
}

const toTestLink = (r: Record<string, unknown>): TestLinkRow => ({
  projectId: String(r.project_id),
  status: r.status as TestLink['status'],
  url: (r.url as string | null) ?? undefined,
  build: (r.build as string | null) ?? undefined,
  error: (r.error as StoreSyncError | null) ?? undefined,
  detail: (r.detail as string | null) ?? undefined,
  at: Number(r.updated_at),
  checkedAt: Number(r.checked_at),
});

export function getTestLink(projectId: string): TestLinkRow | null {
  const row = db.prepare('SELECT * FROM test_links WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
  return row ? toTestLink(row) : null;
}

/** The links Apple is still working on: builds being processed or reviewed. */
export function pendingTestLinks(): TestLinkRow[] {
  const rows = db.prepare("SELECT * FROM test_links WHERE status IN ('processing', 'review')").all() as unknown as Record<string, unknown>[];
  return rows.map(toTestLink);
}

/** Saves where the link stands. `changed` false only notes that Apple was asked and nothing moved. */
export function setTestLink(projectId: string, link: Omit<TestLink, 'at'>, changed = true): void {
  const now = Date.now();
  const previous = changed ? null : getTestLink(projectId);
  db.prepare(
    `INSERT INTO test_links (project_id, status, url, build, error, detail, checked_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       status = excluded.status, url = excluded.url, build = excluded.build, error = excluded.error,
       detail = excluded.detail, checked_at = excluded.checked_at, updated_at = excluded.updated_at`,
  ).run(projectId, link.status, link.url ?? null, link.build ?? null, link.error ?? null, link.detail ?? null, now, previous?.at ?? now);
}

// --- Internal testers: the fast way onto a phone ---------------------------------------

export interface FastTrackRow {
  projectId: string;
  person: TesterPerson;
  status: 'invited' | 'added' | 'failed';
  error: StoreSyncError | null;
  detail: string | null;
  checkedAt: number;
  updatedAt: number;
}

const toFastTrack = (r: Record<string, unknown>): FastTrackRow => ({
  projectId: String(r.project_id),
  person: { email: String(r.email), firstName: String(r.first_name), lastName: String(r.last_name) },
  status: r.status as FastTrackRow['status'],
  error: (r.error as StoreSyncError | null) ?? null,
  detail: (r.detail as string | null) ?? null,
  checkedAt: Number(r.checked_at),
  updatedAt: Number(r.updated_at),
});

export function getFastTrack(projectId: string): FastTrackRow | null {
  const row = db.prepare('SELECT * FROM fast_tracks WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
  return row ? toFastTrack(row) : null;
}

/** Invitations that have been sent and not yet accepted. */
export function pendingFastTracks(): FastTrackRow[] {
  const rows = db.prepare("SELECT * FROM fast_tracks WHERE status = 'invited'").all() as unknown as Record<string, unknown>[];
  return rows.map(toFastTrack);
}

/** Saves where the invitation stands. `changed` false only notes that Apple was asked and nothing moved. */
export function setFastTrack(
  projectId: string,
  person: TesterPerson,
  outcome: { status: FastTrackRow['status']; error?: StoreSyncError | null; detail?: string | null },
  changed = true,
): void {
  const now = Date.now();
  const previous = changed ? null : getFastTrack(projectId);
  db.prepare(
    `INSERT INTO fast_tracks (project_id, email, first_name, last_name, status, error, detail, checked_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, status = excluded.status,
       error = excluded.error, detail = excluded.detail, checked_at = excluded.checked_at, updated_at = excluded.updated_at`,
  ).run(projectId, person.email, person.firstName, person.lastName, outcome.status, outcome.error ?? null, outcome.detail ?? null, now, previous?.updatedAt ?? now);
}

// --- Apps the operator has to create in App Store Connect ---------------------------

// --- Straight onto the phone ----------------------------------------------------

export interface PhoneRow {
  id: string;
  userId: string;
  udid: string;
  model: string;
  createdAt: number;
}

const toPhone = (r: Record<string, unknown>): PhoneRow => ({
  id: r.id as string,
  userId: r.user_id as string,
  udid: r.udid as string,
  model: r.model as string,
  createdAt: r.created_at as number,
});

export function listPhones(userId: string): PhoneRow[] {
  const rows = db.prepare('SELECT * FROM phones WHERE user_id = ? ORDER BY created_at').all(userId) as unknown as Record<string, unknown>[];
  return rows.map(toPhone);
}

/**
 * Where notifications reach the App Dance app on a phone. A phone has one address, so whoever signs in
 * on it last gets its notifications.
 */
export function savePushToken(userId: string, token: string, sandbox: boolean, lang: string): void {
  db.prepare(
    `INSERT INTO push_tokens (token, user_id, sandbox, lang, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, sandbox = excluded.sandbox, lang = excluded.lang, updated_at = excluded.updated_at`,
  ).run(token, userId, sandbox ? 1 : 0, lang, Date.now());
}

export function pushTokensOf(userId: string): Array<{ token: string; sandbox: boolean; lang: string }> {
  const rows = db.prepare('SELECT token, sandbox, lang FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10').all(userId) as unknown as Array<{
    token: string;
    sandbox: number;
    lang: string;
  }>;
  return rows.map((r) => ({ token: r.token, sandbox: r.sandbox === 1, lang: r.lang }));
}

/** Forgets an address: the person signed out on that phone, or Apple says the app is gone from it. */
export function deletePushToken(token: string, userId?: string): void {
  if (userId) db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(token, userId);
  else db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
}

/** Adds the phone to the person's own. Adding one they already have changes nothing. */
export function addPhone(userId: string, udid: string, model: string): void {
  db.prepare('INSERT OR IGNORE INTO phones (id, user_id, udid, model, created_at) VALUES (?, ?, ?, ?, ?)').run(randomId(12), userId, udid, model, Date.now());
}

export function deletePhone(userId: string, id: string): boolean {
  return db.prepare('DELETE FROM phones WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
}

export interface DirectBuild {
  projectId: string;
  status: 'ready' | 'failed';
  error: DirectError | null;
  build: string;
  /** The secret in the install link. A new build gets a new one, so an old link stops working. */
  token: string | null;
  appName: string;
  updatedAt: number;
}

const toDirectBuild = (r: Record<string, unknown>): DirectBuild => ({
  projectId: r.project_id as string,
  status: r.status as DirectBuild['status'],
  error: (r.error as DirectError | null) ?? null,
  build: r.build as string,
  token: (r.token as string | null) ?? null,
  appName: r.app_name as string,
  updatedAt: r.updated_at as number,
});

export function getDirectBuild(projectId: string): DirectBuild | null {
  const row = db.prepare('SELECT * FROM direct_builds WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
  return row ? toDirectBuild(row) : null;
}

export function directBuildByToken(token: string): DirectBuild | null {
  const row = db.prepare("SELECT * FROM direct_builds WHERE token = ? AND status = 'ready'").get(token) as Record<string, unknown> | undefined;
  return row ? toDirectBuild(row) : null;
}

export function setDirectBuild(projectId: string, outcome: Omit<DirectBuild, 'projectId' | 'updatedAt'>): void {
  db.prepare(
    `INSERT INTO direct_builds (project_id, status, error, build, token, app_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET status = excluded.status, error = excluded.error, build = excluded.build,
       token = excluded.token, app_name = excluded.app_name, updated_at = excluded.updated_at`,
  ).run(projectId, outcome.status, outcome.error, outcome.build, outcome.token, outcome.appName, Date.now());
}


export function requestApp(projectId: string): void {
  db.prepare('INSERT OR IGNORE INTO app_requests (project_id, requested_at) VALUES (?, ?)').run(projectId, Date.now());
}

export function clearAppRequest(projectId: string): void {
  db.prepare('DELETE FROM app_requests WHERE project_id = ?').run(projectId);
}

export interface AppRequest {
  projectId: string;
  name: string;
  bundleId: string;
  email: string;
  requestedAt: number;
}

export function listAppRequests(): AppRequest[] {
  const rows = db
    .prepare(
      `SELECT r.project_id, r.requested_at, p.name, p.bundle_id, u.email
       FROM app_requests r JOIN projects p ON p.id = r.project_id JOIN users u ON u.id = p.user_id
       ORDER BY r.requested_at`,
    )
    .all() as unknown as { project_id: string; requested_at: number; name: string; bundle_id: string; email: string }[];
  return rows.map((r) => ({ projectId: r.project_id, name: r.name, bundleId: r.bundle_id, email: r.email, requestedAt: r.requested_at }));
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
