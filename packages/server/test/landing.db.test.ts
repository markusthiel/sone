/**
 * Where somebody lands in a workspace (ADR-0119).
 *
 * Reported as a placement problem and it is a modelling one: *„Die Einstellung
 * ist Workspace gebunden. Dort kann ich also nur auswählen aus den Seiten in
 * dem Workspace in dem ich gerade bin. Das macht da keinen Sinn."*
 *
 * The data has been per person **and** per workspace since migration 0024, and
 * screen for it went into the personal settings — which have exactly one
 * workspace in scope, whichever the person happens to be standing in. So it
 * edited one workspace's row while looking like a preference about the person,
 * and offered pages from wherever they were.
 *
 * Two things were living in one column. A workspace has a first page; a person
 * may work somewhere else. Both are here now, and what these tests hold is the
 * resolution between them.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE } from '../src/http/auth.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { Router } from '../src/http/router.js';
import { createSession } from '../src/auth/session.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  type Fixture,
} from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

describe(
  'where somebody lands (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let server: Server;
    let base: string;
    let cookie: string;

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
        instanceName: () => Promise.resolve('SONE'),
        secondFactorStanding: () =>
          Promise.resolve({
            standing: { kind: 'fine' as const },
            facts: { hasSecondFactor: false, hasPassword: true },
          }),
      } as never);
      registerWorkspaceRoutes(router, { pool: db });

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
      fx = await seedWorkspace(db);
      const session = await createSession(db, fx.userId, {});
      cookie = `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
    });

    interface Landing {
      mode: string | null;
      pageId: string | null;
      landOn: string | null;
      workspace: { mode: string; pageId: string | null };
    }

    const landing = (): Promise<Response> =>
      fetch(`${base}/api/workspaces/${fx.workspaceId}/landing`, { headers: { cookie } });

    const mine = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${base}/api/workspaces/${fx.workspaceId}/landing`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });

    const theirs = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${base}/api/workspaces/${fx.workspaceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });

    /**
     * A page at the top of this workspace, with a title and an age.
     *
     * At the root rather than under a folder: what these tests are about is
     * which page is chosen, and a parent would add a question about tree order
     * that ADR-0019 answers elsewhere.
     */
    async function page(title: string, idx: string, editedAgo = '0 seconds'): Promise<string> {
      const row = await db.query<{ id: string }>(
        `INSERT INTO pages (id, workspace_id, idx, title, kind, last_edited_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'page', now() - $4::interval)
         RETURNING id`,
        [fx.workspaceId, idx, title, editedAgo],
      );
      return row.rows[0]!.id;
    }

    // --- what the workspace says ---------------------------------------------

    test('a workspace can name the page everybody starts on', async () => {
      // The thing that could not be said at all. A workspace with a page saying
      // what this place is for had no way to send anybody there.
      const konzept = await page('Konzept', 'a1');
      await page('Notizen', 'a0');

      await expectStatus(await theirs({ landing: { mode: 'fixed', pageId: konzept } }), 200);

      const body = await expectJson<Landing>(await landing(), 200);
      assert.equal(body.landOn, konzept);
      assert.equal(body.workspace.mode, 'fixed', 'and the screen can show what it is');
    });

    test('the top of the tree, which is what it did before anybody chose', async () => {
      await page('Zuerst', 'a0');
      await page('Danach', 'a1');

      await expectStatus(await theirs({ landing: { mode: 'top' } }), 200);

      const body = await expectJson<Landing>(await landing(), 200);
      const first = await db.query<{ title: string }>(`SELECT title FROM pages WHERE id = $1`, [
        body.landOn,
      ]);
      assert.equal(first.rows[0]?.title, 'Zuerst');
    });

    test('or the page most recently worked on, which is rarely the top', async () => {
      /*
       * "Neuste Seite" read as last **edited** rather than last created: it is
       * the answer to "where is the work", and a page created and left alone —
       * by an import, say — would otherwise be where everybody lands.
       */
      await page('Alt', 'a0', '30 days');
      await page('Frisch', 'a9', '1 minute');

      await expectStatus(await theirs({ landing: { mode: 'newest' } }), 200);

      const body = await expectJson<Landing>(await landing(), 200);
      const found = await db.query<{ title: string }>(`SELECT title FROM pages WHERE id = $1`, [
        body.landOn,
      ]);
      assert.equal(found.rows[0]?.title, 'Frisch');
    });

    test('setting it takes the right that every other workspace setting takes', async () => {
      // `workspace.settings`, on the route that already carries the name and
      // the icon: a first page is a fact about the place, decided by whoever
      // decides the rest of it.
      const outsider = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ('aussen@example.org','Aussen')
         RETURNING id`,
      );
      const session = await createSession(db, outsider.rows[0]!.id, {});
      const res = await fetch(`${base}/api/workspaces/${fx.workspaceId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`,
        },
        body: JSON.stringify({ landing: { mode: 'top' } }),
      });
      // Not found, not forbidden: the difference would reveal which workspaces
      // are on this instance.
      await expectStatus(res, 404);
    });

    // --- and what a person says instead --------------------------------------

    test('somebody can differ from it, and only for themselves', async () => {
      // Migration 0024's reason, which still holds: two people in one workspace work
      // on different things.
      const first = await page('Einstieg', 'a0');
      const mineNow = await page('Meins', 'a5');
      await theirs({ landing: { mode: 'fixed', pageId: first } });

      await expectStatus(await mine({ mode: 'fixed', pageId: mineNow }), 200);

      const body = await expectJson<Landing>(await landing(), 200);
      assert.equal(body.landOn, mineNow, 'mine wins');
      assert.equal(body.workspace.pageId, first, 'and the workspace still says what it says');
    });

    test('and can go back to following the workspace', async () => {
      /*
       * The state that had no spelling before: `mode` was NOT NULL, so "no
       * opinion" and "I chose last" were the same row — which is why the
       * migration reads every existing 'last' as no opinion.
       */
      const first = await page('Einstieg', 'a0');
      const mineNow = await page('Meins', 'a5');
      await theirs({ landing: { mode: 'fixed', pageId: first } });
      await mine({ mode: 'fixed', pageId: mineNow });

      await expectStatus(await mine({ mode: null }), 200);

      const body = await expectJson<Landing>(await landing(), 200);
      assert.equal(body.mode, null, 'no opinion of my own');
      assert.equal(body.landOn, first, 'so the workspace decides');
    });

    test('remembering where somebody is does not become an opinion', async () => {
      /*
       * **The trap this whole change walks past.** `PUT …/landing` is called
       * every couple of seconds with `lastPageId` while somebody reads, and it
       * used to insert `mode = 'last'` along the way. Under the old model that
       * was harmless because 'last' was the only default; under this one it
       * would pin every member to 'last' within seconds of arriving and make
       * the workspace's first page unreachable for exactly the people it is
       * for.
       */
      const first = await page('Einstieg', 'a0');
      const other = await page('Woanders', 'a5');
      await theirs({ landing: { mode: 'fixed', pageId: first } });

      await expectStatus(await mine({ lastPageId: other }), 200);

      const body = await expectJson<Landing>(await landing(), 200);
      assert.equal(body.mode, null, 'reading is not choosing');
      assert.equal(body.landOn, first);
    });

    test('a page that has gone falls back rather than refusing to land', async () => {
      // Migration 0024's rule, kept: this is the one page somebody cannot avoid.
      const gone = await page('Weg', 'a0');
      await theirs({ landing: { mode: 'fixed', pageId: gone } });
      await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [gone]);

      const body = await expectJson<Landing>(await landing(), 200);
      assert.equal(body.landOn, null, 'and the interface picks');
    });
  },
);
