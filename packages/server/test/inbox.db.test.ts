/**
 * The inbox (ADR-0052).
 *
 * The test that matters most is the one about somebody else's notification: an
 * inbox is the one list in SONE that is *per person* rather than per workspace,
 * so getting the scope wrong shows one person another's conversations.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';

import { Router } from '../src/http/router.js';
import { addThread, readThreads } from '@sone/core';

import { createSession } from '../src/auth/session.js';
import { applyToDocument, loadDoc } from '../src/doc/docStore.js';
import { registerAuthRoutes } from '../src/http/auth.js';
import { registerInboxRoutes } from '../src/notifications/routes.js';
import { closeTestPool, getTestPool, resetDatabase, seedWorkspace } from './support/db.js';
import { expectJson } from './support/http.js';

let db: Pool;
let server: Server;
let base: string;

before(async () => {
  db = await getTestPool();
  await resetDatabase(db);

  const router = new Router();
  registerAuthRoutes(router, {
        // No relay in these suites: the reset is absent, which is the
        // ordinary case for an instance without mail (ADR-0059).
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        // No requirement in these suites (ADR-0065).
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
    pool: db,
    signupMode: () => Promise.resolve('invite' as const),
    secureCookies: false,
  });
  registerInboxRoutes(router, { pool: db });
  /*
   * `handle` takes a base URL and returns whether it took the request.
   *
   * My first version called it with two arguments and ignored the answer, so an
   * unmatched request got *no response at all* — and `fetch` waited for one
   * until the test runner gave up, which is why the run printed "TAP version
   * 13" and nothing else. A hang is what an unanswered request looks like from
   * the outside; there was nothing wrong with the database.
   */
  server = createServer((req, res) => {
    void router.handle(req, res, 'http://localhost').then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeTestPool();
});

/** A person with a session, and a page in their workspace. */
async function person(name: string): Promise<{
  cookie: string;
  userId: string;
  workspaceId: string;
  pageId: string;
}> {
  const { workspaceId, userId } = await seedWorkspace(db, `WS ${name}`);
  const page = await db.query<{ id: string }>(
    `INSERT INTO pages (id, workspace_id, idx, title)
     VALUES (gen_random_uuid(), $1, 'a0', $2) RETURNING id`,
    [workspaceId, `Seite ${name}`],
  );

  /*
   * Through `createSession`, not by inserting a row.
   *
   * My first version wrote the row itself and hashed the token with Postgres's
   * `digest()` — re-implementing how a session is stored, in a test that is
   * about the inbox. It also needs an extension this database may not have. The
   * real function is one import away and cannot disagree with the code that
   * reads sessions.
   */
  const session = await createSession(db, userId);

  return {
    cookie: `sone_session=${session.token}`,
    userId,
    workspaceId,
    pageId: page.rows[0]!.id,
  };
}

