import type { BuildStage, InputEvent } from '../../shared/protocol';

export interface BuildJob {
  projectId: string;
  appName: string;
  bundleId: string;
  files: Record<string, string>;
}

/** What a driver reports back to the server while it works. */
export interface Emit {
  frame(projectId: string, image: Uint8Array): void;
  streamInfo(projectId: string, mime: string): void;
  stopped(projectId: string): void;
}

/** A driver turns build jobs into a running, streamed app. The real one uses Xcode; the mock one fakes it. */
export interface Driver {
  init(): Promise<{ canInput: boolean; info: string }>;
  build(job: BuildJob, progress: (stage: BuildStage) => void): Promise<{ ok: boolean; errors?: string }>;
  screenshot(projectId: string): Promise<{ mime: string; data: Buffer }>;
  input(projectId: string, event: InputEvent): void;
  setViewers(projectId: string, count: number): void;
  release(projectId: string): Promise<void>;
  shutdown(): Promise<void>;
}
