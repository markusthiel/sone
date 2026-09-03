/**
 * SONE — collection routes.
 *
 * Reads come from the projection, writes go to the document.
 *
 * That is not an inconsistency, it is the architecture (ADR-0002). The document
 * is the truth and the only thing that can be edited; the projection exists so
 * a view can ask "the rows of this collection, with these columns, sorted"
 * without loading and walking every row's CRDT. Writing to the projection would
 * be undone by the next materialisation, and reading from the documents would
 * mean opening one Y.Doc per row.
 *
 * A collection is a folder that has fields. Not a third kind of entry: making
 * it one would mean every rule about moving, sharing and permissions needed a
 * third case, and a collection is a container of entries, which is exactly what
 * a folder is (ADR-0019).
 */

import {
  DOC_KEYS,
  PAGE_KEYS,
  addField,
  addView,
  initCollection,
  holdsCollections,
  removeField,
  generateKeyBetween,
  selectValueIsKnown,
  setOptions,
  setPropertyValue,
  updateField,
  updateView,
  DERIVED_FIELD_TYPES,
  type FieldType,
  type SelectOption,
  type StoredValue,
} from '@sone/core';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { effectiveRole, loadPageLocation, resolveSessionClaims } from '../auth/claims.js';
import { claimsFor } from './auth.js';

import {
  computeRollup,
  readRollupConfig,
  type DerivedValue,
} from '../collections/rollup.js';
import { visiblePagesCondition } from '../pages/access.js';

import { queryOne, queryRows } from '../db/pool.js';
import { applyToDocument } from '../doc/docStore.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { categoryOf } from '../files/store.js';
import { sessionTokenFrom } from './auth.js';
import {
  buildSearchClause,
  buildViewQuery,
  readFilters,
  readSorts,
} from './viewQuery.js';
import type { RequestContext, Router } from './router.js';

export interface CollectionDeps {
  pool: Pool;
}

/**
 * Field types that can be created today.
 *
 * A closed list, and deliberately shorter than the type model's. `relation`,
 * `rollup` and `formula` need a second collection or an expression language to
 * mean anything, and offering a column that cannot be filled is worse than not
 * offering it. The model has room for them; this list is what the interface can
 * honestly produce.
 */
const CREATABLE_FIELD_TYPES = new Set<FieldType>([
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  // Pointing at rows in another collection (ADR-0054). Creatable only with a
  // target: see the check below, which refuses one without.
  'relation',
  // The derived other side: what points *here*, counted or aggregated. Also
  // creatable only with a checked config.
  'rollup',
  // One media type, not three (ADR-0035). The file itself already says whether
  // it is an image, a PDF or something else — the server classifies every
  // upload — so a column that also declared it would be a second answer to the
  // same question, and the only thing it could add is refusing a PDF in an
  // "image" column.
  'files',
]);

/**
 * Most files one cell may hold (ADR-0035).
 *
 * A cell is a cell. Somebody with twenty documents about one entry has a page to
 * put them on — that is what a row being a page is for — and a table whose cells
 * are folders is a table nobody can read.
 */
const MAX_CELL_FILES = 8;
/*
 * How many rows one relation cell may point at.
 *
 * Higher than the file limit because pointing at a dozen tasks is ordinary
 * where a dozen attachments in a cell is not, and bounded at all because the
 * cell draws every one of them: a hundred chips in a table cell is not a
 * relation, it is a page that should exist.
 */
const MAX_CELL_RELATIONS = 32;

/** Field types whose options can be edited. */
const HAS_OPTIONS = new Set<string>(['select', 'multiSelect', 'status']);

interface Authorised {
  workspaceId: string;
  actorId: string | null;
  canEdit: boolean;
}

/** Resolve the caller against a page, or answer and return null. */
async function authorise(
  pool: Pool,
  ctx: RequestContext,
  pageId: string,
  need: 'read' | 'edit',
): Promise<Authorised | null> {
  const page = await loadPageLocation(pool, pageId);
  if (!page) {
    ctx.fail(404, 'not_found');
    return null;
  }

  const token = sessionTokenFrom(ctx);
  if (!token) {
    ctx.fail(401, 'not_authenticated');
    return null;
  }

  const claims = await resolveSessionClaims(pool, token, page.workspaceId);
  const role = claims ? effectiveRole(claims, page) : null;
  if (role === null) {
    ctx.fail(404, 'not_found');
    return null;
  }

  const canEdit = role !== 'viewer' && role !== 'commenter';
  if (need === 'edit' && !canEdit) {
    ctx.fail(403, 'not_authorized');
    return null;
  }

  return {
    workspaceId: page.workspaceId,
    actorId: claims!.principal.kind === 'anonymous' ? null : claims!.principal.userId,
    canEdit,
  };
}

/**
 * Resolve a collection to the page holding it, and the caller's rights there.
 *
 * Rights come from that page: a collection is content inside it (ADR-0021), so
 * whoever may edit the page may edit its columns. A second permission model
 * would be one more thing to keep in step for no gain.
 */
async function collectionPage(
  pool: Pool,
  ctx: RequestContext,
  need: 'read' | 'edit',
): Promise<{ collectionId: string; pageId: string; auth: Authorised } | null> {
  const collectionId = ctx.params['collectionId'] ?? '';
  const row = await queryOne<{ page_id: string }>(
    pool,
    `SELECT page_id FROM collections WHERE id = $1`,
    [collectionId],
  );
  if (!row) {
    ctx.fail(404, 'not_found');
    return null;
  }

  const auth = await authorise(pool, ctx, row.page_id, need);
  if (!auth) return null;
  return { collectionId, pageId: row.page_id, auth };
}

/**
 * Most rows one paste may create (ADR-0034).
 *
 * Craft's number. Generous enough for the case this was built for — a few dozen
 * lines out of a spreadsheet — and small enough that a mis-click on a copied
 * ten-thousand-line file does not build a workspace nobody can clean up. The
 * limit is on one operation and not on the table: pasting twice adds to what is
 * there, because a paste appends.
 */
export const MAX_BULK_ROWS = 50;

