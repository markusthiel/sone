/**
 * Materialiser write-path tests.
 *
 * Requires a real Postgres (see test/support/db.ts). These cover the parts
 * that cannot be tested without one: bulk inserts via unnest, the recursive
 * CTE behind the ancestor cascade, ON CONFLICT upserts, tsvector search, and
 * idempotency of the full-replace strategy from ADR-0008.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  COLLECTION_KEYS,
  DOC_KEYS,
  FIELD_KEYS,
  META_KEYS,
  PAGE_KEYS,
  appendBlocks,
  pageContent,
  readBlockTree,
  type NewBlock,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { rebuild } from '../src/materialize/rebuild.js';
import { appendUpdate, compactDoc, loadDoc } from '../src/doc/docStore.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

describe('materialiser (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let fx: Fixture;

  before(async () => {
    db = await getTestPool();
  });

  after(async () => {
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(db);
    fx = await seedWorkspace(db);
  });

  // --- helpers -------------------------------------------------------------

  function pageDoc(opts: {
    title: string;
    idx?: string;
    parentPageId?: string | null;
    collectionId?: string | null;
    /** 'row' for a record inside a collection (ADR-0021). */
    kind?: 'page' | 'folder' | 'row';
  }): Y.Doc {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, opts.title);
    page.set(PAGE_KEYS.idx, opts.idx ?? 'a0');
    page.set(PAGE_KEYS.parentPageId, opts.parentPageId ?? null);
    page.set(PAGE_KEYS.collectionId, opts.collectionId ?? null);
    if (opts.kind) page.set(PAGE_KEYS.kind, opts.kind);
    return doc;
  }

  function addBlock(doc: Y.Doc, id: string, text: string): void {
    appendBlocks(doc, [{ id, type: 'paragraph', text } satisfies NewBlock]);
  }

  const project = (pageId: string, doc: Y.Doc, throughSeq = 1) =>
    withTransaction(db, (client) =>
      materializeYDoc(client, pageId, doc, {
        throughSeq,
        workspaceId: fx.workspaceId,
        actorId: fx.userId,
      }),
    );

  // --- basics --------------------------------------------------------------

  test('projects a page and its blocks', async () => {
    const pageId = uuid(1);
    const doc = pageDoc({ title: 'Hello world' });
    addBlock(doc, uuid(11), 'first paragraph');
    addBlock(doc, uuid(12), 'second paragraph');

    const result = await project(pageId, doc);
    assert.equal(result.blockCount, 2);

    const page = await db.query(`SELECT title, workspace_id FROM pages WHERE id = $1`, [
      pageId,
    ]);
    assert.equal(page.rows[0]!.title, 'Hello world');
    assert.equal(page.rows[0]!.workspace_id, fx.workspaceId);

    const blocks = await db.query(
      `SELECT id, plain_text FROM blocks WHERE page_id = $1 ORDER BY idx, id`,
      [pageId],
    );
    assert.deepEqual(
      blocks.rows.map((r) => r.plain_text),
      ['first paragraph', 'second paragraph'],
    );
  });

  test('is idempotent: running twice yields identical rows', async () => {
    // The central promise of ADR-0008.
    const pageId = uuid(1);
    const doc = pageDoc({ title: 'Stable' });
    addBlock(doc, uuid(11), 'content');

    await project(pageId, doc);
    const first = await db.query(
      `SELECT id, type, idx, props, plain_text FROM blocks WHERE page_id = $1 ORDER BY id`,
      [pageId],
    );

    await project(pageId, doc);
    const second = await db.query(
      `SELECT id, type, idx, props, plain_text FROM blocks WHERE page_id = $1 ORDER BY id`,
      [pageId],
    );

    assert.deepEqual(second.rows, first.rows);
  });

  test('removed blocks disappear from the projection', async () => {
    // The failure mode full replace exists to prevent: a diffing
    // implementation leaves ghost rows that show up in views.
    const pageId = uuid(1);
    const doc = pageDoc({ title: 'Shrinking' });
    addBlock(doc, uuid(11), 'kept');
    addBlock(doc, uuid(12), 'removed');
    await project(pageId, doc);

    // Remove the second block from the page body.
    const fragment = pageContent(doc);
    fragment.delete(1, 1);
    await project(pageId, doc, 2);

    const blocks = await db.query(`SELECT id FROM blocks WHERE page_id = $1`, [pageId]);
    assert.equal(blocks.rows.length, 1);
    assert.equal(blocks.rows[0]!.id, uuid(11));
  });

  test('bulk insert handles many blocks in one statement', async () => {
    const pageId = uuid(1);
    const doc = pageDoc({ title: 'Large' });
    for (let i = 0; i < 1500; i++) {
      addBlock(doc, uuid(1000 + i), `line ${i}`);
    }
    const result = await project(pageId, doc);
    assert.equal(result.blockCount, 1500);

    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM blocks WHERE page_id = $1`,
      [pageId],
    );
    assert.equal(count.rows[0]!.n, '1500');
  });

  // --- ancestors -----------------------------------------------------------

  test('ancestor path is built from the parent chain', async () => {
    const root = uuid(1);
    const child = uuid(2);
    const grandchild = uuid(3);

    await project(root, pageDoc({ title: 'Root' }));
    await project(child, pageDoc({ title: 'Child', parentPageId: root }));
    await project(grandchild, pageDoc({ title: 'Grandchild', parentPageId: child }));

    const rows = await db.query<{ id: string; ancestor_ids: string[] }>(
      `SELECT id, ancestor_ids FROM pages ORDER BY array_length(ancestor_ids, 1) NULLS FIRST`,
      [],
    );
    assert.deepEqual(rows.rows[0]!.ancestor_ids, []);
    assert.deepEqual(rows.rows[1]!.ancestor_ids, [root]);
    assert.deepEqual(rows.rows[2]!.ancestor_ids, [root, child]);
  });

  test('subtree containment query finds descendants', async () => {
    // This is the query share-link scope checks depend on (ADR-0006).
    const root = uuid(1);
    const child = uuid(2);
    const grandchild = uuid(3);
    const unrelated = uuid(4);

    await project(root, pageDoc({ title: 'Root' }));
    await project(child, pageDoc({ title: 'Child', parentPageId: root }));
    await project(grandchild, pageDoc({ title: 'Grandchild', parentPageId: child }));
    await project(unrelated, pageDoc({ title: 'Elsewhere' }));

    const inScope = await db.query<{ id: string }>(
      `SELECT id FROM pages WHERE $1 = ANY(ancestor_ids) OR id = $1 ORDER BY id`,
      [root],
    );
    assert.deepEqual(
      inScope.rows.map((r) => r.id),
      [root, child, grandchild].sort(),
    );
  });

  test('moving a page rewrites descendants ancestor paths', async () => {
    const a = uuid(1);
    const b = uuid(2);
    const child = uuid(3);
    const grandchild = uuid(4);

    await project(a, pageDoc({ title: 'A' }));
    await project(b, pageDoc({ title: 'B' }));
    await project(child, pageDoc({ title: 'Child', parentPageId: a }));
    await project(grandchild, pageDoc({ title: 'Grandchild', parentPageId: child }));

    // Move child from A to B.
    const moved = pageDoc({ title: 'Child', parentPageId: b });
    const result = await project(child, moved, 5);

    assert.ok(
      result.cascade.includes(grandchild),
      'grandchild must be queued for re-projection',
    );

    const rows = await db.query<{ ancestor_ids: string[] }>(
      `SELECT ancestor_ids FROM pages WHERE id = $1`,
      [grandchild],
    );
    assert.deepEqual(
      rows.rows[0]!.ancestor_ids,
      [b, child],
      'cascade must have rewritten the grandchild path',
    );
  });

  test('parent not yet materialised yields a provisional path and a warning', async () => {
    const orphan = uuid(2);
    const result = await project(
      orphan,
      pageDoc({ title: 'Orphan', parentPageId: uuid(99) }),
    );
    assert.ok(result.warnings.some((w) => w.includes('not materialised yet')));

    const rows = await db.query<{ ancestor_ids: string[] }>(
      `SELECT ancestor_ids FROM pages WHERE id = $1`,
      [orphan],
    );
    assert.deepEqual(rows.rows[0]!.ancestor_ids, [uuid(99)]);
  });

  test('a page made its own parent keeps its parent, and does not hang (ADR-0182)', async () => {
    // A client can set `parentPageId` to the page's own id over Yjs, which the
    // HTTP move refuses. This used to null the ancestors but write the cyclic
    // parent anyway, and the cascade then recursed on a page that was its own
    // child — an unbounded query holding a connection. The parent must be
    // refused: the row keeps the parent it had.
    const parent = uuid(1);
    const child = uuid(2);
    await project(parent, pageDoc({ title: 'Parent' }));
    await project(child, pageDoc({ title: 'Child', parentPageId: parent }));

    const result = await project(child, pageDoc({ title: 'Child', parentPageId: child }), 5);
    assert.ok(result.warnings.some((w) => w.includes('cycle detected')));

    const rows = await db.query<{ parent_page_id: string | null; ancestor_ids: string[] }>(
      `SELECT parent_page_id, ancestor_ids FROM pages WHERE id = $1`,
      [child],
    );
    assert.equal(rows.rows[0]!.parent_page_id, parent, 'the cyclic parent must not be written');
    assert.deepEqual(rows.rows[0]!.ancestor_ids, [parent]);
  });

  test('a parent in another workspace is refused (ADR-0182)', async () => {
    // A page never changes workspace, so a `parentPageId` pointing into another
    // one is not a move the API can make. Adopting it would fill `ancestor_ids`
    // with ids from a tree this workspace has no business in.
    const other = await seedWorkspace(db, 'Other workspace');
    const foreignParent = uuid(50);
    await withTransaction(db, (client) =>
      materializeYDoc(client, foreignParent, pageDoc({ title: 'Foreign' }), {
        throughSeq: 1,
        workspaceId: other.workspaceId,
        actorId: other.userId,
      }),
    );

    const here = uuid(1);
    const result = await project(here, pageDoc({ title: 'Here', parentPageId: foreignParent }), 2);
    assert.ok(result.warnings.some((w) => w.includes('another workspace')));

    const rows = await db.query<{ parent_page_id: string | null; ancestor_ids: string[] }>(
      `SELECT parent_page_id, ancestor_ids FROM pages WHERE id = $1`,
      [here],
    );
    assert.equal(rows.rows[0]!.parent_page_id, null, 'a foreign parent must not be written');
    assert.deepEqual(rows.rows[0]!.ancestor_ids, []);
  });

  // --- collections ---------------------------------------------------------

  async function seedCollection(pageId: string, collectionId: string) {
    const doc = pageDoc({ title: 'Tasks', collectionId });
    const collection = doc.getMap(DOC_KEYS.collection);
    collection.set(COLLECTION_KEYS.titleFieldId, uuid(50));

    const fields = new Y.Map();
    const name = new Y.Map();
    name.set(FIELD_KEYS.name, 'Name');
    name.set(FIELD_KEYS.fieldType, 'text');
    name.set(FIELD_KEYS.idx, 'a1');
    fields.set(uuid(50), name);

    const status = new Y.Map();
    status.set(FIELD_KEYS.name, 'Status');
    status.set(FIELD_KEYS.fieldType, 'select');
    status.set(FIELD_KEYS.idx, 'a2');
    const config = new Y.Map();
    config.set('options', [
      { id: 'o-todo', name: 'Todo', color: 'gray' },
      { id: 'o-done', name: 'Done', color: 'green' },
    ]);
    status.set(FIELD_KEYS.config, config);
    fields.set(uuid(51), status);

    collection.set(COLLECTION_KEYS.fields, fields);
    await project(pageId, doc);
    return doc;
  }

  test('projects a collection definition with its fields', async () => {
    const pageId = uuid(1);
    await seedCollection(pageId, pageId);

    const fields = await db.query<{ name: string; field_type: string }>(
      `SELECT name, field_type FROM collection_fields WHERE collection_id = $1 ORDER BY idx, id`,
      [pageId],
    );
    assert.deepEqual(
      fields.rows.map((r) => r.name),
      ['Name', 'Status'],
    );
  });

  test('row properties get typed shadow columns from the collection schema', async () => {
    const collectionPage = uuid(1);
    await seedCollection(collectionPage, collectionPage);

    const rowId = uuid(2);
    const row = pageDoc({
      title: 'Buy milk',
      parentPageId: collectionPage,
      collectionId: collectionPage,
    });
    row.getMap(DOC_KEYS.properties).set(uuid(50), { kind: 'text', value: 'Buy milk' });
    row.getMap(DOC_KEYS.properties).set(uuid(51), { kind: 'select', optionId: 'o-done' });
    await project(rowId, row);

    const props = await db.query<{
      field_id: string;
      text_value: string | null;
    }>(
      `SELECT field_id, text_value FROM page_properties WHERE page_id = $1 ORDER BY field_id`,
      [rowId],
    );
    assert.equal(props.rows.length, 2);

    const status = props.rows.find((r) => r.field_id === uuid(51))!;
    // 'o-done' is the second option, so its sort key encodes position 1.
    assert.equal(status.text_value, '000001');
  });

  test('select sorting follows option order, not option id', async () => {
    const collectionPage = uuid(1);
    await seedCollection(collectionPage, collectionPage);

    for (const [n, option] of [
      [10, 'o-done'],
      [11, 'o-todo'],
    ] as const) {
      const row = pageDoc({
        title: `Row ${n}`,
        parentPageId: collectionPage,
        collectionId: collectionPage,
      });
      row.getMap(DOC_KEYS.properties).set(uuid(51), { kind: 'select', optionId: option });
      await project(uuid(n), row);
    }

    const sorted = await db.query<{ page_id: string }>(
      `SELECT p.page_id
         FROM page_properties p
        WHERE p.field_id = $1
        ORDER BY p.text_value ASC`,
      [uuid(51)],
    );
    // Todo (position 0) must come before Done (position 1), even though
    // 'o-done' < 'o-todo' alphabetically.
    assert.deepEqual(
      sorted.rows.map((r) => r.page_id),
      [uuid(11), uuid(10)],
    );
  });

  test('changing a field cascades re-projection to every row', async () => {
    const collectionPage = uuid(1);
    const doc = await seedCollection(collectionPage, collectionPage);

    const rowId = uuid(2);
    // A row carries kind 'row': that is what puts collection_id on its page
    // row, and the cascade finds rows by exactly that (ADR-0021).
    const row = pageDoc({
      title: 'Row',
      kind: 'row',
      parentPageId: collectionPage,
      collectionId: collectionPage,
    });
    row.getMap(DOC_KEYS.properties).set(uuid(51), { kind: 'select', optionId: 'o-todo' });
    await project(rowId, row);

    // Reorder the options: every row's sort key is now wrong.
    const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields) as Y.Map<unknown>;
    const status = fields.get(uuid(51)) as Y.Map<unknown>;
    (status.get(FIELD_KEYS.config) as Y.Map<unknown>).set('options', [
      { id: 'o-done', name: 'Done', color: 'green' },
      { id: 'o-todo', name: 'Todo', color: 'gray' },
    ]);

    const result = await project(collectionPage, doc, 10);
    assert.ok(result.cascade.includes(rowId), 'row must be queued for re-projection');
  });

  test('deleting a field removes its stored values', async () => {
    const collectionPage = uuid(1);
    const doc = await seedCollection(collectionPage, collectionPage);

    const rowId = uuid(2);
    // A row carries kind 'row': that is what puts collection_id on its page
    // row, and the cascade finds rows by exactly that (ADR-0021).
    const row = pageDoc({
      title: 'Row',
      kind: 'row',
      parentPageId: collectionPage,
      collectionId: collectionPage,
    });
    row.getMap(DOC_KEYS.properties).set(uuid(51), { kind: 'select', optionId: 'o-todo' });
    await project(rowId, row);

    const before = await db.query(`SELECT 1 FROM page_properties WHERE page_id = $1`, [
      rowId,
    ]);
    assert.equal(before.rows.length, 1);

    // Remove the Status field from the definition.
    const fields = doc.getMap(DOC_KEYS.collection).get(COLLECTION_KEYS.fields) as Y.Map<unknown>;
    fields.delete(uuid(51));
    await project(collectionPage, doc, 10);

    // The FK cascade must have taken the orphaned value with it, otherwise
    // page_properties accumulates rows no view can reach.
    const remaining = await db.query(`SELECT 1 FROM page_properties WHERE page_id = $1`, [
      rowId,
    ]);
    assert.equal(remaining.rows.length, 0);
  });

  test('property for an unknown field is stored without sort columns', async () => {
    const rowId = uuid(2);
    const row = pageDoc({ title: 'Row', collectionId: uuid(99) });
    row.getMap(DOC_KEYS.properties).set(uuid(50), { kind: 'text', value: 'value' });
    const result = await project(rowId, row);

    assert.ok(result.warnings.some((w) => w.includes('unknown')));
    const props = await db.query<{ text_value: string | null; value: unknown }>(
      `SELECT text_value, value FROM page_properties WHERE page_id = $1`,
      [rowId],
    );
    assert.equal(props.rows[0]!.text_value, null, 'no sort column without a schema');
    assert.deepEqual(props.rows[0]!.value, { kind: 'text', value: 'value' });
  });

  // --- relations -----------------------------------------------------------

  test('relations are stored one-way and the inverse is queryable', async () => {
    const collectionPage = uuid(1);
    await seedCollection(collectionPage, collectionPage);

    const target = uuid(3);
    await project(target, pageDoc({ title: 'Target' }));

    const source = uuid(2);
    const row = pageDoc({ title: 'Source', collectionId: collectionPage });
    row.getMap(DOC_KEYS.properties).set(uuid(50), {
      kind: 'relation',
      pageIds: [target],
    });
    await project(source, row);

    const forward = await db.query(
      `SELECT to_page_id FROM page_relations WHERE from_page_id = $1`,
      [source],
    );
    assert.deepEqual(
      forward.rows.map((r) => r.to_page_id),
      [target],
    );

    // The inverse direction is a query, never a second stored list (ADR-0002).
    const inverse = await db.query(
      `SELECT from_page_id FROM page_relations WHERE to_page_id = $1`,
      [target],
    );
    assert.deepEqual(
      inverse.rows.map((r) => r.from_page_id),
      [source],
    );
  });

  test('relation targets that do not exist yet are omitted, not fatal', async () => {
    const collectionPage = uuid(1);
    await seedCollection(collectionPage, collectionPage);

    const source = uuid(2);
    const row = pageDoc({ title: 'Source', collectionId: collectionPage });
    row.getMap(DOC_KEYS.properties).set(uuid(50), {
      kind: 'relation',
      pageIds: [uuid(3), uuid(4)],
    });
    const result = await project(source, row);

    assert.ok(result.warnings.some((w) => w.includes('not yet materialised')));
    const rows = await db.query(`SELECT 1 FROM page_relations WHERE from_page_id = $1`, [
      source,
    ]);
    assert.equal(rows.rows.length, 0);

    // The value itself survives in jsonb so nothing is lost.
    const props = await db.query<{ value: { pageIds: string[] } }>(
      `SELECT value FROM page_properties WHERE page_id = $1`,
      [source],
    );
    assert.deepEqual(props.rows[0]!.value.pageIds, [uuid(3), uuid(4)]);
  });

  // --- search --------------------------------------------------------------

  test('search index finds a page by block content', async () => {
    const pageId = uuid(1);
    const doc = pageDoc({ title: 'Meeting notes' });
    addBlock(doc, uuid(11), 'discussed the quarterly budget');
    await project(pageId, doc);

    const hits = await db.query<{ page_id: string }>(
      `SELECT page_id FROM page_search
        WHERE workspace_id = $1 AND tsv @@ to_tsquery('simple', 'quarterly')`,
      [fx.workspaceId],
    );
    assert.deepEqual(
      hits.rows.map((r) => r.page_id),
      [pageId],
    );
  });

  test('title matches rank above body matches', async () => {
    const titled = uuid(1);
    const mentioned = uuid(2);

    await project(titled, pageDoc({ title: 'Budget' }));
    const other = pageDoc({ title: 'Notes' });
    addBlock(other, uuid(11), 'budget was mentioned in passing');
    await project(mentioned, other);

    const hits = await db.query<{ page_id: string }>(
      `SELECT page_id, ts_rank(tsv, to_tsquery('simple', 'budget')) AS rank
         FROM page_search
        WHERE tsv @@ to_tsquery('simple', 'budget')
        ORDER BY rank DESC`,
      [],
    );
    assert.equal(hits.rows[0]!.page_id, titled, 'weight A must outrank weight D');
  });

  // --- bookkeeping ---------------------------------------------------------

  test('materialisation state records the projected sequence', async () => {
    const pageId = uuid(1);
    await project(pageId, pageDoc({ title: 'Tracked' }), 42);

    const state = await db.query<{ through_seq: string; status: string }>(
      `SELECT through_seq, status FROM materialization_state WHERE page_id = $1`,
      [pageId],
    );
    assert.equal(state.rows[0]!.through_seq, '42');
    assert.equal(state.rows[0]!.status, 'ok');
  });

  // --- document store ------------------------------------------------------

  test('updates round-trip through the append-only log', async () => {
    const pageId = uuid(1);
    await project(pageId, pageDoc({ title: 'Doc' }));

    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.page).set(PAGE_KEYS.title, 'From update');
    const update = Y.encodeStateAsUpdate(doc);
    const seq = await appendUpdate(db, pageId, update, fx.userId);
    assert.ok(seq > 0);

    const loaded = await loadDoc(db, pageId);
    assert.equal(
      loaded.doc.getMap(DOC_KEYS.page).get(PAGE_KEYS.title),
      'From update',
    );
    assert.equal(loaded.throughSeq, seq);
    loaded.doc.destroy();
  });

  test('compaction folds updates into a snapshot without losing state', async () => {
    const pageId = uuid(1);
    await project(pageId, pageDoc({ title: 'Doc' }));

    const doc = new Y.Doc();
    for (let i = 0; i < 20; i++) {
      const before = Y.encodeStateVector(doc);
      appendBlocks(doc, [{ id: uuid(200 + i), type: 'paragraph', text: `line ${i}` }]);
      await appendUpdate(db, pageId, Y.encodeStateAsUpdate(doc, before), fx.userId);
    }

    const compacted = await compactDoc(await getTestPool(), pageId);
    assert.equal(compacted, true);

    const pending = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [pageId],
    );
    assert.equal(pending.rows[0]!.n, '0', 'folded updates must be deleted');

    const loaded = await loadDoc(db, pageId);
    assert.equal(readBlockTree(loaded.doc).blocks.length, 20, 'state survived');
    loaded.doc.destroy();
  });

  // --- rebuild -------------------------------------------------------------

  test('rebuild restores the projection after the tables are wiped', async () => {
    // The promise of ADR-0002, tested rather than asserted.
    const root = uuid(1);
    const child = uuid(2);

    const rootDoc = pageDoc({ title: 'Root' });
    addBlock(rootDoc, uuid(11), 'root content');
    const childDoc = pageDoc({ title: 'Child', parentPageId: root });

    for (const [id, doc] of [
      [root, rootDoc],
      [child, childDoc],
    ] as const) {
      await project(id, doc);
      await appendUpdate(db, id, Y.encodeStateAsUpdate(doc), fx.userId);
    }

    const beforeBlocks = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM blocks`,
    );

    // Wipe every derived table, keeping pages (which carries workspace_id)
    // and the CRDT log.
    await db.query(`TRUNCATE blocks, page_properties, page_relations, page_search`);

    const report = await rebuild(await getTestPool(), { log: () => {} });
    assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
    assert.equal(report.processed, 2);

    const afterBlocks = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM blocks`,
    );
    assert.equal(afterBlocks.rows[0]!.n, beforeBlocks.rows[0]!.n);

    const search = await db.query(
      `SELECT 1 FROM page_search WHERE tsv @@ to_tsquery('simple', 'root')`,
    );
    assert.ok(search.rows.length > 0, 'search index must be rebuilt too');
  });

  test('rebuild reports an orphaned document instead of guessing a workspace', async () => {
    const orphan = uuid(9);
    const doc = pageDoc({ title: 'Orphan' });
    await appendUpdate(db, orphan, Y.encodeStateAsUpdate(doc), null);

    const report = await rebuild(await getTestPool(), { log: () => {} });
    assert.equal(report.processed, 0);
    assert.equal(report.failed.length, 1);
    assert.match(report.failed[0]!.error, /orphaned/);
  });
});
