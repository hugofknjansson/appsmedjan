// In-memory live state per project: connected browsers, the run in progress, and the simulator preview.
import type { WebSocket } from 'ws';
import { frameKind, type Part, type PreviewState, type ServerToClient, type Step } from '../../shared/protocol';

export interface Live {
  clients: Set<WebSocket>;
  running: boolean;
  /** Parts of the assistant message being produced right now. */
  parts: Part[];
  preview: PreviewState;
  /** The latest still picture, for someone who starts watching while the screen comes as those. */
  lastFrame: Buffer | null;
  /**
   * While the screen comes as video: the latest whole picture and every picture since. Played to
   * someone who starts watching, it brings them level with everyone else at once.
   */
  recent: Buffer[];
  recentBytes: number;
  abort: AbortController | null;
  releaseTimer: NodeJS.Timeout | null;
}

const lives = new Map<string, Live>();

/** What is known about one viewer's way of taking the stream. */
interface Viewer {
  /** True when it said it can show video. */
  video: boolean;
  /** True when the next thing it can use is a whole picture: it has just come, or it missed one. */
  needsKey: boolean;
}

const viewers = new WeakMap<WebSocket, Viewer>();

export function addViewer(projectId: string, ws: WebSocket, video: boolean): void {
  viewers.set(ws, { video, needsKey: true });
  live(projectId).clients.add(ws);
}

/** True when everyone watching can show video, so the screen may be sent as that. */
export function everyoneTakesVideo(projectId: string): boolean {
  const l = lives.get(projectId);
  if (!l || l.clients.size === 0) return false;
  for (const c of l.clients) if (!viewers.get(c)?.video) return false;
  return true;
}

export function live(projectId: string): Live {
  let l = lives.get(projectId);
  if (!l) {
    l = {
      clients: new Set(),
      running: false,
      parts: [],
      preview: { status: 'idle', mime: 'image/jpeg', canInput: false },
      lastFrame: null,
      recent: [],
      recentBytes: 0,
      abort: null,
      releaseTimer: null,
    };
    lives.set(projectId, l);
  }
  return l;
}

/** Projects that have live state right now (someone has them open, or had recently). */
export function liveProjectIds(): string[] {
  return [...lives.keys()];
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

/** Brings someone who has just started watching up to what the screen shows now. */
export function sendLatestPicture(projectId: string, ws: WebSocket): void {
  const l = lives.get(projectId);
  const viewer = viewers.get(ws);
  if (!l || !viewer) return;
  if (l.recent.length > 0) {
    // Video is of no use to a viewer that only shows still pictures; its JPEG frames are on their way.
    if (!viewer.video) return;
    for (const frame of l.recent) ws.send(frame, { binary: true });
    viewer.needsKey = false;
  } else if (l.lastFrame) {
    ws.send(l.lastFrame, { binary: true });
  }
}

/** Frames are dropped for clients that can't keep up, so a slow connection never builds a backlog. */
const MAX_BUFFERED = 1_500_000;
/** More video than this since the last whole picture is not kept for newcomers; they wait for the next one. */
const MAX_RECENT = 8_000_000;

/** Sends a frame of the stream to everyone watching, and keeps what a newcomer will need. */
export function sendFrame(projectId: string, frame: Buffer): void {
  const l = lives.get(projectId);
  if (!l) return;
  const kind = frameKind(frame);
  if (kind === 'still') {
    l.lastFrame = frame;
    l.recent = [];
    l.recentBytes = 0;
    for (const c of l.clients) {
      if (c.readyState === c.OPEN && c.bufferedAmount < MAX_BUFFERED) c.send(frame, { binary: true });
    }
    return;
  }
  l.lastFrame = null;
  if (kind === 'key') {
    l.recent = [frame];
    l.recentBytes = frame.length;
  } else if (l.recent.length > 0) {
    l.recent.push(frame);
    l.recentBytes += frame.length;
    if (l.recentBytes > MAX_RECENT) {
      l.recent = [];
      l.recentBytes = 0;
    }
  }
  for (const c of l.clients) {
    const viewer = viewers.get(c);
    if (c.readyState !== c.OPEN || !viewer?.video) continue;
    if (c.bufferedAmount >= MAX_BUFFERED) {
      // A picture of the video that is not sent makes the ones after it useless: nothing more
      // goes to this viewer until the next whole picture, which comes every few seconds.
      viewer.needsKey = true;
      continue;
    }
    if (kind === 'key') viewer.needsKey = false;
    if (!viewer.needsKey) c.send(frame, { binary: true });
  }
}

export function clearFrame(projectId: string): void {
  const l = lives.get(projectId);
  if (!l) return;
  l.lastFrame = null;
  l.recent = [];
  l.recentBytes = 0;
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
