// In-memory live state per project: connected browsers, the run in progress, and the simulator preview.
import type { WebSocket } from 'ws';
import { frameKind, type Part, type PreviewState, type ServerToClient, type Step } from '../../shared/protocol';
import { config } from './config';

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
  /** True when the worker was last told that someone watching needs a lighter picture. */
  light: boolean;
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
  /** The phone it is, when it is one and said so: "iPhone19,2". */
  device: string | null;
  /** When it was asked for the sign of life it has not given yet; null when it has given them all. */
  askedAt: number | null;
  /** True while its answer is so late that pictures sent now would be old before they were shown. */
  behind: boolean;
  /** How many times it has fallen behind, and when it last did. */
  fellBehind: number;
  fellBehindAt: number;
  /** Until when it is to be sent a lighter picture; 0 when it never needed one. */
  lightUntil: number;
  /** How long its answers took, in milliseconds: the way there and back, and any wait in between. */
  delays: number[];
}

const viewers = new WeakMap<WebSocket, Viewer>();

/** What a viewer is asked with; its connection answers with the same, by itself. */
const SIGN = Buffer.from('delay');
/** How often each viewer is asked for a sign of life. How long the answer takes is how far behind it is. */
export const ASK_EVERY_MS = 1000;
/** An answer slower than this means the viewer is behind, and video is held back until it is level again. */
const BEHIND_MS = 1000;
/**
 * Falling behind twice within this time is not a hiccup: the connection needs a lighter picture.
 * (Once is what a phone does when its owner looks at something else for a moment.)
 */
const TWICE_WITHIN_MS = 90_000;
/** How long the lighter picture is kept before the full one is tried again. */
const LIGHT_FOR_MS = 5 * 60_000;
/** No more delays than this are remembered for one viewer: the latest ten minutes. */
const MAX_DELAYS = 600;

export function addViewer(projectId: string, ws: WebSocket, video: boolean, device: string | null = null): void {
  viewers.set(ws, { video, needsKey: true, device, askedAt: null, behind: false, fellBehind: 0, fellBehindAt: 0, lightUntil: 0, delays: [] });
  live(projectId).clients.add(ws);
  // Not there on what stands in for a connection in the tests.
  ws.on?.('pong', (data: Buffer) => {
    if (SIGN.equals(data)) viewerAnswered(projectId, ws, performance.now());
  });
}

/**
 * Asks everyone watching for a sign of life, and notes who has not given the last one in time.
 * The question travels behind the pictures already sent, so the answer is late by exactly as much
 * as the pictures are. Returns the projects where the need for a lighter picture has changed, for
 * the worker to be told.
 */
export function askViewers(now: number): string[] {
  const changed: string[] = [];
  for (const [projectId, l] of lives) {
    // Only while there is a screen to be behind on.
    if (l.recent.length === 0 && !l.lastFrame) continue;
    for (const c of l.clients) {
      const viewer = viewers.get(c);
      if (!viewer || c.readyState !== c.OPEN) continue;
      if (viewer.askedAt === null) {
        viewer.askedAt = now;
        c.ping(SIGN);
      } else if (!viewer.behind && now - viewer.askedAt > BEHIND_MS) {
        viewer.behind = true;
        if (viewer.fellBehind > 0 && now - viewer.fellBehindAt <= TWICE_WITHIN_MS) viewer.lightUntil = now + LIGHT_FOR_MS;
        viewer.fellBehind++;
        viewer.fellBehindAt = now;
      }
    }
    if (someoneNeedsLight(projectId, now) !== l.light) changed.push(projectId);
  }
  return changed;
}

/** A viewer's sign of life has come: everything sent before the question has reached it too. */
export function viewerAnswered(projectId: string, ws: WebSocket, now: number): void {
  const viewer = viewers.get(ws);
  if (!viewer || viewer.askedAt === null) return;
  viewer.delays.push(Math.round(now - viewer.askedAt));
  if (viewer.delays.length > MAX_DELAYS) viewer.delays.shift();
  viewer.askedAt = null;
  viewer.behind = false;
  // Level again. If it missed pictures on the way, they are played to it at once when they are
  // few; otherwise it waits for the next whole picture, like anyone who missed one.
  const l = lives.get(projectId);
  if (!l || !viewer.video || !viewer.needsKey || l.recent.length === 0 || ws.readyState !== ws.OPEN) return;
  if (l.recentBytes + ws.bufferedAmount > CATCH_UP_BYTES) return;
  for (const frame of l.recent) ws.send(frame, { binary: true });
  viewer.needsKey = false;
}

/** True when someone watching is on a connection that keeps falling behind, so the picture should be a lighter one. */
export function someoneNeedsLight(projectId: string, now: number): boolean {
  for (const c of lives.get(projectId)?.clients ?? []) {
    if ((viewers.get(c)?.lightUntil ?? 0) > now) return true;
  }
  return false;
}

/** What a viewer's delay was like while it watched, for the log; null when it was asked too few times to say. */
export function delaySummary(ws: WebSocket): string | null {
  const viewer = viewers.get(ws);
  if (!viewer || viewer.delays.length < 5) return null;
  const sorted = [...viewer.delays].sort((a, b) => a - b);
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
  return `delay there and back ${at(0.5)} ms in the middle, ${at(0.9)} ms for nine in ten, ${sorted.at(-1)} ms at worst, over ${sorted.length} s; fell behind ${viewer.fellBehind} times`;
}

/** The phone the app is being watched on, when someone is watching on one: the simulator can then be the same model. */
export function watchedOn(projectId: string): string | null {
  for (const c of lives.get(projectId)?.clients ?? []) {
    const device = viewers.get(c)?.device;
    if (device) return device;
  }
  return null;
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
      preview: { status: 'idle', mime: 'image/jpeg', canInput: false, ...(config.predictFinger ? {} : { predictFinger: false }) },
      lastFrame: null,
      recent: [],
      recentBytes: 0,
      light: false,
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
/**
 * The same for video, where a backlog is not one late picture but all of them late from then on.
 * This is a second or so of a screen that is being scrolled.
 */
const MAX_BUFFERED_VIDEO = 500_000;
/** A viewer that is level again is played what it missed when that is no more than this; more would put it behind again. */
const CATCH_UP_BYTES = 300_000;
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
    if (viewer.behind || c.bufferedAmount >= MAX_BUFFERED_VIDEO) {
      // A picture of the video that is not sent makes the ones after it useless: nothing more
      // goes to this viewer until it is level again, or until the next whole picture, which comes
      // every few seconds.
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
