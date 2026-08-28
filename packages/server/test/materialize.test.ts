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
  COLLECTION_KEYS,
  DOC_KEYS,
  FIELD_KEYS,
  META_KEYS,
  PAGE_KEYS,
  appendBlocks,
  pageContent,
  setPageBlocks,
  type NewBlock,
} from '@sone/core';
import * as Y from 'yjs';

import { readDocument } from '../src/materialize/readDocument.js';
import { normaliseText } from '../src/materialize/plainText.js';
import { toShadowColumns, valueToSearchText } from '../src/materialize/values.js';

// --- helpers ---------------------------------------------------------------

/** Deterministic uuid from a short tag, so failures are reproducible. */
const uuid = (tag: string): string =>
  `00000000-0000-4000-8000-${tag.padStart(12, '0')}`;

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
  const page = doc.getMap(DOC_KEYS.page);
  page.set(PAGE_KEYS.title, 'Test page');
  page.set(PAGE_KEYS.idx, 'a0');
  return doc;
}

function addBlock(doc: Y.Doc, block: NewBlock): void {
  appendBlocks(doc, [block]);
}

// --- page metadata ---------------------------------------------------------

test('reads page metadata', () => {
  const doc = makeDoc();
  doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.coverUrl, 'https://example.org/c.png');
  const parsed = readDocument(doc, 'page-1');

  assert.equal(parsed.page.title, 'Test page');
  assert.equal(parsed.page.idx, 'a0');
  assert.equal(parsed.page.coverUrl, 'https://example.org/c.png');
  assert.equal(parsed.page.parentPageId, null);
  assert.deepEqual(parsed.warnings, []);
});

test('missing page idx is defaulted and warned about, not fatal', () => {
  const doc = new Y.Doc();
  doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'No index');
  const parsed = readDocument(doc, 'page-1');

  assert.equal(parsed.page.idx, 'a0');
  assert.ok(parsed.warnings.some((w) => w.includes('page.idx missing')));
});

test('non-string title does not crash the read', () => {
  const doc = makeDoc();
  doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 42 as unknown as string);
  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.page.title, '');
});

// --- blocks ----------------------------------------------------------------

test('blocks are returned in document order', () => {
  // Order is fragment position now. There is no index to collide, because Yjs
  // resolves concurrent insertion itself (ADR-0015).
  const doc = makeDoc();
  setPageBlocks(doc, [
    { id: uuid('a1'), type: 'paragraph', text: 'first' },
    { id: uuid('b1'), type: 'paragraph', text: 'second' },
    { id: uuid('c1'), type: 'paragraph', text: 'third' },
  ]);

  const parsed = readDocument(doc, 'page-1');
  assert.deepEqual(
    parsed.blocks.map((blk) => blk.plainText),
    ['first', 'second', 'third'],
  );
  // The derived sort key must order the same way as a text column.
  const keys = parsed.blocks.map((b) => b.idx);
  assert.deepEqual(keys, [...keys].sort());
});

test('a nested tree is flattened depth-first, in reading order', () => {
  const doc = makeDoc();
  setPageBlocks(doc, [
    {
      id: uuid('l1'),
      type: 'bulletList',
      text: 'outer',
      children: [
        { id: uuid('l2'), type: 'bulletList', text: 'inner' },
        { id: uuid('l3'), type: 'bulletList', text: 'also inner' },
      ],
    },
    { id: uuid('p1'), type: 'paragraph', text: 'after' },
  ]);

  const parsed = readDocument(doc, 'page-1');
  assert.deepEqual(
    parsed.blocks.map((b) => b.plainText),
    ['outer', 'inner', 'also inner', 'after'],
  );
  assert.equal(parsed.blocks[1]!.parentId, uuid('l1'));
  assert.equal(parsed.blocks[3]!.parentId, null);
});

test("a container's text does not swallow its children's", () => {
  // Otherwise the search index would score a nested list once per descendant.
  const doc = makeDoc();
  setPageBlocks(doc, [
    {
      id: uuid('c1'),
      type: 'callout',
      text: 'parent text',
      children: [{ id: uuid('c2'), type: 'paragraph', text: 'child text' }],
    },
  ]);

  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.blocks[0]!.plainText, 'parent text');
  assert.equal(parsed.blocks[1]!.plainText, 'child text');
});

test('an element without a block id is skipped with a warning', () => {
  const doc = makeDoc();
  const fragment = pageContent(doc);
  const orphan = new Y.XmlElement('paragraph');
  orphan.insert(0, [new Y.XmlText('no id')]);
  fragment.insert(0, [orphan]);
  addBlock(doc, { id: uuid('ok'), type: 'paragraph', text: 'kept' });

  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.blocks[0]!.plainText, 'kept');
  assert.ok(parsed.warnings.some((w) => w.includes('no block id')));
});

test('malformed props degrade that block and nothing else', () => {
  const doc = makeDoc();
  addBlock(doc, { id: uuid('bad'), type: 'paragraph', text: 'text' });
  const fragment = pageContent(doc);
  (fragment.get(0) as Y.XmlElement).setAttribute('props', '{not json');

  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.blocks.length, 1);
  assert.deepEqual(parsed.blocks[0]!.props, {});
  assert.ok(parsed.warnings.some((w) => w.includes('not valid JSON')));
});

