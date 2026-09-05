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
import { fullAccessCondition, loadWorkspaceStanding } from '../auth/standing.js';

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
 *
 * @deprecated A role is a row now, and what it gives on a page is a column on
 * that row (ADR-0087). This switch is the shape that made a role's meaning
 * impossible to change without editing two files, and it is kept only until
 * the last caller outside tests is gone. `loadWorkspaceStanding` is the
 * question this used to answer.
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

/**
 * The lower of two ceilings, for a cap under a cap (ADR-0087).
 *
 * The counterpart of `morePermissive`, and the only place in this file that
 * takes something away. Where several caps apply through ancestry the lowest
 * wins: a ceiling under a ceiling is the real ceiling, and "the nearest one
 * wins" would let a subpage quietly undo the section above it.
 */
export const lessPermissive = (
  a: PageAccess | null,
  b: PageAccess | null,
): PageAccess | null => {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] <= RANK[b] ? a : b;
};

export interface Resolution {
  access: PageAccess | null;
  /**
   * Why, for the interface to explain a page somebody cannot edit.
   *
   * `capped` is the one that has to reach the screen. The other four describe
   * access somebody was *given*, which is explainable by "somebody shared this
   * with you"; a cap is a rule attached to the page that lowers what a role
   * already granted, so a capped page looks like every other page and behaves
   * differently. Without a word for it, every permission question becomes an
   * investigation — which is the price ADR-0087 accepted for this layer, and
   * this field is where it is paid.
   */
  reason: 'role' | 'granted' | 'inherited' | 'restricted' | 'capped' | 'not_a_member';
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
    workspace_id: string;
    restricted: boolean;
    granted: PageAccess | null;
    capped: PageAccess | null;
    owns_workspace: boolean;
  }>(
    db,
    `WITH RECURSIVE ancestry AS (
       -- Depth counts *upward* from the page: 0 is the page itself, and a
       -- larger number is further towards the root. So "at or below" is
       -- "depth <= ", which is what the fence below is compared with.
       SELECT p.id, p.parent_page_id, p.workspace_id, p.restricted, 0 AS depth
         FROM pages p
        WHERE p.id = $1
       UNION ALL
       SELECT p.id, p.parent_page_id, p.workspace_id, p.restricted, a.depth + 1
         FROM pages p
         JOIN ancestry a ON p.id = a.parent_page_id
     ),
     fence AS (
       -- Where the restriction starts, as a depth. The *deepest* one, which is
       -- the smallest depth: any other on the path is above it, so a grant that
       -- clears the deepest has already cleared them.
       SELECT min(depth) AS depth FROM ancestry WHERE restricted
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
          -- And it must have been made at or below the restriction, or a
          -- subtree grant one level above a restricted section would walk
          -- straight through it (ADR-0089). No fence, no clause: the COALESCE
          -- compares the row with itself.
          AND a.depth <= COALESCE((SELECT depth FROM fence), a.depth)
       UNION ALL
       SELECT gp.role
         FROM page_group_permissions gp
         JOIN ancestry a ON a.id = gp.page_id
         JOIN group_members gm ON gm.group_id = gp.group_id
        WHERE gm.user_id = $2
          AND (gp.include_subtree OR gp.page_id = $1)
          AND a.depth <= COALESCE((SELECT depth FROM fence), a.depth)
     )
     SELECT
       -- Not the role. What somebody holds in a workspace is loaded by
       -- loadWorkspaceStanding and nowhere else (ADR-0087), so this query
       -- returns the workspace and asks that question separately. One query
       -- became two, and one rule stopped having two implementations.
       -- (No backticks in here. That mistake has now ended a template literal
       -- nine times in this project.)
       p.workspace_id,
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
       -- The lowest ceiling on the path, which is the real one (ADR-0087).
       -- Ordered the other way round from the grants above, and that asymmetry
       -- is the whole difference between the two layers: grants take the most
       -- permissive, caps the least.
       (SELECT c.max_level FROM page_caps c
          JOIN ancestry a2 ON a2.id = c.page_id
         WHERE c.include_subtree OR c.page_id = $1
         ORDER BY
           CASE c.max_level
             WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1
           END ASC
         LIMIT 1) AS capped,
       COALESCE(w.personal_for = $2, false) AS owns_workspace
       FROM ancestry a
       JOIN pages p ON p.id = a.id
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE a.parent_page_id IS NULL
      LIMIT 1`,
    [input.pageId, input.userId],
  );

  if (!row) return { access: null, reason: 'not_a_member' };

  // Their own workspace, which they cannot be locked out of by a rule they
  // set on a page inside it.
  if (row.owns_workspace) return { access: 'admin', reason: 'role' };

  const standing = await loadWorkspaceStanding(db, input.userId, row.workspace_id);
  const byRole = standing.pageLevel;

  /*
   * A cap lowers what everything else arrived at, and is asked last (ADR-0087).
   *
   * Except for somebody the workspace makes a page admin — the same escape
   * hatch a restricted page carries, and for the same reason: a cap that
   * applied to them could be set on the workspace root and never lifted again,
   * by anybody, without database access.
   *
   * The record proposed exempting whoever holds `roles.manage` instead. Asking
   * the page level is the better rule and turned out to be the same rule the
   * line below already applies: a cap is a rule about a *page*, so who may
   * override it should be settled by what the workspace says about pages, not
   * by a right that is about the settings screen.
   */
  const ceiling = byRole === 'admin' ? null : row.capped;

  if (row.restricted) {
    // A restricted page ignores the role's default. Anybody the workspace
    // makes a page admin keeps manage, or a restriction would be able to lock
    // out the people who have to be able to undo it.
    const keep = byRole === 'admin' ? 'admin' : null;
    const given = morePermissive(keep, row.granted);
    const access = lessPermissive(given, ceiling);
    return {
      access,
      reason:
        access === null
          ? 'restricted'
          : ceiling !== null && given !== null && RANK[ceiling] < RANK[given]
            ? 'capped'
            : row.granted
              ? 'granted'
              : 'role',
    };
  }

  const given = morePermissive(byRole, row.granted);
  const access = lessPermissive(given, ceiling);
  return {
    access,
    reason:
      access === null
        ? 'not_a_member'
        : // Said before the other two, because a cap is the only one that took
          // something away and is therefore the only one the reader cannot work
          // out from what they were given.
          ceiling !== null && given !== null && RANK[ceiling] < RANK[given]
          ? 'capped'
          : row.granted && (byRole === null || RANK[row.granted] > RANK[byRole])
            ? 'granted'
            : 'role',
  };
}

