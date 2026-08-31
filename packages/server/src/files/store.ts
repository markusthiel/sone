/**
 * SONE — file storage.
 *
 * Content-addressed: the storage key is derived from the SHA-256 of the bytes,
 * so uploading the same image twice stores it once. That matters more than it
 * sounds for a notes app — the same screenshot pasted into five pages is one
 * file, and a duplicated page duplicates no bytes.
 *
 * The interface is deliberately small so an S3 backend can implement it later
 * without anything above knowing which is in use.
 *
 * ## What this refuses, and why
 *
 * A file store reachable by upload is the most dangerous surface in the
 * application, so the rules are here rather than spread across callers:
 *
 *   - The key is derived, never taken from the client. A caller-supplied path is
 *     a directory-traversal waiting to happen, and no amount of filtering makes
 *     one safe.
 *   - The extension is derived from the *detected* type, not the filename.
 *     A file called `photo.png` containing HTML must not be served as HTML.
 *   - The declared MIME type is ignored entirely; the bytes decide.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

/** What a caller needs to know about a stored file. */
export interface StoredFile {
  /** Opaque to callers; only the backend interprets it. */
  key: string;
  sha256: Buffer;
  sizeBytes: number;
}

export interface FileStore {
  readonly kind: string;
  put(bytes: Buffer, extension: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** How many bytes are stored, without reading them (ADR-0037). */
  size(key: string): Promise<number>;
  /**
   * Read part of a file, as a stream.
   *
   * `get` returns the whole thing in memory, which is what the download route
   * did for every request — merely wasteful for a document and fatal for video:
   * a browser seeks by asking for a byte range, Safari will not play a `<video>`
   * at all without ranges advertised, and a 100 MB file watched by five people
   * is half a gigabyte of resident memory.
   *
   * Inclusive bounds, as HTTP has them: `bytes=0-1023` is the first 1024 bytes,
   * and that is the arithmetic the caller is already holding.
   */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'io' | 'unsafe_key',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * A storage key is `ab/cdef…` plus an extension.
 *
 * Two-character prefix directories keep any single directory from holding
 * hundreds of thousands of entries, which several filesystems handle badly and
 * every `ls` handles badly.
 */
const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{62}(\.[a-z0-9]{1,8})?$/;

/** How long the startup writability probe waits before giving its verdict. */
export const WRITE_PROBE_TIMEOUT_MS = 3_000;

export class LocalFileStore implements FileStore {
  readonly kind = 'local';

  constructor(private readonly root: string) {}

  /**
   * Confirm the store can actually be written to.
   *
   * Called at startup, because the alternative is finding out on somebody's
   * first photo — and an upload that fails there produces a 500, which tells
   * them nothing about a directory they could fix in a minute.
   *
   * The usual cause is a volume mounted over the image's prepared directory
   * with different ownership: the image creates and chowns
   * `/var/lib/sone/files`, and a bind mount or a pre-existing volume replaces
   * that with whatever the host has.
   *
   * Returns the problem rather than throwing, so the caller decides whether it
   * is fatal.
   */
  async checkWritable(
    timeoutMs = WRITE_PROBE_TIMEOUT_MS,
    /**
     * Injectable so the timeout branch can be tested.
     *
     * Not a convenience: a real unresponsive path leaves a filesystem request
     * outstanding that cannot be cancelled, and libuv keeps the process alive
     * until it settles — which for such a path is never. A test that exercised
     * the real thing therefore never exited, and that is precisely how this
     * commit's CI run sat for fifteen minutes and was killed.
     */
    attempt: () => Promise<string | null> = () => this.probeWrite(),
  ): Promise<string | null> {

    // Bounded, and this is not theoretical: the first version of this check hung
    // indefinitely on a path it could not resolve, which would have hung the
    // server's startup — a check that can prevent a boot is worse than no
    // check.
    //
    // A probe that does not finish quickly is itself the finding. A stalled
    // network mount answers neither yes nor no, and reporting "did not respond"
    // is more useful than waiting for it.
    //
    // What the timeout does *not* do is cancel the underlying request: it stays
    // outstanding and holds the event loop open. That is acceptable here,
    // because this runs once at startup and the process is meant to keep
    // running anyway. It would not be acceptable per request.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(
        () => resolve(`${this.root} did not respond within ${timeoutMs} ms`),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([attempt(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** One write attempt, with no time limit of its own. */
  private async probeWrite(): Promise<string | null> {
    const probe = path.join(this.root, `.write-probe-${process.pid}`);
    try {
      await mkdir(this.root, { recursive: true });
      await writeFile(probe, 'ok');
      await unlink(probe);
      return null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `${this.root} is not writable: ${reason}`;
    }
  }

  private resolve(key: string): string {
    // Validated against a pattern rather than sanitised. The keys this store
    // produces all match it, so anything that does not is either corrupt or an
    // attempt — and neither should be resolved to a path.
    if (!KEY_PATTERN.test(key)) {
      throw new StorageError(`refusing to resolve unsafe storage key: ${key}`, 'unsafe_key');
    }

    const resolved = path.resolve(this.root, key);
    // Belt and braces: the pattern already excludes traversal, and this catches
    // a future change to the pattern that accidentally allows it.
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new StorageError('storage key escapes the storage root', 'unsafe_key');
    }
    return resolved;
  }

  async put(bytes: Buffer, extension: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(bytes).digest();
    const hex = sha256.toString('hex');
    const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? `.${extension}` : '';
    const key = `${hex.slice(0, 2)}/${hex.slice(2)}${safeExtension}`;
    const target = this.resolve(key);

    // Identical content is already there: the key is the hash, so nothing needs
    // writing and nothing can differ.
    if (await this.exists(key)) {
      return { key, sha256, sizeBytes: bytes.length };
    }

    await mkdir(path.dirname(target), { recursive: true });

    // Written to a temporary name and renamed, so a crash mid-write cannot
    // leave a truncated file under a key that claims to be a complete one —
    // and the key is a hash, so a truncated file would be a lie about its own
    // contents.
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      const { rename } = await import('node:fs/promises');
      await rename(temporary, target);
    } catch (err) {
      await unlink(temporary).catch(() => {});
      throw new StorageError(
        `could not store file: ${err instanceof Error ? err.message : String(err)}`,
        'io',
      );
    }

    return { key, sha256, sizeBytes: bytes.length };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(`file not found: ${key}`, 'not_found');
    }
  }

  async size(key: string): Promise<number> {
    try {
      const info = await stat(this.resolve(key));
      if (!info.isFile()) throw new StorageError(`not a file: ${key}`, 'not_found');
      return info.size;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(`file not found: ${key}`, 'not_found');
    }
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    // Resolved first, and separately, so an unsafe or missing key fails here
    // rather than as an error event on a stream the route has already started
    // writing headers for.
    const path = this.resolve(key);
    await this.size(key);
    return createReadStream(path, range ? { start: range.start, end: range.end } : {});
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.resolve(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (err) {
      if (err instanceof StorageError) throw err;
      // Already gone is the desired state.
    }
  }
}

// --- type detection --------------------------------------------------------

export interface DetectedType {
  mime: string;
  extension: string;
}

/**
 * Detect a file type from its first bytes.
 *
 * The client's declared type is ignored. A browser will happily send
 * `image/png` for a file containing HTML, and serving that back as HTML is
 * stored cross-site scripting — the most damaging bug a notes app can have,
 * because the content is shared and the origin is trusted.
 *
 * Only formats SONE will actually serve inline are listed. Anything
 * unrecognised is rejected rather than stored as a generic type, since a stored
 * file with an unknown type is one somebody will eventually be tempted to serve.
 */
export function detectType(bytes: Buffer): DetectedType | null {
  const startsWith = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (startsWith(0xff, 0xd8, 0xff)) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(0x47, 0x49, 0x46, 0x38)) {
    return { mime: 'image/gif', extension: 'gif' };
  }
  // RIFF....WEBP
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  // AVIF and HEIC share the ISOBMFF container; the brand is at offset 8.
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') {
      return { mime: 'image/avif', extension: 'avif' };
    }
    if (brand.startsWith('hei') || brand.startsWith('mif')) {
      // Detected but not served inline: Safari renders HEIC and other browsers
      // do not, so it would work for the person who uploaded it and not for
      // anyone they shared with.
      return { mime: 'image/heic', extension: 'heic' };
    }

    // Video in the same container (ADR-0037).
    //
    // The brand is the only thing that tells these apart, and it is a short
    // allowlist rather than "anything else with an ftyp box": an unrecognised
    // brand should keep being refused, which is what stops this becoming the
    // generic type that everything unknown is stored as.
    if (brand === 'qt  ') {
      // A `.mov` from a phone or a camera. Its codec is another question — HEVC
      // is common and most browsers cannot play it — which is why the interface
      // says so at the moment of choosing the file rather than storing it and
      // showing a black rectangle later.
      return { mime: 'video/quicktime', extension: 'mov' };
    }
    if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'mmp4', 'dash', 'M4V ', 'M4VP'].includes(brand)) {
      return { mime: 'video/mp4', extension: 'mp4' };
    }
  }

  // Matroska and WebM share a container, and only the doctype distinguishes
  // them. WebM plays everywhere; a general Matroska file mostly does not, and it
  // is stored under its own type so the interface can say which it has.
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) {
    const head = bytes.subarray(0, 64).toString('latin1');
    return head.includes('webm')
      ? { mime: 'video/webm', extension: 'webm' }
      : { mime: 'video/x-matroska', extension: 'mkv' };
  }

  if (startsWith(0x25, 0x50, 0x44, 0x46)) {
    return { mime: 'application/pdf', extension: 'pdf' };
  }

  // The modern Office formats are ZIP containers, and so are a great many other
  // things. The archive's first entry names the format — `word/`, `xl/`, `ppt/`
  // — and that is what tells them apart. Read from the local file header rather
  // than the central directory: it is at a known offset, and a file whose
  // directory disagrees with its first entry is not one to trust anyway.
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    const nameLength = bytes.readUInt16LE(26);
    const first = bytes.subarray(30, 30 + Math.min(nameLength, 64)).toString('ascii');

    if (first.startsWith('word/')) {
      return {
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      };
    }
    if (first.startsWith('xl/')) {
      return {
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
      };
    }
    if (first.startsWith('ppt/')) {
      return {
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
      };
    }
    // OpenDocument writes an uncompressed `mimetype` entry first, by
    // specification, precisely so the format can be identified this way.
    if (first === 'mimetype') {
      const declared = bytes.subarray(38, 38 + 64).toString('ascii');
      if (declared.startsWith('application/vnd.oasis.opendocument.text')) {
        return { mime: 'application/vnd.oasis.opendocument.text', extension: 'odt' };
      }
      if (declared.startsWith('application/vnd.oasis.opendocument.spreadsheet')) {
        return { mime: 'application/vnd.oasis.opendocument.spreadsheet', extension: 'ods' };
      }
    }
    // A zip that is not an office document. Stored as one rather than refused:
    // an archive is a legitimate attachment, and refusing it would mean the
    // only way to attach one is to rename it.
    return { mime: 'application/zip', extension: 'zip' };
  }

  // The pre-2007 Office formats share one OLE container and cannot be told
  // apart without parsing it. Reported as the container, which is honest: the
  // interface offers it for download and does not claim to know which
  // application it belongs to.
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) {
    return { mime: 'application/x-ole-storage', extension: 'doc' };
  }

  // Text last, and only if the bytes look like text.
  //
  // Checked rather than assumed: "not a format I recognise" is not the same as
  // "plain text", and storing an unknown binary as text/plain would have the
  // browser try to display it.
  if (looksLikeText(bytes)) {
    return { mime: 'text/plain', extension: 'txt' };
  }

  return null;
}

