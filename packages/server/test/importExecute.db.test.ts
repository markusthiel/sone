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
import { LocalFileStore } from '../src/files/store.js';
import { loadDoc } from '../src/doc/docStore.js';
import { readDocument } from '../src/materialize/readDocument.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { DOC_KEYS } from '@sone/core';
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

  test('an entry arrives with the symbol and colours it left with (ADR-0190)', async () => {
    const destination = await createEntry(db, {
      workspaceId,
      kind: 'folder',
      title: 'Look',
      parentPageId: null,
      actorId: userId,
    });
    const icon = {
      kind: 'icon',
      value: 'rocket',
      color: 'blue',
      titleColor: '#aa1122',
    };
    const entries = unzip(
      zip([
        { name: 'Bunt/index.md', body: Buffer.from(pageToMarkdown('Bunt', [], { icon })), at },
        {
          name: 'Bunt/Seite.md',
          body: Buffer.from(
            pageToMarkdown('Seite', [{ id: 'a', parentId: null, type: 'paragraph', plainText: 'Hi', props: {} }], {
              icon: { kind: 'icon', value: 'star' },
            }),
          ),
          at,
        },
      ]),
    );
    const result = await executePlan(db, planImport(entries, { byPath: new Map() }), {
      workspaceId,
      parentPageId: destination.id,
      actorId: userId,
      onCollision: 'skip',
    });
    assert.deepEqual(result.failed, []);

    const rows = await queryRows<{ title: string; icon: unknown }>(
      db,
      `SELECT title, icon FROM pages WHERE parent_page_id = $1 OR parent_page_id IN
         (SELECT id FROM pages WHERE parent_page_id = $1) ORDER BY title`,
      [destination.id],
    );
    assert.deepEqual(rows, [
      { title: 'Bunt', icon },
      { title: 'Seite', icon: { kind: 'icon', value: 'star' } },
    ]);
  });

  test('a picture, a heading, a task and bold words arrive as themselves, and export again (ADR-0191)', async () => {
    const destination = await createEntry(db, {
      workspaceId,
      kind: 'folder',
      title: 'Alles',
      parentPageId: null,
      actorId: userId,
    });
    // A one-pixel PNG: the eight-byte signature is what the type detector reads.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const fileId = '11111111-1111-4111-8111-111111111111';
    const body = pageToMarkdown('Bunt', [
      { id: 'a', parentId: null, type: 'heading', plainText: 'Kapitel', props: { level: 3 } },
      { id: 'b', parentId: null, type: 'paragraph', plainText: 'Fett und Link', markdown: '**Fett** und [Link](https://example.org)', props: { color: 'blue' } },
      { id: 'c', parentId: null, type: 'todo', plainText: 'Erledigt', props: { checked: true } },
      { id: 'd', parentId: null, type: 'image', plainText: '', props: { alt: 'Punkt', url: `/api/files/${fileId}` } },
      { id: 'e', parentId: null, type: 'code', plainText: 'x = 1', props: { language: 'py' } },
    ]);
    const entries = unzip(
      zip([
        { name: 'Seite.md', body: Buffer.from(body), at },
        { name: `attachments/${fileId}`, body: png, at },
      ]),
    );
    const store = new LocalFileStore(mkdtempSync(path.join(tmpdir(), 'sone-import-')));
    const result = await executePlan(db, planImport(entries, { byPath: new Map() }), {
      workspaceId,
      parentPageId: destination.id,
      actorId: userId,
      onCollision: 'skip',
      store,
      attachments: new Map([[fileId, png]]),
    });
    assert.deepEqual(result.failed, []);
    const pageId = result.created[0]!;

    // The document, as the editor would build it: attributes on the elements.
    const loaded = await loadDoc(db, pageId);
    try {
      const elements = loaded.doc.getXmlFragment(DOC_KEYS.content).toArray() as Y.XmlElement[];
      const byType = (type: string) => elements.find((el) => el.nodeName === type)!;
      assert.strictEqual(byType('heading').getAttribute('level'), 3 as unknown as string, 'a number, as the editor writes it');
      assert.strictEqual(byType('todo').getAttribute('checked'), true as unknown as string);
      assert.equal(byType('code').getAttribute('language'), 'py');
      assert.equal(byType('paragraph').getAttribute('color'), 'blue');
      const url = byType('image').getAttribute('url');
      assert.match(String(url), /^\/api\/files\/[0-9a-f-]{36}$/, 'the picture points at the copy stored here');
      assert.notEqual(url, `/api/files/${fileId}`);
      const words = byType('paragraph').get(0) as Y.XmlText;
      assert.deepEqual(words.toDelta(), [
        { insert: 'Fett', attributes: { strong: {} } },
        { insert: ' und ' },
        { insert: 'Link', attributes: { link: { href: 'https://example.org', title: null } } },
      ]);

      // And out again: the projection reads the marks back into Markdown.
      const parsed = readDocument(loaded.doc, pageId);
      const paragraph = parsed.blocks.find((one) => one.type === 'paragraph')!;
      assert.equal(paragraph.markdown, '**Fett** und [Link](https://example.org)');
      assert.equal(paragraph.plainText, 'Fett und Link');
    } finally {
      loaded.doc.destroy();
    }
  });

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
