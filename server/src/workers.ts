// Registry of connected Mac build workers, and the request/response plumbing towards them.
import type { WebSocket } from 'ws';
import {
  decodeFrame,
  type BuildStage,
  type InputEvent,
  type ServerToWorker,
  type WorkerToServer,
} from '../../shared/protocol';
import { randomId } from './db';
import { clearFrame, live, sendFrame, setPreview, workersChanged } from './live';

interface Worker {
  ws: WebSocket;
  name: string;
  mock: boolean;
  canInput: boolean;
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
  onProgress?: (stage: BuildStage) => void;
  timer: NodeJS.Timeout;
}

const workers = new Set<Worker>();
const assignment = new Map<string, Worker>();
const pending = new Map<string, Pending>();

const BUILD_TIMEOUT_MS = 12 * 60_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;

export class WorkerUnavailable extends Error {}

export function workerCount(): number {
  return [...workers].filter((w) => w.ready).length;
}

function toWorker(w: Worker, msg: ServerToWorker): void {
  if (w.ws.readyState === w.ws.OPEN) w.ws.send(JSON.stringify(msg));
}

/** A project sticks to the worker that holds its simulator; new projects go to the least busy worker. */
function pick(projectId: string): Worker {
  const current = assignment.get(projectId);
  if (current && workers.has(current)) return current;
  const ready = [...workers].filter((w) => w.ready);
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
  onProgress?: (stage: BuildStage) => void,
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
    onProgress,
  );
  if (res.type !== 'build.result') throw new Error('unexpected worker reply');
  if (res.ok) setPreview(project.id, { canInput: worker.canInput });
  return { ok: res.ok, errors: res.errors };
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
  const worker: Worker = { ws, name: 'worker', mock: false, canInput: false, ready: false, projects: new Set() };
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
        worker.ready = true;
        workersChanged(true);
        console.log(`[workers] ${worker.name} connected (${msg.info}; input: ${worker.canInput ? 'yes' : 'no'})`);
        break;
      case 'build.progress':
        pending.get(msg.jobId)?.onProgress?.(msg.stage);
        break;
      case 'build.result':
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
  });

  ws.on('error', () => ws.close());
}

/** True when the project currently has a simulator on some worker. */
export function hasSimulator(projectId: string): boolean {
  return assignment.has(projectId) && live(projectId).preview.status === 'running';
}
