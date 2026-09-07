/**
 * Light and dark belong to a person (ADR-0124).
 *
 * Asked for with the branding step: *„hell/dunkel Standard, überschreibbar pro
 * Workspace und pro Nutzer"*. The middle level arrived with ADR-0123, because a
 * theme already layers instance under workspace. The top one lived in
 * `localStorage`: somebody who chose dark on their laptop signed in on their
 * phone and got light.
 *
 * ## What is actually being tested here
 *
 * Not the resolution — that is four lines in `@sone/core` with its own tests.
 * What the server has to get right is the **three-way** on the way in: absent,
 * null, and a value are three different requests, and every other field on this
 * route is a two-way.
 *
 * That distinction is also where an existing bug lives. `coalesce($n, column)`
 * means a null can never clear anything — so choosing "match my browser" for
 * the *language* has never worked either, and the same fix covers both.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { SetupKey } from '../src/auth/setupKey.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'light and dark (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    const setupGate = new SetupKey();

    /** A key that is valid right now — the gate is spent by a successful setup. */
    async function freshKey(): Promise<string> {
      return (await setupGate.openIfNeeded(db)) ?? '';
    }

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
        pool: db,
        /*
         * A gate for this suite, because setup now needs a key (ADR-0155).
         * An absent gate means closed, which is the right default and
         * would lock this suite out of the route it uses to create its
         * instance.
         */
        setupGate,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
      });

      server = createServer((req, res) => {
        void router.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    beforeEach(async () => {
      await resetDatabase(db);
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    async function setup(): Promise<string> {
      const res = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'chef@example.org',
          password: PASSWORD,
          displayName: 'Chef',
          workspaceName: 'Haus',
          setupKey: await freshKey(),
        }),
      });
      await expectStatus(res, 201);
      return cookieFrom(res);
    }

    const patch = (cookie: string, body: unknown): Promise<Response> =>
      fetch(`${base}/api/auth/profile`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const session = async (cookie: string): Promise<Record<string, unknown>> => {
      const body = await expectJson<{ user: Record<string, unknown> }>(
        await fetch(`${base}/api/auth/session`, { headers: { cookie } }),
        200,
      );
      return body.user;
    };

    test('an account starts with no answer of its own', async () => {
      // Which resolves to the device, where no workspace and no instance has
      // said otherwise — exactly what every account has had until now.
      const cookie = await setup();
      assert.equal((await session(cookie)).colorScheme, null);
    });

    test('and keeps the one it is given, wherever it signs in next', async () => {
      const cookie = await setup();
      await expectStatus(await patch(cookie, { colorScheme: 'dark' }), 204);
      assert.equal((await session(cookie)).colorScheme, 'dark');
    });

    test('“this device decides” is stored, not treated as silence', async () => {
      /*
       * The case the four states exist for. A workspace is dark; somebody in it
       * wants their laptop's own setting to rule. Stored as `system`, that
       * overrides the workspace; treated as "no answer", it would not — and
       * they would have to pick light or dark by hand and be wrong twice a day.
       */
      const cookie = await setup();
      await expectStatus(await patch(cookie, { colorScheme: 'system' }), 204);
      assert.equal((await session(cookie)).colorScheme, 'system');
    });

    test('and null clears it back to following the workspace', async () => {
      /*
       * The three-way this route did not have. Every other field here is
       * `coalesce($n, column)`, where absent and null are the same request —
       * and with a nullable column that means the value can be set and never
       * unset.
       */
      const cookie = await setup();
      await expectStatus(await patch(cookie, { colorScheme: 'dark' }), 204);
      await expectStatus(await patch(cookie, { colorScheme: null }), 204);
      assert.equal((await session(cookie)).colorScheme, null);
    });

    test('a field nobody sent is left alone', async () => {
      // The other half of the three-way, and the property the `coalesce` was
      // there for: the appearance screen patches one field and must not carry
      // somebody's mail preferences along.
      const cookie = await setup();
      await expectStatus(await patch(cookie, { colorScheme: 'dark' }), 204);
      await expectStatus(await patch(cookie, { displayName: 'Chefin' }), 204);

      const user = await session(cookie);
      assert.equal(user.colorScheme, 'dark');
      assert.equal(user.displayName, 'Chefin');
    });

    test('an unknown word is refused rather than stored', async () => {
      // The column has a CHECK, so an unchecked write would be a 500 where this
      // is a plain refusal — the rule the notification schedules already follow.
      const cookie = await setup();
      const res = await patch(cookie, { colorScheme: 'sepia' });
      assert.equal(res.status, 422);
      assert.equal((await session(cookie)).colorScheme, null, 'and nothing was written');
    });

    test('the language can be set back to “match my browser”', async () => {
      /*
       * **A bug this round found**, and the same shape as the one above.
       *
       * The appearance screen sends `locale: null` for "Systemsprache", and
       * `locale = coalesce($3, locale)` has always kept the old value — so
       * somebody who once chose German could never get back to following their
       * browser. ADR-0041 is explicit that absent is a meaningful state here:
       * *„somebody travelling between a German and an English machine keeps
       * getting each one's own"*.
       */
      const cookie = await setup();
      await expectStatus(await patch(cookie, { locale: 'de' }), 204);
      await expectStatus(await patch(cookie, { locale: null }), 204);
      assert.equal((await session(cookie)).locale, null);
    });
  },
);
