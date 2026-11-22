import type {
  AppleAccount,
  BuildStage,
  DirectError,
  DirectStage,
  InputEvent,
  PublishError,
  PublishStage,
  PublishTester,
  ReviewContact,
  ShareState,
  StoreBuild,
  StoreChoices,
  StoreListing,
  StoreSyncError,
  StoreSyncStage,
  TesterPerson,
} from '../../shared/protocol';

export interface BuildJob {
  projectId: string;
  appName: string;
  bundleId: string;
  files: Record<string, string>;
  /** The model of the phone the app is watched on ("iPhone19,2"), for a simulator of the same model. */
  device?: string;
}

export interface PublishJob extends BuildJob {
  buildNumber: string;
  /** The person's own developer account; without it the worker's own account is used. */
  account?: AppleAccount;
  /** The person's own app icon as a base64 PNG; without it a placeholder is drawn. */
  icon?: string;
}

/** Signs the app for the person's own phones, for installing without TestFlight. */
export interface DirectJob extends PublishJob {
  phones: Array<{ udid: string; name: string }>;
}

export interface DirectResult {
  ok: boolean;
  error?: DirectError;
  /** Raw tool output for the operator's logs. Never shown to the person using the app. */
  detail?: string;
  /** The signed app file. */
  ipa?: Buffer;
}

/** Fills in the app's page in App Store Connect. */
export interface StoreJob {
  projectId: string;
  bundleId: string;
  listing: StoreListing;
  /** Base64 JPEGs in App Store size, in display order. */
  screenshots: string[];
  build?: string;
  choices?: StoreChoices;
  contact?: ReviewContact;
  account?: AppleAccount;
}

/** Makes an uploaded build installable through a public TestFlight link, or asks how far that has come. */
export interface ShareJob {
  projectId: string;
  bundleId: string;
  build: string;
  check?: boolean;
  contact?: ReviewContact;
  description?: string;
  account?: AppleAccount;
}

export interface ShareResult {
  ok: boolean;
  state?: ShareState;
  url?: string;
  error?: StoreSyncError;
  detail?: string;
}

/** Invites a person to the worker's own developer team as an internal tester of one app. */
export interface InviteJob {
  projectId: string;
  bundleId: string;
  person: TesterPerson;
}

export interface InviteResult {
  ok: boolean;
  state?: 'invited' | 'added';
  error?: StoreSyncError;
  detail?: string;
}

/** Submits the app's prepared version for Apple's review. */
export interface SubmitJob {
  projectId: string;
  bundleId: string;
  account?: AppleAccount;
}

export interface StoreResult {
  ok: boolean;
  error?: StoreSyncError;
  /** Apple's own explanation when it rejected something; otherwise text for the operator's log. */
  detail?: string;
  attached?: StoreBuild;
}

export interface PublishResult {
  ok: boolean;
  error?: PublishError;
  /** Raw tool output for the operator's logs. Never shown to the person using the app. */
  detail?: string;
  tester?: PublishTester;
}

/** What a driver reports back to the server while it works. */
export interface Emit {
  /** False when the frame could not be sent on right now. */
  frame(projectId: string, image: Uint8Array): boolean;
  streamInfo(projectId: string, mime: string): void;
  stopped(projectId: string): void;
}

/** A driver turns build jobs into a running, streamed app. The real one uses Xcode; the mock one fakes it. */
export interface Driver {
  init(): Promise<{ canInput: boolean; canPublish: boolean; hasOwnAccount: boolean; publishesForUsers: boolean; info: string }>;
  build(job: BuildJob, progress: (stage: BuildStage) => void): Promise<{ ok: boolean; errors?: string }>;
  /** Uploads the app to TestFlight. Only called when init() reported canPublish. */
  publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult>;
  /** Signs the app for the person's phones and hands the app file back. Only called when init() reported canPublish. */
  direct(job: DirectJob, progress: (stage: DirectStage) => void): Promise<DirectResult>;
  /** Fills in the app's App Store page. Only called when init() reported canPublish. */
  store(job: StoreJob, progress: (stage: StoreSyncStage) => void): Promise<StoreResult>;
  /** Prepares or checks the public TestFlight link. Only called when init() reported canPublish. */
  share(job: ShareJob): Promise<ShareResult>;
  /** Invites someone as an internal tester in the worker's own account. Only called when init() reported hasOwnAccount. */
  invite(job: InviteJob): Promise<InviteResult>;
  /** Submits the app for review. Only called when init() reported canPublish. */
  submit(job: SubmitJob): Promise<StoreResult>;
  /** `store`: a full-size picture for the App Store page instead of a small one for the agent to look at. */
  screenshot(projectId: string, opts?: { store?: boolean }): Promise<{ mime: string; data: Buffer }>;
  input(projectId: string, event: InputEvent): void;
  /** `video`: every viewer can show video. */
  setViewers(projectId: string, count: number, video?: boolean): void;
  release(projectId: string): Promise<void>;
  shutdown(): Promise<void>;
}
