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
import {
  isDerived,
  type FieldType,
  type SelectOption,
  type StoredValue,
} from '../types/field.js';

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

// --- select options ---------------------------------------------------------

/**
 * The palette a select option can use.
 *
 * A closed set of names rather than free colour values. Two reasons: a name
 * survives a theme change — `blue` can mean one thing in a light theme and
 * another in a dark one, where a stored `#2b6cb0` cannot — and a fixed palette
 * keeps a table legible, which arbitrary colours do not.
 *
 * This is also the answer ADR-0020 could not find for tag colours: options are
 * a registry that already exists on the field, so there is somewhere to put the
 * colour. Tags have no such registry, which is why they still have none.
 */
export const OPTION_COLORS = [
  'grey',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const;

export type OptionColor = (typeof OPTION_COLORS)[number];

/** How many options one select field may hold. */
export const MAX_OPTIONS = 100;

/** Read a field's options, ignoring anything malformed. */
export function readOptions(doc: Y.Doc, fieldId: string): SelectOption[] {
  const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields);
  if (!(fields instanceof Y.Map)) return [];
  const field = fields.get(fieldId);
  if (!(field instanceof Y.Map)) return [];

  const config = field.get(FIELD_KEYS.config);
  const raw = (config as { options?: unknown } | undefined)?.options;
  if (!Array.isArray(raw)) return [];

  const out: SelectOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, color } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') continue;
    out.push({
      id,
      name: typeof name === 'string' ? name : '',
      // An unknown colour reads as grey rather than being dropped: the option
      // still exists and rows still point at it.
      color: typeof color === 'string' && (OPTION_COLORS as readonly string[]).includes(color)
        ? color
        : 'grey',
    });
  }
  return out;
}

/**
 * Replace a field's options.
 *
 * The whole list at once, because that is what an option editor produces — and
 * because a partial update would need a merge rule for concurrent edits to the
 * same list, which is a worse problem than last-write-wins on a list somebody
 * is actively editing.
 *
 * Ids are preserved by the caller. That matters: a row's value points at an
 * option id, so renaming an option must keep its id or every row pointing at it
 * loses its value.
 */
export function setOptions(
  doc: Y.Doc,
  fieldId: string,
  options: SelectOption[],
): boolean {
  const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields);
  if (!(fields instanceof Y.Map)) return false;
  const field = fields.get(fieldId);
  if (!(field instanceof Y.Map)) return false;

  const fieldType = field.get(FIELD_KEYS.fieldType);
  if (fieldType !== 'select' && fieldType !== 'multiSelect' && fieldType !== 'status') {
    return false;
  }
  if (options.length > MAX_OPTIONS) return false;

  // Duplicate ids would make a row's value ambiguous.
  const ids = new Set<string>();
  for (const option of options) {
    if (option.id === '' || ids.has(option.id)) return false;
    ids.add(option.id);
  }

  doc.transact(() => {
    const existing = (field.get(FIELD_KEYS.config) ?? {}) as Record<string, unknown>;
    field.set(FIELD_KEYS.config, {
      ...existing,
      options: options.map((option) => ({
        id: option.id,
        name: option.name.trim(),
        color: (OPTION_COLORS as readonly string[]).includes(option.color)
          ? option.color
          : 'grey',
      })),
    });
  });
  return true;
}

/**
 * Does this value name options that exist?
 *
 * Checked before storing, so a cell cannot come to point at an option that was
 * never there. It deliberately does *not* police values already stored: an
 * option removed later leaves rows pointing at it, and those values are kept
 * rather than erased.
 *
 * That is the same rule as everywhere else here — a row owns its values, and the
 * collection cannot reach them. Removing an option by mistake and adding it back
 * with the same id restores what the rows were showing. Erasing on removal would
 * make a misclick unrecoverable.
 */
export function selectValueIsKnown(
  value: StoredValue,
  options: readonly SelectOption[],
): boolean {
  const ids = new Set(options.map((option) => option.id));
  if (value.kind === 'select') return ids.has(value.optionId);
  if (value.kind === 'multiSelect') return value.optionIds.every((id) => ids.has(id));
  return true;
}
