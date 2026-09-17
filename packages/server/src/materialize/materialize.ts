/**
 * SONE — the materialiser.
 *
 * Projects one page's Y.Doc onto the relational tables. This is the load-
 * bearing piece of ADR-0002: if it is wrong, every view and every search
 * result is wrong, while the CRDTs remain intact and a rebuild fixes it.
 *
 * Two properties it must have, in this order of importance:
 *
 *   IDEMPOTENT   Running it twice on unchanged input must produce identical
 *                rows. Achieved by full replace-per-page rather than diffing.
 *   TOTAL        A malformed block, an unknown field type or a stale option
 *                id degrades that one thing. It never aborts the page, and it
 *                certainly never aborts a batch.
 *
 * Why full replace instead of a diff: a page is bounded in size (a document
 * with ten thousand blocks is already a usability problem), the write happens
 * once per commit rather than per keystroke, and a diff has failure modes —
 * missed deletions, stale rows — that are invisible until someone notices a
 * ghost row in a view. The simple thing that cannot drift wins.
 */

import { tagKey } from '@sone/core';
import {
  isDerived,
  type FieldType,
  type StoredValue,
} from '@sone/core';
import type { PoolClient } from 'pg';

import { guestName, isGuestKey } from '@sone/core';

import { writeNotifications } from '../notifications/fromComments.js';

import { queryOne, queryRows } from '../db/pool.js';
import { normaliseText } from './plainText.js';
import { readDocument, type ReadDocument } from './readDocument.js';
import { toShadowColumns, valueToSearchText } from './values.js';
import type * as Y from 'yjs';

export interface MaterializeOptions {
  /** Sequence number this projection reflects. */
  throughSeq: number;
  /** Workspace the page belongs to. Not stored in the CRDT. */
  workspaceId: string;
  /** Actor for last_edited_by, when known. */
  actorId?: string | null;
}

export interface MaterializeResult {
  pageId: string;
  blockCount: number;
  propertyCount: number;
  relationCount: number;
  /** Pages whose projection is now stale and must be re-run. */
  cascade: string[];
  warnings: string[];
}

/**
 * Field metadata needed to fill shadow columns, keyed by field id.
 *
 * Read from collection_fields rather than from the CRDT because a row's own
 * document does not contain its collection's schema.
 */
type FieldMeta = Map<string, { fieldType: FieldType; optionOrder: string[]; optionNames: Map<string, string> }>;

async function loadFieldMeta(
  db: PoolClient,
  collectionId: string | null,
): Promise<FieldMeta> {
  const meta: FieldMeta = new Map();
  if (!collectionId) return meta;

  const rows = await queryRows<{
    id: string;
    field_type: string;
    config: Record<string, unknown> | null;
  }>(
    db,
    `SELECT id, field_type, config FROM collection_fields WHERE collection_id = $1`,
    [collectionId],
  );

  for (const row of rows) {
    const options = Array.isArray(row.config?.['options'])
      ? (row.config!['options'] as Array<Record<string, unknown>>)
      : [];
    const optionOrder: string[] = [];
    const optionNames = new Map<string, string>();
    for (const opt of options) {
      const id = typeof opt['id'] === 'string' ? opt['id'] : null;
      if (!id) continue;
      optionOrder.push(id);
      if (typeof opt['name'] === 'string') optionNames.set(id, opt['name']);
    }
    meta.set(row.id, {
      fieldType: row.field_type as FieldType,
      optionOrder,
      optionNames,
    });
  }
  return meta;
}

/**
 * Recompute the ancestor path for a page.
 *
 * `pages.ancestor_ids` is denormalised so subtree permission checks are one
 * indexed containment test instead of a recursive CTE on every document open.
 * The cost lands here: moving a page must rewrite the array for its whole
 * subtree. Rare operation, hot read path — the right trade.
 *
 * The parent comes from the document, and a document is written by clients —
 * so `parentPageId` is attacker-controlled (ADR-0182). An editor can set it
 * over Yjs to a page in another workspace, or to the page's own descendant,
 * neither of which the HTTP move would allow (ADR-0019). So this decides the
 * *effective* parent as well as the path: a parent it will not accept is not
 * written, the page keeps the parent it had, and the bad value never reaches
 * the row. Returning the path with a parent the row does not carry would be
 * the two disagreeing.
 *
 * The cycle case is the one that mattered: it used to null the ancestors but
 * write the cyclic parent anyway, and `cascadeAncestors` then recursed on a
 * page that was its own child — an unbounded query with no timeout, holding a
 * pool connection until it was killed by hand (ADR-0182).
 */
