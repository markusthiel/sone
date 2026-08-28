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
import { detectType, isInlineImage, type FileStore } from './store.js';
import { sessionTokenFrom, shareTokenFrom } from '../http/auth.js';
import type { RequestContext, Router } from '../http/router.js';

export interface FileDeps {
  pool: Pool;
  store: FileStore;
  maxUploadBytes: number;
}

/**
 * Read a request body up to a limit.
 *
 * Its own reader rather than the router's `readJson`, because an upload is
 * megabytes of binary and the router's limit is 1 MB of text. The limit is
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
    .replace(/[\u0000-\u001f"\\]/g, '')
    .trim()
    .slice(0, 200);
  if (base.length > 0) return base;
  return `file.${extension}`;
}

/**
 * Who is asking, whether they are a member or arrived through a share link.
 *
 * A share visitor previously had no HTTP credential: the token authenticated the
 * WebSocket and nothing else, so every image in a shared page came back 401 and
 * failed to load. They now carry a cookie with the token, which is the only
 * shape an `<img src>` can send.
 *
 * The member cookie is tried first. Somebody who is signed in *and* opened a
 * share link should be judged by their own rights, which may be greater than
 * the link's — and never lesser.
 */
async function claimsForRequest(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<
  | { kind: 'ok'; claims: AccessClaims }
  /** Nothing was presented: the caller should sign in, or open the link. */
  | { kind: 'anonymous' }
  /** Something was presented and it does not grant this. */
  | { kind: 'rejected' }
> {
  const sessionToken = sessionTokenFrom(ctx);
  const shareToken = shareTokenFrom(ctx);

  // The distinction matters and a first version of this lost it. "No
  // credential" earns 401, which tells a signed-out browser to authenticate;
  // "a credential that does not grant this" earns 404, which does not confirm
  // that the file exists. Collapsing them into one answer would send a
  // signed-out member to a dead end instead of the login screen.
  if (!sessionToken && !shareToken) return { kind: 'anonymous' };

  if (sessionToken) {
    const claims = await resolveSessionClaims(pool, sessionToken, workspaceId);
    // Tried first: somebody signed in who also opened a share link should be
    // judged by their own rights, which may be greater than the link's and are
    // never lesser.
    if (claims) return { kind: 'ok', claims };
  }

  if (shareToken) {
    const resolved = await resolveShareTokenClaims(pool, shareToken);
    // A link needing a password is not authenticated by the cookie alone. The
    // sync connection handles unlocking; a file request is not the place to.
    if (resolved && !resolved.passwordRequired) {
      if (resolved.claims.workspaceId === workspaceId) {
        return { kind: 'ok', claims: resolved.claims };
      }
    }
  }

  return { kind: 'rejected' };
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
    const row = await queryOne<{ id: string }>(
      deps.pool,
      `INSERT INTO files
         (workspace_id, page_id, filename, mime_type, size_bytes, sha256,
          storage, storage_key, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
      ],
    );
    if (!row) throw new Error('failed to record uploaded file');

    ctx.send(201, {
      id: row.id,
      url: `/api/files/${row.id}`,
      filename,
      mimeType: detected.mime,
      sizeBytes: stored.sizeBytes,
      inline: isInlineImage(detected.mime),
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
      `SELECT id, workspace_id, page_id, filename, mime_type, size_bytes, storage_key
         FROM files WHERE id = $1`,
      [fileId],
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

    let bytes: Buffer;
    try {
      bytes = await deps.store.get(file.storage_key);
    } catch {
      // The row exists and the bytes do not, which means storage was restored
      // without its files or a backup was partial. Reported as a server error
      // rather than a 404, because the file is supposed to be there.
      ctx.fail(500, 'file_missing_from_storage');
      return;
    }

    serveFile(ctx.res, bytes, file.mime_type, file.filename);
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
function serveFile(
  res: ServerResponse,
  bytes: Buffer,
  mimeType: string,
  filename: string,
): void {
  const inline = isInlineImage(mimeType);

  res.writeHead(200, {
    'content-type': mimeType,
    'content-length': bytes.length,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': 'private, max-age=31536000, immutable',
  });
  res.end(bytes);
}

/** Exported for tests. */
export { readBinary, safeFilename };
