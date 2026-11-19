// In-memory live state per project: connected browsers, the run in progress, and the simulator preview.
import type { WebSocket } from 'ws';
import type { Part, PreviewState, ServerToClient, Step } from '../../shared/protocol';

export interface Live {
  clients: Set<WebSocket>;
  running: boolean;
  /** Parts of the assistant message being produced right now. */
  parts: Part[];
  preview: PreviewState;
  lastFrame: Buffer | null;
  abort: AbortController | null;
  releaseTimer: NodeJS.Timeout | null;
}

const lives = new Map<string, Live>();

export function live(projectId: string): Live {
  let l = lives.get(projectId);
  if (!l) {
    l = {
      clients: new Set(),
      running: false,
      parts: [],
      preview: { status: 'idle', mime: 'image/jpeg', canInput: false },
      lastFrame: null,
      abort: null,
      releaseTimer: null,
    };
    lives.set(projectId, l);
  }
  return l;
}

export function forget(projectId: string): void {
  const l = lives.get(projectId);
  if (!l) return;
  if (l.releaseTimer) clearTimeout(l.releaseTimer);
  for (const c of l.clients) c.close();
  lives.delete(projectId);
}

export function send(projectId: string, event: ServerToClient): void {
  const l = lives.get(projectId);
  if (!l || l.clients.size === 0) return;
  const data = JSON.stringify(event);
  for (const c of l.clients) if (c.readyState === c.OPEN) c.send(data);
}

/** Frames are dropped for clients that can't keep up, so a slow connection never builds a backlog. */
const MAX_BUFFERED = 1_500_000;

export function sendFrame(projectId: string, frame: Buffer): void {
  const l = lives.get(projectId);
  if (!l) return;
  l.lastFrame = frame;
  for (const c of l.clients) {
    if (c.readyState === c.OPEN && c.bufferedAmount < MAX_BUFFERED) c.send(frame, { binary: true });
  }
}

export function clearFrame(projectId: string): void {
  const l = lives.get(projectId);
  if (!l) return;
  l.lastFrame = null;
  send(projectId, { type: 'frame.clear' });
}

export function setPreview(projectId: string, patch: Partial<PreviewState>): void {
  const l = live(projectId);
  l.preview = { ...l.preview, ...patch };
  if (patch.status && patch.status !== 'building') delete l.preview.stage;
  send(projectId, { type: 'preview', preview: l.preview });
}

// --- Parts of the message in progress ----------------------------------------

export function appendText(projectId: string, delta: string): void {
  const l = live(projectId);
  const last = l.parts[l.parts.length - 1];
  if (last?.t === 'text') last.text += delta;
  else l.parts.push({ t: 'text', text: delta });
  send(projectId, { type: 'text.delta', delta });
}

export function addPart(projectId: string, part: Part): void {
  live(projectId).parts.push(part);
  send(projectId, { type: 'part', part });
}

/** Adds the step, or updates it in place when a step with the same id is already there. */
export function upsertStep(projectId: string, step: Step): void {
  const l = live(projectId);
  const existing = l.parts.find((p) => p.t === 'step' && p.step.id === step.id);
  if (existing && existing.t === 'step') existing.step = step;
  else l.parts.push({ t: 'step', step });
  send(projectId, { type: 'step', step });
}

/** Called when the set of build workers changes, so previews waiting for a worker (or left without one) follow along. */
export function workersChanged(available: boolean): void {
  for (const [projectId, l] of lives) {
    if (available && l.preview.status === 'unavailable') setPreview(projectId, { status: 'idle' });
    if (!available && l.preview.status === 'idle') setPreview(projectId, { status: 'unavailable' });
  }
}