async function notify(who: Awaited<ReturnType<typeof person>>, message: string): Promise<string> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
     VALUES ($1, $2, $3, 'mention', 't1', $4, $5) RETURNING id`,
    [who.userId, who.workspaceId, who.pageId, message, message],
  );
  return row.rows[0]!.id;
}

test('an inbox holds one person’s notifications and nobody else’s', async () => {
  const anna = await person('anna');
  const bert = await person('bert');
  await notify(anna, 'Frage an Anna');
  await notify(bert, 'Frage an Bert');

  const mine = await expectJson<{ notifications: Array<{ excerpt: string }> }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.deepEqual(
    mine.notifications.map((one) => one.excerpt),
    ['Frage an Anna'],
  );

  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 1, 'and the count is hers too');
});

test('marking one read leaves the others, and somebody else’s untouched', async () => {
  const anna = await person('carla');
  const bert = await person('dora');
  const first = await notify(anna, 'Eins');
  await notify(anna, 'Zwei');
  const theirs = await notify(bert, 'Fremd');

  await expectJson(
    await fetch(`${base}/api/inbox/read`, {
      method: 'POST',
      headers: { cookie: anna.cookie, 'content-type': 'application/json' },
      // Including an id from somebody else's inbox: it must match nothing
      // rather than be an error, which is the same answer as an id that never
      // existed.
      body: JSON.stringify({ ids: [first, theirs] }),
    }),
    200,
  );

  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 1, 'one of hers left');

  const others = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: bert.cookie } }),
    200,
  );
  assert.equal(others.unread, 1, 'and his is untouched');
});

test('a read notification stays in the list', async () => {
  // An inbox that hides what has been read is a list nobody can go back to, and
  // "what did Anna ask me last week" is half of what this is for.
  const anna = await person('elke');
  const id = await notify(anna, 'Alt');
  await fetch(`${base}/api/inbox/read`, {
    method: 'POST',
    headers: { cookie: anna.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  });

  const all = await expectJson<{ notifications: Array<{ read: boolean }> }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.deepEqual(all.notifications.map((one) => one.read), [true]);

  const unread = await expectJson<{ notifications: unknown[] }>(
    await fetch(`${base}/api/inbox?unread=true`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.deepEqual(unread.notifications, [], 'and can be filtered out');
});

test('a notification can be put back to waiting', async () => {
  /*
   * Opened by accident, or read and not dealt with (ADR-0071).
   *
   * Without this, "unread" is a one-way door — and a list you cannot undo a
   * click in is one people stop clicking in at all.
   */
  const anna = await person('gerda');
  const id = await notify(anna, 'Versehentlich geöffnet');
  const read = async (ids: string[], value?: boolean): Promise<Response> =>
    fetch(`${base}/api/inbox/read`, {
      method: 'POST',
      headers: { cookie: anna.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(value === undefined ? { ids } : { ids, read: value }),
    });

  await read([id]);
  await read([id], false);

  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 1, 'waiting again');

  // Only by id. "Mark everything unread" answers no question anybody has, and
  // it would resurrect a bankruptcy somebody declared on purpose.
  const all = await fetch(`${base}/api/inbox/read`, {
    method: 'POST',
    headers: { cookie: anna.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ read: false }),
  });
  assert.equal(all.status, 422);
});

test('putting back somebody else’s notification does nothing', async () => {
  // The same rule marking read follows: an id from another inbox matches
  // nothing rather than being an error.
  const anna = await person('hanna');
  const bert = await person('ingo');
  const theirs = await notify(bert, 'Fremd');
  await fetch(`${base}/api/inbox/read`, {
    method: 'POST',
    headers: { cookie: bert.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [theirs] }),
  });

  await fetch(`${base}/api/inbox/read`, {
    method: 'POST',
    headers: { cookie: anna.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [theirs], read: false }),
  });

  const his = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: bert.cookie } }),
    200,
  );
  assert.equal(his.unread, 0, 'still read, by the only person who may say so');
});

test('something put aside stops counting and stops waiting', async () => {
  /*
   * A badge that keeps counting what somebody deliberately put aside is a badge
   * they stop believing, and that is the one thing this number must not become
   * (ADR-0075).
   */
  const anna = await person('jana');
  const id = await notify(anna, 'Später');
  const snooze = (until: string | null): Promise<Response> =>
    fetch(`${base}/api/inbox/snooze`, {
      method: 'POST',
      headers: { cookie: anna.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id], until }),
    });
  const count = async (): Promise<number> =>
    (
      await expectJson<{ unread: number }>(
        await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
        200,
      )
    ).unread;

  assert.equal(await count(), 1);
  await expectJson(await snooze(new Date(Date.now() + 3_600_000).toISOString()), 200);
  assert.equal(await count(), 0, 'asleep');

  // And out of "unread", which means waiting for you.
  const waiting = await expectJson<{ notifications: unknown[] }>(
    await fetch(`${base}/api/inbox?unread=true`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.deepEqual(waiting.notifications, []);

  // But still in the full listing, with the moment it comes back — one of the
  // browser's views is the list of what is asleep.
  const all = await expectJson<{ notifications: Array<{ snoozedUntil: string | null }> }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(all.notifications.length, 1);
  assert.ok(all.notifications[0]?.snoozedUntil, 'and it says when');

  // Waking it is the undo, and it is the same call with no time.
  await snooze(null);
  assert.equal(await count(), 1);
});

test('a notification wakes on its own, with nothing to run', async () => {
  /*
   * Asleep is "the moment is in the future", so the clock passing it is the
   * whole mechanism. Nothing schedules a wake-up, so nothing can miss a tick or
   * be out of step with the time.
   */
  const anna = await person('karin');
  const id = await notify(anna, 'Kurz weg');
  await db.query(`UPDATE notifications SET snoozed_until = now() - interval '1 minute'
                   WHERE id = $1`, [id]);

  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 1, 'back on its own');

  // And a moment that has passed is reported as no moment at all: it is simply
  // awake, and leaving it in would make every reader repeat the comparison.
  const all = await expectJson<{ notifications: Array<{ snoozedUntil: string | null }> }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(all.notifications[0]?.snoozedUntil, null);
});

test('a time in the past, or a year out, is refused', async () => {
  // The first would be asleep and awake at once; the second is "delete it
  // without saying so".
  const anna = await person('lena');
  const id = await notify(anna, 'Nein');
  const snooze = (until: unknown): Promise<Response> =>
    fetch(`${base}/api/inbox/snooze`, {
      method: 'POST',
      headers: { cookie: anna.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id], until }),
    });

  assert.equal((await snooze(new Date(Date.now() - 1000).toISOString())).status, 422);
  assert.equal((await snooze(new Date(Date.now() + 400 * 86_400_000).toISOString())).status, 422);
  assert.equal((await snooze('nächsten Dienstag')).status, 422);
  // And nothing was put aside by any of them.
  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 1);
});

test('putting aside somebody else’s notification does nothing', async () => {
  const anna = await person('mira');
  const bert = await person('nils');
  const theirs = await notify(bert, 'Fremd');

  await fetch(`${base}/api/inbox/snooze`, {
    method: 'POST',
    headers: { cookie: anna.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [theirs], until: new Date(Date.now() + 3_600_000).toISOString() }),
  });

  const his = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: bert.cookie } }),
    200,
  );
  assert.equal(his.unread, 1, 'still waiting for the only person it is for');
});

// --- answering without leaving (ADR-0076) ----------------------------------

/** A thread in the page's document, so there is something to answer. */
async function withThread(who: Awaited<ReturnType<typeof person>>): Promise<string> {
  await applyToDocument(
    db,
    who.pageId,
    (doc) => {
      addThread(doc, {
        id: 't1',
        messageId: 'm0',
        author: who.userId,
        text: 'Was meinst du?',
        // Empty anchors, like the suite's other thread fixtures: a real
        // anchor is an encoded relative position from the editor, and a made-up
        // byte or two is not one — the projection tries to decode it.
        from: new Uint8Array(),
        to: new Uint8Array(),
        quote: 'etwas',
      });
    },
    who.userId,
  );
  return 't1';
}

const reply = (
  who: Awaited<ReturnType<typeof person>>,
  id: string,
  text: unknown,
): Promise<Response> =>
  fetch(`${base}/api/inbox/${id}/reply`, {
    method: 'POST',
    headers: { cookie: who.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });

test('a notification can be answered from the inbox, and the answer is in the page', async () => {
  /*
   * The inbox is the one place in SONE that spans workspaces and holds no page
   * open. Answering used to mean going to the page, finding the thread and
   * typing there — three steps for a sentence.
   */
  const anna = await person('olga');
  await withThread(anna);
  const id = await notify(anna, 'Frage');

  await expectJson(await reply(anna, id, 'Ja, passt so.'), 201);

  const loaded = await loadDoc(db, anna.pageId);
  const thread = readThreads(loaded.doc).find((one) => one.id === 't1');
  loaded.doc.destroy();
  assert.equal(thread?.messages.at(-1)?.text, 'Ja, passt so.');
  assert.equal(thread?.messages.at(-1)?.author, anna.userId);
});

test('the answer is projected, not only written', async () => {
  /*
   * Notifications are written by the materialiser from the comments it finds.
   * A reply that is only appended to the document notifies nobody — which is
   * what answering by email did for as long as it existed (ADR-0076).
   */
  const anna = await person('petra');
  await withThread(anna);
  const id = await notify(anna, 'Frage');
  await reply(anna, id, 'Antwort im Faden.');

  const projected = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM page_comments WHERE page_id = $1`,
    [anna.pageId],
  );
  assert.ok(Number(projected.rows[0]!.n) > 0, 'the projection ran');
});

