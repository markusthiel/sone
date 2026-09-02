/**
 * SONE server — writing a ZIP archive (ADR-0044).
 *
 * By hand, rather than by dependency. A ZIP is a sequence of local file headers
 * and a central directory, both fully specified and both small; the alternative
 * is a package in the supply chain of a self-hosted application whose one job is
 * to hand its own contents back. ADR-0004's dependency rule points the same way.
 *
 * Deflate through Node's own zlib, which is where the only real work is.
 *
 * What this deliberately does not do: ZIP64, encryption, or anything for
 * archives above four gigabytes. An export that large is a workspace export and
 * a background job (ADR-0044), and it will need the size fields widened when it
 * arrives. Refusing loudly is better than a truncated archive that opens.
 */

import { deflateRawSync } from 'node:zlib';

/** Above four gigabytes a ZIP needs ZIP64, which this does not write. */
export const MAX_ARCHIVE_BYTES = 0xffff_ffff;

interface Entry {
  /** The path inside the archive, forward slashes, no leading one. */
  name: string;
  body: Buffer;
  /** When the file was last touched, for the archive's own timestamps. */
  at: Date;
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffff_ffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
}

/** MS-DOS date and time, which is what a ZIP stores. Two-second resolution. */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (Math.floor(at.getSeconds() / 2) & 0x1f),
    // Years count from 1980, and a date before that cannot be represented — so
    // it is clamped rather than written as a negative year, which some readers
    // treat as corruption.
    date:
      (Math.max(0, at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * Build an archive.
 *
 * In memory, and that is the bound this accepts: a subtree of pages with their
 * attachments is megabytes, and streaming a ZIP means writing the central
 * directory last, which means either holding every entry's offset and CRC anyway
 * or seeking — neither of which a single HTTP response makes simpler. The
 * workspace-sized case is a job that writes to the file store (ADR-0044).
 */
export function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.body);
    const compressed = deflateRawSync(entry.body);
    // Stored rather than deflated when compression made it bigger, which happens
    // with small files and anything already compressed — a picture, usually.
    const deflated = compressed.length < entry.body.length;
    const body = deflated ? compressed : entry.body;
    const { time, date } = dosTime(entry.at);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0, which is deflate
    // Bit 11: the name is UTF-8. Without it a reader guesses at its own code
    // page, and a page called "Übersicht" arrives with a mangled name.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x0201_4b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(deflated ? 8 : 0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.body.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    central.push(header, name);
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  const archive = Buffer.concat([...locals, directory, end]);
  if (archive.length > MAX_ARCHIVE_BYTES) {
    // Loudly, rather than writing an archive whose size fields have wrapped.
    // Such a file often opens and is wrong, which is the worst outcome for
    // something somebody exported in order to keep.
    throw new Error('archive_too_large');
  }
  return archive;
}
