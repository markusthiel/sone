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
const SYSTEM_ROLES: ReadonlyArray<{ key: string; name: string; level: Role | null }> = [
  { key: 'owner', name: 'Owner', level: 'admin' },
  { key: 'admin', name: 'Admin', level: 'admin' },
  { key: 'member', name: 'Member', level: 'editor' },
  { key: 'guest', name: 'Guest', level: null },
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
       VALUES (NULL, $1, $2, $3, '{}')
       ON CONFLICT (key) WHERE key IS NOT NULL DO NOTHING`,
      [role.key, role.name, role.level],
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
              m.is_owner AS owns_it,
              m.role::text AS role_word
         FROM workspace_members m
        WHERE m.workspace_id = $2 AND m.user_id = $1
     ),
     held AS (
       SELECT r.key, r.page_level, r.rights
         FROM member me
         JOIN roles r ON r.id = me.held_role_id
       UNION ALL
       /*
        * The bridge, and the reason it is here rather than in a backfill.
        *
        * The migration points every existing membership at a role. What it
        * cannot do is point at rows that do not exist yet: during a rolling
        * deploy the previous server is still inserting memberships with only
        * the enum column, and a restored dump or a rolled-back release does
        * the same. Without this those people are members holding no role,
        * which resolves to no access at all — a permission failure that looks
        * exactly like being thrown out of the workspace.
        *
        * It reads the column this change otherwise stops reading, and it goes
        * when that column is dropped.
        */
       SELECT r.key, r.page_level, r.rights
         FROM member me
         JOIN roles r ON r.key = me.role_word
        WHERE me.held_role_id IS NULL
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
       -- The same bridge for ownership: a membership written by the previous
       -- server carries the word and not the column.
       COALESCE(
         (SELECT me.owns_it OR me.role_word = 'owner' FROM member me),
         false
       ) AS is_owner,
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
    -- Their role, or — for a membership written before role_id existed, or by
    -- a server that has not restarted during a rolling deploy — the row their
    -- old enum value names. The same bridge as in the loader above, and it
    -- goes when that column is dropped.
    LEFT JOIN roles r
           ON r.id = m.role_id
           OR (m.role_id IS NULL AND r.key = m.role::text)
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
