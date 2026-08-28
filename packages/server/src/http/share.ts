/**
 * SONE — share link routes.
 *
 * The logic already existed in `auth/share.ts`; this is the part that lets
 * anybody reach it. Until now a page could be shared only by writing SQL.
 *
 * Three decisions worth stating, because they are the ones that make a share
 * link either safe or a liability.
 *
 * **The token is shown once.** Only its hash is stored, so a link that is lost
 * is regenerated rather than recovered. That is the same reasoning as a
 * password: a listing that can display existing tokens turns one leaked
 * screenshot of the sharing dialog into every link on the page.
 *
 * **Only an admin of the page may share it.** An editor can change a page; that
 * is not the same as deciding who else may see it. Handing out access is the
 * one thing that cannot be undone by editing.
 *
 * **A link never grants admin.** `createShareLink` refuses it, and the route
 * refuses it earlier so the error is about the request rather than about the
 * internals. Administration is not something a forwarded URL should confer.
 */

import type { Pool } from 'pg';

import { AuthError } from '../auth/password.js';
import {
  effectiveRole,
  loadPageLocation,
  resolveSessionClaims,
  resolveShareTokenClaims,
} from '../auth/claims.js';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLinkSummary,
} from '../auth/share.js';
import { decryptShareToken } from '../auth/shareTokenStore.js';
import { queryOne } from '../db/pool.js';
import { sessionTokenFrom, setShareCookie } from './auth.js';
import type { RequestContext, Router } from './router.js';

export interface ShareDeps {
  pool: Pool;
  /** Used to build the full URL a person copies. */
  publicUrl: string;
  /** Encrypts stored tokens so a link can be shown again. */
  secretKey: string;
  /** Whether the share cookie gets the Secure attribute. */
  secureCookies: boolean;
}

/** Roles a link may carry. `admin` is absent on purpose. */
const SHARE_ROLES = new Set(['viewer', 'commenter', 'editor']);

/**
 * Resolve the caller and require admin rights *on the page*.
 *
 * Page-level rather than workspace-level, because a subtree grant can make
 * somebody the administrator of a branch without making them one of the
 * workspace — and it is their branch to share.
 */
async function requirePageAdmin(
  pool: Pool,
  ctx: RequestContext,
  pageId: string,
): Promise<{ userId: string; workspaceId: string } | null> {
  const page = await loadPageLocation(pool, pageId);
  if (!page) {
    ctx.fail(404, 'not_found');
    return null;
  }

  const token = sessionTokenFrom(ctx);
  if (!token) {
    ctx.fail(401, 'not_authenticated');
    return null;
  }

  const claims = await resolveSessionClaims(pool, token, page.workspaceId);
  const role = claims ? effectiveRole(claims, page) : null;
  if (role === null) {
    ctx.fail(404, 'not_found');
    return null;
  }

  // A share-link visitor cannot create share links, whatever role the link
  // carries. Otherwise an editor link is silently an invitation to widen it.
  if (claims!.principal.kind === 'anonymous') {
    ctx.fail(403, 'not_authorized');
    return null;
  }

  if (role !== 'admin') {
    ctx.fail(403, 'not_authorized');
    return null;
  }

  return { userId: claims!.principal.userId, workspaceId: page.workspaceId };
}

const summarise = (
  link: ShareLinkSummary,
): Record<string, unknown> => ({
  id: link.id,
  scopePageId: link.scopePageId,
  includeSubtree: link.includeSubtree,
  role: link.role,
  hasPassword: link.hasPassword,
  allowAnonymous: link.allowAnonymous,
  activeSessions: link.activeSessions,
  expiresAt: link.expiresAt,
  createdAt: link.createdAt,
  // Deliberately no token. Only the hash is stored, so it could not be
  // returned even if that were wanted.
});

