/**
 * A visitor holding a link, saying something (ADR-0090).
 *
 * Asked for as "bau die Kommentare für Gäste". The interesting part is not that
 * it works — it is everything it must still refuse, because this is the first
 * route that lets somebody **without an account write into a document**.
 *
 * ## Why a route and not the sync connection
 *
 * The sync room's write gate is `atLeast(role, 'editor')` and it applies to the
 * whole update: a Yjs update that adds a comment is opaque bytes, and telling it
 * apart from one that rewrites a paragraph means applying it to a scratch copy
 * and diffing. So `commenter` — the level whose whole purpose is "may say
 * something, may not change anything" — could say nothing at all. Not only
 * guests: a **member** graded `commenter` was in the same position, which is why
 * the comment button used to be gated on edit rights.
 *
 * The route makes the guarantee structural instead of parsed. It never receives
 * a document update. It receives a quotation, an anchor and some text, and the
 * server calls `addThread` itself — there is no argument to it that can reach a
 * paragraph. `nothing but the comments changes` is the test that says so, and it
 * is the one that matters most in this file.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import type { Pool } from 'pg';

import * as Y from 'yjs';

import { addMessage, addThread, readPdfMarks, readThreads, removeThread } from '@sone/core';

import { registerCommentRoutes } from '../src/comments/routes.js';
import { createShareLink } from '../src/auth/share.js';
import { createSession } from '../src/auth/session.js';
import { applyToDocument, loadDoc } from '../src/doc/docStore.js';
import { rematerialize } from '../src/materialize/rematerialize.js';
import { SESSION_COOKIE, SHARE_COOKIE } from '../src/http/auth.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

/**
 * A real encoded relative position, built the way the editor builds one.
 *
 * It has to be real. The first version of this file used three arbitrary bytes,
 * on the reasoning that an anchor is opaque and one that points nowhere is a
 * *detached* thread — a state the panel draws on purpose. That is true of an
 * anchor whose text was deleted and false of bytes that are not an anchor at
 * all: reading one **throws**, inside `readThreads`, which the materialiser
 * calls. So those three bytes did not make a detached thread, they made a page
 * that could no longer be projected — and the route now refuses them, which is
 * what `an anchor that is not a relative position is refused` asserts.
 */
function realAnchor(): string {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'Ein Satz, der so bleiben muss.');
  const position = Y.createRelativePositionFromTypeIndex(text, 4);
  const encoded = Buffer.from(Y.encodeRelativePosition(position)).toString('base64');
  doc.destroy();
  return encoded;
}

const ANCHOR = realAnchor();

/** A place in a PDF, in the shape ADR-0151 defined: points, origin bottom left. */
const PLACE = { file: 'f-probe', page: 3, rects: [[72, 700, 120, 20]] } as const;

