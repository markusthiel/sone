/**
 * SONE — capability resolution.
 *
 * The single authorisation path (ADR-0006). Everything — a member's session, a
 * guest's session, an anonymous visitor holding a share link — is reduced to
 * the same `AccessClaims`, and every permission decision is then one function
 * over those claims.
 *
 * Two rules that are easy to get wrong and expensive to fix later:
 *
 *   1. The ACL is re-checked on every subdocument open, not only on connect.
 *      Otherwise a token scoped to page A can be used to pull page B.
 *   2. Share scope is the page subtree, not the single page. Without that, a
 *      shared link breaks the moment somebody adds a subpage.
 *
 * `pages.ancestor_ids` makes rule 2 one indexed containment test instead of a
 * recursive CTE on every open, which is why the column exists.
 */

import { ROLE_ORDER, type Role } from '@sone/core';
import type { Pool, PoolClient } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import { AuthError, hashToken } from './password.js';
import { resolveSession } from './session.js';
import { loadWorkspaceStanding } from './standing.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export type Principal =
  | { kind: 'user'; userId: string; displayName: string }
  | { kind: 'guest'; userId: string; displayName: string }
  | { kind: 'anonymous'; sessionId: string; displayName: string };

export interface Grant {
  scopePageId: string;
  includeSubtree: boolean;
  role: Role;
  source: 'share_token' | 'page_permission' | 'page_group_permission';
  tokenId?: string;
}

export interface AccessClaims {
  principal: Principal;
  workspaceId: string;
  /** Null for anonymous share-link sessions: they are not members. */
  workspaceRole: WorkspaceRole | null;
  /**
   * What the workspace gives them on a page carrying no rules of its own
   * (ADR-0087).
   *
   * Resolved when the claims are built, by `loadWorkspaceStanding` — the same
   * function `resolvePageAccess` uses, so the tree and the document cannot
   * disagree about what a role means. Null grants nothing without an explicit
   * grant, which is what `guest` is, and what an anonymous share-link session
   * is.
   *
   * Carried on the claims rather than derived from `workspaceRole` here,
   * because a role's meaning is a row now: a custom role has no name in the
   * old four-word vocabulary, and a `switch` over those four words could only
   * ever answer for the four.
   */
  pageLevel: Role | null;
  grants: Grant[];
  /**
   * Ceilings set on pages in this workspace (ADR-0087).
   *
   * On the claims rather than on the page, and beside the grants rather than
   * anywhere else, for one reason each.
   *
   * **Beside the grants** because that is what a cap is the mirror of: a grant
   * names a page and a subtree and raises what applies there, a cap names a
   * page and a subtree and lowers it. Reading them in one place is what lets
   * `effectiveRole` say "widen, then lower" as two lines rather than as a rule
   * spread over two files.
   *
   * **On the claims** because the alternative — a field on `PageLocation` —
   * was tried and is wrong. A dozen call sites build a location from a row
   * they already have, and every one of them would have had to learn to fetch
   * a cap; the ones that forgot would allow a write to a page the tree shows
   * as read-only. That is precisely the failure ADR-0086 was written about,
   * and the compiler pointing at twelve sites was the warning.
   *
   * A cap is not filtered by the visibility condition either, which is why
   * "the listing already excluded it" — the reason those sites pass
   * `restricted: false` — could never have been said about a cap. A capped
   * page is visible; that is the point of it.
   */
  caps: Cap[];
}

/** A ceiling on a page and, when it says so, everything under it. */
export interface Cap {
  scopePageId: string;
  includeSubtree: boolean;
  maxLevel: Role;
}

const atLeast = (have: Role, need: Role): boolean =>
  ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need);

// --- resolution ------------------------------------------------------------

/**
 * Resolve a session token to claims within a workspace.
 *
 * Returns null when the session is unusable or the user is not a member of
 * the requested workspace. A guest is a member row with role 'guest', so a
 * guest with no page grants resolves to claims that authorise nothing — which
 * is correct and must not be mistaken for an error.
 */
/**
 * What somebody is in a workspace, or null if they are not in it.
 *
 * Exported from here because this is the module about who somebody is, and the
 * same three lines had been written five times across four files — one of them
 * already a private helper called `roleIn`. Five copies of a membership lookup
 * is five places to forget a condition the day one is added.
 */
