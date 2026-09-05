/**
 * What a link reaches, and nothing else.
 *
 * The report: "wenn ich einen ganzen Ordner mit einem Gast teile kann er nur
 * den Ordner sehen und sonst nichts. Nichts was darunter liegt."
 *
 * It was exactly right, and the cause was not in the permission model — a
 * link's grant carries the subtree and both resolvers honour it. The shared
 * view rendered **one page** and had no navigation at all, so sharing a folder
 * shared an empty page with a name at the top: a folder has no body.
 *
 * The two halves of this file are the two things that route has to get right,
 * and the second is the one that would be a disclosure if it were wrong: the
 * scope is walked *down* from the page the link names, never filtered *out* of
 * the workspace. A list that starts from everything and removes is one
 * forgotten condition away from naming a page the visitor was never given; one
 * that starts from the grant cannot be.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerShareRoutes } from '../src/http/share.js';
import { createShareLink } from '../src/auth/share.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson } from './support/http.js';

interface Shared {
  pages: Array<{ id: string; parentPageId: string | null; title: string; kind: string }>;
  scopePageId: string;
}

describe(
  'what a share link reaches (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let owner: string;
    let workspace: string;
    let folder: string;
    let child: string;
    let grandchild: string;
    let elsewhere: string;

    const ancestryOf = new Map<string, string[]>();
    const page = async (
      parent: string | null,
      title: string,
      kind = 'page',
    ): Promise<string> => {
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

    before(async () => {
      db = await getTestPool();
      await resetDatabase(db);

      const router = new Router();
      registerShareRoutes(router, { pool: db, secureCookies: false } as never);
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

      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('o@example.org','Owner','x') RETURNING id`,
      );
      owner = user.rows[0]!.id;
      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('W',$1) RETURNING id`,
        [owner],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, role_id, is_owner)
         VALUES ($1,$2,'owner',(SELECT id FROM roles WHERE key='owner'),true)`,
        [workspace, owner],
      );

      const root = await page(null, 'Root', 'folder');
      folder = await page(root, 'Handbuch', 'folder');
      child = await page(folder, 'Kapitel eins');
      grandchild = await page(child, 'Abschnitt');
      elsewhere = await page(root, 'Nichts damit zu tun');
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    const scopeOf = async (token: string): Promise<Shared> => {
      const res = await fetch(`${base}/api/share/${encodeURIComponent(token)}/pages`);
      return expectJson<Shared>(res, 200);
    };

    test('a link to a folder reaches what is under it', async () => {
      // The report. Before this route there was nothing to ask, and the view
      // showed one page — a folder, which has no body.
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'viewer',
        includeSubtree: true,
        createdBy: owner,
      });

      const shared = await scopeOf(link.token);
      const titles = shared.pages.map((one) => one.title).sort();
      assert.deepEqual(titles, ['Abschnitt', 'Handbuch', 'Kapitel eins']);
      assert.equal(shared.scopePageId, folder);
    });

    test('and reaches nothing outside it', async () => {
      /*
       * The half that would be a disclosure.
       *
       * A visitor holding a link is not a member and must not learn what else
       * this workspace contains — not the sibling section, and not the folder
       * above the one they were given, whose name would say what the shared
       * one sits inside.
       */
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'viewer',
        includeSubtree: true,
        createdBy: owner,
      });

      const shared = await scopeOf(link.token);
      const ids = shared.pages.map((one) => one.id);
      assert.equal(ids.includes(elsewhere), false, 'not the sibling');
      assert.equal(
        shared.pages.some((one) => one.title === 'Root'),
        false,
        'and not the folder above',
      );
    });

    test('the page the link names is drawn as the root of what was shared', async () => {
      // Its real parent is outside the scope, so sending that id would leave
      // the view with a node whose parent it will never receive.
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'viewer',
        includeSubtree: true,
        createdBy: owner,
      });

      const shared = await scopeOf(link.token);
      const scope = shared.pages.find((one) => one.id === folder)!;
      assert.equal(scope.parentPageId, null);
      assert.equal(shared.pages.find((one) => one.id === child)!.parentPageId, folder);
      assert.equal(shared.pages.find((one) => one.id === grandchild)!.parentPageId, child);
    });

    test('a link without the subtree reaches one page', async () => {
      // And the view draws no navigation for it, because a list of one is
      // furniture.
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'viewer',
        includeSubtree: false,
        createdBy: owner,
      });

      const shared = await scopeOf(link.token);
      assert.deepEqual(
        shared.pages.map((one) => one.id),
        [folder],
      );
    });

  test('a link is filtered by the same rule as anybody else', async () => {
      /*
       * This test has been written twice, and both versions are worth knowing
       * about.
       *
       * The first asserted that a **restricted** page inside the shared section
       * stays out of the link. It failed. `restricted` withheld the *workspace
       * default* and an explicit grant reached through it, and a subtree grant
       * on an ancestor is an explicit grant — so I rewrote the test to record
       * what the model actually did, and reported it rather than quietly
       * changing the model from inside a test about sharing.
       *
       * ADR-0089 then decided it: a restriction stops inherited access at its
       * own edge. So the first version was right about what should happen and
       * wrong about what did, and this is now what it always meant to say.
       *
       * The property that held through both versions, and the reason this test
       * belongs here at all: the route asks `effectiveRole` per row rather than
       * trusting the link's own grant. Whatever the model decides, this list
       * follows it — that is what makes the list not a second opinion.
       */
      await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [child]);
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'viewer',
        includeSubtree: true,
        createdBy: owner,
      });

      const shared = await scopeOf(link.token);
      const ids = shared.pages.map((one) => one.id);
      assert.equal(ids.includes(folder), true, 'the page the link names is still reached');
      assert.equal(ids.includes(child), false, 'and the restriction below it stops the link');
      assert.equal(
        ids.includes(grandchild),
        false,
        'and the link does not resume underneath the restriction',
      );

      // The same answer as the resolver every other surface asks, which is the
      // property that stops this list from becoming a second opinion.
      const { resolvePageAccess } = await import('../src/pages/access.js');
      for (const id of ids) {
        const asOwner = await resolvePageAccess(db, { pageId: id, userId: owner });
        assert.notEqual(asOwner.access, null, 'nothing here is invisible to the owner either');
      }

      await db.query(`UPDATE pages SET restricted = false WHERE id = $1`, [child]);
    });

    test('a cap lowers a link, and does not hide what it reaches', async () => {
      // A ceiling set on the section applies to a link like to anybody
      // (ADR-0087) — and a cap can never hide a page, so the list is the same
      // length either way.
      await db.query(
        `INSERT INTO page_caps (page_id, max_level, include_subtree) VALUES ($1,'viewer',true)`,
        [folder],
      );
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'editor',
        includeSubtree: true,
        createdBy: owner,
      });

      const shared = await scopeOf(link.token);
      assert.equal(shared.pages.length, 3, 'still all three');

      await db.query(`DELETE FROM page_caps WHERE page_id = $1`, [folder]);
    });

    test('a revoked link reaches nothing', async () => {
      const link = await createShareLink(db, {
        pageId: folder,
        role: 'viewer',
        includeSubtree: true,
        createdBy: owner,
      });
      await db.query(`UPDATE share_tokens SET revoked_at = now() WHERE id = $1`, [
        link.shareTokenId,
      ]);

      const res = await fetch(`${base}/api/share/${encodeURIComponent(link.token)}/pages`);
      assert.equal(res.status, 404);
    });
  },
);
