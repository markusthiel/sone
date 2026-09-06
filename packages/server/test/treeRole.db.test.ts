/**
 * What each entry in the tree lets this person do (ADR-0095).
 *
 * Named in ADR-0092 and deliberately left: *"a **member** with viewer rights on
 * a folder gets the same input and the same three buttons in the workspace,
 * because the page tree carries no per-entry role for the shell to ask."*
 *
 * The route already knows. It computes `effectiveRole` for **every row** —
 * that is the filter that decides which rows are sent at all — and then throws
 * the answer away and sends a list of pages that all look alike. So the
 * interface offered a rename field and three create buttons on a folder
 * somebody may only read, and the server answered 403 to each of them.
 *
 * The scenario is a restricted folder with an explicit `viewer` grant, because
 * that is how a member comes to have less than their workspace standing: a
 * restriction is a fence, and the standing does not cross it (ADR-0089). A
 * grant of `viewer` alongside an `editor` standing would simply lose to it.
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
    title: string | null;
    pathOnly: boolean;
    role: string | null;
  }>;
}

describe(
  'the tree says what each entry allows (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let workspace: string;
    let owner: string;
    let member: string;
    let guest: string;
    /** Open to the workspace. A member writes here. */
    let open: string;
    /** Restricted, with the member given `viewer` on it. */
    let readOnly: string;
    /** Inside it, so the fence's reach is visible too. */
    let inside: string;
    /** Restricted, with nothing granted inside it for the guest. */
    let closed: string;
    /** The one page the guest was given, inside `closed`. */
    let granted: string;

    const cookies = new Map<string, string>();

    const treeFor = async (userId: string): Promise<Listed> => {
      const res = await fetch(`${base}/api/workspaces/${workspace}/pages`, {
        headers: { cookie: cookies.get(userId)! },
      });
      return expectJson<Listed>(res, 200);
    };

    const roleOf = async (userId: string, pageId: string): Promise<string | null> => {
      const tree = await treeFor(userId);
      const entry = tree.pages.find((one) => one.id === pageId);
      assert.ok(entry, 'the entry is in the tree at all');
      return entry.role;
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
           ('o@example.org','Owner','x'), ('m@example.org','Member','x'),
           ('g@example.org','Guest','x')
         RETURNING id`,
      );
      [owner, member, guest] = users.rows.map((r) => r.id) as [string, string, string];

      const ws = await db.query<{ id: string }>(
        `INSERT INTO workspaces (name, created_by) VALUES ('W',$1) RETURNING id`,
        [owner],
      );
      workspace = ws.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner) VALUES
           ($1,$2,(SELECT id FROM roles WHERE key='owner'),true),
           ($1,$3,(SELECT id FROM roles WHERE key='member'),false),
           ($1,$4,(SELECT id FROM roles WHERE key='guest'),false)`,
        [workspace, owner, member, guest],
      );

      const ancestryOf = new Map<string, string[]>();
      const page = async (
        parent: string | null,
        title: string,
        kind = 'folder',
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

      const root = await page(null, 'Root');
      open = await page(root, 'Offen');
      readOnly = await page(root, 'Nur lesen');
      inside = await page(readOnly, 'Darin', 'page');
      closed = await page(root, 'Personalakten');
      granted = await page(closed, 'Eine Akte', 'page');

      // The folder the report is about: restricted, so the member's workspace
      // standing stops at its edge, and given to them as `viewer` explicitly.
      await db.query(`UPDATE pages SET restricted = true WHERE id IN ($1,$2)`, [
        readOnly,
        closed,
      ]);
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role, include_subtree)
         VALUES ($1,$2,'viewer',true)`,
        [readOnly, member],
      );
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1,$2,'editor')`,
        [granted, guest],
      );

      for (const id of [owner, member, guest]) {
        const token = (await createSession(db, id)).token;
        cookies.set(id, `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
      }
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeTestPool();
    });

    test('a member with viewer on a folder is told so', async () => {
      // The report. Before this the entry looked exactly like the one beside
      // it, so the shell drew a rename field and three create buttons on a
      // folder every one of whose writes the server refuses.
      assert.equal(await roleOf(member, readOnly), 'viewer');
    });

    test('and keeps their own rights on the folder beside it', async () => {
      // The counterweight: the fix must not read as "a member sees less". Their
      // standing is untouched everywhere the fence is not.
      assert.equal(await roleOf(member, open), 'editor');
    });

    test('the fence reaches what is inside it', async () => {
      // `include_subtree`, and the same viewer role: a page inside a folder
      // somebody may only read is a page they may only read.
      assert.equal(await roleOf(member, inside), 'viewer');
    });

    test('an owner is admin on all of it', async () => {
      // Including the restricted folders — a restriction that locked out the
      // people who can undo it would be a trap (ADR-0089).
      assert.equal(await roleOf(owner, readOnly), 'admin');
      assert.equal(await roleOf(owner, closed), 'admin');
    });

    test('a page kept only as a path allows nothing, and says so', async () => {
      /*
       * A path row is the case where "no role" is the honest answer rather than
       * a missing value: it exists so a granted child is reachable, and the
       * person may do nothing at all with the row itself (ADR-0026).
       *
       * It already travels as `pathOnly`, and the role is what a control asks.
       * Sending anything else here would be the same mistake as sending its
       * title.
       */
      const tree = await treeFor(guest);
      const path = tree.pages.find((one) => one.id === closed)!;
      assert.equal(path.pathOnly, true);
      assert.equal(path.role, null, 'no role, not a low one');

      const own = tree.pages.find((one) => one.id === granted)!;
      assert.equal(own.role, 'editor', 'and the page they were given keeps its own');
    });

    test('every entry carries one', async () => {
      /*
       * Not only the interesting ones. A field that is usually present is a
       * field every caller has to handle twice, and the shell would then have
       * to decide what an absent role means — which is the question this is
       * supposed to answer.
       */
      const tree = await treeFor(member);
      assert.ok(tree.pages.length > 0);
      for (const entry of tree.pages) {
        assert.ok(
          'role' in entry,
          `entry ${entry.id} arrived without a role`,
        );
        assert.ok(
          entry.role === null || ['viewer', 'commenter', 'editor', 'admin'].includes(entry.role),
          `entry ${entry.id} has role ${String(entry.role)}`,
        );
      }
    });
  },
);
