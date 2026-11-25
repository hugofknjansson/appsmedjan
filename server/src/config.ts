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
   * Lets everyone have apps signed for their own phone by the operator's developer account and
   * installed straight from a link, without TestFlight: the way to try an app. Sharing it or putting
   * it on the App Store takes an account of their own. Off unless asked for: every phone takes one of
   * the account's 100 places for a year, and Apple means those for people who test with you. People
   * with their own connected account can always do it; the places are theirs.
   */
  directInstall: process.env.DIRECT_INSTALL === '1',
  /**
   * A phone added from an app goes straight on to that app: it is built for the phone at once, and
   * the page the phone lands on after the profile turns into the install button when the build is
   * ready, so nobody goes back to the computer or scans a second code. QUICK_INSTALL=0 has the phone
   * sent back to App Dance to press Install, as before.
   */
  quickInstall: process.env.QUICK_INSTALL !== '0',
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
  /** FREE_INSTALL=0 leaves the phone out of the smallest plan: it is then tried in the simulator only. */
  freeInstall: process.env.FREE_INSTALL !== '0',
  freeApps: process.env.FREE_APPS === undefined || process.env.FREE_APPS === '' ? null : Math.max(0, Number(process.env.FREE_APPS) || 0),
  freeMessages: process.env.FREE_MESSAGES === undefined || process.env.FREE_MESSAGES === '' ? null : Math.max(0, Number(process.env.FREE_MESSAGES) || 0),
  /** Codes that let a person past the paywall, and the plan each gives: "kod1, kod2=create". */
  unlockCodes: process.env.UNLOCK_CODES ?? '',
  /** What the plans cost, to show beside them: "create=99 kr i månaden; publish=249 kr i månaden". */
  planPrices: process.env.PLAN_PRICES ?? '',
  /**
   * Counts credits in place of messages while plans are on (PAYWALL=1): a message costs what the
   * model's work behind it cost. Off, the plans count messages as before credits existed.
   */
  credits: process.env.CREDITS === '1',
  /** How many dollars of the model's work one credit stands for. */
  creditDollars: Number(process.env.CREDIT_DOLLARS) > 0 ? Number(process.env.CREDIT_DOLLARS) : 0.1,
  /** The most one message costs, in credits. Anything beyond it is on the service. */
  maxCreditsPerMessage: Math.max(1, Math.floor(Number(process.env.MAX_CREDITS_PER_MESSAGE ?? 40)) || 40),
  /** How many credits each plan gives, when other than usual: "free=25; create=100; publish=260". */
  planCredits: process.env.PLAN_CREDITS ?? '',
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
  /**
   * Apple's push service, for telling the App Dance app on a phone that an app is ready to install
   * when the app is not open. APNS_KEY is the contents of an APNs key (.p8) from the developer account;
   * APNS_KEY_ID its id and APNS_TEAM_ID the team. Without them nothing is sent.
   */
  apnsKey: (process.env.APNS_KEY ?? '').replace(/\\n/g, '\n'),
  apnsKeyId: process.env.APNS_KEY_ID ?? '',
  apnsTeamId: process.env.APNS_TEAM_ID ?? '',
  /** The app the notifications are for: the App Dance iPhone app's bundle id. */
  apnsTopic: process.env.APNS_TOPIC ?? 'app.appsmedjan.ios',
  /**
   * Mail through Resend: MAIL_API_KEY, and MAIL_FROM, an address on a domain verified with Resend
   * ("App Dance <hej@example.se>"). Without them no mail is sent: no confirming of addresses and no
   * links for a new password.
   */
  mailApiKey: process.env.MAIL_API_KEY ?? '',
  mailFrom: process.env.MAIL_FROM ?? '',
  /**
   * REQUIRE_VERIFIED_EMAIL=1: nothing is built before the person has confirmed their address, which
   * stops one person from making account after account for the free credits. Off, the mail is sent
   * and asked for, but building does not wait for it. Needs mail to be set up.
   */
  requireVerifiedEmail: process.env.REQUIRE_VERIFIED_EMAIL === '1',
  /** How long a simulator stays up after the last viewer leaves. */
  releaseAfterMs: Number(process.env.RELEASE_AFTER_MS ?? 5 * 60_000),
};
