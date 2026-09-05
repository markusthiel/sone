/**
 * What a restricted page shows to somebody the restriction excludes.
 *
 * ADR-0026 said it in one line: "a page somebody cannot see is absent rather
 * than shown and refused". The tree obeyed it from the first day. Six other
 * routes did not, and each said the same sentence in a comment while doing it:
 *
 *   > The listing condition above already excluded restricted pages, so this
 *   > second check only has to agree with it.
 *
 * True in exactly one of the seven places it appeared: the search route, which
 * really does filter first. In the other six there is no listing at all — the
 * page arrives as an id in the URL or the request body, or the query lists
 * everything and this filter is the only one there is. The sentence was a
 * reason not to look, pasted from the one route where looking was unnecessary.
 *
 * They were all found the same way, and not by a test: changing
 * `PageLocation.restricted` from a boolean to `restrictedAt: string | null`
 * (ADR-0089) made every caller say where the value comes from, and a literal
 * `null` with a paragraph explaining it is easy to read past when it is a
 * `false`.
 *
 * So this file asks the routes, as a **member** — somebody whose role gives
 * `editor` everywhere and who is therefore exactly who a restriction is set
 * against. Asking the resolver would prove nothing: the resolver was right the
 * whole time and was being handed the wrong page.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { SESSION_COOKIE } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { createSession } from '../src/auth/session.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

describe(
  'a restricted page, asked for directly (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let workspace: string;
    let owner: string;
    let member: string;
    let open: string;
    let section: string;
    let inside: string;

    let memberCookie: string;

    const asMember = async (path: string, init: RequestInit = {}): Promise<Response> =>
      fetch(`${base}${path}`, {
        ...init,
        headers: { cookie: memberCookie, 'content-type': 'application/json', ...init.headers },
      });

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);

      const router = new Router();
      registerPageRoutes(router, { pool: db } as never);
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
           ('o@example.org','Owner','x'), ('m@example.org','Member','x')
         RETURNING id`,
      );
      [owner, member] = users.rows.map((r) => r.id) as [string, string];

      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('W',$1) RETURNING id`,
        [owner],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, role_id, is_owner) VALUES
           ($1,$2,'owner',(SELECT id FROM roles WHERE key='owner'),true),
           ($1,$3,'member',(SELECT id FROM roles WHERE key='member'),false)`,
        [workspace, owner, member],
      );

      const ancestryOf = new Map<string, string[]>();
      const page = async (parent: string | null, title: string, kind = 'page'): Promise<string> => {
        const id = randomUUID();
        const ancestors = parent ? [...ancestryOf.get(parent)!, parent] : [];
        await db.query(
          `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
           VALUES ($1,$2,$3,$4,0,$5,$6)`,
          [id, workspace, parent, title, kind, ancestors],
        );
        ancestryOf.set(id, ancestors);
        return id;
      };

      const root = await page(null, 'Root', 'folder');
      open = await page(root, 'Offen', 'folder');
      section = await page(root, 'Personalakten', 'folder');
      inside = await page(section, 'Eine Akte');
      await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [section]);

      memberCookie = `${SESSION_COOKIE}=${encodeURIComponent(
        (await createSession(db, member)).token,
      )}`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    test('its metadata is not handed out by id', async () => {
      /*
       * The worst of the six, because a title is the disclosure ADR-0026 names
       * explicitly, and the tree has hidden this page since restrictions
       * existed. Somebody who saw the name once — in a link, in a mention, in a
       * search result from before the restriction — could read it back
       * afterwards, and the answer was 200.
       */
      assert.equal((await asMember(`/api/pages/${section}`)).status, 404, 'the section itself');
      assert.equal((await asMember(`/api/pages/${inside}`)).status, 404, 'and a page inside it');

      const fine = await asMember(`/api/pages/${open}`);
      assert.equal(fine.status, 200, 'an ordinary page is unaffected');
    });

    test('a tag on it is not counted for everybody', async () => {
      /*
       * Quieter, and the same disclosure at one remove: a tag list that says
       * "Kündigung (3)" reports what exists in a section somebody may not
       * enter. The tag query has no visibility condition at all, which is why
       * the per-row check is the only one there is.
       */
      await db.query(
        `INSERT INTO page_tags (workspace_id, page_id, tag_key, tag_label)
         VALUES ($1,$2,'kuendigung','Kündigung'), ($1,$3,'offen','Offen')`,
        [workspace, inside, open],
      );

      const res = await asMember(`/api/workspaces/${workspace}/tags`);
      const body = (await res.json()) as { tags: Array<{ key: string; count: number }> };
      const keys = body.tags.map((one) => one.key);

      assert.equal(keys.includes('kuendigung'), false, 'nothing from the restricted section');
      assert.equal(keys.includes('offen'), true, 'and everything else is still counted');

      await db.query(`DELETE FROM page_tags WHERE workspace_id = $1`, [workspace]);
    });

    test('it does not appear in the trash', async () => {
      // Archiving does not lift a restriction, and the trash lists what is
      // archived with no visibility condition of its own.
      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [inside]);

      const res = await asMember(`/api/workspaces/${workspace}/trash`);
      const body = (await res.json()) as { entries: Array<{ id: string }> };
      assert.equal(
        body.entries.some((one) => one.id === inside),
        false,
        'a restricted page stays out of the trash it was never visible in',
      );

      await db.query(`UPDATE pages SET archived_at = NULL WHERE id = $1`, [inside]);
    });

    test('nothing can be created inside it', async () => {
      /*
       * The one that writes. A create takes its parent as an id in the body, so
       * nothing filtered it — a member could put a page into a folder they
       * cannot open, and it would then sit there, invisible to them and visible
       * to the people the section is for.
       */
      const res = await asMember(`/api/workspaces/${workspace}/pages`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Untergeschoben', parentPageId: section }),
      });
      assert.equal(res.status, 403);

      const allowed = await asMember(`/api/workspaces/${workspace}/pages`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Ganz normal', parentPageId: open }),
      });
      assert.equal(allowed.status, 201, 'an ordinary folder still takes a page');
    });

    test('an earlier version of it cannot be restored', async () => {
      /*
       * The sixth, and the one with the smallest surface: restoring a version
       * overwrites the page's document, so a member who could not open the page
       * could still replace its contents with an earlier state of itself.
       *
       * Asserted as a 403 rather than "not 200", and the difference is the
       * whole test: the guard runs *before* the version is loaded, so a route
       * that refuses says 403 for a version id that does not exist, and a route
       * that lets the member past says 404 when it fails to find it.
       */
      const res = await asMember(`/api/pages/${inside}/versions/999999/restore`, {
        method: 'POST',
      });
      assert.equal(res.status, 403, 'refused for the page, not for the version');
    });

    test('and nothing can be restored into it', async () => {
      // The same door, from the other side: restore names its destination in
      // the body too.
      const loose = randomUUID();
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids,
                            archived_at)
         VALUES ($1,$2,NULL,'Wiederherstellbar','0','page','{}', now())`,
        [loose, workspace],
      );

      const res = await asMember(`/api/pages/${loose}/restore`, {
        method: 'POST',
        body: JSON.stringify({ parentPageId: section }),
      });
      assert.notEqual(res.status, 200, 'a restricted folder is not a destination');

      await db.query(`DELETE FROM pages WHERE id = $1`, [loose]);
    });
  },
);