/**
 * Does this look like text rather than a binary?
 *
 * A NUL byte settles it: no text encoding this application would accept
 * produces one, and every binary format of any size has them. Beyond that, a
 * high proportion of control characters means binary.
 *
 * Deliberately simple. The cost of guessing wrong is a file offered as text
 * that renders as noise, not a security problem — the type is never taken from
 * what the client declared, and text/plain is served with the same nosniff and
 * sandbox headers as everything else.
 */
function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;

  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Tab, newline and carriage return are text; the rest of C0 is not.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control++;
  }
  return control / sample.length < 0.05;
}

/**
 * Types safe to render inline in a page.
 *
 * SVG is deliberately absent. An SVG is a document that can carry script, so
 * serving one inline from the same origin as the application is an XSS vector —
 * and a notes app is exactly where someone would paste one without thinking.
 */
export const INLINE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

export const isInlineImage = (mime: string): boolean => INLINE_IMAGE_TYPES.has(mime);

/**
 * What kind of thing a file is, for the interface to decide how to show it.
 *
 * Deliberately coarse. The honest division is not by application but by what a
 * browser can actually render: an image and a PDF it draws, text it displays,
 * and a Word or Excel file it cannot open at all without a converter this
 * project does not have. Calling the last group 'document' rather than
 * pretending to preview it is the difference between a card that says what it
 * is and a viewer that shows an error.
 */
