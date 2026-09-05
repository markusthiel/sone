/**
 * A value the column cannot hold must not take the page down (ADR-0094).
 *
 * ADR-0092's worst fault was one value: a `guest:` key handed to
 * `actor_id uuid`, inside the projection's transaction, so the page's comment
 * counts, blocks and search row rolled back with it — and the value stays in the
 * document, so every later projection did it again. `22P02` is not in the
 * room's list of permanent failures, so it retried instead of saying anything.
 *
 * That instance was fixed. **The class was not**, and this file is what found
 * the two places it was still live: `assignmentsFor` and `notificationsFor` both
 * drop a `guest:` key and neither checks that what is left is a uuid.
 *
 * The three tests at the end are the more important half. They are not about
 * any particular bad value — they are about what happens when one gets through
 * anyway, which it will: `props` on a block is whatever a client, an importer or
 * an older build put there.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  addThread,
  appendBlocks,
  setPageBlocks,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { withTransaction } from '../src/db/pool.js';
import { appendUpdate } from '../src/doc/docStore.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { DocumentRoom } from '../src/sync/room.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

describe(
  'a value the column cannot hold (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;

    const PAGE = uuid(1);

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

    /** A document with a title, ready to have a body put in it. */
    function page(): Y.Doc {
      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
      const map = doc.getMap(DOC_KEYS.page);
      map.set(PAGE_KEYS.title, 'Die Zahlen');
      map.set(PAGE_KEYS.idx, 'a0');
      map.set(PAGE_KEYS.parentPageId, null);
      return doc;
    }

    const project = (doc: Y.Doc, throughSeq = 1): Promise<unknown> =>
      withTransaction(db, (client) =>
        materializeYDoc(client, PAGE, doc, { throughSeq, workspaceId: fx.workspaceId }),
      );

    // --- the two that were still live -------------------------------------

    test('a task assigned to a name that is not an account', async () => {
      /*
       * `assignmentsFor` drops a `guest:` key and stops there, and `userId` goes
       * into `$3::uuid[]`. So `assignee: 'anna'` — a username from an import, a
       * value from a build that predates accounts, a client bug — aborts the
       * **whole** projection.
       *
       * Third place, same rule, and the third time it was found by looking at
       * the class rather than at a report (ADR-0091, ADR-0092).
       */
      const doc = page();
      appendBlocks(doc, [
        { id: uuid(10), type: 'todo', props: { assignee: 'anna' }, text: 'Rechnung prüfen' },
        { id: uuid(11), type: 'paragraph', text: 'Und der Rest der Seite.' },
      ]);

      await project(doc);

      const blocks = await db.query(`SELECT id FROM blocks WHERE page_id = $1`, [PAGE]);
      assert.equal(blocks.rowCount, 2, 'the page projected, rather than rolling back');
      const rows = await db.query(`SELECT user_id FROM notifications WHERE page_id = $1`, [
        PAGE,
      ]);
      assert.equal(rows.rowCount, 0, 'and nothing was pointed at a name that is not an account');
    });

    test('a comment naming something that is not an account', async () => {
      // `notificationsFor` has the same gap on the same field, one function up.
      const doc = page();
      appendBlocks(doc, [{ id: uuid(10), type: 'paragraph', text: 'Der Text.' }]);
      addThread(doc, {
        id: 't1',
        from: new Uint8Array(),
        to: new Uint8Array(),
        quote: 'Der Text',
        messageId: 'm1',
        author: fx.userId,
        text: 'Schau mal, @anna',
        mentions: ['anna'],
      });

      await project(doc);

      const threads = await db.query(
        `SELECT thread_id FROM page_comments WHERE page_id = $1`,
        [PAGE],
      );
      assert.equal(threads.rowCount, 1, 'the thread was projected, not rolled back');
      const rows = await db.query(`SELECT user_id FROM notifications WHERE page_id = $1`, [
        PAGE,
      ]);
      assert.equal(rows.rowCount, 0);
    });

    test('a real account beside a bad one is still told', async () => {
      /*
       * The assertion that stops the fix being "drop everything when one value
       * is wrong". One malformed assignee must cost exactly one notification.
       */
      const doc = page();
      appendBlocks(doc, [
        { id: uuid(10), type: 'todo', props: { assignee: 'anna' }, text: 'Kaputt' },
        { id: uuid(11), type: 'todo', props: { assignee: fx.userId }, text: 'Echt' },
      ]);

      await project(doc);

      const rows = await db.query<{ user_id: string; message_id: string }>(
        `SELECT user_id, message_id FROM notifications WHERE page_id = $1`,
        [PAGE],
      );
      assert.deepEqual(
        rows.rows.map((r) => [r.user_id, r.message_id]),
        [[fx.userId, uuid(11)]],
      );
    });

    // --- and what happens when one gets through anyway ---------------------

    /**
     * A room, with a projection that will fail.
     *
     * The failure is produced by a real value rather than by a stub, and by one
     * the guards above no longer let through — `workspace_id` is a uuid column
     * too, and a room told to project into a workspace that does not exist gets
     * a foreign-key violation. What is under test below is the room's response
     * to *a projection that fails*, not to any particular reason.
     */
    async function roomWithBrokenProjection(): Promise<DocumentRoom> {
      const doc = page();
      const seq = await appendUpdate(db, PAGE, Y.encodeStateAsUpdate(doc), null);
      await project(doc, seq);
      doc.destroy();

      return DocumentRoom.open({
        pool: db,
        pageId: PAGE,
        // A workspace that is not there: every projection of this room will
        // fail on the foreign key, permanently and identically.
        workspaceId: uuid(999),
        lingerMs: 0,
      });
    }

    test('the log does not grow a copy of the batch per flush', async () => {
      /*
       * The fault under the fault.
       *
       * `appendUpdate` runs **before** the projection, so by the time the
       * projection throws the edit is already durable — documents are the truth
       * (ADR-0002). The catch put the batch back at the front of the queue
       * regardless, which is right for a failed *append* and wrong here: the
       * next flush appended the very same bytes again, and the one after that,
       * for as long as somebody kept typing.
       */
      const room = await roomWithBrokenProjection();
      try {
        appendBlocks(room.doc, [{ id: uuid(20), type: 'paragraph', text: 'eins' }]);
        await room.flush().catch(() => {});
        const after1 = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM doc_updates WHERE doc_id = $1`,
          [PAGE],
        );

        appendBlocks(room.doc, [{ id: uuid(21), type: 'paragraph', text: 'zwei' }]);
        await room.flush().catch(() => {});
        const after2 = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM doc_updates WHERE doc_id = $1`,
          [PAGE],
        );

        assert.equal(
          Number(after2.rows[0]!.n) - Number(after1.rows[0]!.n),
          1,
          'one edit, one row — not the batch again',
        );
      } finally {
        await room.destroy().catch(() => {});
      }
    });

    test('a failed projection does not stop the page being edited', async () => {
      /*
       * A projection failure is not a write failure. The CRDT log is the truth
       * and it took the edit; what is stale is a derived table. Poisoning the
       * room over that would stop *storing* work because a table could not be
       * rebuilt — the wrong way round, and permanently.
       */
      const room = await roomWithBrokenProjection();
      try {
        appendBlocks(room.doc, [{ id: uuid(20), type: 'paragraph', text: 'eins' }]);
        await room.flush().catch(() => {});

        assert.equal(room.isPoisoned, false, 'still storing');

        appendBlocks(room.doc, [{ id: uuid(21), type: 'paragraph', text: 'zwei' }]);
        await room.flush().catch(() => {});

        const rows = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM doc_updates WHERE doc_id = $1`,
          [PAGE],
        );
        assert.ok(Number(rows.rows[0]!.n) >= 3, 'both edits reached the log');
      } finally {
        await room.destroy().catch(() => {});
      }
    });

    test('a failed projection says so, and the next one heals it', async () => {
      /*
       * Self-healing without a retry loop: every flush re-projects the current
       * document, so the edit that removes the offending value is the thing that
       * fixes the page. Nothing has to notice, and nothing has to be run by
       * hand.
       *
       * The bad value here is a real one of the class this file is about, so
       * this is also the case ADR-0092 lived through: a page that had stopped
       * projecting, in a build without the guards above.
       */
      const doc = page();
      setPageBlocks(doc, [
        { id: uuid(10), type: 'todo', props: { assignee: 'anna' }, text: 'Kaputt' },
      ]);
      const seq = await appendUpdate(db, PAGE, Y.encodeStateAsUpdate(doc), null);

      // Projected the way the room does it, but through a writer that has not
      // been taught to drop the value — the state of the code before this
      // change, reproduced by writing the row the projection would have.
      await db
        .query(
          `INSERT INTO notifications (user_id, workspace_id, page_id, kind, message_id)
           VALUES ('anna', $1, $2, 'assignment', $3)`,
          [fx.workspaceId, PAGE, uuid(10)],
        )
        .then(
          () => assert.fail('the column took a value it cannot hold'),
          (err: { code?: string }) => {
            assert.equal(err.code, '22P02', 'this is the error the class is named after');
          },
        );

      // And with the guard, the same document projects.
      await project(doc, seq);
      const state = await db.query<{ status: string }>(
        `SELECT status FROM materialization_state WHERE page_id = $1`,
        [PAGE],
      );
      assert.equal(state.rows[0]?.status, 'ok');
    });
  },
);
