/**
 * Moving a folder rewrites the ancestor path of *every* descendant, not only
 * the children.
 *
 * The cascade used to look each descendant's path up from its parent's row
 * inside one UPDATE, which sees the table as it was when the statement began:
 * children read the moved page's fresh path, grandchildren read their parent's
 * stale one. A workspace imported under an "Import" folder and then sorted
 * out of it kept that folder as an ancestor of every page two levels down —
 * and trashing the empty folder archived them all, because archiving a folder
 * takes everything whose ancestor_ids name it.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { DOC_KEYS, PAGE_KEYS } from '@sone/core';

import { applyToDocument } from '../src/doc/docStore.js';
import { queryOne, queryRows } from '../src/db/pool.js';
import { rematerialize } from '../src/materialize/rematerialize.js';
import { createEntry } from '../src/pages/createEntry.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace } from './support/db.js';

describe('moving a folder (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let workspaceId: string;
  let userId: string;

  before(async () => {
    db = await getTestPool();
    await resetDatabase(db);
    const seeded = await seedWorkspace(db, 'Move');
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
  });

  after(async () => {
    await closeTestPool();
  });

  const folder = (title: string, parentPageId: string | null) =>
    createEntry(db, { workspaceId, kind: 'folder', title, parentPageId, actorId: userId });
  const page = (title: string, parentPageId: string) =>
    createEntry(db, { workspaceId, kind: 'page', title, parentPageId, actorId: userId });

  const ancestors = async (id: string): Promise<string[]> =>
    (await queryOne<{ ancestor_ids: string[] }>(db, `SELECT ancestor_ids FROM pages WHERE id = $1`, [id]))!
      .ancestor_ids;

  test('every level below the moved folder gets the new path, and the old folder can be trashed', async () => {
    // Import/Projekte/Messe/Spielemesse/Stand — the shape an import into a
    // holding folder produces, four levels deep.
    const holding = await folder('Import', null);
    const projekte = await folder('Projekte', holding.id);
    const messe = await folder('Messe', projekte.id);
    const spielemesse = await folder('Spielemesse', messe.id);
    const stand = await page('Stand', spielemesse.id);

    assert.deepEqual(await ancestors(stand.id), [holding.id, projekte.id, messe.id, spielemesse.id]);

    // Projekte out of Import, to the root — what the move route writes.
    await applyToDocument(
      db,
      projekte.id,
      (doc) => {
        doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.parentPageId, null);
      },
      userId,
    );
    await rematerialize(db, projekte.id, workspaceId, userId);

    assert.deepEqual(await ancestors(projekte.id), []);
    assert.deepEqual(await ancestors(messe.id), [projekte.id], 'the child');
    assert.deepEqual(await ancestors(spielemesse.id), [projekte.id, messe.id], 'the grandchild');
    assert.deepEqual(
      await ancestors(stand.id),
      [projekte.id, messe.id, spielemesse.id],
      'and the great-grandchild: nobody below still names Import',
    );

    // Trashing the now-empty holding folder, the way the archive route does.
    await db.query(
      `UPDATE pages SET archived_at = now()
        WHERE archived_at IS NULL AND (id = $1 OR $1 = ANY(ancestor_ids))`,
      [holding.id],
    );
    const archived = await queryRows<{ title: string }>(
      db,
      `SELECT title FROM pages WHERE workspace_id = $1 AND archived_at IS NOT NULL ORDER BY title`,
      [workspaceId],
    );
    assert.deepEqual(
      archived.map((row) => row.title),
      ['Import'],
      'only the folder that was trashed',
    );
  });
});
