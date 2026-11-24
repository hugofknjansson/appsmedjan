// Types and small validators shared by the server, the Mac build worker and the web client.

/**
 * Raised whenever the messages between server and worker change in a way the other side must know
 * about. Workers on rented Macs are updated separately from the server; the server says so in its
 * log when one of them is behind (or ahead).
 */
export const PROTOCOL_VERSION = 7;

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

/** Every generated source file lives under Sources/ and has one of these extensions. */
const SOURCE_PATH = /^Sources\/(?:[A-Za-z0-9_+\- ]+\/)*[A-Za-z0-9_+\- ]+\.(?:swift|json|txt|strings|xcstrings)$/;

export const MAX_FILE_BYTES = 200_000;
export const MAX_FILES = 150;

export function isValidSourcePath(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 160 && SOURCE_PATH.test(p);
}

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9]{8,32}$/.test(id);
}

export function isValidBundleId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 120 && /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/.test(id);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** say: the builder telling the person, in a few plain words, what it is making right now. */
export type StepKind = 'write' | 'edit' | 'delete' | 'read' | 'build' | 'look' | 'rename' | 'icon' | 'say';

/** One visible action the agent took (shown as a small progress row in the chat). */
export interface Step {
  id: string;
  kind: StepKind;
  /** File path, app name, or empty. Never shown raw to the user; the client phrases it. */
  detail: string;
  status: 'running' | 'done' | 'error';
}

export type Part = { t: 'text'; text: string } | { t: 'step'; step: Step } | { t: 'error'; code: ErrorCode };

export type ErrorCode =
  | 'no_api_key'
  | 'rate_limited'
  | 'overloaded'
  | 'refused'
  | 'stopped'
  | 'too_long'
  | 'internal';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  parts: Part[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Preview / simulator
// ---------------------------------------------------------------------------

export type BuildStage = 'queued' | 'preparing' | 'compiling' | 'installing' | 'launching';

export interface PreviewState {
  /**
   * idle: nothing running yet. unavailable: no Mac worker is connected.
   * building: a build is in progress. running: the app is live in a simulator.
   * failed: the last build failed (an older version may still be on screen).
   */
  status: 'idle' | 'unavailable' | 'building' | 'running' | 'failed';
  stage?: BuildStage;
  /** MIME type of the binary frames being streamed. */
  mime: string;
  /** Whether taps and typing can be forwarded to the simulator. */
  canInput: boolean;
  /**
   * False when the iPhone app is to send a moving finger where it is, instead of where iOS reckons
   * it is heading. Left out otherwise.
   */
  predictFinger?: boolean;
}

/** Coordinates are normalized to 0..1 of the screen. */
export type InputEvent =
  /** A finger on the screen, sent as it moves, so that what is under it can follow. */
  | { kind: 'touch'; phase: 'down' | 'move' | 'up'; x: number; y: number }
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x1: number; y1: number; x2: number; y2: number; durationMs: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: 'backspace' | 'enter' }
  | { kind: 'button'; button: 'home' };

// ---------------------------------------------------------------------------
// TestFlight
// ---------------------------------------------------------------------------

/** waiting_for_app: the app has to be created by hand in App Store Connect; the upload goes on once it exists. */
export type PublishStage = 'queued' | 'preparing' | 'waiting_for_app' | 'archiving' | 'uploading';

/** added: the account holder was made a TestFlight tester automatically. manual: they add themselves. */
export type PublishTester = 'added' | 'manual';

/**
 * no_app_record: the app has not been created in App Store Connect yet (Apple offers no API for that step).
 * compile: the app does not build. signing: certificates or profiles could not be set up.
 * auth: the App Store Connect key was rejected. unavailable: no worker that can publish is connected.
 */
export type PublishError = 'no_app_record' | 'compile' | 'signing' | 'auth' | 'unavailable' | 'internal';

/** The Apple developer account an upload goes to. The key itself only ever travels server -> worker. */
export interface AppleAccount {
  teamId: string;
  keyId: string;
  issuerId: string;
  /** Private key as PEM text. */
  key: string;
}

export const isTeamId = (s: unknown): s is string => typeof s === 'string' && /^[A-Z0-9]{10}$/.test(s);
export const isKeyId = (s: unknown): s is string => typeof s === 'string' && /^[A-Z0-9]{6,20}$/.test(s);
export const isIssuerId = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * A public TestFlight link: anyone who opens it can install the app, with no invitation and no
 * developer account. Apple reviews the first build of an app before the link works.
 *
 * processing: Apple is still working on the uploaded build. review: waiting for Apple's beta review.
 * approved: the link works. rejected: Apple's beta review said no. needs_contact: Apple wants a
 * person to contact about the test, and nobody has been given.
 */
export interface TestLink {
  status: 'none' | 'working' | 'processing' | 'review' | 'approved' | 'rejected' | 'needs_contact' | 'failed';
  /** The address to open on the phone. Only useful once the status is approved. */
  url?: string;
  /** The build the link was last prepared for. */
  build?: string;
  error?: StoreSyncError;
  /** Apple's explanation when it refused something. */
  detail?: string;
  at?: number;
}

export type ShareState = 'processing' | 'review' | 'approved' | 'rejected';

/**
 * The fast way onto a phone for people who use the operator's developer account: they are invited
 * to the operator's team as a tester of their own app, and then get every build within minutes,
 * without Apple's review. Offered only where the operator has turned it on.
 *
 * invited: Apple has emailed them an invitation, which they have to accept. added: they are a tester.
 */
export interface FastTrack {
  /** Whether this person can ask for it for this app right now. */
  available: boolean;
  status: 'none' | 'working' | 'invited' | 'added' | 'failed';
  /** The Apple Account the invitation went to. */
  email?: string;
  error?: StoreSyncError;
  detail?: string;
}

/** Who to invite: the email of their Apple Account, and their name as Apple wants it on the invitation. */
export interface TesterPerson {
  email: string;
  firstName: string;
  lastName: string;
}

