/**
 * Favourites.
 *
 * A person's shortcuts, stored in Postgres rather than in the CRDT — the
 * opposite of the choice made for folders, because the data is different. A
 * folder is a property of the workspace; a favourite is a property of one
 * person's relationship to a page.
 *
 * Most of these tests are about who can see whose.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { hashPassword } from '../src/auth/password.js';
import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerFavouriteRoutes } from '../src/http/favourites.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'favourites (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;

    before(async () => {
      db = await getTestPool();
      const router = new Router();
      registerAuthRoutes(router, { pool: db, signupMode: () => Promise.resolve('open' as const), secureCookies: false });
      registerPageRoutes(router, { pool: db });
      registerFavouriteRoutes(router, { pool: db });

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
      workspaceId: string;
      userId: string;
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
      const folder = await db.query<{ id: string }>(
        `SELECT id FROM pages WHERE workspace_id = $1 AND kind = 'folder' LIMIT 1`,
        [body.workspaceId],
      );
      return {
        cookie: cookieFrom(res),
        workspaceId: body.workspaceId,
        userId: body.userId,
        folderId: folder.rows[0]!.id,
      };
    }

    async function createPage(
      session: { cookie: string; workspaceId: string; folderId: string },
      title: string,
    ): Promise<string> {
      const res = await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ title, parentPageId: session.folderId }),
      });
      return (await expectJson<{ id: string }>(res, 201)).id;
    }

    const favourite = (cookie: string, pageId: string): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/favourite`, {
        method: 'PUT',
        headers: { cookie },
      });

    const unfavourite = (cookie: string, pageId: string): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/favourite`, {
        method: 'DELETE',
        headers: { cookie },
      });

    const list = async (cookie: string, workspaceId?: string): Promise<string[]> => {
      const res = await fetch(
        `${base}/api/favourites${workspaceId ? `?workspace=${workspaceId}` : ''}`,
        { headers: { cookie } },
      );
      const body = await expectJson<{ favourites: Array<{ pageId: string }> }>(res);
      return body.favourites.map((entry) => entry.pageId);
    };

    test('a page can be favourited and listed', async () => {
      const session = await setup();
      const pageId = await createPage(session, 'Important');

      await expectStatus(await favourite(session.cookie, pageId), 200);
      assert.deepEqual(await list(session.cookie), [pageId]);
    });

    test('favouriting twice is not an error', async () => {
      // PUT rather than POST, and it means what it says: retrying a request
      // that may have succeeded must be safe.
      const session = await setup();
      const pageId = await createPage(session, 'Important');

      await expectStatus(await favourite(session.cookie, pageId), 200);
      await expectStatus(await favourite(session.cookie, pageId), 200);
      assert.deepEqual(await list(session.cookie), [pageId]);
    });

    test('unfavouriting something that is not a favourite is not an error', async () => {
      const session = await setup();
      const pageId = await createPage(session, 'Important');
      await expectStatus(await unfavourite(session.cookie, pageId), 200);
      assert.deepEqual(await list(session.cookie), []);
    });

    test('favourites keep the order they were added in', async () => {
      const session = await setup();
      const first = await createPage(session, 'First');
      const second = await createPage(session, 'Second');
      const third = await createPage(session, 'Third');

      for (const id of [first, second, third]) await favourite(session.cookie, id);
      assert.deepEqual(await list(session.cookie), [first, second, third]);
    });

    test('a favourite can be reordered without touching the others', async () => {
      // Fractional indices, so two people reordering their own lists never
      // interact and no other row is rewritten (ADR-0015).
      const session = await setup();
      const first = await createPage(session, 'First');
      const second = await createPage(session, 'Second');
      const third = await createPage(session, 'Third');
      for (const id of [first, second, third]) await favourite(session.cookie, id);

      const before = await db.query<{ page_id: string; idx: string }>(
        `SELECT page_id, idx FROM favourites WHERE user_id = $1`,
        [session.userId],
      );

      await fetch(`${base}/api/favourites/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ pageId: third, afterPageId: null }),
      });

      assert.deepEqual(await list(session.cookie), [third, first, second]);

      const after = await db.query<{ page_id: string; idx: string }>(
        `SELECT page_id, idx FROM favourites WHERE user_id = $1`,
        [session.userId],
      );
      const changed = after.rows.filter((row) => {
        const previous = before.rows.find((other) => other.page_id === row.page_id);
        return previous?.idx !== row.idx;
      });
      assert.deepEqual(
        changed.map((row) => row.page_id),
        [third],
        'only the moved row is rewritten',
      );
    });

    test('an archived page drops out of the list but keeps its favourite', async () => {
      // A page can come back from the archive, and the shortcut should still be
      // there when it does.
      const session = await setup();
      const pageId = await createPage(session, 'Later');
      await favourite(session.cookie, pageId);

      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [pageId]);
      assert.deepEqual(await list(session.cookie), []);

      const rows = await db.query(`SELECT 1 FROM favourites WHERE page_id = $1`, [pageId]);
      assert.equal(rows.rowCount, 1, 'the row survives the archive');

      await db.query(`UPDATE pages SET archived_at = NULL WHERE id = $1`, [pageId]);
      assert.deepEqual(await list(session.cookie), [pageId]);
    });

    test('favourites are per person', async () => {
      const session = await setup();
      const pageId = await createPage(session, 'Mine');
      await favourite(session.cookie, pageId);

      const hash = await hashPassword(PASSWORD);
      const other = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('other@example.org','Other',$1) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
        [session.workspaceId, other.rows[0]!.id],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'other@example.org', password: PASSWORD }),
      );

      assert.deepEqual(
        await list(cookieFrom(login)),
        [],
        'favourites belong to a person, not to a page',
      );
    });

    test('losing access to a workspace hides its favourites', async () => {
      // The rows stay, so restoring membership restores the shortcuts, but the
      // pages must stop appearing immediately.
      const session = await setup();
      const pageId = await createPage(session, 'Shared');
      await favourite(session.cookie, pageId);
      assert.deepEqual(await list(session.cookie), [pageId]);

      await db.query(
        `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [session.workspaceId, session.userId],
      );
      assert.deepEqual(await list(session.cookie), []);
    });

    test('a page in an inaccessible workspace cannot be favourited', async () => {
      const session = await setup();
      const pageId = await createPage(session, 'Private');

      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('nosy@example.org','Nosy',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'nosy@example.org', password: PASSWORD }),
      );

      const res = await favourite(cookieFrom(login), pageId);
      // 404 rather than 403: the difference would confirm the page exists.
      assert.equal(res.status, 404);
    });

    test('an anonymous caller cannot favourite', async () => {
      const session = await setup();
      const pageId = await createPage(session, 'Page');
      const res = await fetch(`${base}/api/pages/${pageId}/favourite`, { method: 'PUT' });
      assert.equal(res.status, 401);
    });

    test('read-only access is enough to favourite', async () => {
      // A favourite is a bookmark, not an edit. Requiring write access would
      // mean someone with read-only access to a page they consult daily could
      // not keep a shortcut to it.
      const session = await setup();
      const pageId = await createPage(session, 'Reference');

      const hash = await hashPassword(PASSWORD);
      const reader = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('reader@example.org','R',$1) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
        [session.workspaceId, reader.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
         VALUES ($1,$2,'viewer',false,$3)`,
        [pageId, reader.rows[0]!.id, session.userId],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'reader@example.org', password: PASSWORD }),
      );

      await expectStatus(await favourite(cookieFrom(login), pageId), 200);
    });

    test('deleting a page removes its favourites', async () => {
      // Derived state should vanish with what it points at, and unlike a CRDT
      // update a favourite can never arrive before the row it references —
      // which is why this foreign key is kept where the page tree's were
      // dropped in migration 0003.
      const session = await setup();
      const pageId = await createPage(session, 'Doomed');
      await favourite(session.cookie, pageId);

      await db.query(`DELETE FROM pages WHERE id = $1`, [pageId]);
      const rows = await db.query(`SELECT 1 FROM favourites WHERE page_id = $1`, [pageId]);
      assert.equal(rows.rowCount, 0);
    });

    test('a workspace asks only for its own favourites', async () => {
      // The list is one person's and spans every workspace they belong to,
      // which is right for the data and wrong for a sidebar: a sidebar is a view
      // of one workspace, so a shortcut from another appeared in it and could
      // not be opened — and the refusal read as "you no longer have access to
      // this page", which is not what had happened.
      const session = await setup();
      const here = await createPage(session, 'Here');
      await expectStatus(await favourite(session.cookie, here), 200);

      // A second workspace of the same person, with its own favourited page.
      // Made in SQL: this test's router carries auth, pages and favourites, and
      // registering the workspace routes to create one would be a wider harness
      // for one row.
      const other = (
        await db.query<{ id: string }>(
          `INSERT INTO workspaces (name) VALUES ('Elsewhere') RETURNING id`,
        )
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [other, session.userId],
      );
      const otherFolder = (
        await db.query<{ id: string }>(
          `INSERT INTO pages (id, workspace_id, parent_page_id, idx, title, kind)
           VALUES (gen_random_uuid(), $1, NULL, 'a0', 'Notes', 'folder') RETURNING id`,
          [other],
        )
      ).rows[0]!.id;
      const there = await createPage(
        { cookie: session.cookie, workspaceId: other, folderId: otherFolder },
        'There',
      );
      await expectStatus(await favourite(session.cookie, there), 200);

      assert.deepEqual(await list(session.cookie, session.workspaceId), [here]);
      assert.deepEqual(await list(session.cookie, other), [there]);

      // Unscoped still answers with everything: the list itself is instance-wide
      // and the caller says which it means.
      assert.deepEqual((await list(session.cookie)).sort(), [here, there].sort());
    });
  },
);
