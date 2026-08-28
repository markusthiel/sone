/**
 * Collections.
 *
 * The reading side has existed since the first migration — the schema names the
 * maps, the materialiser parses them, page_properties has typed columns waiting.
 * These are the writers, and the decisions worth pinning down are about where a
 * value lives and what cannot be removed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import {
  MAX_FIELDS,
  addField,
  addView,
  initCollection,
  isCollection,
  readPropertyValues,
  readOptions,
  removeField,
  selectValueIsKnown,
  setOptions,
  setPropertyValue,
  updateField,
} from '../src/doc/collection.js';
import { COLLECTION_KEYS, DOC_KEYS, FIELD_KEYS } from '../src/doc/docSchema.js';

const TITLE = 'field-title';

function collection(): Y.Doc {
  const doc = new Y.Doc();
  initCollection(doc, { titleFieldId: TITLE });
  return doc;
}

const fields = (doc: Y.Doc): Y.Map<unknown> =>
  doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields) as Y.Map<unknown>;

test('an ordinary document is not a collection', () => {
  const doc = new Y.Doc();
  assert.equal(isCollection(doc), false);
  doc.destroy();
});

test('a collection starts with a title field', () => {
  // Every collection needs one column that names the row. Without it the
  // projection has nowhere to put the page title and the first column is empty.
  const doc = collection();
  assert.equal(isCollection(doc), true);
  assert.equal(fields(doc).size, 1);
  assert.ok(fields(doc).has(TITLE));
  doc.destroy();
});

test('initialising twice leaves the first one alone', () => {
  // A second call is far more likely to be a retry than a request to start
  // over, and starting over would drop every field somebody had added.
  const doc = collection();
  addField(doc, { id: 'f1', name: 'Status', fieldType: 'select' });
  initCollection(doc, { titleFieldId: 'different' });

  assert.equal(fields(doc).size, 2, 'the added field survives');
  assert.equal(
    doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.titleFieldId),
    TITLE,
    'and the title field is not repointed',
  );
  doc.destroy();
});

test('the title field cannot be removed', () => {
  const doc = collection();
  assert.equal(removeField(doc, TITLE), false);
  assert.ok(fields(doc).has(TITLE));
  doc.destroy();
});

test('fields are ordered, and a new one goes last', () => {
  const doc = collection();
  addField(doc, { id: 'a', name: 'A', fieldType: 'text' });
  addField(doc, { id: 'b', name: 'B', fieldType: 'number' });

  const order = [...fields(doc).entries()]
    .map(([id, entry]) => [id, String((entry as Y.Map<unknown>).get(FIELD_KEYS.idx))])
    .sort((left, right) => (left[1]! < right[1]! ? -1 : 1))
    .map(([id]) => id);

  assert.deepEqual(order, [TITLE, 'a', 'b']);
  doc.destroy();
});

test('a duplicate field id is refused rather than overwriting', () => {
  const doc = collection();
  addField(doc, { id: 'a', name: 'First', fieldType: 'text' });
  assert.equal(addField(doc, { id: 'a', name: 'Second', fieldType: 'number' }), false);
  assert.equal((fields(doc).get('a') as Y.Map<unknown>).get(FIELD_KEYS.name), 'First');
  doc.destroy();
});

test('the number of fields is capped', () => {
  const doc = collection();
  for (let i = 0; i < MAX_FIELDS + 5; i++) {
    addField(doc, { id: `f${i}`, name: `F${i}`, fieldType: 'text' });
  }
  assert.equal(fields(doc).size, MAX_FIELDS);
  doc.destroy();
});

test('a field can be renamed without touching anything else', () => {
  const doc = collection();
  addField(doc, { id: 'a', name: 'Old', fieldType: 'select', config: { options: [1] } });
  updateField(doc, 'a', { name: 'New' });

  const field = fields(doc).get('a') as Y.Map<unknown>;
  assert.equal(field.get(FIELD_KEYS.name), 'New');
  assert.deepEqual(field.get(FIELD_KEYS.config), { options: [1] });
  doc.destroy();
});

// --- values -----------------------------------------------------------------

test('a value is written to the row, not to the collection', () => {
  // This is what makes a row movable: dragged out of a collection it keeps its
  // values, which simply stop being displayed and reappear if it moves back.
  const row = new Y.Doc();
  setPropertyValue(row, 'a', 'text', { kind: 'text', value: 'hello' });

  assert.deepEqual(readPropertyValues(row).get('a'), { kind: 'text', value: 'hello' });
  assert.equal(row.share.has(DOC_KEYS.collection), false, 'the row is not a collection');
  row.destroy();
});

test('null clears a value rather than storing an empty one', () => {
  // "Not set" and "set to nothing" must not both exist and mean different
  // things.
  const row = new Y.Doc();
  setPropertyValue(row, 'a', 'text', { kind: 'text', value: 'hello' });
  setPropertyValue(row, 'a', 'text', null);
  assert.equal(readPropertyValues(row).has('a'), false);
  row.destroy();
});

test('a derived field cannot be written', () => {
  // Formulas, rollups and the audit fields are computed during
  // materialisation. Storing one would let two clients disagree about a value
  // that is deterministically implied by its inputs.
  const row = new Y.Doc();
  for (const type of ['formula', 'rollup', 'createdAt', 'lastEditedBy'] as const) {
    assert.equal(setPropertyValue(row, 'a', type, { kind: 'text', value: 'x' }), false);
  }
  assert.equal(readPropertyValues(row).size, 0);
  row.destroy();
});

test('a value survives its field being removed and added back', () => {
  // The collection cannot reach a row's values, so removing a column does not
  // destroy data — which matters, because removing one by mistake is easy.
  const doc = collection();
  const row = new Y.Doc();
  addField(doc, { id: 'a', name: 'Notes', fieldType: 'text' });
  setPropertyValue(row, 'a', 'text', { kind: 'text', value: 'kept' });

  removeField(doc, 'a');
  addField(doc, { id: 'a', name: 'Notes again', fieldType: 'text' });

  assert.deepEqual(readPropertyValues(row).get('a'), { kind: 'text', value: 'kept' });
  doc.destroy();
  row.destroy();
});

test('a malformed stored value is ignored rather than returned', () => {
  // A document written by something else must not produce a value with no kind,
  // which every reader downstream would have to guard against.
  const row = new Y.Doc();
  row.getMap(DOC_KEYS.properties).set('a', 'not an object' as never);
  row.getMap(DOC_KEYS.properties).set('b', { value: 'no kind' } as never);
  assert.equal(readPropertyValues(row).size, 0);
  row.destroy();
});

// --- views ------------------------------------------------------------------

test('views are added in order', () => {
  const doc = collection();
  assert.equal(addView(doc, { id: 'v1', name: 'Table', viewType: 'table' }), true);
  assert.equal(addView(doc, { id: 'v1', name: 'Again', viewType: 'board' }), false);
  doc.destroy();
});

test('two clients adding different fields both keep them', () => {
  // Fields are a Y.Map keyed by id, so concurrent additions merge rather than
  // overwrite — which is why they are not an array.
  const first = collection();
  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

  addField(first, { id: 'from-first', name: 'One', fieldType: 'text' });
  addField(second, { id: 'from-second', name: 'Two', fieldType: 'number' });

  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

  for (const doc of [first, second]) {
    assert.ok(fields(doc).has('from-first'));
    assert.ok(fields(doc).has('from-second'));
  }
  first.destroy();
  second.destroy();
});

// --- select options ---------------------------------------------------------

test('options are stored on the field and read back', () => {
  const doc = collection();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });

  assert.equal(
    setOptions(doc, 'status', [
      { id: 'o1', name: 'Todo', color: 'grey' },
      { id: 'o2', name: 'Doing', color: 'blue' },
    ]),
    true,
  );

  assert.deepEqual(readOptions(doc, 'status'), [
    { id: 'o1', name: 'Todo', color: 'grey' },
    { id: 'o2', name: 'Doing', color: 'blue' },
  ]);
  doc.destroy();
});

test('setting options leaves the rest of the config alone', () => {
  // A field's config holds more than options for some types, and replacing the
  // whole object would quietly drop it.
  const doc = collection();
  addField(doc, {
    id: 'status',
    name: 'Status',
    fieldType: 'select',
    config: { somethingElse: 7 },
  });
  setOptions(doc, 'status', [{ id: 'o1', name: 'Todo', color: 'grey' }]);

  const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields) as Y.Map<unknown>;
  const config = (fields.get('status') as Y.Map<unknown>).get(FIELD_KEYS.config) as Record<
    string,
    unknown
  >;
  assert.equal(config['somethingElse'], 7);
  doc.destroy();
});

test('a colour outside the palette becomes grey rather than being stored', () => {
  // Names rather than colour values, so a theme change cannot make a label
  // unreadable — and an unknown name is not worth failing over.
  const doc = collection();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });
  setOptions(doc, 'status', [{ id: 'o1', name: 'Todo', color: '#ff0000' }]);
  assert.equal(readOptions(doc, 'status')[0]!.color, 'grey');
  doc.destroy();
});

test('options are refused on a field that cannot have them', () => {
  const doc = collection();
  addField(doc, { id: 'note', name: 'Note', fieldType: 'text' });
  assert.equal(setOptions(doc, 'note', [{ id: 'o1', name: 'X', color: 'grey' }]), false);
  doc.destroy();
});

test('duplicate option ids are refused', () => {
  // A row's value points at an id, so two options sharing one would make the
  // value ambiguous.
  const doc = collection();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });
  assert.equal(
    setOptions(doc, 'status', [
      { id: 'same', name: 'One', color: 'grey' },
      { id: 'same', name: 'Two', color: 'blue' },
    ]),
    false,
  );
  assert.deepEqual(readOptions(doc, 'status'), []);
  doc.destroy();
});

test('renaming an option keeps the id, so rows keep their value', () => {
  // The reason the option editor has to preserve ids rather than rebuild the
  // list: a row points at an id, not at a name.
  const doc = collection();
  const row = new Y.Doc();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });
  setOptions(doc, 'status', [{ id: 'o1', name: 'Todo', color: 'grey' }]);
  setPropertyValue(row, 'status', 'select', { kind: 'select', optionId: 'o1' });

  setOptions(doc, 'status', [{ id: 'o1', name: 'To do', color: 'green' }]);

  assert.deepEqual(readPropertyValues(row).get('status'), {
    kind: 'select',
    optionId: 'o1',
  });
  assert.equal(
    selectValueIsKnown({ kind: 'select', optionId: 'o1' }, readOptions(doc, 'status')),
    true,
  );
  doc.destroy();
  row.destroy();
});

test('a value naming an option that never existed is not known', () => {
  const doc = collection();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });
  setOptions(doc, 'status', [{ id: 'o1', name: 'Todo', color: 'grey' }]);
  const options = readOptions(doc, 'status');

  assert.equal(selectValueIsKnown({ kind: 'select', optionId: 'nope' }, options), false);
  assert.equal(
    selectValueIsKnown({ kind: 'multiSelect', optionIds: ['o1', 'nope'] }, options),
    false,
    'one unknown is enough',
  );
  assert.equal(
    selectValueIsKnown({ kind: 'multiSelect', optionIds: ['o1'] }, options),
    true,
  );
  doc.destroy();
});

test('removing an option does not erase the rows pointing at it', () => {
  // A row owns its values and the collection cannot reach them. Removing an
  // option by mistake and adding it back with the same id restores what the
  // rows were showing; erasing on removal would make a misclick
  // unrecoverable.
  const doc = collection();
  const row = new Y.Doc();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });
  setOptions(doc, 'status', [{ id: 'o1', name: 'Todo', color: 'grey' }]);
  setPropertyValue(row, 'status', 'select', { kind: 'select', optionId: 'o1' });

  setOptions(doc, 'status', []);

  assert.deepEqual(readPropertyValues(row).get('status'), {
    kind: 'select',
    optionId: 'o1',
  });
  doc.destroy();
  row.destroy();
});

test('malformed options are skipped rather than returned', () => {
  const doc = collection();
  addField(doc, { id: 'status', name: 'Status', fieldType: 'select' });
  const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields) as Y.Map<unknown>;
  (fields.get('status') as Y.Map<unknown>).set(FIELD_KEYS.config, {
    options: ['not an object', { name: 'no id' }, { id: 'ok', name: 'Fine', color: 'red' }],
  });

  assert.deepEqual(readOptions(doc, 'status'), [
    { id: 'ok', name: 'Fine', color: 'red' },
  ]);
  doc.destroy();
});