test('answering is reading', async () => {
  // Somebody who has just written a sentence about a notification has dealt
  // with it, and leaving the row bold afterwards is the inbox disagreeing with
  // what the person just did.
  const anna = await person('rita');
  await withThread(anna);
  const id = await notify(anna, 'Frage');

  await reply(anna, id, 'Erledigt.');

  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 0);
});

test('an empty answer is refused, and nothing is written', async () => {
  const anna = await person('sonja');
  await withThread(anna);
  const id = await notify(anna, 'Frage');

  assert.equal((await reply(anna, id, '   ')).status, 422);
  assert.equal((await reply(anna, id, 42)).status, 422);

  const loaded = await loadDoc(db, anna.pageId);
  const thread = readThreads(loaded.doc).find((one) => one.id === 't1');
  loaded.doc.destroy();
  assert.equal(thread?.messages.length, 1, 'only the question');
});

test('somebody else’s notification cannot be answered', async () => {
  // One answer for "not yours", "not there" and "nothing to answer": the
  // difference would say whose inbox holds what.
  const anna = await person('tanja');
  const bert = await person('udo');
  await withThread(anna);
  const id = await notify(anna, 'Frage');

  assert.equal((await reply(bert, id, 'Ich auch!')).status, 404);
});

test('a thread that has gone is reported rather than recreated', async () => {
  // The row in the inbox still remembers the conversation, which is the point
  // of the row — but there is nothing left to answer.
  const anna = await person('vera');
  const id = await notify(anna, 'Frage');

  const res = await reply(anna, id, 'Hallo?');
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'thread_gone' });
});

