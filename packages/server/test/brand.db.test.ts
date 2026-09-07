/**
 * An instance has a look of its own (ADR-0123).
 *
 * Asked for as: *„Dann noch für die Verwaltung, dass man ein Logo festlegen
 * kann, quadratisch, und ein Basis-Design das genutzt wird, wenn im Workspace
 * nichts eingestellt ist."*
 *
 * Two things, and the second is the one with the argument in it. A base design
 * is not a new mechanism: a theme has always been *gaps filled, never a
 * replacement*, and this is that sentence applied one level up. What is new is
 * that the layer underneath a workspace is no longer the stylesheet alone.
 *
 * ## Both of these are visible before anybody signs in
 *
 * That is the whole point of an instance's look, and it decides most of what is
 * asserted here. The sign-in screen has to carry the logo and the colours, so
 * they travel on `/api/instance` — the one route that answers before there is a
 * session — and the logo's bytes are served without one.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAdminRoutes } from '../src/admin/routes.js';
import { SettingsStore, validate } from '../src/admin/settings.js';
import { registerBrandRoutes } from '../src/files/routes.js';
import { LocalFileStore } from '../src/files/store.js';
import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

/** The smallest thing `detectType` will call a PNG. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da6360000002000100' +
    '05fe02fea7000000004945' +
    '4e44ae426082',
  'hex',
);

describe(
  'an instance has a look of its own (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let settings: SettingsStore;
    let root: string;
    let store: LocalFileStore;

    before(async () => {
      db = await getTestPool();
      root = await mkdtemp(path.join(tmpdir(), 'sone-brand-'));
      store = new LocalFileStore(root);
      settings = new SettingsStore(db, {
        signupMode: 'open',
        instanceName: 'Haus Thiel',
        allowWorkspaceCreation: true,
        defaultLocale: 'en',
        addressForm: 'informal' as const,
        smtpHost: '',
        smtpPort: '587',
        smtpUser: '',
        smtpFrom: '',
        smtpSecurity: 'starttls' as const,
        emailDetail: 'title' as const,
        requireSecondFactor: false,
        requireSecondFactorSince: '',
        imapHost: '',
        imapPort: '993',
        imapUser: '',
        imapFolder: 'INBOX',
        replyMailbox: '',
      });

      const router = new Router();
      registerAuthRoutes(router, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('Haus Thiel'),
        brand: () => settings.brand(),
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
      });
      registerAdminRoutes(router, {
        pool: db,
        oidcClientSecret: null,
        settings,
        version: 'test',
        commit: 'abc1234',
        checkStorage: () => Promise.resolve(null),
        sendTestMail: () => Promise.resolve(),
        smtpPassword: '',
        tellFactorRemoved: () => Promise.resolve(),
      });
      registerBrandRoutes(router, { pool: db, store, settings, maxUploadBytes: 1_000_000 });

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
      await rm(root, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await resetDatabase(db);
      settings.invalidate();
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    /** The bootstrap account, which administers the instance. */
    async function setup(): Promise<string> {
      const res = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'chef@example.org',
          password: PASSWORD,
          displayName: 'Chef',
          workspaceName: 'Haus',
        }),
      });
      await expectStatus(res, 201);
      return cookieFrom(res);
    }

    // --- what may be stored --------------------------------------------------

    test('a base design is a theme, checked by the rules every theme is', () => {
      /*
       * Not a second door. A theme reaching the instance goes through the same
       * `sanitiseTheme` a workspace's does, so an administrator cannot express
       * anything a workspace could not — which matters more here, because this
       * one is what everybody sees who has set nothing.
       */
      assert.deepEqual(validate('brandTheme', { accent: '#336699', nonsense: 1 }), {
        accent: '#336699',
      });
      // Unusable parts are dropped rather than rejected, the rule a theme has
      // always followed: one stale field must not cost an instance the rest.
      assert.deepEqual(validate('brandTheme', { surfaces: { page: 'inverted' } }), {});
      assert.equal(validate('brandTheme', 'a string'), undefined);
    });

    test('a logo is a key and the type its bytes actually are', () => {
      /*
       * One value and not two settings, because they must not drift: a key
       * stored beside the wrong type is a PNG served as a JPEG, and the browser
       * that refuses it is right.
       *
       * The key pattern is the storage layer's own — a value that cannot name
       * an object is not a logo, whatever it looks like.
       */
      const key = `ab/${'c'.repeat(62)}.png`;
      assert.deepEqual(validate('brandLogo', { key, mime: 'image/png' }), {
        key,
        mime: 'image/png',
      });
      assert.equal(validate('brandLogo', { key: '../etc/passwd', mime: 'image/png' }), undefined);
      assert.equal(validate('brandLogo', { key, mime: 'text/html' }), undefined);
    });

    // --- what reaches the sign-in screen -------------------------------------

    test('the brand travels with the instance, before there is a session', async () => {
      /*
       * The decision the rest of this follows from. An instance's look that
       * only appears once somebody is inside is branding for people who already
       * know where they are.
       *
       * `/api/instance` is the one route that answers with nobody signed in —
       * it already carries the form of address for exactly this reason
       * (ADR-0041) — so the brand goes there rather than on the session.
       */
      await setup();
      await settings.set('brandTheme', { accent: '#993366' }, null);

      const res = await fetch(`${base}/api/instance`);
      const body = await expectJson<{
        brand: { name: string; theme: { accent?: string }; logo: string | null };
      }>(res, 200);

      assert.equal(body.brand.name, 'Haus Thiel');
      assert.equal(body.brand.theme.accent, '#993366');
      assert.equal(body.brand.logo, null, 'no logo set, and said so rather than guessed');
    });

    test('an instance with nothing set says so, rather than a default', async () => {
      // Absent and "as the design decides" are the same state (ADR-0021). An
      // empty theme is what a fresh instance has, and it must render exactly as
      // every instance rendered before there was branding.
      const res = await fetch(`${base}/api/instance`);
      const body = await expectJson<{ brand: { theme: Record<string, unknown> } }>(res, 200);
      assert.deepEqual(body.brand.theme, {});
    });

    // --- the logo ------------------------------------------------------------

    test('an administrator puts a logo up, and anybody may fetch it', async () => {
      /*
       * Unauthenticated on purpose, and the only file on this instance that is.
       * It is drawn on the sign-in page, so requiring a session to see it would
       * be requiring a session to see the sign-in page.
       *
       * It leaks that the instance has a logo, which is visible from the
       * sign-in page regardless.
       */
      const cookie = await setup();
      const put = await fetch(`${base}/api/admin/brand/logo/light`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'image/png' },
        body: PNG,
      });
      await expectStatus(put, 200);

      const instance = await expectJson<{ brand: { logo: string | null } }>(
        await fetch(`${base}/api/instance`),
        200,
      );
      assert.ok(instance.brand.logo, 'the instance now says where its logo is');

      const image = await fetch(`${base}${instance.brand.logo}`);
      assert.equal(image.status, 200, 'and it is served to nobody in particular');
      assert.equal(image.headers.get('content-type'), 'image/png');
    });

    test('the address changes when the picture does', async () => {
      /*
       * The bytes at a storage key never change — the key is their hash — so
       * the answer may be cached hard. That is only safe because the *address*
       * carries the key: a new logo is a new URL, and nobody is shown last
       * month's mark out of a proxy.
       */
      const cookie = await setup();
      await fetch(`${base}/api/admin/brand/logo/light`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'image/png' },
        body: PNG,
      });

      const instance = await expectJson<{ brand: { logo: string } }>(
        await fetch(`${base}/api/instance`),
        200,
      );
      assert.match(instance.brand.logo, /\?v=[0-9a-f]+/);

      const image = await fetch(`${base}${instance.brand.logo}`);
      assert.match(image.headers.get('cache-control') ?? '', /immutable/);
    });

    test('only an administrator may change it', async () => {
      // A logo is the instance saying who it is, and an ordinary member saying
      // it instead is the one thing branding must not allow.
      await setup();
      const res = await fetch(`${base}/api/admin/brand/logo/light`, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: PNG,
      });
      assert.equal(res.status, 401);
    });

    test('the bytes decide what it is, not what was declared', async () => {
      // The rule every upload here follows: a browser sends `image/png` for
      // anything, and a file stored under a type it does not have is a file
      // that will be served under that type.
      const cookie = await setup();
      const res = await fetch(`${base}/api/admin/brand/logo/light`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'image/png' },
        body: Buffer.from('<svg onload=alert(1)>', 'utf8'),
      });
      assert.equal(res.status, 415);
    });

    /*
     * The second mark, for the surfaces the first one cannot be read on
     * (ADR-0149).
     *
     * Reported as *„bei einigen macht das Helle Logo mehr Sinn bei anderen das
     * dunkle"*. Two uploads, one route with a variant, and no third place that
     * knows what a logo is.
     */
    test('a second mark can be put up for dark surfaces, and is served too', async () => {
      const cookie = await setup();
      for (const variant of ['light', 'dark']) {
        await expectStatus(
          await fetch(`${base}/api/admin/brand/logo/${variant}`, {
            method: 'PUT',
            headers: { cookie, 'content-type': 'image/png' },
            body: PNG,
          }),
          200,
        );
      }

      const instance = await expectJson<{
        brand: { logo: string | null; logoOnDark: string | null };
      }>(await fetch(`${base}/api/instance`), 200);
      assert.ok(instance.brand.logo, 'the one for light grounds');
      assert.ok(instance.brand.logoOnDark, 'and the one for dark ones');
      assert.notEqual(instance.brand.logo, instance.brand.logoOnDark, 'two addresses');

      for (const address of [instance.brand.logo, instance.brand.logoOnDark]) {
        const image = await fetch(`${base}${address}`);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/png');
      }
    });

    test('a mark uploaded before there were two is the one for light grounds', async () => {
      /*
       * The compatibility that matters, and it is the **setting** rather than a
       * path: an instance that uploaded a mark before ADR-0149 has it in
       * `brandLogo`, and that is where the light one lives. Written straight
       * into the settings table, because that is exactly the state such an
       * instance is in after an upgrade — no route involved.
       *
       * The route it was uploaded through is gone: nothing in the interface
       * called it once both marks were named, which is what
       * `check-routes-reachable` is for.
       */
      const cookie = await setup();
      await expectStatus(
        await fetch(`${base}/api/admin/brand/logo/light`, {
          method: 'PUT',
          headers: { cookie, 'content-type': 'image/png' },
          body: PNG,
        }),
        200,
      );

      const instance = await expectJson<{
        brand: { logo: string | null; logoOnDark: string | null };
      }>(await fetch(`${base}/api/instance`), 200);
      assert.ok(instance.brand.logo, 'served as the light-ground mark');
      assert.equal(instance.brand.logoOnDark, null, 'and the other stays absent');
      assert.equal((await fetch(`${base}${instance.brand.logo}`)).status, 200);
    });

    test('one variant is taken away without taking the other', async () => {
      const cookie = await setup();
      for (const variant of ['light', 'dark']) {
        await fetch(`${base}/api/admin/brand/logo/${variant}`, {
          method: 'PUT',
          headers: { cookie, 'content-type': 'image/png' },
          body: PNG,
        });
      }
      await expectStatus(
        await fetch(`${base}/api/admin/brand/logo/dark`, { method: 'DELETE', headers: { cookie } }),
        200,
      );

      const instance = await expectJson<{
        brand: { logo: string | null; logoOnDark: string | null };
      }>(await fetch(`${base}/api/instance`), 200);
      assert.ok(instance.brand.logo, 'the other one is untouched');
      assert.equal(instance.brand.logoOnDark, null);
    });

    test('a variant nobody has heard of is refused', async () => {
      const cookie = await setup();
      const res = await fetch(`${base}/api/admin/brand/logo/sepia`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'image/png' },
        body: PNG,
      });
      assert.equal(res.status, 404);
    });

    test('taking it away leaves the mark the interface draws itself', async () => {
      const cookie = await setup();
      await fetch(`${base}/api/admin/brand/logo/light`, {
        method: 'PUT',
        headers: { cookie, 'content-type': 'image/png' },
        body: PNG,
      });
      await expectStatus(
        await fetch(`${base}/api/admin/brand/logo/light`, { method: 'DELETE', headers: { cookie } }),
        200,
      );

      const instance = await expectJson<{ brand: { logo: string | null } }>(
        await fetch(`${base}/api/instance`),
        200,
      );
      assert.equal(instance.brand.logo, null);
    });
  },
);
