/**
 * HTTP API tests.
 *
 * Driven through real HTTP against a real Postgres, because the interesting
 * behaviour is in cookies, status codes and authorisation filtering — none of
 * which a direct function call exercises.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { hashPassword } from '../src/auth/password.js';
import { createInvitation } from '../src/auth/registration.js';
import { createShareLink } from '../src/auth/share.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
} from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

describe('http api (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let server: Server;
  let base: string;

  before(async () => {
    db = await getTestPool();
    const router = new Router();
    registerAuthRoutes(router, {
      pool: db,
      signupMode: 'invite',
      secureCookies: false,
    });
    registerPageRoutes(router, { pool: db });

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

  // --- helpers -------------------------------------------------------------

  interface Session {
    cookie: string;
    workspaceId: string;
    userId: string;
  }

  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  function cookieFrom(res: Response): string {
    const header = res.headers.get('set-cookie');
    assert.ok(header, 'expected a Set-Cookie header');
    const value = parseCookies(header.split(';')[0])[SESSION_COOKIE];
    assert.ok(value, 'expected a session cookie');
    return `${SESSION_COOKIE}=${encodeURIComponent(value)}`;
  }

  async function setup(): Promise<Session> {
    const res = await fetch(`${base}/api/auth/setup`, {
      ...json({
        email: 'owner@example.org',
        password: PASSWORD,
        displayName: 'Owner',
        workspaceName: 'Test workspace',
      }),
    });
    await expectStatus(res, 201);
    const body = (await res.json()) as { userId: string; workspaceId: string };
    return {
      cookie: cookieFrom(res),
      workspaceId: body.workspaceId,
      userId: body.userId,
    };
  }

  const auth = (session: Session, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), cookie: session.cookie },
  });

  /**
   * Create a page.
   *
   * With no parent given it goes into the workspace's default folder, because
   * pages live in folders and the root holds only folders (ADR-0019). Tests
   * that care about the folder pass one explicitly.
   */
  async function createPage(
    session: Session,
    title: string,
    parentPageId?: string | null,
  ): Promise<string> {
    const parent = parentPageId === undefined ? await defaultFolder(session) : parentPageId;
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title, parentPageId: parent })),
    );
    await expectStatus(res, 201);
    return ((await res.json()) as { id: string }).id;
  }

  /** The folder created with the workspace. */
  async function defaultFolder(session: Session): Promise<string> {
    const row = await db.query<{ id: string }>(
      `SELECT id FROM pages
        WHERE workspace_id = $1 AND kind = 'folder' AND parent_page_id IS NULL
        ORDER BY idx, id LIMIT 1`,
      [session.workspaceId],
    );
    assert.ok(row.rows[0], 'the workspace should have a default folder');
    return row.rows[0]!.id;
  }

  async function createFolder(
    session: Session,
    title: string,
    parentPageId: string | null = null,
  ): Promise<string> {
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title, parentPageId, kind: 'folder' })),
    );
    await expectStatus(res, 201);
    return ((await res.json()) as { id: string }).id;
  }

  // --- instance and setup --------------------------------------------------

  test('a fresh instance reports that it needs setup', async () => {
    const res = await fetch(`${base}/api/instance`);
    const body = (await res.json()) as { needsSetup: boolean; signupMode: string };
    assert.equal(body.needsSetup, true);
    assert.equal(body.signupMode, 'invite');
  });

  test('setup creates the owner and workspace and returns a session cookie', async () => {
    const session = await setup();
    assert.ok(session.workspaceId);

    const instance = await fetch(`${base}/api/instance`);
    assert.equal(((await instance.json()) as { needsSetup: boolean }).needsSetup, false);
  });

  test('setup is refused once an instance exists', async () => {
    await setup();
    const res = await fetch(
      `${base}/api/auth/setup`,
      json({
        email: 'second@example.org',
        password: PASSWORD,
        workspaceName: 'Another',
      }),
    );
    assert.equal(res.status, 401);
  });

  test('the session cookie is HttpOnly and SameSite=Lax', async () => {
    // HttpOnly because a token readable from JavaScript is one an XSS can
    // exfiltrate, and this app renders a lot of user content. Lax rather than
    // Strict so a shared link opened from an email arrives authenticated.
    const res = await fetch(
      `${base}/api/auth/setup`,
      json({ email: 'o@example.org', password: PASSWORD, workspaceName: 'W' }),
    );
    const header = res.headers.get('set-cookie') ?? '';
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.doesNotMatch(header, /Secure/, 'plain http must not set Secure');
  });

  test('setup rejects a missing field with 422', async () => {
    const res = await fetch(`${base}/api/auth/setup`, json({ email: 'x@example.org' }));
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'missing_fields' });
  });

  test('setup rejects a weak password with 422, not 500', async () => {
    const res = await fetch(
      `${base}/api/auth/setup`,
      json({ email: 'x@example.org', password: 'short', workspaceName: 'W' }),
    );
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'weak_password' });
  });

  // --- login and session ---------------------------------------------------

  test('login sets a cookie and the session endpoint returns the workspace', async () => {
    await setup();
    const res = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'owner@example.org', password: PASSWORD }),
    );
    assert.equal(res.status, 204);

    const session = await fetch(
      `${base}/api/auth/session`,
      auth({ cookie: cookieFrom(res), workspaceId: '', userId: '' }),
    );
    const body = (await session.json()) as {
      user: { displayName: string };
      workspaces: Array<{ role: string }>;
    };
    assert.equal(body.user.displayName, 'Owner');
    assert.deepEqual(
      body.workspaces.map((w) => w.role),
      ['owner'],
    );
  });

  test('a wrong password answers 401 with a code, not a sentence', async () => {
    await setup();
    const res = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'owner@example.org', password: 'wrong-password-here' }),
    );
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'invalid_credentials' });
  });

  test('an unknown account and a wrong password are indistinguishable', async () => {
    await setup();
    const unknown = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'nobody@example.org', password: PASSWORD }),
    );
    const wrong = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'owner@example.org', password: 'nope-nope-nope' }),
    );
    assert.equal(unknown.status, wrong.status);
    assert.deepEqual(await unknown.json(), await wrong.json());
  });

  test('no cookie means 401 on a protected route', async () => {
    await setup();
    const res = await fetch(`${base}/api/auth/session`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'not_authenticated' });
  });

  test('logout revokes the session and clears the cookie', async () => {
    const session = await setup();
    const res = await fetch(`${base}/api/auth/logout`, auth(session, { method: 'POST' }));
    assert.equal(res.status, 204);
    assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);

    const after = await fetch(`${base}/api/auth/session`, auth(session));
    assert.equal(after.status, 401, 'the old cookie must no longer work');
  });

  test('logout clears the cookie even when the session was already gone', async () => {
    // Otherwise a stale cookie survives a logout and the user appears logged in.
    const res = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=nonsense` },
    });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });

  test('a session can be revoked by id, and not somebody else’s', async () => {
    const session = await setup();

    const hash = await hashPassword(PASSWORD);
    const other = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('other@example.org','Other',$1) RETURNING id`,
      [hash],
    );
    const foreign = await db.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, decode('00', 'hex'), now() + interval '1 day') RETURNING id`,
      [other.rows[0]!.id],
    );

    const res = await fetch(
      `${base}/api/auth/sessions/${foreign.rows[0]!.id}`,
      auth(session, { method: 'DELETE' }),
    );
    assert.equal(res.status, 404, 'must not be able to revoke another user’s session');
  });

  // --- signup and invitations ---------------------------------------------

  test('signup requires an invitation in invite mode', async () => {
    await setup();
    const res = await fetch(
      `${base}/api/auth/signup`,
      json({ email: 'new@example.org', password: PASSWORD }),
    );
    assert.equal(res.status, 401);
  });

  test('signup with a valid invitation joins the workspace', async () => {
    const session = await setup();
    const invite = await createInvitation(db, {
      workspaceId: session.workspaceId,
      invitedBy: session.userId,
      email: 'invited@example.org',
    });

    const res = await fetch(
      `${base}/api/auth/signup`,
      json({
        email: 'invited@example.org',
        password: PASSWORD,
        displayName: 'Invited',
        invitationToken: invite.token,
      }),
    );
    await expectStatus(res, 201);
    const body = (await res.json()) as { workspaceId: string };
    assert.equal(body.workspaceId, session.workspaceId);
  });

  test('an invitation can be inspected before signing up', async () => {
    const session = await setup();
    const invite = await createInvitation(db, {
      workspaceId: session.workspaceId,
      invitedBy: session.userId,
      email: 'peek@example.org',
    });

    const res = await fetch(`${base}/api/auth/invitation/${invite.token}`);
    const body = (await res.json()) as { workspaceName: string; email: string };
    assert.equal(body.workspaceName, 'Test workspace');
    assert.equal(body.email, 'peek@example.org');
  });

  test('an unknown invitation token is 404', async () => {
    await setup();
    const res = await fetch(`${base}/api/auth/invitation/nonsense`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'invitation_invalid' });
  });

  // --- pages ---------------------------------------------------------------

  test('creating a page writes the CRDT log, not only the projection', async () => {
    // A page row without a document is an empty page. The CRDTs are the truth
    // (ADR-0002) and this is the route that has to remember it.
    const session = await setup();
    const pageId = await createPage(session, 'First page');

    const updates = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [pageId],
    );
    assert.ok(Number(updates.rows[0]!.n) > 0, 'the document must exist');

    const row = await db.query<{ title: string; schema_version: number }>(
      `SELECT title, schema_version FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(row.rows[0]!.title, 'First page');
    assert.equal(row.rows[0]!.schema_version, 1);
  });

  test('sibling pages get increasing fractional indexes', async () => {
    const session = await setup();
    const first = await createPage(session, 'A');
    const second = await createPage(session, 'B');

    // Scoped to the two created here: the workspace also has its default
    // folder, which sorts among them.
    const rows = await db.query<{ id: string; idx: string }>(
      `SELECT id, idx FROM pages WHERE id = ANY($1::uuid[]) ORDER BY idx, id`,
      [[first, second]],
    );
    assert.deepEqual(
      rows.rows.map((r) => r.id),
      [first, second],
    );
    assert.ok(rows.rows[0]!.idx < rows.rows[1]!.idx);
  });

  test('the page tree returns parent relationships', async () => {
    // The parent must be a folder now: a page contains nothing (ADR-0019).
    const session = await setup();
    const parent = await createFolder(session, 'Parent');
    const child = await createPage(session, 'Child', parent);

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session),
    );
    const body = (await res.json()) as {
      pages: Array<{ id: string; parentPageId: string | null }>;
    };
    const byId = new Map(body.pages.map((p) => [p.id, p]));
    assert.equal(byId.get(child)!.parentPageId, parent);
    assert.equal(byId.get(parent)!.parentPageId, null);
  });

  test('creating a page under a nonexistent parent is 404', async () => {
    const session = await setup();
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(
        session,
        json({ title: 'Orphan', parentPageId: '00000000-0000-4000-8000-000000009999' }),
      ),
    );
    assert.equal(res.status, 404);
  });

  test('a page in another workspace is invisible', async () => {
    const first = await setup();
    const pageId = await createPage(first, 'Private');

    // A second workspace with its own member.
    const hash = await hashPassword(PASSWORD);
    const outsider = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('outsider@example.org','Out',$1) RETURNING id`,
      [hash],
    );
    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Other', $1) RETURNING id`,
      [outsider.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`,
      [ws.rows[0]!.id, outsider.rows[0]!.id],
    );
    const loginRes = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'outsider@example.org', password: PASSWORD }),
    );
    const outsiderSession = {
      cookie: cookieFrom(loginRes),
      workspaceId: ws.rows[0]!.id,
      userId: outsider.rows[0]!.id,
    };

    const res = await fetch(`${base}/api/pages/${pageId}`, auth(outsiderSession));
    assert.equal(res.status, 404, 'must not reveal that the page exists');
  });

  test('requesting a workspace you are not a member of is 403', async () => {
    const session = await setup();
    const ws = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ('Foreign') RETURNING id`,
    );
    const res = await fetch(
      `${base}/api/workspaces/${ws.rows[0]!.id}/pages`,
      auth(session),
    );
    assert.equal(res.status, 403);
  });

  test('archiving a folder takes its subtree with it', async () => {
    // Otherwise archiving a parent leaves children reachable from search but
    // not from the tree.
    const session = await setup();
    const parent = await createFolder(session, 'Parent');
    const child = await createFolder(session, 'Child', parent);
    const grandchild = await createPage(session, 'Grandchild', child);

    const res = await fetch(`${base}/api/pages/${parent}`, auth(session, { method: 'DELETE' }));
    assert.equal(res.status, 204);

    const rows = await db.query<{ id: string; archived_at: Date | null }>(
      `SELECT id, archived_at FROM pages WHERE id = ANY($1::uuid[])`,
      [[parent, child, grandchild]],
    );
    assert.equal(rows.rows.length, 3);
    assert.ok(
      rows.rows.every((r) => r.archived_at !== null),
      'the whole subtree must be archived',
    );

    const tree = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session),
    );
    const remaining = ((await tree.json()) as { pages: Array<{ id: string }> }).pages;
    // The default folder is untouched; nothing from the archived subtree
    // remains.
    assert.deepEqual(
      remaining.filter((p) => [parent, child, grandchild].includes(p.id)),
      [],
    );
  });

  test('page metadata reports the caller’s role', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Roles');
    const res = await fetch(`${base}/api/pages/${pageId}`, auth(session));
    const body = (await res.json()) as { role: string; title: string };
    assert.equal(body.role, 'admin', 'the workspace owner is admin on a page');
    assert.equal(body.title, 'Roles');
  });

  // --- folders -------------------------------------------------------------

  test('a folder is created with kind folder', async () => {
    const session = await setup();
    const folderId = await createFolder(session, 'Projects');

    const row = await db.query<{ kind: string }>(
      `SELECT kind FROM pages WHERE id = $1`,
      [folderId],
    );
    assert.equal(row.rows[0]!.kind, 'folder');
  });

  test('the kind lives in the document, so a rebuild restores it', async () => {
    // A folder that existed only as a Postgres row would make the projection
    // non-derivable, and that derivability is the guarantee which makes the
    // CRDT complexity worth carrying (ADR-0002, ADR-0019).
    //
    // Demonstrated by corrupting the projection and rebuilding: the row is
    // overwritten from the document, so if the kind were only ever a column it
    // would come back as 'page'.
    const session = await setup();
    const folderId = await createFolder(session, 'Projects');

    await db.query(
      `UPDATE pages SET kind = 'page', title = 'wrong' WHERE id = $1`,
      [folderId],
    );

    const { rebuild } = await import('../src/materialize/rebuild.js');
    const report = await rebuild(db, {
      workspaceId: session.workspaceId,
      log: () => {},
    });
    assert.deepEqual(report.failed, []);

    const row = await db.query<{ kind: string; title: string }>(
      `SELECT kind, title FROM pages WHERE id = $1`,
      [folderId],
    );
    assert.equal(row.rows[0]!.kind, 'folder', 'restored from the document');
    assert.equal(row.rows[0]!.title, 'Projects');
  });

  test('a page defaults to kind page', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'A page');
    const row = await db.query<{ kind: string }>(
      `SELECT kind FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(row.rows[0]!.kind, 'page');
  });

  test('a folder may contain pages and folders', async () => {
    const session = await setup();
    const folderId = await createFolder(session, 'Projects');

    const child = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Inside', parentPageId: folderId })),
    );
    await expectStatus(child, 201);

    const nested = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Sub', parentPageId: folderId, kind: 'folder' })),
    );
    await expectStatus(nested, 201);
  });

  test('a page cannot contain anything', async () => {
    // The rule that makes the structure clearer, and the reason folders exist
    // at all (ADR-0019). Refused here with a code, so the interface can explain
    // it rather than the write failing silently.
    const session = await setup();
    const folderId = await createFolder(session, 'Projects');
    const pageId = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'A page', parentPageId: folderId })),
    ).then(async (r) => ((await r.json()) as { id: string }).id);

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Nested', parentPageId: pageId })),
    );
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'parent_is_not_a_folder' });
  });

  test('a new workspace starts with a folder', async () => {
    // Without one, a fresh instance shows a "new page" button that refuses,
    // because pages live in folders (ADR-0019). The empty state has to be
    // usable rather than a puzzle.
    const session = await setup();
    const folders = await db.query<{ title: string; kind: string }>(
      `SELECT title, kind FROM pages WHERE workspace_id = $1 AND parent_page_id IS NULL`,
      [session.workspaceId],
    );
    assert.equal(folders.rowCount, 1);
    assert.equal(folders.rows[0]!.kind, 'folder');
    assert.equal(folders.rows[0]!.title, 'Notes');
  });

  test('the default folder has a document behind it', async () => {
    // Created through the same path as everything else, so it is rebuildable
    // rather than a row conjured during setup.
    const session = await setup();
    const folder = await defaultFolder(session);
    const updates = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [folder],
    );
    assert.ok(Number(updates.rows[0]!.n) > 0);
  });

  test('a page cannot be created at the workspace root', async () => {
    // A root full of loose pages is the pile folders exist to replace.
    const session = await setup();
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Loose page', parentPageId: null })),
    );
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'pages_need_a_folder' });
  });

  test('a folder can be created at the workspace root', async () => {
    const session = await setup();
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Top level', kind: 'folder', parentPageId: null })),
    );
    await expectStatus(res, 201);
  });

  test('an unknown kind is refused rather than silently treated as a page', async () => {
    const session = await setup();
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'X', kind: 'notebook' })),
    );
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'invalid_kind' });
  });

  test('the tree reports each entry kind', async () => {
    const session = await setup();
    const folderId = await createFolder(session, 'Projects');
    await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Inside', parentPageId: folderId })),
    );

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session),
    );
    const body = (await res.json()) as { pages: Array<{ title: string; kind: string }> };
    const byTitle = new Map(body.pages.map((p) => [p.title, p.kind]));
    assert.equal(byTitle.get('Projects'), 'folder');
    assert.equal(byTitle.get('Inside'), 'page');
  });

  test('the anomaly view is empty when the API is used', async () => {
    // The API refuses to create a page inside a page; this view notices if one
    // exists anyway, which is how migration 0003 handles rules a constraint
    // cannot express.
    const session = await setup();
    const folderId = await createFolder(session, 'Projects');
    await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Inside', parentPageId: folderId })),
    );

    const anomalies = await db.query(`SELECT * FROM pages_inside_pages`);
    assert.equal(anomalies.rowCount, 0);
  });

  test('the anomaly view reports a page written directly under a page', async () => {
    const session = await setup();
    const parent = await createPage(session, 'A page');
    const child = await createPage(session, 'Another page');
    // Written straight to the projection, as an out-of-order CRDT update or a
    // misbehaving client would.
    await db.query(`UPDATE pages SET parent_page_id = $2 WHERE id = $1`, [child, parent]);

    const anomalies = await db.query<{ child_title: string; parent_title: string }>(
      `SELECT child_title, parent_title FROM pages_inside_pages`,
    );
    assert.equal(anomalies.rowCount, 1);
    assert.equal(anomalies.rows[0]!.child_title, 'Another page');
    assert.equal(anomalies.rows[0]!.parent_title, 'A page');
  });

  // --- renaming ------------------------------------------------------------

  test('renaming writes the document, not just the row', async () => {
    // The title lives in the document (ADR-0002). Writing only the row would
    // be overwritten by the next materialisation, so the rename would silently
    // revert — and no open client would ever see it.
    const session = await setup();
    const pageId = await createPage(session, 'Before');

    const res = await fetch(
      `${base}/api/pages/${pageId}`,
      auth(session, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'After' }),
      }),
    );
    await expectStatus(res, 200);

    // The projection is updated immediately, or the sidebar would show the old
    // title until the page is next opened.
    const row = await db.query<{ title: string }>(
      `SELECT title FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(row.rows[0]!.title, 'After');

    // And it survives a rebuild, which is the proof it went into the document.
    await db.query(`UPDATE pages SET title = 'wrong' WHERE id = $1`, [pageId]);
    const { rebuild } = await import('../src/materialize/rebuild.js');
    await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

    const after = await db.query<{ title: string }>(
      `SELECT title FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(after.rows[0]!.title, 'After');
  });

  test('a folder can be renamed', async () => {
    // A folder has no editable body, so this is the only way to name one.
    const session = await setup();
    const folderId = await createFolder(session, 'Untitled folder');

    const res = await fetch(
      `${base}/api/pages/${folderId}`,
      auth(session, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Projects' }),
      }),
    );
    await expectStatus(res, 200);

    const row = await db.query<{ title: string; kind: string }>(
      `SELECT title, kind FROM pages WHERE id = $1`,
      [folderId],
    );
    assert.equal(row.rows[0]!.title, 'Projects');
    assert.equal(row.rows[0]!.kind, 'folder', 'renaming must not change the kind');
  });

  test('renaming appends a delta, not the whole document state', async () => {
    // Appending a full state works but grows the log by the document's size on
    // every rename, leaving compaction to clean up after it.
    const session = await setup();
    const pageId = await createPage(session, 'Before');

    const sizes = async (): Promise<number> => {
      const rows = await db.query<{ total: string }>(
        `SELECT coalesce(sum(octet_length(payload)),0)::text AS total
           FROM doc_updates WHERE doc_id = $1`,
        [pageId],
      );
      return Number(rows.rows[0]!.total);
    };

    const before = await sizes();
    await fetch(
      `${base}/api/pages/${pageId}`,
      auth(session, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'A slightly longer title' }),
      }),
    );
    const growth = (await sizes()) - before;

    assert.ok(growth > 0, 'something must have been appended');
    assert.ok(
      growth < before,
      `a rename appended ${growth} bytes against a ${before}-byte document; ` +
        `that looks like a full state rather than a delta`,
    );
  });

  test('a viewer cannot rename', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Locked');

    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('viewer@example.org','V',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',false,$3)`,
      [pageId, guest.rows[0]!.id, session.userId],
    );
    const loginRes = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'viewer@example.org', password: PASSWORD }),
    );

    const res = await fetch(`${base}/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieFrom(loginRes) },
      body: JSON.stringify({ title: 'Nope' }),
    });
    assert.equal(res.status, 403);
  });

  // --- moving --------------------------------------------------------------

  const move = (
    session: Session,
    pageId: string,
    parentPageId: string | null,
  ): Promise<Response> =>
    fetch(
      `${base}/api/pages/${pageId}`,
      auth(session, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentPageId }),
      }),
    );

  test('a page can be moved to another folder', async () => {
    const session = await setup();
    const from = await createFolder(session, 'From');
    const to = await createFolder(session, 'To');
    const pageId = await createPage(session, 'Wandering', from);

    await expectStatus(await move(session, pageId, to), 200);

    const row = await db.query<{ parent_page_id: string }>(
      `SELECT parent_page_id FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(row.rows[0]!.parent_page_id, to);
  });

  test('a move writes the document, so it survives a rebuild', async () => {
    // The parent lives in the CRDT (ADR-0002). Writing the projection would be
    // undone by the next materialisation and the move would silently revert.
    const session = await setup();
    const from = await createFolder(session, 'From');
    const to = await createFolder(session, 'To');
    const pageId = await createPage(session, 'Wandering', from);

    await move(session, pageId, to);
    await db.query(`UPDATE pages SET parent_page_id = $2 WHERE id = $1`, [pageId, from]);

    const { rebuild } = await import('../src/materialize/rebuild.js');
    await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

    const row = await db.query<{ parent_page_id: string }>(
      `SELECT parent_page_id FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(row.rows[0]!.parent_page_id, to, 'restored from the document');
  });

  test('a folder can be moved to the workspace root', async () => {
    const session = await setup();
    const outer = await createFolder(session, 'Outer');
    const inner = await createFolder(session, 'Inner', outer);

    await expectStatus(await move(session, inner, null), 200);
    const row = await db.query<{ parent_page_id: string | null }>(
      `SELECT parent_page_id FROM pages WHERE id = $1`,
      [inner],
    );
    assert.equal(row.rows[0]!.parent_page_id, null);
  });

  test('a page cannot be moved to the workspace root', async () => {
    // A root full of loose pages is the pile folders exist to replace.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Page', folder);

    const res = await move(session, pageId, null);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'pages_need_a_folder' });
  });

  test('an entry cannot be moved into a page', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const target = await createPage(session, 'A page', folder);
    const moving = await createPage(session, 'Another page', folder);

    const res = await move(session, moving, target);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'parent_is_not_a_folder' });
  });

  test('a folder cannot be moved into itself', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const res = await move(session, folder, folder);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'cannot_move_into_itself' });
  });

  test('a folder cannot be moved into its own subtree', async () => {
    // The rule that matters most. Detaching a subtree from the tree leaves it
    // existing, unreachable from the root, with ancestor_ids — which every
    // share link and subtree grant is computed from — recursing forever.
    const session = await setup();
    const outer = await createFolder(session, 'Outer');
    const middle = await createFolder(session, 'Middle', outer);
    const inner = await createFolder(session, 'Inner', middle);

    for (const target of [middle, inner]) {
      const res = await move(session, outer, target);
      assert.equal(res.status, 409, `moving into ${target} should be refused`);
      assert.deepEqual(await res.json(), { error: 'cannot_move_into_own_subtree' });
    }

    // And nothing changed.
    const row = await db.query<{ parent_page_id: string | null }>(
      `SELECT parent_page_id FROM pages WHERE id = $1`,
      [outer],
    );
    assert.equal(row.rows[0]!.parent_page_id, null);
  });

  test('a move updates the ancestors of everything beneath it', async () => {
    // Without the cascade, a share link on the destination would not cover what
    // was just moved into it — and a subtree grant is computed from
    // ancestor_ids.
    const session = await setup();
    const from = await createFolder(session, 'From');
    const to = await createFolder(session, 'To');
    const middle = await createFolder(session, 'Middle', from);
    const leaf = await createPage(session, 'Leaf', middle);

    await expectStatus(await move(session, middle, to), 200);

    const row = await db.query<{ ancestor_ids: string[] }>(
      `SELECT ancestor_ids FROM pages WHERE id = $1`,
      [leaf],
    );
    assert.deepEqual(row.rows[0]!.ancestor_ids, [to, middle]);
  });

  test('a moved entry lands last among its new siblings', async () => {
    const session = await setup();
    const from = await createFolder(session, 'From');
    const to = await createFolder(session, 'To');
    const first = await createPage(session, 'Already there', to);
    const moving = await createPage(session, 'Arriving', from);

    await move(session, moving, to);

    const rows = await db.query<{ id: string }>(
      `SELECT id FROM pages WHERE parent_page_id = $1 ORDER BY idx, id`,
      [to],
    );
    assert.deepEqual(rows.rows.map((r) => r.id), [first, moving]);
  });

  test('a destination in another workspace is refused', async () => {
    // Moving across workspaces would carry a page out of the permissions
    // granted on it.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Page', folder);

    const other = await db.query<{ id: string }>(
      `INSERT INTO workspaces (name, created_by) VALUES ('Other', $1) RETURNING id`,
      [session.userId],
    );
    // The id is supplied explicitly: pages.id has no default, because it is the
    // document id and comes from the client that created the document.
    const foreign = await db.query<{ id: string }>(
      `INSERT INTO pages (id, workspace_id, title, idx, kind, ancestor_ids)
       VALUES (gen_random_uuid(), $1, 'Foreign', 'a0', 'folder', '{}') RETURNING id`,
      [other.rows[0]!.id],
    );

    const res = await move(session, pageId, foreign.rows[0]!.id);
    assert.equal(res.status, 404);
  });

  test('a viewer cannot move an entry', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const other = await createFolder(session, 'Other');
    const pageId = await createPage(session, 'Page', folder);

    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('mover@example.org','M',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',false,$3)`,
      [pageId, guest.rows[0]!.id, session.userId],
    );
    const login = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'mover@example.org', password: PASSWORD }),
    );

    const res = await fetch(`${base}/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieFrom(login) },
      body: JSON.stringify({ parentPageId: other }),
    });
    assert.equal(res.status, 403);
  });

  // --- tags ----------------------------------------------------------------

  const setTags = (session: Session, pageId: string, tags: string[]): Promise<Response> =>
    fetch(
      `${base}/api/pages/${pageId}`,
      auth(session, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags }),
      }),
    );

  const workspaceTags = async (
    session: Session,
  ): Promise<Array<{ key: string; label: string; count: number }>> => {
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/tags`,
      auth(session),
    );
    return (await expectJson<{ tags: Array<{ key: string; label: string; count: number }> }>(
      res,
    )).tags;
  };

  test('tags are stored and projected', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Tagged');

    await expectStatus(await setTags(session, pageId, ['Meeting', 'Acme']), 200);

    const rows = await db.query<{ tag_key: string; tag_label: string }>(
      `SELECT tag_key, tag_label FROM page_tags WHERE page_id = $1 ORDER BY tag_key`,
      [pageId],
    );
    assert.deepEqual(
      rows.rows.map((row) => [row.tag_key, row.tag_label]),
      [
        ['acme', 'Acme'],
        ['meeting', 'Meeting'],
      ],
    );
  });

  test('tags live in the document, so they survive a rebuild', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Tagged');
    await setTags(session, pageId, ['Meeting']);

    await db.query(`DELETE FROM page_tags WHERE page_id = $1`, [pageId]);
    const { rebuild } = await import('../src/materialize/rebuild.js');
    await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

    const rows = await db.query(`SELECT 1 FROM page_tags WHERE page_id = $1`, [pageId]);
    assert.equal(rows.rowCount, 1, 'restored from the document');
  });

  test('differently cased tags are one tag', async () => {
    const session = await setup();
    const first = await createPage(session, 'First');
    const second = await createPage(session, 'Second');

    await setTags(session, first, ['Meeting']);
    await setTags(session, second, ['meeting']);

    const tags = await workspaceTags(session);
    const meeting = tags.filter((tag) => tag.key === 'meeting');
    assert.equal(meeting.length, 1, 'one tag, not two');
    assert.equal(meeting[0]!.count, 2);
  });

  test('removing a tag from the last page removes it from the workspace', async () => {
    // There is no tags table: a tag exists because a page carries it, so an
    // unused one simply stops existing (ADR-0020).
    const session = await setup();
    const pageId = await createPage(session, 'Tagged');
    await setTags(session, pageId, ['Temporary']);
    assert.ok((await workspaceTags(session)).some((tag) => tag.key === 'temporary'));

    await setTags(session, pageId, []);
    assert.ok(!(await workspaceTags(session)).some((tag) => tag.key === 'temporary'));
  });

  test('an archived page does not keep its tags in the list', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Tagged');
    await setTags(session, pageId, ['Hidden']);

    await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [pageId]);
    assert.deepEqual(await workspaceTags(session), []);
  });

  test('the tag list counts only pages the caller can see', async () => {
    // A count over everything would report how much exists in a workspace
    // regardless of access, which leaks the shape of things somebody was not
    // given.
    const session = await setup();
    const visible = await createPage(session, 'Visible');
    const hidden = await createPage(session, 'Hidden');
    await setTags(session, visible, ['Shared']);
    await setTags(session, hidden, ['Shared']);

    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('tagged@example.org','G',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',false,$3)`,
      [visible, guest.rows[0]!.id, session.userId],
    );
    const login = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'tagged@example.org', password: PASSWORD }),
    );

    const res = await fetch(`${base}/api/workspaces/${session.workspaceId}/tags`, {
      headers: { cookie: cookieFrom(login) },
    });
    const body = await expectJson<{ tags: Array<{ key: string; count: number }> }>(res);
    const shared = body.tags.find((tag) => tag.key === 'shared');
    assert.equal(shared?.count, 1, 'one of the two pages');
  });

  test('a tag name typed into search finds the page carrying it', async () => {
    // Without anyone learning a filter syntax (ADR-0020).
    const session = await setup();
    const pageId = await createPage(session, 'Nothing about it in the title');
    await setTags(session, pageId, ['Quarterly']);

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/search?q=Quarterly`,
      auth(session),
    );
    const body = await expectJson<{ results: Array<{ pageId: string }> }>(res);
    assert.ok(
      body.results.some((result) => result.pageId === pageId),
      'the tagged page should be found',
    );
  });

  test('a viewer cannot change tags', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Tagged');

    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('tagviewer@example.org','V',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',false,$3)`,
      [pageId, guest.rows[0]!.id, session.userId],
    );
    const login = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'tagviewer@example.org', password: PASSWORD }),
    );

    const res = await fetch(`${base}/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieFrom(login) },
      body: JSON.stringify({ tags: ['sneaky'] }),
    });
    assert.equal(res.status, 403);
  });

  // --- search --------------------------------------------------------------

  test('search finds a page by title', async () => {
    const session = await setup();
    await createPage(session, 'Quarterly budget review');
    await createPage(session, 'Unrelated');

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/search?q=budget`,
      auth(session),
    );
    const body = (await res.json()) as { results: Array<{ title: string }> };
    assert.deepEqual(
      body.results.map((r) => r.title),
      ['Quarterly budget review'],
    );
  });

  test('a one-character query returns nothing rather than everything', async () => {
    const session = await setup();
    await createPage(session, 'Anything');
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/search?q=a`,
      auth(session),
    );
    assert.deepEqual(((await res.json()) as { results: unknown[] }).results, []);
  });

  test('search accepts what a person types without erroring', async () => {
    // websearch_to_tsquery rather than to_tsquery: a bare space or a quote
    // would make the latter throw a 500.
    const session = await setup();
    await createPage(session, 'Budget planning notes');

    for (const query of ['budget planning', '"budget planning"', 'budget or notes', 'a & b']) {
      const res = await fetch(
        `${base}/api/workspaces/${session.workspaceId}/search?q=${encodeURIComponent(query)}`,
        auth(session),
      );
      assert.equal(res.status, 200, `query ${query} must not error`);
    }
  });

  test('archived pages are excluded from search', async () => {
    const session = await setup();
    const pageId = await createPage(session, 'Archived budget');
    await fetch(`${base}/api/pages/${pageId}`, auth(session, { method: 'DELETE' }));

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/search?q=budget`,
      auth(session),
    );
    assert.deepEqual(((await res.json()) as { results: unknown[] }).results, []);
  });

  test('search does not leak pages the caller cannot see', async () => {
    const session = await setup();
    const visible = await createPage(session, 'Budget visible');
    const hidden = await createPage(session, 'Budget hidden');

    // A guest with a grant on one page only.
    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('guest@example.org','Guest',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',false,$3)`,
      [visible, guest.rows[0]!.id, session.userId],
    );

    const loginRes = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'guest@example.org', password: PASSWORD }),
    );
    const guestSession = {
      cookie: cookieFrom(loginRes),
      workspaceId: session.workspaceId,
      userId: guest.rows[0]!.id,
    };

    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/search?q=budget`,
      auth(guestSession),
    );
    const body = (await res.json()) as { results: Array<{ pageId: string }> };
    assert.deepEqual(
      body.results.map((r) => r.pageId),
      [visible],
    );
    assert.ok(!body.results.some((r) => r.pageId === hidden));
  });

  test('the page tree does not leak pages the caller cannot see', async () => {
    const session = await setup();
    const visible = await createPage(session, 'Granted');
    await createPage(session, 'Not granted');

    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('g2@example.org','G2',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'viewer',false,$3)`,
      [visible, guest.rows[0]!.id, session.userId],
    );

    const loginRes = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'g2@example.org', password: PASSWORD }),
    );
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      { headers: { cookie: cookieFrom(loginRes) } },
    );
    const body = (await res.json()) as { pages: Array<{ id: string }> };
    assert.deepEqual(
      body.pages.map((p) => p.id),
      [visible],
    );
  });

  test('a guest cannot create a top-level page', async () => {
    const session = await setup();
    const hash = await hashPassword(PASSWORD);
    const guest = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, is_guest)
       VALUES ('g3@example.org','G3',$1,true) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
      [session.workspaceId, guest.rows[0]!.id],
    );
    const loginRes = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'g3@example.org', password: PASSWORD }),
    );

    const res = await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieFrom(loginRes) },
      body: JSON.stringify({ title: 'Sneaky' }),
    });
    assert.equal(res.status, 403);
  });

  test('a share link does not grant HTTP page access on its own', async () => {
    // Share tokens authenticate the sync connection. The HTTP API takes a
    // session cookie, and a token in a URL must not be mistaken for one.
    const session = await setup();
    const pageId = await createPage(session, 'Shared');
    await createShareLink(db, { pageId, createdBy: session.userId });

    const res = await fetch(`${base}/api/pages/${pageId}`);
    assert.equal(res.status, 401);
  });
});
