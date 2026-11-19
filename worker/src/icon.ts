// A placeholder app icon. App Store Connect rejects uploads without one, and generated apps have no artwork yet.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(4 + body.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), 4 + body.length);
  return out;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/**
 * A square PNG with a diagonal gradient whose colors come from the seed, so each app gets its own look.
 * It has no alpha channel: App Store Connect does not accept transparent icons.
 */
export function iconPng(seed: string, size = 1024): Buffer {
  const hue = (crypto.createHash('sha256').update(seed).digest().readUInt16BE(0) / 65536) * 360;
  const from = hsl(hue, 0.72, 0.62);
  const to = hsl((hue + 40) % 360, 0.78, 0.4);

  const stride = 1 + size * 3; // Each row starts with a filter byte (0: none).
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1) || 1);
      const at = y * stride + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[at + c] = Math.round(from[c]! + (to[c]! - from[c]!) * t);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // Bits per channel.
  header[9] = 2; // Color type: RGB without alpha.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