export function testerPersonProblem(p: TesterPerson): 'name' | 'email' | null {
  if (!p.firstName.trim() || !p.lastName.trim()) return 'name';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()) || p.email.length > 200) return 'email';
  return null;
}

export interface PublishState {
  /** Whether this person can send the app to TestFlight right now. */
  available: boolean;
  /**
   * Whose developer account the upload goes to: the person's own (connected in the app), the
   * operator's (for people the operator has listed), or none yet.
   */
  account: 'own' | 'operator' | 'none';
  /** Whether people can connect their own Apple developer account on this server. */
  canConnect: boolean;
  status: 'idle' | 'working' | 'uploaded' | 'failed';
  stage?: PublishStage;
  error?: PublishError;
  /** Shown while waiting for the app, and with no_app_record, so the account owner knows which app to create. */
  bundleId?: string;
  /** After an upload: whether the account holder already is a TestFlight tester of the app. */
  tester?: PublishTester;
  /** Build number of the latest upload attempt. */
  build?: string;
  /** When the status last changed (ms since epoch). */
  at?: number;
  /** The public TestFlight link for installing the app on a phone. Missing from servers before it existed. */
  test?: TestLink;
  /** The fast way for people on the operator's account. Missing from servers before it existed. */
  fast?: FastTrack;
  /** True when the signed-in person runs the service, and so is the one who creates apps in App Store Connect. */
  operator?: boolean;
  /** Installing straight onto the person's own phone, without TestFlight. Missing from servers before it existed. */
  direct?: DirectInstall;
  /** What the owner's plan allows. Missing from servers before plans existed, where everything is open. */
  plan?: PlanAccess;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
//
// What a person may do depends on their plan. There is no payment yet: a person asks for a plan and
// the people who run the service give it to them. The limits follow what costs something: messages
// to the builder (the model's work), and a place for the person's phone in the developer account.

export type PlanId = 'free' | 'create' | 'publish';

/** From the smallest plan to the largest. */
export const PLAN_ORDER: PlanId[] = ['free', 'create', 'publish'];

export interface PlanLimits {
  /** How many apps the person may have at once. */
  apps: number;
  /** How many messages to the builder they may send in a calendar month. */
  messages: number;
  /** Whether their apps can be put on a phone: straight onto their own, or through TestFlight. */
  install: boolean;
  /** Whether they get the App Store guide. */
  store: boolean;
  /**
   * Credits the plan gives, where the service counts credits in place of messages: every calendar
   * month, or once for a plan that only gives them to start with (`creditsOnce`).
   */
  credits: number;
  creditsOnce?: boolean;
}

/** The plans. Changing a number here changes it everywhere: the server enforces it and the clients show it. */
export const PLANS: Record<PlanId, PlanLimits> = {
  free: { apps: 1, messages: 20, install: true, store: false, credits: 25, creditsOnce: true },
  create: { apps: 10, messages: 300, install: true, store: false, credits: 100 },
  publish: { apps: 50, messages: 600, install: true, store: true, credits: 260 },
};

/** What ran into a plan's limit. `credits`: the person has no credits left. */
export type PlanNeed = 'apps' | 'messages' | 'install' | 'store' | 'credits';

/**
 * Credits, where the service counts them in place of messages. A message to the builder costs what
 * the work behind it cost: the tokens the model read and wrote, priced at the model's rates, so a
 * small change costs little and a new app more.
 */
export interface CreditState {
  /** Credits the person can spend now. */
  balance: number;
  /** Credits that run out before the end of next month, and when the first of them do. */
  expiring?: { amount: number; at: number };
  /** The latest messages and what each cost, newest first. */
  recent: CreditSpend[];
  /** The most one message ever costs. Anything beyond it is on the service. */
  maxPerMessage: number;
}

export interface CreditSpend {
  at: number;
  /** The app the message was about, when it still exists. */
  app?: string;
  /** build: a message to the builder. listing: texts suggested for the App Store page. */
  what: 'build' | 'listing';
  credits: number;
}

export interface PlanState {
  /** False while the people who run the service have not turned plans on: everything is open to everyone. */
  enforced: boolean;
  plan: PlanId;
  limits: PlanLimits;
  used: { apps: number; messages: number };
  /** A larger plan the person has asked for and not been given yet. */
  requested?: PlanId;
  /** When the month's count of messages starts over (ms since epoch). */
  resetsAt: number;
  /** Every plan, for showing what a larger one would give. */
  plans: Record<PlanId, PlanLimits>;
  /**
   * True when the person stands in front of the paywall: plans are on, and theirs lets them build
   * nothing. Missing from servers before the paywall, where the smallest plan always held something.
   */
  locked?: boolean;
  /** Whether a code can be given in place of paying. */
  takesCode?: boolean;
  /** What each plan costs, in the operator's own words ("99 kr i månaden"), for the plans that have a price. */
  prices?: Partial<Record<PlanId, string>>;
  /** Present where the service counts credits in place of messages. */
  credits?: CreditState;
}

/** What the open project needs to know about the plan, to ask for the right thing at the right moment. */
export interface PlanAccess {
  id: PlanId;
  install: boolean;
  store: boolean;
}

export function isPlanId(value: unknown): value is PlanId {
  return value === 'free' || value === 'create' || value === 'publish';
}

/** The smallest plan that has what is needed, or null when no plan does. */
export function planFor(need: PlanNeed, used: { apps: number; messages: number; credits?: number }, plans: Record<PlanId, PlanLimits> = PLANS): PlanId | null {
  return (
    PLAN_ORDER.find((id) => {
      const plan = plans[id];
      if (need === 'install') return plan.install;
      if (need === 'store') return plan.store;
      // More credits come with a plan that gives more of them each month than the person's own does.
      if (need === 'credits') return !plan.creditsOnce && plan.credits > (used.credits ?? 0);
      return need === 'apps' ? plan.apps > used.apps : plan.messages > used.messages;
    }) ?? null
  );
}

/**
 * The codes that let a person past the paywall, as the operator writes them: separated by commas,
 * each one a code, or a code and the plan it gives ("sommar=create"). A code on its own gives the
 * largest plan. Codes shorter than four characters are not codes.
 */
export function unlockCodes(written: string): Array<{ code: string; plan: PlanId }> {
  return written.split(',').flatMap((entry) => {
    const [code = '', plan = 'publish'] = entry.split('=').map((part) => part.trim());
    return code.length >= 4 && isPlanId(plan) ? [{ code, plan }] : [];
  });
}

/** What each plan costs, as the operator writes it: "create=99 kr i månaden; publish=249 kr i månaden". */
export function planPrices(written: string): Partial<Record<PlanId, string>> {
  const prices: Partial<Record<PlanId, string>> = {};
  for (const entry of written.split(';')) {
    const at = entry.indexOf('=');
    const plan = entry.slice(0, at).trim();
    const price = entry.slice(at + 1).trim();
    if (at > 0 && isPlanId(plan) && price) prices[plan] = price.slice(0, 60);
  }
  return prices;
}

/**
 * How many credits each plan gives, as the operator writes it when the numbers are to be other than
 * the usual ones: "free=25; create=100; publish=260". Plans left out keep their usual number.
 */
export function planCredits(written: string): Partial<Record<PlanId, number>> {
  const credits: Partial<Record<PlanId, number>> = {};
  for (const entry of written.split(';')) {
    const at = entry.indexOf('=');
    const plan = entry.slice(0, at).trim();
    const amount = Number(entry.slice(at + 1).trim());
    if (at > 0 && isPlanId(plan) && Number.isInteger(amount) && amount >= 0) credits[plan] = amount;
  }
  return credits;
}

/** What the model's work cost, in tokens of each kind: the four are billed at different rates. */
export interface TokenUse {
  model: string;
  input: number;
  cacheWritten: number;
  cacheRead: number;
  output: number;
}

/** Dollars per million tokens. Cache writes are for the 5-minute cache, 1.25 times the input rate. */
interface Rates {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/**
 * The models' list prices (Anthropic, November 2026). A model that is not here, such as one the API
 * fell back to, is priced as the dearest one here, so the service never charges less than it paid.
 */
export const MODEL_RATES: Record<string, Rates> = {
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
};
const DEAREST = MODEL_RATES['claude-opus-5']!;

/** What the tokens cost, in dollars. */
export function tokenCost(uses: TokenUse[]): number {
  let dollars = 0;
  for (const use of uses) {
    // A model id may carry a date or other suffix after the name.
    const rates = MODEL_RATES[use.model] ?? Object.entries(MODEL_RATES).find(([name]) => use.model.startsWith(`${name}-`))?.[1] ?? DEAREST;
    dollars += (use.input * rates.input + use.cacheWritten * rates.cacheWrite + use.cacheRead * rates.cacheRead + use.output * rates.output) / 1_000_000;
  }
  return dollars;
}

/** Credits for a cost in dollars, when one credit stands for `perCredit` dollars: rounded up, and at least one for any work. */
export function creditsFor(dollars: number, perCredit: number): number {
  if (!(dollars > 0)) return 0;
  // A hair of floating-point error must not round a whole number of credits up to the next.
  return Math.max(1, Math.ceil(dollars / perCredit - 1e-9));
}

/** A grant of credits as spending sees it: how many are left, and when they run out (null: never). */
export interface CreditGrant {
  id: number;
  left: number;
  expiresAt: number | null;
}

/**
 * Which grants a spend of `amount` credits takes from, and how much from each: those that run out
 * first are used first, so nobody loses credits they could have spent. Never takes more than there is.
 */
export function allocateSpend(grants: CreditGrant[], amount: number, now: number): Array<{ id: number; take: number }> {
  const usable = grants
    .filter((g) => g.left > 0 && (g.expiresAt === null || g.expiresAt > now))
    .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || a.id - b.id);
  const takes: Array<{ id: number; take: number }> = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const grant of usable) {
    if (rest === 0) break;
    const take = Math.min(grant.left, rest);
    takes.push({ id: grant.id, take });
    rest -= take;
  }
  return takes;
}

