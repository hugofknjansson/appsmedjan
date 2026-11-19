// Registry of connected Mac build workers, and the request/response plumbing towards them.
import type { WebSocket } from 'ws';
import {
  decodeFrame,
  type AppleAccount,
  type BuildStage,
  type InputEvent,
  type PublishError,
  type PublishStage,
  type PublishTester,
  type ServerToWorker,
  type WorkerToServer,
} from '../../shared/protocol';
import { randomId } from './db';
import { keepAlive } from './keepalive';
import { clearFrame, live, sendFrame, setPreview, workersChanged } from './live';

interface Worker {
  ws: WebSocket;
  name: string;
  mock: boolean;
  canInput: boolean;
  /** Runs simulators. False for a signing-only worker. */
  canPreview: boolean;
  /** Has the operator's own App Store Connect key. */
  hasOwnAccount: boolean;
  /** Accepts uploads that bring a person's own key along. */
  publishesForUsers: boolean;
  ready: boolean;
  projects: Set<string>;
}

export interface BuildResult {
  ok: boolean;
  errors?: string;
}

interface Pending {
  worker: Worker;
  resolve: (msg: WorkerToServer) => void;
  reject: (err: Error) => void;
  onProgress?: (stage: string) => void;
  timer: NodeJS.Timeout;
}

const workers = new Set<Worker>();
const assignment = new Map<string, Worker>();
const pending = new Map<string, Pending>();

const BUILD_TIMEOUT_MS = 12 * 60_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
// Archiving, signing and the upload to Apple can each take many minutes, and before that the worker
// may wait a quarter of an hour for the person to create the app in App Store Connect.
const PUBLISH_TIMEOUT_MS = 60 * 60_000;

const listeners = new Set<() => void>();

/** Calls back whenever a worker connects, announces itself or leaves. */
export function onChange(listener: () => void): void {
  listeners.add(listener);
}

function changed(): void {
  for (const listener of listeners) listener();
}

export class WorkerUnavailable extends Error {}

/** Workers that can build and run previews. */
export function workerCount(): number {
  return [...workers].filter((w) => w.ready && w.canPreview).length;
}

/** The worker for an upload to the operator's account, or to a person's own account. */
function publisher(target: 'own' | 'operator'): Worker | undefined {
  return [...workers].find((w) => w.ready && (target === 'own' ? w.publishesForUsers : w.hasOwnAccount));
}

export function canPublish(target: 'own' | 'operator'): boolean {
  return publisher(target) !== undefined;
}

function toWorker(w: Worker, msg: ServerToWorker): void {
  if (w.ws.readyState === w.ws.OPEN) w.ws.send(JSON.stringify(msg));
}

/** A project sticks to the worker that holds its simulator; new projects go to the least busy worker. */
function pick(projectId: string): Worker {
  const current = assignment.get(projectId);
  if (current && workers.has(current)) return current;
  const ready = [...workers].filter((w) => w.ready && w.canPreview);
  if (ready.length === 0) throw new WorkerUnavailable('no worker connected');
  const chosen = ready.reduce((a, b) => (b.projects.size < a.projects.size ? b : a));
  assignment.set(projectId, chosen);
  chosen.projects.add(projectId);
  return chosen;
}

function request(
  worker: Worker,
  msg: ServerToWorker & { jobId: string },
  timeoutMs: number,
  onProgress?: (stage: string) => void,
): Promise<WorkerToServer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(msg.jobId);
      reject(new Error('worker timed out'));
    }, timeoutMs);
    pending.set(msg.jobId, { worker, resolve, reject, onProgress, timer });
    toWorker(worker, msg);
  });
}

export async function build(
  project: { id: string; name: string; bundleId: string },
  files: Record<string, string>,
  onProgress: (stage: BuildStage) => void,
): Promise<BuildResult> {
  const worker = pick(project.id);
  const res = await request(
    worker,
    {
      type: 'build',
      jobId: randomId(16),
      projectId: project.id,
      appName: project.name,
      bundleId: project.bundleId,
      files,
    },
    BUILD_TIMEOUT_MS,
    onProgress as (stage: string) => void,
  );
  if (res.type !== 'build.result') throw new Error('unexpected worker reply');
  if (res.ok) setPreview(project.id, { canInput: worker.canInput });
  return { ok: res.ok, errors: res.errors };
}

/**
 * Uploads the project to TestFlight: with `account` to that person's own developer account, without
 * it to the operator's. The upload is built from the files alone and needs no simulator, so it can
 * run on a separate, locked-down machine (a worker started with PREVIEWS=0).
 */
