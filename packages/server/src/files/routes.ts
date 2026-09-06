/**
 * SONE — file routes.
 *
 * Upload and serve. Both halves have a security decision at their centre, and
 * both are here rather than in the storage layer because they are about HTTP.
 *
 * **Upload** ignores the declared content type and detects from the bytes. A
 * browser will send `image/png` for anything, and a file stored under a type it
 * does not have is a file that will eventually be served under that type.
 *
 * **Serving** sets `Content-Disposition` and a restrictive
 * `Content-Security-Policy`, and refuses to serve anything not on the inline
 * allowlist as inline. Files are user-supplied content served from the
 * application's own origin, which is the setup where a stored cross-site
 * scripting bug does the most damage: the content is shared, and the origin is
 * trusted with everyone's notes.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

import type { Pool } from 'pg';

import {
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  resolveShareTokenClaims,
  type AccessClaims,
} from '../auth/claims.js';
import { isInstanceAdmin } from '../admin/routes.js';
import { queryOne } from '../db/pool.js';
import {
  categoryOf,
  detectType,
  isInlineViewable,
  type FileStore,
} from './store.js';
import { claimsForRequest, sessionTokenFrom } from '../http/auth.js';
import type { RequestContext, Router } from '../http/router.js';
import { requireSession } from '../http/auth.js';

export interface FileDeps {
  pool: Pool;
  store: FileStore;
  maxUploadBytes: number;
}

/**
 * Read a request body up to a limit.
 *
 * Its own reader rather than the router's `readJson`, because an upload is
 * megabytes of binary and the router's limit is 1 MB of text. Exported since the
 * import route needs the same thing — an archive is an upload by any other
 * name, and a second reader would be a second place to get the limit wrong.
 * (It was already exported at the foot of this file for the tests — I nearly
 * added a second `export` keyword to something already exported.) The limit is
 * enforced while reading: checking Content-Length alone lets a client lie and
 * send more.
 */