// ---------------------------------------------------------------------------
// Straight onto the phone
// ---------------------------------------------------------------------------
//
// Apple lets a developer account install apps directly on phones it has registered (ad hoc
// distribution): no TestFlight, no review and no app in App Store Connect. The person adds their
// phone once, by installing a small profile that hands over the phone's identifier; after that every
// build is signed for their phones and installed from a link.

/**
 * What sending the app to the phone from the web came to. sent: the ready build went to the phone,
 * `via` the open App Dance app, a notification, or neither (then the person installs from the code).
 * building: a build for the phone has started, and goes to the phone when it is ready. The rest are
 * why nothing could be sent.
 */
export type ToPhoneResult =
  | { status: 'sent'; via: 'app' | 'push' | 'none' }
  | { status: 'building' }
  | { status: 'no_phones' | 'forbidden' | 'unavailable' | 'busy' };

/** signing: the app is signed for the person's phones and packed. */
export type DirectStage = 'queued' | 'preparing' | 'archiving' | 'signing';

/**
 * no_phones: the person has not added a phone yet. phone_processing: Apple has registered the phone
 * but does not let it into builds yet (up to three days in a new account). phone_limit: the account
 * has no room for more phones this year. The rest are as for uploads.
 */
export type DirectError = 'no_phones' | 'phone_processing' | 'phone_limit' | 'compile' | 'signing' | 'auth' | 'unavailable' | 'internal';

