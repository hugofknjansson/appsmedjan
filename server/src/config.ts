import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file: configuration comes from the real environment.
}

const production = process.env.NODE_ENV === 'production';

function workerToken(): string {
  const token = process.env.WORKER_TOKEN ?? '';
  if (token) return token;
  if (production) {
    throw new Error('WORKER_TOKEN must be set in production (shared secret for the Mac build workers).');
  }
  console.warn('[config] WORKER_TOKEN is not set; using the development token "dev-token".');
  return 'dev-token';
}

export const config = {
  production,
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? path.join(ROOT, 'data'),
  webDist: path.join(ROOT, 'web', 'dist'),
  workerToken: workerToken(),
  inviteCode: process.env.INVITE_CODE ?? '',
  model: process.env.AGENT_MODEL ?? 'claude-opus-5-5',
  effort: (process.env.AGENT_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  dailyMessageLimit: Number(process.env.DAILY_MESSAGE_LIMIT ?? 50),
  bundleIdPrefix: process.env.BUNDLE_ID_PREFIX ?? 'app.appsmedjan',
  trustProxy: Boolean(process.env.TRUST_PROXY),
  /** Extra origins allowed to open the browser WebSocket (comma separated), besides the server's own host. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * Emails allowed to use the operator's developer account besides the operators themselves, who
   * always may ("*" allows everyone).
   */
  testflightUsers: (process.env.TESTFLIGHT_USERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /**
   * People who run the service (comma separated emails). They are the ones who create apps in App
   * Store Connect for uploads to the operator's account, so they are shown which apps are waiting.
   */
  operatorEmails: (process.env.OPERATOR_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /**
   * Lets people who use the operator's developer account be invited to its team as internal testers
   * of their own app, so they get builds within minutes instead of waiting for Apple's beta review.
   * Off unless asked for: it makes them members of the team (with access to that one app), and a
   * team has room for 100 internal testers.
   */
  internalTesters: process.env.INTERNAL_TESTERS === '1',
  /**
   * Lets people who use the operator's developer account have apps signed for their own phone and
   * installed straight from a link, without TestFlight. Off unless asked for: every phone takes one
   * of the account's 100 places for a year, and Apple means those for people who test with you.
   * People with their own connected account can always do it; the places are theirs.
   */
  directInstall: process.env.DIRECT_INSTALL === '1',
  /**
   * Turns plans on: what a person may do then depends on the plan they have been given (see
   * shared/protocol.ts). Off, everything is open to everyone who can sign in, as before plans existed.
   */
  paywall: process.env.PAYWALL === '1',
  /** The plan of a person who has not been given one: free, create or publish. */
  defaultPlan: process.env.DEFAULT_PLAN ?? 'free',
  /**
   * What the smallest plan holds, when it is to hold something else than usual: FREE_APPS=0 makes
   * it a paywall, where nothing is built before the person has paid or given a code.
   */
  freeApps: process.env.FREE_APPS === undefined || process.env.FREE_APPS === '' ? null : Math.max(0, Number(process.env.FREE_APPS) || 0),
  freeMessages: process.env.FREE_MESSAGES === undefined || process.env.FREE_MESSAGES === '' ? null : Math.max(0, Number(process.env.FREE_MESSAGES) || 0),
  /** Codes that let a person past the paywall, and the plan each gives: "kod1, kod2=create". */
  unlockCodes: process.env.UNLOCK_CODES ?? '',
  /** What the plans cost, to show beside them: "create=99 kr i månaden; publish=249 kr i månaden". */
  planPrices: process.env.PLAN_PRICES ?? '',
  /** How many phones one person may add. */
  maxPhones: Math.max(1, Number(process.env.MAX_PHONES_PER_USER ?? 2) || 2),
  /** The address people reach the service at, for links that phones open. Worked out from the request when empty. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /**
   * Who Apple may contact about apps tested from the operator's account, when the app's own maker
   * has not given contact details: "First Last, +46 70 123 45 67, name@example.com".
   */
  betaContact: process.env.BETA_CONTACT ?? '',
  /**
   * Encrypts people's App Store Connect keys in the database. Without it nobody can connect their own
   * Apple developer account. Changing it makes the stored keys unreadable (people connect again).
   */
  secretsKey: process.env.SECRETS_KEY ?? '',
  /**
   * The iPhone app sends a moving finger where iOS reckons it is heading, which takes a little off
   * the wait for what follows it in the simulator. PREDICT_FINGER=0 has it sent where it is.
   */
  predictFinger: process.env.PREDICT_FINGER !== '0',
  /** How long a simulator stays up after the last viewer leaves. */
  releaseAfterMs: Number(process.env.RELEASE_AFTER_MS ?? 5 * 60_000),
};