test('block props contribute searchable text for non-inline types', () => {
  const doc = makeDoc();
  addBlock(doc, {
    id: uuid('code'),
    type: 'code',
    props: { source: 'SELECT 1', language: 'sql' },
  });
  const parsed = readDocument(doc, 'page-1');
  assert.match(parsed.blocks[0]!.plainText, /SELECT 1/);
  assert.match(parsed.blocks[0]!.plainText, /sql/);
});

test('inline marks are flattened, block boundaries are not crossed', () => {
  const doc = makeDoc();
  const fragment = pageContent(doc);
  const para = new Y.XmlElement('paragraph');
  para.setAttribute('id', uuid('nest'));
  fragment.insert(0, [para]);
  const link = new Y.XmlElement('link');
  para.insert(0, [new Y.XmlText('see '), link]);
  link.insert(0, [new Y.XmlText('the docs')]);

  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.blocks[0]!.plainText, 'see the docs');
});

test('props round-trip through the encoded attribute', () => {
  const doc = makeDoc();
  addBlock(doc, {
    id: uuid('h1'),
    type: 'heading',
    text: 'Title',
    props: { level: 2, collapsed: false },
  });
  const parsed = readDocument(doc, 'page-1');
  assert.deepEqual(parsed.blocks[0]!.props, { level: 2, collapsed: false });
});

// --- collections -----------------------------------------------------------

test('a page holding no collection reports none', () => {
  const parsed = readDocument(makeDoc(), 'page-1');
  assert.equal(parsed.collections.size, 0);
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

  // The 0.2.0 shape — one collection with its keys at the top level — still
  // reads, as one collection keyed by the page's own id (ADR-0021). An old
  // document keeps working without a migration.
  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.collections.size, 1);

  const read = parsed.collections.get('page-1');
  assert.ok(read);
  assert.deepEqual(
    read.fields.map((field) => field.name),
    ['Name', 'Status'],
  );
  assert.equal(read.titleFieldId, 'f1');
});

test('a page can hold several collections, keyed by id', () => {
  // What the folder shape could not do and Craft does: several per page.
  const doc = makeDoc();
  const root = doc.getMap(DOC_KEYS.collection);

  for (const id of ['c1', 'c2']) {
    const entry = new Y.Map();
    entry.set(COLLECTION_KEYS.titleFieldId, `${id}-title`);
    const fields = new Y.Map();
    const field = new Y.Map();
    field.set(FIELD_KEYS.name, 'Name');
    field.set(FIELD_KEYS.fieldType, 'text');
    field.set(FIELD_KEYS.idx, 'a1');
    fields.set(`${id}-title`, field);
    entry.set(COLLECTION_KEYS.fields, fields);
    root.set(id, entry);
  }

  const parsed = readDocument(doc, 'page-1');
  assert.deepEqual([...parsed.collections.keys()].sort(), ['c1', 'c2']);
  assert.equal(parsed.collections.get('c2')?.titleFieldId, 'c2-title');
});

test('a malformed collection is skipped and the others survive', () => {
  // One bad entry must not cost a page every table on it.
  const doc = makeDoc();
  const root = doc.getMap(DOC_KEYS.collection);
  root.set('broken', 'not a map' as never);

  const good = new Y.Map();
  good.set(COLLECTION_KEYS.titleFieldId, 't');
  const fields = new Y.Map();
  const field = new Y.Map();
  field.set(FIELD_KEYS.name, 'Name');
  field.set(FIELD_KEYS.fieldType, 'text');
  field.set(FIELD_KEYS.idx, 'a1');
  fields.set('t', field);
  good.set(COLLECTION_KEYS.fields, fields);
  root.set('fine', good);

  const parsed = readDocument(doc, 'page-1');
  assert.deepEqual([...parsed.collections.keys()], ['fine']);
  assert.ok(parsed.warnings.some((w) => w.includes('broken')));
});

test('titleFieldId pointing at a missing field is warned about', () => {
  const doc = makeDoc();
  const collection = doc.getMap(DOC_KEYS.collection);
  collection.set(COLLECTION_KEYS.titleFieldId, 'ghost');
  collection.set(COLLECTION_KEYS.fields, new Y.Map());

  const parsed = readDocument(doc, 'page-1');
  assert.ok(parsed.warnings.some((w) => w.includes('not among the fields')));
});

// --- properties ------------------------------------------------------------

test('reads stored property values', () => {
  const doc = makeDoc();
  const props = doc.getMap(DOC_KEYS.properties);
  props.set('f1', { kind: 'text', value: 'Hello' });
  props.set('f2', { kind: 'number', value: 42 });

  const parsed = readDocument(doc, 'page-1');
  assert.equal(parsed.properties.size, 2);
  assert.deepEqual(parsed.properties.get('f1'), { kind: 'text', value: 'Hello' });
});

test('property without a kind is skipped, others survive', () => {
  const doc = makeDoc();
  const props = doc.getMap(DOC_KEYS.properties);
  props.set('bad', { value: 'no kind' });
  props.set('good', { kind: 'text', value: 'kept' });

  const parsed = readDocument(doc, 'page-1');
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
