/**
 * SONE server — reading a ZIP archive (ADR-0044).
 *
 * The counterpart to the writer, and read from the central directory rather than
 * by scanning for local headers. That is not a detail: the directory is the
 * archive's own index and the only place its contents are authoritative — a
 * scan finds whatever looks like a header, including inside a compressed file,
 * and archives in the wild carry entries the directory deliberately omits.
 *
 * Refuses rather than guesses, in every case where a reader could be generous.
 * An import is somebody handing us a file they may not have made, so this is a
 * parser of untrusted input and is written like one.
 */

import { inflateRawSync } from 'node:zlib';

export interface ArchiveEntry {
  /** The path inside the archive, as it was stored. */
  name: string;
  body: Buffer;
}

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_an_archive'
      | 'unsupported'
      | 'too_many_entries'
      | 'zip64_unsupported'
      | 'too_large'
      | 'unsafe_name',
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** The Zip64 central-directory end record, which this reader does not read. */
const ZIP64_END = Buffer.from([0x50, 0x4b, 0x06, 0x06]);

/** Bounds, because the input is somebody else's file. */
export const MAX_ENTRIES = 5000;
/** Uncompressed, which is the number that matters: a zip bomb is small on disk. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/**
 * A name that cannot escape the directory it is unpacked into.
 *
 * `../` and absolute paths are the oldest archive attack there is, and the fact
 * that this import never writes to a file system is not a reason to accept them:
 * the names become page titles and folder structure, and a page called `..` is
 * its own kind of mess.
 */
function safeName(name: string): string {
  const cleaned = name.replace(/\\/g, '/');
  if (cleaned.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(cleaned)) {
    throw new ArchiveError(`unsafe entry name: ${name}`, 'unsafe_name');
  }
  return cleaned;
}

/**
 * Every file in the archive, in the order the directory lists them.
 *
 * Directory entries — names ending in `/` — are dropped: the structure comes
 * from the paths, and an empty directory carries no page.
 */
export function unzip(archive: Buffer): ArchiveEntry[] {
  const end = findEndRecord(archive);
  const count = archive.readUInt16LE(end + 10);

  /*
   * Zip64, told apart from a genuinely large archive.
   *
   * The count in the end record is sixteen bits. An archive that needs more —
   * or a writer that chose Zip64 anyway — sets it to 0xFFFF and puts the real
   * numbers in a separate record this reader does not understand. Reported as
   * unsupported rather than as "too many entries", which is what it said
   * before: a refusal that names the wrong reason sends somebody off to delete
   * files that were never the problem.
   */
  if (count === 0xffff || archive.lastIndexOf(ZIP64_END) !== -1) {
    throw new ArchiveError('the archive is in the Zip64 format', 'zip64_unsupported');
  }

  if (count > MAX_ENTRIES) {
    /*
     * The count and the limit, both in the message.
     *
     * "too_many_entries" on its own is a dead end — somebody cannot tell
     * whether they are over by one file or by four thousand, and the interface
     * had no message for the code at all, so it showed the code.
     */
    throw new ArchiveError(
      `archive holds ${count} entries, and this reads at most ${MAX_ENTRIES}`,
      'too_many_entries',
    );
  }

  let at = archive.readUInt32LE(end + 16);
  const entries: ArchiveEntry[] = [];
  let total = 0;

  for (let i = 0; i < count; i += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== 0x0201_4b50) {
      throw new ArchiveError('central directory is malformed', 'not_an_archive');
    }

    const method = archive.readUInt16LE(at + 10);
    const compressedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localOffset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');

    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8) {
      // Stored and deflate are what anything writes. Refusing the rest by name
      // is better than inflating something and hoping.
      throw new ArchiveError(`entry ${name} uses compression method ${method}`, 'unsupported');
    }

    // The directory's declared size is a hint, not a promise (ADR-0184): a zip
    // bomb declares nothing and inflates to gigabytes, so an early check on the
    // declared total is a check on a number the attacker chose. It is still
    // worth doing — an honest large archive is refused before any work — but
    // the real limit is enforced on the *actual* output below.
    if (size > MAX_TOTAL_BYTES || total + size > MAX_TOTAL_BYTES) {
      throw new ArchiveError('archive is too large uncompressed', 'too_large');
    }

    // The local header again, because its name length can differ from the
    // directory's and the data starts after it.
    if (
      localOffset + 30 > archive.length ||
      archive.readUInt32LE(localOffset) !== 0x0403_4b50
    ) {
      throw new ArchiveError(`entry ${name} has no local header`, 'not_an_archive');
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const stored = archive.subarray(start, start + compressedSize);

    // What is left of the total budget, plus one byte: a stored (uncompressed)
    // entry is bounded by `stored.length`, a deflated one by `maxOutputLength`,
    // and zlib throws ERR_BUFFER_TOO_LARGE the moment it would exceed it rather
    // than allocating the whole bomb first.
    const remaining = MAX_TOTAL_BYTES - total;
    let body: Buffer;
    try {
      body =
        method === 8
          ? inflateRawSync(stored, { maxOutputLength: remaining + 1 })
          : Buffer.from(stored);
    } catch (err) {
      if (err instanceof RangeError && /ERR_BUFFER_TOO_LARGE|maxOutputLength/.test(err.message)) {
        throw new ArchiveError('archive is too large uncompressed', 'too_large');
      }
      throw new ArchiveError(`entry ${name} could not be decompressed`, 'not_an_archive');
    }

    // The actual output, not the declared size, is what counts against the
    // budget — and an entry whose real length does not match what it declared
    // is refused rather than trusted (ADR-0184).
    if (body.length > remaining) {
      throw new ArchiveError('archive is too large uncompressed', 'too_large');
    }
    if (body.length !== size) {
      throw new ArchiveError(`entry ${name} lies about its size`, 'not_an_archive');
    }
    total += body.length;

    entries.push({ name: safeName(name), body });
  }

  return entries;
}

/**
 * The end-of-central-directory record, searched from the back.
 *
 * It is the last thing in the file except for an optional comment, so this
 * scans backwards over the range a comment can occupy rather than the whole
 * archive — and finds the *last* signature, since the bytes can appear inside a
 * compressed file by chance.
 */
function findEndRecord(archive: Buffer): number {
  if (archive.length < 22) {
    throw new ArchiveError('too short to be an archive', 'not_an_archive');
  }
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let at = archive.length - 22; at >= earliest; at -= 1) {
    if (archive.readUInt32LE(at) === 0x0605_4b50) return at;
  }
  throw new ArchiveError('no end-of-directory record', 'not_an_archive');
}