async function computeAncestors(
  db: PoolClient,
  pageId: string,
  parentPageId: string | null,
  workspaceId: string,
  existingParentId: string | null,
  warnings: string[],
): Promise<{ parentPageId: string | null; ancestorIds: string[] }> {
  if (!parentPageId) return { parentPageId: null, ancestorIds: [] };

  const row = await queryOne<{ ancestor_ids: string[]; workspace_id: string }>(
    db,
    `SELECT ancestor_ids, workspace_id FROM pages WHERE id = $1`,
    [parentPageId],
  );

  // Parent not materialised yet: record the shallow path and let the parent's
  // own materialisation cascade down to fix it. Legitimate during import, which
  // writes children before their parents exist as rows.
  if (!row) {
    warnings.push(
      `parent ${parentPageId} not materialised yet; ancestor path is provisional`,
    );
    return { parentPageId, ancestorIds: [parentPageId] };
  }

  // A parent in another workspace is not a move the API can make (a page never
  // changes workspace), so an update that claims one is rejected: keep the
  // parent the row has rather than let `ancestor_ids` fill with ids that
  // belong to somebody else's tree.
  if (row.workspace_id !== workspaceId) {
    warnings.push(
      `parent ${parentPageId} is in another workspace; keeping existing parent`,
    );
    return keepExisting(db, pageId, existingParentId);
  }

  const path = [...row.ancestor_ids, parentPageId];
  if (path.includes(pageId)) {
    // A page under itself. Not written: the cascade below would never finish.
    warnings.push(
      `cycle detected: page ${pageId} appears in its own ancestor path; keeping existing parent`,
    );
    return keepExisting(db, pageId, existingParentId);
  }
  if (path.length > 128) {
    warnings.push(`ancestor path exceeds 128 levels; truncated`);
    return { parentPageId, ancestorIds: path.slice(-128) };
  }
  return { parentPageId, ancestorIds: path };
}

/**
 * Fall back to the parent the row already has, rather than an untrusted one.
 *
 * The existing parent is itself already-validated state, so its path is
 * recomputed from it directly — one step, no walk — and if it too is somehow
 * unusable the page becomes a root, which is the safe floor.
 */
async function keepExisting(
  db: PoolClient,
  pageId: string,
  existingParentId: string | null,
): Promise<{ parentPageId: string | null; ancestorIds: string[] }> {
  if (!existingParentId) return { parentPageId: null, ancestorIds: [] };
  const row = await queryOne<{ ancestor_ids: string[] }>(
    db,
    `SELECT ancestor_ids FROM pages WHERE id = $1`,
    [existingParentId],
  );
  if (!row) return { parentPageId: null, ancestorIds: [] };
  const path = [...row.ancestor_ids, existingParentId];
  if (path.includes(pageId)) return { parentPageId: null, ancestorIds: [] };
  return { parentPageId: existingParentId, ancestorIds: path.slice(-128) };
}

/**
 * Rewrite ancestor paths for everything below a page. Returns affected ids.
 *
 * The walk carries a depth and stops at 128, the same ceiling `computeAncestors`
 * puts on a path. A cyclic `parent_page_id` should never reach a row now that
 * the writer refuses one (ADR-0182), but a recursive `UNION ALL` on a cycle is
 * an unbounded query holding a connection with no `statement_timeout`, and a
 * projection is not the place to trust that the row it is reading is sane. The
 * bound makes the query terminate whatever the data is.
 */
async function cascadeAncestors(db: PoolClient, pageId: string): Promise<string[]> {
  /*
   * The new path is carried *down the recursion*, not looked up per row.
   *
   * The previous shape looked each descendant's path up from its parent's row
   * — `parent.ancestor_ids || parent.id` — inside the same UPDATE. A statement
   * sees the table as it was when the statement began, so a child read the
   * moved page's new path (that row was written a statement earlier) and every
   * grandchild read its parent's *old* path. Move folder A out of folder I and
   * A's children were right while A's grandchildren still named I as an
   * ancestor. Nothing looked wrong in the tree, which hangs off
   * parent_page_id. Then somebody trashed the now-empty I, and
   * `$1 = ANY(ancestor_ids)` archived every grandchild of A along with it —
   * which is how an imported workspace lost most of its pages the moment its
   * import folder was tidied away. The same stale path decided share-link
   * scope and subtree grants.
   *
   * So the recursion starts from the moved page's own (already updated) path
   * and appends one id per level; each row's new path is a value computed in
   * the CTE, and the snapshot no longer matters.
   */
  const rows = await queryRows<{ id: string }>(
    db,
    `WITH RECURSIVE subtree AS (
       SELECT c.id, moved.ancestor_ids || moved.id AS path, 0 AS depth
         FROM pages moved
         JOIN pages c ON c.parent_page_id = moved.id
        WHERE moved.id = $1
       UNION ALL
       SELECT p.id, s.path || s.id, s.depth + 1
         FROM pages p
         JOIN subtree s ON p.parent_page_id = s.id
        WHERE s.depth < 128
     )
     UPDATE pages p
        SET ancestor_ids = s.path
       FROM subtree s
      WHERE p.id = s.id
        AND p.ancestor_ids IS DISTINCT FROM s.path
      RETURNING p.id`,
    [pageId],
  );
  return rows.map((r) => r.id);
}

