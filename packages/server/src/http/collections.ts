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
  type FieldType,
  type SelectOption,
  type StoredValue,
} from '@sone/core';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { effectiveRole, loadPageLocation, resolveSessionClaims } from '../auth/claims.js';
import { queryOne, queryRows } from '../db/pool.js';
import { applyToDocument } from '../doc/docStore.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { sessionTokenFrom } from './auth.js';
import { buildViewQuery, readFilters, readSorts } from './viewQuery.js';
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
]);

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
   * A collection: its fields, and its rows with their values.
   *
   * One query for the fields and one for the rows, rather than one per row.
   * The values arrive as a flat list and are grouped here — a row per property
   * would be a join fan-out, and grouping in SQL would mean building JSON in
   * the database for no gain.
   */
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

    const rows = await queryRows<{ id: string; title: string; idx: string }>(
      deps.pool,
      `SELECT p.id, p.title, p.idx FROM pages p
        WHERE p.collection_id = $1 AND p.kind = 'row' AND p.archived_at IS NULL
          ${built.where ? `AND ${built.where}` : ''}
        ORDER BY ${built.orderBy ? `${built.orderBy}, ` : ''}p.idx, p.id`,
      [collectionId, ...built.params],
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

    ctx.send(200, {
      pageId,
      collectionId,
      titleFieldId: collection.title_field_id,
      canEdit: auth.canEdit,
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
      })),
    });
  });

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
    if (viewType !== 'table' && viewType !== 'board') {
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
          name: (body.name ?? '').trim() || (viewType === 'board' ? 'Board' : 'Table'),
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