export async function roleIn(
  db: Pool | PoolClient,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | 'custom' | null> {
  /*
   * Answered from the role row rather than from the enum column (ADR-0087).
   *
   * `'custom'` is new and is the point of the type change. Null has always
   * meant "not in this workspace", and half the callers branch on exactly
   * that; a member holding a role with no name in the old four-word
   * vocabulary must not be mistaken for somebody who is not here at all. So
   * they get a word that is not one of the four, which every existing
   * comparison against `'owner'` or `'admin'` already handles correctly.
   *
   * Those comparisons are what ADR-0087's second step replaces with named
   * rights. Until then, a workspace with no custom roles behaves exactly as
   * before — and none can exist yet, because nothing creates one.
   */
  const standing = await loadWorkspaceStanding(db, userId, workspaceId);
  if (!standing.isMember) return null;
  return standing.role ?? 'custom';
}

/**
 * Every page grant somebody holds in a workspace — their own and their groups'.
 *
 * One function, because there were two copies of the personal half and neither
 * had the group half. `resolvePageAccess` in pages/access.ts has read
 * `page_group_permissions` since groups existed, and it answers for the tree,
 * search and the listings; this file answers for **sync**, page reads and
 * writes, files, collections and import. So a page granted to a group was
 * listed in the tree and refused when it was opened, and the end-to-end test
 * written to prove group rights worked went through the routes that use the
 * other resolver. See ADR-0086.
 *
 * Both halves in one query rather than two, and returned as separate grants
 * rather than a maximum: `effectiveRole` already takes the most permissive
 * grant in scope, and a group grant must never be able to reduce what somebody
 * could already do (ADR-0026).
 */
async function pageGrantsFor(
  db: Pool | PoolClient,
  userId: string,
  workspaceId: string,
): Promise<Grant[]> {
  const rows = await queryRows<{
    page_id: string;
    role: Role;
    include_subtree: boolean;
    via_group: boolean;
  }>(
    db,
    `SELECT pp.page_id, pp.role, pp.include_subtree, false AS via_group
       FROM page_permissions pp
       JOIN pages p ON p.id = pp.page_id
      WHERE pp.user_id = $1 AND p.workspace_id = $2
      UNION ALL
     SELECT gp.page_id, gp.role, gp.include_subtree, true AS via_group
       FROM page_group_permissions gp
       JOIN group_members gm ON gm.group_id = gp.group_id
       JOIN pages p ON p.id = gp.page_id
      WHERE gm.user_id = $1 AND p.workspace_id = $2`,
    [userId, workspaceId],
  );

  return rows.map((row) => ({
    scopePageId: row.page_id,
    includeSubtree: row.include_subtree,
    role: row.role,
    source: row.via_group ? ('page_group_permission' as const) : ('page_permission' as const),
  }));
}

/**
 * Every ceiling set in a workspace.
 *
 * All of them rather than the ones that apply to a page: claims are resolved
 * per workspace and asked per page, exactly like grants, and a workspace has
 * far fewer caps than pages. Filtering happens in `effectiveRole`, against the
 * `ancestor_ids` the location already carries.
 */
async function pageCapsFor(db: Pool | PoolClient, workspaceId: string): Promise<Cap[]> {
  const rows = await queryRows<{
    page_id: string;
    include_subtree: boolean;
    max_level: Role;
  }>(
    db,
    `SELECT c.page_id, c.include_subtree, c.max_level
       FROM page_caps c
       JOIN pages p ON p.id = c.page_id
      WHERE p.workspace_id = $1`,
    [workspaceId],
  );
  return rows.map((row) => ({
    scopePageId: row.page_id,
    includeSubtree: row.include_subtree,
    maxLevel: row.max_level,
  }));
}

export async function resolveSessionClaims(
  db: Pool | PoolClient,
  sessionToken: string,
  workspaceId: string,
): Promise<AccessClaims | null> {
  const session = await resolveSession(db, sessionToken);
  if (!session) return null;

  // The standing rather than the role: it carries what the role means on a
  // page, which is the thing `effectiveRole` needs and the thing a `switch`
  // over four words could only answer for four (ADR-0087).
  const standing = await loadWorkspaceStanding(db, session.user.userId, workspaceId);
  if (!standing.isMember) return null;

  return {
    principal: {
      kind: session.user.isGuest ? 'guest' : 'user',
      userId: session.user.userId,
      displayName: session.user.displayName,
    },
    workspaceId,
    workspaceRole: standing.role,
    pageLevel: standing.pageLevel,
    grants: await pageGrantsFor(db, session.user.userId, workspaceId),
    caps: await pageCapsFor(db, workspaceId),
  };
}

export interface ShareTokenResolution {
  claims: AccessClaims;
  /** True when the token is password protected and no password was supplied. */
  passwordRequired: boolean;
}

/**
 * Resolve a share token to claims.
 *
 * Creates or reuses a `share_sessions` row so an anonymous participant has a
 * stable identity for presence and so an operator can see and revoke active
 * link sessions.
 */
export async function resolveShareTokenClaims(
  db: Pool | PoolClient,
  shareToken: string,
  opts: {
    displayName?: string | null;
    password?: string | null;
    ipPrefix?: string | null;
    existingShareSessionId?: string | null;
  } = {},
): Promise<ShareTokenResolution | null> {
  const row = await queryOne<{
    id: string;
    workspace_id: string;
    scope_page_id: string;
    include_subtree: boolean;
    role: Role;
    password_hash: string | null;
    allow_anonymous: boolean;
  }>(
    db,
    `SELECT id, workspace_id, scope_page_id, include_subtree, role,
            password_hash, allow_anonymous
       FROM share_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [hashToken(shareToken)],
  );
  if (!row) return null;

  if (row.password_hash !== null) {
    if (!opts.password) {
      // Report the requirement without leaking anything about the target.
      return {
        passwordRequired: true,
        claims: {
          principal: { kind: 'anonymous', sessionId: '', displayName: '' },
          workspaceId: row.workspace_id,
          workspaceRole: null,
          // A share link is not a membership: nothing but the grant below.
          pageLevel: null,
          grants: [],
          // Nothing is authorised until the password is given, so there is
          // nothing for a ceiling to lower.
          caps: [],
        },
      };
    }
    const { verifyPassword } = await import('./password.js');
    const { valid } = await verifyPassword(opts.password, row.password_hash);
    if (!valid) throw new AuthError('incorrect link password', 'invalid_credentials');
  }

  if (!row.allow_anonymous) {
    // The link exists but requires an account; the caller must sign in and
    // then claim the grant.
    throw new AuthError('this link requires signing in', 'invalid_credentials');
  }

  const displayName = (opts.displayName?.trim() || 'Guest').slice(0, 64);

  let shareSessionId = opts.existingShareSessionId ?? null;
  if (shareSessionId) {
    const still = await queryOne<{ id: string }>(
      db,
      `SELECT id FROM share_sessions
        WHERE id = $1 AND share_token_id = $2 AND expires_at > now()`,
      [shareSessionId, row.id],
    );
    if (!still) shareSessionId = null;
  }

  if (!shareSessionId) {
    const created = await queryOne<{ id: string }>(
      db,
      `INSERT INTO share_sessions (share_token_id, display_name, ip_prefix, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days') RETURNING id`,
      [row.id, displayName, opts.ipPrefix ?? null],
    );
    if (!created) throw new Error('failed to create share session');
    shareSessionId = created.id;
  } else {
    await db.query(
      `UPDATE share_sessions SET last_seen_at = now(), display_name = $2 WHERE id = $1`,
      [shareSessionId, displayName],
    );
  }

  return {
    passwordRequired: false,
    claims: {
      principal: { kind: 'anonymous', sessionId: shareSessionId, displayName },
      workspaceId: row.workspace_id,
      workspaceRole: null,
      pageLevel: null,
      grants: [
        {
          scopePageId: row.scope_page_id,
          includeSubtree: row.include_subtree,
          role: row.role,
          source: 'share_token',
          tokenId: row.id,
        },
      ],
      /*
       * A share link is a second grant path, and a cap beats it too.
       *
       * ADR-0026 warned that links must not become a way round page
       * permissions, and a ceiling somebody set on a section is exactly the
       * rule a link would otherwise walk past — "this is reference material,
       * nobody edits it" cannot mean "unless they arrived by link".
       */
      caps: await pageCapsFor(db, row.workspace_id),
    },
  };
}

// --- authorisation ---------------------------------------------------------

export interface PageLocation {
  id: string;
  workspaceId: string;
  ancestorIds: string[];
  /**
   * Whether this page or an ancestor withholds the workspace default.
   *
   * Carried here because sync decides with this function and nothing else. The
   * tree hid a restricted page from the moment restrictions existed, and this
   * still served its document to anybody who knew the id — the interface
   * concealed it and the protocol did not.
   */
  restricted: boolean;
}

/**
 * Load the minimum a permission check needs.
 *
 * Only three columns, and no document content. Called on every subdocument
 * open, so it must stay cheap.
 */
export async function loadPageLocation(
  db: Pool | PoolClient,
  pageId: string,
): Promise<PageLocation | null> {
  const row = await queryOne<{
    id: string;
    workspace_id: string;
    ancestor_ids: string[];
    restricted: boolean;
  }>(
    db,
    // Restriction is inherited, so the ancestors are checked here rather than
    // by the caller — one query, and no way to forget it.
    `SELECT p.id, p.workspace_id, p.ancestor_ids,
            EXISTS (
              SELECT 1 FROM pages r
               WHERE r.id = ANY(array_append(p.ancestor_ids, p.id))
                 AND r.restricted
            ) AS restricted
       FROM pages p WHERE p.id = $1`,
    [pageId],
  );
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ancestorIds: row.ancestor_ids,
    restricted: row.restricted,
  };
}