describe(
  'a visitor commenting through a link (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let owner: string;
    let reader: string;
    let workspace: string;
    let pageId: string;

    /** Links at each level, so the ladder can be asked rather than assumed. */
    let viewerToken: string;
    let commenterToken: string;

    const page = async (title: string): Promise<string> => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
         VALUES ($1,$2,NULL,$3,'0','page','{}')`,
        [id, workspace, title],
      );
      return id;
    };

    const post = async (
      path: string,
      body: unknown,
      cookie: string | null,
    ): Promise<Response> =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });

    const shareCookie = (token: string): string =>
      `${SHARE_COOKIE}=${encodeURIComponent(token)}`;

    const remove = async (path: string, cookie: string | null): Promise<Response> =>
      fetch(`${base}${path}`, {
        method: 'DELETE',
        headers: { ...(cookie ? { cookie } : {}) },
      });

    /**
     * A signed-in member who may comment on a page, and nothing more.
     *
     * The grant is per page and per test: the workspace role here is `guest`,
     * which reaches nothing, and the test above that first proved this deletes
     * its own grant afterwards. Granting inside each test rather than once in
     * `before` keeps that true — a shared grant is a permission one test can
     * remove out from under another.
     */
    const asCommenterOn = async (id: string): Promise<string> => {
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'commenter')
         ON CONFLICT DO NOTHING`,
        [id, reader],
      );
      return `${SESSION_COOKIE}=${encodeURIComponent((await createSession(db, reader)).token)}`;
    };

    const marksOn = async (id: string): Promise<ReturnType<typeof readPdfMarks>> => {
      const loaded = await loadDoc(db, id);
      try {
        return readPdfMarks(loaded.doc);
      } finally {
        loaded.doc.destroy();
      }
    };

    const threadsOn = async (id: string): Promise<ReturnType<typeof readThreads>> => {
      const loaded = await loadDoc(db, id);
      try {
        return readThreads(loaded.doc);
      } finally {
        loaded.doc.destroy();
      }
    };

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);

      const router = new Router();
      registerCommentRoutes(router, { pool: db });
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
           ('o@example.org','Ottilie','x'), ('r@example.org','Rieke','x')
         RETURNING id`,
      );
      [owner, reader] = users.rows.map((r) => r.id) as [string, string];

      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('W',$1) RETURNING id`,
        [owner],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner) VALUES
           ($1,$2,(SELECT id FROM roles WHERE key='owner'),true),
           ($1,$3,(SELECT id FROM roles WHERE key='guest'),false)`,
        [workspace, owner, reader],
      );

      pageId = await page('Konzept');

      viewerToken = (
        await createShareLink(db, { pageId, createdBy: owner, role: 'viewer' })
      ).token;
      commenterToken = (
        await createShareLink(db, { pageId, createdBy: owner, role: 'commenter' })
      ).token;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    test('a commenter link may start a thread, a viewer link may not', async () => {
      /*
       * The ladder, which is also the answer to whether sharing needs a new
       * option for this. It does not: `viewer | commenter | editor` has been in
       * the dialog since links existed. The middle rung simply never did
       * anything, and this is it doing something.
       */
      const refused = await post(
        `/api/pages/${pageId}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'ein Satz', text: 'Stimmt das?' },
        shareCookie(viewerToken),
      );
      // 404, not 403: a refusal that confirms the page exists is a refusal that
      // tells somebody something.
      assert.equal(refused.status, 404, 'a reader stays a reader');

      const allowed = await post(
        `/api/pages/${pageId}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'ein Satz', text: 'Stimmt das?' },
        shareCookie(commenterToken),
      );
      assert.equal(allowed.status, 201);

      const threads = await threadsOn(pageId);
      assert.equal(threads.length, 1);
      assert.equal(threads[0]!.messages[0]!.text, 'Stimmt das?');
    });

    test('a visitor signs with the name they gave, not with silence', async () => {
      /*
       * A share session has no account, so the author is the `guest:` key
       * ADR-0022 defined and ADR-0046 named for exactly this. The consequence
       * that record already accepted holds: two visitors who both type "Anna"
       * are one name in the thread, and there is nothing else to tell them
       * apart by.
       *
       * The name comes from the *session*, never from the request body — a
       * request that could name its own author is a request that can sign
       * somebody else's name.
       */
      const threads = await threadsOn(pageId);
      const author = threads[0]!.messages[0]!.author;
      assert.ok(author.startsWith('guest:'), `signed as ${author}`);
      assert.equal(author, 'guest:Guest', 'the name the session carries');
    });

    test('nothing but the comments changes', async () => {
      /*
       * The guarantee the whole design rests on, and the reason this is a route
       * rather than a relaxed sync gate.
       *
       * The document's prose is written here first, then a visitor comments,
       * then the prose is read back. If a comment could ever reach a paragraph,
       * the words would be the thing that moved.
       */
      const other = await page('Mit Inhalt');
      await applyToDocument(
        db,
        other,
        (doc) => {
          doc.getText('body').insert(0, 'Ein Satz, der so bleiben muss.');
        },
        owner,
      );
      const link = await createShareLink(db, {
        pageId: other,
        createdBy: owner,
        role: 'commenter',
      });

      const res = await post(
        `/api/pages/${other}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'Ein Satz', text: 'Warum?' },
        shareCookie(link.token),
      );
      assert.equal(res.status, 201);

      const loaded = await loadDoc(db, other);
      try {
        assert.equal(
          loaded.doc.getText('body').toString(),
          'Ein Satz, der so bleiben muss.',
          'the prose is untouched',
        );
        assert.equal(readThreads(loaded.doc).length, 1, 'and the comment arrived');
      } finally {
        loaded.doc.destroy();
      }
    });

    test('a reply reaches the thread, and a missing thread is not invented', async () => {
      const threads = await threadsOn(pageId);
      const threadId = threads[0]!.id;

      const replied = await post(
        `/api/pages/${pageId}/comments/${threadId}/messages`,
        { text: 'Ja, das stimmt.' },
        shareCookie(commenterToken),
      );
      assert.equal(replied.status, 201);

      const after_ = await threadsOn(pageId);
      assert.equal(after_[0]!.messages.length, 2);

      // `addMessage` is a no-op for a thread that is not there, and a silent
      // 201 would be a reply somebody believes they made. The document's own
      // answer decides, as it does for a reply arriving by mail.
      const nowhere = await post(
        `/api/pages/${pageId}/comments/t-does-not-exist/messages`,
        { text: 'Hallo?' },
        shareCookie(commenterToken),
      );
      assert.equal(nowhere.status, 404);
    });

    test('an empty comment is refused rather than stored', async () => {
      // A thread whose first message is blank is a highlight over nothing, and
      // it arrives on somebody else's screen as exactly that.
      for (const text of ['', '   ']) {
        const res = await post(
          `/api/pages/${pageId}/comments`,
          { from: ANCHOR, to: ANCHOR, quote: 'x', text },
          shareCookie(commenterToken),
        );
        assert.equal(res.status, 422, `refused ${JSON.stringify(text)}`);
      }
    });

    test('an anchor that is not a relative position is refused', async () => {
      /*
       * The hole this test opened by accident, and the reason it is worth more
       * than the rest of the file.
       *
       * The route checked that the anchor was base64 and wrote the bytes
       * through — an anchor is opaque, and one that points nowhere is a
       * detached thread, which is a state the panel draws on purpose. But bytes
       * that are not a relative position do not point nowhere: reading them
       * throws, inside `readThreads`, which the **materialiser** calls. So a
       * visitor could post a handful of bytes and leave the page unable to
       * project — no comment counts, no notifications, no search row, for
       * everybody — until somebody dug the thread out of the document.
       *
       * Both shapes are asked for: something that is not base64, and something
       * that is base64 and is not an anchor. The second is the one that got
       * through.
       */
      for (const from of ['not base64 !!', Buffer.from([1, 2, 3]).toString('base64')]) {
        const res = await post(
          `/api/pages/${pageId}/comments`,
          { from, to: ANCHOR, quote: 'x', text: 'Hm' },
          shareCookie(commenterToken),
        );
        assert.equal(res.status, 422, `refused ${from}`);
      }

      // And the page still projects, which is the thing that was at risk.
      const rows = await db.query(
        `SELECT 1 FROM page_comments WHERE page_id = $1`,
        [pageId],
      );
      assert.ok(rows.rowCount !== null);
    });

    test('a place in a PDF is stored as one, and a shape that is not is refused', async () => {
      /*
       * The third anchor (ADR-0151), over the route that takes a comment from
       * somebody who may not write the document — which is the path a guest
       * marking a PDF takes.
       *
       * Refused rather than stored: a rectangle nothing can draw is not a mark,
       * and the lesson from the anchor above is that a shape written through
       * unexamined comes back as a page that cannot be read.
       */
      const place = { file: 'f-7', page: 3, rects: [[72, 700, 125, 24]] };
      const made = await post(
        `/api/pages/${pageId}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'Hallo Welt', text: 'Stimmt das?', place },
        shareCookie(commenterToken),
      );
      assert.equal(made.status, 201);

      const threads = await threadsOn(pageId);
      assert.deepEqual(threads.at(-1)?.place, place, 'as it was sent');

      for (const bad of [
        { file: 'f', page: 0, rects: [[0, 0, 1, 1]] },
        { file: '', page: 1, rects: [[0, 0, 1, 1]] },
        { file: 'f', page: 1, rects: [] },
        { file: 'f', page: 1, rects: [[0, 0, 1]] },
        { file: 'f', page: 1, rects: 'alles' },
        'nicht einmal ein Objekt',
      ]) {
        const res = await post(
          `/api/pages/${pageId}/comments`,
          { from: ANCHOR, to: ANCHOR, quote: 'x', text: 'Hm', place: bad },
          shareCookie(commenterToken),
        );
        assert.equal(res.status, 422, `refused ${JSON.stringify(bad)}`);
      }
    });

    test('no credential at all is 401, so a member is sent to sign in', async () => {
      // The distinction the files route lost once and this inherits from its
      // resolver: "nothing presented" and "presented and refused" are different
      // answers, and collapsing them sends a signed-out member to a dead end
      // instead of the login screen.
      const res = await post(
        `/api/pages/${pageId}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'x', text: 'Hm' },
        null,
      );
      assert.equal(res.status, 401);
    });

    test('a member graded guest is refused too, and this is not a guest-only fix', async () => {
      /*
       * Two things at once, and the second is the point of the whole change.
       *
       * A workspace **guest** reaches nothing by role, so they are refused —
       * the route asks the same `effectiveRole` everything else asks, not "is
       * there a share cookie".
       *
       * Then the same person is given the page at `commenter`, and may. Before
       * this, a member graded `commenter` could not comment either: the sync
       * gate is `editor` and there was no other way in. So this route is not a
       * guest feature that members happen to share — it is the level finally
       * meaning what it is named after, for everybody who holds it.
       */
      const cookie = `${SESSION_COOKIE}=${encodeURIComponent(
        (await createSession(db, reader)).token,
      )}`;

      const refused = await post(
        `/api/pages/${pageId}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'x', text: 'Darf ich?' },
        cookie,
      );
      assert.equal(refused.status, 404, 'a guest reaches nothing by role');

      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'commenter')`,
        [pageId, reader],
      );

      const allowed = await post(
        `/api/pages/${pageId}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'x', text: 'Jetzt schon.' },
        cookie,
      );
      assert.equal(allowed.status, 201, 'a member graded commenter may comment');

      const mine = (await threadsOn(pageId)).find(
        (thread) => thread.messages[0]?.text === 'Jetzt schon.',
      );
      assert.equal(mine?.messages[0]?.author, reader, 'signed with their account');

      await db.query(`DELETE FROM page_permissions WHERE user_id = $1`, [reader]);
    });

    test('a visitor signs with the name they typed, not with "Guest"', async () => {
      /*
       * Reported as: the guest enters "Lars" and the member sees "Gast".
       *
       * Two faults, both in resolving the share cookie. The cookie names the
       * **link**, not the person holding it, so an HTTP request cannot say
       * which visitor is asking — and this path substituted 'Guest' *and wrote
       * it back over* the name the sync connection had stored, so posting a
       * comment destroyed the name in the same breath as signing with the wrong
       * one (ADR-0092).
       *
       * So the name travels with the comment. For a guest that is no weaker
       * than the session's: both were typed into a box by the same person. What
       * stops a visitor signing as a colleague is the `guest:` prefix, not the
       * wire the string came down.
       */
      const fresh = await page('Mit Namen');
      const link = await createShareLink(db, {
        pageId: fresh,
        createdBy: owner,
        role: 'commenter',
      });

      const res = await post(
        `/api/pages/${fresh}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'x', text: 'Ich bin Lars.', name: 'Lars' },
        shareCookie(link.token),
      );
      assert.equal(res.status, 201);

      const threads = await threadsOn(fresh);
      assert.equal(threads[0]!.messages[0]!.author, 'guest:Lars');
    });

    test('a visitor’s reply does not take the page’s projection down with it', async () => {
      /*
       * The heaviest fault of the batch, reported only as "eine Antwort auf
       * einen Kommentar wird nicht eingetragen".
       *
       * A reply notifies everybody already in the thread, and the candidate
       * carried `actorId: message.author`. A visitor's author is a `guest:`
       * key; `actor_id` is a uuid column. So the INSERT threw `22P02` **inside
       * the projection's transaction** — taking the comment counts, the blocks
       * and the search row with it. And the message stays in the document, so
       * every later projection of that page threw again. `22P02` is not one of
       * the codes the room treats as permanent, so it retried for ever instead
       * of saying anything.
       *
       * Asserted on the projection, not on the notification: the notification
       * is the small half.
       */
      const fresh = await page('Faden');
      const link = await createShareLink(db, {
        pageId: fresh,
        createdBy: owner,
        role: 'commenter',
      });

      // A member opens the thread, so there is somebody for the reply to reach.
      await applyToDocument(
        db,
        fresh,
        (doc) => {
          addThread(doc, {
            id: 'faden',
            from: new Uint8Array(Buffer.from(ANCHOR, 'base64')),
            to: new Uint8Array(Buffer.from(ANCHOR, 'base64')),
            quote: 'etwas',
            messageId: 'm1',
            author: owner,
            text: 'Was meint ihr?',
          });
        },
        owner,
      );

      const replied = await post(
        `/api/pages/${fresh}/comments/faden/messages`,
        { text: 'Ich finde es gut.', name: 'Lars' },
        shareCookie(link.token),
      );
      assert.equal(replied.status, 201, 'the reply is accepted');

      const state = await db.query<{ status: string }>(
        `SELECT status FROM materialization_state WHERE page_id = $1`,
        [fresh],
      );
      assert.equal(state.rows[0]?.status, 'ok', 'and the page still projects');

      const counted = await db.query<{ messages: number }>(
        `SELECT messages FROM page_comments WHERE page_id = $1`,
        [fresh],
      );
      assert.equal(counted.rows[0]?.messages, 2, 'both messages counted');

      // And the member hears about it, with no actor to name.
      const told = await db.query<{ actor_id: string | null }>(
        `SELECT actor_id FROM notifications
          WHERE user_id = $1 AND page_id = $2 AND kind = 'reply'`,
        [owner, fresh],
      );
      assert.equal(told.rowCount, 1);
      assert.equal(told.rows[0]!.actor_id, null, 'a guest is not an account to point at');
    });

    test('deleting a thread takes its notification with it', async () => {
      // The bell kept an entry for a conversation that no longer exists —
      // click it and nothing is found. The projection rewrites the comments
      // wholesale and only ever *inserted* notifications, so the two drifted
      // one way for ever (ADR-0092).
      const fresh = await page('Wieder weg');
      await applyToDocument(
        db,
        fresh,
        (doc) => {
          addThread(doc, {
            id: 'weg',
            from: new Uint8Array(Buffer.from(ANCHOR, 'base64')),
            to: new Uint8Array(Buffer.from(ANCHOR, 'base64')),
            quote: 'etwas',
            messageId: 'm1',
            author: owner,
            text: 'Frage',
          });
          addMessage(doc, 'weg', { id: 'm2', author: reader, text: 'Antwort' });
        },
        owner,
      );
      await rematerialize(db, fresh, workspace, owner);

      const before = await db.query(
        `SELECT 1 FROM notifications WHERE page_id = $1 AND thread_id = 'weg'`,
        [fresh],
      );
      assert.equal(before.rowCount, 1, 'the owner was told about the reply');

      await applyToDocument(db, fresh, (doc) => removeThread(doc, 'weg'), owner);
      await rematerialize(db, fresh, workspace, owner);

      const after_ = await db.query(
        `SELECT 1 FROM notifications WHERE page_id = $1 AND thread_id = 'weg'`,
        [fresh],
      );
      assert.equal(after_.rowCount, 0, 'and it goes when the thread does');
    });

    test('whoever shared the page is told about a visitor’s first thread', async () => {
      /*
       * A reply notifies everybody already in the thread, which the projection
       * handles and needs no help. A **new** thread has nobody in it — so a
       * visitor's first comment would notify nobody at all, and a comment
       * nobody hears about is a comment lost (the lesson ADR-0081 paid for with
       * a queue that never retried).
       *
       * Who to tell is not a guess: a visitor is holding a link, and somebody
       * made that link. They chose to let this page out.
       */
      const fresh = await page('Frisch geteilt');
      const link = await createShareLink(db, {
        pageId: fresh,
        createdBy: owner,
        role: 'commenter',
      });

      const res = await post(
        `/api/pages/${fresh}/comments`,
        { from: ANCHOR, to: ANCHOR, quote: 'x', text: 'Eine Frage dazu.' },
        shareCookie(link.token),
      );
      assert.equal(res.status, 201);

      const rows = await db.query<{ kind: string; excerpt: string }>(
        `SELECT kind, excerpt FROM notifications WHERE user_id = $1 AND page_id = $2`,
        [owner, fresh],
      );
      assert.equal(rows.rowCount, 1, 'the person who shared it hears about it');
      assert.equal(rows.rows[0]!.excerpt, 'Eine Frage dazu.');
    });

    /*
     * ---- Marks on a PDF (ADR-0152) ----------------------------------------
     *
     * A mark says "attend to this" and nothing else. Same gate as a comment,
     * same transport — and, in this round, **not** offered to a link holder.
     */

    test('a mark needs an account, and says so rather than failing quietly', async () => {
      /*
       * The pair is offered together or not at all. A link can only tell two
       * visitors apart by the name they typed (ADR-0046), so a visitor's mark
       * could be made and — the moment somebody else typed the same name, or
       * the same person came back on another device — never taken off again. A
       * one-way act is worse than one that is not offered.
       *
       * 403 with a reason, not the 404 the rest of this module answers a
       * refusal with: those hide whether a page exists, and this person has
       * already been told it does — they may comment on it.
       */
      const refused = await post(
        `/api/pages/${pageId}/pdf-marks`,
        { place: PLACE, quote: 'ein Satz' },
        shareCookie(commenterToken),
      );
      assert.equal(refused.status, 403);
      assert.equal(((await refused.json()) as { error: string }).error, 'marks_need_an_account');
      assert.deepEqual(await marksOn(pageId), []);
    });

    test('a member marks a place, and it is stored as one', async () => {
      const cookie = await asCommenterOn(pageId);
      const made = await post(
        `/api/pages/${pageId}/pdf-marks`,
        { place: PLACE, quote: 'Hallo Welt' },
        cookie,
      );
      assert.equal(made.status, 201);

      const marks = await marksOn(pageId);
      assert.equal(marks.length, 1);
      assert.deepEqual(marks[0]!.place, PLACE);
      assert.equal(marks[0]!.quote, 'Hallo Welt');
      // A user id, not a `guest:` key: a mark's author has no name to fall back
      // on, which is the whole reason the account is required.
      assert.equal(marks[0]!.author, reader);

      // And off again. Any of them, for whoever may act on the page — the rule
      // a thread already has.
      const gone = await remove(
        `/api/pages/${pageId}/pdf-marks/${marks[0]!.id}`,
        cookie,
      );
      assert.equal(gone.status, 200);
      assert.deepEqual(await marksOn(pageId), []);
    });

    test('a shape that is not a place is refused, not mended', async () => {
      // The core's rule, asked once. A page of zero is not a page and a
      // rectangle of no width is not a mark, and writing either through would
      // put the question in every reader instead of in one line.
      const cookie = await asCommenterOn(pageId);
      const refused = await post(
        `/api/pages/${pageId}/pdf-marks`,
        { place: { file: 'f1', page: 0, rects: [] }, quote: 'x' },
        cookie,
      );
      assert.equal(refused.status, 422);
      assert.equal(((await refused.json()) as { error: string }).error, 'invalid_place');
      assert.deepEqual(await marksOn(pageId), []);
    });

    test('removing one that is not there is a 404, not a quiet success', async () => {
      // The document's own answer. A silent 200 would tell somebody a mark had
      // been taken off a page that never had one.
      const cookie = await asCommenterOn(pageId);
      const gone = await remove(`/api/pages/${pageId}/pdf-marks/k-nope`, cookie);
      assert.equal(gone.status, 404);
    });

    test('a mark is silent: nobody is told about one', async () => {
      /*
       * The whole difference between this and the route above it. Telling
       * somebody about a highlight would make it a comment with no words in it,
       * which is precisely the thing ADR-0046 refused to store.
       */
      const quiet = await page('Nur markiert');
      const cookie = await asCommenterOn(quiet);
      const made = await post(
        `/api/pages/${quiet}/pdf-marks`,
        { place: PLACE, quote: 'x' },
        cookie,
      );
      assert.equal(made.status, 201);

      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications WHERE page_id = $1`,
        [quiet],
      );
      assert.equal(rows.rows[0]!.count, '0', 'a mark tells nobody anything');
    });

    test('the projection follows, so the thread can be found without opening it', async () => {
      // The document is the truth and the table is what can be queried
      // (ADR-0046). A route that wrote only the document would leave a page
      // whose comment count is wrong until something else happened to it.
      const rows = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM page_comments WHERE page_id = $1`,
        [pageId],
      );
      assert.notEqual(rows.rows[0]!.count, '0', 'projected, not only written');
    });
  },
);