export async function publish(
  project: { id: string; name: string; bundleId: string },
  files: Record<string, string>,
  buildNumber: string,
  account: AppleAccount | undefined,
  onProgress: (stage: PublishStage) => void,
): Promise<{ ok: boolean; error?: PublishError; detail?: string; tester?: PublishTester }> {
  const worker = publisher(account ? 'own' : 'operator');
  if (!worker) throw new WorkerUnavailable('no publishing worker connected');
  const res = await request(
    worker,
    {
      type: 'publish',
      jobId: randomId(16),
      projectId: project.id,
      appName: project.name,
      bundleId: project.bundleId,
      buildNumber,
      files,
      account,
    },
    PUBLISH_TIMEOUT_MS,
    onProgress as (stage: string) => void,
  );
  if (res.type !== 'publish.result') throw new Error('unexpected worker reply');
  return { ok: res.ok, error: res.error, detail: res.detail, tester: res.tester };
}

export async function screenshot(projectId: string): Promise<{ mime: string; data: string } | null> {
  const worker = assignment.get(projectId);
  if (!worker || worker.mock) return null;
  const res = await request(worker, { type: 'screenshot', jobId: randomId(16), projectId }, SCREENSHOT_TIMEOUT_MS);
  if (res.type !== 'screenshot.result' || !res.ok || !res.mime || !res.data) return null;
  return { mime: res.mime, data: res.data };
}

export function sendInput(projectId: string, event: InputEvent): void {
  const worker = assignment.get(projectId);
  if (worker?.canInput) toWorker(worker, { type: 'input', projectId, event });
}

export function setViewers(projectId: string, count: number): void {
  const worker = assignment.get(projectId);
  if (worker) toWorker(worker, { type: 'viewers', projectId, count });
}

export function release(projectId: string): void {
  const worker = assignment.get(projectId);
  if (worker) toWorker(worker, { type: 'release', projectId });
}

function unassign(projectId: string): void {
  const worker = assignment.get(projectId);
  if (!worker) return;
  worker.projects.delete(projectId);
  assignment.delete(projectId);
  clearFrame(projectId);
  setPreview(projectId, { status: workerCount() > 0 ? 'idle' : 'unavailable' });
}

export function attachWorker(ws: WebSocket): void {
  keepAlive(ws);
  const worker: Worker = {
    ws,
    name: 'worker',
    mock: false,
    canInput: false,
    canPreview: true,
    hasOwnAccount: false,
    publishesForUsers: false,
    ready: false,
    projects: new Set(),
  };
  workers.add(worker);

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const frame = decodeFrame(data as Buffer);
      // Only accept frames for projects this worker actually holds.
      if (frame && assignment.get(frame.projectId) === worker) {
        sendFrame(frame.projectId, Buffer.from(frame.image));
      }
      return;
    }
    let msg: WorkerToServer;
    try {
      msg = JSON.parse(String(data)) as WorkerToServer;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'hello':
        worker.name = String(msg.name).slice(0, 80);
        worker.mock = Boolean(msg.mock);
        worker.canInput = Boolean(msg.canInput);
        worker.canPreview = msg.canPreview !== false;
        // Older workers only say canPublish, and mean their own account by it.
        worker.hasOwnAccount = Boolean(msg.hasOwnAccount ?? msg.canPublish);
        worker.publishesForUsers = Boolean(msg.publishesForUsers);
        worker.ready = true;
        if (worker.canPreview) workersChanged(true);
        changed();
        console.log(
          `[workers] ${worker.name} connected (${msg.info}; previews: ${worker.canPreview ? 'yes' : 'no'}; input: ${worker.canInput ? 'yes' : 'no'}; ` +
            `testflight: ${[worker.hasOwnAccount && 'own account', worker.publishesForUsers && "people's accounts"].filter(Boolean).join(' + ') || 'no'})`,
        );
        break;
      case 'build.progress':
      case 'publish.progress': {
        const p = pending.get(msg.jobId);
        if (p?.worker === worker) p.onProgress?.(msg.stage);
        break;
      }
      case 'build.result':
      case 'publish.result':
      case 'screenshot.result': {
        const p = pending.get(msg.jobId);
        if (!p || p.worker !== worker) break;
        clearTimeout(p.timer);
        pending.delete(msg.jobId);
        p.resolve(msg);
        break;
      }
      case 'stream.info':
        if (assignment.get(msg.projectId) === worker) setPreview(msg.projectId, { mime: String(msg.mime) });
        break;
      case 'sim.stopped':
        if (assignment.get(msg.projectId) === worker) unassign(msg.projectId);
        break;
    }
  });

  ws.on('close', () => {
    workers.delete(worker);
    console.log(`[workers] ${worker.name} disconnected`);
    for (const [jobId, p] of pending) {
      if (p.worker !== worker) continue;
      clearTimeout(p.timer);
      pending.delete(jobId);
      p.reject(new WorkerUnavailable('worker disconnected'));
    }
    for (const projectId of [...worker.projects]) unassign(projectId);
    if (workerCount() === 0) workersChanged(false);
    changed();
  });

  ws.on('error', () => ws.close());
}

/** True when the project currently has a simulator on some worker. */
export function hasSimulator(projectId: string): boolean {
  return assignment.has(projectId) && live(projectId).preview.status === 'running';
}
