// A zip file from texts, for the source a person downloads. Only what that takes: deflated entries
// with UTF-8 names, no folders of their own, no zip64.
import zlib from 'node:zlib';

/** DOS time and date, which is what a zip keeps. */
function dosStamp(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(files: Record<string, string>, now = new Date()): Uint8Array {
  const { time, day } = dosStamp(now);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);

    // Shared by both headers: version 2.0, UTF-8 names (bit 11), deflate.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x0800, 2);
    common.writeUInt16LE(8, 4);
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(day, 8);
    common.writeUInt32LE(crc, 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(raw.length, 18);
    common.writeUInt16LE(nameBytes.length, 22);
    common.writeUInt16LE(0, 24);

    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), common, nameBytes, packed]);
    locals.push(local);

    const tail = Buffer.alloc(14);
    // Comment length, disk and internal attributes stay zero.
    tail.writeUInt32LE(0o100644 << 16 >>> 0, 6); // an ordinary file, for unzip on a Mac
    tail.writeUInt32LE(offset, 10);
    // Version made by: 3 (Unix) in the high byte, so the permissions above are read.
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 3]), common, tail, nameBytes]));
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
