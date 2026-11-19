// Types and small validators shared by the server, the Mac build worker and the web client.

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

export type PublishStage = 'queued' | 'preparing' | 'archiving' | 'uploading';

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
  /** Shown with no_app_record so the account owner knows which app to create. */
  bundleId?: string;
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
    }
  | { type: 'screenshot'; jobId: string; projectId: string }
  | { type: 'input'; projectId: string; event: InputEvent }
  | { type: 'viewers'; projectId: string; count: number }
  | { type: 'release'; projectId: string };

export type WorkerToServer =
  | {
      type: 'hello';
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
  | { type: 'publish.result'; jobId: string; ok: boolean; error?: PublishError; detail?: string; durationMs: number }
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
