/**
 * SONE core — packing a few files into an archive, without compression.
 *
 * So the browser can turn several chosen files into one upload and send it
 * through the import route unchanged. The alternative was a multipart parser on
 * the server, which the import's own comment had argued against when a request
 * carried exactly one thing — that reasoning expires the moment it carries
 * several, but a parser is still more surface than a hundred lines of header
 * writing.
 *
 * **Stored, not deflated.** A handful of notes is kilobytes, and compression
 * would mean `CompressionStream` in the browser and `zlib` on the server —
 * two implementations of the same archive. The server keeps its deflating
 * writer for exports, where the sizes actually matter; this one exists for the
 * case where they do not.
 *
 * The CRC table and the MS-DOS timestamp are the same arithmetic as
 * `packages/server/src/export/zip.ts`, deliberately duplicated rather than
 * shared: that writer belongs to exports and this one to imports, and making
 * one depend on the other would couple two features that only happen to share
 * a file format. Two twenty-line functions are cheaper than that coupling —
 * and both are pinned by tests that read each other's output.
 */

export interface StoredEntry {
  /** Path inside the archive. Forward slashes, no leading one. */
  name: string;
  body: Uint8Array;
  at?: Date;
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

const crc32 = (data: Uint8Array): number => {
  let c = 0xffff_ffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
};

/** MS-DOS date and time, which is what a ZIP stores. Two-second resolution. */
const dosTime = (at: Date): { time: number; date: number } => ({
  time: (at.getHours() << 11) | (at.getMinutes() << 5) | (Math.floor(at.getSeconds() / 2) & 0x1f),
  // Years count from 1980, and anything earlier is clamped rather than written
  // as a negative year — which some readers treat as corruption.
  date: (Math.max(0, at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
});

/** Bounds, because this runs on whatever somebody selected. */
export const MAX_STORED_ENTRIES = 200;
export const MAX_STORED_BYTES = 64 * 1024 * 1024;

export class PackError extends Error {
  constructor(
    message: string,
    readonly code: 'too_many_files' | 'too_large',
  ) {
    super(message);
    this.name = 'PackError';
  }
}

/**
 * One archive holding the entries given, uncompressed.
 *
 * Written in one pass with the central directory collected as it goes, because
 * the offsets a directory records are only known while writing the bodies.
 */
export function packStored(entries: readonly StoredEntry[]): Uint8Array {
  if (entries.length > MAX_STORED_ENTRIES) {
    throw new PackError(`${entries.length} files is more than this packs`, 'too_many_files');
  }
  const total = entries.reduce((sum, entry) => sum + entry.body.length, 0);
  if (total > MAX_STORED_BYTES) {
    throw new PackError(`${total} bytes is more than this packs`, 'too_large');
  }

  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const { time, date } = dosTime(entry.at ?? new Date());
    const crc = crc32(entry.body);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x0403_4b50, true);
    header.setUint16(4, 20, true); // version needed: 2.0, which stored is
    header.setUint16(6, 0x0800, true); // the name is UTF-8
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, entry.body.length, true);
    header.setUint32(22, entry.body.length, true);
    header.setUint16(26, name.length, true);
    header.setUint16(28, 0, true);

    local.push(new Uint8Array(header.buffer), name, entry.body);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x0201_4b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, entry.body.length, true);
    record.setUint32(24, entry.body.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);

    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + entry.body.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x0605_4b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
