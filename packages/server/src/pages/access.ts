/**
 * SONE server — what somebody may do with a page.
 *
 * One question, asked everywhere: a page fetch, the tree, search, favourites,
 * the tasks panel. It is answered here rather than in each of them, because a
 * second answer that drifts is a disclosure — and a title in a search result is
 * a disclosure however carefully the page itself is protected (ADR-0026).
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne } from '../db/pool.js';

/**
 * The levels a grant can carry.
 *
 * `share_role` from the original schema, which share links already use. A
 * second vocabulary for the same idea would mean translating between them at
 * every boundary, and the translation is where they would drift.
 */
export type PageAccess = 'viewer' | 'commenter' | 'editor' | 'admin';

/** Ordered, so "at least this much" is a comparison rather than a list. */
const RANK: Record<PageAccess, number> = { viewer: 1, commenter: 2, editor: 3, admin: 4 };

export const atLeast = (held: PageAccess | null, needed: PageAccess): boolean =>
  held !== null && RANK[held] >= RANK[needed];

/** The more permissive of two, for somebody who is granted access twice. */
export const morePermissive = (
  a: PageAccess | null,
  b: PageAccess | null,
): PageAccess | null => {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
};

/**
 * What a workspace role gives on an unrestricted page.
 *
 * The default that page rules widen or, on a restricted page, replace. A guest
 * gets nothing by role: being in a workspace as a guest means being shown
 * particular things, not everything.
 */
export function accessFromRole(role: string | null): PageAccess | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'admin';
    case 'member':
      return 'editor';
    default:
      return null;
  }
}

export interface Resolution {
  access: PageAccess | null;
  /** Why, for the interface to explain a page somebody cannot edit. */
  reason: 'role' | 'granted' | 'inherited' | 'restricted' | 'not_a_member';
}

/**
 * Resolve access to one page.
 *
 * Walks from the page to the root once, in the database, rather than fetching
 * ancestors and deciding here — a tree deep enough to matter is a tree deep
 * enough for that to be a query per level.
 *
 * The walk collects two things: whether any ancestor is restricted, and the
 * most permissive grant made to this person anywhere on the path. A grant on an
 * ancestor applies to everything beneath it, which is what makes setting rules
 * once on a section work.
 */
export async function resolvePageAccess(
  db: Pool | PoolClient,
  input: { pageId: string; userId: string },
): Promise<Resolution> {
  const row = await queryOne<{
    role: string | null;
    restricted: boolean;
    granted: PageAccess | null;
    owns_workspace: boolean;
  }>(
    db,
    `WITH RECURSIVE ancestry AS (
       SELECT p.id, p.parent_page_id, p.workspace_id, p.restricted
         FROM pages p
        WHERE p.id = $1
       UNION ALL
       SELECT p.id, p.parent_page_id, p.workspace_id, p.restricted
         FROM pages p
         JOIN ancestry a ON p.id = a.parent_page_id
     ),
     grants AS (
       -- Granted to them, and granted to a group they are in. Read together
       -- rather than in turn, because the more permissive of the two wins and
       -- that is a comparison, not a fallback: adding somebody to a group must
       -- never reduce what they could already do (ADR-0026).
       SELECT pp.role
         FROM page_permissions pp
         JOIN ancestry a ON a.id = pp.page_id
        -- A grant reaches descendants only when it says so. It is the page's
        -- own grant either way, so the page it was made on always counts.
        WHERE pp.user_id = $2
          AND (pp.include_subtree OR pp.page_id = $1)
       UNION ALL
       SELECT gp.role
         FROM page_group_permissions gp
         JOIN ancestry a ON a.id = gp.page_id
         JOIN group_members gm ON gm.group_id = gp.group_id
        WHERE gm.user_id = $2
          AND (gp.include_subtree OR gp.page_id = $1)
     )
     SELECT
       m.role::text AS role,
       -- Restriction is inherited: a page under a restricted section is
       -- restricted, or the section's rules would end at its first child.
       EXISTS (SELECT 1 FROM ancestry WHERE restricted) AS restricted,
       -- Ordered by what each level allows, not alphabetically: 'viewer' sorts
       -- last as text, so max() on the label would answer the wrong question.
       (SELECT role FROM grants ORDER BY
          CASE role
            WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1
          END DESC
        LIMIT 1) AS granted,
       COALESCE(w.personal_for = $2, false) AS owns_workspace
       FROM ancestry a
       JOIN pages p ON p.id = a.id
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN workspace_members m
              ON m.workspace_id = p.workspace_id AND m.user_id = $2
      WHERE a.parent_page_id IS NULL
      LIMIT 1`,
    [input.pageId, input.userId],
  );

  if (!row) return { access: null, reason: 'not_a_member' };

  // Their own workspace, which they cannot be locked out of by a rule they
  // set on a page inside it.
  if (row.owns_workspace) return { access: 'admin', reason: 'role' };

  const byRole = accessFromRole(row.role);

  if (row.restricted) {
    // A restricted page ignores the member default. Owners and admins keep
    // manage, or a restriction would be able to lock out the people who have
    // to be able to undo it.
    const keep = row.role === 'owner' || row.role === 'admin' ? 'admin' : null;
    const access = morePermissive(keep, row.granted);
    return {
      access,
      reason: access === null ? 'restricted' : row.granted ? 'granted' : 'role',
    };
  }

  const access = morePermissive(byRole, row.granted);
  return {
    access,
    reason:
      access === null
        ? 'not_a_member'
        : row.granted && (byRole === null || RANK[row.granted] > RANK[byRole])
          ? 'granted'
          : 'role',
  };
}

