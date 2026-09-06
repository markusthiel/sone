/**
 * SONE server — what somebody holds in a workspace (ADR-0087).
 *
 * One question, one loader: the page level a workspace gives them by default,
 * the rights they hold, and whether they own the place.
 *
 * ## Why this is its own module and why everything goes through it
 *
 * A week ago two resolvers answered "may this person reach this page" and
 * disagreed for months, because one of them had never learned about a table
 * (ADR-0086). The lesson was not "add the table to the second one". It was that
 * a question answered in two places is answered two ways as soon as one moves.
 *
 * So this is the only place that reads `workspace_members` and `roles` to
 * decide what somebody holds. `resolvePageAccess` calls it. `resolveSessionClaims`
 * calls it. The listing queries cannot call a function — they are SQL pasted
 * into a dozen `WHERE` clauses — so they get the one narrow derived question
 * they need, `adminPagesCondition`, written out once below and never by a
 * caller.
 *
 * ## Union and maximum, never subtraction
 *
 * Somebody's own role and the roles of every group they are in combine as the
 * **union** of the rights and the **maximum** of the page levels.
 *
 * ADR-0026's reason, unchanged: being added to a group must never reduce what
 * somebody could already do. A model where joining takes something away makes
 * every group membership a thing to audit before granting.
 */

import { RIGHTS, ROLE_ORDER, type Right, type Role, type WorkspaceRole } from '@sone/core';
import type { Pool, PoolClient } from 'pg';

import { queryOne } from '../db/pool.js';

export interface WorkspaceStanding {
  /**
   * Which system role they hold, or null.
   *
   * Null means either that they are not in the workspace — `isMember` tells
   * those apart — or that they hold a custom role, which has no name in the
   * old four-word vocabulary. Callers that still compare against `'admin'`
   * are the ones ADR-0087's second step replaces with a right.
   */
  role: WorkspaceRole | null;
  isMember: boolean;
  /** What a page carrying no rules of its own gives them. Null grants nothing. */
  pageLevel: Role | null;
  rights: ReadonlySet<Right>;
  /** Transferring and deleting the workspace. Not a right — see ADR-0087. */
  isOwner: boolean;
}

/**
 * The four system roles, and what they give.
 *
 * Seeded by migration 0058 and asserted again at every boot, because they are
 * not ordinary data: a `roles` table without them is a server on which nobody
 * has any access at all, and the ways to arrive at one are not exotic — a
 * partial restore, a truncate, a database rebuilt from a dump that predates
 * the migration.
 *
 * `owner` and `admin` are identical here. What separates them is transferring
 * and deleting the workspace, which is a property of the membership rather
 * than a right (ADR-0087).
 */
const MANAGES: readonly Right[] = [
  'people.manage',
  'groups.manage',
  'workspace.settings',
  'roles.manage',
];

const SYSTEM_ROLES: ReadonlyArray<{
  key: string;
  name: string;
  level: Role | null;
  rights: readonly Right[];
}> = [
  { key: 'owner', name: 'Owner', level: 'admin', rights: MANAGES },
  { key: 'admin', name: 'Admin', level: 'admin', rights: MANAGES },
  // A member may write in the workspace and may not decide who else is in it.
  { key: 'member', name: 'Member', level: 'editor', rights: [] },
  { key: 'guest', name: 'Guest', level: null, rights: [] },
];

/**
 * Make sure the four exist. Safe to call repeatedly; changes nothing if they do.
 *
 * Deliberately does not touch `rights` or `name` on a row that is already
 * there: an operator who renamed "Member" has renamed it, and a boot that
 * quietly undid that would be worse than the inconsistency it fixed.
 */
export async function ensureSystemRoles(db: Pool | PoolClient): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await db.query(
      `INSERT INTO roles (workspace_id, key, name, page_level, rights)
       VALUES (NULL, $1, $2, $3, $4)
       ON CONFLICT (key) WHERE key IS NOT NULL DO NOTHING`,
      [role.key, role.name, role.level, role.rights],
    );
  }
}

const NOT_A_MEMBER: WorkspaceStanding = {
  role: null,
  isMember: false,
  pageLevel: null,
  rights: new Set(),
  isOwner: false,
};

