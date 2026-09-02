/**
 * A page's versions (ADR-0047).
 *
 * The property that matters is the one the record is about: compaction destroys
 * the past, so it must not be able to run without first recording it. That is
 * tested by compacting and then asking what the page said before.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { DOC_KEYS, PAGE_KEYS } from '@sone/core';

import { appendUpdate, compactDoc, loadDoc } from '../src/doc/docStore.js';
import {
  listVersions,
  loadVersion,
  restoreInto,
  thinVersions,
} from '../src/doc/versions.js';
import { closeTestPool, getTestPool, resetDatabase, seedWorkspace } from './support/db.js';

let db: Pool;

before(async () => {
  db = await getTestPool();
  await resetDatabase(db);
});

after(async () => {
  await closeTestPool();
});

/** A page row, with no document yet. Through the shared seed, not by hand. */
async function makePage(): Promise<string> {
  const { workspaceId } = await seedWorkspace(db, 'Versions');
  const page = await db.query<{ id: string }>(
    `INSERT INTO pages (id, workspace_id, idx, title)
     VALUES (gen_random_uuid(), $1, 'a0', 'Draft') RETURNING id`,
    [workspaceId],
  );
  return page.rows[0]!.id;
}

/** Write a title into the page's document, as a client would. */
async function write(pageId: string, title: string): Promise<void> {
  const loaded = await loadDoc(db, pageId);
  try {
    const before_ = Y.encodeStateVector(loaded.doc);
    loaded.doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, title);
    await appendUpdate(db, pageId, Y.encodeStateAsUpdate(loaded.doc, before_), null);
  } finally {
    loaded.doc.destroy();
  }
}

test('compaction cannot run without recording what it is about to destroy', async () => {
  const pageId = await makePage();
  await write(pageId, 'First');
  await write(pageId, 'Second');

  assert.deepEqual(await listVersions(db, pageId), [], 'nothing yet');

  await compactDoc(db, pageId);

  const versions = await listVersions(db, pageId);
  assert.equal(versions.length, 1, 'compaction took one');
  assert.equal(versions[0]?.reason, 'compaction');

  // And the state it recorded is the page as it stood, which is the whole point:
  // the updates it folded in have been deleted by now.
  const left = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
    [pageId],
  );
  assert.equal(left.rows[0]?.n, '0', 'the log is gone');

  const loaded = await loadVersion(db, pageId, versions[0]!.id);
  assert.ok(loaded);
  try {
    assert.equal(loaded.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title), 'Second');
  } finally {
    loaded.doc.destroy();
  }
});

test('a second compaction with nothing in between adds no second version', async () => {
  // Idempotent per sequence: two versions at the same point are the same
  // moment, and a list of identical entries is a list nobody can read.
  const pageId = await makePage();
  await write(pageId, 'Only');
  await compactDoc(db, pageId);
  await compactDoc(db, pageId);

  assert.equal((await listVersions(db, pageId)).length, 1);
});

test('thinning keeps a restore however old it is', async () => {
  // A restore is a fact about what somebody did, not a sample of what the page
  // looked like. Thinning it away would hide the one version whose existence
  // somebody might have to account for.
  const pageId = await makePage();
  await write(pageId, 'Ancient');
  await compactDoc(db, pageId);

  await db.query(
    `UPDATE page_versions SET taken_at = now() - interval '400 days', reason = 'restore'
      WHERE doc_id = $1`,
    [pageId],
  );

  await thinVersions(db);
  const versions = await listVersions(db, pageId);
  assert.equal(versions.length, 1, 'still there');
  assert.equal(versions[0]?.reason, 'restore');
});

test('thinning drops an ordinary version past the window', async () => {
  const pageId = await makePage();
  await write(pageId, 'Ancient');
  await compactDoc(db, pageId);
  await db.query(
    `UPDATE page_versions SET taken_at = now() - interval '400 days' WHERE doc_id = $1`,
    [pageId],
  );

  await thinVersions(db);
  assert.deepEqual(await listVersions(db, pageId), []);
});

test('restoring writes the old state forward and keeps what happened in between', async () => {
  // A CRDT cannot be rewound (ADR-0047), so this is an edit like any other: the
  // restore is in the history, and the state it replaced is recorded before it.
  const pageId = await makePage();
  await write(pageId, 'As it was');
  await compactDoc(db, pageId);

  const [first] = await listVersions(db, pageId);
  assert.ok(first);

  await write(pageId, 'As it became');

  const past = await loadVersion(db, pageId, first.id);
  assert.ok(past);
  try {
    const live = await loadDoc(db, pageId);
    try {
      const before_ = Y.encodeStateVector(live.doc);
      restoreInto(live.doc, past.doc);
      await appendUpdate(db, pageId, Y.encodeStateAsUpdate(live.doc, before_), null);
    } finally {
      live.doc.destroy();
    }
  } finally {
    past.doc.destroy();
  }

  const after = await loadDoc(db, pageId);
  try {
    assert.equal(
      after.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title),
      'As it was',
      'the page reads as it did',
    );
  } finally {
    after.doc.destroy();
  }
});
