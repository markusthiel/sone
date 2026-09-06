/**
 * The content earlier purges left behind (ADR-0106).
 *
 * ADR-0080 stopped the leak and named what it did not do:
 *
 * > An instance that has ever purged a workspace still holds its content. […]
 * > a sweep for them is a query over `doc_updates` with no join available — it
 * > would have to work from "doc_id matches no page and no page's internal
 * > document", which is exactly the shape of query that is one mistake away
 * > from deleting live data. It deserves its own record, its own tests, and a
 * > dry run that reports before it removes.
 *
 * The join turns out to be available: half of it is a hash, and a hash goes one
 * way, which is the direction that happens to be enough. What the warning is
 * right about is the danger, so most of what is asserted here is what the sweep
 * must **not** take.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';

import { internalDocId } from '@sone/core';
import type { Pool } from 'pg';

import { sweepOrphanDocuments } from '../src/doc/sweepOrphanDocuments.js';
import { documentIdsFor } from '../src/doc/deleteDocuments.js';
import { queryRows } from '../src/db/pool.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

const sha1 = (data: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha1').update(data).digest());

describe(
  'documents belonging to no page (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;

    /** A page that exists, with content and comments. */
    const LIVE = uuid(1);
    /** A page that was purged before ADR-0080, leaving its content behind. */
    const PURGED = uuid(2);

    before(async () => {
      db = await getTestPool();
    });

    after(async () => {
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db);
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         VALUES ($1,$2,'Still here','a0','page')`,
        [LIVE, fx.workspaceId],
      );
      // The live page's own document and its internal comments, both written
      // long ago so that only the anti-join can save them.
      await writeDoc(LIVE, '30 days');
      await writeDoc(internalDocId(LIVE, sha1), '30 days');
      // And what the purge left: a page row that is gone, content that is not.
      await writeDoc(PURGED, '30 days');
      await writeDoc(internalDocId(PURGED, sha1), '30 days');
    });

    // --- the derivation, written twice on purpose ---------------------------

    test('the SQL derivation and the TypeScript one agree', async () => {
      /*
       * `internalDocId` is the statement of the rule and `deleteDocuments.ts`
       * says out loud that re-deriving it elsewhere is a second implementation.
       * The view needs it in SQL, so there are two — and this is what makes
       * that acceptable rather than a second answer.
       *
       * The same trade ADR-0080 made for `retryDelayMs`: "a test binds it to
       * the SQL that ships. Deleting it would leave the query unchecked;
       * keeping it unbound was worse than either."
       */
      const ids = [
        '00000000-0000-4000-8000-000000000001',
        'ffffffff-ffff-4fff-bfff-ffffffffffff',
        LIVE,
        PURGED,
        fx.workspaceId,
      ];
      const fromSql = await queryRows<{ id: string; derived: string }>(
        db,
        `SELECT id, internal_doc_id(id) AS derived FROM unnest($1::uuid[]) AS id`,
        [ids],
      );

      assert.equal(fromSql.length, ids.length);
      for (const row of fromSql) {
        assert.equal(
          row.derived,
          internalDocId(row.id, sha1),
          `the two derivations disagree for ${row.id}`,
        );
      }
    });

    // --- what the view names, and what it leaves alone ----------------------

    test('the view names what a purge left and nothing else', async () => {
      const named = await orphanIds();

      assert.deepEqual(
        named,
        [PURGED, internalDocId(PURGED, sha1)].sort(),
        'both halves of the purged page, and neither half of the live one',
      );
    });

    test('a live page´s internal comments are not an orphan', async () => {
      /*
       * The half that makes this hard, called out on its own because it is the
       * one a simpler query gets wrong. An internal document's id is *derived*
       * from the page's, so `doc_id NOT IN (SELECT id FROM pages)` — the obvious
       * way to write this — names every internal document in the instance.
       *
       * That query would have deleted the internal comments of every page on
       * the server: the ones written where the page's own readers cannot see
       * them, which ADR-0080 calls "the copy of a deletion most worth actually
       * performing" and is therefore the copy most worth not performing by
       * accident.
       */
      const naive = await queryRows<{ doc_id: string }>(
        db,
        `SELECT DISTINCT doc_id FROM doc_updates
          WHERE doc_id NOT IN (SELECT id FROM pages)`,
      );
      assert.ok(
        naive.some((row) => row.doc_id === internalDocId(LIVE, sha1)),
        'the naive query really does name it — this is the trap, demonstrated',
      );

      assert.ok(!(await orphanIds()).includes(internalDocId(LIVE, sha1)));
    });

    test('a document arriving before its page is not an orphan', async () => {
      /*
       * `createEntry` appends the first update and materialises the page in a
       * **separate** transaction, so between the two a live document has no
       * row. The window is short and it is real, and if the materialisation
       * throws it never closes.
       *
       * So the age is not a formality. Written now, with no page at all: named
       * by the view, and out of reach of any sweep.
       */
      const arriving = uuid(3);
      await writeDoc(arriving, '0 seconds');

      assert.ok((await orphanIds()).includes(arriving), 'the view sees it');

      const report = await sweepOrphanDocuments(db, { olderThanHours: 24 });
      assert.ok(
        !report.sample.includes(arriving),
        'and the sweep does not, because it is minutes old and not days',
      );
    });

    // --- the sweep ----------------------------------------------------------

    test('reporting is the default, and it removes nothing', async () => {
      // What ADR-0080 asked for: "a dry run that reports before it removes."
      const report = await sweepOrphanDocuments(db, { olderThanHours: 1 });

      assert.equal(report.applied, false);
      assert.equal(report.documents, 2);
      assert.equal(report.updates, 2);
      assert.deepEqual(report.sample.slice().sort(), [PURGED, internalDocId(PURGED, sha1)].sort());

      // Four documents were written: the live page and its internal comments,
      // and both halves of the purged one.
      assert.equal(await updateCount(), 4, 'every row still there');
    });

    test('applying removes exactly those, and leaves the live page whole', async () => {
      const report = await sweepOrphanDocuments(db, { olderThanHours: 1, apply: true });
      assert.equal(report.applied, true);
      assert.equal(report.documents, 2);

      const left = await queryRows<{ doc_id: string }>(
        db,
        `SELECT DISTINCT doc_id FROM doc_updates ORDER BY doc_id`,
      );
      assert.deepEqual(
        left.map((row) => row.doc_id).sort(),
        documentIdsFor([LIVE]).sort(),
        'the live page and its internal comments, and nothing of the purged one',
      );

      const snapshots = await queryRows<{ doc_id: string }>(
        db,
        `SELECT doc_id FROM doc_snapshots WHERE doc_id = $1`,
        [PURGED],
      );
      assert.deepEqual(snapshots, [], 'the snapshot went with the updates');
    });

    test('a limit makes a first run inspectable', async () => {
      const report = await sweepOrphanDocuments(db, { olderThanHours: 1, limit: 1 });
      assert.equal(report.documents, 1);
      assert.equal(await updateCount(), 4, 'and still a report, not a delete');
    });

    test('the maintenance report counts them, and removes nothing', async () => {
      /*
       * The split, and the reason for it: the job **reports**, a script
       * **removes**.
       *
       * The three anomaly counts beside this one are reported rather than
       * repaired because their cause needs an operator. This one has a second
       * reason on top: it is the deletion ADR-0080 called "one mistake away
       * from deleting live data", and a task that performs it every five
       * minutes while nobody is looking is the wrong home for that, however
       * correct the query is today.
       */
      const { Maintenance } = await import('../src/maintenance/job.js');
      const job = new Maintenance({ pool: db, log: () => {} } as never);
      const report = await job.runOnce();

      assert.equal(report.orphanedDocuments, 2);
      assert.equal(await updateCount(), 4, 'and it swept nothing');
    });

    test('nothing to do is not an error', async () => {
      await sweepOrphanDocuments(db, { olderThanHours: 1, apply: true });
      const again = await sweepOrphanDocuments(db, { olderThanHours: 1, apply: true });

      assert.equal(again.documents, 0);
      assert.deepEqual(again.sample, []);
    });

    // --- helpers ------------------------------------------------------------

    /** One update and one snapshot for a document, aged by moving the clock back. */
    async function writeDoc(docId: string, age: string): Promise<void> {
      await db.query(
        `INSERT INTO doc_updates (doc_id, seq, payload, created_at)
         VALUES ($1, nextval('doc_update_seq'), '\\x00', now() - $2::interval)`,
        [docId, age],
      );
      await db.query(
        `INSERT INTO doc_snapshots (doc_id, through_seq, state, state_vector, updated_at)
         VALUES ($1, 1, '\\x00', '\\x00', now() - $2::interval)`,
        [docId, age],
      );
    }

    async function orphanIds(): Promise<string[]> {
      const rows = await queryRows<{ doc_id: string }>(
        db,
        `SELECT doc_id FROM orphaned_documents ORDER BY doc_id`,
      );
      return rows.map((row) => row.doc_id).sort();
    }

    async function updateCount(): Promise<number> {
      const rows = await queryRows<{ n: string }>(
        db,
        `SELECT count(*)::text AS n FROM doc_updates`,
      );
      return Number(rows[0]?.n ?? 0);
    }
  },
);