/**
 * The effective role a principal has on a page, or null for no access.
 *
 * Pure function over claims and page location — no database access — so it is
 * cheap enough to call per operation and trivially testable.
 */
export function effectiveRole(
  claims: AccessClaims,
  page: PageLocation,
): Role | null {
  // A page in another workspace is invisible regardless of grants. Checked
  // first: this is the boundary that must never leak.
  if (page.workspaceId !== claims.workspaceId) return null;

  let best: Role | null = null;

  const consider = (role: Role): void => {
    if (best === null || atLeast(role, best)) best = role;
  };

  /*
   * What the role gives, and when it is withheld.
   *
   * A page level of `admin` applies everywhere, restricted pages included, or
   * a restriction could lock out the people who have to be able to undo it.
   * Anything less is the workspace default, and a restricted page withholds
   * the default — the same two branches `resolvePageAccess` has, now over the
   * same loaded value rather than over a `switch` of its own (ADR-0087).
   *
   * The restriction half was once missing here: the tree stopped listing a
   * restricted page and sync went on serving its document to anybody who knew
   * the id, so the interface concealed what the protocol did not.
   */
  if (claims.pageLevel === 'admin') {
    consider('admin');
  } else if (claims.pageLevel !== null && !page.restricted) {
    consider(claims.pageLevel);
  }

  for (const grant of claims.grants) {
    const inScope =
      grant.scopePageId === page.id ||
      (grant.includeSubtree && page.ancestorIds.includes(grant.scopePageId));
    if (inScope) consider(grant.role);
  }

  /*
   * The ceiling, asked last, and the only thing here that lowers (ADR-0087).
   *
   * Not applied to somebody the workspace makes a page admin: the same escape
   * hatch a restricted page carries. A cap that applied to them could be set on
   * the workspace root and never lifted again, by anybody, without database
   * access.
   *
   * `resolvePageAccess` asks exactly this, in the same order, and the
   * agreement test is what keeps the two from drifting — which is the failure
   * this pair of functions has had once already (ADR-0086).
   */
  if (best !== null && claims.pageLevel !== 'admin') {
    for (const cap of claims.caps) {
      const inScope =
        cap.scopePageId === page.id ||
        (cap.includeSubtree && page.ancestorIds.includes(cap.scopePageId));
      // The lowest ceiling wins, so every cap in scope is asked rather than the
      // first: a ceiling under a ceiling is the real ceiling.
      if (inScope && !atLeast(cap.maxLevel, best)) best = cap.maxLevel;
    }
  }

  return best;
}

