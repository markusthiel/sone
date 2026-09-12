/**
 * Carrying out an import plan (ADR-0044).
 *
 * The test that earns its keep is the whole loop: export a subtree, import the
 * archive back into another folder, and find the same pages with the same
 * words. Anything less proves the parts and not the promise.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';

import { pageToMarkdown } from '../src/export/markdown.js';
import { zip } from '../src/export/zip.js';
import { executePlan } from '../src/import/execute.js';
import { planImport } from '../src/import/plan.js';
import { unzip } from '../src/import/unzip.js';
import { createEntry } from '../src/pages/createEntry.js';
import { queryRows } from '../src/db/pool.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace } from './support/db.js';


describe('import execution (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let workspaceId: string;
  let userId: string;

  before(async () => {
    db = await getTestPool();
    await resetDatabase(db);
    const seeded = await seedWorkspace(db, 'Import');
    workspaceId = seeded.workspaceId;
    userId = seeded.userId;
  });

  after(async () => {
    await closeTestPool();
  });

  const at = new Date('2026-09-02T10:00:00Z');

  /** An archive shaped the way our own export writes one. */
  function archive(): ReturnType<typeof unzip> {
    const notes = pageToMarkdown('Notizen', [
      { id: 'a', parentId: null, type: 'paragraph', plainText: 'Erste Zeile.', props: {} },
      { id: 'b', parentId: null, type: 'heading', plainText: 'Ein Titel', props: { level: 1 } },
      { id: 'c', parentId: null, type: 'todo', plainText: 'Erledigt', props: { checked: true } },
    ]);

    return unzip(
      zip([
        { name: 'Ordner/index.md', body: Buffer.from('# Ordner\n'), at },
        { name: 'Ordner/Notizen.md', body: Buffer.from(notes), at },
      ]),
    );
  }

  test('an archive becomes pages, and the words survive the trip', async () => {
    const destination = await createEntry(db, {
      workspaceId,
      kind: 'folder',
      title: 'Ziel',
      parentPageId: null,
      actorId: userId,
    });

    const plan = planImport(archive(), { byPath: new Map() });
    const result = await executePlan(db, plan, {
      workspaceId,
      parentPageId: destination.id,
      actorId: userId,
      onCollision: 'skip',
    });

    assert.deepEqual(result.failed, [], 'nothing failed');
    assert.equal(result.created.length, 2, 'a folder and a page');

    const pages = await queryRows<{ title: string; kind: string; parent_page_id: string }>(
      db,
      `SELECT title, kind, parent_page_id FROM pages
        WHERE workspace_id = $1 AND $2 = ANY(ancestor_ids)
        ORDER BY kind, title`,
      [workspaceId, destination.id],
    );
    assert.deepEqual(
      pages.map((page) => [page.kind, page.title]),
      [
        ['folder', 'Ordner'],
        ['page', 'Notizen'],
      ],
    );

    // The blocks, from the projection — which is the thing every other feature
    // reads, so checking it checks the import as the rest of the application sees
    // it.
    const blocks = await queryRows<{ type: string; plain_text: string; props: unknown }>(
      db,
      `SELECT b.type, b.plain_text, b.props
         FROM blocks b JOIN pages p ON p.id = b.page_id
        WHERE p.title = 'Notizen' AND p.workspace_id = $1
        ORDER BY b.idx`,
      [workspaceId],
    );
    assert.deepEqual(
      blocks.map((block) => [block.type, block.plain_text]),
      [
        ['paragraph', 'Erste Zeile.'],
        ['heading', 'Ein Titel'],
        ['todo', 'Erledigt'],
      ],
    );
    // And the properties that decide how a block reads.
    assert.deepEqual(blocks[1]?.props, { level: 1 });
    assert.deepEqual(blocks[2]?.props, { checked: true });
  });

  test('a name that already exists is left alone, and its children still land in it', async () => {
    // The case that would otherwise orphan a page or create a second folder of
    // the same name beside the first.
    const destination = await createEntry(db, {
      workspaceId,
      kind: 'folder',
      title: 'Zweites Ziel',
      parentPageId: null,
      actorId: userId,
    });
    const existing = await createEntry(db, {
      workspaceId,
      kind: 'folder',
      title: 'Ordner',
      parentPageId: destination.id,
      actorId: userId,
    });

    const plan = planImport(archive(), { byPath: new Map([['ordner', existing.id]]) });
    const result = await executePlan(db, plan, {
      workspaceId,
      parentPageId: destination.id,
      actorId: userId,
      onCollision: 'skip',
    });

    assert.deepEqual(result.collided, ['Ordner']);
    assert.deepEqual(result.failed, []);
    assert.equal(result.created.length, 1, 'only the page inside it');

    const inside = await queryRows<{ title: string }>(
      db,
      `SELECT title FROM pages WHERE parent_page_id = $1`,
      [existing.id],
    );
    assert.deepEqual(
      inside.map((page) => page.title),
      ['Notizen'],
      'the page went into the folder that was already there',
    );
  });

  test('a page whose folder never arrived is reported, not put somewhere plausible', async () => {
    // An import that quietly reparents pages is one whose result nobody can check
    // against the archive.
    const destination = await createEntry(db, {
      workspaceId,
      kind: 'folder',
      title: 'Drittes Ziel',
      parentPageId: null,
      actorId: userId,
    });

    // A plan with a page but no folder for it, which `planImport` would not
    // produce — built by hand, because the executor must not assume its input is
    // the only shape a plan can have.
    const result = await executePlan(
      db,
      {
        pages: [
          {
            path: ['Fehlt', 'Seite'],
            title: 'Seite',
            isFolder: false,
            markdown: 'Text.\n',
            collidesWith: null,
          },
        ],
        attachments: [],
        skipped: [],
        totals: { pages: 1, folders: 0, attachments: 0, bytes: 0 },
      },
      { workspaceId, parentPageId: destination.id, actorId: userId, onCollision: 'skip' },
    );

    assert.deepEqual(result.created, []);
    assert.deepEqual(result.failed, [{ path: 'Fehlt/Seite', error: 'parent_missing' }]);
  });
});
