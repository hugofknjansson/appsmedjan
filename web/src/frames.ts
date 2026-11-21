// What the simulator's screen arrives as, made ready to draw: a still picture as it is, video
// decoded picture by picture with the browser's own decoder.
import { frameKind } from '../../shared/protocol';

/** A picture to show: the bytes of a still one, or one decoded from the video. */
export type Picture = { kind: 'still'; data: ArrayBuffer } | { kind: 'video'; frame: VideoFrame };

type Listener = (picture: Picture | null) => void;

/** The codec the video says it is, read from the settings in front of a key picture: "avc1." and three bytes in hex. */
export function codecOf(key: Uint8Array): string | null {
  for (let at = 0; at + 7 < key.length && at < 512; at++) {
    if (key[at] === 0 && key[at + 1] === 0 && key[at + 2] === 0 && key[at + 3] === 1 && (key[at + 4]! & 0x1f) === 7) {
      return 'avc1.' + [key[at + 5]!, key[at + 6]!, key[at + 7]!].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  }
  return null;
}

/**
 * Delivers the stream straight to whatever draws it, so sixty pictures a second don't re-render
 * the page. It decodes whether or not anything is drawing, so that the latest picture is at hand
 * the moment something starts to.
 */
export class FrameBus {
  private listener: Listener | null = null;
  private last: Picture | null = null;
  private decoder: VideoDecoder | null = null;
  private codec = '';
  /** True until a key picture has been given to the decoder: nothing before it can be decoded. */
  private waitingForKey = true;
  /** True once video has turned out not to work in this browser; still pictures are asked for from then on. */
  private videoFailed = false;
  /** Called when video stops working here, so that the stream can be asked for as still pictures. */
  onVideoFailure: (() => void) | null = null;

  /** True when this browser can be sent video. */
  get takesVideo(): boolean {
    return !this.videoFailed && typeof VideoDecoder === 'function' && typeof EncodedVideoChunk === 'function';
  }

  push(frame: ArrayBuffer | null): void {
    if (!frame) {
      this.show(null);
      this.waitingForKey = true;
      return;
    }
    const bytes = new Uint8Array(frame);
    const kind = frameKind(bytes);
    if (kind === 'still') {
      this.waitingForKey = true;
      this.show({ kind: 'still', data: frame });
    } else if (this.takesVideo) {
      this.decode(bytes, kind);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listener = listener;
    if (this.last) listener(this.last);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  /** Lets go of the decoder and the picture it holds. */
  close(): void {
    this.show(null);
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
  }

  private show(picture: Picture | null): void {
    // A decoded picture holds memory in the graphics card until it is closed.
    if (this.last?.kind === 'video') this.last.frame.close();
    this.last = picture;
    this.listener?.(picture);
  }

  private decode(bytes: Uint8Array, kind: 'key' | 'delta'): void {
    try {
      if (kind === 'key') {
        const codec = codecOf(bytes);
        if (!codec) return;
        if (!this.decoder || this.decoder.state === 'closed' || codec !== this.codec) {
          if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
          this.decoder = new VideoDecoder({
            output: (frame) => this.show({ kind: 'video', frame }),
            error: () => this.giveUpOnVideo(),
          });
          // No description: the video carries its settings itself, with start codes between its units.
          this.decoder.configure({ codec, optimizeForLatency: true });
          this.codec = codec;
        }
        this.waitingForKey = false;
      } else if (this.waitingForKey || !this.decoder || this.decoder.state !== 'configured') {
        return;
      }
      this.decoder!.decode(new EncodedVideoChunk({ type: kind, timestamp: Math.round(performance.now() * 1000), data: bytes }));
    } catch {
      this.giveUpOnVideo();
    }
  }

  private giveUpOnVideo(): void {
    if (this.videoFailed) return;
    this.videoFailed = true;
    this.waitingForKey = true;
    this.onVideoFailure?.();
  }
}