async function readBinary(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer | 'too_large'> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      // Stop reading, but do not destroy the socket here.
      //
      // Destroying it immediately meant the client saw a network error instead
      // of the 413 — the response had not been written yet. The route answers
      // first and closes afterwards, so the reason for the refusal actually
      // arrives.
      //
      // `pause` rather than draining: continuing to read a body already known
      // to be too large is the difference between refusing an upload and
      // absorbing it.
      req.pause();
      return 'too_large';
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

/** A filename safe to put in a header and to store. */
function safeFilename(raw: string | undefined, extension: string): string {
  const base = (raw ?? '')
    .split(/[/\\]/)
    .pop()!
    // Control characters and quotes would break the header they end up in.
    //
    // The lint rule against control characters in a regular expression is right
    // almost everywhere and wrong here: stripping them is the point.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f"\\]/g, '')
    .trim()
    .slice(0, 200);
  if (base.length > 0) return base;
  return `file.${extension}`;
}

export function registerFileRoutes(router: Router, deps: FileDeps): void {
  /**
   * Upload a file to a page.
   *
   * Authorised through the page, not the workspace: a share-link guest with
   * edit rights on one page may add an image to that page and nothing else
   * (ADR-0006).
   */
  router.post('/api/pages/:pageId/files', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return;
    }

    // The same resolver the download route uses.
    //
    // A guest editing through a share link could not upload: this read only the
    // member cookie, so the request was 401 and the image block stayed as the
    // filename in text — which reads as "the picture turned into words" rather
    // than as a refused upload.
    const resolved = await claimsForRequest(deps.pool, ctx, page.workspaceId);
    if (resolved.kind === 'anonymous') {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    const claims = resolved.kind === 'ok' ? resolved.claims : null;
    const role = claims ? effectiveRole(claims, page) : null;
    if (role === null) {
      ctx.fail(404, 'not_found');
      return;
    }
    if (role === 'viewer' || role === 'commenter') {
      ctx.fail(403, 'not_authorized');
      return;
    }

    const body = await readBinary(ctx.req, deps.maxUploadBytes);
    if (body === 'too_large') {
      ctx.fail(413, 'file_too_large');
      // Closed after the response, so the rest of the body is not read and the
      // client still learns why. Keeping the connection alive would mean
      // reading the remainder to find the next request on it.
      ctx.req.destroy();
      return;
    }
    if (body.length === 0) {
      ctx.fail(422, 'empty_file');
      return;
    }

    // The bytes decide. The declared content type is not consulted at all.
    const detected = detectType(body);
    if (!detected) {
      ctx.fail(415, 'unsupported_file_type');
      return;
    }

    const filename = safeFilename(
      typeof ctx.url.searchParams.get('filename') === 'string'
        ? ctx.url.searchParams.get('filename')!
        : undefined,
      detected.extension,
    );

    // Storage failures get their own code.
    //
    // An uncaught one became a bare 500 and the block on the page said
    // "Something went wrong" — true, and useless. A directory that cannot be
    // written is a deployment problem somebody can fix in a minute once they
    // are told which one it is.
    let stored;
    try {
      stored = await deps.store.put(body, detected.extension);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[files] could not store an upload for page ${pageId}: ${reason}`);

      // The reason goes to an instance administrator and nobody else.
      //
      // It names a filesystem path and an errno, which is exactly what somebody
      // fixing a deployment needs and not something every editor should be
      // handed. Without it the only route to the cause was the container log,
      // and a round trip was spent on that.
      const isAdmin =
        claims!.principal.kind === 'anonymous'
          ? false
          : await isInstanceAdmin(deps.pool, claims!.principal.userId);

      ctx.send(500, {
        error: 'storage_unavailable',
        ...(isAdmin ? { detail: reason } : {}),
      });
      return;
    }
    const actorId =
      claims!.principal.kind === 'anonymous' ? null : claims!.principal.userId;

    // Content-addressed storage means the same bytes may already have a row for
    // this workspace. A second row is still created: the same image on two
    // pages is two attachments with one set of bytes, and deleting one page must
    // not remove the other's image.
    // A web-sized copy of something already uploaded (ADR-0029).
    //
    // Checked rather than trusted: the id has to name a file in this workspace,
    // or a caller could attach a variant to somebody else's image and change
    // what everybody sees on a page they cannot reach.
    const variantOfParam = ctx.url.searchParams.get('variantOf');
    let variantOf: string | null = null;
    if (variantOfParam) {
      const original = await queryOne<{ id: string }>(
        deps.pool,
        `SELECT id FROM files
          WHERE id = $1 AND workspace_id = $2 AND variant_of IS NULL`,
        [variantOfParam, page.workspaceId],
      );
      if (!original) {
        ctx.fail(422, 'unknown_original');
        return;
      }
      variantOf = original.id;
    }

    const row = await queryOne<{ id: string }>(
      deps.pool,
      `INSERT INTO files
         (workspace_id, page_id, filename, mime_type, size_bytes, sha256,
          storage, storage_key, uploaded_by, variant, variant_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        page.workspaceId,
        pageId,
        filename,
        detected.mime,
        stored.sizeBytes,
        stored.sha256,
        deps.store.kind,
        stored.key,
        actorId,
        variantOf ? 'web' : 'original',
        variantOf,
      ],
    );
    if (!row) throw new Error('failed to record uploaded file');

    ctx.send(201, {
      id: row.id,
      url: `/api/files/${row.id}`,
      filename,
      mimeType: detected.mime,
      sizeBytes: stored.sizeBytes,
      // What the interface needs to decide how to show it: whether it can be
      // rendered in place at all, and what kind of thing it is when it cannot.
      inline: isInlineViewable(detected.mime),
      category: categoryOf(detected.mime),
    });
  });

  /**
   * Serve a file.
   *
   * Authorised through the page it hangs on, so a file in a page nobody may see
   * is a file nobody may fetch. Guessing an id gets a 404 rather than the bytes.
   */
  router.get('/api/files/:fileId', async (ctx) => {
    const fileId = ctx.params['fileId'] ?? '';

    const file = await queryOne<{
      id: string;
      workspace_id: string;
      page_id: string | null;
      filename: string;
      mime_type: string;
      size_bytes: string;
      storage_key: string;
    }>(
      deps.pool,
      // The web version by default, the original on request (ADR-0029).
      //
      // Resolved here rather than by the caller holding two ids: a block stores
      // the original's id and nothing else, so a page that was written before
      // variants existed keeps working and a copy of that block into another
      // page carries something that still resolves.
      //
      // `?original=true` is what "Download the original" asks for. Anything
      // else gets the smaller file when there is one.
      `SELECT COALESCE(web.id, f.id) AS id,
              f.workspace_id, f.page_id, f.filename,
              COALESCE(web.mime_type, f.mime_type) AS mime_type,
              COALESCE(web.size_bytes, f.size_bytes) AS size_bytes,
              COALESCE(web.storage_key, f.storage_key) AS storage_key
         FROM files f
         LEFT JOIN LATERAL (
           SELECT v.id, v.mime_type, v.size_bytes, v.storage_key
             FROM files v
            WHERE v.variant_of = f.id AND v.variant = 'web'
            LIMIT 1
         ) web ON NOT $2
        WHERE f.id = $1`,
      [fileId, ctx.url.searchParams.get('original') === 'true'],
    );
    if (!file) {
      ctx.fail(404, 'not_found');
      return;
    }

    const resolved = await claimsForRequest(deps.pool, ctx, file.workspace_id);
    if (resolved.kind === 'anonymous') {
      ctx.fail(401, 'not_authenticated');
      return;
    }
    if (resolved.kind === 'rejected') {
      // Same answer as a missing file: the difference would confirm that a file
      // exists in a workspace the caller cannot see.
      ctx.fail(404, 'not_found');
      return;
    }
    const claims = resolved.claims;

    if (file.page_id) {
      const page = await loadPageLocation(deps.pool, file.page_id);
      const role = page ? effectiveRole(claims, page) : null;
      if (role === null) {
        ctx.fail(404, 'not_found');
        return;
      }
    }

    let total: number;
    try {
      total = await deps.store.size(file.storage_key);
    } catch {
      // The row exists and the bytes do not, which means storage was restored
      // without its files or a backup was partial. Reported as a server error
      // rather than a 404, because the file is supposed to be there.
      ctx.fail(500, 'file_missing_from_storage');
      return;
    }

    // A byte range, if one was asked for (ADR-0037).
    //
    // This is what makes a video seekable — a browser seeks by asking for a
    // range, and Safari will not play a `<video>` at all unless ranges are
    // advertised — and it is why nothing here reads a whole file into memory any
    // more. Every existing download benefits: it is resumable now.
    const asked = parseRange(ctx.req.headers['range'], total);
    if (asked === 'unsatisfiable') {
      // 416 must say what the size actually is, or a client cannot correct its
      // own request.
      ctx.res.writeHead(416, {
        'content-range': `bytes */${total}`,
        'accept-ranges': 'bytes',
      });
      ctx.res.end();
      return;
    }

    let stream: Readable;
    try {
      stream = await deps.store.read(file.storage_key, asked ?? undefined);
    } catch {
      ctx.fail(500, 'file_missing_from_storage');
      return;
    }

    serveFile(ctx.res, stream, {
      mimeType: file.mime_type,
      filename: file.filename,
      total,
      ...(asked ? { range: asked } : {}),
    });
  });
}

