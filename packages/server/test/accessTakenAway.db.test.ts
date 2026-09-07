/**
 * The other half of being let in (ADR-0128).
 *
 * ADR-0121 built the mail that says *„you can now work in X"*. The two that say
 * the opposite were listed beside it and not built:
 *
 * > **Zugriff entzogen / Rolle geändert.** Das Gegenstück zur jetzt gebauten
 * > Info-Mail — und die wichtigere Nachricht, sonst merkt es jemand an einem
 * > 404.
 *
 * It is the more important one because of how it is otherwise discovered.
 * Gaining access shows up as a workspace appearing; losing it shows up as a
 * bookmark that stops working, and the first guess is that something is broken
 * rather than that something was decided.
 *
 * ## What these tests are mostly about
 *
 * When a letter must *not* go out. A mail about a change that did not happen —
 * a role set to the one somebody already had, an administrator acting on their
 * own row — is noise, and noise is what teaches people to filter the mail that
 * matters.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE } from '../src/http/auth.js';
import { registerInvitationRoutes } from '../src/auth/invitationRoutes.js';
import { createSession } from '../src/auth/session.js';
import { Router } from '../src/http/router.js';
import {
  addMember,
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';
import { expectStatus } from './support/http.js';

describe(
  'access taken away (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let server: Server;
    let base: string;
    let cookie: string;
    let posted: Array<{ to: string; letter: { subject: string; lines: Array<{ text: string }> } }>;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('Thiel'),
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
      });
      registerInvitationRoutes(router, {
        pool: db,
        baseUrl: 'https://sone.example.org',
        instanceName: () => Promise.resolve('Thiel'),
        sendLetter: (to: string, letter: unknown) => {
          posted.push({ to, letter: letter as never });
          return Promise.resolve();
        },
      } as never);

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
      fx = await seedWorkspace(db, 'Haus');
      await db.query(`UPDATE users SET display_name = 'Anna Weber' WHERE id = $1`, [fx.userId]);
      const session = await createSession(db, fx.userId, {});
      cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
      posted = [];
    });

    /** Somebody else in the workspace, as a member. */
    async function member(email: string): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ($1, 'Bert Loos') RETURNING id`,
        [email],
      );
      const id = row.rows[0]!.id;
      await addMember(db, fx.workspaceId, id, 'member');
      return id;
    }

    const remove = (userId: string): Promise<Response> =>
      fetch(`${base}/api/workspaces/${fx.workspaceId}/members/${userId}`, {
        method: 'DELETE',
        headers: { cookie },
      });

    const setRole = (userId: string, role: string): Promise<Response> =>
      fetch(`${base}/api/workspaces/${fx.workspaceId}/members/${userId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ role }),
      });

    // --- taken away ----------------------------------------------------------

    test('somebody removed is told, by whom and from where', async () => {
      /*
       * The whole point. Without it the next sign of it is a bookmark that
       * answers "not found", which reads as a fault rather than a decision —
       * and the person asks the wrong question of the wrong people.
       */
      const bert = await member('bert@example.org');
      await expectStatus(await remove(bert), 200);

      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, 'bert@example.org');
      const said = JSON.stringify(posted[0]!.letter);
      assert.match(said, /Haus/, 'where');
      assert.match(said, /Anna Weber/, 'who');
    });

    test('and never what was in it', async () => {
      // ADR-0058's rule holds here as everywhere: the workspace's name is where,
      // and a list of what they can no longer see would be the content leaving
      // with the access.
      const bert = await member('bert@example.org');
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         VALUES (gen_random_uuid(), $1, 'Q3 Planung', 'a0', 'page')`,
        [fx.workspaceId],
      );
      await remove(bert);

      assert.doesNotMatch(JSON.stringify(posted[0]!.letter), /Q3 Planung/);
    });

    test('and it offers nothing to press', async () => {
      // There is nothing for them to open. A button on this letter would lead
      // to the 404 the letter exists to explain.
      const bert = await member('bert@example.org');
      await remove(bert);

      assert.equal((posted[0]!.letter as { action?: unknown }).action, undefined);
    });

    // --- changed -------------------------------------------------------------

    test('a role change is announced with the new role', async () => {
      /*
       * **This test is named after a check it did not make.** It asserted the
       * workspace and the person who acted, under a title promising the role —
       * the same shape ADR-0135 found in a comment and ADR-0137 in a stylesheet,
       * arriving this time in a test's own name.
       *
       * So it names the role now, which is what let the next two exist.
       */
      const bert = await member('bert@example.org');
      await expectStatus(await setRole(bert, 'guest'), 200);

      assert.equal(posted.length, 1);
      const said = JSON.stringify(posted[0]!.letter);
      assert.match(said, /Haus/);
      assert.match(said, /Anna Weber/);
      assert.match(said, /Guest/);
    });

    test('and named in the reader’s language, not the row’s', async () => {
      /*
       * **The live fault** (ADR-0143). `roles.name` is seeded in English by a
       * migration, and both of these letters passed it straight through — so a
       * German reader of a fully German letter was told *„Sie sind jetzt Guest
       * in Haus."*
       *
       * The two letters whose entire subject is a role were the two that named
       * it in the wrong language, three rounds after ADR-0133 translated
       * everything around them.
       */
      const bert = await member('bert@example.org');
      await db.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [bert]);
      await expectStatus(await setRole(bert, 'guest'), 200);

      const said = JSON.stringify(posted[0]!.letter);
      assert.match(said, /Gast/);
      assert.doesNotMatch(said, /Guest/, 'and not the word the row happens to hold');
    });

    test('but a role this workspace made keeps the name somebody typed', async () => {
      /*
       * The other half, and the reason this is not "translate the role". There
       * is no German for „Redaktion" to find, and inventing one would rename
       * somebody's role in a letter.
       */
      const bert = await member('bert@example.org');
      await db.query(`UPDATE users SET locale = 'de' WHERE id = $1`, [bert]);
      const made = await db.query<{ id: string }>(
        `INSERT INTO roles (workspace_id, key, name, page_level)
         VALUES ($1, NULL, 'Redaktion', 'editor') RETURNING id`,
        [fx.workspaceId],
      );
      // By id, because a role this workspace made has no word to send
      // (ADR-0103) — which is the same fact that makes its name untranslatable.
      await expectStatus(
        await fetch(`${base}/api/workspaces/${fx.workspaceId}/members/${bert}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ roleId: made.rows[0]!.id }),
        }),
        200,
      );

      assert.match(JSON.stringify(posted[0]!.letter), /Redaktion/);
    });

    test('but a role set to the one somebody already has is not a change', async () => {
      /*
       * The saving-a-form case, and the one that would make this mail noise: an
       * administrator opens the members screen, presses save, and everybody in
       * the workspace gets a letter about nothing.
       */
      const bert = await member('bert@example.org');
      await expectStatus(await setRole(bert, 'member'), 200);

      assert.deepEqual(posted, []);
    });

    // --- who is not told -----------------------------------------------------

    test('an administrator acting on their own row hears nothing', async () => {
      /*
       * Somebody who just pressed the button knows what they did. A mail about
       * it is the kind of confirmation that teaches people to filter mail from
       * this instance — which is what would then hide the one that matters.
       */
      const other = await member('bert@example.org');
      await db.query(`UPDATE workspace_members SET is_owner = true WHERE user_id = $1`, [other]);

      await expectStatus(await setRole(fx.userId, 'member'), 200);
      assert.deepEqual(posted, []);
    });

    test('an account with no address is not written to', async () => {
      // A guest account has no address at all (ADR-0033), and there is nothing
      // to fall back to.
      const row = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES (NULL, 'Gast') RETURNING id`,
      );
      const guest = row.rows[0]!.id;
      await addMember(db, fx.workspaceId, guest, 'member');

      await expectStatus(await remove(guest), 200);
      assert.deepEqual(posted, []);
    });

    test('and a refusal to remove somebody sends nothing', async () => {
      // The mail follows the act. The last owner cannot be removed, and a
      // letter about a removal that did not happen is worse than none.
      await expectStatus(await remove(fx.userId), 409);
      assert.deepEqual(posted, []);
    });
  },
);