export type FileCategory = 'image' | 'video' | 'pdf' | 'text' | 'document' | 'archive';

export function categoryOf(mime: string): FileCategory {
  if (mime.startsWith('image/')) return 'image';
  // Its own category rather than a document: a video is watched, which means a
  // player and a duration rather than a name and a size (ADR-0037).
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/zip') return 'archive';
  return 'document';
}

/**
 * Video a browser can be expected to play (ADR-0037).
 *
 * MP4 and WebM, and QuickTime because a `.mov` carrying H.264 plays in every
 * browser that matters. Matroska is stored and not on this list: it is a
 * container that can hold anything, and most browsers refuse it.
 *
 * A container is not a codec, which is the part that cannot be answered here at
 * all: an MP4 holding HEVC is playable in Safari and a black rectangle in
 * Chromium. That question belongs to the browser doing the playing, and it is
 * asked there — before the upload, where the answer can still change somebody's
 * mind.
 */
export const isPlayableVideo = (mime: string): boolean =>
  mime === 'video/mp4' || mime === 'video/webm' || mime === 'video/quicktime';

/**
 * Types the browser will render in place, given the headers this server sends.
 *
 * A PDF renders in an iframe; text renders as text. Everything else is offered
 * as a file — which is not a limitation to apologise for, it is what a browser
 * can do.
 */
export const isInlineViewable = (mime: string): boolean =>
  isInlineImage(mime) ||
  // A video is played in place, so it must not arrive as an attachment: the
  // browser would offer to save it instead of handing it to the player.
  isPlayableVideo(mime) ||
  mime === 'application/pdf' ||
  mime.startsWith('text/');
