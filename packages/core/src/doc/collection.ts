/**
 * SONE — writing collections.
 *
 * The reading side of this model has existed since the first migration: the
 * document schema names the maps, the materialiser parses them, and
 * `page_properties` has typed shadow columns waiting to be filled. What was
 * missing was any way to *create* one, which is why collections rendered a
 * placeholder.
 *
 * These are the writers, and they exist in core rather than in the server
 * because a collection is document data (ADR-0002). The server projects it; the
 * document owns it.
 *
 * ## Where a value lives
 *
 * A field *definition* lives on the collection's document — it is a property of
 * the collection, the same as a folder's name is a property of the folder. A
 * field *value* lives on the row's own document, under `properties`, because it
 * is a property of that page and has to travel with it.
 *
 * That split is what makes a row movable. A page dragged out of a collection
 * keeps its values; they simply stop being displayed, and reappear if it is
 * moved back. Values held centrally on the collection would be orphaned by the
 * move, and somebody would have to decide whether to delete them.
 */

import * as Y from 'yjs';

import {
  COLLECTION_KEYS,
  DOC_KEYS,
  FIELD_KEYS,
  VIEW_KEYS,
} from './docSchema.js';
import { generateKeyBetween } from '../order/fractionalIndex.js';
import { isDerived, type FieldType, type StoredValue } from '../types/field.js';

/** A field as it is created. */
export interface NewField {
  id: string;
  name: string;
  fieldType: FieldType;
  description?: string | null;
  config?: Record<string, unknown>;
}

export interface NewView {
  id: string;
  name: string;
  viewType: 'table' | 'board' | 'list';
  definition?: Record<string, unknown>;
}

/** How many fields and views one collection may hold. */
export const MAX_FIELDS = 64;
export const MAX_VIEWS = 16;

/**
 * Turn a document into a collection.
 *
 * Idempotent: calling it on a document that is already one leaves it alone
 * rather than resetting the fields, because a second call is far more likely to
 * be a retry than a request to start over.
 *
 * The title field is created here and cannot be removed. Every collection needs
 * one column that names the row, and a collection whose rows have no name is a
 * table of anonymous records — the projection has nowhere to put the page title
 * and the interface has nothing to show in the first column.
 */
export function initCollection(
  doc: Y.Doc,
  options: { titleFieldId: string; titleName?: string },
): void {
  const map = doc.getMap(DOC_KEYS.collection);
  if (map.size > 0) return;

  doc.transact(() => {
    map.set(COLLECTION_KEYS.titleFieldId, options.titleFieldId);

    const fields = new Y.Map();
    const title = new Y.Map();
    title.set(FIELD_KEYS.name, options.titleName ?? 'Name');
    title.set(FIELD_KEYS.fieldType, 'text');
    title.set(FIELD_KEYS.idx, 'a0');
    title.set(FIELD_KEYS.schemaVersion, 1);
    fields.set(options.titleFieldId, title);
    map.set(COLLECTION_KEYS.fields, fields);

    map.set(COLLECTION_KEYS.views, new Y.Map());
  });
}

/** Is this document a collection? */
export function isCollection(doc: Y.Doc): boolean {
  if (!doc.share.has(DOC_KEYS.collection)) return false;
  return doc.getMap(DOC_KEYS.collection).size > 0;
}

/**
 * Add a field.
 *
 * Placed last by fractional index, so adding a column concurrently with
 * somebody else does not renumber anything and the two converge (ADR-0015).
 *
 * Returns false when the collection is full or the id is taken. Both are
 * caller errors rather than exceptional conditions.
 */
export function addField(doc: Y.Doc, field: NewField): boolean {
  const map = doc.getMap(DOC_KEYS.collection);
  const fields = map.get(COLLECTION_KEYS.fields);
  if (!(fields instanceof Y.Map)) return false;
  if (fields.has(field.id)) return false;
  if (fields.size >= MAX_FIELDS) return false;

  const last = [...fields.values()]
    .map((entry) => (entry instanceof Y.Map ? String(entry.get(FIELD_KEYS.idx) ?? '') : ''))
    .filter((idx) => idx.length > 0)
    .sort()
    .pop();

  doc.transact(() => {
    const created = new Y.Map();
    created.set(FIELD_KEYS.name, field.name.trim() || 'Untitled');
    created.set(FIELD_KEYS.fieldType, field.fieldType);
    if (field.description) created.set(FIELD_KEYS.description, field.description);
    if (field.config) created.set(FIELD_KEYS.config, field.config);
    created.set(FIELD_KEYS.idx, generateKeyBetween(last ?? null, null));
    created.set(FIELD_KEYS.schemaVersion, 1);
    fields.set(field.id, created);
  });
  return true;
}