/** Throwing variant for use at the boundary of an operation. */
export function requireRole(
  claims: AccessClaims,
  page: PageLocation,
  need: Role,
): Role {
  const have = effectiveRole(claims, page);
  if (have === null || !atLeast(have, need)) {
    // One message for "no access" and "insufficient access": distinguishing
    // them tells an attacker which pages exist.
    throw new AuthError('not authorised for this page', 'invalid_credentials');
  }
  return have;
}

export const canRead = (c: AccessClaims, p: PageLocation): boolean =>
  effectiveRole(c, p) !== null;

export const canEdit = (c: AccessClaims, p: PageLocation): boolean => {
  const role = effectiveRole(c, p);
  return role !== null && atLeast(role, 'editor');
};

export const canComment = (c: AccessClaims, p: PageLocation): boolean => {
  const role = effectiveRole(c, p);
  return role !== null && atLeast(role, 'commenter');
};

/**
 * Authorise opening a page document over the sync connection.
 *
 * This is the function rule 1 above is about. It must be called for every
 * document a connection asks for, including subdocuments reached from an
 * already-authorised page.
 */
export async function authorizeDocumentOpen(
  db: Pool | PoolClient,
  claims: AccessClaims,
  pageId: string,
  need: Role = 'viewer',
): Promise<{ role: Role; page: PageLocation }> {
  const page = await loadPageLocation(db, pageId);
  if (!page) {
    throw new AuthError('not authorised for this page', 'invalid_credentials');
  }
  const role = requireRole(claims, page, need);
  return { role, page };
}


