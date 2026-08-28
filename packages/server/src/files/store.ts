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
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  async checkWritable(timeoutMs = WRITE_PROBE_TIMEOUT_MS): Promise<string | null> {
    const probe = path.join(this.root, `.write-probe-${process.pid}`);

    const attempt = async (): Promise<string | null> => {
      try {
        await mkdir(this.root, { recursive: true });
        await writeFile(probe, 'ok');
        await unlink(probe);
        return null;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return `${this.root} is not writable: ${reason}`;
      }
    };

    // Bounded, and this is not theoretical: the first version of this check hung
    // indefinitely on a path it could not resolve, which would have hung the
    // server's startup — a check that can prevent a boot is worse than no
    // check.
    //
    // A probe that does not finish quickly is itself the finding. A stalled
    // network mount answers neither yes nor no, and reporting "did not respond"
    // is more useful than waiting for it.
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
  }

  if (startsWith(0x25, 0x50, 0x44, 0x46)) {
    return { mime: 'application/pdf', extension: 'pdf' };
  }

  return null;
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