/** A standing that grants nothing, for a caller that has no membership to load. */
export const noStanding = (): WorkspaceStanding => NOT_A_MEMBER;

const KNOWN_RIGHTS = new Set<string>(RIGHTS);
const SYSTEM_KEYS = new Set<string>(['owner', 'admin', 'member', 'guest']);

/**
 * Order the four levels by what they allow.
 *
 * As text, `viewer` sorts last and `admin` first, so `max()` on the label
 * answers the wrong question — the same trap `resolvePageAccess` documents.
 */
const LEVEL_RANK = `CASE page_level
    WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 ELSE 1
  END`;

export async function loadWorkspaceStanding(
  db: Pool | PoolClient,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceStanding> {
  const row = await queryOne<{
    is_member: boolean;
    is_owner: boolean;
    role_key: string | null;
    page_level: Role | null;
    rights: string[] | null;
  }>(
    db,
    // The membership decides whether anything applies at all. A group role is
    // only reachable through a group, and a group may only hold people who are
    // already in the workspace — but that is a rule of the group routes, and a
    // permission check should not depend on another route having behaved.
    `WITH member AS (
       -- The CTE's columns are renamed so nothing below looks like a column of
       -- workspace_members: sqlColumns.db.test.ts reads these statements with a
       -- regular expression and cannot see a CTE, and a guard that reports a
       -- column which does not exist is a guard people learn to ignore.
       SELECT m.role_id AS held_role_id,
              m.is_owner AS owns_it
         FROM workspace_members m
        WHERE m.workspace_id = $2 AND m.user_id = $1
     ),
     held AS (
       SELECT r.key, r.page_level, r.rights
         FROM member me
         JOIN roles r ON r.id = me.held_role_id
       UNION ALL
       SELECT NULL AS key, r.page_level, r.rights
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
         JOIN roles r ON r.id = g.role_id
        WHERE gm.user_id = $1 AND g.workspace_id = $2
          AND EXISTS (SELECT 1 FROM member)
     )
     SELECT
       EXISTS (SELECT 1 FROM member) AS is_member,
       COALESCE((SELECT me.owns_it FROM member me), false) AS is_owner,
       (SELECT key FROM held WHERE key IS NOT NULL LIMIT 1) AS role_key,
       (SELECT page_level FROM held
         WHERE page_level IS NOT NULL
         ORDER BY ${LEVEL_RANK} DESC
         LIMIT 1) AS page_level,
       (SELECT COALESCE(array_agg(DISTINCT one), '{}')
          FROM held, unnest(held.rights) AS one) AS rights`,
    [userId, workspaceId],
  );

  if (!row || !row.is_member) return NOT_A_MEMBER;

  /*
   * A member whose role could not be found at all is a broken installation,
   * and it says so rather than resolving to no access.
   *
   * Silent no-access is what this failure looks like otherwise: every request
   * answers 403, every page vanishes from every tree, and nothing anywhere
   * explains it. It cost an hour twice while this was being built — once when
   * the server test harness truncated the seeded system roles, and again when
   * the client harness did, because "empty every table" was written in two
   * places and only one of them was fixed.
   *
   * The condition is narrow on purpose. A guest holds a role whose page level
   * is null, and a custom role has no key; both produce a row. Only a
   * membership pointing at nothing at all — no role row, and no row matching
   * the old enum word either — lands here, and that means the four system
   * roles are missing. `ensureSystemRoles` runs at boot precisely so this
   * cannot happen in a running instance.
   */
  if (row.role_key === null && row.page_level === null && !row.is_owner) {
    const hasRoles = await queryOne<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM roles WHERE workspace_id IS NULL`,
    );
    if ((hasRoles?.n ?? 0) === 0) {
      throw new Error(
        'the system roles are missing from this database, so nobody has any access. ' +
          'They are seeded by migration 0058 and asserted at boot; a database that ' +
          'lost them was probably truncated or restored in part (ADR-0087).',
      );
    }
  }

  /*
   * Unknown right names are dropped rather than carried.
   *
   * A row can outlive the code that understood it: a right removed from the
   * enumeration, or a database restored from an instance running a later
   * version. Carrying a name nothing recognises would put a string in a set
   * that is only ever asked closed questions — harmless today and exactly the
   * kind of thing that becomes a permission that half-works.
   */
  const rights = new Set<Right>();
  for (const one of row.rights ?? []) {
    if (KNOWN_RIGHTS.has(one)) rights.add(one as Right);
  }

  const key = row.role_key;
  return {
    role: key !== null && SYSTEM_KEYS.has(key) ? (key as WorkspaceRole) : null,
    isMember: true,
    pageLevel: row.page_level !== null && ROLE_ORDER.includes(row.page_level)
      ? row.page_level
      : null,
    rights,
    isOwner: row.is_owner,
  };
}

/**
 * What a workspace listing says about the caller's own standing (ADR-0102).
 *
 * Both listings — `/api/workspaces` and `/api/auth/session` — used to select
 * `m.role`, the enum ADR-0087 superseded and migration 0058 declared unread.
 * It reached the browser, where the settings screen decided from it whether to
 * disable every control and the move dialog decided which workspaces to offer.
 * Somebody holding `workspace.settings` through a custom role got the word
 * `member` and a screen of dead inputs.
 *
 * So the listings send what the server would decide from: the role's key or
 * `'custom'`, its name, its rights, and whether the membership owns the place.
 * The same move as ADR-0095 one layer out — the answer was being computed and
 * thrown away, and the interface was guessing at what it had already been
 * told.
 *
 * Written once here rather than in both routes, for the reason
 * `WORKSPACE_ORDER_SQL` is: the two listings have to agree, and the half of
 * them that was not shared is the half that drifted.
 *
 * Interpolated into a query whose membership table is aliased `m`; it supplies
 * its own join, so the caller adds nothing but the columns.
 */
export const STANDING_COLUMNS = `COALESCE(mr.key, 'custom') AS role,
              mr.name AS role_name,
              m.is_owner,
              /*
               * The rights are the **union** with every group's, exactly as the
               * loader computes them (ADR-0026): being added to a group must
               * never reduce what somebody can do, so a listing that reported
               * only the membership's own role would understate whoever holds a
               * right through a group — which is the same "interface stricter
               * than the rule it mirrors" fault this whole change is about.
               *
               * The name above is deliberately *not* unioned: "your role" on
               * the settings screen means the one on the membership, and a
               * group's role is shown where groups are.
               */
              (SELECT COALESCE(array_agg(DISTINCT one), '{}')
                 FROM (
                   SELECT unnest(mr.rights) AS one
                   UNION ALL
                   SELECT unnest(gr.rights)
                     FROM group_members gm
                     JOIN groups g ON g.id = gm.group_id
                     JOIN roles gr ON gr.id = g.role_id
                    WHERE gm.user_id = m.user_id AND g.workspace_id = m.workspace_id
                 ) AS all_rights) AS rights`;

/** The join `STANDING_COLUMNS` needs. Separate because it goes in another clause. */
export const STANDING_JOIN = `JOIN roles mr ON mr.id = m.role_id`;

/**
 * SQL for "this person's role in this page's workspace gives them everything".
 *
 * The listing queries paste a visibility condition into a dozen `WHERE`
 * clauses and cannot call the loader above, so they need this one derived
 * question in SQL. Written out once here rather than passed in by each caller,
 * because it used to be passed in and one caller passed the literal `false` —
 * so an owner could not watch a restricted page they could plainly see.
 *
 * A parameter every caller has to compute correctly is a parameter one caller
 * computes wrongly.
 */
export const fullAccessCondition = (alias: string, userParam: string): string => `EXISTS (
  SELECT 1
    FROM workspace_members m
    -- The role they hold. A membership must point at one (ADR-0102), so this
    -- is a plain join and no longer falls back to the enum word.
    JOIN roles r ON r.id = m.role_id
   WHERE m.workspace_id = ${alias}.workspace_id
     AND m.user_id = ${userParam}
     AND (r.page_level = 'admin' OR EXISTS (
       SELECT 1
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
         JOIN roles gr ON gr.id = g.role_id
        WHERE gm.user_id = ${userParam}
          AND g.workspace_id = ${alias}.workspace_id
          AND gr.page_level = 'admin'
     ))
)`;
