/**
 * Moving an entry, and everything under it, to another workspace (ADR-0038).
 *
 * A page is not only its parent. It has files, a search row, tags, possibly a
 * collection, restrictions naming members and groups of the workspace it is
 * leaving, share links issued under that workspace, favourites held by people who
 * may not be members of the next one, and relations to pages that are staying.
 *
 * All of it moves, is dropped, or is severed — in one transaction, because half a
 * move is not a state this application should be able to be in.
 *
 * And the losses are counted from the subtree itself rather than estimated, in the
 * same transaction that performs the move, so what the person was shown is what
 * happened. A count read separately can be wrong by the time it is confirmed.
 */

import type { Pool, PoolClient } from 'pg';

import { generateKeyBetween } from '@sone/core';

import { queryOne, queryRows } from '../db/pool.js';

/** What a move will do, or has done. */
export interface MoveCost {
  /** Pages in the subtree, including the one being moved. */
  pages: number;
  /** Files carried with them. */
  files: number;
  /** Share links that will stop working. */
  shareLinks: number;
  /** Pages that will arrive without the restriction they have now. */
  restrictions: number;
  /** References to or from pages staying behind, which will be severed. */
  references: number;
  /** Favourites and landing choices held by people who are not members there. */
  favourites: number;
}

export type MoveFailure =
  | { status: 404; code: 'not_found' }
  | { status: 403; code: 'not_authorized' }
  | { status: 409; code: 'is_collection_row' }
  | { status: 409; code: 'inside_protected_section' }
  | { status: 409; code: 'same_workspace' }
  /** The target has no folder, and a page cannot live at a workspace's root. */
  | { status: 409; code: 'no_folder_in_target' };

/**
 * The ids of the subtree: the entry and everything with it in its ancestry.
 *
 * `ancestor_ids` rather than a recursive query, which is what that column is for
 * (see 0001_init.sql). Archived pages are included: they are still in the tree as
 * far as the trash is concerned, and leaving them behind would orphan them into a
 * workspace their parent has left.
 */
async function subtreeIds(db: PoolClient, pageId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    db,
    `SELECT id FROM pages WHERE id = $1 OR $1 = ANY(ancestor_ids)`,
    [pageId],
  );
  return rows.map((row) => row.id);
}