/**
 * Write a file response.
 *
 * Every header here is load-bearing:
 *
 *   `Content-Disposition: inline` only for the allowlist, `attachment`
 *   otherwise. A PDF is stored and served, but downloaded rather than rendered
 *   in place, because a PDF viewer is a large attack surface pointed at
 *   user-supplied bytes.
 *
 *   `X-Content-Type-Options: nosniff` stops a browser deciding the type for
 *   itself. Without it, content sniffing can render a file we labelled as an
 *   image as something else entirely.
 *
 *   `Content-Security-Policy: sandbox` is the belt to that braces. Even if a
 *   file is somehow served as a document, it cannot run script or reach back
 *   into the origin.
 *
 *   Long, immutable caching is safe because the URL contains a file id that
 *   never points at different bytes: storage is content-addressed and a row is
 *   never repointed.
 */
/**
 * A Content-Disposition a header can actually carry.
 *
 * Node refuses to write a header containing anything outside ASCII, and it
 * refuses by throwing: a file called "Eine App für alles.pdf" produced
 * ERR_INVALID_CHAR, the router turned that into a 500, and the viewer showed
 * {"error":"internal"} where the document should have been. Every file with an
 * umlaut, an accent or a CJK character in its name was unreachable — which
 * looked like a size problem, because the files that happened to work had
 * ASCII names.
 *
 * RFC 6266 is the answer and it is deliberately two answers in one header: a
 * plain `filename` that any client understands, and a `filename*` carrying the
 * real name UTF-8 percent-encoded. A client that understands the second uses
 * it; one that does not still gets something readable.
 *
 * The plain form is stripped to ASCII rather than transliterated. Guessing that
 * "ü" should become "ue" is a German answer to a general question, and it would
 * be wrong for most of the alphabets this has to survive.
 *
 * Quotes and control characters are removed from both. A filename is chosen by
 * whoever uploaded it, so it is untrusted input arriving in a header — a quote
 * would end the field early and let the rest be read as another parameter.
 */
