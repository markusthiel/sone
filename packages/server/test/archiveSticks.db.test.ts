/**
 * A page put in the trash stays there (ADR-0192).
 *
 * The archive route wrote `archived_at` to the row and nothing to the
 * document. The projection is rebuilt from the document, and the document
 * said "not archived" — so the next materialisation of the page, from a tab
 * still open on it or from the maintenance pass, put it back in the tree.
 * Deleting it again wrote the row again, and it came back again.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { DOC_KEYS, PAGE_KEYS } from '@sone/core';

import { applyToDocument } from '../src/doc/docStore.js';
import { queryOne } from '../src/db/pool.js';
import { setArchivedInDocuments } from '../src/http/pages.js';
import { rematerialize } from '../src/materialize/rematerialize.js';
import { createEntry } from '../src/pages/createEntry.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace } from './support/db.js';

describe('archiving (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let workspaceId: string;
  let userId: string;

  before(async () => {
    db = await getTestPool();
    await resetDatabase(db);
    const seeded = await seedWorkspace(db, 'Trash');
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
  });

  after(async () => {
    await closeTestPool();
  });

  const archivedAt = async (id: string): Promise<Date | null> =>
    (await queryOne<{ archived_at: Date | null }>(db, `SELECT archived_at FROM pages WHERE id = $1`, [id]))!
      .archived_at;

  test('a trashed folder and its pages stay trashed through a rematerialisation, and come back on restore', async () => {
    const folder = await createEntry(db, { workspaceId, kind: 'folder', title: 'Alt', parentPageId: null, actorId: userId });
    const page = await createEntry(db, { workspaceId, kind: 'page', title: 'Notiz', parentPageId: folder.id, actorId: userId });

    // What the archive route does.
    const when = new Date().toISOString();
    await setArchivedInDocuments(db, folder.id, when, userId);
    await db.query(
      `UPDATE pages SET archived_at = $2 WHERE archived_at IS NULL AND (id = $1 OR $1 = ANY(ancestor_ids))`,
      [folder.id, when],
    );
    assert.ok(await archivedAt(page.id), 'in the trash');

    // Somebody still has the page open and types a letter: the document
    // changes and is projected again.
    await applyToDocument(db, page.id, (doc) => doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'Notiz!'), userId);
    await rematerialize(db, page.id, workspaceId, userId);
    await rematerialize(db, folder.id, workspaceId, userId);
    assert.ok(await archivedAt(page.id), 'still in the trash after the page was projected again');
    assert.ok(await archivedAt(folder.id), 'and so is the folder');

    // What the restore route does.
    await setArchivedInDocuments(db, folder.id, null, userId);
    await db.query(
      `UPDATE pages SET archived_at = NULL WHERE archived_at IS NOT NULL AND (id = $1 OR $1 = ANY(ancestor_ids))`,
      [folder.id],
    );
    await rematerialize(db, page.id, workspaceId, userId);
    assert.equal(await archivedAt(page.id), null, 'back, and staying back');
  });
});