export interface DirectInstall {
  /** Whether this person can have apps signed for their phone on this server right now. */
  available: boolean;
  /** How many phones the person has added, and how many they may add. */
  phones: number;
  maxPhones: number;
  status: 'idle' | 'working' | 'ready' | 'failed';
  stage?: DirectStage;
  error?: DirectError;
  /** Path of the page with the install button, once a build is ready. Opened on the phone. */
  path?: string;
  build?: string;
  /** How far a phone has come with fetching the ready build, once one has started. */
  install?: DirectFetch;
  /** True when the ready build is of the app as it is now: nothing has been changed since it was made. */
  fresh?: boolean;
  /** When the status last changed (ms since epoch). */
  at?: number;
}

/**
 * What the server can see of an install: asked is the phone's owner saying yes to iOS's question,
 * fetching and fetched are the app file on its way to the phone. What iOS does after that (putting
 * the app on the home screen) takes a few seconds and cannot be seen from here.
 */
export type DirectFetch = 'asked' | 'fetching' | 'fetched';

/**
 * How far the whole way onto the phone has come, as one number between 0 and 1, for a progress bar.
 * Null when nothing is on its way.
 */
export function directProgress(direct: Pick<DirectInstall, 'status' | 'stage' | 'install'>): number | null {
  if (direct.status === 'working') return { queued: 0.05, preparing: 0.15, archiving: 0.4, signing: 0.65 }[direct.stage ?? 'queued'];
  if (direct.status !== 'ready') return null;
  if (!direct.install) return 0.75;
  return { asked: 0.85, fetching: 0.92, fetched: 1 }[direct.install];
}

/**
 * How far the builder has come, read off the steps it has taken so far: clues for the person who
 * waits, in words that say nothing about how an app is made.
 *
 * thinking: nothing made yet. making: writing the app. drawing: the icon. trying: running the app to
 * see that it works. fixing: changing something after a try that did not work. looking: at the screen.
 */
export type RunPhase = 'thinking' | 'making' | 'drawing' | 'trying' | 'fixing' | 'looking';

export interface RunProgress {
  phase: RunPhase;
  /** How many pieces of the app have been written or changed so far. */
  pieces: number;
  /** How far along the whole run is, between 0 and 1: a guess that only ever grows within a run. */
  fraction: number;
  /** How many times the app has been built and started so far. */
  tries: number;
  /** True once the icon has been drawn. */
  hasIcon: boolean;
}

/** What the builder last said it is making, or null when it has said nothing yet. */
export function latestSaid(parts: Part[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.t === 'step' && part.step.kind === 'say' && part.step.detail.trim()) return part.step.detail.trim();
  }
  return null;
}

export function runProgress(parts: Part[]): RunProgress {
  // What the builder says along the way is not work of its own.
  const steps = parts.flatMap((part) => (part.t === 'step' && part.step.kind !== 'say' ? [part.step] : []));
  const pieces = steps.filter((step) => (step.kind === 'write' || step.kind === 'edit') && step.status !== 'running').length;
  const tries = steps.filter((step) => step.kind === 'build').length;
  const failed = steps.some((step) => step.kind === 'build' && step.status === 'error');
  const latest = steps.at(-1);

  let phase: RunPhase = 'thinking';
  if (latest) {
    if (latest.kind === 'build') phase = latest.status === 'error' ? 'fixing' : 'trying';
    else if (latest.kind === 'look') phase = 'looking';
    else if (latest.kind === 'icon') phase = 'drawing';
    // Writing again after a try that did not work is fixing, until the next try.
    else phase = failed && steps.findLast((step) => step.kind === 'build')?.status === 'error' ? 'fixing' : 'making';
  }

  // Up to half for the writing (eight pieces count as plenty), then a share for each try. Never full:
  // the run is over when the server says so.
  const written = 0.5 * Math.min(1, pieces / 8);
  const tried = tries === 0 ? 0 : 0.25 + 0.15 * Math.min(1, (tries - 1) / 3);
  const hasIcon = steps.some((step) => step.kind === 'icon' && step.status === 'done');
  return { phase, pieces, fraction: Math.min(0.92, 0.05 + written + tried), tries, hasIcon };
}

/** The machines that make an app, each with a job of its own, in the order they are shown. */
export const MACHINES = ['planner', 'designer', 'coder', 'painter', 'builder', 'tester'] as const;
export type Machine = (typeof MACHINES)[number];
export type MachineState = 'waiting' | 'working' | 'done';

/**
 * Where each machine is, read off how far the builder has come. More than one works at a time: the
 * look is chosen while the code is written, and the app is tried while it is built. The same
 * reckoning as `Machine.states` in the iPhone app.
 */
export function machineStates(progress: RunProgress, done: boolean): Record<Machine, MachineState> {
  if (done) return { planner: 'done', designer: 'done', coder: 'done', painter: 'done', builder: 'done', tester: 'done' };
  const { phase } = progress;
  const tried = progress.tries > 0;
  return {
    planner: phase === 'thinking' ? 'working' : 'done',
    designer: phase === 'thinking' || phase === 'making' || phase === 'drawing' ? 'working' : 'done',
    coder: phase === 'thinking' ? 'waiting' : phase === 'trying' || phase === 'looking' ? 'done' : 'working',
    painter: progress.hasIcon ? 'done' : phase === 'drawing' ? 'working' : 'waiting',
    builder: phase === 'trying' ? 'working' : tried ? 'done' : 'waiting',
    tester: phase === 'trying' || phase === 'looking' ? 'working' : tried ? 'done' : 'waiting',
  };
}

/**
 * The first sentence of what the builder said, for the card that asks about installing: the card is
 * a question, and a long answer above it would bury it. Cut at the first full stop, question mark,
 * exclamation mark or line break; a first sentence that runs on is cut at a word with an ellipsis.
 */
