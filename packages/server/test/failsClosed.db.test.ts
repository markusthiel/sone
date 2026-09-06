/**
 * Three places where nobody said who is asking (ADR-0101).
 *
 * Not a feature: a list of open points, checked. `claude/rechte-und-zugriff.md`
 * has carried three of them for weeks, and a note that says "latent, nobody can
 * reach it" ages badly — the reach is what changes, not the code.
 *
 * They turn out to be one question in three places: **what does this answer when
 * the answer to "who is asking" is missing?**
 *
 *   the condition   `visiblePagesCondition` with a null user matched every
 *                   unrestricted page in the workspace
 *   the export      claimed to contain what the asker may read
 *   the link        one that requires an account answered HTTP 500
 *
 * One of the three was already fixed and the note was stale, which is its own
 * finding: an open-points list nobody re-checks is a list that describes a
 * codebase that no longer exists.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { createShareLink } from '../src/auth/share.js';
import { buildArchive } from '../src/export/build.js';
import { SESSION_COOKIE } from '../src/http/auth.js';
import { registerShareRoutes } from '../src/http/share.js';
import { Router } from '../src/http/router.js';
import { queryRows } from '../src/db/pool.js';
import { visiblePagesCondition } from '../src/pages/access.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

describe(
  'what is answered when nobody said who is asking (database)',
  { concurrency: 1, skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let fx: Fixture;
    let server: Server;
    let base: string;

    /** Plain: a member sees it because their role reaches it. */
    const ORDINARY = uuid(1);
    /** Restricted: only somebody granted it explicitly (ADR-0089). */
    const SECRET = uuid(2);

    before(async () => {
      db = await getTestPool();

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
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind)
         VALUES ($1,$2,'Die Zahlen','a0','page')`,
        [ORDINARY, fx.workspaceId],
      );
      await db.query(
        `INSERT INTO pages (id, workspace_id, title, idx, kind, restricted)
         VALUES ($1,$2,'Personalakte','a1','page',true)`,
        [SECRET, fx.workspaceId],
      );
    });

    // --- 1. the condition ---------------------------------------------------

    test('the visibility condition matches nothing for a null user', async () => {
      /*
       * The condition's first branch is "nothing on this page's path is
       * restricted", which is true of most pages and says nothing about who is
       * asking — on purpose: every caller establishes membership first, and the
       * condition answers the narrower question of what is withheld *within* a
       * workspace somebody is already in.
       *
       * That makes a null user match every unrestricted page. Today no caller
       * passes null: each one either requires a session or resolves an id, and
       * the `kind === 'anonymous' ? null : userId` written at a dozen call sites
       * is unreachable in all of them. **A rule that holds because every one of
       * a dozen callers happens to prevent it is the shape this codebase has
       * been bitten by six times** (ADR-0091, ADR-0092, ADR-0094, ADR-0098).
       *
       * So the condition says no, rather than relying on nobody asking.
       */
      const rows = await queryRows<{ id: string }>(
        db,
        `SELECT p.id FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}`,
        [fx.workspaceId, null],
      );

      assert.deepEqual(rows, [], 'nobody is not everybody');
    });

    test('and still matches for somebody who is really there', async () => {
      // The counterweight: a fix to this that read as "members see less" would
      // be worse than the latent hole.
      const anna = await makeMember('anna@example.org');
      const rows = await queryRows<{ id: string }>(
        db,
        `SELECT p.id FROM pages p
          WHERE p.workspace_id = $1 AND ${visiblePagesCondition('p', '$2')}
          ORDER BY p.idx`,
        [fx.workspaceId, anna],
      );

      assert.deepEqual(
        rows.map((one) => one.id),
        [ORDINARY],
        'the ordinary page, and not the restricted one',
      );
    });

    // --- 2. the export ------------------------------------------------------

    test('a workspace export contains what the asker may read, and no more', async () => {
      /*
       * `claude/rechte-und-zugriff.md` has carried this as an open point:
       * "Workspace-Export ist nur durch die Mitgliedschaft geschützt — jedes
       * Mitglied darf alles exportieren."
       *
       * It is **not true any more**, and this test is what says so rather than
       * a re-reading of the route. Both exports go through one builder, and the
       * builder puts every page through the same condition as the tree and the
       * search. The note was written when only the subtree half had been fixed.
       *
       * Kept as a test rather than deleted from the list, because the next
       * person to read that list deserves better than my word for it.
       */
      const anna = await makeMember('anna@example.org');
      const archive = await buildArchive(db, stubStore(), {
        workspaceId: fx.workspaceId,
        rootId: null,
        viewer: { userId: anna },
        withAttachments: false,
        maxPages: 100,
      });

      assert.equal(archive.pages, 1, 'the ordinary page only');
    });

    test('and an export asked for by nobody contains nothing', async () => {
      // The same null as the condition above, one layer out. The builder takes
      // `viewer.userId: string | null`, so this is a value the type invites.
      const archive = await buildArchive(db, stubStore(), {
        workspaceId: fx.workspaceId,
        rootId: null,
        viewer: { userId: null },
        withAttachments: false,
        maxPages: 100,
      });

      assert.equal(archive.pages, 0);
    });

    // --- 3. the link that needs an account ----------------------------------

    test('a link that requires signing in says so instead of failing', async () => {
      /*
       * `allow_anonymous: false` means the link exists and grants nothing until
       * somebody signs in and claims it. The resolver threw for that, and the
       * route did not catch it — so the answer was HTTP 500, and the interface
       * showed the "what is your name" form for a link that would never let a
       * nameless visitor in.
       *
       * Answered the way a password-protected link is answered: 200 and a
       * statement about what is needed. Confirming that a live link exists is
       * already the shape of that neighbouring case; what must not leak is
       * anything about the page behind it, and nothing here does.
       */
      const link = await createShareLink(db, {
        pageId: ORDINARY,
        role: 'viewer',
        includeSubtree: false,
        createdBy: fx.userId,
        allowAnonymous: false,
      });

      const res = await fetch(`${base}/api/share/${link.token}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['requiresSignIn'], true);
      assert.equal(body['pageId'], undefined, 'and nothing about the page');
      assert.equal(body['title'], undefined);
    });

    test('the same link admits a member who is signed in', async () => {
      // The other half of what `allow_anonymous: false` is for: it is a link
      // for people with accounts, not a broken link.
      const anna = await makeMember('anna@example.org');
      const session = await createSession(db, anna, {});
      const link = await createShareLink(db, {
        pageId: ORDINARY,
        role: 'viewer',
        includeSubtree: false,
        createdBy: fx.userId,
        allowAnonymous: false,
      });

      const res = await fetch(`${base}/api/share/${link.token}`, {
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session.token)}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body['requiresSignIn'], undefined);
      assert.equal(body['pageId'], ORDINARY);
    });

    // --- helpers ------------------------------------------------------------

    async function makeMember(email: string): Promise<string> {
      const hash = await hashPassword('correct-horse-battery-staple');
      const user = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ($1,$2,$3) RETURNING id`,
        [email, email.split('@')[0], hash],
      );
      const userId = user.rows[0]!.id;
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role_id)
         VALUES ($1,$2,(SELECT id FROM roles WHERE key='member'))`,
        [fx.workspaceId, userId],
      );
      return userId;
    }

    /** The archive is never read here; only which pages went into it. */
    function stubStore(): never {
      return {
        put: async () => ({ key: 'k', sizeBytes: 0 }),
        get: async () => null,
      } as never;
    }
  },
);
