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
  addField,
  addView,
  initCollection,
  isCollection,
  removeField,
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

export function registerCollectionRoutes(router: Router, deps: CollectionDeps): void {
  /**
   * Turn a folder into a collection.
   *
   * Only a folder: a collection's rows are entries inside it, and a page holds
   * nothing (ADR-0019).
   */
  router.post('/api/pages/:pageId/collection', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

    const row = await queryOne<{ kind: string }>(
      deps.pool,
      `SELECT kind FROM pages WHERE id = $1`,
      [pageId],
    );
    if (row?.kind !== 'folder') {
      ctx.fail(409, 'collections_need_a_folder');
      return;
    }

    const titleFieldId = randomUUID();
    const viewId = randomUUID();

    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        // Idempotent in core: a second call leaves an existing collection
        // alone rather than resetting its fields.
        initCollection(doc, { titleFieldId, titleName: 'Name' });
        addView(doc, { id: viewId, name: 'Table', viewType: 'table' });
      },
      auth.actorId,
    );

    if (result.changed) {
      await rematerialize(deps.pool, pageId, auth.workspaceId, auth.actorId);
    }
    ctx.send(201, { pageId });
  });

  /**
   * A collection: its fields, and its rows with their values.
   *
   * One query for the fields and one for the rows, rather than one per row.
   * The values arrive as a flat list and are grouped here — a row per property
   * would be a join fan-out, and grouping in SQL would mean building JSON in
   * the database for no gain.
   */
  router.get('/api/pages/:pageId/collection', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'read');
    if (!auth) return;

    const collection = await queryOne<{ id: string; title_field_id: string }>(
      deps.pool,
      `SELECT id, title_field_id FROM collections WHERE page_id = $1`,
      [pageId],
    );
    if (!collection) {
      ctx.fail(404, 'not_a_collection');
      return;
    }

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
    const rows = await queryRows<{ id: string; title: string; idx: string }>(
      deps.pool,
      `SELECT id, title, idx FROM pages
        WHERE parent_page_id = $1 AND archived_at IS NULL
        ORDER BY idx, id`,
      [pageId],
    );

    const values = await queryRows<{ page_id: string; field_id: string; value: unknown }>(
      deps.pool,
      `SELECT p.page_id, p.field_id, p.value
         FROM page_properties p
         JOIN pages r ON r.id = p.page_id
        WHERE r.parent_page_id = $1 AND r.archived_at IS NULL`,
      [pageId],
    );

    const byRow = new Map<string, Record<string, unknown>>();
    for (const value of values) {
      const existing = byRow.get(value.page_id) ?? {};
      existing[value.field_id] = value.value;
      byRow.set(value.page_id, existing);
    }

    ctx.send(200, {
      pageId,
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
  router.post('/api/pages/:pageId/collection/fields', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

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
        if (!isCollection(doc)) return;
        added = addField(doc, {
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
  router.patch('/api/pages/:pageId/collection/fields/:fieldId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

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
        ok = updateField(doc, fieldId, body);
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

  router.delete('/api/pages/:pageId/collection/fields/:fieldId', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

    const fieldId = ctx.params['fieldId'] ?? '';
    let removed = false;
    const result = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        removed = removeField(doc, fieldId);
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
  router.post('/api/pages/:pageId/collection/views', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

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
        added = addView(doc, {
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
  router.put('/api/pages/:pageId/collection/fields/:fieldId/options', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const auth = await authorise(deps.pool, ctx, pageId, 'edit');
    if (!auth) return;

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
        ok = setOptions(doc, fieldId, options);
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
      `SELECT f.field_type, f.config
         FROM collection_fields f
         JOIN collections c ON c.id = f.collection_id
         JOIN pages r ON r.parent_page_id = c.page_id
        WHERE f.id = $1 AND r.id = $2`,
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
