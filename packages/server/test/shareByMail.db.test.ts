/**
 * Handing a link over by mail (ADR-0126).
 *
 * Asked for as: *„Seiten teilen per Mail, Links teilen per Mail, Gast-Links per
 * Mail."*
 *
 * A share mail does not break ADR-0058's rule — it is an invitation **to**
 * content rather than content — but it is the mail most likely to. What it may
 * say is the link, who sent it, when it expires and one sentence the sender
 * typed; the page's title only where the instance allows a title to leave at
 * all.
 *
 * ## The property worth defending
 *
 * **The token never travels in the request.** The browser sends an address and
 * a note; the server decrypts the link it already holds and builds the URL
 * itself. A route that accepted a URL to mail would be a route that mails any
 * URL, from an authenticated account, to anywhere.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import type { Letter } from '../src/mail/letter.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { registerShareRoutes } from '../src/http/share.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'a link, sent (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    /** What the relay was handed, if anything. */
    let posted: Array<{ to: string; letter: Letter }> = [];
    /** Whether this instance has a relay at all, per test. */
    let hasRelay = true;
    /** How much a mail may name (ADR-0058). */
    let detail: 'title' | 'workspace' = 'title';

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, {
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
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
      registerPageRoutes(router, { pool: db });
      registerShareRoutes(router, {
        pool: db,
        publicUrl: 'https://sone.example.org',
        secretKey: 'a-test-secret-key-of-at-least-32-characters',
        secureCookies: false,
        canSendMail: () => Promise.resolve(hasRelay),
        emailDetail: () => Promise.resolve(detail),
        instanceName: () => Promise.resolve('Haus Thiel'),
        sendLetter: (to, letter) => {
          posted.push({ to, letter });
          return Promise.resolve();
        },
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
      posted = [];
      hasRelay = true;
      detail = 'title';
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    /** An account, a workspace and a page in it, with a link on the page. */
    async function shared(
      link: Record<string, unknown> = {},
    ): Promise<{ cookie: string; pageId: string; linkId: string }> {
      const res = await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Anna Weber',
          workspaceName: 'Haus',
        }),
      });
      const body = await expectJson<{ workspaceId: string }>(res, 201);
      const cookie = cookieFrom(res);

      const folder = await db.query<{ id: string }>(
        `SELECT id FROM pages WHERE workspace_id = $1 AND kind = 'folder' LIMIT 1`,
        [body.workspaceId],
      );
      const page = await expectJson<{ id: string }>(
        await fetch(`${base}/api/workspaces/${body.workspaceId}/pages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ title: 'Q3 Planung', parentPageId: folder.rows[0]!.id }),
        }),
        201,
      );

      const created = await expectJson<{ id: string }>(
        await fetch(`${base}/api/pages/${page.id}/share-links`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify(link),
        }),
        201,
      );
      return { cookie, pageId: page.id, linkId: created.id };
    }

    const send = (
      cookie: string,
      pageId: string,
      linkId: string,
      body: Record<string, unknown>,
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/share-links/${linkId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });

    // --- what is sent --------------------------------------------------------

    test('the link goes out, and the browser never handed it over', async () => {
      /*
       * The property this route exists for. A route that took a URL and mailed
       * it would be a route that mails *any* URL from an authenticated account
       * — the browser says who to write to, and the server says what to write.
       */
      const it = await shared();
      await expectStatus(await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' }), 200);

      assert.equal(posted.length, 1);
      assert.equal(posted[0]!.to, 'gast@example.org');
      const link = posted[0]!.letter.action?.url ?? '';
      assert.match(link, /^https:\/\/sone\.example\.org\/s\/[^/]+\/p\//, 'a real link, built here');
    });

    test('it says who sent it, and that is not content', async () => {
      // A name is not what the page says; ADR-0058's rule is about the writing.
      // Without it a share mail is an unexplained link from a stranger, which
      // is the shape of every phishing mail ever sent.
      const it = await shared();
      await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' });

      const said = JSON.stringify(posted[0]!.letter);
      assert.match(said, /Anna Weber/);
    });

    test('and it names the page only where a title may leave at all', async () => {
      /*
       * The instance's own setting decides (ADR-0058). An operator who cannot
       * accept a page title reaching a mailbox has said so once, and every mail
       * has to obey it — including the friendly one somebody sends by hand.
       */
      const it = await shared();
      await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' });
      assert.match(JSON.stringify(posted[0]!.letter), /Q3 Planung/);

      detail = 'workspace';
      posted = [];
      await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' });
      assert.doesNotMatch(JSON.stringify(posted[0]!.letter), /Q3 Planung/);
    });

    test('a sentence from the sender is carried, and only one', async () => {
      // The one piece of content in the letter, and it is the sender's own
      // words rather than the page's — which is the distinction that keeps this
      // mail an invitation rather than a leak.
      const it = await shared();
      await send(it.cookie, it.pageId, it.linkId, {
        to: 'gast@example.org',
        note: 'Das ist der Stand von gestern.',
      });

      assert.match(JSON.stringify(posted[0]!.letter), /Stand von gestern/);
    });

    test('and it never becomes a link of its own', async () => {
      /*
       * A URL somebody typed into a note is a URL this instance would be
       * vouching for — a mail from a name the reader trusts, with a link
       * pointing anywhere. The note is a line; the one link is the share link.
       * (Escaping is the renderer's job and is tested there.)
       */
      const it = await shared();
      await send(it.cookie, it.pageId, it.linkId, {
        to: 'gast@example.org',
        note: '<b>fett</b> https://evil.example/x',
      });

      const letter = posted[0]!.letter;
      const line = letter.lines.find((one) => one.text.includes('fett'));
      assert.ok(line, 'the note is a line');
      assert.equal(line.url, undefined, 'and carries no link');
      assert.equal(letter.lines.filter((one) => one.url).length, 0, 'no line links anywhere');
      assert.match(letter.action?.url ?? '', /sone\.example\.org/, 'the one link is ours');
    });

    test('a password on the link is announced and never included', async () => {
      /*
       * The mistake this test exists to prevent. A link with a password, and
       * the password in the same message, is a link with no password — and it
       * is the obvious "helpful" thing for a later change to add.
       */
      const it = await shared({ password: 'a-long-enough-password' });
      await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' });

      const said = JSON.stringify(posted[0]!.letter);
      assert.doesNotMatch(said, /a-long-enough-password/);
      assert.match(said, /password|Passwort/i, 'but they are told to expect one');
    });

    test('and when it expires, because that is what the reader needs to know', async () => {
      const it = await shared({ expiresInDays: 30 });
      await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' });
      assert.match(JSON.stringify(posted[0]!.letter), /\d{4}/, 'a date');
    });

    // --- who may, and when it is possible at all -----------------------------

    test('only somebody who could have made the link may send it', async () => {
      // Sending a link is handing out access, which is the one thing editing a
      // page does not entitle anybody to.
      const it = await shared();
      const res = await send('', it.pageId, it.linkId, { to: 'gast@example.org' });
      assert.equal(res.status, 401);
      assert.deepEqual(posted, []);
    });

    test('a link belonging to another page is not sendable through this one', async () => {
      // The same check the revoke route makes, and for the same reason.
      const it = await shared();
      const res = await send(it.cookie, it.pageId, '00000000-0000-4000-8000-000000000000', {
        to: 'gast@example.org',
      });
      assert.equal(res.status, 404);
    });

    test('an address that is not one is refused before anything is sent', async () => {
      const it = await shared();
      for (const to of ['', 'not-an-address', 'a@b']) {
        const res = await send(it.cookie, it.pageId, it.linkId, { to });
        assert.equal(res.status, 422, JSON.stringify(to));
      }
      assert.deepEqual(posted, []);
    });

    test('with no relay the route says so rather than pretending', async () => {
      /*
       * Absent rather than broken (ADR-0059). The interface hides the control
       * where there is no relay; the route still has to answer, because an
       * operator may switch mail off between the page loading and the button
       * being pressed — and "sent" would be a lie the sender acts on.
       */
      hasRelay = false;
      const it = await shared();
      const res = await send(it.cookie, it.pageId, it.linkId, { to: 'gast@example.org' });

      assert.equal(res.status, 422);
      assert.deepEqual(posted, []);
    });
  },
);
