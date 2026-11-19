import type { AppleAccount, BuildStage, InputEvent, PublishError, PublishStage } from '../../shared/protocol';

export interface BuildJob {
  projectId: string;
  appName: string;
  bundleId: string;
  files: Record<string, string>;
}

export interface PublishJob extends BuildJob {
  buildNumber: string;
  /** The person's own developer account; without it the worker's own account is used. */
  account?: AppleAccount;
}

export interface PublishResult {
  ok: boolean;
  error?: PublishError;
  /** Raw tool output for the operator's logs. Never shown to the person using the app. */
  detail?: string;
}

/** What a driver reports back to the server while it works. */
export interface Emit {
  frame(projectId: string, image: Uint8Array): void;
  streamInfo(projectId: string, mime: string): void;
  stopped(projectId: string): void;
}

/** A driver turns build jobs into a running, streamed app. The real one uses Xcode; the mock one fakes it. */
export interface Driver {
  init(): Promise<{ canInput: boolean; canPublish: boolean; hasOwnAccount: boolean; publishesForUsers: boolean; info: string }>;
  build(job: BuildJob, progress: (stage: BuildStage) => void): Promise<{ ok: boolean; errors?: string }>;
  /** Uploads the app to TestFlight. Only called when init() reported canPublish. */
  publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult>;
  screenshot(projectId: string): Promise<{ mime: string; data: Buffer }>;
  input(projectId: string, event: InputEvent): void;
  setViewers(projectId: string, count: number): void;
  release(projectId: string): Promise<void>;
  shutdown(): Promise<void>;
}
