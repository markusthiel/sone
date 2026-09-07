/**
 * Moving an entry to another workspace (ADR-0038).
 *
 * The move itself is the easy half. These tests are mostly about the price: what
 * is dropped, what is severed, and that the number somebody was shown is the
 * number that happened.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { SetupKey } from '../src/auth/setupKey.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { registerWorkspaceRoutes } from '../src/http/workspaces.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe(
  'moving between workspaces (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
  let db: Pool;
  let server: Server;
  let base: string;

  const setupGate = new SetupKey();

  /** A key that is valid right now — the gate is spent by a successful setup. */
  async function freshKey(): Promise<string> {
    return (await setupGate.openIfNeeded(db)) ?? '';
  }

  before(async () => {
    db = await getTestPool();
    const router = new Router();
    registerAuthRoutes(router, {
        /*
         * A gate for this suite, because setup now needs a key (ADR-0155).
         * An absent gate means closed, which is the right default and
         * would lock this suite out of the route it uses to create its
         * instance.
         */
        setupGate,
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
    const address = server.address();
    if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeTestPool();
  });

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  interface Who {
    cookie: string;
    userId: string;
    /** The workspace created with the account. */
    home: string;
  }

  let made = 0;

  /**
   * An account, signed in, with a workspace of its own.
   *
   * The first goes through setup because an instance needs one; the rest sign up,
   * which is open in this harness. Each gets a personal workspace with the
   * account (ADR-0025), which is the source or the destination in every test
   * here.
   */
  async function account(): Promise<Who> {
    made += 1;
    const email = `mover${made}@example.test`;
    const path = made === 1 ? '/api/auth/setup' : '/api/auth/signup';
    const res = await fetch(
      `${base}${path}`,
      json({
        email,
        password: PASSWORD,
        displayName: `Mover ${made}`,
        // Only the first account goes through setup, so only it needs a key
        // (ADR-0155). The rest sign up, where a key would be meaningless.
        ...(made === 1
          ? { workspaceName: `Work ${made}`, setupKey: await freshKey() }
          : {}),
      }),
    );
    const body = await expectJson<{ userId: string; workspaceId: string }>(res, 201);
    const header = res.headers.get('set-cookie');
    assert.ok(header);
    const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
    assert.ok(value);
    return {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
      userId: body.userId,
      home: body.workspaceId,
    };
  }

  /** A second workspace for somebody, as its owner. */
  async function extraWorkspace(who: Who, name: string): Promise<string> {
    const res = await fetch(`${base}/api/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: who.cookie },
      body: JSON.stringify({ name }),
    });
    return (await expectJson<{ id: string }>(res, 201)).id;
  }

  async function entry(
    who: Who,
    workspaceId: string,
    title: string,
    kind: 'page' | 'folder',
    parent: string | null,
  ): Promise<string> {
    const res = await fetch(`${base}/api/workspaces/${workspaceId}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: who.cookie },
      body: JSON.stringify({ title, kind, parentPageId: parent }),
    });
    return (await expectJson<{ id: string }>(res, 201)).id;
  }

  interface Cost {
    pages: number;
    files: number;
    shareLinks: number;
    restrictions: number;
    references: number;
    favourites: number;
  }

  const move = (
    who: Who,
    pageId: string,
    workspaceId: string,
    dryRun = false,
  ): Promise<Response> =>
    fetch(
      `${base}/api/pages/${pageId}/move-to-workspace${dryRun ? '?dryRun=true' : ''}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: who.cookie },
        body: JSON.stringify({ workspaceId }),
      },
    );

  test('a subtree arrives whole, at the root of the target', async () => {
    // A page needs a folder for a parent, so depth here is folder → folder →
    // page, which is what a real tree looks like too.
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Project', 'folder', null);
    const child = await entry(who, who.home, 'Notes', 'folder', folder);
    const grandchild = await entry(who, who.home, 'Deeper', 'page', child);

    const body = await expectJson<{ cost: Cost }>(await move(who, folder, there), 200);
    assert.equal(body.cost.pages, 3);

    const rows = await db.query<{ id: string; workspace_id: string; ancestor_ids: string[] }>(
      `SELECT id, workspace_id, ancestor_ids FROM pages WHERE id = ANY($1::uuid[])`,
      [[folder, child, grandchild]],
    );
    for (const row of rows.rows) {
      assert.equal(row.workspace_id, there, `${row.id} moved`);
    }
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    // Re-rooted: the moved entry is a root, and the path below it is what is
    // left of the old one.
    assert.deepEqual(byId.get(folder)?.ancestor_ids, []);
    assert.deepEqual(byId.get(child)?.ancestor_ids, [folder]);
    assert.deepEqual(byId.get(grandchild)?.ancestor_ids, [folder, child]);
  });

  test('a dry run changes nothing and reports the same numbers', async () => {
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Project', 'folder', null);
    await entry(who, who.home, 'Notes', 'page', folder);

    // The target needs a folder of its own for the page to land in; a workspace
    // is created with one.
    const preview = await expectJson<{ cost: Cost; dryRun: boolean }>(
      await move(who, folder, there, true),
      200,
    );
    assert.equal(preview.dryRun, true);
    assert.equal(preview.cost.pages, 2);

    const still = await db.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM pages WHERE id = $1`,
      [folder],
    );
    assert.equal(still.rows[0]?.workspace_id, who.home, 'nothing moved');

    const real = await expectJson<{ cost: Cost }>(await move(who, folder, there), 200);
    assert.deepEqual(real.cost, preview.cost, 'what was shown is what happened');
  });

  test('a restriction is dropped, and counted', async () => {
    // It names members and groups of the workspace being left. There is no
    // honest translation, so the page arrives open — and that is the line in the
    // confirmation that matters most.
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Project', 'folder', null);
    const page = await entry(who, who.home, 'Secret', 'page', folder);
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role) VALUES ($1, $2, 'editor')`,
      [page, who.userId],
    );

    const body = await expectJson<{ cost: Cost }>(await move(who, folder, there), 200);
    assert.equal(body.cost.restrictions, 1);

    const left = await db.query(`SELECT 1 FROM page_permissions WHERE page_id = $1`, [page]);
    assert.equal(left.rowCount, 0);
  });

  test('a share link is revoked, and counted', async () => {
    // One that outlived the boundary it was issued under is a hole with no way
    // to notice it.
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Shared things', 'folder', null);
    const page = await entry(who, who.home, 'Shared', 'page', folder);
    await db.query(
      `INSERT INTO share_tokens (workspace_id, scope_page_id, token_hash, role, created_by)
       VALUES ($1, $2, '\\x00', 'viewer', $3)`,
      [who.home, page, who.userId],
    );

    const body = await expectJson<{ cost: Cost }>(await move(who, page, there), 200);
    assert.equal(body.cost.shareLinks, 1);

    const token = await db.query<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM share_tokens WHERE scope_page_id = $1`,
      [page],
    );
    assert.notEqual(token.rows[0]?.revoked_at, null, 'revoked rather than deleted');
  });

  test('a reference across the new boundary is severed; one inside it is not', async () => {
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Project', 'folder', null);
    const inside = await entry(who, who.home, 'Inside', 'page', folder);
    const keep = await entry(who, who.home, 'Keep', 'folder', null);
    const staying = await entry(who, who.home, 'Staying', 'page', keep);

    // A relation is a collection's relation *column* pointing at a page — not a
    // link in prose, which lives in the document and is nobody's row. So this
    // needs a collection and a field to hang the relation on.
    const collection = (
      await db.query<{ id: string }>(
        `INSERT INTO collections (id, workspace_id, page_id, title_field_id)
         VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()) RETURNING id`,
        [who.home, inside],
      )
    ).rows[0]!.id;
    const field = (
      await db.query<{ id: string }>(
        `INSERT INTO collection_fields (id, collection_id, name, field_type, config, idx)
         VALUES (gen_random_uuid(), $1, 'Linked', 'relation', '{}'::jsonb, 'a0')
         RETURNING id`,
        [collection],
      )
    ).rows[0]!.id;

    await db.query(
      `INSERT INTO page_relations (from_page_id, field_id, to_page_id, idx)
       VALUES ($1, $2, $3, 'a0')`,
      [inside, field, staying],
    );
    await db.query(
      `INSERT INTO page_relations (from_page_id, field_id, to_page_id, idx)
       VALUES ($1, $2, $3, 'a1')`,
      [inside, field, folder],
    );

    const body = await expectJson<{ cost: Cost }>(await move(who, folder, there), 200);
    assert.equal(body.cost.references, 1, 'only the one crossing');

    const kept = await db.query(
      `SELECT from_page_id, to_page_id FROM page_relations WHERE from_page_id = $1`,
      [inside],
    );
    assert.equal(kept.rowCount, 1);
    assert.equal(kept.rows[0]?.to_page_id, folder, 'the one that moved with it stayed');
  });

  test('files come along, and their bytes are not touched', async () => {
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Files', 'folder', null);
    const page = await entry(who, who.home, 'With a file', 'page', folder);
    await db.query(
      `INSERT INTO files (workspace_id, page_id, filename, mime_type, size_bytes, sha256, storage_key)
       VALUES ($1, $2, 'plan.pdf', 'application/pdf', 10, '\\x00', 'ab/cdef.pdf')`,
      [who.home, page],
    );

    const body = await expectJson<{ cost: Cost }>(await move(who, page, there), 200);
    assert.equal(body.cost.files, 1);

    const file = await db.query<{ workspace_id: string; storage_key: string }>(
      `SELECT workspace_id, storage_key FROM files WHERE page_id = $1`,
      [page],
    );
    assert.equal(file.rows[0]?.workspace_id, there);
    // Content-addressed: a move is metadata, however large the subtree.
    assert.equal(file.rows[0]?.storage_key, 'ab/cdef.pdf');
  });

  test('a workspace somebody does not administer is not a destination', async () => {
    // And the answer is the one a missing workspace gets, because the difference
    // would say whether one exists.
    const owner = await account();
    const stranger = await account();
    const theirs = await extraWorkspace(owner, 'Theirs');
    const folder = await entry(stranger, stranger.home, 'Mine', 'folder', null);
    const page = await entry(stranger, stranger.home, 'A page', 'page', folder);

    await expectStatus(await move(stranger, page, theirs), 404);

    const still = await db.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM pages WHERE id = $1`,
      [page],
    );
    assert.equal(still.rows[0]?.workspace_id, stranger.home);
  });

  test('a collection row cannot be moved out on its own', async () => {
    const who = await account();
    const there = await extraWorkspace(who, 'Elsewhere');
    const folder = await entry(who, who.home, 'Tables', 'folder', null);
    const page = await entry(who, who.home, 'People', 'page', folder);
    const row = await entry(who, who.home, 'A row', 'page', folder);
    await db.query(`UPDATE pages SET kind = 'row', collection_id = $2 WHERE id = $1`, [
      row,
      // A collection the row belongs to; the id is all this test needs.
      (
        await db.query<{ id: string }>(
          `INSERT INTO collections (id, workspace_id, page_id, title_field_id)
           VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()) RETURNING id`,
          [who.home, page],
        )
      ).rows[0]!.id,
    ]);

    const body = await expectJson<{ error: string }>(await move(who, row, there), 409);
    assert.equal(body.error, 'is_collection_row');
  });

  test('moving into the workspace it is already in is refused', async () => {
    const who = await account();
    const folder = await entry(who, who.home, 'Here', 'folder', null);
    const page = await entry(who, who.home, 'Here already', 'page', folder);
    const body = await expectJson<{ error: string }>(await move(who, page, who.home), 409);
    assert.equal(body.error, 'same_workspace');
  });
  },
);
