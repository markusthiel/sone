import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { DOC_KEYS, META_KEYS } from '../src/doc/docSchema.js';
import { pageContent, readBlockTree } from '../src/doc/blockTree.js';
import { migrateDocument, isClientSchemaCompatible } from '../src/doc/migrations.js';
import { SCHEMA_VERSION } from '../src/types/ids.js';

test('upgrading a SOTE note preserves every block and excludes stale schema 5 editors', () => {
  const doc = new Y.Doc();
  try {
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 5);
    const task = new Y.XmlElement('soteTasks');
    for (const [key, value] of Object.entries({ id: 'task-block', serverId: 'server', projectId: 'project', taskId: 'task', mode: 'single' })) task.setAttribute(key, value);
    const paragraph = new Y.XmlElement('paragraph'); paragraph.setAttribute('id', 'writing');
    const text = new Y.XmlText(); text.insert(0, 'Keep this note'); paragraph.insert(0, [text]);
    pageContent(doc).insert(0, [task, paragraph]);
    const before = readBlockTree(doc);
    assert.equal(migrateDocument(doc).to, SCHEMA_VERSION);
    assert.deepEqual(readBlockTree(doc), before);
    assert.equal(migrateDocument(doc).changed, false);
    assert.equal(isClientSchemaCompatible(5), false);
    assert.equal(isClientSchemaCompatible(SCHEMA_VERSION), true);
  } finally { doc.destroy(); }
});
