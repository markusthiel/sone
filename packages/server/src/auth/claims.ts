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
  grants: Grant[];
}

/** Workspace roles that imply full access to every page in the workspace. */
const FULL_ACCESS_ROLES: ReadonlySet<WorkspaceRole> = new Set(['owner', 'admin']);

const atLeast = (have: Role, need: Role): boolean =>
  ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need);

const workspaceRoleToPageRole = (role: WorkspaceRole): Role => {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'admin';
    case 'member':
      return 'editor';
    case 'guest':
      // A guest has no implicit page access at all; everything comes from an
      // explicit grant.
      return 'viewer';
  }
};

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
): Promise<WorkspaceRole | null> {
  const row = await queryOne<{ role: WorkspaceRole }>(
    db,
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return row?.role ?? null;
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

export async function resolveSessionClaims(
  db: Pool | PoolClient,
  sessionToken: string,
  workspaceId: string,
): Promise<AccessClaims | null> {
  const session = await resolveSession(db, sessionToken);
  if (!session) return null;

  const role = await roleIn(db, workspaceId, session.user.userId);
  if (!role) return null;
  const membership = { role };

  return {
    principal: {
      kind: session.user.isGuest ? 'guest' : 'user',
      userId: session.user.userId,
      displayName: session.user.displayName,
    },
    workspaceId,
    workspaceRole: membership.role,
    grants: await pageGrantsFor(db, session.user.userId, workspaceId),
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
          grants: [],
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
      grants: [
        {
          scopePageId: row.scope_page_id,
          includeSubtree: row.include_subtree,
          role: row.role,
          source: 'share_token',
          tokenId: row.id,
        },
      ],
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

  if (claims.workspaceRole !== null && FULL_ACCESS_ROLES.has(claims.workspaceRole)) {
    consider(workspaceRoleToPageRole(claims.workspaceRole));
  } else if (claims.workspaceRole === 'member' && !page.restricted) {
    // Members see the workspace tree by default — unless the page or a section
    // above it withholds it (ADR-0026), in which case only an explicit grant
    // reaches them.
    //
    // This condition was the missing half of restrictions: the tree stopped
    // listing a restricted page and sync went on serving its document to
    // anybody who knew the id, so the interface concealed what the protocol
    // did not.
    consider('editor');
  }

  for (const grant of claims.grants) {
    const inScope =
      grant.scopePageId === page.id ||
      (grant.includeSubtree && page.ancestorIds.includes(grant.scopePageId));
    if (inScope) consider(grant.role);
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
      role: WorkspaceRole;
    }>(
      db,
      `SELECT u.id AS user_id, u.display_name, u.is_guest, m.role
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

    return {
      principal: {
        kind: row.is_guest ? 'guest' : 'user',
        userId: row.user_id,
        displayName: row.display_name,
      },
      workspaceId,
      workspaceRole: row.role,
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
    grants: [
      {
        scopePageId: row.scope_page_id,
        includeSubtree: row.include_subtree,
        role: row.role,
        source: 'share_token',
        tokenId: credential.shareTokenId,
      },
    ],
  };
}
