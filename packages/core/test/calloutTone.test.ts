import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { CALLOUT_TONES, DOC_KEYS, META_KEYS } from '../src/doc/docSchema.js';
import { pageContent, readBlockTree } from '../src/doc/blockTree.js';
import { migrateDocument, isClientSchemaCompatible } from '../src/doc/migrations.js';
import { SCHEMA_VERSION } from '../src/types/ids.js';

test('upgrading a page with a toned callout and a sourced quote keeps both and excludes schema 6 editors', () => {
  const doc = new Y.Doc();
  try {
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 6);
    const callout = new Y.XmlElement('callout');
    for (const [key, value] of Object.entries({ id: 'warn', tone: 'warning' })) callout.setAttribute(key, value);
    const words = new Y.XmlText(); words.insert(0, 'Mind the gap'); callout.insert(0, [words]);
    const quote = new Y.XmlElement('quote');
    for (const [key, value] of Object.entries({ id: 'said', source: 'Somebody, 1999' })) quote.setAttribute(key, value);
    const said = new Y.XmlText(); said.insert(0, 'Less is more'); quote.insert(0, [said]);
    pageContent(doc).insert(0, [callout, quote]);
    const before = readBlockTree(doc);
    assert.equal(migrateDocument(doc).to, SCHEMA_VERSION);
    assert.deepEqual(readBlockTree(doc), before);
    assert.equal(migrateDocument(doc).changed, false);
    assert.equal(isClientSchemaCompatible(6), false);
    assert.equal(isClientSchemaCompatible(SCHEMA_VERSION), true);
  } finally { doc.destroy(); }
});

test('note is the first tone, so a callout without one has a name', () => {
  assert.equal(CALLOUT_TONES[0], 'note');
  assert.equal(new Set(CALLOUT_TONES).size, CALLOUT_TONES.length);
});
