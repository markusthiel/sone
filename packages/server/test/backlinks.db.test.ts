/**
 * Which pages point at this one (ADR-0174).
 *
 * Round three of cross-references, and the half that could not be done in the
 * browser: the pages that point **here** are documents nobody has open.
 *
 * Two things are worth a database to test. The projection's lifecycle — a link
 * removed from a document has to stop being a backlink, which is the trap the
 * notification pass is in and the reason this deletes by source page. And the
 * visibility filter, which is on the **source** page: a backlink from a page
 * somebody may not read is a disclosure exactly as a search result from it is.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  BLOCK_ATTRS,
  DOC_KEYS,
  META_KEYS,
  PAGE_KEYS,
  pageContent,
} from '@sone/core';
import type { Pool } from 'pg';
import * as Y from 'yjs';

import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import {
  addMember,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

describe(
  'who points here (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
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

    /**
     * A page whose one paragraph links wherever it is told.
     *
     * The block id is the page's own, because `blocks.id` is a **global**
     * primary key — two fixtures sharing one made the projection of the second
     * page fail on a constraint, which is a fixture bug that reads exactly like
     * a code bug.
     */
    function linking(title: string, hrefs: string[], blockId = uuid(90)): Y.Doc {
      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
      const page = doc.getMap(DOC_KEYS.page);
      page.set(PAGE_KEYS.title, title);
      page.set(PAGE_KEYS.idx, 'a0');
      page.set(PAGE_KEYS.parentPageId, null);
      page.set(PAGE_KEYS.collectionId, null);

      const content = pageContent(doc);
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.setAttribute(BLOCK_ATTRS.id, blockId);
      for (const href of hrefs) {
        const text = new Y.XmlText();
        text.insert(0, 'siehe dort', { link: { href } });
        paragraph.insert(paragraph.length, [text]);
      }
      content.insert(0, [paragraph]);
      return doc;
    }

    /** A page with nothing in it, so a link has somewhere to land. */
    function plain(title: string): Y.Doc {
      const doc = new Y.Doc();
      doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
      const page = doc.getMap(DOC_KEYS.page);
      page.set(PAGE_KEYS.title, title);
      page.set(PAGE_KEYS.idx, 'a0');
      page.set(PAGE_KEYS.parentPageId, null);
      page.set(PAGE_KEYS.collectionId, null);
      return doc;
    }

    const project = (pageId: string, doc: Y.Doc, seq = 1) =>
      withTransaction(db, (client) =>
        materializeYDoc(client, pageId, doc, {
          throughSeq: seq,
          workspaceId: fx.workspaceId,
          actorId: fx.userId,
        }),
      );

    const rows = async (to: string): Promise<Array<Record<string, unknown>>> => {
      const answer = await db.query(
        `SELECT from_page_id, from_block_id, to_block_id
           FROM page_links WHERE to_page_id = $1 ORDER BY from_page_id`,
        [to],
      );
      return answer.rows;
    };

    test('a link becomes a row on the page it points at', async () => {
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`/p/${target}`]));

      assert.deepEqual(
        (await rows(target)).map((row) => row['from_page_id']),
        [source],
      );
    });

    test('and stops being one when the link goes', async () => {
      /*
       * The whole reason this deletes by source page rather than only
       * inserting. `writeNotifications` only inserts, and a notification whose
       * block was deleted keeps its row for ever — an asymmetry the materialiser
       * records about itself. A backlink that outlived its link would be a
       * panel pointing at a sentence that says nothing about this page.
       */
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`/p/${target}`]));
      assert.equal((await rows(target)).length, 1);

      await project(source, linking('Protokoll', []), 2);
      assert.deepEqual(await rows(target), []);
    });

    test('a target that does not exist here yet is dropped, not refused', async () => {
      /*
       * Ordinary during an import and whenever the other room flushed second.
       * A foreign key would refuse the row and take the whole projection of the
       * source page down with it.
       */
      const source = uuid(2);
      const result = await project(source, linking('Protokoll', [`/p/${uuid(99)}`]));
      assert.ok(result.blockCount >= 1, 'the page still projected');
      assert.deepEqual(await rows(uuid(99)), []);
    });

    test('and it becomes a row once the target arrives and the source is projected again', async () => {
      const target = uuid(1);
      const source = uuid(2);
      await project(source, linking('Protokoll', [`/p/${target}`]));
      assert.deepEqual(await rows(target), []);

      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`/p/${target}`]), 2);
      assert.equal((await rows(target)).length, 1);
    });

    test('an absolute address counts, which is the one from the clipboard', async () => {
      // The first way anybody made an internal link here (ADR-0170). The uuid
      // in the path is what identifies the page, and the existence check above
      // is what makes reading it without a hostname safe.
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`https://sone.example/p/${target}/satzung`]));
      assert.equal((await rows(target)).length, 1);
    });

    test('the block the link names is kept', async () => {
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`/p/${target}#b-${uuid(50)}`]));
      assert.equal((await rows(target))[0]?.['to_block_id'], uuid(50));
    });

    test('a page does not point at itself', async () => {
      // A link to its own top lands where the reader already is, and the row
      // would sit in the page's own panel saying it refers to itself.
      const page = uuid(1);
      await project(page, linking('Satzung', [`/p/${page}`]));
      assert.deepEqual(await rows(page), []);
    });

    test('a page in another workspace is not a backlink here', async () => {
      // The panel is about this workspace's own structure. A reader who is not
      // in the other workspace could not be shown it anyway — this says so
      // where the row is written rather than only where it is read.
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));

      const other = await seedWorkspace(db, 'Elsewhere');
      await withTransaction(db, (client) =>
        materializeYDoc(client, source, linking('Protokoll', [`/p/${target}`]), {
          throughSeq: 1,
          workspaceId: other.workspaceId,
          actorId: other.userId,
        }),
      );
      assert.deepEqual(await rows(target), []);
    });

    test('projecting twice writes the same rows', async () => {
      // The promise of ADR-0008, for this table too: the primary key is the
      // triple, and a second projection must not double a reference.
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`/p/${target}`]));
      const first = await rows(target);
      await project(source, linking('Protokoll', [`/p/${target}`]), 2);
      assert.deepEqual(await rows(target), first);
    });

    test('a page somebody may not read is not among their backlinks', async () => {
      /*
       * The disclosure this route exists to avoid. The condition is on the
       * *source* page: the reader is already looking at the target, and what
       * must not leak is the existence, the title or the count of the pages
       * linking in.
       *
       * Asked here as the route asks it, against the same condition the tree
       * and search use — because the copy that drifts is the one that leaks.
       */
      const { visiblePagesCondition } = await import('../src/pages/access.js');

      const target = uuid(1);
      const open = uuid(2);
      const secret = uuid(3);
      await project(target, plain('Satzung'));
      await project(open, linking('Offen', [`/p/${target}`], uuid(80)));
      await project(secret, linking('Vertraulich', [`/p/${target}`], uuid(81)));
      await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [secret]);

      const stranger = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
        [`reader-${Date.now()}@example.org`, 'Reader'],
      );
      const readerId = stranger.rows[0]!.id;
      await addMember(db, fx.workspaceId, readerId, 'member');

      const visible = await db.query(
        `SELECT src.id
           FROM page_links l
           JOIN pages src ON src.id = l.from_page_id
          WHERE l.to_page_id = $1
            AND src.archived_at IS NULL
            AND ${visiblePagesCondition('src', '$2')}
          ORDER BY src.id`,
        [target, readerId],
      );
      assert.deepEqual(
        visible.rows.map((row) => row.id),
        [open],
        'the restricted page is not among them',
      );
    });

    test('and nobody at all is told when nobody is asking', async () => {
      // `visiblePagesCondition` refuses a null user (ADR-0101), which is what
      // makes the anonymous case safe without a second branch.
      const { visiblePagesCondition } = await import('../src/pages/access.js');
      const target = uuid(1);
      const source = uuid(2);
      await project(target, plain('Satzung'));
      await project(source, linking('Protokoll', [`/p/${target}`]));

      const visible = await db.query(
        `SELECT src.id FROM page_links l JOIN pages src ON src.id = l.from_page_id
          WHERE l.to_page_id = $1 AND ${visiblePagesCondition('src', '$2')}`,
        [target, null],
      );
      assert.deepEqual(visible.rows, []);
    });
  },
);