export function firstSentence(text: string, max = 140): string {
  const line = text.trim().split('\n')[0]!.trim();
  const end = /[.!?](?=\s|$)/.exec(line);
  const sentence = end ? line.slice(0, end.index + 1) : line;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,;:–-]+$/, '')}…`;
}

/** A phone the person has added. The identifier itself stays on the server. */
export interface Phone {
  id: string;
  /** What kind of phone it is, as it reported itself: "iPhone17,1". */
  model: string;
  addedAt: number;
}

/** How an Apple device identifier looks: 40 hex digits on older phones, 8-16 with a dash on newer ones. */
export function isUdid(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{8}-[0-9a-fA-F]{16})$/.test(value);
}

/**
 * What a phone says about itself when it is added: a property list inside a signed envelope, as the
 * raw bytes it posted. Only the identifier and the model are read; the envelope's signature is not
 * what lets a phone in, the ticket in the address is.
 */
export function readPhoneAnswer(body: Uint8Array): { udid: string; model: string } | null {
  const text = Array.from(body, (byte) => String.fromCharCode(byte)).join('');
  const plist = /<\?xml[\s\S]*?<\/plist>/.exec(text)?.[0];
  if (!plist) return null;
  const value = (key: string) => new RegExp(`<key>${key}</key>\\s*<string>([^<]{1,80})</string>`).exec(plist)?.[1]?.trim() ?? '';
  const udid = value('UDID');
  if (!isUdid(udid)) return null;
  const model = value('PRODUCT');
  return { udid: udid.toUpperCase(), model: /^[A-Za-z0-9, ]{1,30}$/.test(model) ? model : 'iPhone' };
}

/** The most phones one build is signed for, and the largest app file a worker hands back. */
export const DIRECT_LIMITS = { phones: 10, ipaBytes: 20 * 1024 * 1024 };

/** Build numbers must grow with every upload; the UTC minute does that without any stored counter. */
export function buildNumberFor(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 12);
}

// ---------------------------------------------------------------------------
// App Store page
// ---------------------------------------------------------------------------

/** The texts and links of the app's page on the App Store. They go into the app's primary language. */
export interface StoreListing {
  name: string;
  subtitle: string;
  /** A short line above the description that can be changed without a new version. */
  promo: string;
  description: string;
  /** Comma-separated search words. */
  keywords: string;
  supportUrl: string;
  marketingUrl: string;
  privacyUrl: string;
  /** One of STORE_CATEGORIES, or empty for "not chosen". */
  category: string;
}

export const EMPTY_LISTING: StoreListing = {
  name: '',
  subtitle: '',
  promo: '',
  description: '',
  keywords: '',
  supportUrl: '',
  marketingUrl: '',
  privacyUrl: '',
  category: '',
};

/** Apple's own limits, in characters. */
export const STORE_LIMITS = { name: 30, subtitle: 30, promo: 170, description: 4000, keywords: 100 } as const;

/** Apple's ids for the primary category of an app (games have their own tree and are left out). */
export const STORE_CATEGORIES = [
  'BOOKS',
  'BUSINESS',
  'DEVELOPER_TOOLS',
  'EDUCATION',
  'ENTERTAINMENT',
  'FINANCE',
  'FOOD_AND_DRINK',
  'GRAPHICS_AND_DESIGN',
  'HEALTH_AND_FITNESS',
  'LIFESTYLE',
  'MEDICAL',
  'MUSIC',
  'NAVIGATION',
  'NEWS',
  'PHOTO_AND_VIDEO',
  'PRODUCTIVITY',
  'REFERENCE',
  'SHOPPING',
  'SOCIAL_NETWORKING',
  'SPORTS',
  'TRAVEL',
  'UTILITIES',
  'WEATHER',
] as const;

/**
 * Screenshots are stored in the size Apple asks for on the largest iPhone (the "6.9 inch" slot);
 * the App Store scales them down for smaller phones.
 */
export const STORE_SHOT = { width: 1320, height: 2868, min: 1, max: 10 } as const;
export const STORE_ICON_SIZE = 1024;

/**
 * A support page and a privacy policy for the app, shown by this service at a public address, for
 * people who have no website of their own to put them on.
 */
export interface StorePages {
  hosted: boolean;
  /** Shown on both pages, so people can reach whoever made the app. */
  supportEmail: string;
  /** The privacy policy as plain text; blank lines separate paragraphs. */
  privacyText: string;
  /** Language of the pages' own headings. */
  lang: 'sv' | 'en';
}

export const DEFAULT_PAGES: StorePages = { hosted: false, supportEmail: '', privacyText: '', lang: 'en' };

export const MAX_POLICY_CHARS = 12_000;

/** Where the hosted pages of a project live, under the service's own address. */
export const hostedPagePath = (projectId: string, page: 'support' | 'privacy') => `/a/${projectId}/${page}`;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;

/** Cuts a text at the last whole word that fits in `max` characters. */
export function fitWords(text: string, max: number): string {
  const chars = [...text.trim()];
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max + 1).join('');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : chars.slice(0, max).join('')).replace(/[\s,;:.\-–]+$/, '');
}

export type ListingProblem =
  | 'name_missing'
  | 'name_long'
  | 'subtitle_long'
  | 'promo_long'
  | 'description_missing'
  | 'description_long'
  | 'keywords_missing'
  | 'keywords_long'
  | 'support_url'
  | 'marketing_url'
  | 'privacy_url'
  | 'category'
  | 'screenshots'
  | 'page_email'
  | 'page_policy';

const isWebUrl = (s: string) => /^https:\/\/[^\s/]+\.[^\s]+$/.test(s) && s.length <= 255;

/** What stops the page from being sent to App Store Connect. Empty when it is ready. */
export function listingProblems(listing: StoreListing, screenshots: number, pages?: StorePages): ListingProblem[] {
  const out: ListingProblem[] = [];
  // Apple counts characters the way people do, not UTF-16 units.
  const len = (s: string) => [...s].length;
  if (len(listing.name.trim()) < 2) out.push('name_missing');
  if (len(listing.name) > STORE_LIMITS.name) out.push('name_long');
  if (len(listing.subtitle) > STORE_LIMITS.subtitle) out.push('subtitle_long');
  if (len(listing.promo) > STORE_LIMITS.promo) out.push('promo_long');
  if (len(listing.description.trim()) < 10) out.push('description_missing');
  if (len(listing.description) > STORE_LIMITS.description) out.push('description_long');
  if (!listing.keywords.trim()) out.push('keywords_missing');
  if (len(listing.keywords) > STORE_LIMITS.keywords) out.push('keywords_long');
  // Apple requires a support address and, for every app, a privacy policy.
  if (!isWebUrl(listing.supportUrl)) out.push('support_url');
  if (listing.marketingUrl && !isWebUrl(listing.marketingUrl)) out.push('marketing_url');
  if (!isWebUrl(listing.privacyUrl)) out.push('privacy_url');
  if (!(STORE_CATEGORIES as readonly string[]).includes(listing.category)) out.push('category');
  if (screenshots < STORE_SHOT.min) out.push('screenshots');
  // Pages shown from here need something to show.
  if (pages?.hosted) {
    if (!isEmail(pages.supportEmail.trim())) out.push('page_email');
    if (pages.privacyText.trim().length < 80) out.push('page_policy');
  }
  return out;
}

/**
 * What the person states about the app, and wants set up for them. Each is only acted on when it is
 * true; left false, that part of App Store Connect is not touched and they fill it in there.
 */
export interface StoreChoices {
  /** The app has none of the content Apple's age rating asks about, so it is rated for everyone. */
  noMatureContent: boolean;
  /** The app shows no material from others that the person lacks the rights to. */
  noThirdPartyContent: boolean;
  /** Free, and available in every country. */
  free: boolean;
}

export const DEFAULT_CHOICES: StoreChoices = { noMatureContent: false, noThirdPartyContent: false, free: true };

/** Who Apple's reviewers can reach about the app. Kept per person and used for all their apps. */
export interface ReviewContact {
  firstName: string;
  lastName: string;
  /** With country code, for example +46 70 123 45 67. */
  phone: string;
  email: string;
  /** Who holds the copyright, when it is not the person named above (a company, say). */
  holder: string;
}

export const EMPTY_CONTACT: ReviewContact = { firstName: '', lastName: '', phone: '', email: '', holder: '' };

/** The first thing that keeps the contact details from being used, or null when they are complete. */
export function contactProblem(c: ReviewContact): 'name' | 'phone' | 'email' | null {
  if (!c.firstName.trim() || !c.lastName.trim()) return 'name';
  if (!/^\+[0-9][0-9 ()-]{6,24}$/.test(c.phone.trim())) return 'phone';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return 'email';
  return null;
}

export function contactComplete(c: ReviewContact): boolean {
  return contactProblem(c) === null;
}

/** "First Last, +46 70 123 45 67, name@example.com" from the operator's settings. */
export function parseContact(text: string): ReviewContact | null {
  const [name = '', phone = '', email = ''] = text.split(',').map((s) => s.trim());
  const [firstName = '', ...rest] = name.split(/\s+/);
  const contact = { firstName, lastName: rest.join(' '), phone, email, holder: '' };
  return contactComplete(contact) ? contact : null;
}

/** The copyright line Apple shows on the app's page: the year and who holds it. */
export function copyrightLine(c: ReviewContact, year: number): string {
  return `${year} ${c.holder.trim() || `${c.firstName.trim()} ${c.lastName.trim()}`}`;
}

/** details: copyright, rights, age rating, price and review contact. */
export type StoreSyncStage = 'queued' | 'version' | 'texts' | 'screenshots' | 'build' | 'details';

/**
 * no_app_record: the app does not exist in App Store Connect yet (send it to TestFlight first).
 * locked: the version is in review or already released, so its page cannot be changed here.
 * rejected: Apple did not accept something on the page; `detail` holds Apple's own words.
 */
export type StoreSyncError = 'no_app_record' | 'auth' | 'locked' | 'rejected' | 'unavailable' | 'internal';

/** attached: the latest upload is selected for the version. processing: Apple is still working on it. */
export type StoreBuild = 'attached' | 'processing' | 'none';

export interface StoreState {
  listing: StoreListing;
  /** Ids of the saved screenshots, in the order they are shown on the App Store. */
  screenshots: string[];
  hasIcon: boolean;
  /** Whether a screenshot can be taken right now (the app is running in a simulator). */
  canCapture: boolean;
  /** Whether the page can be sent to App Store Connect right now, and to whose account. */
  available: boolean;
  account: PublishState['account'];
  problems: ListingProblem[];
  /** Build number of the latest successful TestFlight upload, if any. */
  build?: string;
  choices: StoreChoices;
  pages: StorePages;
  /** The signed-in person's contact details for Apple's review. */
  contact: ReviewContact;
  /** Whether the app can be submitted for review right now: the page has been sent with a build, and the contact is filled in. */
  canSubmit: boolean;
  /** The latest attempt to submit the app for review. */
  submit: {
    status: 'idle' | 'working' | 'done' | 'failed';
    error?: StoreSyncError;
    detail?: string;
    at?: number;
  };
  sync: {
    status: 'idle' | 'working' | 'done' | 'failed';
    stage?: StoreSyncStage;
    error?: StoreSyncError;
    /** Apple's explanation when it rejected something. */
    detail?: string;
    attached?: StoreBuild;
    at?: number;
  };
}

// ---------------------------------------------------------------------------
// Getting the app out: the steps to the person's own phone, and to the App Store
// ---------------------------------------------------------------------------

/** Where the person wants the app: as an app of its own on their phone, or in the App Store for anyone. */
export type ReleaseGoal = 'phone' | 'store';

/**
 * member: joining Apple's developer programme. key: making a key and handing it over. Both are
 * done once, and are known to be done when the key works.
 * phone: adding the phone. install: the app signed for it and installed.
 * app: the app made at Apple (by hand; Apple has no other way) and uploaded there.
 * page: the App Store page filled in and sent. privacy: Apple's questions about what the app
 * collects, answered at Apple. submit: handed to Apple's review.
 */
export type ReleaseStepId = 'member' | 'key' | 'phone' | 'install' | 'app' | 'page' | 'privacy' | 'submit';

/** done: nothing left to do. now: the person's turn. working: ours, or Apple's. later: something before it comes first. */
export type ReleaseStepState = 'done' | 'now' | 'working' | 'later';

export interface ReleaseStep {
  id: ReleaseStepId;
  state: ReleaseStepState;
  /** For "app" while it is waited for: the id to pick when making the app at Apple. */
  bundleId?: string;
  /** Apple's own words, when it said no to something. */
  detail?: string;
}

export interface ReleaseGuide {
  phone: ReleaseStep[];
  store: ReleaseStep[];
  /** Whose developer account the app goes out through. */
  account: PublishState['account'];
  /** False where people cannot connect an account of their own, and "none" is the end of the road. */
  canConnect: boolean;
}

interface Stage {
  id: ReleaseStepId;
  done: boolean;
  working?: boolean;
  /** Can be done at the same time as the step before it, which cannot be seen to be done on its own. */
  withPrevious?: boolean;
  bundleId?: string;
  detail?: string;
}

function inOrder(stages: Stage[]): ReleaseStep[] {
  const steps: ReleaseStep[] = [];
  let reached = true;
  for (const stage of stages) {
    const before = steps.at(-1);
    const open = reached || (stage.withPrevious === true && before?.state === 'now');
    const state: ReleaseStepState = stage.done ? 'done' : stage.working ? 'working' : open ? 'now' : 'later';
    steps.push({ id: stage.id, state, ...(stage.bundleId ? { bundleId: stage.bundleId } : {}), ...(stage.detail ? { detail: stage.detail } : {}) });
    reached = reached && stage.done;
  }
  return steps;
}

/** How far the person has come towards each goal, read off what is known about their account, phone and App Store page. */
export function releaseGuide(publish: PublishState, store: Pick<StoreState, 'problems' | 'sync' | 'submit'>): ReleaseGuide {
  const hasAccount = publish.account !== 'none';
  const account: Stage[] = [
    { id: 'member', done: hasAccount },
    { id: 'key', done: hasAccount, withPrevious: true },
  ];
  const direct = publish.direct;
  const arriving = direct?.install === 'asked' || direct?.install === 'fetching';
  const waitingForApp = publish.status === 'working' && publish.stage === 'waiting_for_app';
  const submitted = store.submit.status === 'done';
  return {
    account: publish.account,
    canConnect: publish.canConnect,
    phone: inOrder([
      ...account,
      { id: 'phone', done: (direct?.phones ?? 0) > 0 },
      { id: 'install', done: direct?.status === 'ready' && direct.install === 'fetched', working: direct?.status === 'working' || (direct?.status === 'ready' && arriving) },
    ]),
    store: inOrder([
      ...account,
      {
        id: 'app',
        done: publish.status === 'uploaded',
        // Waiting for the app to be made at Apple is the person's turn, not ours.
        working: publish.status === 'working' && !waitingForApp,
        bundleId: waitingForApp || publish.error === 'no_app_record' ? publish.bundleId : undefined,
      },
      {
        id: 'page',
        done: store.sync.status === 'done' && store.sync.attached === 'attached' && store.problems.length === 0,
        working: store.sync.status === 'working',
        detail: store.sync.status === 'failed' ? store.sync.detail : undefined,
      },
      // Whether the questions are answered cannot be asked of Apple; it shows when the app is handed in.
      { id: 'privacy', done: submitted },
      { id: 'submit', done: submitted, working: store.submit.status === 'working', withPrevious: true, detail: store.submit.status === 'failed' ? store.submit.detail : undefined },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Browser <-> server (JSON text frames; simulator frames arrive as binary)
// ---------------------------------------------------------------------------

export type ServerToClient =
  | {
      type: 'state';
      project: { id: string; name: string };
      messages: ChatMessage[];
      running: boolean;
      parts: Part[];
      preview: PreviewState;
      publish: PublishState;
    }
  | { type: 'run.start' }
  | { type: 'run.end' }
  | { type: 'text.delta'; delta: string }
  | { type: 'part'; part: Part }
  | { type: 'step'; step: Step }
  | { type: 'message'; message: ChatMessage }
  | { type: 'preview'; preview: PreviewState }
  | { type: 'publish'; publish: PublishState }
  | { type: 'frame.clear' }
  | { type: 'files.changed' }
  | { type: 'project'; name: string };

export type ClientToServer = { type: 'input'; event: InputEvent } | { type: 'preview.start' };

// ---------------------------------------------------------------------------
// Server <-> Mac build worker
// ---------------------------------------------------------------------------

export type ServerToWorker =
  | {
      type: 'build';
      jobId: string;
      projectId: string;
      appName: string;
      bundleId: string;
      files: Record<string, string>;
      /** The model of the phone the app is watched on, as Apple names its hardware ("iPhone19,2"), for a simulator of the same model. */
      device?: string;
    }
  | {
      type: 'publish';
      jobId: string;
      projectId: string;
      appName: string;
      bundleId: string;
      buildNumber: string;
      files: Record<string, string>;
      /** Present when the upload goes to the person's own account; otherwise the worker uses its own key. */
      account?: AppleAccount;
      /** The person's own app icon as a base64 PNG; without it a placeholder is drawn. */
      icon?: string;
    }
  | {
      type: 'store';
      jobId: string;
      projectId: string;
      bundleId: string;
      listing: StoreListing;
      /** Base64 JPEGs in App Store size, in display order. */
      screenshots: string[];
      /** Build number to select for the version, when one has been uploaded. */
      build?: string;
      choices?: StoreChoices;
      /** Sent when the person has filled it in completely. */
      contact?: ReviewContact;
      account?: AppleAccount;
    }
  /**
   * Makes an uploaded build installable through a public TestFlight link: the test information, an
   * external group with a public link, the build in it, and Apple's beta review. `check` only asks
   * how far that has come.
   */
  | {
      type: 'share';
      jobId: string;
      projectId: string;
      bundleId: string;
      build: string;
      check?: boolean;
      contact?: ReviewContact;
      /** What the app is, for Apple's reviewers and for testers. */
      description?: string;
      account?: AppleAccount;
    }
  /** Invites a person to the worker's own developer team as an internal tester of this app, or finishes that once they have accepted. */
  | { type: 'invite'; jobId: string; projectId: string; bundleId: string; person: TesterPerson }
  /** Signs the app for the person's own phones and hands the app file back, for installing without TestFlight. */
  | {
      type: 'direct';
      jobId: string;
      projectId: string;
      appName: string;
      bundleId: string;
      buildNumber: string;
      files: Record<string, string>;
      account?: AppleAccount;
      icon?: string;
      /** The phones to sign for. They are registered in the developer account if they are not already. */
      phones: Array<{ udid: string; name: string }>;
    }
  /** Submits the app's prepared version for Apple's review. Only ever sent because its owner pressed the button. */
  | { type: 'submit'; jobId: string; projectId: string; bundleId: string; account?: AppleAccount }
  /** `store`: a full-size picture for the App Store page instead of a small one for the agent. */
  | { type: 'screenshot'; jobId: string; projectId: string; store?: boolean }
  | { type: 'input'; projectId: string; event: InputEvent }
  /**
   * `video`: every viewer can show video, so the screen may be sent as that instead of as still pictures.
   * `light`: someone watching is on a connection that keeps falling behind, so the video should be a lighter one.
   */
  | { type: 'viewers'; projectId: string; count: number; video?: boolean; light?: boolean }
  | { type: 'release'; projectId: string };

export type WorkerToServer =
  | {
      type: 'hello';
      /** PROTOCOL_VERSION of the code the worker runs. Missing from workers older than version 2. */
      protocol?: number;
      name: string;
      mock: boolean;
      canInput: boolean;
      /** True when this worker takes TestFlight uploads. */
      canPublish?: boolean;
      /** True when the worker has the operator's own App Store Connect key. */
      hasOwnAccount?: boolean;
      /** True when the worker accepts uploads that bring a person's own key along. */
      publishesForUsers?: boolean;
      /** False for a signing-only worker that runs no simulators (and so no untrusted app code). */
      canPreview?: boolean;
      maxSimulators: number;
      info: string;
    }
  | { type: 'build.progress'; jobId: string; stage: BuildStage }
  | { type: 'build.result'; jobId: string; ok: boolean; errors?: string; durationMs: number }
  | { type: 'publish.progress'; jobId: string; stage: PublishStage }
  | {
      type: 'publish.result';
      jobId: string;
      ok: boolean;
      error?: PublishError;
      detail?: string;
      tester?: PublishTester;
      durationMs: number;
    }
  | { type: 'store.progress'; jobId: string; stage: StoreSyncStage }
  | { type: 'store.result'; jobId: string; ok: boolean; error?: StoreSyncError; detail?: string; attached?: StoreBuild }
  | { type: 'submit.result'; jobId: string; ok: boolean; error?: StoreSyncError; detail?: string }
  | { type: 'invite.result'; jobId: string; ok: boolean; state?: 'invited' | 'added'; error?: StoreSyncError; detail?: string }
  | { type: 'share.result'; jobId: string; ok: boolean; state?: ShareState; url?: string; error?: StoreSyncError; detail?: string }
  | { type: 'direct.progress'; jobId: string; stage: DirectStage }
  /** `ipa`: the signed app file, base64. */
  | { type: 'direct.result'; jobId: string; ok: boolean; error?: DirectError; detail?: string; ipa?: string; durationMs: number }
  | { type: 'screenshot.result'; jobId: string; ok: boolean; mime?: string; data?: string; error?: string }
  | { type: 'stream.info'; projectId: string; mime: string }
  | { type: 'sim.stopped'; projectId: string };

/** A phone model as Apple names its hardware: "iPhone19,2". Anything else is not one. */
export function isPhoneModel(model: unknown): model is string {
  return typeof model === 'string' && /^iPhone\d{1,2},\d{1,2}$/.test(model);
}

/** The stream's format when the screen is sent as video. */
export const VIDEO_MIME = 'video/h264';

/**
 * What a frame of the stream is. A still picture stands on its own. Video is one picture per frame,
 * in H.264 with start codes: a key picture stands on its own (and brings what is needed to read
 * the ones after it), a delta only says what changed since the picture before it, so it is
 * useless to anyone who missed that one.
 */
export type FrameKind = 'still' | 'key' | 'delta';

export function frameKind(frame: Uint8Array): FrameKind {
  if (!(frame.length > 4 && frame[0] === 0 && frame[1] === 0 && frame[2] === 0 && frame[3] === 1)) return 'still';
  // What it carries is said by the units at its start: settings (7, 8) or a whole picture (5) make it a key.
  const end = Math.min(frame.length - 4, 512);
  for (let at = 0; at <= end; at++) {
    if (frame[at] === 0 && frame[at + 1] === 0 && frame[at + 2] === 0 && frame[at + 3] === 1) {
      const type = frame[at + 4]! & 0x1f;
      if (type === 5 || type === 7) return 'key';
      if (type === 1) return 'delta';
    }
  }
  return 'delta';
}

/** Binary frame from worker to server: [1 byte id length][project id][image bytes]. */
export function encodeFrame(projectId: string, image: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(projectId);
  const out = new Uint8Array(1 + id.length + image.length);
  out[0] = id.length;
  out.set(id, 1);
  out.set(image, 1 + id.length);
  return out;
}

export function decodeFrame(data: Uint8Array): { projectId: string; image: Uint8Array } | null {
  if (data.length < 2) return null;
  const n = data[0]!;
  if (data.length < 1 + n) return null;
  return {
    projectId: new TextDecoder().decode(data.subarray(1, 1 + n)),
    image: data.subarray(1 + n),
  };
}
