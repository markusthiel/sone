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
  restrictedAtSql,
} from '../auth/claims.js';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLinkSummary,
} from '../auth/share.js';
import { commentAuthorsOf } from '../comments/routes.js';
import { addressLocale } from '../i18n/locale.js';
import type { Letter } from '../mail/letter.js';
import { words, type AddressForm } from '../mail/words.js';
import { decryptShareToken } from '../auth/shareTokenStore.js';
import { queryOne, queryRows } from '../db/pool.js';
import { atLeast as pageAtLeast, resolvePageAccess } from '../pages/access.js';
import { loadWorkspaceStanding } from '../auth/standing.js';
import { requireSession, sessionTokenFrom, setShareCookie } from './auth.js';
import { resolveSessionId } from '../auth/session.js';
import type { RequestContext, Router } from './router.js';

export interface ShareDeps {
  pool: Pool;
  /** Used to build the full URL a person copies. */
  publicUrl: string;
  /** Encrypts stored tokens so a link can be shown again. */
  secretKey: string;
  /** Whether the share cookie gets the Secure attribute. */
  secureCookies: boolean;
  /*
   * Handing a link over by mail (ADR-0126).
   *
   * All four are optional, so a suite that is not about mail need not supply
   * them — and an instance with no relay is a normal instance rather than a
   * broken one (ADR-0059). Functions rather than values, like everywhere else
   * here: an operator configures the relay while the process runs.
   */
  canSendMail?: () => Promise<boolean>;
  /** How much a mail may name (ADR-0058). Absent is the cautious answer. */
  emailDetail?: () => Promise<'title' | 'workspace'>;
  instanceName?: () => Promise<string>;
  /** „du" or „Sie", one setting for everything this instance says (ADR-0133). */
  addressForm?: () => Promise<AddressForm>;
  sendLetter?: (to: string, letter: Letter) => Promise<void>;
}

/**
 * An address, minimally.
 *
 * Not a validator for the specification — nothing short of sending can decide
 * that — but enough that an obvious typo is refused before a relay is asked to
 * do something with it. A dot in the domain, because `a@b` is a local name and
 * not an address anybody meant to type.
 */
