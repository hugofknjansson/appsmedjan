// Types and small validators shared by the server, the Mac build worker and the web client.

/**
 * Raised whenever the messages between server and worker change in a way the other side must know
 * about. Workers on rented Macs are updated separately from the server; the server says so in its
 * log when one of them is behind (or ahead).
 */
export const PROTOCOL_VERSION = 4;

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

export type StepKind = 'write' | 'edit' | 'delete' | 'read' | 'build' | 'look' | 'rename';

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
}

/** Coordinates are normalized to 0..1 of the screen. */
export type InputEvent =
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
}

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
  /** Submits the app's prepared version for Apple's review. Only ever sent because its owner pressed the button. */
  | { type: 'submit'; jobId: string; projectId: string; bundleId: string; account?: AppleAccount }
  /** `store`: a full-size picture for the App Store page instead of a small one for the agent. */
  | { type: 'screenshot'; jobId: string; projectId: string; store?: boolean }
  | { type: 'input'; projectId: string; event: InputEvent }
  | { type: 'viewers'; projectId: string; count: number }
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
  | { type: 'screenshot.result'; jobId: string; ok: boolean; mime?: string; data?: string; error?: string }
  | { type: 'stream.info'; projectId: string; mime: string }
  | { type: 'sim.stopped'; projectId: string };

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
