// Streams a simulator's screen as JPEG frames.
// Preferred: `idb video-stream` (continuous MJPEG). Fallback: polling `simctl io screenshot`.
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exec } from './exec';

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** Splits a byte stream of back-to-back JPEG images into individual frames. */
export class JpegSplitter {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames: Buffer[] = [];
    for (;;) {
      const start = this.buf.indexOf(SOI);
      if (start < 0) {
        // Keep a trailing 0xFF: it may be the first half of a start marker split across chunks.
        const last = this.buf.length - 1;
        this.buf = last >= 0 && this.buf[last] === 0xff ? Buffer.from(this.buf.subarray(last)) : Buffer.alloc(0);
        break;
      }
      const end = this.buf.indexOf(EOI, start + 2);
      if (end < 0) {
        if (start > 0) this.buf = this.buf.subarray(start);
        // A frame should never be this big; drop the data rather than grow without bound.
        if (this.buf.length > 16 * 1024 * 1024) this.buf = Buffer.alloc(0);
        break;
      }
      frames.push(Buffer.from(this.buf.subarray(start, end + 2)));
      this.buf = this.buf.subarray(end + 2);
    }
    return frames;
  }
}

export class Streamer {
  private active = false;
  private mode: 'idb' | 'poll';
  private proc: ChildProcess | null = null;
  private polling = false;
  private lastHash = '';
  private watchdog: NodeJS.Timeout | null = null;
  private readonly tmp: string;

  constructor(
    private readonly udid: string,
    useIdb: boolean,
    private readonly onFrame: (frame: Buffer) => void,
  ) {
    this.mode = useIdb ? 'idb' : 'poll';
    this.tmp = path.join(os.tmpdir(), `appsmedjan-${udid}.jpg`);
  }

  /** Streaming only runs while someone is watching. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) this.start();
    else this.stopProcesses();
  }

  /** Forces the next polled frame to be sent even if the screen has not changed. */
  refresh(): void {
    this.lastHash = '';
  }

  stop(): void {
    this.active = false;
    this.stopProcesses();
    void fs.rm(this.tmp, { force: true });
  }

  private start(): void {
    if (this.mode === 'idb') this.startIdb();
    else void this.pollLoop();
  }

  private stopProcesses(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }

  private fallBackToPolling(reason: string): void {
    if (this.mode === 'poll') return;
    console.warn(`[stream] idb video stream unavailable (${reason}); polling screenshots instead`);
    this.mode = 'poll';
    this.stopProcesses();
    if (this.active) void this.pollLoop();
  }

  private startIdb(): void {
    const proc = spawn(
      'idb',
      ['video-stream', '--udid', this.udid, '--fps', '15', '--format', 'mjpeg', '--compression-quality', '0.6'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    this.proc = proc;
    const splitter = new JpegSplitter();
    let gotFrame = false;
    proc.stdout!.on('data', (chunk: Buffer) => {
      for (const frame of splitter.push(chunk)) {
        gotFrame = true;
        if (this.active) this.onFrame(frame);
      }
    });
    proc.on('error', () => this.fallBackToPolling('idb could not be started'));
    proc.on('exit', () => {
      if (this.proc !== proc) return; // Stopped on purpose.
      this.proc = null;
      if (!gotFrame) this.fallBackToPolling('it exited without producing frames');
      else if (this.active) setTimeout(() => this.active && this.mode === 'idb' && !this.proc && this.startIdb(), 1000);
    });
    this.watchdog = setTimeout(() => {
      if (!gotFrame && this.proc === proc) this.fallBackToPolling('no frames within 8 seconds');
    }, 8000);
  }

  private async pollLoop(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      while (this.active && this.mode === 'poll') {
        const started = Date.now();
        const res = await exec('xcrun', ['simctl', 'io', this.udid, 'screenshot', '--type=jpeg', this.tmp], {
          timeoutMs: 15_000,
        });
        if (res.code === 0) {
          const frame = await fs.readFile(this.tmp).catch(() => null);
          if (frame) {
            const hash = crypto.createHash('md5').update(frame).digest('hex');
            if (hash !== this.lastHash) {
              this.lastHash = hash;
              if (this.active) this.onFrame(frame);
            }
          }
        }
        const wait = Math.max(0, 200 - (Date.now() - started)) + (res.code === 0 ? 0 : 1000);
        await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      this.polling = false;
    }
  }
}
