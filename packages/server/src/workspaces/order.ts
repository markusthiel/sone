/**
 * SONE — the order of a person's workspaces (ADR-0031).
 *
 * The switcher's order belongs to one person: two members of the same workspace
 * have different lists, so there is no shared object it could be a property of.
 * It is therefore instance data on the membership row, like a favourite, and not
 * in the CRDTs like a folder's place in the tree — the reasoning is written out
 * in ADR-0031 and in the header of `favourites.ts`.
 *
 * A fractional index rather than a position, so placing one workspace writes one
 * row and two browsers reordering at once produce keys that both survive.
 */

import { generateKeyBetween } from '@sone/core';
import type { Pool } from 'pg';

import { queryRows, withTransaction } from '../db/pool.js';

/**
 * How a person's workspaces are ordered, everywhere they are listed.
 *
 * Exported as one string because two endpoints list them — `/api/workspaces` and
 * `/api/auth/session` — and they must agree: `useSession` opens the first entry
 * when no workspace is remembered, so a disagreement would mean the switcher and
 * the workspace you land in are sorted differently.
 *
 * `idx IS NULL` first in the sort, so a membership that has never been placed
 * comes *after* every one that has, by name. A workspace joined after somebody
 * arranged their list then appears at the bottom, which is where a new thing
 * belongs. The ICU collation is named explicitly because the database is C
 * (ADR-0011): a user-visible sort wants locale rules, and the keys beside it
 * must not have them.
 *
 * Written to be interpolated into a query whose membership table is aliased `m`
 * and whose workspace table is aliased `w`.
 */
export const WORKSPACE_ORDER_SQL = `ORDER BY (m.idx IS NULL), m.idx, w.name COLLATE "und-x-icu"`;

export type PlaceResult =
  | { ok: true; idx: string }
  | { ok: false; status: number; code: string };

/**
 * Put a workspace directly after another in the caller's own order.
 *
 * `afterWorkspaceId` null means first; a value means after that one. There is
 * deliberately no "last" here, unlike moving a page: a drag always lands
 * somewhere specific, and the only other caller this could grow is a list with
 * an explicit "move to end", which does not exist.
 *
 * ## Why the whole list may be written
 *
 * A list nobody has arranged has no keys at all, and there is nothing to place a
 * key between. Writing one key would leave one workspace placed and the rest
 * alphabetical, which does not read as "this moved" — it reads as the wrong
 * thing having moved.
 *
 * So a first reorder materialises the order the person is currently looking at,
 * and then moves one row within it. In one transaction, and reading the rows
 * `FOR UPDATE`, because two tabs doing this at once must not both decide they
 * are the first.
 */
export async function placeWorkspace(
  pool: Pool,
  userId: string,
  workspaceId: string,
  afterWorkspaceId: string | null,
): Promise<PlaceResult> {
  if (afterWorkspaceId === workspaceId) {
    // "After itself" is not a position. Refused rather than treated as a no-op,
    // because a client that computed this has computed something wrong and
    // silence would hide it.
    return { ok: false, status: 409, code: 'cannot_follow_itself' };
  }

  return withTransaction(pool, async (client) => {
    // The same order the switcher drew, so "after that one" means what the
    // person saw. Locked on the membership rows only: `w` is joined for its
    // name, and locking workspaces here would take a lock somebody renaming one
    // has to wait for.
    const rows = await queryRows<{ workspace_id: string; idx: string | null }>(
      client,
      `SELECT m.workspace_id, m.idx
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = $1
          AND w.deleted_at IS NULL
        ${WORKSPACE_ORDER_SQL}
        FOR UPDATE OF m`,
      [userId],
    );

    if (!rows.some((row) => row.workspace_id === workspaceId)) {
      return { ok: false, status: 404, code: 'not_found' };
    }
    if (afterWorkspaceId !== null && !rows.some((row) => row.workspace_id === afterWorkspaceId)) {
      // Naming a workspace the caller is not in, or one that has since gone.
      // "Put it after that" has no meaning then, so it is refused rather than
      // placed somewhere arbitrary — the same answer `moveEntry` gives for a
      // sibling it cannot find.
      return { ok: false, status: 409, code: 'sibling_not_found' };
    }

    // Materialise, if this is the first time anybody arranged this list.
    //
    // Every row without a key gets one in the order shown, walking forwards so
    // each key is generated after the last — including rows that already had
    // one, which is why `previous` is carried rather than recomputed.
    let previous: string | null = null;
    const placed = new Map<string, string>();
    for (const row of rows) {
      if (row.idx === null) {
        previous = generateKeyBetween(previous, null);
        placed.set(row.workspace_id, previous);
      } else {
        previous = row.idx;
      }
    }
    for (const [id, idx] of placed) {
      await client.query(
        `UPDATE workspace_members SET idx = $3 WHERE user_id = $1 AND workspace_id = $2`,
        [userId, id, idx],
      );
    }

    // Now every row has a key, so the move is an ordinary insertion between two
    // of them. The moved row is taken out first: dropping something immediately
    // after its own neighbour must not try to fit a key between itself and that
    // neighbour.
    const ordered = rows
      .map((row) => ({
        id: row.workspace_id,
        idx: row.idx ?? placed.get(row.workspace_id)!,
      }))
      .filter((row) => row.id !== workspaceId);

    const at =
      afterWorkspaceId === null
        ? -1
        : ordered.findIndex((row) => row.id === afterWorkspaceId);
    const before = at >= 0 ? ordered[at]!.idx : null;
    const after = ordered[at + 1]?.idx ?? null;

    const idx = generateKeyBetween(before, after);
    await client.query(
      `UPDATE workspace_members SET idx = $3 WHERE user_id = $1 AND workspace_id = $2`,
      [userId, workspaceId, idx],
    );

    return { ok: true, idx };
  });
}