/**
 * Remove a field.
 *
 * The title field is refused: every collection needs a column that names its
 * rows, and removing it would leave the projection with nowhere to put the
 * title and the interface with nothing in the first column.
 *
 * Values on the rows are not touched. They live on each row's own document, and
 * this document cannot reach them — which is the same reason a row keeps its
 * values when it is moved out. A field removed by mistake and added back with
 * the same id finds its values still there.
 */
export function removeField(doc: Y.Doc, fieldId: string): boolean {
  const map = doc.getMap(DOC_KEYS.collection);
  if (map.get(COLLECTION_KEYS.titleFieldId) === fieldId) return false;

  const fields = map.get(COLLECTION_KEYS.fields);
  if (!(fields instanceof Y.Map) || !fields.has(fieldId)) return false;

  doc.transact(() => fields.delete(fieldId));
  return true;
}

/** Rename a field, or change its description. */
export function updateField(
  doc: Y.Doc,
  fieldId: string,
  changes: { name?: string; description?: string | null; config?: Record<string, unknown> },
): boolean {
  const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields);
  if (!(fields instanceof Y.Map)) return false;
  const field = fields.get(fieldId);
  if (!(field instanceof Y.Map)) return false;

  doc.transact(() => {
    if (changes.name !== undefined) {
      field.set(FIELD_KEYS.name, changes.name.trim() || 'Untitled');
    }
    if (changes.description !== undefined) {
      if (changes.description === null) field.delete(FIELD_KEYS.description);
      else field.set(FIELD_KEYS.description, changes.description);
    }
    if (changes.config !== undefined) field.set(FIELD_KEYS.config, changes.config);
  });
  return true;
}

/** Add a view. */
export function addView(doc: Y.Doc, view: NewView): boolean {
  const map = doc.getMap(DOC_KEYS.collection);
  const views = map.get(COLLECTION_KEYS.views);
  if (!(views instanceof Y.Map)) return false;
  if (views.has(view.id)) return false;
  if (views.size >= MAX_VIEWS) return false;

  const last = [...views.values()]
    .map((entry) => (entry instanceof Y.Map ? String(entry.get(VIEW_KEYS.idx) ?? '') : ''))
    .filter((idx) => idx.length > 0)
    .sort()
    .pop();

  doc.transact(() => {
    const created = new Y.Map();
    created.set(VIEW_KEYS.name, view.name.trim() || 'Untitled view');
    created.set(VIEW_KEYS.viewType, view.viewType);
    created.set(VIEW_KEYS.idx, generateKeyBetween(last ?? null, null));
    created.set(VIEW_KEYS.definition, view.definition ?? {});
    created.set(VIEW_KEYS.schemaVersion, 1);
    views.set(view.id, created);
  });
  return true;
}

// --- values on a row --------------------------------------------------------

/**
 * The stored-value union already exists in the type model, tagged by `kind`.
 *
 * The tag is not redundant with the field's type. A field can be changed from
 * text to number, and the values written before that change are still text
 * until something rewrites them — so a reader has to know what it is holding
 * rather than assume the field's current type applies. My first draft declared
 * a looser `{ kind: string }` here, which would have thrown that away.
 */

/**
 * Set a value on a row.
 *
 * Written to the row's own document, not the collection's. A row carries its
 * values, so moving it out of a collection and back again does not lose them.
 *
 * A derived field is refused: formulas, rollups and the audit fields are
 * computed during materialisation, and storing one would let two clients
 * disagree about a value that is deterministically implied by its inputs.
 */
export function setPropertyValue(
  doc: Y.Doc,
  fieldId: string,
  fieldType: FieldType,
  value: StoredValue | null,
): boolean {
  if (isDerived(fieldType)) return false;

  const properties = doc.getMap(DOC_KEYS.properties);
  doc.transact(() => {
    // Null clears rather than storing an empty value, so "not set" and "set to
    // nothing" cannot both exist and mean different things.
    if (value === null) properties.delete(fieldId);
    else properties.set(fieldId, value);
  });
  return true;
}

/** Every value on a row. */
export function readPropertyValues(doc: Y.Doc): Map<string, StoredValue> {
  const out = new Map<string, StoredValue>();
  if (!doc.share.has(DOC_KEYS.properties)) return out;

  for (const [fieldId, raw] of doc.getMap(DOC_KEYS.properties).entries()) {
    const value = raw instanceof Y.Map ? raw.toJSON() : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (typeof (value as { kind?: unknown }).kind !== 'string') continue;
    out.set(fieldId, value as StoredValue);
  }
  return out;
}