export function registerCollectionRoutes(router: Router, deps: CollectionDeps): void {
  /**
   * Add a collection to a page.
   *
   * A page, not a folder (ADR-0021). A folder organises; a collection is
   * content, and it belongs where the writing is. A page may hold several, so
   * this creates one rather than converting anything.
   */
  router.post('/api/pages/:pageId/collections', async (ctx) => {
    // Addressed by page, not by collection: there is no collection yet.
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

    const row = await queryOne<{ kind: string }>(
      deps.pool,
      `SELECT kind FROM pages WHERE id = $1`,
      [pageId],
    );
    if (row?.kind === 'row') {
      // A row is itself a record. Letting one hold a collection would make the
      // tree's third kind mean two things.
      ctx.fail(409, 'a_row_cannot_hold_a_collection');
      return;
    }

    const collectionId = randomUUID();
    const titleFieldId = randomUUID();
    const viewId = randomUUID();

    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        initCollection(doc, { collectionId, titleFieldId, titleName: 'Name' });
        addView(doc, collectionId, { id: viewId, name: 'Table', viewType: 'table' });
      },
      auth.actorId,
    );

    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(201, { pageId, collectionId });
  });

  /**
   * Add a row.
   *
   * A row is a document like any other — openable, with its own body — and it
   * is not in the tree (ADR-0021). Created here rather than through the page
   * routes because it needs the collection it belongs to, and because a page
   * created the ordinary way must never accidentally become one.
   */
  router.post('/api/collections/:collectionId/rows', async (ctx) => {
    const collectionId = ctx.params['collectionId'] ?? '';
    const collection = await queryOne<{ page_id: string }>(
      deps.pool,
      `SELECT page_id FROM collections WHERE id = $1`,
      [collectionId],
    );
    if (!collection) {
      ctx.fail(404, 'not_found');
      return;
    }

    // Rights come from the page holding the collection: a row is inside it, so
    // there is no second permission model to keep in step.
    const auth = await authorise(deps.pool, ctx, collection.page_id, 'edit');
    if (!auth) return;

    let body: { title?: string };
    try {
      body = await ctx.json();
    } catch {
      body = {};
    }

    const rowId = randomUUID();
    const siblings = await queryRows<{ idx: string }>(
      deps.pool,
      `SELECT idx FROM pages
        WHERE collection_id = $1 AND kind = 'row'
        ORDER BY idx DESC, id DESC LIMIT 1`,
      [collectionId],
    );

    await applyToDocument(
      deps.pool,
      rowId,
      (doc) => {
        const page = doc.getMap(DOC_KEYS.page);
        page.set(PAGE_KEYS.kind, 'row');
        page.set(PAGE_KEYS.parentPageId, collection.page_id);
        page.set(PAGE_KEYS.collectionId, collectionId);
        page.set(PAGE_KEYS.title, (body.title ?? '').trim());
        page.set(PAGE_KEYS.idx, generateKeyBetween(siblings[0]?.idx ?? null, null));
      },
      auth.actorId,
    );

    await rematerialize(deps.pool, rowId, auth.workspaceId, auth.actorId);
    ctx.send(201, { id: rowId, collectionId });
  });

  /**
   * Add several rows at once, from a pasted grid (ADR-0034).
   *
   * The point of this route is that fifty rows are one request. Through the
   * single-row and single-cell routes a three-column paste of fifty lines is two
   * hundred round trips, a table that fills in visibly, and no way to end up with
   * either all of it or none of it.
   *
   * **Appended, never overwriting.** A paste lands after whatever is already
   * there, so pasting a second fifty adds to the first rather than replacing it —
   * which is what makes the cap something somebody can work around by pasting
   * twice, rather than a wall.
   *
   * Everything that can be checked is checked before anything is written: the
   * permission, the cap, and that every field named belongs to this collection
   * and can hold a value. What is left after that is one document write per row,
   * and the ids of the rows actually created come back — so a caller interrupted
   * half way knows exactly what exists, and since the rows are appended, what
   * exists is a prefix of what was pasted rather than a scattering.
   */
  router.post('/api/collections/:collectionId/rows/bulk', async (ctx) => {
    const collectionId = ctx.params['collectionId'] ?? '';
    const collection = await queryOne<{ page_id: string }>(
      deps.pool,
      `SELECT page_id FROM collections WHERE id = $1`,
      [collectionId],
    );
    if (!collection) {
      ctx.fail(404, 'not_found');
      return;
    }

    const auth = await authorise(deps.pool, ctx, collection.page_id, 'edit');
    if (!auth) return;

    let body: { rows?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    // Over the cap is refused rather than trimmed here.
    //
    // The interface trims and says what it left, which is the right behaviour
    // for somebody who pasted too much; a route that silently drops rows would
    // be a different and much worse thing for anything else calling it.
    if (body.rows.length > MAX_BULK_ROWS) {
      ctx.fail(422, 'too_many_rows', { limit: MAX_BULK_ROWS });
      return;
    }

    const incoming = body.rows.map((entry) => {
      const row = (entry ?? {}) as { title?: unknown; values?: unknown };
      const values =
        row.values && typeof row.values === 'object' && !Array.isArray(row.values)
          ? (row.values as Record<string, StoredValue | null>)
          : {};
      return {
        title: typeof row.title === 'string' ? row.title.trim() : '',
        values,
      };
    });

    // Every field named, once, before anything is written.
    //
    // A field from another collection, or a derived one, is the caller asking
    // for something that cannot hold — and finding that out after twenty rows
    // exist is how a paste becomes a cleanup job.
    const named = [...new Set(incoming.flatMap((row) => Object.keys(row.values)))];
    const fields = new Map<string, FieldType>();
    if (named.length > 0) {
      const rows = await queryRows<{ id: string; field_type: string }>(
        deps.pool,
        `SELECT id, field_type FROM collection_fields
          WHERE collection_id = $1 AND id = ANY($2::uuid[])`,
        [collectionId, named],
      );
      for (const field of rows) fields.set(field.id, field.field_type as FieldType);
    }
    for (const id of named) {
      if (!fields.has(id)) {
        ctx.fail(404, 'field_not_found');
        return;
      }
    }

    const last = await queryRows<{ idx: string }>(
      deps.pool,
      `SELECT idx FROM pages
        WHERE collection_id = $1 AND kind = 'row'
        ORDER BY idx DESC, id DESC LIMIT 1`,
      [collectionId],
    );

    const created: string[] = [];
    // Carried forward rather than re-read: each key is generated after the last
    // one written, so the rows arrive in the order they were pasted.
    let previous: string | null = last[0]?.idx ?? null;

    for (const row of incoming) {
      const rowId = randomUUID();
      previous = generateKeyBetween(previous, null);
      const idx = previous;

      // The row and its values in one document write. Two would mean a row that
      // exists and is empty for as long as the second takes.
      await applyToDocument(
        deps.pool,
        rowId,
        (doc) => {
          const page = doc.getMap(DOC_KEYS.page);
          page.set(PAGE_KEYS.kind, 'row');
          page.set(PAGE_KEYS.parentPageId, collection.page_id);
          page.set(PAGE_KEYS.collectionId, collectionId);
          page.set(PAGE_KEYS.title, row.title);
          page.set(PAGE_KEYS.idx, idx);

          for (const [fieldId, value] of Object.entries(row.values)) {
            // A derived field refuses here, and is skipped rather than failing
            // the row: the value it would hold is computed from its inputs, and
            // the inputs are in this same paste.
            setPropertyValue(doc, fieldId, fields.get(fieldId)!, value ?? null);
          }
        },
        auth.actorId,
      );

      await rematerialize(deps.pool, rowId, auth.workspaceId, auth.actorId);
      created.push(rowId);
    }

    ctx.send(201, { collectionId, created });
  });

  /**
   * Empty a collection: archive every row it has.
   *
   * Archived, not deleted. A row is a page, so emptying a table is deleting
   * pages — and the trash is where a deleted page goes everywhere else in this
   * application. It is also what makes this undoable, which matters much more
   * now that one paste can create fifty rows.
   *
   * The row ids come back so a caller can put them back one by one, which is
   * what the table's undo does.
   */
  /**
   * Archive named rows (ADR-0040).
   *
   * Separate from the route below, which takes no ids and empties the table. A
   * selection of every row would do the same thing, and keeping the simpler
   * route means the destructive-but-obvious path stays obvious rather than
   * becoming a special case of a general one.
   *
   * Archiving rather than deleting, because a row is a page: it goes to the
   * trash and can be brought back, which is what every other removal here does.
   */
  router.post('/api/collections/:collectionId/rows/archive', async (ctx) => {
    const collectionId = ctx.params['collectionId'] ?? '';
    const collection = await queryOne<{ page_id: string }>(
      deps.pool,
      `SELECT page_id FROM collections WHERE id = $1`,
      [collectionId],
    );
    if (!collection) {
      ctx.fail(404, 'not_found');
      return;
    }

    const auth = await authorise(deps.pool, ctx, collection.page_id, 'edit');
    if (!auth) return;

    let body: { rowIds?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }
    const ids = Array.isArray(body.rowIds)
      ? body.rowIds.filter((id): id is string => typeof id === 'string')
      : null;
    if (ids === null || ids.length === 0) {
      ctx.fail(422, 'rows_required');
      return;
    }

    // Bounded to this collection in the statement rather than checked first: an
    // id from another table, or from another workspace, simply matches nothing.
    const rows = await queryRows<{ id: string }>(
      deps.pool,
      `UPDATE pages SET archived_at = now()
        WHERE collection_id = $1 AND kind = 'row' AND archived_at IS NULL
          AND id = ANY($2::uuid[])
        RETURNING id`,
      [collectionId, ids],
    );

    ctx.send(200, { collectionId, archived: rows.map((row) => row.id) });
  });

  router.delete('/api/collections/:collectionId/rows', async (ctx) => {
    const collectionId = ctx.params['collectionId'] ?? '';
    const collection = await queryOne<{ page_id: string }>(
      deps.pool,
      `SELECT page_id FROM collections WHERE id = $1`,
      [collectionId],
    );
    if (!collection) {
      ctx.fail(404, 'not_found');
      return;
    }

    const auth = await authorise(deps.pool, ctx, collection.page_id, 'edit');
    if (!auth) return;

    const rows = await queryRows<{ id: string }>(
      deps.pool,
      `UPDATE pages SET archived_at = now()
        WHERE collection_id = $1 AND kind = 'row' AND archived_at IS NULL
        RETURNING id`,
      [collectionId],
    );

    ctx.send(200, { collectionId, archived: rows.map((row) => row.id) });
  });

  /**
   * A collection: its fields, and its rows with their values.
   *
   * One query for the fields and one for the rows, rather than one per row.
   * The values arrive as a flat list and are grouped here — a row per property
   * would be a join fan-out, and grouping in SQL would mean building JSON in
   * the database for no gain.
   */
  /**
   * Every collection in the workspace, for choosing what a relation points at
   * (ADR-0054).
   *
   * The page tree cannot answer this: a summary's `collectionId` names the
   * collection a *row* belongs to, not one a page holds, and rows are not in the
   * tree at all. So it is one query rather than a field on every page in a
   * response that is read constantly and needs this once.
   *
   * Only collections on pages the reader may see, by the same condition the
   * tree and search use — a picker that lists a collection somebody cannot open
   * is a way to learn that it exists.
   */
  /**
   * Relation columns pointing *at* this collection (ADR-0054).
   *
   * The counterpart of `/targets`, and what a rollup has to choose from: it
   * names one of these, and that is the only thing a rollup can be built on.
   * Asked from the collection being pointed at, for the same reason — the
   * question is about here.
   */
  /**
   * One row's own fields and values (ADR-0054's deferred item).
   *
   * A row opens as a page, and until this the page said nothing about the row
   * it is — the properties panel carried a page's kind and dates and no
   * collection values at all, for any field type.
   *
   * Its own route rather than reading the whole collection: fetching two
   * hundred rows to draw one is the sort of thing that works in testing and not
   * in a workspace. The rollups are computed for this row alone, by the same
   * function the table uses.
   */
  router.get('/api/pages/:pageId/properties', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'read');
    if (!auth) return;

    const row = await queryOne<{ collection_id: string | null }>(
      deps.pool,
      `SELECT collection_id FROM pages WHERE id = $1 AND kind = 'row'`,
      [pageId],
    );
    if (!row?.collection_id) {
      // Not a row. Answered as an empty list rather than a 404: the panel asks
      // this of every page it opens, and "this page has no fields" is the
      // truthful answer for most of them.
      ctx.send(200, { collectionId: null, fields: [], values: {}, derived: {} });
      return;
    }

    const fields = await queryRows<{
      id: string;
      name: string;
      field_type: string;
      config: Record<string, unknown>;
    }>(
      deps.pool,
      `SELECT id, name, field_type, config
         FROM collection_fields
        WHERE collection_id = $1
        ORDER BY idx ASC`,
      [row.collection_id],
    );

    const stored = await queryRows<{ field_id: string; value: unknown }>(
      deps.pool,
      `SELECT field_id, value FROM page_properties WHERE page_id = $1`,
      [pageId],
    );

    const derived: Record<string, DerivedValue> = {};
    for (const field of fields) {
      if (field.field_type !== 'rollup') continue;
      const config = readRollupConfig(field.config ?? null);
      if (!config) continue;
      const computed = await computeRollup(deps.pool, {
        rowIds: [pageId],
        config,
        reader: { userId: auth.actorId, isAdmin: false },
      });
      const value = computed.get(pageId);
      if (value) derived[field.id] = value;
    }

    ctx.send(200, {
      collectionId: row.collection_id,
      canEdit: auth.canEdit,
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        fieldType: field.field_type,
        config: field.config,
      })),
      values: Object.fromEntries(stored.map((one) => [one.field_id, one.value])),
      derived,
    });
  });

  router.get('/api/collections/:collectionId/incoming', async (ctx) => {
    const collectionId = ctx.params['collectionId'] ?? '';
    const here = await queryOne<{ workspace_id: string }>(
      deps.pool,
      `SELECT p.workspace_id
         FROM collections c JOIN pages p ON p.id = c.page_id
        WHERE c.id = $1`,
      [collectionId],
    );
    if (!here) {
      ctx.fail(404, 'not_found');
      return;
    }
    const claims = await claimsFor(deps.pool, ctx, here.workspace_id);
    if (!claims) return;

    const rows = await queryRows<{
      id: string;
      name: string;
      from_title: string;
      owner_collection: string;
    }>(
      deps.pool,
      `SELECT f.id, f.name, p.title AS from_title, f.collection_id AS owner_collection
         FROM collection_fields f
         JOIN collections c ON c.id = f.collection_id
         JOIN pages p ON p.id = c.page_id
        WHERE f.field_type = 'relation'
          AND f.config ->> 'collectionId' = $1
          AND p.workspace_id = $2
          AND p.archived_at IS NULL
          AND ${visiblePagesCondition('p', '$3', '$4')}
        ORDER BY p.title ASC, f.name ASC
        LIMIT 100`,
      [
        collectionId,
        here.workspace_id,
        claims.principal.kind === 'user' ? claims.principal.userId : null,
        claims.workspaceRole === 'owner' || claims.workspaceRole === 'admin',
      ],
    );

    /*
     * And what each of those collections has to aggregate.
     *
     * With the relations rather than in a second request: choosing an aggregate
     * and choosing a field are one decision made in one dialog, and a fetch
     * between the two halves of it would show an empty list for a moment.
     *
     * Stored fields only — the rule that keeps rollups acyclic, applied where
     * somebody chooses rather than only where the server refuses.
     */
    const fields = await queryRows<{ collection_id: string; id: string; name: string }>(
      deps.pool,
      `SELECT f.collection_id, f.id, f.name
         FROM collection_fields f
        WHERE f.collection_id = ANY($1::uuid[])
          AND f.field_type <> ALL($2::text[])
        ORDER BY f.idx ASC`,
      [rows.map((row) => row.owner_collection), [...DERIVED_FIELD_TYPES]],
    );

    ctx.send(200, {
      relations: rows.map((row) => ({
        fieldId: row.id,
        fieldName: row.name,
        fromCollection: row.from_title,
        aggregatable: fields
          .filter((field) => field.collection_id === row.owner_collection)
          .map((field) => ({ id: field.id, name: field.name })),
      })),
    });
  });

  router.get('/api/collections/:collectionId/targets', async (ctx) => {
    /*
     * Asked from a collection rather than from a workspace.
     *
     * My first version was `/api/workspaces/:id/collections`, and then the
     * table that needs it turned out not to know its workspace id — it is
     * rendered from a node view inside a document. Threading the id down would
     * have been the wrong fix: the question is "what could a relation from
     * *here* point at", which names this collection and nothing else, and lets
     * the server exclude the obvious wrong answer.
     */
    const from = await queryOne<{ page_id: string; workspace_id: string }>(
      deps.pool,
      `SELECT c.page_id, p.workspace_id
         FROM collections c JOIN pages p ON p.id = c.page_id
        WHERE c.id = $1`,
      [ctx.params['collectionId'] ?? ''],
    );
    if (!from) {
      ctx.fail(404, 'not_found');
      return;
    }

    // `claimsFor` rather than this file's `authorise`, which is page-scoped:
    // the visibility condition below wants the same claims the tree and search
    // resolve.
    const claims = await claimsFor(deps.pool, ctx, from.workspace_id);
    if (!claims) return;

    const rows = await queryRows<{ id: string; title: string; page_id: string }>(
      deps.pool,
      `SELECT c.id, c.page_id, p.title
         FROM collections c
         JOIN pages p ON p.id = c.page_id
        WHERE p.workspace_id = $1
          AND p.archived_at IS NULL
          -- Not this one: a relation pointing at its own collection asks about
          -- a row's siblings, which the table already answers, and it makes a
          -- rollup that counts itself.
          AND c.id <> $4
          AND ${visiblePagesCondition('p', '$2', '$3')}
        ORDER BY p.title ASC
        LIMIT 200`,
      [
        claims.workspaceId,
        claims.principal.kind === 'user' ? claims.principal.userId : null,
        claims.workspaceRole === 'owner' || claims.workspaceRole === 'admin',
        ctx.params['collectionId'] ?? '',
      ],
    );

    ctx.send(200, {
      collections: rows.map((row) => ({
        id: row.id,
        pageId: row.page_id,
        title: row.title,
      })),
    });
  });

  router.get('/api/collections/:collectionId', async (ctx) => {
    const collectionId = ctx.params['collectionId'] ?? '';
    const collection = await queryOne<{ id: string; page_id: string; title_field_id: string }>(
      deps.pool,
      `SELECT id, page_id, title_field_id FROM collections WHERE id = $1`,
      [collectionId],
    );
    if (!collection) {
      ctx.fail(404, 'not_found');
      return;
    }

    const pageId = collection.page_id;
    const auth = await authorise(deps.pool, ctx, pageId, 'read');
    if (!auth) return;

    const views = await queryRows<{
      id: string;
      name: string;
      view_type: string;
      definition: Record<string, unknown>;
    }>(
      deps.pool,
      `SELECT id, name, view_type, definition
         FROM collection_views WHERE collection_id = $1 ORDER BY idx, id`,
      [collection.id],
    );

    const fields = await queryRows<{
      id: string;
      name: string;
      description: string | null;
      field_type: string;
      config: Record<string, unknown>;
      idx: string;
    }>(
      deps.pool,
      `SELECT id, name, description, field_type, config, idx
         FROM collection_fields WHERE collection_id = $1 ORDER BY idx, id`,
      [collection.id],
    );

    // Rows are the entries inside the folder. Archived ones are excluded for
    // the same reason they are excluded from the tree: they are in the trash,
    // and a table that shows deleted rows is a table nobody trusts.
    //
    // Filtered and sorted here rather than in the client. The projection exists
    // so a view can ask for what it needs without loading every row's document
    // (ADR-0004), and doing this after fetching everything would stop working
    // at exactly the size where a collection starts to matter.
    const view = ctx.url.searchParams.get('view');
    const chosen = view ? views.find((entry) => entry.id === view) : undefined;
    const fieldTypes = new Map(fields.map((field) => [field.id, field.field_type]));

    const built = buildViewQuery(
      chosen ? readFilters(chosen.definition) : [],
      chosen ? readSorts(chosen.definition) : [],
      fieldTypes,
      2,
    );

    // Searching within the collection, in the same query as the filters.
    //
    // Doing it in the client would mean fetching every row first, which stops
    // working at the size a collection is for — the same reason filtering and
    // sorting are here (ADR-0004).
    const params = [...built.params];
    const search = buildSearchClause(ctx.url.searchParams.get('q') ?? '', (value) => {
      params.push(value);
      return `$${params.length + 1}`;
    });

    const conditions = [built.where, search].filter((clause) => clause !== '' && clause !== null);

    const rows = await queryRows<{ id: string; title: string; idx: string }>(
      deps.pool,
      `SELECT p.id, p.title, p.idx FROM pages p
        WHERE p.collection_id = $1 AND p.kind = 'row' AND p.archived_at IS NULL
          ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
        ORDER BY ${built.orderBy ? `${built.orderBy}, ` : ''}p.idx, p.id`,
      [collectionId, ...params],
    );

    const values = await queryRows<{ page_id: string; field_id: string; value: unknown }>(
      deps.pool,
      `SELECT p.page_id, p.field_id, p.value
         FROM page_properties p
         JOIN pages r ON r.id = p.page_id
        WHERE r.collection_id = $1 AND r.kind = 'row' AND r.archived_at IS NULL`,
      [collectionId],
    );

    const byRow = new Map<string, Record<string, unknown>>();
    for (const value of values) {
      const existing = byRow.get(value.page_id) ?? {};
      existing[value.field_id] = value.value;
      byRow.set(value.page_id, existing);
    }

    // What the files in this collection's cells actually are (ADR-0035).
    //
    // A cell stores ids and nothing else, because a name and a size are the
    // file's own facts and copying them into every cell that mentions it is how
    // a renamed file keeps its old name in three places. So they are read here,
    // once for the whole table, and the interface is given a map rather than a
    // request per chip.
    const referenced = [
      ...new Set(
        [...byRow.values()].flatMap((cells) =>
          Object.values(cells).flatMap((value) => {
            const files = (value as { kind?: unknown; fileIds?: unknown } | null)?.fileIds;
            return Array.isArray(files) ? files.filter((id): id is string => typeof id === 'string') : [];
          }),
        ),
      ),
    ];

    const fileRows = referenced.length === 0
      ? []
      : await queryRows<{
          id: string;
          filename: string;
          mime_type: string;
          size_bytes: string;
        }>(
          deps.pool,
          // Bounded to this workspace. A cell holding an id from elsewhere is
          // either a bug or a copied document, and either way it must not be
          // the thing that reveals another workspace's filenames.
          `SELECT id, filename, mime_type, size_bytes::text
             FROM files WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
          [referenced, auth.workspaceId],
        );

    /*
     * One query per rollup column, not per row.
     *
     * A table of two hundred rows with two rollups is two queries. Computed
     * with the reader's own visibility, so two people can see different numbers
     * on the same page — correct, and marked as partial when anything was left
     * out (ADR-0054).
     */
    const derivedByRow = new Map<string, Record<string, DerivedValue>>();
    const rollups = fields.filter((field) => field.field_type === 'rollup');
    if (rollups.length > 0 && rows.length > 0) {
      /*
       * The reader, for the visibility condition inside each rollup.
       *
       * `authorise` here yields `actorId` and `canEdit` rather than the full
       * claims — enough for this: a rollup needs to know whose visibility to
       * apply, and a share-link visitor has no actor id, which the condition
       * already treats as "only what is granted".
       */
      const reader = { userId: auth.actorId, isAdmin: false };
      for (const field of rollups) {
        const config = readRollupConfig(field.config ?? null);
        if (!config) continue;
        const computed = await computeRollup(deps.pool, {
          rowIds: rows.map((row) => row.id),
          config,
          reader,
        });
        for (const [rowId, value] of computed) {
          const bag = derivedByRow.get(rowId) ?? {};
          bag[field.id] = value;
          derivedByRow.set(rowId, bag);
        }
      }
    }

    ctx.send(200, {
      pageId,
      collectionId,
      titleFieldId: collection.title_field_id,
      canEdit: auth.canEdit,
      /** The files any cell refers to, by id. Absent ones are simply not here. */
      files: fileRows.map((file) => ({
        id: file.id,
        filename: file.filename,
        mimeType: file.mime_type,
        sizeBytes: Number(file.size_bytes),
        category: categoryOf(file.mime_type),
      })),
      views: views.map((view) => ({
        id: view.id,
        name: view.name,
        viewType: view.view_type,
        definition: view.definition,
      })),
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        description: field.description,
        fieldType: field.field_type,
        config: field.config,
      })),
      rows: rows.map((row) => ({
        id: row.id,
        title: row.title,
        values: byRow.get(row.id) ?? {},
        /*
         * The derived columns, from the server (ADR-0054).
         *
         * Separate from `values` on purpose: those come out of the document and
         * can be written, these are computed and cannot. One bag holding both
         * would be a cell somebody could type into whose value the server
         * decides — a lie the moment they did.
         */
        derived: derivedByRow.get(row.id) ?? {},
      })),
    });
  });

  /**
   * Whether a rollup config can be used here, answering the request if not.
   *
   * One copy, called from creation *and* from the update: the update path did
   * not check at all, so a rollup could be pointed at another rollup by editing
   * the column afterwards — defeating the rule ADR-0054 says removes cycles by
   * construction. A rule enforced on one of two paths is not a rule.
   */
  const rollupIsUsable = async (
    ctx: RequestContext,
    resolved: { collectionId: string; auth: { workspaceId: string } },
    raw: Record<string, unknown> | null,
  ): Promise<boolean> => {
    const config = readRollupConfig(raw);
    if (!config) {
      ctx.fail(422, 'invalid_rollup');
      return false;
    }

    const via = await queryOne<{ field_type: string; config: Record<string, unknown> }>(
      deps.pool,
      `SELECT f.field_type, f.config
         FROM collection_fields f
         JOIN collections c ON c.id = f.collection_id
         JOIN pages p ON p.id = c.page_id
        WHERE f.id = $1 AND p.workspace_id = $2`,
      [config.viaFieldId, resolved.auth.workspaceId],
    );
    if (!via || via.field_type !== 'relation') {
      ctx.fail(422, 'not_a_relation');
      return false;
    }
    // It must point *here*, or the rollup aggregates rows that have nothing to
    // do with this collection.
    if (via.config?.['collectionId'] !== resolved.collectionId) {
      ctx.fail(422, 'relation_points_elsewhere');
      return false;
    }

    /*
     * Every aggregate but `rows` and `count` needs a field to aggregate.
     *
     * Refused rather than stored as an empty column: a rollup with no field is
     * one that can never produce a value, and it would look like a bug in the
     * rollup rather than a config nobody finished.
     */
    if (!config.fieldId && config.aggregate !== 'rows' && config.aggregate !== 'count') {
      ctx.fail(422, 'rollup_needs_a_field');
      return false;
    }

    if (config.fieldId) {
      const target = await queryOne<{ field_type: string }>(
        deps.pool,
        `SELECT field_type FROM collection_fields WHERE id = $1`,
        [config.fieldId],
      );
      if (!target || DERIVED_FIELD_TYPES.has(target.field_type as FieldType)) {
        ctx.fail(422, 'not_a_stored_field');
        return false;
      }
    }
    return true;
  };

  /** Add a column. */
  router.post('/api/collections/:collectionId/fields', async (ctx) => {
    const resolved = await collectionPage(deps.pool, ctx, 'edit');
    if (!resolved) return;
    const { collectionId, pageId, auth } = resolved;

    let body: { name?: string; fieldType?: string; config?: Record<string, unknown> };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const fieldType = body.fieldType as FieldType | undefined;
    /*
     * A relation has to say where it points, at creation (ADR-0054).
     *
     * Not defaulted to "anywhere": a column that can point at any page gives a
     * picker over the whole workspace and a rollup with nothing to aggregate,
     * because the other side has no fields in common. And not editable later
     * without deciding what happens to cells already pointing elsewhere —
     * which is a question this refuses to create.
     */
    if (fieldType === 'relation') {
      const target = body.config?.['collectionId'];
      if (typeof target !== 'string' || target === '') {
        ctx.fail(422, 'relation_without_target');
        return;
      }
      const exists = await queryOne<{ id: string }>(
        deps.pool,
        `SELECT c.id FROM collections c
           JOIN pages p ON p.id = c.page_id
          WHERE c.id = $1 AND p.workspace_id = $2 AND p.archived_at IS NULL`,
        [target, auth.workspaceId],
      );
      if (!exists) {
        ctx.fail(404, 'collection_not_found');
        return;
      }
    }

    if (fieldType === 'rollup' && !(await rollupIsUsable(ctx, resolved, body.config ?? null))) {
      return;
    }

    if (!fieldType || !CREATABLE_FIELD_TYPES.has(fieldType)) {
      // Named separately from a malformed body: "that column type is not
      // available yet" is a different thing from "your request was wrong".
      ctx.fail(422, 'unsupported_field_type');
      return;
    }

    const fieldId = randomUUID();
    let added = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        added = addField(doc, collectionId, {
          id: fieldId,
          name: (body.name ?? '').trim() || 'Untitled',
          fieldType,
          ...(body.config ? { config: body.config } : {}),
        });
      },
      auth.actorId,
    );

    if (!added) {
      // Either not a collection, or full. Checked after the fact because the
      // answer lives in the document, and opening it twice to ask first would
      // be a second load for a rare case.
      ctx.fail(409, 'field_not_added');
      return;
    }

    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(201, { id: fieldId, name: body.name ?? 'Untitled', fieldType });
  });

  /** Rename a column, or remove it. */
  router.patch('/api/collections/:collectionId/fields/:fieldId', async (ctx) => {
    const resolved = await collectionPage(deps.pool, ctx, 'edit');
    if (!resolved) return;
    const { collectionId, pageId, auth } = resolved;

    let body: { name?: string; description?: string | null; config?: Record<string, unknown> };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const fieldId = ctx.params['fieldId'] ?? '';
    /*
     * A config change on a rollup goes through the same check as its creation.
     *
     * Without this the cycle rule held only on the way in: pointing an existing
     * rollup at another rollup was one PATCH away.
     */
    if (body.config !== undefined) {
      const existing = await queryOne<{ field_type: string }>(
        deps.pool,
        `SELECT field_type FROM collection_fields WHERE id = $1 AND collection_id = $2`,
        [fieldId, collectionId],
      );
      if (
        existing?.field_type === 'rollup' &&
        !(await rollupIsUsable(ctx, { collectionId, auth }, body.config))
      ) {
        return;
      }
    }


    let ok = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        ok = updateField(doc, collectionId, fieldId, body);
      },
      auth.actorId,
    );

    if (!ok) {
      ctx.fail(404, 'field_not_found');
      return;
    }
    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(200, { id: fieldId });
  });

  router.delete('/api/collections/:collectionId/fields/:fieldId', async (ctx) => {
    const resolved = await collectionPage(deps.pool, ctx, 'edit');
    if (!resolved) return;
    const { collectionId, pageId, auth } = resolved;

    const fieldId = ctx.params['fieldId'] ?? '';
    let removed = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        removed = removeField(doc, collectionId, fieldId);
      },
      auth.actorId,
    );

    if (!removed) {
      // The title field refuses to be removed, and so does one that is not
      // there. Both are the caller asking for something that cannot happen.
      ctx.fail(409, 'field_not_removed');
      return;
    }
    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(200, { id: fieldId });
  });

  /**
   * Add a view.
   *
   * A view is a way of looking at the same rows — a table, or a board grouped by
   * a column. It is not a filter on which rows exist: every view of a collection
   * shows the same entries, because they are the folder's contents.
   */
  router.post('/api/collections/:collectionId/views', async (ctx) => {
    const resolved = await collectionPage(deps.pool, ctx, 'edit');
    if (!resolved) return;
    const { collectionId, pageId, auth } = resolved;

    let body: { name?: string; viewType?: string; definition?: Record<string, unknown> };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const viewType = body.viewType;
    // A gallery is a third view type rather than a mode of the table (ADR-0039),
    // so filters, sorting and the search box apply to it as they do to any view.
    if (viewType !== 'table' && viewType !== 'board' && viewType !== 'gallery') {
      // 'list' is in the model and has no renderer, so it is not offered.
      ctx.fail(422, 'unsupported_view_type');
      return;
    }

    const viewId = randomUUID();
    let added = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        added = addView(doc, collectionId, {
          id: viewId,
          name:
            (body.name ?? '').trim() ||
            (viewType === 'board' ? 'Board' : viewType === 'gallery' ? 'Gallery' : 'Table'),
          viewType,
          ...(body.definition ? { definition: body.definition } : {}),
        });
      },
      auth.actorId,
    );

    if (!added) {
      ctx.fail(409, 'view_not_added');
      return;
    }
    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(201, { id: viewId, viewType });
  });

  /**
   * Change a view's rules.
   *
   * The filters and the sort live in the view's definition, and until now
   * nothing could set them: the query side was built and tested and there was
   * no way to reach it except by hand. That is a half-feature, which is worse
   * than none — it looks finished from the outside.
   */
  router.patch('/api/collections/:collectionId/views/:viewId', async (ctx) => {
    const resolved = await collectionPage(deps.pool, ctx, 'edit');
    if (!resolved) return;
    const { collectionId, pageId, auth } = resolved;

    let body: { name?: string; definition?: Record<string, unknown> };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    if (
      body.definition !== undefined &&
      (typeof body.definition !== 'object' ||
        body.definition === null ||
        Array.isArray(body.definition))
    ) {
      ctx.fail(422, 'invalid_definition');
      return;
    }

    const viewId = ctx.params['viewId'] ?? '';
    let ok = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        ok = updateView(doc, collectionId, viewId, body);
      },
      auth.actorId,
    );

    if (!ok) {
      ctx.fail(404, 'view_not_found');
      return;
    }
    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(200, { id: viewId });
  });

  /**
   * Replace a select column's options.
   *
   * The whole list at once, because that is what an option editor produces, and
   * because a partial update would need a merge rule for two people editing the
   * same list — a worse problem than last-write-wins on a list one person is
   * actively editing.
   */
  router.put('/api/collections/:collectionId/fields/:fieldId/options', async (ctx) => {
    const resolved = await collectionPage(deps.pool, ctx, 'edit');
    if (!resolved) return;
    const { collectionId, pageId, auth } = resolved;

    let body: { options?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    if (!Array.isArray(body.options)) {
      ctx.fail(422, 'invalid_options');
      return;
    }

    const options: SelectOption[] = [];
    for (const entry of body.options) {
      if (!entry || typeof entry !== 'object') {
        ctx.fail(422, 'invalid_options');
        return;
      }
      const { id, name, color } = entry as Record<string, unknown>;
      // An id is required rather than generated here: the client has to keep
      // ids stable across a rename, because a row's value points at an id and
      // a new one would lose every row's value.
      if (typeof id !== 'string' || id === '') {
        ctx.fail(422, 'option_needs_an_id');
        return;
      }
      options.push({
        id,
        name: typeof name === 'string' ? name : '',
        color: typeof color === 'string' ? color : 'grey',
      });
    }

    const fieldId = ctx.params['fieldId'] ?? '';

    let ok = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        ok = setOptions(doc, collectionId, fieldId, options);
      },
      auth.actorId,
    );

    if (!ok) {
      // Not a field that has options, duplicate ids, or too many. All are the
      // caller asking for something that cannot hold.
      ctx.fail(409, 'options_not_set');
      return;
    }
    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(200, { fieldId, options });
  });

  /**
   * Set a value on a row.
   *
   * Written to the row's document, not the collection's, and materialised from
   * there — which is what lets a row keep its values when it is moved out.
   */
  router.put('/api/pages/:rowId/properties/:fieldId', async (ctx) => {
    const rowId = ctx.params['rowId'] ?? '';
    const auth = await authorise(deps.pool, ctx, rowId, 'edit');
    if (!auth) return;

    let body: { value?: StoredValue | null };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const fieldId = ctx.params['fieldId'] ?? '';

    // The field's type decides whether a value may be stored at all, and it
    // lives on the collection rather than on the row — so it is read from the
    // projection, which is exactly what the projection is for.
    const field = await queryOne<{ field_type: string; config: Record<string, unknown> }>(
      deps.pool,
      // The row names its collection, and the field must belong to that one.
      //
      // This joined on the row being a *child of the collection's page*, which
      // was the folder shape: with several collections on one page, every field
      // on that page matched every row, so a value could be written against a
      // column from a different table.
      `SELECT f.field_type, f.config
         FROM collection_fields f
         JOIN pages r ON r.collection_id = f.collection_id
        WHERE f.id = $1 AND r.id = $2 AND r.kind = 'row'`,
      [fieldId, rowId],
    );
    if (!field) {
      // Not a field of the collection this row belongs to. Refused rather than
      // stored, or a row would accumulate values no view can show and nothing
      // can clean up.
      ctx.fail(404, 'field_not_found');
      return;
    }

    const value = body.value ?? null;

    // A select value must name options that exist.
    //
    // Checked before storing, so a cell cannot come to point at an option that
    // was never there. Options already removed are a different matter: those
    // values stay, because a row owns its values and erasing them would make
    // one misclick in the option editor unrecoverable.
    /*
     * A relation value must name rows in the collection the column points at
     * (ADR-0054).
     *
     * Checked here for the same reasons a files value is, plus one that is
     * specific to this: a relation crosses pages, so an unchecked id is a way
     * to make a cell point into another workspace and have its title drawn
     * beside somebody's data. The target's collection is checked as well as its
     * existence — a column that points at Clients must not end up holding an
     * invoice, or the rollups on the other side aggregate fields that are not
     * there.
     */
    if (value !== null && field.field_type === 'relation') {
      const ids =
        value.kind === 'relation' && Array.isArray(value.pageIds)
          ? value.pageIds.filter((id): id is string => typeof id === 'string')
          : null;
      if (ids === null) {
        ctx.fail(422, 'invalid_value');
        return;
      }
      if (ids.length > MAX_CELL_RELATIONS) {
        ctx.fail(422, 'too_many_relations', { limit: MAX_CELL_RELATIONS });
        return;
      }

      const target =
        typeof field.config?.['collectionId'] === 'string'
          ? (field.config['collectionId'] as string)
          : null;
      if (!target) {
        // A relation column with no target is a column nobody can fill. It
        // cannot be created that way, so reaching here means the config was
        // edited into that state — refused rather than stored.
        ctx.fail(422, 'relation_without_target');
        return;
      }

      if (ids.length > 0) {
        const known = await queryRows<{ id: string }>(
          deps.pool,
          /*
           * By `collection_id`, which is how a row belongs to a collection.
           *
           * My first version walked up to the parent page and joined
           * `collections` on it — so a legitimate target came back 404. A row
           * *is* a child of the collection's page, but the column is what says
           * which collection it belongs to, and it is the column every other
           * query here uses. The materialiser carries a comment about being
           * caught by the same confusion from the other direction.
           */
          `SELECT p.id
             FROM pages p
            WHERE p.id = ANY($1::uuid[])
              AND p.workspace_id = $2
              AND p.collection_id = $3
              AND p.kind = 'row'
              AND p.archived_at IS NULL`,
          [ids, auth.workspaceId, target],
        );
        if (known.length !== new Set(ids).size) {
          ctx.fail(404, 'row_not_found');
          return;
        }
      }
    }

    // A files value must name files that exist, in this workspace.
    //
    // Checked before storing for the same reason a select value is: a cell
    // pointing at nothing renders as a chip nobody can open, and one pointing at
    // another workspace's file would be the thing that leaks a filename. Bounded
    // too — a cell is a cell, and a hundred attachments in one belong on the
    // row's own page (ADR-0035).
    if (value !== null && field.field_type === 'files') {
      const ids =
        value.kind === 'files' && Array.isArray(value.fileIds)
          ? value.fileIds.filter((id): id is string => typeof id === 'string')
          : null;
      if (ids === null) {
        ctx.fail(422, 'invalid_value');
        return;
      }
      if (ids.length > MAX_CELL_FILES) {
        ctx.fail(422, 'too_many_files', { limit: MAX_CELL_FILES });
        return;
      }
      if (ids.length > 0) {
        const known = await queryRows<{ id: string }>(
          deps.pool,
          `SELECT id FROM files WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
          [ids, auth.workspaceId],
        );
        if (known.length !== new Set(ids).size) {
          ctx.fail(404, 'file_not_found');
          return;
        }
      }
    }

    if (value !== null && HAS_OPTIONS.has(field.field_type)) {
      const known = Array.isArray(field.config['options'])
        ? (field.config['options'] as SelectOption[])
        : [];
      if (!selectValueIsKnown(value, known)) {
        ctx.fail(422, 'unknown_option');
        return;
      }
    }

    let ok = false;
    const result = await applyToDocument(
      deps.pool,
      rowId,
      (doc) => {
        ok = setPropertyValue(doc, fieldId, field.field_type as FieldType, value);
      },
      auth.actorId,
    );

    if (!ok) {
      // A derived field. Computed during materialisation, and storing one would
      // let two clients disagree about a value implied by its inputs.
      ctx.fail(409, 'field_is_derived');
      return;
    }
    if (result.changed) {
      await rematerialize(deps.pool, rowId, auth.workspaceId, auth.actorId);
    }
    ctx.send(200, { rowId, fieldId });
  });
}