/** What moving this subtree would cost, counted from the database. */
async function costOf(
  db: PoolClient,
  ids: string[],
  targetWorkspaceId: string,
): Promise<MoveCost> {
  const one = async (sql: string, params: unknown[]): Promise<number> => {
    const row = await queryOne<{ n: string }>(db, sql, params);
    return Number(row?.n ?? 0);
  };

  return {
    pages: ids.length,
    files: await one(`SELECT count(*)::text AS n FROM files WHERE page_id = ANY($1::uuid[])`, [ids]),
    shareLinks: await one(
      `SELECT count(*)::text AS n FROM share_tokens
        WHERE scope_page_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [ids],
    ),
    // A page counts once however many rules it carries: what somebody needs to
    // know is how many pages arrive open, not how many rows are deleted.
    restrictions: await one(
      `SELECT count(DISTINCT page_id)::text AS n FROM (
         SELECT page_id FROM page_permissions WHERE page_id = ANY($1::uuid[])
         UNION ALL
         SELECT page_id FROM page_group_permissions WHERE page_id = ANY($1::uuid[])
       ) rules`,
      [ids],
    ),
    references: await one(
      `SELECT count(*)::text AS n FROM page_relations
        WHERE (from_page_id = ANY($1::uuid[])) <> (to_page_id = ANY($1::uuid[]))`,
      [ids],
    ),
    favourites: await one(
      `SELECT count(*)::text AS n FROM favourites f
        WHERE f.page_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM workspace_members m
             WHERE m.workspace_id = $2 AND m.user_id = f.user_id
          )`,
      [ids, targetWorkspaceId],
    ),
  };
}

interface MoveInput {
  pageId: string;
  targetWorkspaceId: string;
  /** Read-only: count what would happen and change nothing. */
  dryRun?: boolean;
}

/**
 * Check that this entry may move at all.
 *
 * A collection row belongs to its collection, and a page inside a protected
 * section has its permission *from* where it sits — moving either out is not a
 * relocation, it is a change of what the thing is. Refused with a reason rather
 * than hidden, so the interface can say which of the two it was.
 */
async function moveable(
  db: PoolClient,
  pageId: string,
): Promise<
  | { ok: true; workspaceId: string; kind: string }
  | { ok: false; failure: MoveFailure }
> {
  const page = await queryOne<{
    workspace_id: string;
    kind: string;
    collection_id: string | null;
    ancestor_ids: string[];
  }>(
    db,
    `SELECT workspace_id, kind, collection_id, ancestor_ids FROM pages WHERE id = $1`,
    [pageId],
  );
  if (!page) return { ok: false, failure: { status: 404, code: 'not_found' } };
  if (page.collection_id !== null) {
    return { ok: false, failure: { status: 409, code: 'is_collection_row' } };
  }

  if (page.ancestor_ids.length > 0) {
    const guarded = await queryOne<{ id: string }>(
      db,
      `SELECT id FROM pages WHERE id = ANY($1::uuid[]) AND kind = 'container' LIMIT 1`,
      [page.ancestor_ids],
    );
    if (guarded) {
      return { ok: false, failure: { status: 409, code: 'inside_protected_section' } };
    }
  }

  return { ok: true, workspaceId: page.workspace_id, kind: page.kind };
}

/**
 * Move a subtree, or count what moving it would cost.
 *
 * Authorisation is the caller's: it needs the right in two workspaces, which is a
 * question about a session rather than about rows, and this function is
 * deliberately unable to answer it. It does check what cannot move at all.
 */
export async function moveToWorkspace(
  pool: Pool,
  input: MoveInput,
): Promise<
  | { ok: true; cost: MoveCost; parentPageId: string | null }
  | { ok: false; failure: MoveFailure }
> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const check = await moveable(db, input.pageId);
    if (!check.ok) {
      await db.query('ROLLBACK');
      return { ok: false, failure: check.failure };
    }
    if (check.workspaceId === input.targetWorkspaceId) {
      await db.query('ROLLBACK');
      return { ok: false, failure: { status: 409, code: 'same_workspace' } };
    }

    const kind = check.kind;
    const ids = await subtreeIds(db, input.pageId);
    const cost = await costOf(db, ids, input.targetWorkspaceId);

    if (input.dryRun) {
      // Rolled back rather than committed: a count is a read, and a read that
      // holds a transaction open to no purpose is a lock nobody meant to take.
      await db.query('ROLLBACK');
      return { ok: true, cost, parentPageId: null };
    }

    // --- the losses, first ------------------------------------------------
    //
    // Before the workspace changes, while these rows still mean what they say.

    // Restrictions cannot be translated. `page_permissions` names users and
    // `page_group_permissions` names groups; a user may not be a member of the
    // target and a group certainly does not exist there. Matching by name would
    // be a permission granted on a guess (ADR-0038).
    await db.query(`DELETE FROM page_permissions WHERE page_id = ANY($1::uuid[])`, [ids]);
    await db.query(`DELETE FROM page_group_permissions WHERE page_id = ANY($1::uuid[])`, [ids]);

    // A share link that outlived the boundary it was issued under is a hole with
    // no way to notice it.
    await db.query(
      `UPDATE share_tokens SET revoked_at = now()
        WHERE scope_page_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
      [ids],
    );

    // References that would now cross the boundary, in both directions.
    await db.query(
      `DELETE FROM page_relations
        WHERE (from_page_id = ANY($1::uuid[])) <> (to_page_id = ANY($1::uuid[]))`,
      [ids],
    );

    // Favourites and landing choices held by people who are not members there.
    // Theirs to lose rather than a leak — a favourite is a row, not access — but
    // a sidebar entry nobody can open is worse than none.
    await db.query(
      `DELETE FROM favourites f
        WHERE f.page_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM workspace_members m
             WHERE m.workspace_id = $2 AND m.user_id = f.user_id
          )`,
      [ids, input.targetWorkspaceId],
    );
    await db.query(
      `UPDATE workspace_landing SET page_id = NULL
        WHERE page_id = ANY($1::uuid[])`,
      [ids],
    );
    await db.query(
      `UPDATE workspace_landing SET last_page_id = NULL
        WHERE last_page_id = ANY($1::uuid[])`,
      [ids],
    );

    // --- then the move ----------------------------------------------------

    // Where it lands.
    //
    // A folder goes to the target's root. A page cannot: the tree constraints
    // require a page to have a folder for a parent (0003), which the schema is
    // right about — a page at the root of a workspace is the arrangement 0.2.0
    // had and dropped. So a page goes into the target's first root folder, and
    // the response says which, because "it moved" without "to where" is not an
    // answer somebody can act on.
    //
    // Not a folder chosen in the dialog: that would mean showing another
    // workspace's tree inside this decision, and the entry can be dragged where
    // it belongs the moment it arrives.
    let parentId: string | null = null;
    if (kind !== 'folder') {
      const folder = await queryOne<{ id: string }>(
        db,
        `SELECT id FROM pages
          WHERE workspace_id = $1 AND kind = 'folder'
            AND parent_page_id IS NULL AND archived_at IS NULL
          ORDER BY idx, id LIMIT 1`,
        [input.targetWorkspaceId],
      );
      if (!folder) {
        await db.query('ROLLBACK');
        return { ok: false, failure: { status: 409, code: 'no_folder_in_target' } };
      }
      parentId = folder.id;
    }

    const last = await queryRows<{ idx: string }>(
      db,
      `SELECT idx FROM pages
        WHERE workspace_id = $1 AND parent_page_id IS NOT DISTINCT FROM $2
        ORDER BY idx DESC, id DESC LIMIT 1`,
      [input.targetWorkspaceId, parentId],
    );
    const idx = generateKeyBetween(last[0]?.idx ?? null, null);

    // The moved entry, keeping its own children.
    await db.query(
      `UPDATE pages
          SET workspace_id = $2,
              parent_page_id = $4,
              idx = $3,
              ancestor_ids = CASE WHEN $4::uuid IS NULL THEN '{}'::uuid[] ELSE ARRAY[$4::uuid] END
        WHERE id = $1`,
      [input.pageId, input.targetWorkspaceId, idx, parentId],
    );

    // Its descendants: the workspace changes and the path is re-rooted. The
    // ancestry above the moved entry is replaced by the entry's new one, which is
    // what a denormalised path has to say after a reparenting.
    await db.query(
      `UPDATE pages
          SET workspace_id = $2,
              ancestor_ids =
                (CASE WHEN $3::uuid IS NULL THEN '{}'::uuid[] ELSE ARRAY[$3::uuid] END)
                || ancestor_ids[
                     array_position(ancestor_ids, $1::uuid) : array_length(ancestor_ids, 1)
                   ]
        WHERE id <> $1 AND $1 = ANY(ancestor_ids)`,
      [input.pageId, input.targetWorkspaceId, parentId],
    );

    // Everything else that is scoped to a workspace and belongs to these pages.
    for (const table of ['files', 'page_search', 'page_tags', 'collections']) {
      await db.query(
        `UPDATE ${table} SET workspace_id = $2 WHERE page_id = ANY($1::uuid[])`,
        [ids, input.targetWorkspaceId],
      );
    }

    await db.query('COMMIT');
    return { ok: true, cost, parentPageId: parentId };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
  }
}
