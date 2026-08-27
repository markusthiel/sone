/**
 * Materialiser read-path tests.
 *
 * These cover the part that runs without a database: interpreting a Y.Doc and
 * mapping values onto shadow columns. The emphasis is on malformed input,
 * because a document is user input that may have been written by an older
 * client or a third-party block type, and the materialiser's contract is that
 * one bad field degrades that field and nothing else.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BLOCK_KEYS,
  COLLECTION_KEYS,
  DOC_KEYS,
  FIELD_KEYS,
  META_KEYS,
  PAGE_KEYS,
  generateKeyBetween,
} from '@sone/core';
import * as Y from 'yjs';

import { readDocument } from '../src/materialize/readDocument.js';
import { normaliseText } from '../src/materialize/plainText.js';
import { toShadowColumns, valueToSearchText } from '../src/materialize/values.js';

// --- helpers ---------------------------------------------------------------

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
  const page = doc.getMap(DOC_KEYS.page);
  page.set(PAGE_KEYS.title, 'Test page');
  page.set(PAGE_KEYS.idx, 'a0');
  return doc;
}

function addBlock(
  doc: Y.Doc,
  id: string,
  type: string,
  idx: string,
  text?: string,
  props: Record<string, unknown> = {},
): void {
  const block = new Y.Map();
  block.set(BLOCK_KEYS.type, type);
  block.set(BLOCK_KEYS.parentId, null);
  block.set(BLOCK_KEYS.idx, idx);
  const propsMap = new Y.Map();
  for (const [k, v] of Object.entries(props)) propsMap.set(k, v);
  block.set(BLOCK_KEYS.props, propsMap);
  doc.getMap(DOC_KEYS.blocks).set(id, block);

  if (text !== undefined) {
    const fragment = new Y.XmlFragment();
    doc.getMap(DOC_KEYS.content).set(id, fragment);
    const el = new Y.XmlElement('paragraph');
    fragment.insert(0, [el]);
    el.insert(0, [new Y.XmlText(text)]);
  }
}

// --- page metadata ---------------------------------------------------------

test('reads page metadata', () => {
  const doc = makeDoc();
  doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.coverUrl, 'https://example.org/c.png');
  const parsed = readDocument(doc);

  assert.equal(parsed.page.title, 'Test page');
  assert.equal(parsed.page.idx, 'a0');
  assert.equal(parsed.page.coverUrl, 'https://example.org/c.png');
  assert.equal(parsed.page.parentPageId, null);
  assert.deepEqual(parsed.warnings, []);
});

test('missing page idx is defaulted and warned about, not fatal', () => {
  const doc = new Y.Doc();
  doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'No index');
  const parsed = readDocument(doc);

  assert.equal(parsed.page.idx, 'a0');
  assert.ok(parsed.warnings.some((w) => w.includes('page.idx missing')));
});

test('non-string title does not crash the read', () => {
  const doc = makeDoc();
  doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 42 as unknown as string);
  const parsed = readDocument(doc);
  assert.equal(parsed.page.title, '');
});

// --- blocks ----------------------------------------------------------------

test('blocks are returned in fractional index order', () => {
  const doc = makeDoc();
  const a = generateKeyBetween(null, null);
  const c = generateKeyBetween(a, null);
  const b = generateKeyBetween(a, c);

  // Inserted deliberately out of order.
  addBlock(doc, '00000000-0000-0000-0000-0000000000c1', 'paragraph', c, 'third');
  addBlock(doc, '00000000-0000-0000-0000-0000000000a1', 'paragraph', a, 'first');
  addBlock(doc, '00000000-0000-0000-0000-0000000000b1', 'paragraph', b, 'second');

  const parsed = readDocument(doc);
  assert.deepEqual(
    parsed.blocks.map((blk) => blk.plainText),
    ['first', 'second', 'third'],
  );
});

test('identical indexes are ordered by id, giving a stable total order', () => {
  // The concurrent-insert case: two clients produced the same key.
  const doc = makeDoc();
  addBlock(doc, '00000000-0000-0000-0000-00000000000b', 'paragraph', 'a1', 'bee');
  addBlock(doc, '00000000-0000-0000-0000-00000000000a', 'paragraph', 'a1', 'ay');

  const parsed = readDocument(doc);
  assert.deepEqual(
    parsed.blocks.map((blk) => blk.plainText),
    ['ay', 'bee'],
    'tie must be broken by id, not by insertion order',
  );
});

test('block without a type is skipped with a warning', () => {
  const doc = makeDoc();
  const broken = new Y.Map();
  broken.set(BLOCK_KEYS.idx, 'a1');
  doc.getMap(DOC_KEYS.blocks).set('00000000-0000-0000-0000-00000000dead', broken);
  addBlock(doc, '00000000-0000-0000-0000-00000000good', 'paragraph', 'a2', 'kept');

  const parsed = readDocument(doc);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0]!.plainText, 'kept');
  assert.ok(parsed.warnings.some((w) => w.includes('missing type')));
});

test('block props contribute searchable text for non-inline types', () => {
  const doc = makeDoc();
  addBlock(doc, '00000000-0000-0000-0000-0000000code1', 'code', 'a1', undefined, {
    source: 'SELECT 1',
    language: 'sql',
  });
  const parsed = readDocument(doc);
  assert.match(parsed.blocks[0]!.plainText, /SELECT 1/);
  assert.match(parsed.blocks[0]!.plainText, /sql/);
});

test('nested inline content is flattened', () => {
  const doc = makeDoc();
  const fragment = new Y.XmlFragment();
  doc.getMap(DOC_KEYS.content).set('00000000-0000-0000-0000-00000000nest', fragment);
  const para = new Y.XmlElement('paragraph');
  fragment.insert(0, [para]);
  const link = new Y.XmlElement('link');
  para.insert(0, [new Y.XmlText('see '), link]);
  link.insert(0, [new Y.XmlText('the docs')]);

  const block = new Y.Map();
  block.set(BLOCK_KEYS.type, 'paragraph');
  block.set(BLOCK_KEYS.idx, 'a1');
  doc.getMap(DOC_KEYS.blocks).set('00000000-0000-0000-0000-00000000nest', block);

  const parsed = readDocument(doc);
  assert.match(parsed.blocks[0]!.plainText, /see/);
  assert.match(parsed.blocks[0]!.plainText, /the docs/);
});

// --- collections -----------------------------------------------------------

test('page without a collection reports null rather than an empty one', () => {
  const parsed = readDocument(makeDoc());
  assert.equal(parsed.collection, null);
});

test('reads collection fields and views in order', () => {
  const doc = makeDoc();
  const collection = doc.getMap(DOC_KEYS.collection);
  collection.set(COLLECTION_KEYS.titleFieldId, 'f1');

  const fields = new Y.Map();
  for (const [id, name, idx] of [
    ['f2', 'Status', 'a2'],
    ['f1', 'Name', 'a1'],
  ] as const) {
    const f = new Y.Map();
    f.set(FIELD_KEYS.name, name);
    f.set(FIELD_KEYS.fieldType, id === 'f1' ? 'text' : 'select');
    f.set(FIELD_KEYS.idx, idx);
    fields.set(id, f);
  }
  collection.set(COLLECTION_KEYS.fields, fields);

  const parsed = readDocument(doc);
  assert.ok(parsed.collection);
  assert.deepEqual(
    parsed.collection!.fields.map((f) => f.name),
    ['Name', 'Status'],
  );
  assert.equal(parsed.collection!.titleFieldId, 'f1');
});

test('titleFieldId pointing at a missing field is warned about', () => {
  const doc = makeDoc();
  const collection = doc.getMap(DOC_KEYS.collection);
  collection.set(COLLECTION_KEYS.titleFieldId, 'ghost');
  collection.set(COLLECTION_KEYS.fields, new Y.Map());

  const parsed = readDocument(doc);
  assert.ok(parsed.warnings.some((w) => w.includes('not among the fields')));
});

// --- properties ------------------------------------------------------------

test('reads stored property values', () => {
  const doc = makeDoc();
  const props = doc.getMap(DOC_KEYS.properties);
  props.set('f1', { kind: 'text', value: 'Hello' });
  props.set('f2', { kind: 'number', value: 42 });

  const parsed = readDocument(doc);
  assert.equal(parsed.properties.size, 2);
  assert.deepEqual(parsed.properties.get('f1'), { kind: 'text', value: 'Hello' });
});

test('property without a kind is skipped, others survive', () => {
  const doc = makeDoc();
  const props = doc.getMap(DOC_KEYS.properties);
  props.set('bad', { value: 'no kind' });
  props.set('good', { kind: 'text', value: 'kept' });

  const parsed = readDocument(doc);
  assert.equal(parsed.properties.size, 1);
  assert.ok(parsed.properties.has('good'));
  assert.ok(parsed.warnings.some((w) => w.includes('missing kind')));
});

// --- shadow columns --------------------------------------------------------

test('number values map to number_value', () => {
  const shadow = toShadowColumns({ kind: 'number', value: 12.5 }, { fieldType: 'number' });
  assert.equal(shadow.numberValue, 12.5);
  assert.equal(shadow.textValue, null);
});

test('non-finite numbers are rejected rather than stored as NaN', () => {
  const shadow = toShadowColumns(
    { kind: 'number', value: Number.POSITIVE_INFINITY },
    { fieldType: 'number' },
  );
  assert.equal(shadow.numberValue, null);
});

test('select sorts by option position, not by option id', () => {
  // The whole reason the shadow column exists: users expect their option
  // order, and an opaque id sorts arbitrarily.
  const order = ['opt-todo', 'opt-doing', 'opt-done'];
  const todo = toShadowColumns({ kind: 'select', optionId: 'opt-todo' }, {
    fieldType: 'select',
    optionOrder: order,
  });
  const done = toShadowColumns({ kind: 'select', optionId: 'opt-done' }, {
    fieldType: 'select',
    optionOrder: order,
  });
  assert.ok(todo.textValue! < done.textValue!);
});

test('unknown option ids sort last instead of throwing', () => {
  const order = ['a', 'b'];
  const known = toShadowColumns({ kind: 'select', optionId: 'a' }, {
    fieldType: 'select',
    optionOrder: order,
  });
  const stale = toShadowColumns({ kind: 'select', optionId: 'removed' }, {
    fieldType: 'select',
    optionOrder: order,
  });
  assert.ok(known.textValue! < stale.textValue!);
});

test('dates map to timestamp columns and reject garbage', () => {
  const good = toShadowColumns(
    { kind: 'date', start: '2026-03-01T10:00:00Z', end: null },
    { fieldType: 'date' },
  );
  assert.ok(good.dateStart instanceof Date);
  assert.equal(good.dateEnd, null);

  const bad = toShadowColumns(
    { kind: 'date', start: 'not a date', end: null },
    { fieldType: 'date' },
  );
  assert.equal(bad.dateStart, null);
});

test('derived field types never produce shadow columns', () => {
  // A client writing a computed value into the CRDT violates ADR-0002; the
  // materialiser must not propagate it into a sortable column.
  const shadow = toShadowColumns({ kind: 'number', value: 99 }, { fieldType: 'formula' });
  assert.deepEqual(shadow, {
    textValue: null,
    numberValue: null,
    dateStart: null,
    dateEnd: null,
    boolValue: null,
  });
});

test('relation stores its target count for sorting', () => {
  const shadow = toShadowColumns(
    { kind: 'relation', pageIds: ['p1', 'p2', 'p3'] },
    { fieldType: 'relation' },
  );
  assert.equal(shadow.numberValue, 3);
});

test('null and undefined values are safe', () => {
  assert.deepEqual(toShadowColumns(null, { fieldType: 'text' }).textValue, null);
  assert.deepEqual(toShadowColumns(undefined, { fieldType: 'text' }).textValue, null);
});

// --- search text -----------------------------------------------------------

test('select values contribute their option name to search, not the id', () => {
  const names = new Map([['opt-1', 'In progress']]);
  assert.equal(
    valueToSearchText({ kind: 'select', optionId: 'opt-1' }, names),
    'In progress',
  );
});

test('checkbox and person values are not indexed for search', () => {
  assert.equal(valueToSearchText({ kind: 'checkbox', value: true }), '');
  assert.equal(valueToSearchText({ kind: 'person', userIds: ['u1'] }), '');
});

// --- text normalisation ----------------------------------------------------

test('normaliseText strips control characters that Postgres rejects', () => {
  // A NUL byte in a text column is a hard error, and pasted content has them.
  const cleaned = normaliseText('before\u0000after\u0007end');
  assert.ok(!cleaned.includes('\u0000'));
  assert.match(cleaned, /before after end/);
});

test('normaliseText collapses whitespace and trims', () => {
  assert.equal(normaliseText('  a\n\n  b\t\tc  '), 'a b c');
});

test('normaliseText truncates pathologically long content', () => {
  const cleaned = normaliseText('x'.repeat(200_000));
  assert.ok(cleaned.length <= 64 * 1024);
});
