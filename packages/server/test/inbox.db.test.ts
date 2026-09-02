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
import { createSession } from '../src/auth/session.js';
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