/**
 * A SQL condition for "this person may see this page".
 *
 * Written once and pasted into every query that lists pages, because there are
 * several — the tree, search, favourites, the tasks panel — and the one that
 * drifts is a disclosure. A title in a search result is a disclosure however
 * carefully the page itself is protected (ADR-0026).
 *
 * Uses `ancestor_ids`, which the page rows already carry, so it is a condition
 * rather than a walk.
 *
 * The caller supplies two placeholders: the user's id, and whether they hold
 * owner or admin in the workspace.
 */
export const visiblePagesCondition = (alias: string, userParam: string, adminParam: string): string => `(
  ${adminParam}
  OR NOT EXISTS (
    SELECT 1 FROM pages r
     WHERE r.id = ANY(array_append(${alias}.ancestor_ids, ${alias}.id))
       AND r.restricted
  )
  OR EXISTS (
    SELECT 1 FROM page_permissions pp
     WHERE pp.user_id = ${userParam}
       AND (
         pp.page_id = ${alias}.id
         OR (pp.include_subtree AND pp.page_id = ANY(${alias}.ancestor_ids))
       )
  )
  OR EXISTS (
    SELECT 1 FROM page_group_permissions gp
      JOIN group_members gm ON gm.group_id = gp.group_id
     WHERE gm.user_id = ${userParam}
       AND (
         gp.page_id = ${alias}.id
         OR (gp.include_subtree AND gp.page_id = ANY(${alias}.ancestor_ids))
       )
  )
)`;

/**
 * A page somebody cannot see, but whose descendant they can.
 *
 * It has to appear in the tree or the child has no path to it, and a page
 * reachable only by knowing its address is one nobody finds. What it must not
 * do is show its title — so the caller renders a placeholder, and this says
 * which rows those are.
 */
export const isPathOnlyCondition = (alias: string, userParam: string): string => `(
  EXISTS (
    SELECT 1 FROM page_permissions pp
      JOIN pages child ON child.id = pp.page_id
     WHERE pp.user_id = ${userParam}
       AND ${alias}.id = ANY(child.ancestor_ids)
  )
  OR EXISTS (
    SELECT 1 FROM page_group_permissions gp
      JOIN group_members gm ON gm.group_id = gp.group_id
      JOIN pages child ON child.id = gp.page_id
     WHERE gm.user_id = ${userParam}
       AND ${alias}.id = ANY(child.ancestor_ids)
  )
)`;