test('an archived page is not a place to be sent', async () => {
  const anna = await person('frida');
  await notify(anna, 'Zu einer Seite im Papierkorb');
  await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [anna.pageId]);

  const list = await expectJson<{ notifications: unknown[] }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.deepEqual(list.notifications, []);
});

test('an assignment is written once however often the page is projected', async () => {
  // The fault migration 0040 fixes: an assignment has no thread, so the
  // original UNIQUE (…, thread_id, …) matched nothing and every projection
  // wrote the row again. Asserted against the database rather than the rule,
  // because the rule was right and the constraint was not.
  const anna = await person('gerda');

  for (let round = 0; round < 3; round += 1) {
    await db.query(
      `INSERT INTO notifications
         (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
       VALUES ($1, $2, $3, 'assignment', NULL, 'block-1', 'Rechnung prüfen')
       ON CONFLICT DO NOTHING`,
      [anna.userId, anna.workspaceId, anna.pageId],
    );
  }

  const count = await expectJson<{ unread: number }>(
    await fetch(`${base}/api/inbox/count`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(count.unread, 1, 'three projections, one notification');
});

// --- taking a row off the list (ADR-0115) ------------------------------------

test('a notification can be removed, and only by the person it is for', async () => {
  /*
   * There was no way to. Reading keeps a row, snoozing brings it back, and the
   * one-year ceiling on a snooze exists precisely so that putting something
   * aside cannot quietly become deleting it — which left "I do not want this
   * row any more" with no answer at all.
   */
  const anna = await person('dora');
  const bert = await person('emil');
  const hers = await notify(anna, 'Ihre Frage');
  const his = await notify(bert, 'Seine Frage');

  const gone = await expectJson<{ removed: number }>(
    await fetch(`${base}/api/inbox/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: anna.cookie },
      body: JSON.stringify({ ids: [hers, his] }),
    }),
    200,
  );
  // Both ids were sent and one of them is not hers. It matches nothing rather
  // than being an error, which is the same answer as an id that never existed —
  // and it is the whole of the authorisation, so it is worth asserting.
  assert.equal(gone.removed, 1);

  const mine = await expectJson<{ notifications: unknown[] }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.deepEqual(mine.notifications, []);

  const theirs = await expectJson<{ notifications: Array<{ excerpt: string }> }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: bert.cookie } }),
    200,
  );
  assert.deepEqual(
    theirs.notifications.map((one) => one.excerpt),
    ['Seine Frage'],
    'somebody else’s row is untouched',
  );
});

test('removing nothing is refused rather than removing everything', async () => {
  // The shape that matters: `read` with no ids means "all of them", so an empty
  // body here would be a plausible reading of "clear the inbox" — and this is
  // the one act in the list that cannot be undone.
  const anna = await person('frieda');
  await notify(anna, 'Bleibt');

  for (const body of ['{}', '{"ids":[]}']) {
    const res = await fetch(`${base}/api/inbox/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: anna.cookie },
      body,
    });
    assert.equal(res.status, 422, `expected a refusal for ${body}`);
  }

  const mine = await expectJson<{ notifications: unknown[] }>(
    await fetch(`${base}/api/inbox`, { headers: { cookie: anna.cookie } }),
    200,
  );
  assert.equal(mine.notifications.length, 1, 'and nothing was removed');
});