/**
 * Project one document.
 *
 * Must run inside a transaction supplied by the caller — the whole projection
 * for a page lands atomically or not at all, otherwise a crash mid-run leaves
 * a page with new blocks and stale properties.
 */
export async function materializeDocument(
  db: PoolClient,
  pageId: string,
  parsed: ReadDocument,
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const warnings = [...parsed.warnings];
  const cascade: string[] = [];

  // --- page row ------------------------------------------------------------

  const existing = await queryOne<{ parent_page_id: string | null }>(
    db,
    `SELECT parent_page_id FROM pages WHERE id = $1`,
    [pageId],
  );

  // The parent as the document asks for it is attacker-controlled; this is the
  // parent the row will actually carry (ADR-0182), which is the same one unless
  // the ask was a cross-workspace move or a cycle.
  const { parentPageId: effectiveParentId, ancestorIds: ancestors } =
    await computeAncestors(
      db,
      pageId,
      parsed.page.parentPageId,
      opts.workspaceId,
      existing?.parent_page_id ?? null,
      warnings,
    );
  const parentChanged =
    existing !== null && existing.parent_page_id !== effectiveParentId;

  await db.query(
    `INSERT INTO pages (
       id, workspace_id, parent_page_id, collection_id, idx, title, icon,
       cover, schema_version, archived_at, last_edited_at, last_edited_by,
       ancestor_ids, kind, width, template, locked
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       parent_page_id = EXCLUDED.parent_page_id,
       collection_id  = EXCLUDED.collection_id,
       idx            = EXCLUDED.idx,
       title          = EXCLUDED.title,
       icon           = EXCLUDED.icon,
       cover          = EXCLUDED.cover,
       schema_version = EXCLUDED.schema_version,
       archived_at    = EXCLUDED.archived_at,
       last_edited_at = now(),
       last_edited_by = EXCLUDED.last_edited_by,
       ancestor_ids   = EXCLUDED.ancestor_ids,
       -- Projected from the document, so a folder renamed or moved on another
       -- client lands here like any other edit (ADR-0019).
       kind           = EXCLUDED.kind,
       width          = EXCLUDED.width,
       template       = EXCLUDED.template,
       locked         = EXCLUDED.locked`,
    [
      pageId,
      opts.workspaceId,
      effectiveParentId,
      // Which collection this entry *belongs to*, not which it holds.
      //
      // For a row, the collection it is a record of (ADR-0021). For everything
      // else, null: a page that holds collections is not itself one, and it may
      // hold several.
      parsed.page.kind === 'row' ? parsed.page.collectionId : null,
      parsed.page.idx,
      parsed.page.title,
      parsed.page.icon === null ? null : JSON.stringify(parsed.page.icon),
      parsed.page.cover === null ? null : JSON.stringify(parsed.page.cover),
      parsed.schemaVersion,
      parsed.page.archivedAt,
      opts.actorId ?? null,
      ancestors,
      parsed.page.kind,
      // A row is drawn inside a table, so its own width would mean nothing —
      // stored as absent rather than as a value that never applies.
      parsed.page.kind === 'row' ? null : parsed.page.width,
      // A row is part of a collection and cannot be started from, so it is
      // never offered as a shape however its document is marked.
      parsed.page.kind === 'row' ? false : parsed.page.template,
      // Projected for the tree's padlock (ADR-0049); the document is the truth.
      parsed.page.locked,
    ],
  );

  // Tags, replaced wholesale for this page.
  //
  // Deleted then inserted rather than diffed: the set is small, the document is
  // the truth, and a diff would have to decide what an absent row means — which
  // is the kind of question that produces tags that cannot be removed.
  await db.query(`DELETE FROM page_tags WHERE page_id = $1`, [pageId]);
  if (parsed.page.tags.length > 0) {
    const keys = parsed.page.tags.map((tag) => tagKey(tag));
    await db.query(
      `INSERT INTO page_tags (page_id, workspace_id, tag_key, tag_label)
       SELECT $1, $2, unnest($3::text[]), unnest($4::text[])
       ON CONFLICT (page_id, tag_key) DO NOTHING`,
      [pageId, opts.workspaceId, keys, parsed.page.tags],
    );
  }


  /*
   * Which pages this one points at (ADR-0174).
   *
   * Deleted by source and rewritten, the discipline the tags above use and for
   * the same reason: the document is the truth and a diff would have to decide
   * what an absent row means. Scoping the delete to `from_page_id` is also what
   * keeps this out of the trap `writeNotifications` is in — a notification
   * whose block was deleted keeps its row for ever, because nothing deletes by
   * page.
   *
   * Targets that do not exist here are dropped, the way `page_relations` drops
   * dangling ones. A link to a page that has not been materialised yet is
   * ordinary during an import and whenever the other room flushed second, and
   * the next projection of this page picks it up. It is also what makes the
   * extractor's rule safe: it matches a uuid in a path without knowing this
   * instance's hostname, and **the existence check is the origin check**.
   */
  await db.query(`DELETE FROM page_links WHERE from_page_id = $1`, [pageId]);
  if (parsed.links.length > 0) {
    const wanted = [...new Set(parsed.links.map((link) => link.pageId))];
    /*
     * Any workspace, since ADR-0176.
     *
     * This was scoped to the source page's own workspace, on the argument that
     * the panel is about a workspace's own structure. Links across workspaces
     * became ordinary the moment the picker offered them, and a reference that
     * exists is a reference the target's readers should be able to see.
     *
     * Nothing is disclosed by writing the row: what a reader is *told* is
     * decided where the list is read, by the same condition the tree and search
     * use — and that condition already refuses a workspace they are not in.
     */
    const existing = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM pages WHERE id = ANY($1::uuid[])`,
      [wanted],
    );
    const known = new Set(existing.map((row) => row.id));
    // And never to itself: a page linking to its own top is a link that lands
    // where the reader already is, and it would sit in its own panel.
    const resolvable = parsed.links.filter(
      (link) => link.pageId !== pageId && known.has(link.pageId),
    );
    if (resolvable.length > 0) {
      await db.query(
        `INSERT INTO page_links (from_page_id, from_block_id, to_page_id, to_block_id)
         SELECT $1, unnest($2::text[]), unnest($3::uuid[]), unnest($4::text[])
         ON CONFLICT DO NOTHING`,
        [
          pageId,
          resolvable.map((link) => link.blockId),
          resolvable.map((link) => link.pageId),
          resolvable.map((link) => link.toBlockId),
        ],
      );
    }
  }

  /*
   * Comment threads, replaced wholesale for this page (ADR-0046).
   *
   * The same discipline as the tags above, and for a sharper reason: a diff
   * would have to decide what an absent row means, and the answer differs
   * between "the thread was deleted" and "this projection is behind". The
   * document is the truth, so the projection is rewritten from it.
   */
  await db.query(`DELETE FROM page_comments WHERE page_id = $1`, [pageId]);
  if (parsed.comments.length > 0) {
    await db.query(
      `INSERT INTO page_comments (
         page_id, thread_id, quote, resolved, detached, messages, opened_by,
         created_at, last_message_at
       )
       SELECT $1, unnest($2::text[]), unnest($3::text[]), unnest($4::boolean[]),
              unnest($5::boolean[]), unnest($6::integer[]), unnest($7::text[]),
              to_timestamp(unnest($8::bigint[]) / 1000.0),
              to_timestamp(unnest($9::bigint[]) / 1000.0)
       ON CONFLICT (page_id, thread_id) DO NOTHING`,
      [
        pageId,
        parsed.comments.map((thread) => thread.id),
        parsed.comments.map((thread) => thread.quote),
        parsed.comments.map((thread) => thread.resolved),
        parsed.comments.map((thread) => thread.detached),
        parsed.comments.map((thread) => thread.messages),
        parsed.comments.map((thread) => thread.openedBy),
        parsed.comments.map((thread) => thread.createdAt),
        parsed.comments.map((thread) => thread.lastMessageAt),
      ],
    );
  }

  /*
   * A notification whose thread is gone goes with it (ADR-0092).
   *
   * The rewrite above is one-directional: `page_comments` shrinks when
   * somebody deletes a thread, and `writeNotifications` only ever inserts. So
   * deleting a comment left its row in the bell for ever, pointing at a thread
   * that is not there — click it and nothing is found.
   *
   * `thread_id IS NOT NULL` is not a nicety. An assignment and a text mention
   * carry a null thread on purpose (the block id is their identity), and
   * without the guard every projection would wipe all of them.
   *
   * Threads, not messages: the projection stores a thread per row and a count,
   * so a single deleted reply inside a surviving thread is not visible here.
   * Its notification stays, and lands on the thread rather than on the
   * sentence — which is where the reader wanted to go anyway.
   */
  await db.query(
    `DELETE FROM notifications n
      WHERE n.page_id = $1
        AND n.thread_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM page_comments c
           WHERE c.page_id = n.page_id AND c.thread_id = n.thread_id
        )`,
    [pageId],
  );

  /*
   * And who has been addressed (ADR-0052).
   *
   * After the comment rows, from the same threads: this is the trusted side, so
   * it happens for a comment delivered by sync, by an import, or by any path
   * that did not exist when this was written.
   *
   * The threads come from `readDocument`, which resolved their anchors — but a
   * notification does not care whether the text is still there. Somebody was
   * asked a question either way.
   */
  const assigned = parsed.blocks.filter(
    (block) => block.type === 'todo' && typeof block.props['assignee'] === 'string',
  );
  if (parsed.comments.length > 0 || assigned.length > 0 || parsed.mentions.length > 0) {
    // The actor comes along for an assignment: a todo records who it is for and
    // not who gave it, so the person whose edit produced this projection is the
    // honest answer (ADR-0058).
    await writeNotifications(
      db,
      pageId,
      opts.workspaceId,
      parsed.commentThreads,
      /*
       * Every block, not the assigned ones (ADR-0085).
       *
       * `assignmentsFor` filters for todos with an assignee itself, so handing
       * it the pre-filtered list was a second copy of the same rule — and a
       * mention's excerpt is looked up in this list, so with only the todos in
       * it every mention in a paragraph came out with an empty excerpt. The
       * filter above still decides whether there is anything to do at all.
       */
      parsed.blocks,
      opts.actorId ?? null,
      // Mentions in the page's own text (ADR-0085), which is what somebody
      // means when they type an @ into a paragraph rather than into a comment.
      parsed.mentions,
    );
  }

  if (parentChanged) {
    // The page moved: every descendant's ancestor path is now wrong, and so
    // is any share-link scope check that relies on it.
    cascade.push(...(await cascadeAncestors(db, pageId)));
  }

  // --- blocks --------------------------------------------------------------

  // Full replace. See the note at the top of this file.
  await db.query(`DELETE FROM blocks WHERE page_id = $1`, [pageId]);

  if (parsed.blocks.length > 0) {
    // Single multi-row insert via unnest: one round trip regardless of block
    // count, and no statement-size explosion from generated placeholders.
    await db.query(
      `INSERT INTO blocks (id, page_id, parent_id, type, idx, props, plain_text)
       SELECT * FROM unnest(
         $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[],
         $6::jsonb[], $7::text[]
       )`,
      [
        parsed.blocks.map((b) => b.id),
        parsed.blocks.map(() => pageId),
        parsed.blocks.map((b) => b.parentId),
        parsed.blocks.map((b) => b.type),
        parsed.blocks.map((b) => b.idx),
        parsed.blocks.map((b) => JSON.stringify(b.props)),
        parsed.blocks.map((b) => b.plainText),
      ],
    );
  }

  // --- collection definition ----------------------------------------------

  // Every collection this page holds. A page may hold several (ADR-0021), so
  // this is a loop where it used to be an `if`.
  //
  // Collections whose id is no longer in the document are removed, or a
  // collection deleted from a page would keep its columns, its views and its
  // rows' values in the projection for ever.
  const keptCollectionIds = [...parsed.collections.keys()];
  await db.query(
    `DELETE FROM collections
      WHERE page_id = $1
        AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))`,
    [pageId, keptCollectionIds],
  );

  for (const [collectionId, collection] of parsed.collections) {

    await db.query(
      `INSERT INTO collections (id, workspace_id, page_id, title_field_id, schema_version)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         title_field_id = EXCLUDED.title_field_id,
         schema_version = EXCLUDED.schema_version`,
      [
        collectionId,
        opts.workspaceId,
        pageId,
        collection.titleFieldId,
        parsed.schemaVersion,
      ],
    );

    const keptFieldIds = collection.fields.map((f) => f.id);

    // Fields removed from the definition must lose their stored values too,
    // or page_properties accumulates orphans that no view can reach.
    await db.query(
      `DELETE FROM collection_fields
        WHERE collection_id = $1
          AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))`,
      [collectionId, keptFieldIds],
    );

    for (const field of collection.fields) {
      await db.query(
        `INSERT INTO collection_fields
           (id, collection_id, name, description, field_type, config, idx, schema_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           field_type = EXCLUDED.field_type,
           config = EXCLUDED.config,
           idx = EXCLUDED.idx,
           schema_version = EXCLUDED.schema_version`,
        [
          field.id,
          collectionId,
          field.name,
          field.description,
          field.fieldType,
          JSON.stringify(field.config),
          field.idx,
          field.schemaVersion,
        ],
      );
    }

    const keptViewIds = collection.views.map((v) => v.id);
    await db.query(
      `DELETE FROM collection_views
        WHERE collection_id = $1
          AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))`,
      [collectionId, keptViewIds],
    );

    for (const view of collection.views) {
      await db.query(
        `INSERT INTO collection_views
           (id, collection_id, name, view_type, idx, definition, schema_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           view_type = EXCLUDED.view_type,
           idx = EXCLUDED.idx,
           definition = EXCLUDED.definition,
           schema_version = EXCLUDED.schema_version`,
        [
          view.id,
          collectionId,
          view.name,
          view.viewType,
          view.idx,
          JSON.stringify(view.definition),
          view.schemaVersion,
        ],
      );
    }

    // A field's type or options changing invalidates every row's shadow
    // columns, so all rows of this collection need re-projection.
    const rows = await queryRows<{ id: string }>(
      db,
      `SELECT id FROM pages WHERE collection_id = $1 AND id <> $2`,
      [collectionId, pageId],
    );
    cascade.push(...rows.map((r) => r.id));
  }

  // --- properties and relations -------------------------------------------

  // Which collection this row belongs to.
  //
  // From the parent, not from the row's own document. A row belongs to a
  // collection by being inside the folder that has the columns (ADR-0019) —
  // there is nothing in the row saying so, and nothing writes one.
  //
  // Reading `parsed.page.collectionId` meant this was always null for a row
  // created the ordinary way, so no field metadata was loaded and every typed
  // shadow column stayed empty. The jsonb value was stored, so a cell read back
  // correctly and nothing looked wrong — until something tried to sort or
  // filter on those columns, which is exactly what they exist for.
  const owningCollection =
    parsed.page.collectionId ??
    (
      await queryRows<{ id: string }>(
        db,
        `SELECT c.id FROM collections c
           JOIN pages p ON p.parent_page_id = c.page_id
          WHERE p.id = $1`,
        [pageId],
      )
    )[0]?.id ??
    null;

  const fieldMeta = await loadFieldMeta(db, owningCollection);

  await db.query(`DELETE FROM page_properties WHERE page_id = $1`, [pageId]);
  await db.query(`DELETE FROM page_relations WHERE from_page_id = $1`, [pageId]);

  let propertyCount = 0;
  let relationCount = 0;
  const propertySearchText: string[] = [];

  for (const [fieldId, value] of parsed.properties) {
    const meta = fieldMeta.get(fieldId);

    if (!meta) {
      // The collection has not been materialised yet, or the field was
      // deleted. Store the raw value so nothing is lost, leave shadow columns
      // null, and let the collection's own materialisation cascade back here.
      warnings.push(`field ${fieldId} unknown; stored without sort columns`);
      await insertProperty(db, pageId, fieldId, value, null);
      propertyCount++;
      continue;
    }

    if (isDerived(meta.fieldType)) {
      warnings.push(
        `field ${fieldId} is derived (${meta.fieldType}) but has a stored ` +
          `value; ignored. A client is writing computed values into the CRDT.`,
      );
      continue;
    }

    const shadow = toShadowColumns(value, {
      fieldType: meta.fieldType,
      optionOrder: meta.optionOrder,
    });
    await insertProperty(db, pageId, fieldId, value, shadow);
    propertyCount++;

    propertySearchText.push(valueToSearchText(value, meta.optionNames));

    if (value.kind === 'relation' && value.pageIds.length > 0) {
      // Stored on the owning side only; the inverse is a query against this
      // table (ADR-0002).
      const targets = value.pageIds.slice(0, 5000);
      if (targets.length < value.pageIds.length) {
        warnings.push(
          `field ${fieldId}: relation truncated at 5000 targets`,
        );
      }
      const existingTargets = await queryRows<{ id: string }>(
        db,
        `SELECT id FROM pages WHERE id = ANY($1::uuid[])`,
        [targets],
      );
      const known = new Set(existingTargets.map((r) => r.id));
      const resolvable = targets.filter((t) => known.has(t));
      if (resolvable.length < targets.length) {
        // Dangling targets are normal during import and when a target has not
        // synced yet. Kept in the jsonb value, omitted from the join table.
        warnings.push(
          `field ${fieldId}: ${targets.length - resolvable.length} relation ` +
            `target(s) not yet materialised; omitted from page_relations`,
        );
      }
      if (resolvable.length > 0) {
        await db.query(
          `INSERT INTO page_relations (from_page_id, field_id, to_page_id, idx)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[])
           ON CONFLICT DO NOTHING`,
          [
            resolvable.map(() => pageId),
            resolvable.map(() => fieldId),
            resolvable,
            resolvable.map((_, i) => String(i).padStart(6, '0')),
          ],
        );
        relationCount += resolvable.length;
      }
    }
  }

  // --- search index -------------------------------------------------------

  const searchText = normaliseText(
    [
      parsed.page.title,
      ...parsed.blocks.map((b) => b.plainText),
      // A canvas's text items, in the reading order a canvas does not have
      // (ADR-0043) — a snippet needs some order, and this is the fiction
      // everybody already has.
      parsed.canvasText,
      // And what was said *about* the page. A discussion of a decision is often
      // where the decision is actually explained (ADR-0046), so a search that
      // ignored comments would miss the reasoning while finding the result.
      ...parsed.comments.map((thread) => thread.text),
      ...propertySearchText,
    ].join(' '),
  );

  // The workspace's configured dictionary, defaulting to 'simple' if the
  // workspace row has somehow gone missing — search degrading to unstemmed is
  // far better than a page dropping out of the index entirely.
  const configRow = await queryOne<{ search_config: string }>(
    db,
    `SELECT search_config::text AS search_config FROM workspaces WHERE id = $1`,
    [opts.workspaceId],
  );
  const searchConfig = configRow?.search_config ?? 'simple';

  // Both dictionaries in one vector: the stemmed lexemes give recall (a German
  // search for "Häuser" finds "Haus"), the simple lexemes keep search working
  // for content in a language the configured dictionary does not cover, which
  // is the normal case in a multilingual workspace. Title at weight A, body at
  // D, so a title match outranks a passing mention.
  await db.query(
    `INSERT INTO page_search (page_id, workspace_id, tsv, authors, built_with, updated_at)
     VALUES (
       $1, $2,
       setweight(to_tsvector($3::regconfig, $4), 'A') ||
       setweight(to_tsvector('simple',      $4), 'A') ||
       -- Tags at weight B: below the title, above the body. A page tagged
       -- "meeting" is more about meetings than one that mentions the word once,
       -- and typing a tag name into search should find it without anyone
       -- learning a filter syntax (ADR-0020).
       setweight(to_tsvector('simple',      $6), 'B') ||
       setweight(to_tsvector($3::regconfig, $5), 'D') ||
       setweight(to_tsvector('simple',      $5), 'D'),
       $7::text[], $3::regconfig, now()
     )
     ON CONFLICT (page_id) DO UPDATE
       SET tsv = EXCLUDED.tsv,
           authors = EXCLUDED.authors,
           built_with = EXCLUDED.built_with,
           updated_at = now(),
           workspace_id = EXCLUDED.workspace_id`,
    [
      pageId,
      opts.workspaceId,
      searchConfig,
      parsed.page.title,
      searchText,
      // Only the 'simple' dictionary for tags: a tag is a label rather than
      // prose, and stemming "meetings" into "meet" would make it match text
      // that has nothing to do with the tag.
      parsed.page.tags.join(' '),
      // Who has writing in this page, by the name somebody would type
      // (ADR-0050). Resolved here rather than per search row.
      await authorNames(db, parsed.authorKeys),
    ],
  );

  /*
   * The workspace's word list (ADR-0051).
   *
   * This page's words, replaced wholesale — the same discipline as the tags and
   * the comment threads, and for the same reason: a diff would have to decide
   * what an absent word means, and the answer differs between "this page no
   * longer says it" and "this projection is behind".
   *
   * But *only this page's* rows can be removed, and a word another page still
   * uses must survive that. So the delete is scoped by a subquery over this
   * page's own words, and the insert is `ON CONFLICT DO NOTHING`: two pages
   * sharing a word share one row.
   *
   * The consequence, accepted rather than engineered around: a word that has
   * left the workspace entirely lingers until something else is projected. A
   * suggestion for a word that used to be here harms nobody, and a reference
   * count per word would be a second thing to keep correct.
   */
  const words = searchWords(`${parsed.page.title} ${searchText}`);
  if (words.length > 0) {
    await db.query(
      `INSERT INTO workspace_words (workspace_id, word)
       SELECT $1, unnest($2::text[])
       ON CONFLICT DO NOTHING`,
      [opts.workspaceId, words],
    );
  }

  // --- bookkeeping --------------------------------------------------------

  await db.query(
    `INSERT INTO materialization_state
       (page_id, through_seq, status, last_error, attempts, materialized_at)
     VALUES ($1, $2, 'ok', NULL, 0, now())
     ON CONFLICT (page_id) DO UPDATE SET
       through_seq = EXCLUDED.through_seq,
       status = 'ok',
       last_error = NULL,
       attempts = 0,
       materialized_at = now()`,
    [pageId, opts.throughSeq],
  );

  return {
    pageId,
    blockCount: parsed.blocks.length,
    propertyCount,
    relationCount,
    cascade: [...new Set(cascade)].filter((id) => id !== pageId),
    warnings,
  };
}

async function insertProperty(
  db: PoolClient,
  pageId: string,
  fieldId: string,
  value: StoredValue,
  shadow: ReturnType<typeof toShadowColumns> | null,
): Promise<void> {
  await db.query(
    `INSERT INTO page_properties
       (page_id, field_id, value, text_value, number_value, date_start, date_end, bool_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (page_id, field_id) DO UPDATE SET
       value = EXCLUDED.value,
       text_value = EXCLUDED.text_value,
       number_value = EXCLUDED.number_value,
       date_start = EXCLUDED.date_start,
       date_end = EXCLUDED.date_end,
       bool_value = EXCLUDED.bool_value`,
    [
      pageId,
      fieldId,
      JSON.stringify(value),
      shadow?.textValue ?? null,
      shadow?.numberValue ?? null,
      shadow?.dateStart ?? null,
      shadow?.dateEnd ?? null,
      shadow?.boolValue ?? null,
    ],
  );
}

/** Convenience wrapper: read a Y.Doc and project it. */
export async function materializeYDoc(
  db: PoolClient,
  pageId: string,
  doc: Y.Doc,
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  return materializeDocument(db, pageId, readDocument(doc, pageId), opts);
}


/** Record a failure without losing the previous projection. */
export async function markFailed(
  db: PoolClient,
  pageId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.query(
    `INSERT INTO materialization_state (page_id, status, last_error, attempts, materialized_at)
     VALUES ($1, 'failed', $2, 1, now())
     ON CONFLICT (page_id) DO UPDATE
       SET status = 'failed',
           last_error = $2,
           attempts = materialization_state.attempts + 1,
           materialized_at = now()`,
    [pageId, message.slice(0, 2000)],
  );
}

/**
 * The names somebody would type, from the keys the document holds.
 *
 * A `guest:` key carries its own name (ADR-0022) and needs nothing; a user id
 * needs the users table. One query for all of them, once per projection —
 * rather than a join per row of every ranked search, which is the same work
 * done thousands of times to answer a question that changes when a page is
 * edited.
 *
 * Somebody who has since been deleted contributes nothing to the array rather
 * than an empty string: an empty name would match every prefix.
 */
async function authorNames(db: PoolClient, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];

  const names: string[] = [];
  const userIds: string[] = [];
  for (const key of keys) {
    if (isGuestKey(key)) names.push(guestName(key));
    else userIds.push(key);
  }

  if (userIds.length > 0) {
    const rows = await queryRows<{ display_name: string | null }>(
      db,
      `SELECT display_name FROM users WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    for (const row of rows) {
      if (row.display_name) names.push(row.display_name);
    }
  }

  // Deduplicated: one person with two client ids is one author.
  return [...new Set(names)];
}

/**
 * The words worth suggesting, from a page's text.
 *
 * Letters only, and at least four of them: a suggestion for "der" is noise, and
 * a trigram match on a three-letter word is mostly coincidence. Digits are
 * dropped because nobody misspells 2026 in a way a correction helps with.
 *
 * Capped per page, so one enormous imported document cannot write forty thousand
 * rows in a single projection.
 */
export function searchWords(text: string): string[] {
  const found = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (raw.length < 4 || raw.length > 40) continue;
    found.add(raw);
    if (found.size >= 2000) break;
  }
  return [...found];
}
