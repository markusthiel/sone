/**
 * Share links.
 *
 * The logic was already tested; this covers the routes, which is where the
 * decisions about who may share and what a link may carry actually bite.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { hashPassword } from '../src/auth/password.js';
import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { registerShareRoutes } from '../src/http/share.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'share links (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
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
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
      registerPageRoutes(router, { pool: db });
      registerShareRoutes(router, {
        pool: db,
        publicUrl: 'https://sone.example.org',
        // Long enough to satisfy the same rule config.ts enforces.
        secretKey: 'a-test-secret-key-of-at-least-32-characters',
        secureCookies: false,
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

    const json = (body: unknown): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    function cookieFrom(res: Response): string {
      const header = res.headers.get('set-cookie');
      assert.ok(header);
      const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
      assert.ok(value);
      return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
    }

    async function setup(): Promise<{
      cookie: string;
      userId: string;
      workspaceId: string;
      pageId: string;
      folderId: string;
    }> {
      const res = await fetch(
        `${base}/api/auth/setup`,
        json({
          email: 'owner@example.org',
          password: PASSWORD,
          displayName: 'Owner',
          workspaceName: 'W',
        }),
      );
      const body = await expectJson<{ userId: string; workspaceId: string }>(res, 201);
      const cookie = cookieFrom(res);
      const folder = await db.query<{ id: string }>(
        `SELECT id FROM pages WHERE workspace_id = $1 AND kind = 'folder' LIMIT 1`,
        [body.workspaceId],
      );
      const page = await fetch(`${base}/api/workspaces/${body.workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ title: 'Shared', parentPageId: folder.rows[0]!.id }),
      });
      const created = await expectJson<{ id: string }>(page, 201);
      return {
        cookie,
        userId: body.userId,
        workspaceId: body.workspaceId,
        pageId: created.id,
        folderId: folder.rows[0]!.id,
      };
    }

    const create = (
      cookie: string,
      pageId: string,
      body: Record<string, unknown> = {},
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/share-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });

    const listLinks = async (
      cookie: string,
      pageId: string,
    ): Promise<Array<Record<string, unknown>>> => {
      const res = await fetch(`${base}/api/pages/${pageId}/share-links`, {
        headers: { cookie },
      });
      return (await expectJson<{ links: Array<Record<string, unknown>> }>(res)).links;
    };

    // --- showing a link again ------------------------------------------------

    const showAgain = (
      cookie: string,
      pageId: string,
      linkId: string,
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/share-links/${linkId}/url`, {
        headers: { cookie },
      });

    test('a link can be shown again by whoever administers the page', async () => {
      // The first design refused this, reasoning from passwords. A password is
      // the person's own secret; a share link is a capability its issuer can
      // mint again at will, so refusing to show it protected nothing and cost
      // them the link.
      const session = await setup();
      const created = await expectJson<{ id: string; token: string; url: string }>(
        await create(session.cookie, session.pageId),
        201,
      );

      const again = await expectJson<{ url: string }>(
        await showAgain(session.cookie, session.pageId, created.id),
      );
      assert.equal(again.url, created.url, 'the same link, not a new one');
    });

    test('the stored token is not readable from the database alone', async () => {
      // The reason it is encrypted rather than kept in plaintext: read-only SQL
      // access — a reporting user, a replica, a backup on a shared disk —
      // must not be escalated into write access through an editable link.
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId, { role: 'editor' }),
        201,
      );

      const row = await db.query<{ token_encrypted: Buffer }>(
        `SELECT token_encrypted FROM share_tokens WHERE scope_page_id = $1`,
        [session.pageId],
      );
      const stored = row.rows[0]!.token_encrypted;
      assert.ok(stored.length > 0, 'something is stored');
      assert.ok(
        !stored.toString('utf8').includes(created.token),
        'and it is not the token',
      );
      assert.ok(
        !stored.toString('latin1').includes(created.token),
        'under any reading of the bytes',
      );
    });

    test('a link stored under a different secret cannot be shown', async () => {
      // A rotated secret, or a record from another instance. Reported as "not
      // recoverable" rather than as a missing link, so the interface can offer
      // to replace it instead of implying the link is gone.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );

      // Corrupt the ciphertext, which is what a wrong key looks like to GCM.
      await db.query(
        `UPDATE share_tokens SET token_encrypted = decode('00112233445566778899aabbccddeeff00112233445566778899aabb', 'hex')
          WHERE id = $1`,
        [created.id],
      );

      const res = await showAgain(session.cookie, session.pageId, created.id);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: 'token_not_recoverable' });
    });

    test('a link created before this feature says so', async () => {
      // Every link that already exists has no stored token. It must not look
      // like a bug.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );
      await db.query(`UPDATE share_tokens SET token_encrypted = NULL WHERE id = $1`, [
        created.id,
      ]);

      const res = await showAgain(session.cookie, session.pageId, created.id);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: 'token_not_recoverable' });
    });

    test('a revoked link is not shown again', async () => {
      // Revocation has to be final. Handing the URL back afterwards would make
      // "Revoke" mean "hide", which is not what it says.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );
      await fetch(`${base}/api/pages/${session.pageId}/share-links/${created.id}`, {
        method: 'DELETE',
        headers: { cookie: session.cookie },
      });

      assert.equal(
        (await showAgain(session.cookie, session.pageId, created.id)).status,
        404,
      );
    });

    test('somebody who cannot administer the page cannot show a link', async () => {
      // The same right that creates a link. An editor who cannot issue one must
      // not be able to read one either.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );

      const hash = await hashPassword(PASSWORD);
      const other = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('editor@example.org','E',$1) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, other.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
         VALUES ($1,$2,'editor',true,$3)`,
        [session.pageId, other.rows[0]!.id, session.userId],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'editor@example.org', password: PASSWORD }),
      );

      const res = await showAgain(cookieFrom(login), session.pageId, created.id);
      assert.equal(res.status, 403);
    });

    // --- resolving a bare token --------------------------------------------

    test('resolving a token hands back a cookie', async () => {
      // Without it a share visitor has no HTTP credential at all — the token
      // authenticated the WebSocket and nothing else — so every image in a
      // shared page came back 401 and failed to load. An `<img src>` cannot
      // send a header, so a cookie is the only shape that works.
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId),
        201,
      );

      const res = await fetch(`${base}/api/share/${created.token}`);
      const header = res.headers.get('set-cookie') ?? '';
      assert.match(header, /sone_share=/);
      assert.match(header, /HttpOnly/, 'a script has no reason to read it');
      assert.match(header, /SameSite=Lax/, 'sent when following a link from an email');
    });

    test('a password-protected link hands back no cookie', async () => {
      // The cookie is a credential. Issuing it before the password is entered
      // would make the password decorative.
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId, { password: 'a-long-enough-one' }),
        201,
      );

      const res = await fetch(`${base}/api/share/${created.token}`);
      assert.equal(res.headers.get('set-cookie'), null);
    });

    test('a token resolves to the page it opens', async () => {
      // The fix for every link already sent out: those carry no page in the
      // path, and without this the client had a credential and nothing to open.
      // With edit rights, which is the case that was reported: opening an
      // editable link showed "Opening…" and nothing else.
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId, { role: 'editor' }),
        201,
      );

      const res = await fetch(`${base}/api/share/${created.token}`);
      const body = await expectJson<{
        requiresPassword: boolean;
        pageId: string;
        title: string;
        role: string;
      }>(res);

      assert.equal(body.requiresPassword, false);
      assert.equal(body.pageId, session.pageId, 'the page the client must open');
      assert.equal(body.role, 'editor', 'and that it may be edited');
    });

    test('resolving needs no session, because the token is the credential', async () => {
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId),
        201,
      );
      // No cookie at all.
      await expectStatus(await fetch(`${base}/api/share/${created.token}`), 200);
    });

    test('a protected link reports the requirement and nothing else', async () => {
      // A password protects the content, and a title is content.
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId, { password: 'a-long-enough-one' }),
        201,
      );

      const body = await expectJson<{ requiresPassword: boolean; pageId?: string }>(
        await fetch(`${base}/api/share/${created.token}`),
      );
      assert.equal(body.requiresPassword, true);
      assert.equal(body.pageId, undefined, 'the page is not revealed yet');
    });

    test('a revoked, expired or invented token all answer the same', async () => {
      // Telling them apart would let somebody probe for tokens that once
      // worked.
      const session = await setup();
      const created = await expectJson<{ token: string; id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );
      await fetch(
        `${base}/api/pages/${session.pageId}/share-links/${created.id}`,
        { method: 'DELETE', headers: { cookie: session.cookie } },
      );

      for (const token of [created.token, 'never-existed']) {
        const res = await fetch(`${base}/api/share/${token}`);
        assert.equal(res.status, 404, token);
        assert.deepEqual(await res.json(), { error: 'not_found' });
      }
    });

    test('a token whose page was archived is a dead link', async () => {
      // A clearer answer than an empty document.
      const session = await setup();
      const created = await expectJson<{ token: string }>(
        await create(session.cookie, session.pageId),
        201,
      );
      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [
        session.pageId,
      ]);

      assert.equal((await fetch(`${base}/api/share/${created.token}`)).status, 404);
    });

    test('a link can be created and carries a usable URL', async () => {
      const session = await setup();
      const body = await expectJson<{ token: string; url: string }>(
        await create(session.cookie, session.pageId),
        201,
      );
      assert.ok(body.token.length > 20, 'a token should be long enough to not guess');
      // The page is in the path.
      //
      // This test previously asserted the URL *without* it, which is how the
      // bug was locked in: a visitor arrived with a credential and nothing to
      // open, and the client sat on "Opening…" forever. /api/share/:token can
      // resolve a bare token, but a self-describing link works before that
      // request finishes and survives it failing.
      assert.equal(
        body.url,
        `https://sone.example.org/s/${body.token}/p/${session.pageId}`,
      );
    });

    test('the token is never returned again', async () => {
      // Only the hash is stored, so a lost link is regenerated rather than
      // recovered — the same reasoning as a password. A listing that could show
      // tokens would turn one screenshot of the sharing dialog into every link
      // on the page.
      const session = await setup();
      await create(session.cookie, session.pageId);

      const links = await listLinks(session.cookie, session.pageId);
      assert.equal(links.length, 1);
      for (const field of ['token', 'tokenHash', 'token_hash', 'url']) {
        assert.ok(!(field in links[0]!), `${field} must not be listed`);
      }
    });

    test('a link cannot grant admin', async () => {
      // Administration is not something a forwarded URL should confer.
      const session = await setup();
      const res = await create(session.cookie, session.pageId, { role: 'admin' });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'invalid_role' });
    });

    test('an unknown role is refused', async () => {
      const session = await setup();
      const res = await create(session.cookie, session.pageId, { role: 'owner' });
      assert.equal(res.status, 422);
    });

    test('an editor cannot share a page', async () => {
      // Changing a page is not the same as deciding who else may see it.
      // Handing out access is the one thing that cannot be undone by editing.
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      const editor = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('editor@example.org','E',$1) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, editor.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
         VALUES ($1,$2,'editor',false,$3)`,
        [session.pageId, editor.rows[0]!.id, session.userId],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'editor@example.org', password: PASSWORD }),
      );

      const res = await create(cookieFrom(login), session.pageId);
      assert.equal(res.status, 403);
    });

    test('somebody outside the workspace sees nothing', async () => {
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('outside@example.org','O',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'outside@example.org', password: PASSWORD }),
      );

      const res = await fetch(`${base}/api/pages/${session.pageId}/share-links`, {
        headers: { cookie: cookieFrom(login) },
      });
      // 404, not 403: the difference would confirm the page exists.
      assert.equal(res.status, 404);
    });

    test('an anonymous caller cannot list or create', async () => {
      const session = await setup();
      assert.equal(
        (await fetch(`${base}/api/pages/${session.pageId}/share-links`)).status,
        401,
      );
      assert.equal(
        (
          await fetch(`${base}/api/pages/${session.pageId}/share-links`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
        401,
      );
    });

    test('an empty password does not produce a protected-looking link', async () => {
      // Storing one would produce a link that reports a password and has none.
      const session = await setup();
      await create(session.cookie, session.pageId, { password: '   ' });
      const links = await listLinks(session.cookie, session.pageId);
      assert.equal(links[0]!['hasPassword'], false);
    });

    test('a password is recorded when there is one', async () => {
      const session = await setup();
      const res = await create(session.cookie, session.pageId, {
        password: 'a properly long passphrase',
      });
      await expectStatus(res, 201);
      const links = await listLinks(session.cookie, session.pageId);
      assert.equal(links[0]!['hasPassword'], true);
    });

    test('a link password must be as strong as an account password', async () => {
      // The same twelve-character minimum. A link password protects the same
      // content an account password does, and a four-character one on a link
      // that will be pasted into a chat is worse than none, because it is
      // believed to be protection.
      const session = await setup();
      const res = await create(session.cookie, session.pageId, { password: 'short' });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'weak_password' });
    });

    test('links on descendants are listed too', async () => {
      // A link two levels down is exactly the one that gets forgotten.
      const session = await setup();
      await create(session.cookie, session.pageId);

      const links = await listLinks(session.cookie, session.folderId);
      assert.equal(links.length, 1, 'the folder should show its child’s link');
      assert.equal(links[0]!['scopePageId'], session.pageId);
    });

    test('revoking removes the link and its sessions', async () => {
      // Otherwise somebody already reading keeps reading until their session
      // expires, which is not what "revoke" means to the person pressing it.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );

      await db.query(
        `INSERT INTO share_sessions (share_token_id, display_name, expires_at)
         VALUES ($1, 'Guest', now() + interval '1 day')`,
        [created.id],
      );

      const res = await fetch(
        `${base}/api/pages/${session.pageId}/share-links/${created.id}`,
        { method: 'DELETE', headers: { cookie: session.cookie } },
      );
      await expectStatus(res, 200);

      assert.deepEqual(await listLinks(session.cookie, session.pageId), []);
      const sessions = await db.query(
        `SELECT 1 FROM share_sessions WHERE share_token_id = $1`,
        [created.id],
      );
      assert.equal(sessions.rowCount, 0, 'the people using it are signed out');
    });

    test('a link belonging to another page cannot be revoked', async () => {
      // Otherwise an administrator of one page could revoke another's links.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await create(session.cookie, session.pageId),
        201,
      );

      const other = await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ title: 'Other', parentPageId: session.folderId }),
      });
      const otherPage = await expectJson<{ id: string }>(other, 201);

      const res = await fetch(
        `${base}/api/pages/${otherPage.id}/share-links/${created.id}`,
        { method: 'DELETE', headers: { cookie: session.cookie } },
      );
      assert.equal(res.status, 404);
    });

    test('an expiry is capped rather than accepted unbounded', async () => {
      const session = await setup();
      const body = await expectJson<{ expiresAt: string | null }>(
        await create(session.cookie, session.pageId, { expiresInDays: 100_000 }),
        201,
      );
      assert.ok(body.expiresAt, 'an expiry should be set');
      const years =
        (new Date(body.expiresAt!).getTime() - Date.now()) / (365 * 24 * 3600 * 1000);
      assert.ok(years < 11, `expiry should be capped, got ${years} years`);
    });

    test('no expiry means a link that does not expire', async () => {
      const session = await setup();
      const body = await expectJson<{ expiresAt: string | null }>(
        await create(session.cookie, session.pageId),
        201,
      );
      assert.equal(body.expiresAt, null);
    });
  },
);
