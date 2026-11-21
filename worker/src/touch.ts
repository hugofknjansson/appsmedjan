// One open connection to a simulator for touches, so each one arrives the moment it is made.
// The connection is kept by worker/touch.py, on the Python that idb itself runs on.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InputEvent } from '../../shared/protocol';
import { exec } from './exec';

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'touch.py');
/** How long a helper that died is left alone before it is started again. */
const RESTART_AFTER_MS = 5000;

/** What the helper understands; coordinates are in the simulator's points. */
export type TouchMessage =
  | { k: 'down' | 'move' | 'up'; x: number; y: number }
  | { k: 'swipe'; x1: number; y1: number; x2: number; y2: number; duration: number }
  | { k: 'text'; text: string }
  | { k: 'key'; code: number }
  | { k: 'button'; name: 'HOME' };

/** Where the finger that is down was last put, in the simulator's points. */
export interface Held {
  x: number;
  y: number;
}

/**
 * An input event as messages for the helper, for a screen of the given size in points. A finger
 * left down by someone who went away is lifted before anything else happens, so it is never
 * dragged along to the next touch.
 */
export function touchMessages(event: InputEvent, screen: { width: number; height: number }, held: Held | null): { messages: TouchMessage[]; held: Held | null } {
  const x = (unit: number) => Math.round(unit * screen.width);
  const y = (unit: number) => Math.round(unit * screen.height);
  const lift: TouchMessage[] = held ? [{ k: 'up', ...held }] : [];
  switch (event.kind) {
    case 'touch': {
      const at = { x: x(event.x), y: y(event.y) };
      if (event.phase === 'down') return { messages: [...lift, { k: 'down', ...at }], held: at };
      // A finger that moves without having been put down has just been put down.
      if (event.phase === 'move') return { messages: [{ k: held ? 'move' : 'down', ...at }], held: at };
      return { messages: held ? [{ k: 'up', ...at }] : [], held: null };
    }
    case 'tap': {
      const at = { x: x(event.x), y: y(event.y) };
      return { messages: [...lift, { k: 'down', ...at }, { k: 'up', ...at }], held: null };
    }
    case 'swipe':
      return {
        messages: [...lift, { k: 'swipe', x1: x(event.x1), y1: y(event.y1), x2: x(event.x2), y2: y(event.y2), duration: event.durationMs / 1000 }],
        held: null,
      };
    case 'text':
      return { messages: [...lift, { k: 'text', text: event.text }], held: null };
    case 'key':
      // USB HID usage codes: 42 is Backspace, 40 is Return.
      return { messages: [...lift, { k: 'key', code: event.key === 'backspace' ? 42 : 40 }], held: null };
    case 'button':
      return { messages: [...lift, { k: 'button', name: 'HOME' }], held: null };
  }
}

/** Everything but a finger on its way: what the idb command can be asked to do. */
export type Gesture = Exclude<InputEvent, { kind: 'touch' }>;

/** A finger that went down, for turning live touches into a tap or a swipe where there is no open connection. */
export interface Finger {
  x: number;
  y: number;
  at: number;
}

/**
 * Live touches as the whole gestures the idb command understands: nothing while the finger is down,
 * and a tap or a swipe when it lifts. Other events pass through as they are.
 */
export function wholeGesture(event: InputEvent, finger: Finger | null, now: number): { finger: Finger | null; event: Gesture | null } {
  if (event.kind !== 'touch') return { finger, event };
  if (event.phase === 'down') return { finger: { x: event.x, y: event.y, at: now }, event: null };
  if (event.phase === 'move' || !finger) return { finger, event: null };
  const moved = Math.hypot(event.x - finger.x, event.y - finger.y);
  if (moved < 0.02) return { finger: null, event: { kind: 'tap', x: finger.x, y: finger.y } };
  const durationMs = Math.min(Math.max(now - finger.at, 50), 3000);
  return { finger: null, event: { kind: 'swipe', x1: finger.x, y1: finger.y, x2: event.x, y2: event.y, durationMs } };
}

/**
 * The Python that the `idb` command runs on, which is where its library is installed; null when
 * that cannot be worked out, and touches then go through the `idb` command one at a time.
 */
export async function touchPython(): Promise<string | null> {
  const where = await exec('which', ['idb']);
  if (where.code !== 0) return null;
  try {
    const first = (await fs.readFile(where.stdout.trim(), 'utf8')).split('\n', 1)[0] ?? '';
    const python = first.startsWith('#!') ? first.slice(2).trim().split(/\s+/)[0] : '';
    if (!python) return null;
    const works = await exec(python, ['-c', 'import idb.grpc.management, idb.common.hid'], { timeoutMs: 20_000 });
    return works.code === 0 ? python : null;
  } catch {
    return null;
  }
}

export class Toucher {
  private proc: ChildProcess | null = null;
  private ready = false;
  private stopped = false;
  private diedAt = 0;

  constructor(
    private readonly udid: string,
    private readonly python: string,
  ) {
    this.start();
  }

  private start(): void {
    const proc = spawn(this.python, [HELPER, this.udid], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.ready = false;
    proc.stdout?.once('data', () => {
      if (this.proc === proc) this.ready = true;
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[touch] ${text.slice(0, 300)}`);
    });
    // A helper that is gone must never take the worker with it.
    proc.stdin?.on('error', () => undefined);
    const gone = () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.ready = false;
      this.diedAt = Date.now();
    };
    proc.on('error', gone);
    proc.on('exit', gone);
  }

  /**
   * Hands the messages to the open connection.
   * - sent: they are on their way.
   * - starting: the connection is being opened, and nothing else can reach the simulator's touch
   *   screen meanwhile (it listens to one sender at a time), so the messages are dropped.
   * - gone: there is no connection; the idb command can be used instead.
   */
  send(messages: TouchMessage[]): 'sent' | 'starting' | 'gone' {
    if (this.stopped) return 'gone';
    if (!this.proc) {
      if (Date.now() - this.diedAt >= RESTART_AFTER_MS) this.start();
      return 'gone';
    }
    if (!this.ready || !this.proc.stdin?.writable) return 'starting';
    this.proc.stdin.write(messages.map((message) => JSON.stringify(message) + '\n').join(''));
    return 'sent';
  }

  stop(): void {
    this.stopped = true;
    this.proc?.stdin?.end();
    this.proc?.kill();
    this.proc = null;
  }
}
