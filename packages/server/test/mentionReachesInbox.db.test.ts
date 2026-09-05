/**
 * A mention in a page's text, all the way to the bell (ADR-0085, ADR-0091).
 *
 * Reported as: "Erwähnungen klappen nicht. In meine Benachrichtigungen kommt gar
 * nichts rein. Eine Email habe ich bekommen aber dafür haben wir doch auch die
 * Glocke oder? Dort sehe ich gar nichts, alles leer."
 *
 * Every piece had a test and the chain had none. `mentionsIn` was tested against
 * a `Y.Doc`; `textMentionsFor` was tested as a pure function with `actorId`
 * handed to it; the inbox route was tested over a **hand-inserted** row. Nothing
 * ran the four of them in a line — and the bug lived in the join between the
 * third and the fourth, in the one argument every test supplied by hand.
 *
 * `textMentionsFor` drops a mention whose subject equals the projection's
 * `actorId`, because naming yourself is a note to self. The actor comes from the
 * sync room, where it is set on **every inbound message from every connection**,
 * before the write-permission check — so it is not "who wrote this", it is "who
 * last said anything". Whoever has the page open when the flush runs is the
 * actor, and if that is the person who was named, their own mention is filtered
 * out as if they had written it themselves.
 *
 * So the test that had to exist is this one: put the mention in the document,
 * project it the way the room projects it, and ask the route the bell asks.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import type { Pool } from 'pg';
import * as Y from 'yjs';

import { BLOCK_ATTRS, MENTION_ATTRS, MENTION_NODE } from '@sone/core';

import { createSession } from '../src/auth/session.js';
import { SESSION_COOKIE } from '../src/http/auth.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { registerInboxRoutes } from '../src/notifications/routes.js';
import { Router } from '../src/http/router.js';
import { withTransaction } from '../src/db/pool.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson } from './support/http.js';

interface Inbox {
  notifications: Array<{ kind: string; pageId: string; excerpt: string | null }>;
}

describe(
  'a mention reaches the bell (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let workspace: string;
    /** The one who types the mention. */
    let anna: string;
    /** The one who is named, and who has the page open. */
    let markus: string;
    let pageId: string;
    let markusCookie: string;

    /** A block id, because the projection stores one as a uuid. */
    const BLOCK = '11111111-1111-4111-8111-111111111111';

    /**
     * A page whose one paragraph names somebody, written by somebody.
     *
     * `writtenBy` is what the fix rests on, and it comes from the document's
     * attribution mapping — which every client writes on opening a page
     * (ADR-0022). So the fixture has to write it too, or the test would be
     * exercising the "the document does not say" fallback and calling it the
     * main case.
     */
    const documentNaming = (userId: string, author: string): Y.Doc => {
      const doc = new Y.Doc();
      new Y.PermanentUserData(doc).setUserMapping(doc, doc.clientID, author);
      const fragment = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.setAttribute(BLOCK_ATTRS.id, BLOCK);

      const before = new Y.XmlText();
      before.insert(0, 'Kannst du ');
      paragraph.push([before]);

      const mention = new Y.XmlElement(MENTION_NODE);
      mention.setAttribute(MENTION_ATTRS.userId, userId);
      mention.setAttribute(MENTION_ATTRS.label, 'Markus');
      paragraph.push([mention]);

      const rest = new Y.XmlText();
      rest.insert(0, ' hier draufschauen?');
      paragraph.push([rest]);

      fragment.push([paragraph]);
      return doc;
    };

    /**
     * Project the page the way the room does, with a stated actor.
     *
     * `throughSeq` climbs, because the projection records it and refuses to go
     * backwards — the room passes the sequence it has flushed to.
     */
    let seq = 0;
    const project = async (doc: Y.Doc, actorId: string | null): Promise<void> => {
      seq += 1;
      await withTransaction(db, (client) =>
        materializeYDoc(client, pageId, doc, {
          workspaceId: workspace,
          actorId,
          throughSeq: seq,
        }),
      );
    };

    const inboxOf = async (cookie: string): Promise<Inbox> =>
      expectJson<Inbox>(await fetch(`${base}/api/inbox`, { headers: { cookie } }), 200);

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);

      const router = new Router();
      registerInboxRoutes(router, { pool: db } as never);
      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

      const users = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash) VALUES
           ('a@example.org','Anna','x'), ('m@example.org','Markus','x')
         RETURNING id`,
      );
      [anna, markus] = users.rows.map((r) => r.id) as [string, string];

      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('W',$1) RETURNING id`,
        [anna],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, role_id, is_owner) VALUES
           ($1,$2,'owner',(SELECT id FROM roles WHERE key='owner'),true),
           ($1,$3,'member',(SELECT id FROM roles WHERE key='member'),false)`,
        [workspace, anna, markus],
      );

      pageId = randomUUID();
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
         VALUES ($1,$2,NULL,'Konzept','0','page','{}')`,
        [pageId, workspace],
      );

      markusCookie = `${SESSION_COOKIE}=${encodeURIComponent(
        (await createSession(db, markus)).token,
      )}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    test('being named puts a row in the bell', async () => {
      // The plain case, and it always worked — as long as nobody else happened
      // to be the actor. Here it is Anna, who typed it.
      const doc = documentNaming(markus, anna);
      await project(doc, anna);
      doc.destroy();

      const inbox = await inboxOf(markusCookie);
      const mine = inbox.notifications.filter((one) => one.pageId === pageId);
      assert.equal(mine.length, 1, 'one notification');
      assert.equal(mine[0]!.kind, 'mention');
      assert.match(mine[0]!.excerpt ?? '', /draufschauen/);
    });

    test('and it survives the person being the one with the page open', async () => {
      /*
       * The reported bug, in the shape it actually takes.
       *
       * The projection's actor is not "who wrote this". `sync/server.ts` calls
       * `room.setActor` on every inbound message from every connection, before
       * the write-permission check, and the room keeps the last one for the next
       * flush. So the actor is whoever last said anything — and the person most
       * likely to have the page open the moment somebody names them is the
       * person being named.
       *
       * Their own mention was then dropped as a note to self, permanently:
       * `ON CONFLICT DO NOTHING` prevents duplicates and never fills a gap, so
       * every later projection dropped it again for as long as they were the
       * last sender.
       *
       * Asserted at the route rather than at `textMentionsFor`, because a test
       * of that function has to supply the actor by hand — which is how a
       * function that is right about the argument it is given can be wrong
       * about everything it is given.
       */
      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [pageId]);

      const doc = documentNaming(markus, anna);
      await project(doc, markus);
      doc.destroy();

      const inbox = await inboxOf(markusCookie);
      assert.equal(
        inbox.notifications.filter((one) => one.pageId === pageId).length,
        1,
        'named by somebody else, whoever happened to be the room’s actor',
      );
    });

    test('naming yourself is still a note to self', async () => {
      /*
       * The rule the actor was standing in for, kept — but decided by the
       * document rather than by whoever last spoke. Anna writes the page and
       * names Anna: nothing to tell her.
       *
       * This is the counterweight to the test above. Without it the fix would
       * be "stop filtering", which notifies everybody about their own writing.
       */
      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [pageId]);

      const doc = documentNaming(anna, anna);
      await project(doc, anna);
      doc.destroy();

      const rows = await db.query(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND page_id = $2`,
        [anna, pageId],
      );
      assert.equal(rows.rowCount, 0, 'she wrote it herself');
    });

    test('a page that cannot say who wrote it notifies once rather than never', async () => {
      /*
       * The fallback, stated rather than left implicit.
       *
       * A document written before attribution existed, or one whose mapping was
       * pruned after the writer's other words went (ADR-0022), cannot say who
       * typed a name. Then nothing is filtered — so a self-mention on such a
       * page produces one notification.
       *
       * That is the right way round. Telling somebody about a sentence they
       * wrote themselves is a small annoyance; silently dropping everybody
       * else's mentions is what this replaced.
       */
      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [pageId]);

      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('content');
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.setAttribute(BLOCK_ATTRS.id, BLOCK);
      const mention = new Y.XmlElement(MENTION_NODE);
      mention.setAttribute(MENTION_ATTRS.userId, anna);
      mention.setAttribute(MENTION_ATTRS.label, 'Anna');
      paragraph.push([mention]);
      fragment.push([paragraph]);

      await project(doc, anna);
      doc.destroy();

      const rows = await db.query(
        `SELECT 1 FROM notifications WHERE user_id = $1 AND page_id = $2`,
        [anna, pageId],
      );
      assert.equal(rows.rowCount, 1, 'no attribution, so nothing is filtered');
    });

    test('a mention naming something that is not an account is dropped, not crashed', async () => {
      /*
       * `user_id` is a uuid column, and a mention node's `userId` is written by
       * a client — so it is whatever a client put there. A guest key or any
       * other string reached the INSERT and aborted the **whole projection**
       * with `invalid input syntax for type uuid`, taking the page's comment
       * counts, its search row and its notifications down with it.
       *
       * `notificationsFor` and `assignmentsFor` both drop a guest key already.
       * This one did not, which is the third time in this file that a rule
       * applied in two of three places.
       */
      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [pageId]);

      const doc = documentNaming('guest:Anna', anna);
      await project(doc, anna);
      doc.destroy();

      const rows = await db.query(`SELECT 1 FROM notifications WHERE page_id = $1`, [pageId]);
      assert.equal(rows.rowCount, 0, 'nobody to notify');

      // And the projection ran, which is the half that was actually at risk.
      const page = await db.query<{ status: string }>(
        `SELECT status FROM materialization_state WHERE page_id = $1`,
        [pageId],
      );
      assert.equal(page.rows[0]?.status, 'ok', 'the page still projects');
    });

    test('the badge counts exactly what the list shows', async () => {
      /*
       * A second defect, found while reading the first, and the one that makes
       * the symptom "alles leer" ambiguous.
       *
       * The list joins `pages` and `workspaces` and drops a row whose page is
       * archived or whose workspace is deleted. The count joined **neither**.
       * So a notification on a page that was later trashed was counted on the
       * bell and absent from the list — a badge saying two over an empty
       * screen, which reads as the list being broken.
       */
      await db.query(`DELETE FROM notifications WHERE page_id = $1`, [pageId]);

      const doc = documentNaming(markus, anna);
      await project(doc, anna);
      doc.destroy();

      const countOf = async (): Promise<number> =>
        (
          await expectJson<{ unread: number }>(
            await fetch(`${base}/api/inbox/count`, { headers: { cookie: markusCookie } }),
            200,
          )
        ).unread;

      assert.equal(await countOf(), 1, 'counted while it is listed');

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [pageId]);
      const listed = (await inboxOf(markusCookie)).notifications.filter(
        (one) => one.pageId === pageId,
      ).length;
      assert.equal(listed, 0, 'the list drops a notification on an archived page');
      assert.equal(await countOf(), 0, 'and so does the count');

      await db.query(`UPDATE pages SET archived_at = NULL WHERE id = $1`, [pageId]);
    });
  },
);
