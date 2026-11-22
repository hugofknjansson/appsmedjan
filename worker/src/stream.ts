// Streams a simulator's screen, as video or as JPEG frames.
// Best: H.264, up to sixty pictures a second, through worker/video.py, for viewers that can show video.
// Otherwise: `idb video-stream` as MJPEG. Last resort: polling `simctl io screenshot`.
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameKind } from '../../shared/protocol';
import { exec } from './exec';

/**
 * How long the video stream gets to deliver its first frame. On a simulator that has just been
 * created, idb needs about 7 seconds on an M4; a slower or busier Mac needs more. Falling back too
 * early leaves the whole session on screenshots.
 */
const FIRST_FRAME_TIMEOUT_MS = 20_000;

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

const START = Buffer.from([0, 0, 0, 1]);
/** How much smaller each way the lighter video is. */
const LIGHT_SCALE = 0.5;
const VIDEO_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'video.py');

/** Reads pieces written with their length in front of them (four bytes, big-endian), as worker/video.py writes them. */
export class PieceReader {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const pieces: Buffer[] = [];
    while (this.buf.length >= 4) {
      const length = this.buf.readUInt32BE(0);
      // A piece should never be this big; what follows cannot be trusted, so it is dropped.
      if (length > 16 * 1024 * 1024) {
        this.buf = Buffer.alloc(0);
        break;
      }
      if (this.buf.length < 4 + length) break;
      pieces.push(Buffer.from(this.buf.subarray(4, 4 + length)));
      this.buf = this.buf.subarray(4 + length);
    }
    return pieces;
  }
}

/**
 * Gathers pieces of H.264 (whole units, each behind its start code) into pictures: each one with
 * the units that belong in front of it, which for a key picture are the settings. A picture is
 * handed over the moment its own data has come, without waiting for the next one to start.
 */
export class PictureGatherer {
  /** Units read so far that belong to the picture being gathered. */
  private pending: Buffer[] = [];

  push(piece: Buffer): Buffer[] {
    const pictures: Buffer[] = [];
    let from = piece.indexOf(START);
    while (from >= 0) {
      const next = piece.indexOf(START, from + 4);
      const unit = piece.subarray(from, next < 0 ? piece.length : next);
      if (unit.length > 4) {
        this.pending.push(unit);
        const type = unit[4]! & 0x1f;
        // A picture's data (1: a delta, 5: a whole one) ends the picture; everything else leads up to one.
        if (type === 1 || type === 5) {
          pictures.push(Buffer.concat(this.pending));
          this.pending = [];
        }
      }
      from = next;
    }
    return pictures;
  }
}

/** How the screen is sent while idb can stream it. */
export type StreamFormat = 'h264' | 'mjpeg';

export class Streamer {
  private active = false;
  private mode: 'idb' | 'poll';
  private proc: ChildProcess | null = null;
  private polling = false;
  private lastHash = '';
  private watchdog: NodeJS.Timeout | null = null;
  private readonly tmp: string;
  /** What viewers can take, and what is being sent: video falls back to JPEG frames if idb cannot give it. */
  private wanted: StreamFormat = 'mjpeg';
  private videoWorks: boolean;
  /** True after a picture of the video could not be sent on: what follows is useless until a whole one comes. */
  private waitingForKey = false;
  /** True while the video is a lighter one, for a viewer whose connection keeps falling behind. */
  private light = false;

  /**
   * `onFrame` says whether the frame could be sent on. `onFormat` is told what the frames are
   * whenever that changes. `python` is the Python that idb's library is installed for, which is
   * what video needs; without it the screen is only ever sent as JPEG frames.
   */
  constructor(
    private readonly udid: string,
    useIdb: boolean,
    private readonly onFrame: (frame: Buffer) => boolean,
    private readonly onFormat: (format: StreamFormat) => void = () => undefined,
    private readonly python: string | null = null,
  ) {
    this.videoWorks = python !== null;
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

  /** What is being sent right now. */
  get format(): StreamFormat {
    return this.wanted === 'h264' && this.videoWorks && this.mode === 'idb' ? 'h264' : 'mjpeg';
  }

  /** Video when every viewer can show it, JPEG frames otherwise. */
  setFormat(wanted: StreamFormat): void {
    const before = this.format;
    this.wanted = wanted;
    if (this.format === before) return;
    this.onFormat(this.format);
    if (this.active && this.mode === 'idb') this.restartIdb();
  }

  /**
   * A lighter video or the full one. The lighter one is half the size each way, which is a quarter
   * of the picture to send: softer to look at, and level with the finger on a connection that
   * the full one is too much for.
   */
  setLight(light: boolean): void {
    if (light === this.light) return;
    this.light = light;
    if (this.active && this.mode === 'idb' && this.format === 'h264') this.restartIdb();
  }

  /** Forces the next polled frame to be sent even if the screen has not changed. */
  refresh(): void {
    this.lastHash = '';
  }

  private restartIdb(): void {
    this.stopProcesses();
    this.startIdb();
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
    const video = this.format === 'h264';
    const proc = video
      ? spawn(this.python!, [VIDEO_HELPER, this.udid, '60', this.light ? String(LIGHT_SCALE) : '1'], { stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('idb', ['video-stream', '--udid', this.udid, '--fps', '15', '--format', 'mjpeg', '--compression-quality', '0.6'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
    this.proc = proc;
    this.waitingForKey = false;
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[video] ${text.slice(0, 300)}`);
    });
    const pieces = new PieceReader();
    const pictures = new PictureGatherer();
    const stills = new JpegSplitter();
    const framesIn = (chunk: Buffer) => (video ? pieces.push(chunk).flatMap((piece) => pictures.push(piece)) : stills.push(chunk));
    let gotFrame = false;
    proc.stdout!.on('data', (chunk: Buffer) => {
      for (const frame of framesIn(chunk)) {
        gotFrame = true;
        if (this.active && this.proc === proc) this.pass(frame, video);
      }
    });
    // Video that idb cannot give is not the end of streaming: JPEG frames are tried before screenshots.
    const failed = (reason: string) => {
      if (video) this.fallBackToFrames(reason);
      else this.fallBackToPolling(reason);
    };
    proc.on('error', () => failed('idb could not be started'));
    proc.on('exit', () => {
      if (this.proc !== proc) return; // Stopped on purpose.
      this.proc = null;
      if (!gotFrame) failed('it exited without producing frames');
      else if (this.active) setTimeout(() => this.active && this.mode === 'idb' && !this.proc && this.startIdb(), 1000);
    });
    this.watchdog = setTimeout(() => {
      if (!gotFrame && this.proc === proc) failed(`no frames within ${FIRST_FRAME_TIMEOUT_MS / 1000} seconds`);
    }, FIRST_FRAME_TIMEOUT_MS);
  }

  /**
   * Hands a frame on. A picture of the video that could not be sent makes the ones after it useless,
   * so they are skipped until the next whole one, which the video brings every few seconds by itself.
   * (Starting the video afresh would bring one sooner, but costs more than the wait.)
   */
  private pass(frame: Buffer, video: boolean): void {
    if (!video) {
      this.onFrame(frame);
      return;
    }
    if (this.waitingForKey && frameKind(frame) !== 'key') return;
    this.waitingForKey = !this.onFrame(frame);
  }

  private fallBackToFrames(reason: string): void {
    if (!this.videoWorks) return;
    console.warn(`[stream] idb cannot stream video (${reason}); sending JPEG frames instead`);
    this.videoWorks = false;
    this.onFormat(this.format);
    this.stopProcesses();
    if (this.active && this.mode === 'idb') this.startIdb();
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
