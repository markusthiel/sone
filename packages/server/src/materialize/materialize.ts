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

import {
  isDerived,
  type FieldType,
  type StoredValue,
} from '@sone/core';
import type { PoolClient } from 'pg';

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
 * Cycles are possible if a client is buggy or malicious (page A's parent set
 * to its own descendant), so the walk is bounded and reports rather than
 * hangs.
 */
async function computeAncestors(
  db: PoolClient,
  pageId: string,
  parentPageId: string | null,
  warnings: string[],
): Promise<string[]> {
  if (!parentPageId) return [];

  const row = await queryOne<{ ancestor_ids: string[] }>(
    db,
    `SELECT ancestor_ids FROM pages WHERE id = $1`,
    [parentPageId],
  );

  // Parent not materialised yet: record the shallow path and let the parent's
  // own materialisation cascade down to fix it.
  if (!row) {
    warnings.push(
      `parent ${parentPageId} not materialised yet; ancestor path is provisional`,
    );
    return [parentPageId];
  }

  const path = [...row.ancestor_ids, parentPageId];
  if (path.includes(pageId)) {
    warnings.push(
      `cycle detected: page ${pageId} appears in its own ancestor path; treating as root`,
    );
    return [];
  }
  if (path.length > 128) {
    warnings.push(`ancestor path exceeds 128 levels; truncated`);
    return path.slice(-128);
  }
  return path;
}

/** Rewrite ancestor paths for everything below a page. Returns affected ids. */
async function cascadeAncestors(db: PoolClient, pageId: string): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    db,
    `WITH RECURSIVE subtree AS (
       SELECT id, ancestor_ids FROM pages WHERE parent_page_id = $1
       UNION ALL
       SELECT p.id, p.ancestor_ids
         FROM pages p
         JOIN subtree s ON p.parent_page_id = s.id
     )
     UPDATE pages p
        SET ancestor_ids = (
              SELECT parent.ancestor_ids || parent.id
                FROM pages parent WHERE parent.id = p.parent_page_id
            )
      WHERE p.id IN (SELECT id FROM subtree)
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
  const parentChanged =
    existing !== null && existing.parent_page_id !== parsed.page.parentPageId;

  const ancestors = await computeAncestors(
    db,
    pageId,
    parsed.page.parentPageId,
    warnings,
  );

  await db.query(
    `INSERT INTO pages (
       id, workspace_id, parent_page_id, collection_id, idx, title, icon,
       cover_url, schema_version, archived_at, last_edited_at, last_edited_by,
       ancestor_ids, kind
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11, $12, $13)
     ON CONFLICT (id) DO UPDATE SET
       parent_page_id = EXCLUDED.parent_page_id,
       collection_id  = EXCLUDED.collection_id,
       idx            = EXCLUDED.idx,
       title          = EXCLUDED.title,
       icon           = EXCLUDED.icon,
       cover_url      = EXCLUDED.cover_url,
       schema_version = EXCLUDED.schema_version,
       archived_at    = EXCLUDED.archived_at,
       last_edited_at = now(),
       last_edited_by = EXCLUDED.last_edited_by,
       ancestor_ids   = EXCLUDED.ancestor_ids,
       -- Projected from the document, so a folder renamed or moved on another
       -- client lands here like any other edit (ADR-0019).
       kind           = EXCLUDED.kind`,
    [
      pageId,
      opts.workspaceId,
      parsed.page.parentPageId,
      parsed.page.collectionId,
      parsed.page.idx,
      parsed.page.title,
      parsed.page.icon === null ? null : JSON.stringify(parsed.page.icon),
      parsed.page.coverUrl,
      parsed.schemaVersion,
      parsed.page.archivedAt,
      opts.actorId ?? null,
      ancestors,
      parsed.page.kind,
    ],
  );

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

  if (parsed.collection) {
    const collectionId = parsed.page.collectionId ?? pageId;

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
        parsed.collection.titleFieldId,
        parsed.schemaVersion,
      ],
    );

    const keptFieldIds = parsed.collection.fields.map((f) => f.id);

    // Fields removed from the definition must lose their stored values too,
    // or page_properties accumulates orphans that no view can reach.
    await db.query(
      `DELETE FROM collection_fields
        WHERE collection_id = $1
          AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))`,
      [collectionId, keptFieldIds],
    );

    for (const field of parsed.collection.fields) {
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

    const keptViewIds = parsed.collection.views.map((v) => v.id);
    await db.query(
      `DELETE FROM collection_views
        WHERE collection_id = $1
          AND ($2::uuid[] = '{}' OR id <> ALL($2::uuid[]))`,
      [collectionId, keptViewIds],
    );

    for (const view of parsed.collection.views) {
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

  const fieldMeta = await loadFieldMeta(db, parsed.page.collectionId);

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
    `INSERT INTO page_search (page_id, workspace_id, tsv, built_with, updated_at)
     VALUES (
       $1, $2,
       setweight(to_tsvector($3::regconfig, $4), 'A') ||
       setweight(to_tsvector('simple',      $4), 'A') ||
       setweight(to_tsvector($3::regconfig, $5), 'D') ||
       setweight(to_tsvector('simple',      $5), 'D'),
       $3::regconfig, now()
     )
     ON CONFLICT (page_id) DO UPDATE
       SET tsv = EXCLUDED.tsv,
           built_with = EXCLUDED.built_with,
           updated_at = now(),
           workspace_id = EXCLUDED.workspace_id`,
    [pageId, opts.workspaceId, searchConfig, parsed.page.title, searchText],
  );

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
  return materializeDocument(db, pageId, readDocument(doc), opts);
}

/** Mark a page's projection stale so the rebuild worker picks it up. */
export async function markStale(
  db: PoolClient,
  pageId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `INSERT INTO materialization_state (page_id, status, last_error, materialized_at)
     VALUES ($1, 'stale', $2, now())
     ON CONFLICT (page_id) DO UPDATE
       SET status = 'stale', last_error = $2`,
    [pageId, reason.slice(0, 2000)],
  );
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
