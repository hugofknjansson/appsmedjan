// Starts and stops agent runs for a project and persists their results.
import { runAgent } from './agent';
import * as db from './db';
import * as direct from './direct';
import { ensureIcon } from './icon';
import { live, send } from './live';
import { syncViewers } from './preview';

export function isRunning(projectId: string): boolean {
  return live(projectId).running;
}

/** Saves the user's message and starts the agent in the background. Returns false if a run is already going. */
export function startRun(projectId: string, userText: string): boolean {
  const l = live(projectId);
  if (l.running) return false;

  const history = db.listMessages(projectId);
  const userMessage = db.addMessage(projectId, 'user', userText, []);
  send(projectId, { type: 'message', message: userMessage });

  l.running = true;
  l.parts = [];
  l.abort = new AbortController();
  send(projectId, { type: 'run.start' });

  void runAgent(projectId, history, userText, l.abort.signal)
    .catch(() => undefined) // The failure is already recorded as an error part.
    .finally(() => {
      // Nothing is left spinning once the run is over.
      const parts = l.parts.map((p) =>
        p.t === 'step' && p.step.status === 'running' ? { ...p, step: { ...p.step, status: 'error' as const } } : p,
      );
      l.running = false;
      l.parts = [];
      l.abort = null;
      // The project may have been deleted while the agent was working.
      if (db.getProject(projectId)) {
        const message = db.addMessage(projectId, 'assistant', '', parts);
        send(projectId, { type: 'message', message });
      }
      send(projectId, { type: 'run.end' });
      syncViewers(projectId);
      // An app the builder did not draw an icon for gets the stand-in, before anything is built for a phone.
      try {
        ensureIcon(projectId);
      } catch (err) {
        console.warn(`[icon] ${projectId}: no stand-in icon (${(err as Error).message})`);
      }
      // The new version is made ready for the person's own phone, where they try it.
      direct.buildAfterRun(projectId);
    });
  return true;
}

export function stopRun(projectId: string): void {
  live(projectId).abort?.abort();
}