/**
 * Re-resolve claims for an already-authenticated connection.
 *
 * Claims are a snapshot taken when a connection authenticates. Without
 * re-resolution, revoking a share link or a session has no effect until the
 * client reconnects — which for a long-lived WebSocket may be hours, and which
 * makes "revoke" a lie. ADR-0006 chose revocable rows over signed tokens
 * precisely so this could be fixed properly.
 *
 * Re-resolution works from credential **ids**, never from the token itself:
 * the server does not retain the plaintext token, and should not.
 *
 * Returns null when the credential is no longer valid, meaning every document
 * on that connection must be closed.
 */
export type ConnectionCredential =
  | { kind: 'session'; sessionId: string }
  | { kind: 'share'; shareTokenId: string; shareSessionId: string };

export async function revalidateClaims(
  db: Pool | PoolClient,
  credential: ConnectionCredential,
  workspaceId: string,
): Promise<AccessClaims | null> {
  if (credential.kind === 'session') {
    const row = await queryOne<{
      user_id: string;
      display_name: string;
      is_guest: boolean;
    }>(
      db,
      // The membership is still required here — a session whose workspace
      // membership was revoked must stop resolving — but what the membership
      // *gives* is asked below, in the one place that answers it.
      `SELECT u.id AS user_id, u.display_name, u.is_guest
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN workspace_members m
           ON m.user_id = u.id AND m.workspace_id = $2
        WHERE s.id = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.disabled_at IS NULL`,
      [credential.sessionId, workspaceId],
    );
    if (!row) return null;

    const standing = await loadWorkspaceStanding(db, row.user_id, workspaceId);
    if (!standing.isMember) return null;

    return {
      principal: {
        kind: row.is_guest ? 'guest' : 'user',
        userId: row.user_id,
        displayName: row.display_name,
      },
      workspaceId,
      workspaceRole: standing.role,
      pageLevel: standing.pageLevel,
      caps: await pageCapsFor(db, workspaceId),
      // The same loader as the first resolution. Two copies of this query is
      // how the group half came to be missing from both.
      grants: await pageGrantsFor(db, row.user_id, workspaceId),
    };
  }

  // Share credential: both the token and the anonymous session must still
  // exist. Revoking the token deletes its sessions, so either check catching
  // it is sufficient — but checking both makes the intent explicit.
  const row = await queryOne<{
    scope_page_id: string;
    include_subtree: boolean;
    role: Role;
    workspace_id: string;
    display_name: string;
  }>(
    db,
    `SELECT st.scope_page_id, st.include_subtree, st.role, st.workspace_id,
            ss.display_name
       FROM share_tokens st
       JOIN share_sessions ss ON ss.share_token_id = st.id
      WHERE st.id = $1
        AND ss.id = $2
        AND st.revoked_at IS NULL
        AND (st.expires_at IS NULL OR st.expires_at > now())
        AND ss.expires_at > now()`,
    [credential.shareTokenId, credential.shareSessionId],
  );
  if (!row || row.workspace_id !== workspaceId) return null;

  return {
    principal: {
      kind: 'anonymous',
      sessionId: credential.shareSessionId,
      displayName: row.display_name,
    },
    workspaceId,
    workspaceRole: null,
    pageLevel: null,
    grants: [
      {
        scopePageId: row.scope_page_id,
        includeSubtree: row.include_subtree,
        role: row.role,
        source: 'share_token',
        tokenId: credential.shareTokenId,
      },
    ],
    // Re-read on revalidation like everything else: a cap set while a link
    // session is open takes effect when the connection is next re-checked,
    // which is what makes it revocable at all (ADR-0006).
    caps: await pageCapsFor(db, row.workspace_id),
  };
}
