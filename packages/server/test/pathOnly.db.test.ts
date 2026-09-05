/**
 * A page kept as the path to a granted child, through the route that sends it.
 *
 * ADR-0026: "a page they cannot see with children they can still has to appear
 * as a path to them". The tree route computed exactly that, called it
 * `path_only`, explained it in a comment — and the filter two lines below
 * dropped those rows, because a page nobody may read resolves to no role.
 *
 * The reason nobody noticed is the reason this test is at the route and not at
 * the resolver: a **member** survived by accident, because the filter was told
 * the page was unrestricted and their role then answered `editor` for it. Only
 * a **guest** lost the path — and a guest is the entire case the feature exists
 * for. A test of the resolver would have agreed with the resolver; only asking
 * the route what a guest receives shows it.
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
import { expectJson } from './support/http.js';

interface Listed {
  pages: Array<{
    id: string;
    parentPageId: string | null;
    title: string | null;
    pathOnly: boolean;
  }>;
}

describe(
  'a page kept as a path (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let workspace: string;
    let owner: string;
    let guest: string;
    let member: string;
    let section: string;
    let granted: string;

    const cookies = new Map<string, string>();

    const treeFor = async (userId: string): Promise<Listed> => {
      const res = await fetch(`${base}/api/workspaces/${workspace}/pages`, {
        headers: { cookie: cookies.get(userId)! },
      });
      return expectJson<Listed>(res, 200);
    };

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
           ('o@example.org','Owner','x'), ('g@example.org','Guest','x'),
           ('m@example.org','Member','x')
         RETURNING id`,
      );
      [owner, guest, member] = users.rows.map((r) => r.id) as [string, string, string];

      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('W',$1) RETURNING id`,
        [owner],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, role_id, is_owner) VALUES
           ($1,$2,'owner',(SELECT id FROM roles WHERE key='owner'),true),
           ($1,$3,'guest',(SELECT id FROM roles WHERE key='guest'),false),
           ($1,$4,'member',(SELECT id FROM roles WHERE key='member'),false)`,
        [workspace, owner, guest, member],
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
      section = await page(root, 'Personalakten', 'folder');
      granted = await page(section, 'Eine Akte');

      // The shape the feature is for: a section nobody reaches by role, and one
      // page inside it given to one person.
      await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [section]);
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'editor')`,
        [granted, guest],
      );

      for (const id of [owner, guest, member]) {
        const token = (await createSession(db, id)).token;
        cookies.set(id, `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
      }
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    test('a guest gets the granted page and the path to it', async () => {
      // The bug, in the form the person saw it: before this, the guest received
      // only "Eine Akte", whose parent was missing — so the sidebar drew it at
      // the top level, outside the section it lives in.
      const tree = await treeFor(guest);
      const byId = new Map(tree.pages.map((one) => [one.id, one]));

      assert.ok(byId.has(granted), 'the page they were given');
      assert.ok(byId.has(section), 'and the section it lives in, as a path');
      assert.equal(byId.get(granted)!.parentPageId, section, 'in its place');
    });

    test('the path gives up its name', async () => {
      /*
       * The name is what was withheld. Sending it "so the interface can hide
       * it" is sending it — the row exists to be a rung, not a disclosure.
       */
      const tree = await treeFor(guest);
      const path = tree.pages.find((one) => one.id === section)!;

      assert.equal(path.pathOnly, true);
      assert.equal(path.title, null, 'no title, not a blanked one');
      assert.equal(
        tree.pages.find((one) => one.id === granted)!.pathOnly,
        false,
        'and the granted page keeps its own',
      );
    });

    test('it is a path and not a way in', async () => {
      // A rung is not access. Nothing else about the restricted section reaches
      // the guest — not its siblings, and not the pages beside the one granted.
      const sibling = randomUUID();
      await db.query(
        `INSERT INTO pages (id, workspace_id, parent_page_id, title, idx, kind, ancestor_ids)
         SELECT $1, workspace_id, id, 'Andere Akte', '1', 'page',
                array_append(ancestor_ids, id)
           FROM pages WHERE id = $2`,
        [sibling, section],
      );

      const tree = await treeFor(guest);
      assert.equal(
        tree.pages.some((one) => one.id === sibling),
        false,
        'the page beside it stays out entirely',
      );

      await db.query(`DELETE FROM pages WHERE id = $1`, [sibling]);
    });

    test('a member who reaches nothing inside sees no path either', async () => {
      /*
       * The counterweight, and the reason the condition is `path_only` rather
       * than "keep restricted rows".
       *
       * A path appears because something below it was granted. The member has
       * nothing there, so the section is simply absent — as it was before any
       * of this, and as ADR-0026 requires: a restricted page is *absent*, not
       * shown and refused.
       */
      const tree = await treeFor(member);
      assert.equal(
        tree.pages.some((one) => one.id === section),
        false,
        'no rung to a room they were not let into',
      );
      assert.equal(tree.pages.some((one) => one.id === granted), false);
    });

    test('the owner sees the section itself, with its name', async () => {
      // Whoever the workspace makes a page admin sees it all, restricted or
      // not: they are the people who have to be able to undo a restriction.
      const tree = await treeFor(owner);
      const row = tree.pages.find((one) => one.id === section)!;
      assert.equal(row.pathOnly, false);
      assert.equal(row.title, 'Personalakten');
    });
  },
);
