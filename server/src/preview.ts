// Builds a project on a Mac worker and keeps the preview state in sync.
import { config } from './config';
import * as db from './db';
import { everyoneTakesVideo, live, setPreview, someoneNeedsLight } from './live';
import * as workers from './workers';

export type BuildOutcome =
  | { kind: 'ok' }
  | { kind: 'errors'; errors: string }
  | { kind: 'unavailable' };

const chains = new Map<string, Promise<unknown>>();

/** Builds run one at a time per project; a second request waits for the first. */
export function buildProject(projectId: string): Promise<BuildOutcome> {
  const previous = chains.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => doBuild(projectId));
  chains.set(projectId, next);
  void next.finally(() => {
    if (chains.get(projectId) === next) chains.delete(projectId);
  });
  return next;
}

async function doBuild(projectId: string): Promise<BuildOutcome> {
  const project = db.getProject(projectId);
  if (!project) return { kind: 'unavailable' };
  if (workers.workerCount() === 0) {
    setPreview(projectId, { status: 'unavailable' });
    return { kind: 'unavailable' };
  }
  setPreview(projectId, { status: 'building', stage: 'queued' });
  try {
    const result = await workers.build(project, db.getFiles(projectId), (stage) =>
      setPreview(projectId, { status: 'building', stage }),
    );
    if (result.ok) {
      setPreview(projectId, { status: 'running' });
      syncViewers(projectId);
      return { kind: 'ok' };
    }
    setPreview(projectId, { status: 'failed' });
    return { kind: 'errors', errors: result.errors ?? 'The build failed without a readable error message.' };
  } catch (err) {
    if (err instanceof workers.WorkerUnavailable) {
      setPreview(projectId, { status: 'unavailable' });
      return { kind: 'unavailable' };
    }
    setPreview(projectId, { status: 'failed' });
    return { kind: 'errors', errors: `The build service failed: ${(err as Error).message}` };
  }
}

/** Tells the worker how many people are watching, and shuts the simulator down a while after the last one leaves. */
export function syncViewers(projectId: string): void {
  const l = live(projectId);
  l.light = someoneNeedsLight(projectId, performance.now());
  workers.setViewers(projectId, l.clients.size, everyoneTakesVideo(projectId), l.light);
  if (l.releaseTimer) {
    clearTimeout(l.releaseTimer);
    l.releaseTimer = null;
  }
  if (l.clients.size === 0) {
    l.releaseTimer = setTimeout(() => {
      l.releaseTimer = null;
      if (l.clients.size === 0 && !l.running) workers.release(projectId);
    }, config.releaseAfterMs);
  }
}