export function contentDisposition(inline: boolean, filename: string): string {
  const type = inline ? 'inline' : 'attachment';

  // eslint-disable-next-line no-control-regex
  const withoutControls = filename.replace(/[\u0000-\u001f\u007f]/g, '');
  const ascii = withoutControls.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  // A name that was entirely non-ASCII would otherwise become an empty
  // fallback, which some clients save as a file with no name at all.
  const fallback = ascii.trim() === '' ? 'download' : ascii;

  const encoded = encodeURIComponent(withoutControls);

  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function serveFile(
  res: ServerResponse,
  body: Readable,
  what: {
    mimeType: string;
    filename: string;
    /** The whole file's length, which a partial response still has to name. */
    total: number;
    /** Inclusive bounds, when this is a partial response. */
    range?: { start: number; end: number };
  },
): void {
  const { mimeType, filename, total, range } = what;
  const length = range ? range.end - range.start + 1 : total;
  // Images, PDFs and text are shown in place; everything else is a download.
  //
  // Text is included now that it can be stored, and it is safe for a specific
  // reason rather than by hope: detectType never produces text/html — anything
  // textual becomes text/plain — and `nosniff` stops the browser deciding
  // otherwise. A file full of <script> is served as plain text, which is what
  // it is. The sandbox CSP below is the belt to that braces.
  const inline = isInlineViewable(mimeType);

  res.writeHead(range ? 206 : 200, {
    'content-type': mimeType,
    'content-length': length,
    // Advertised on every response, not only a partial one: a client asks for a
    // range because the first answer said it could.
    'accept-ranges': 'bytes',
    ...(range
      ? { 'content-range': `bytes ${range.start}-${range.end}/${total}` }
      : {}),
    'content-disposition': contentDisposition(inline, filename),
    'x-content-type-options': 'nosniff',
    // A PDF carries no `sandbox` at all, and this took two attempts to get
    // right.
    //
    // First it was `sandbox`, and only the first page rendered. Then
    // `sandbox allow-scripts`, and Chromium browsers refused to render it at
    // all — "Diese Seite wurde von Brave blockiert". The built-in PDF viewer is
    // not page script; it is a browser component, and Chromium does not run it
    // inside a sandboxed frame whatever tokens are set. Sandbox and the viewer
    // are simply incompatible, so there is no combination to search for.
    //
    // What keeps this safe without it:
    //
    //   - the type comes from the bytes, never from the upload, so what is
    //     served as a PDF is a PDF;
    //   - `nosniff` stops the browser reconsidering that, which is what would
    //     otherwise let a file be treated as HTML in this origin;
    //   - `default-src 'none'` stays, so the document can load nothing —
    //     no scripts, no images, no network of its own;
    //   - the viewer does its own sandboxing, in a process this application
    //     does not control and does not need to.
    //
    // The risk sandbox guards against is active content in *this* origin, and
    // the first two lines above are what prevent that. Everything else keeps
    // the strict policy: nothing else served here needs to run at all.
    'content-security-policy':
      mimeType === 'application/pdf' ? "default-src 'none'" : "sandbox; default-src 'none'",
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'private, max-age=31536000, immutable',
  });

  // Piped rather than buffered. An error part way through cannot become a status
  // code — the headers are already written — so the response is destroyed
  // instead, which is what a truncated body should look like to a client.
  body.on('error', () => res.destroy());
  body.pipe(res);
}

/**
 * The one range a `Range` header asks for, or null for the whole file.
 *
 * Deliberately narrow: a single `bytes=a-b`, `bytes=a-` or `bytes=-n`. Multipart
 * ranges are legal HTTP and are asked for by nothing that matters here, and
 * answering them means generating a multipart body — so an unparseable or
 * multiple range is treated as no range at all, which is always a correct
 * answer.
 *
 * `'unsatisfiable'` is the third case and must not be collapsed into the second:
 * a start beyond the end of the file is a client that has the wrong idea about
 * the size, and answering 200 with the whole file would hide that from it.
 */
export function parseRange(
  header: string | string[] | undefined,
  total: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // A suffix range: the last n bytes. `bytes=-500` of a 100-byte file is the
  // whole file rather than an error, which is what the specification says.
  if (rawStart === '') {
    const wanted = Number(rawEnd);
    if (wanted === 0) return 'unsatisfiable';
    return { start: Math.max(0, total - wanted), end: total - 1 };
  }

  const start = Number(rawStart);
  if (start >= total) return 'unsatisfiable';
  const end = rawEnd === '' ? total - 1 : Math.min(Number(rawEnd), total - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

/** Exported for tests. */
export { readBinary, safeFilename };

/**
 * The instance's own mark (ADR-0123).
 *
 * Registered here for the reason the avatar is — it needs the file store — and
 * apart from both the attachment routes and the avatar for a reason of its own:
 * **it is the only file on this instance served to nobody in particular.**
 *
 * An attachment is authorised through its page and a face through a session.
 * The logo is drawn on the sign-in screen, so requiring a session to see it
 * would be requiring a session to see the sign-in screen. It leaks that the
 * instance has a logo, which is visible from that screen regardless.
 *
 * No `files` row: a logo belongs to no workspace and no page, so it is a key on
 * a setting, exactly as an avatar is a key on a person. That makes it the
 * **fourth** place a storage key lives, and the orphan sweep has to know — the
 * one that does not would collect the logo a week after it was uploaded
 * (ADR-0109).
 */
export function registerBrandRoutes(
  router: Router,
  deps: FileDeps & { settings: BrandSettings },
): void {
  router.put('/api/admin/brand/logo', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    if (!(await isInstanceAdmin(deps.pool, auth.userId))) {
      // The same answer an unknown route gives, as everywhere else in
      // administration: the difference would confirm the route exists.
      ctx.fail(404, 'not_found');
      return;
    }

    // A quarter of the attachment limit, the bound a profile picture uses. A
    // mark drawn at a few hundred pixels is tens of kilobytes.
    const body = await readBinary(ctx.req, Math.floor(deps.maxUploadBytes / 4));
    if (body === 'too_large') {
      ctx.fail(413, 'file_too_large');
      ctx.req.destroy();
      return;
    }
    if (body.length === 0) {
      ctx.fail(422, 'empty_file');
      return;
    }

    // The bytes decide, as everywhere else here. A browser sends `image/png`
    // for anything, and this file is served to everybody who reaches the
    // sign-in screen — including people who are not signed in at all.
    const detected = detectType(body);
    if (!detected || !/^image\/(jpeg|png|webp)$/.test(detected.mime)) {
      ctx.fail(415, 'unsupported_file_type');
      return;
    }

    const stored = await deps.store.put(body, detected.extension);
    // The previous one is left for the orphan sweep rather than deleted, the
    // rule the avatar states: keys are content hashes, so deleting on replace
    // could take bytes something else still names.
    await deps.settings.set('brandLogo', { key: stored.key, mime: detected.mime }, auth.userId);

    ctx.send(200, { ok: true });
  });

  router.delete('/api/admin/brand/logo', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    if (!(await isInstanceAdmin(deps.pool, auth.userId))) {
      ctx.fail(404, 'not_found');
      return;
    }
    // `null` deletes the row rather than storing null, so "no logo" has one
    // representation — the settings store's own rule.
    await deps.settings.set('brandLogo', null, auth.userId);
    ctx.send(200, { ok: true });
  });

  /**
   * The mark itself, to anybody who asks.
   *
   * The `?v=` the instance hands out is not read here: the key is in the
   * setting, and the parameter exists so that a *new* logo is a new address.
   * That is what makes the long cache safe — the bytes at a key never change,
   * but this path does not name a key.
   */
  router.get('/api/instance/logo', async (ctx) => {
    const logo = (await deps.settings.get('brandLogo')) as { key: string; mime: string } | null;
    if (!logo) {
      ctx.fail(404, 'not_found');
      return;
    }

    let bytes: Buffer;
    try {
      bytes = await deps.store.get(logo.key);
    } catch {
      // The setting names bytes that are gone — a restored database against a
      // fresh storage directory, say. A missing mark is not an error worth a
      // 500 on the sign-in screen; the interface draws its own.
      ctx.fail(404, 'not_found');
      return;
    }

    ctx.res.writeHead(200, {
      'content-type': logo.mime,
      'content-length': String(bytes.length),
      // Public, unlike an avatar: it is on a page nobody has signed in to, and
      // a shared cache holding it is the correct outcome rather than a leak.
      'cache-control': 'public, max-age=604800, immutable',
      // Served from the application's own origin like every other uploaded
      // file, so it carries the same refusal to be anything but an image.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(bytes);
  });
}

/** Only the two things the brand routes do to settings. */
export interface BrandSettings {
  get(key: 'brandLogo'): Promise<unknown>;
  set(key: 'brandLogo', value: unknown, actorId: string | null): Promise<void>;
}

/**
 * A profile picture.
 *
 * Registered here because it needs the file store, and kept apart from the
 * attachment routes because it is not an attachment: an attachment belongs to a
 * workspace and a page, and a face belongs to a person (ADR-0029).
 */
export function registerAvatarRoutes(router: Router, deps: FileDeps): void {
  /** Replace your own picture. Only your own: there is no path to anybody else's. */
  router.put('/api/auth/avatar', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    // A quarter of the attachment limit. A picture bounded to 512 pixels is
    // tens of kilobytes; anything approaching a megabyte did not go through the
    // resizing, and accepting it would store something nothing displays.
    const body = await readBinary(ctx.req, Math.floor(deps.maxUploadBytes / 4));
    if (body === 'too_large') {
      ctx.fail(413, 'file_too_large');
      ctx.req.destroy();
      return;
    }
    if (body.length === 0) {
      ctx.fail(422, 'empty_file');
      return;
    }

    // The bytes decide, as everywhere else. A file that says it is a PNG and is
    // not would otherwise be served back to every page that shows this person.
    const detected = detectType(body);
    if (!detected || !/^image\/(jpeg|png|webp)$/.test(detected.mime)) {
      ctx.fail(415, 'unsupported_file_type');
      return;
    }

    const stored = await deps.store.put(body, detected.extension);

    // The previous one is left in storage for the orphan sweep rather than
    // deleted here. Content-addressed keys mean two people with the same
    // picture share one file, and deleting on replace would take the other
    // person's.
    //
    // That sweep exists since ADR-0109, and it knows about `users.avatar_key` —
    // which is not in the `files` table, and is therefore the thing a sweep
    // reading only that table would collect. This comment asked for a
    // mechanism for two years; the mechanism has a test named after it.
    await deps.pool.query(
      `UPDATE users SET avatar_key = $2, avatar_mime = $3 WHERE id = $1`,
      [auth.userId, stored.key, detected.mime],
    );

    ctx.send(200, { ok: true });
  });

  /** Remove it, back to the initial. */
  router.delete('/api/auth/avatar', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    await deps.pool.query(
      `UPDATE users SET avatar_key = NULL, avatar_mime = NULL WHERE id = $1`,
      [auth.userId],
    );
    ctx.send(200, { ok: true });
  });

  /**
   * Somebody's picture.
   *
   * Readable by anybody signed in, because a face appears beside every block
   * its owner wrote and in the presence bar of every page they open — deciding
   * per request who may see whom would be a permission check on every avatar on
   * screen, answering a question the page has already answered.
   */
  router.get('/api/users/:userId/avatar', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const row = await queryOne<{ avatar_key: string | null; avatar_mime: string | null }>(
      deps.pool,
      `SELECT avatar_key, avatar_mime FROM users WHERE id = $1`,
      [ctx.params['userId'] ?? ''],
    );
    if (!row?.avatar_key) {
      ctx.fail(404, 'not_found');
      return;
    }

    const bytes = await deps.store.get(row.avatar_key);
    ctx.res.writeHead(200, {
      'content-type': row.avatar_mime ?? 'application/octet-stream',
      // Content-addressed, so the bytes at a key never change; a new picture is
      // a new key. The cache can therefore be long and the interface never
      // shows a stale face.
      'content-length': String(bytes.length),
      'cache-control': 'private, max-age=604800, immutable',
    });
    ctx.res.end(bytes);
  });
}