export function registerShareRoutes(router: Router, deps: ShareDeps): void {
  /**
   * The links on a page.
   *
   * Descendant links are included, so somebody looking at a folder can see that
   * a page inside it is shared. A link two levels down is exactly the one that
   * gets forgotten.
   */
  /**
   * What a share token opens.
   *
   * A link is `/s/<token>`, and until now nothing could turn that into a page —
   * so a visitor arrived at a client that had a credential and no idea what to
   * open, and sat on "Opening…" indefinitely. Every link ever created did this.
   *
   * Newly created links now carry the page in the path as well, but this
   * endpoint is the fix rather than the belt: links already sent out have no
   * page in them, and a link is a public contract (ADR-0016) — one sent today
   * has to work in two years.
   *
   * The token is the credential, so no session is needed. What comes back is
   * the minimum required to proceed: the page to open, and whether a password
   * is wanted first. The title is withheld until the link is unlocked, because
   * a password protects the content and a title is content.
   */
  router.get('/api/share/:token', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    if (token === '') {
      ctx.fail(404, 'not_found');
      return;
    }

    const resolved = await resolveShareTokenClaims(deps.pool, token);
    if (!resolved) {
      // Revoked, expired, or never existed — one answer for all three. Telling
      // them apart would let somebody probe for tokens that once worked.
      ctx.fail(404, 'not_found');
      return;
    }

    if (resolved.passwordRequired) {
      ctx.send(200, { requiresPassword: true });
      return;
    }

    const scope = resolved.claims.grants[0];
    if (!scope) {
      ctx.fail(404, 'not_found');
      return;
    }

    const page = await queryOne<{ title: string; kind: string }>(
      deps.pool,
      `SELECT title, kind FROM pages WHERE id = $1 AND archived_at IS NULL`,
      [scope.scopePageId],
    );
    if (!page) {
      // The page was archived after the link was made. A dead link is a clearer
      // answer than an empty document.
      ctx.fail(404, 'not_found');
      return;
    }

    // The visitor gets a cookie carrying the token.
    //
    // Without it a share visitor has no HTTP credential at all — the token
    // authenticated the WebSocket and nothing else — so every image in a shared
    // page returned 401. An `<img src>` cannot send a header, so a cookie is
    // the only shape that works.
    setShareCookie(ctx, token, deps.secureCookies);

    ctx.send(200, {
      requiresPassword: false,
      pageId: scope.scopePageId,
      title: page.title,
      kind: page.kind,
      role: scope.role,
    });
  });

  router.get('/api/pages/:pageId/share-links', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await requirePageAdmin(deps.pool, ctx, pageId);
    if (!auth) return;

    const links = await listShareLinks(deps.pool, pageId, true);
    ctx.send(200, { links: links.map(summarise) });
  });

  /** Create a link. The token is in this response and nowhere else, ever. */
  router.post('/api/pages/:pageId/share-links', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await requirePageAdmin(deps.pool, ctx, pageId);
    if (!auth) return;

    let body: {
      role?: string;
      includeSubtree?: boolean;
      allowAnonymous?: boolean;
      password?: string | null;
      expiresInDays?: number | null;
    };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const role = body.role ?? 'viewer';
    if (!SHARE_ROLES.has(role)) {
      // Checked here as well as in createShareLink, so a request for an admin
      // link fails with a message about the request rather than about
      // credentials.
      ctx.fail(422, 'invalid_role');
      return;
    }

    // A password on a link is optional, but an empty string is not a password —
    // storing one would produce a link that looks protected and is not.
    const password =
      typeof body.password === 'string' && body.password.trim().length > 0
        ? body.password
        : null;

    const expiresInDays =
      typeof body.expiresInDays === 'number' && body.expiresInDays > 0
        ? Math.min(Math.floor(body.expiresInDays), 3650)
        : null;

    try {
      const created = await createShareLink(deps.pool, {
        pageId,
        createdBy: auth.userId,
        role: role as 'viewer' | 'commenter' | 'editor',
        includeSubtree: body.includeSubtree ?? true,
        allowAnonymous: body.allowAnonymous ?? true,
        password,
        expiresInDays,
        secretKey: deps.secretKey,
      });

      ctx.send(201, {
        id: created.shareTokenId,
        token: created.token,
        // The page is in the path as well as in the token.
        //
        // Not required — /api/share/:token resolves a bare token — but it means
        // a link works before that request completes, and it survives the
        // endpoint being unavailable. The slug is deliberately absent: a title
        // in a URL that was emailed a year ago is a lie waiting to happen, and
        // paths.ts already treats it as decorative.
        url:
          `${deps.publicUrl.replace(/\/$/, '')}/s/${created.token}` +
          `/p/${pageId}`,
        expiresAt: created.expiresAt,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        ctx.fail(422, err.code);
        return;
      }
      throw err;
    }
  });

  /**
   * Revoke a link.
   *
   * Immediate: the sessions opened through it are removed too, or somebody
   * already reading would keep reading until their session expired — which is
   * not what "revoke" means to the person pressing it.
   */
  /**
   * Show an existing link again.
   *
   * The first design refused this, reasoning from passwords. It is the wrong
   * analogy: a password is the person's own secret and must be recoverable by
   * nobody, while a share link is a capability its issuer can mint again at
   * will. Refusing to show them the one they already issued protected nothing
   * and cost them the link.
   *
   * Requires administration of the page — the same right needed to create one.
   * Anyone who can reach this could issue an equivalent link in one more
   * request, so this grants no access that was not already available.
   */
  router.get('/api/pages/:pageId/share-links/:linkId/url', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await requirePageAdmin(deps.pool, ctx, pageId);
    if (!auth) return;

    const row = await queryOne<{ token_encrypted: Buffer | null }>(
      deps.pool,
      `SELECT token_encrypted FROM share_tokens
        WHERE id = $1 AND scope_page_id = $2 AND revoked_at IS NULL`,
      [ctx.params['linkId'] ?? '', pageId],
    );
    if (!row) {
      ctx.fail(404, 'not_found');
      return;
    }

    if (row.token_encrypted === null) {
      // Created before links could be kept, or under a secret that has since
      // changed. Named separately from a missing link so the interface can
      // offer to replace it rather than implying the link is gone.
      ctx.fail(409, 'token_not_recoverable');
      return;
    }

    const token = decryptShareToken(row.token_encrypted, deps.secretKey);
    if (token === null) {
      ctx.fail(409, 'token_not_recoverable');
      return;
    }

    ctx.send(200, {
      url: `${deps.publicUrl.replace(/\/$/, '')}/s/${token}/p/${pageId}`,
    });
  });

  router.delete('/api/pages/:pageId/share-links/:linkId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await requirePageAdmin(deps.pool, ctx, pageId);
    if (!auth) return;

    const linkId = ctx.params['linkId'] ?? '';

    // Checked against this page's links rather than revoked by id alone, or an
    // administrator of one page could revoke a link belonging to another.
    const links = await listShareLinks(deps.pool, pageId, true);
    if (!links.some((link) => link.id === linkId)) {
      ctx.fail(404, 'not_found');
      return;
    }

    await revokeShareLink(deps.pool, linkId);
    await deps.pool.query(`DELETE FROM share_sessions WHERE share_token_id = $1`, [linkId]);

    ctx.send(200, { id: linkId, revoked: true });
  });
}