/**
 * Whether a grant made on `scopeColumn` stands at or below the restriction.
 *
 * The listing half of the fence `effectiveRole` applies (ADR-0089), and the
 * reason it is a fragment rather than two written-out subqueries: the two
 * branches above are the person's own grants and their groups', and those two
 * disagreeing would mean a page a group could list and a person could not.
 *
 * Positions in the path, which is `ancestor_ids` root-first with the page
 * itself appended — so a larger position is deeper. The deepest restricted
 * page is the only fence that matters; a grant at or below it clears every
 * other one on the path by construction.
 *
 * `COALESCE(..., 1)` is the unrestricted case: every page on the path has
 * position 1 or more, so with no fence the comparison is always true. (The
 * branch above already answers that case, so this is a guard rather than a
 * path anybody reaches.)
 */
const grantIsBelowFence = (alias: string, scopeColumn: string): string => `
  array_position(array_append(${alias}.ancestor_ids, ${alias}.id), ${scopeColumn})
    >= COALESCE((
      SELECT max(array_position(array_append(${alias}.ancestor_ids, ${alias}.id), r.id))
        FROM pages r
       WHERE r.id = ANY(array_append(${alias}.ancestor_ids, ${alias}.id))
         AND r.restricted
    ), 1)`;

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
 * The caller supplies one placeholder: the user's id.
 *
 * It used to supply a second — whether this person holds full access — and
 * that was a mistake worth recording. Every caller had to compute it, thirteen
 * did, and `PUT /api/pages/:id/watch` passed the literal `false`: an owner
 * could not watch a restricted page they could plainly see. A parameter every
 * caller has to compute correctly is a parameter one caller computes wrongly,
 * so the question is asked here now (ADR-0087).
 *
 * The restriction test comes first because most pages are not restricted, and
 * a page nothing restricts needs no lookup at all.
 */
export const visiblePagesCondition = (alias: string, userParam: string): string => `(
  NOT EXISTS (
    SELECT 1 FROM pages r
     WHERE r.id = ANY(array_append(${alias}.ancestor_ids, ${alias}.id))
       AND r.restricted
  )
  OR ${fullAccessCondition(alias, userParam)}
  OR EXISTS (
    SELECT 1 FROM page_permissions pp
     WHERE pp.user_id = ${userParam}
       AND (
         pp.page_id = ${alias}.id
         OR (pp.include_subtree AND pp.page_id = ANY(${alias}.ancestor_ids))
       )
       AND ${grantIsBelowFence(alias, 'pp.page_id')}
  )
  OR EXISTS (
    SELECT 1 FROM page_group_permissions gp
      JOIN group_members gm ON gm.group_id = gp.group_id
     WHERE gm.user_id = ${userParam}
       AND (
         gp.page_id = ${alias}.id
         OR (gp.include_subtree AND gp.page_id = ANY(${alias}.ancestor_ids))
       )
       AND ${grantIsBelowFence(alias, 'gp.page_id')}
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