const ADDRESS = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

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

    /*
     * Whether an account is present, decided here and handed over (ADR-0101).
     *
     * A link with `allow_anonymous: false` admits somebody with an account and
     * refuses a nameless visitor, so the resolver has to be told which this is.
     * Resolved before the token so there is one answer for both branches below.
     */
    const sessionToken = sessionTokenFrom(ctx);
    const signedIn = sessionToken
      ? (await resolveSessionId(deps.pool, sessionToken)) !== null
      : false;

    const resolved = await resolveShareTokenClaims(deps.pool, token, { signedIn });
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

    /*
     * The link is for people with accounts (ADR-0101).
     *
     * Answered like the password case above — a state, not a failure — and
     * before anything about the page is read, so the answer says what is needed
     * and nothing about what is behind it. This used to throw out of the
     * resolver, uncaught, as HTTP 500: the interface then showed the "what is
     * your name" form for a link that would never admit a nameless visitor.
     */
    if (resolved.signInRequired) {
      ctx.send(200, { requiresSignIn: true });
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

  /**
   * What a link actually reaches: its page, and the subtree when it says so.
   *
   * Without this a shared **folder** is a shared nothing. The link view renders
   * one page, a folder has no body, and there is no navigation on that path —
   * so somebody sent a link to a section of the handbook, and what arrived was
   * an empty page with its name at the top. Reported exactly that way: "kann er
   * nur den Ordner sehen und sonst nichts".
   *
   * The scope is the link's, not the workspace's. A visitor holding a link is
   * not a member and must not learn what else exists here — so this walks down
   * from the page the link names and stops there, rather than filtering the
   * workspace tree and hoping the filter is right. A list that starts from
   * everything and removes is one forgotten condition away from a disclosure;
   * one that starts from the grant cannot be.
   *
   * Every row is still put through `effectiveRole`, because the link's own
   * grant is not the only rule in play: a cap set on a section lowers what the
   * link gives (ADR-0087), and a restricted page below the scope withholds
   * itself.
   */
  router.get('/api/share/:token/pages', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    if (token === '') {
      ctx.fail(404, 'not_found');
      return;
    }

    const resolved = await resolveShareTokenClaims(deps.pool, token);
    // A link that needs a password or an account grants nothing yet, and its
    // claims carry no grants — so this would fail closed anyway. Said out loud
    // because "it happens to be empty" is a reason that stops being true
    // (ADR-0101).
    if (!resolved || resolved.passwordRequired || resolved.signInRequired) {
      ctx.fail(404, 'not_found');
      return;
    }

    const scope = resolved.claims.grants[0];
    if (!scope) {
      ctx.fail(404, 'not_found');
      return;
    }

    const rows = await queryRows<{
      id: string;
      parent_page_id: string | null;
      title: string;
      kind: string;
      idx: string;
      icon: unknown;
      ancestor_ids: string[];
      workspace_id: string;
      restricted_at: string | null;
    }>(
      deps.pool,
      // The scope page itself, plus everything under it when the link carries
      // the subtree. `ancestor_ids` makes that a containment test rather than
      // a walk — the same column ADR-0006 added for exactly this question.
      // The icon travels too. Without it the shared tree drew a plain folder
      // and a plain page for everything, while the title above the page showed
      // the real one — so the same entry had two appearances on one screen.
      `SELECT p.id, p.parent_page_id, p.title, p.kind, p.idx, p.icon,
              p.ancestor_ids, p.workspace_id,
              ${restrictedAtSql('p')} AS restricted_at
         FROM pages p
        WHERE p.archived_at IS NULL
          AND p.kind NOT IN ('row', 'container')
          AND (p.id = $1 OR ($2 AND $1 = ANY(p.ancestor_ids)))
        ORDER BY p.idx, p.id`,
      [scope.scopePageId, scope.includeSubtree],
    );

    /*
     * The role, kept rather than compared with null and dropped (ADR-0095).
     *
     * The same shape as the workspace tree route, and the same reason: it is
     * being computed per row anyway, to decide which rows a link may see, and
     * without it every entry reaches the visitor looking alike. A link that
     * grants `commenter` and one that grants `viewer` produce identical trees,
     * so the view has nothing to ask before offering something.
     */
    const pages: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const role = effectiveRole(resolved.claims, {
        id: row.id,
        workspaceId: row.workspace_id,
        ancestorIds: row.ancestor_ids,
        // Fetched per row rather than assumed: a restricted page below the
        // shared section withholds itself from a link as from anybody, and
        // the link's grant is not a way past it.
        restrictedAt: row.restricted_at,
      });
      if (role === null) continue;
      pages.push({
        id: row.id,
        // Null for the scope page itself, so the view can draw it as the root
        // of what was shared rather than as an orphan.
        parentPageId: row.id === scope.scopePageId ? null : row.parent_page_id,
        title: row.title,
        kind: row.kind === 'folder' || row.kind === 'canvas' ? row.kind : 'page',
        idx: row.idx,
        icon: row.icon ?? null,
        role,
      });
    }

    ctx.send(200, { pages, scopePageId: scope.scopePageId });
  });

  /**
   * The names behind the comments on one page (ADR-0090).
   *
   * A visitor holding a link can read the page's comment threads, and a thread
   * whose authors have no names is barely a thread: "somebody objected here" is
   * not much better than no comment at all. The panel resolves an author id
   * against a list of people, and a visitor is given an empty one on purpose.
   *
   * The obvious fix — hand them the workspace's members — is a directory of
   * everybody who works here, given to whoever forwards a link. So this is the
   * narrow answer: the ids come from **this page's own document**, never from
   * the request, so it cannot be asked "whose id is this"; and it returns
   * names, never addresses.
   *
   * Scoped like everything else on this path: the page must be one the link
   * actually reaches, checked with `effectiveRole` rather than by trusting the
   * grant, which is the rule the page list above follows for the same reason.
   */
  router.get('/api/share/:token/pages/:pageId/authors', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    const pageId = ctx.params['pageId'] ?? '';
    if (token === '' || pageId === '') {
      ctx.fail(404, 'not_found');
      return;
    }

    const resolved = await resolveShareTokenClaims(deps.pool, token);
    // A link that needs a password or an account grants nothing yet, and its
    // claims carry no grants — so this would fail closed anyway. Said out loud
    // because "it happens to be empty" is a reason that stops being true
    // (ADR-0101).
    if (!resolved || resolved.passwordRequired || resolved.signInRequired) {
      ctx.fail(404, 'not_found');
      return;
    }

    const page = await loadPageLocation(deps.pool, pageId);
    if (!page || effectiveRole(resolved.claims, page) === null) {
      ctx.fail(404, 'not_found');
      return;
    }

    ctx.send(200, { authors: await commentAuthorsOf(deps.pool, pageId) });
  });

  /**
   * Everything shared in this workspace, from both ends (ADR-0026).
   *
   * Asked for as "ein Menüpunkt mit Freigaben. So dass man sieht welche Seiten
   * man selbst freigegeben hat und welche für mich freigegeben wurden."
   *
   * Until now sharing could only be seen **from the page**: open it, open the
   * dialog, read the list. That is fine for checking one page and useless for
   * the question people actually have, which is "what have I let out, and what
   * am I responsible for" — a question about a hundred pages, asked when
   * somebody leaves or a project ends. A rule nobody can enumerate is a rule
   * nobody reviews.
   *
   * Three lists, because there are three kinds of answer and they are not
   * interchangeable:
   *
   *   - **links** — a URL anybody holding it can open. The one to review first,
   *     because it is the one that leaves the building.
   *   - **granted** — pages this person gave somebody else, directly or to a
   *     group.
   *   - **received** — pages somebody else gave *them*.
   *
   * Scoped to what the asker may see. `granted` is what they granted, not
   * everything granted in the workspace: a member who may share a page they
   * administer must not thereby learn who else has access to the rest of the
   * workspace. Somebody who administers the whole place sees it all anyway,
   * because every page is a page they may manage — which the per-page check
   * below is what establishes.
   */
  router.get('/api/workspaces/:workspaceId/shares', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const workspaceId = ctx.params['workspaceId'] ?? '';
    const standing = await loadWorkspaceStanding(deps.pool, session.userId, workspaceId);
    if (!standing.isMember) {
      // The same answer as a workspace that does not exist.
      ctx.fail(404, 'not_found');
      return;
    }

    /*
     * `granted_by = $2` rather than "every grant on a page they administer".
     *
     * The narrower rule is the honest one for a list titled "what I shared":
     * a grant somebody else made is not this person's to review, and showing it
     * here would make the page a directory of who has access to what — which
     * is the disclosure ADR-0026 spends its length avoiding.
     *
     * An administrator loses nothing by it: they can open any page and see its
     * full list. What they lose is a list of other people's decisions
     * presented as their own.
     */
    const granted = await queryRows<{
      page_id: string;
      title: string;
      subject: string;
      access: string;
      include_subtree: boolean;
      granted_at: Date;
      kind: string;
    }>(
      deps.pool,
      `SELECT pp.page_id, p.title, u.display_name AS subject, pp.role::text AS access,
              pp.include_subtree, pp.granted_at, 'person' AS kind
         FROM page_permissions pp
         JOIN pages p ON p.id = pp.page_id
         JOIN users u ON u.id = pp.user_id
        WHERE pp.granted_by = $2 AND p.workspace_id = $1 AND p.archived_at IS NULL
        UNION ALL
       SELECT gp.page_id, p.title, g.name AS subject, gp.role::text AS access,
              gp.include_subtree, gp.granted_at, 'group' AS kind
         FROM page_group_permissions gp
         JOIN pages p ON p.id = gp.page_id
         JOIN groups g ON g.id = gp.group_id
        WHERE gp.granted_by = $2 AND p.workspace_id = $1 AND p.archived_at IS NULL
        ORDER BY granted_at DESC`,
      [workspaceId, session.userId],
    );

    /*
     * What was given to them: their own grants and their groups'. Who granted
     * it is named, because "who do I ask about this" is the question somebody
     * has when they find a page they did not expect to have.
     *
     * **Not what they gave themselves** (ADR-0114). The two lists were written
     * as "grants I made" and "grants that reach me", which are not exclusive:
     * share a page with a group you are in — the ordinary way to give a team
     * access — and the same row is in both, the second one saying it was shared
     * with you by yourself.
     *
     * Reported as "auf einmal sind da von mir geteilte Seiten dann für mich
     * freigegebene Seiten", which is exactly what it is. The question this list
     * answers is "who gave me this", and the answer "you did" is the one case
     * where nobody needs to be told.
     */
    const received = await queryRows<{
      page_id: string;
      title: string;
      access: string;
      include_subtree: boolean;
      granted_at: Date;
      granted_by: string | null;
      via_group: string | null;
    }>(
      deps.pool,
      `SELECT pp.page_id, p.title, pp.role::text AS access, pp.include_subtree,
              pp.granted_at, u.display_name AS granted_by, NULL AS via_group
         FROM page_permissions pp
         JOIN pages p ON p.id = pp.page_id
         LEFT JOIN users u ON u.id = pp.granted_by
        WHERE pp.user_id = $2 AND p.workspace_id = $1 AND p.archived_at IS NULL
          -- IS DISTINCT FROM, not <>: granted_by is nullable (the granter's
          -- account can be gone), and a null there compares to nothing.
          -- (No backticks in here. That mistake has now ended a template
          -- literal ten times in this project.)
          AND pp.granted_by IS DISTINCT FROM $2
        UNION ALL
       SELECT gp.page_id, p.title, gp.role::text AS access, gp.include_subtree,
              gp.granted_at, u.display_name AS granted_by, g.name AS via_group
         FROM page_group_permissions gp
         JOIN group_members gm ON gm.group_id = gp.group_id
         JOIN groups g ON g.id = gp.group_id
         JOIN pages p ON p.id = gp.page_id
         LEFT JOIN users u ON u.id = gp.granted_by
        WHERE gm.user_id = $2 AND p.workspace_id = $1 AND p.archived_at IS NULL
          AND gp.granted_by IS DISTINCT FROM $2
        ORDER BY granted_at DESC`,
      [workspaceId, session.userId],
    );

    const links = await queryRows<{
      id: string;
      scope_page_id: string;
      title: string;
      role: string;
      include_subtree: boolean;
      has_password: boolean;
      expires_at: Date | null;
      created_at: Date;
      mine: boolean;
    }>(
      deps.pool,
      // Every live link on a page this person may manage, not only their own.
      // A link is a URL in somebody's inbox: the question "what is out there"
      // has to be answerable by whoever is responsible for the page, or the
      // list is a list of the links you already remembered.
      `SELECT st.id, st.scope_page_id, p.title, st.role::text AS role, st.include_subtree,
              st.password_hash IS NOT NULL AS has_password, st.expires_at, st.created_at,
              st.created_by = $2 AS mine
         FROM share_tokens st
         JOIN pages p ON p.id = st.scope_page_id
        WHERE p.workspace_id = $1
          AND st.revoked_at IS NULL
          AND (st.expires_at IS NULL OR st.expires_at > now())
          AND p.archived_at IS NULL
        ORDER BY st.created_at DESC`,
      [workspaceId, session.userId],
    );

    // Each link is kept only if this person may manage the page it opens.
    // Asked per row through the one resolver rather than reproduced as a
    // condition here, which is the mistake ADR-0086 was written about.
    const visibleLinks = [];
    for (const link of links) {
      const access = await resolvePageAccess(deps.pool, {
        pageId: link.scope_page_id,
        userId: session.userId,
      });
      if (!pageAtLeast(access.access, 'admin')) continue;
      visibleLinks.push({
        id: link.id,
        pageId: link.scope_page_id,
        pageTitle: link.title,
        role: link.role,
        includeSubtree: link.include_subtree,
        hasPassword: link.has_password,
        expiresAt: link.expires_at,
        createdAt: link.created_at,
        mine: link.mine,
      });
    }

    ctx.send(200, {
      links: visibleLinks,
      granted: granted.map((row) => ({
        pageId: row.page_id,
        pageTitle: row.title,
        subject: row.subject,
        subjectKind: row.kind,
        access: row.access,
        includeSubtree: row.include_subtree,
        grantedAt: row.granted_at,
      })),
      received: received.map((row) => ({
        pageId: row.page_id,
        pageTitle: row.title,
        access: row.access,
        includeSubtree: row.include_subtree,
        grantedAt: row.granted_at,
        grantedBy: row.granted_by,
        /** Named when it came through a group, so "why do I have this" answers itself. */
        viaGroup: row.via_group,
      })),
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

  /**
   * Send the link to somebody (ADR-0126).
   *
   * Asked for as *„Seiten teilen per Mail, Links teilen per Mail, Gast-Links
   * per Mail."* A guest link is one of these with `allowAnonymous` on, so it is
   * this route as well — one form, one letter.
   *
   * **The token never travels in the request.** The browser says who to write
   * to and may add a sentence; the server decrypts the link it already holds
   * and builds the URL. A route that accepted a URL to mail would be a route
   * that mails *any* URL, from an authenticated account, to anywhere.
   *
   * A share mail does not break ADR-0058 — it is an invitation **to** content
   * rather than content — but it is the mail most likely to. What it may say is
   * the link, who sent it, when it expires, and one sentence the sender typed.
   */
  router.post('/api/pages/:pageId/share-links/:linkId/send', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await requirePageAdmin(deps.pool, ctx, pageId);
    if (!auth) return;

    let body: { to?: string; note?: string };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const to = (body.to ?? '').trim();
    if (!ADDRESS.test(to) || to.length > 320) {
      ctx.fail(422, 'invalid_address');
      return;
    }

    /*
     * Answered rather than assumed absent.
     *
     * The interface hides the control where there is no relay, and that is the
     * right shape for it (ADR-0059). The route still has to answer, because an
     * operator may switch mail off between the page loading and the button
     * being pressed — and "sent" would be a lie the sender goes on to act on.
     */
    if (!deps.sendLetter || !(await deps.canSendMail?.())) {
      ctx.fail(422, 'no_relay');
      return;
    }

    const row = await queryOne<{
      token_encrypted: Buffer | null;
      expires_at: Date | null;
      password_hash: string | null;
      title: string;
      workspace_name: string;
      sender: string;
      workspace_id: string;
    }>(
      deps.pool,
      // One query, because every part of the letter comes from the same three
      // rows and a second round trip would be a second chance to describe a
      // different link than the one being sent.
      `SELECT t.token_encrypted, t.expires_at, t.password_hash,
              p.title, w.name AS workspace_name, u.display_name AS sender,
              w.id AS workspace_id
         FROM share_tokens t
         JOIN pages p ON p.id = t.scope_page_id
         JOIN workspaces w ON w.id = p.workspace_id
         JOIN users u ON u.id = $3
        WHERE t.id = $1 AND t.scope_page_id = $2 AND t.revoked_at IS NULL`,
      [ctx.params['linkId'] ?? '', pageId, auth.userId],
    );
    if (!row) {
      ctx.fail(404, 'not_found');
      return;
    }

    const token = row.token_encrypted && decryptShareToken(row.token_encrypted, deps.secretKey);
    if (!token) {
      // The same answer the "show it again" route gives: the link exists and
      // this copy of it cannot be recovered, so the interface can offer to
      // replace it rather than implying the link is gone.
      ctx.fail(409, 'token_not_recoverable');
      return;
    }

    const detail = (await deps.emailDetail?.()) ?? 'workspace';
    const url = `${deps.publicUrl.replace(/\/$/, '')}/s/${token}/p/${pageId}`;
    const where = detail === 'title' ? row.title || 'a page' : row.workspace_name;

    /*
     * Which language (ADR-0133).
     *
     * The old note here said English *„because the recipient of a share mail
     * usually has no account here, so there is nobody to ask what they read"*.
     * Usually. A colleague on this instance being sent a link has an account
     * with a language on it, and asking costs one query; where there is truly
     * nobody, the workspace the page lives in is a better guess than English,
     * for the same reason a workspace has a language at all.
     */
    const locale = await addressLocale(deps.pool, to, row.workspace_id);
    const say = words(locale, (await deps.addressForm?.()) ?? 'informal');

    const lines: Array<{ text: string; url?: string }> = [
      { text: say('share.line', { by: row.sender, what: where }) },
    ];
    // The sender's own sentence, and the only content in the letter — their
    // words rather than the page's, which is the distinction that keeps this an
    // invitation rather than a leak. Never a link of its own: a URL somebody
    // typed into a note is a URL this instance would be vouching for.
    const note = (body.note ?? '').trim().slice(0, 500);
    if (note) lines.push({ text: note });

    if (row.password_hash) {
      // Announced, never included. A link with a password and the password in
      // the same message is a link with no password — and adding it is the
      // obvious "helpful" thing for a later change to do.
      lines.push({ text: say('share.password') });
    }
    if (row.expires_at) {
      lines.push({
        text: say('share.until', { when: row.expires_at.toISOString().slice(0, 10) }),
      });
    }

    await deps.sendLetter(to, {
      // The subject names the sender and not the page: it is the half that is
      // never in doubt, and a subject line is the part of a mail most likely to
      // be read over somebody's shoulder.
      subject: say('share.subject', { by: row.sender }),
      // The instance's own name, which is not a sentence and has no
      // translation — it is whatever the operator called this server.
      heading: `${await (deps.instanceName?.() ?? Promise.resolve('SONE'))}`,
      lines,
      action: { label: say('share.action'), url },
      footer: [say('share.footer')],
      baseUrl: deps.publicUrl,
      locale,
    });

    ctx.send(200, { sent: true });
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
