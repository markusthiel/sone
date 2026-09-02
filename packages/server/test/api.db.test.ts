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

import { SCHEMA_VERSION } from '@sone/core';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { createHash } from 'node:crypto';

import { zip } from '../src/export/zip.js';
import { registerExportRoutes } from '../src/export/routes.js';
import { registerImportRoutes } from '../src/import/routes.js';
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
import * as Y from 'yjs';

import { addThread } from '@sone/core';

import { applyToDocument } from '../src/doc/docStore.js';
import { rematerialize } from '../src/materialize/rematerialize.js';
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
      signupMode: () => Promise.resolve('invite' as const),
      secureCookies: false,
    });
    registerPageRoutes(router, { pool: db });
    /*
     * The export route lives in its own module, so it has to be registered
     * here too — which is the answer to why this test first saw a 404: the
     * router had never heard of it.
     *
     * With a store that refuses: this test exports pages without attachments,
     * and a stub that throws proves the route survives a file it cannot read
     * rather than hiding the case behind a real store that always can.
     */
    /*
     * An import with a store that keeps bytes in a map.
     *
     * A real `LocalFileStore` would need a directory per test run; a refusing
     * stub would make every archive's pictures arrive as missing and prove
     * nothing about the path that stores them. This is the smallest thing that
     * exercises it.
     */
    const stored = new Map<string, Buffer>();
    registerImportRoutes(router, {
      pool: db,
      maxUploadBytes: 32 * 1024 * 1024,
      store: {
        kind: 'memory',
        put: (bytes: Buffer, extension: string) => {
          const key = `ab/${stored.size}.${extension}`;
          stored.set(key, bytes);
          return Promise.resolve({
            key,
            sizeBytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest(),
          });
        },
        get: (key: string) =>
          stored.has(key)
            ? Promise.resolve(stored.get(key)!)
            : Promise.reject(new Error('missing')),
        delete: (key: string) => {
          stored.delete(key);
          return Promise.resolve();
        },
        exists: (key: string) => Promise.resolve(stored.has(key)),
        size: (key: string) => Promise.resolve(stored.get(key)?.length ?? 0),
        read: () => Promise.reject(new Error('not in this test')),
      },
    });
    registerExportRoutes(router, {
      pool: db,
      store: {
        kind: 'stub',
        put: () => Promise.reject(new Error('not in this test')),
        get: () => Promise.reject(new Error('not in this test')),
        delete: () => Promise.reject(new Error('not in this test')),
        exists: () => Promise.resolve(false),
        size: () => Promise.reject(new Error('not in this test')),
        read: () => Promise.reject(new Error('not in this test')),
      },
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

  test('a canvas can be created, and comes back as one', async () => {
    // It could not: the database's own check constraint listed the kinds and a
    // canvas was not among them, so every attempt failed with "something went
    // wrong" — the interface offering something the schema refuses.
    const session = await setup();
    // Inside a folder, because a canvas is a page-like thing and the root holds
    // only folders (ADR-0019) — the same rule, and the reason the button at the
    // foot of the sidebar was wrong as well as unwanted.
    const folder = await createFolder(session, 'Boards');
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/pages`,
      auth(session, json({ title: 'Board', kind: 'canvas', parentPageId: folder })),
    );
    const created = await expectJson<{ id: string }>(res, 201);

    const tree = await expectJson<{ pages: Array<{ id: string; kind: string }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, auth(session)),
      200,
    );
    const found = tree.pages.find((page) => page.id === created.id);
    assert.equal(found?.kind, 'canvas', 'the tree says what it is');
  });

  test('a page started from a template is a copy of it, and is not itself one', async () => {
    // Copied as a document rather than as text (ADR-0045): a round trip through
    // Markdown loses collections, canvases, table widths and block attributes,
    // which are the things somebody built a template for.
    const session = await setup();
    const folder = await createFolder(session, 'Shapes');

    const template = await expectJson<{ id: string }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ title: 'Meeting notes', parentPageId: folder })),
      ),
      201,
    );

    // Nothing is offered until somebody says so.
    let list = await expectJson<{ templates: Array<{ id: string; title: string }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/templates`, auth(session)),
      200,
    );
    assert.deepEqual(list.templates, []);

    await expectStatus(
      await fetch(
        `${base}/api/pages/${template.id}`,
        auth(session, { ...json({ template: true }), method: 'PATCH' }),
      ),
      200,
    );

    list = await expectJson<{ templates: Array<{ id: string; title: string }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/templates`, auth(session)),
      200,
    );
    assert.deepEqual(
      list.templates.map((one) => one.title),
      ['Meeting notes'],
    );

    const made = await expectJson<{ id: string }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ parentPageId: folder, templateId: template.id })),
      ),
      201,
    );
    assert.notEqual(made.id, template.id);

    // The copy is not itself a shape to start from: two entries in that list
    // after using it once would become four after using it twice.
    const after = await expectJson<{ templates: Array<{ id: string }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/templates`, auth(session)),
      200,
    );
    assert.deepEqual(
      after.templates.map((one) => one.id),
      [template.id],
    );
  });

  test('a page that is not a template cannot be started from', async () => {
    // Refused as not found rather than as not-a-template: the distinction would
    // say whether the page exists.
    const session = await setup();
    const folder = await createFolder(session, 'Pages');
    const ordinary = await expectJson<{ id: string }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ title: 'Just a page', parentPageId: folder })),
      ),
      201,
    );

    await expectStatus(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ parentPageId: folder, templateId: ordinary.id })),
      ),
      404,
    );
  });

  /**
   * Edit a page's document the way a client would, through the server's own
   * path — so the update is stored, materialised and visible to the projection.
   */
  async function withDoc(
    pageId: string,
    mutate: (doc: Y.Doc) => void,
    session_: Session,
  ): Promise<void> {
    await applyToDocument(db, pageId, mutate, null);
    // And projected, which `applyToDocument` deliberately does not do — it
    // writes the log and leaves the projection to its caller, because the sync
    // room materialises on its own schedule. A test that skipped this checked
    // the log and called it a projection.
    await rematerialize(db, pageId, session_.workspaceId);
  }

  test('the workspace lists what is still waiting, and only what may be read', async () => {
    // The question the projection exists for (ADR-0046): no amount of opening
    // documents answers "what has somebody asked that nobody has answered".
    const session = await setup();
    const folder = await createFolder(session, 'Drafts');
    const page = await expectJson<{ id: string }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ title: 'A draft', parentPageId: folder })),
      ),
      201,
    );

    // Nothing yet, and the answer is a list rather than an error.
    const empty = await expectJson<{ threads: unknown[] }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/comments`, auth(session)),
      200,
    );
    assert.deepEqual(empty.threads, []);

    // A thread, written into the document the way a client would.
    await withDoc(
      page.id,
      (doc) => {
        const text = doc.getText('probe');
      text.insert(0, 'The quick brown fox');
        addThread(doc, {
          id: 'thread-1',
          from: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 4)),
          to: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 9)),
          quote: 'quick',
          messageId: 'msg-1',
          author: 'guest:Anna',
          text: 'Is it though?',
        });
      },
      session,
    );

    const open = await expectJson<{
      threads: Array<{ threadId: string; quote: string; pageTitle: string; openedBy: string }>;
    }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/comments`, auth(session)),
      200,
    );
    assert.deepEqual(
      open.threads.map((one) => [one.threadId, one.quote, one.pageTitle, one.openedBy]),
      [['thread-1', 'quick', 'A draft', 'guest:Anna']],
    );

    // Deleting the words it was about moves it to the other list rather than
    // dropping it: unfinished business of a different kind.
    await withDoc(page.id, (doc) => doc.getText('probe').delete(4, 5), session);

    const stillOpen = await expectJson<{ threads: unknown[] }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/comments`, auth(session)),
      200,
    );
    assert.deepEqual(stillOpen.threads, [], 'no longer in the open list');

    const detached = await expectJson<{ threads: Array<{ threadId: string; quote: string }> }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/comments?state=detached`,
        auth(session),
      ),
      200,
    );
    assert.deepEqual(
      detached.threads.map((one) => [one.threadId, one.quote]),
      [['thread-1', 'quick']],
      'and it still says what it was about',
    );
  });

  test('a page can be locked, and the lock reaches the tree', async () => {
    // A guard, not a permission (ADR-0049): the same edit right the route
    // already requires is enough to set it and to lift it. What it must do is
    // arrive — in the document, where an open editor sees it, and in the
    // projection, so the tree can draw a padlock without opening anything.
    const session = await setup();
    const folder = await createFolder(session, 'Sperren');
    const page = await expectJson<{ id: string }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ title: 'Zahlen', parentPageId: folder })),
      ),
      201,
    );

    await expectStatus(
      await fetch(`${base}/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { ...auth(session).headers, 'content-type': 'application/json' },
        body: JSON.stringify({ locked: true }),
      }),
      200,
    );

    const locked = await db.query<{ locked: boolean }>(
      `SELECT locked FROM pages WHERE id = $1`,
      [page.id],
    );
    assert.equal(locked.rows[0]?.locked, true, 'projected');

    const tree = await expectJson<{ pages: Array<{ id: string; locked?: boolean }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, auth(session)),
      200,
    );
    const found = JSON.stringify(tree).includes('"locked":true');
    assert.equal(found, true, 'and in the tree');

    // Lifted again by the same right, because it is a lock and not a
    // permission: nothing else may be required to undo it.
    await expectStatus(
      await fetch(`${base}/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { ...auth(session).headers, 'content-type': 'application/json' },
        body: JSON.stringify({ locked: false }),
      }),
      200,
    );
    const after = await db.query<{ locked: boolean }>(
      `SELECT locked FROM pages WHERE id = $1`,
      [page.id],
    );
    assert.equal(after.rows[0]?.locked, false);
  });

  test('an import is planned before it is carried out', async () => {
    // The split is the feature (ADR-0044): planning writes nothing, and nothing
    // is written before somebody has seen what would be.
    const session = await setup();
    const folder = await createFolder(session, 'Ziel');

    const archive = zip([
      { name: 'Ordner/index.md', body: Buffer.from('# Ordner\n'), at: new Date() },
      {
        name: 'Ordner/Notiz.md',
        body: Buffer.from('# Notiz\n\nEin Satz.\n'),
        at: new Date(),
      },
      { name: 'Ordner/style.css', body: Buffer.from('body{}'), at: new Date() },
    ]);

    const planned = await expectJson<{
      pages: Array<{ path: string[]; title: string; isFolder: boolean; collides: boolean }>;
      skipped: Array<{ name: string; reason: string }>;
      totals: { pages: number; folders: number };
      attachmentsImported: boolean;
    }>(
      await fetch(`${base}/api/pages/${folder}/import/plan`, {
        method: 'POST',
        headers: { ...auth(session).headers, 'content-type': 'application/zip' },
        body: archive,
      }),
      200,
    );

    assert.deepEqual(
      planned.pages.map((page) => [page.path.join('/'), page.isFolder]),
      [
        ['Ordner', true],
        ['Ordner/Notiz', false],
      ],
    );
    assert.deepEqual(planned.skipped, [{ name: 'Ordner/style.css', reason: 'not_markdown' }]);
    // True since the files came back too. The flag stays in the response
    // because the interface reads it — and this assertion failing when
    // attachments were implemented is the test doing its job: it was written to
    // pin down a promise, and the promise changed.
    assert.equal(planned.attachmentsImported, true);

    // Nothing written yet.
    let tree = await expectJson<{ pages: Array<{ id: string }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, auth(session)),
      200,
    );
    const before = JSON.stringify(tree).includes('Ordner');
    assert.equal(before, false, 'planning wrote nothing');

    const done = await expectJson<{ created: number; failed: unknown[] }>(
      await fetch(`${base}/api/pages/${folder}/import`, {
        method: 'POST',
        headers: { ...auth(session).headers, 'content-type': 'application/zip' },
        body: archive,
      }),
      200,
    );
    assert.equal(done.created, 2);
    assert.deepEqual(done.failed, []);

    tree = await expectJson<{ pages: Array<{ id: string }> }>(
      await fetch(`${base}/api/workspaces/${session.workspaceId}/pages`, auth(session)),
      200,
    );
    assert.ok(JSON.stringify(tree).includes('Notiz'), 'and now it is there');
  });

  test('a picture in an archive arrives as a picture', async () => {
    // The last piece of the round trip: without this the link is imported as
    // literal `![…]` characters, so a page describes its own pictures instead
    // of showing them — and the file behind it is nowhere.
    const session = await setup();
    const folder = await createFolder(session, 'Bilder');

    // A real PNG header, because the store refuses bytes it cannot describe: a
    // wrong mime type is a file the browser renders wrongly or refuses.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);

    const archive = zip([
      {
        name: 'Seite.md',
        body: Buffer.from('# Seite\n\n![Ein Plan](attachments/f-1)\n'),
        at: new Date(),
      },
      { name: 'attachments/f-1', body: png, at: new Date() },
    ]);

    const done = await expectJson<{ created: number }>(
      await fetch(`${base}/api/pages/${folder}/import`, {
        method: 'POST',
        headers: { ...auth(session).headers, 'content-type': 'application/zip' },
        body: archive,
      }),
      200,
    );
    assert.equal(done.created, 1);

    const blocks = await db.query<{ type: string; props: { fileId?: string } }>(
      `SELECT b.type, b.props FROM blocks b JOIN pages p ON p.id = b.page_id
        WHERE p.title = 'Seite' AND p.workspace_id = $1`,
      [session.workspaceId],
    );
    assert.equal(blocks.rows[0]?.type, 'image', 'a picture, not a paragraph');
    const fileId = blocks.rows[0]?.props.fileId;
    assert.ok(fileId, 'and it names a file that exists here');

    const file = await db.query<{ mime_type: string; page_id: string }>(
      `SELECT mime_type, page_id FROM files WHERE id = $1`,
      [fileId],
    );
    assert.equal(file.rows[0]?.mime_type, 'image/png');
    // Files are authorised through their page, so the file hangs on the page
    // that referred to it.
    assert.ok(file.rows[0]?.page_id, 'and it hangs on a page');
  });

  test('something that is not an archive is refused with a reason', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Ziel zwei');
    const res = await fetch(`${base}/api/pages/${folder}/import/plan`, {
      method: 'POST',
      headers: { ...auth(session).headers, 'content-type': 'application/zip' },
      body: Buffer.from('Not a zip at all.'),
    });
    assert.equal(res.status, 422);
    // The parser's own code, so the interface can say why: "not an archive" and
    // "too large uncompressed" are different problems with different fixes.
    assert.equal(((await res.json()) as { error: string }).error, 'not_an_archive');
  });

  test('exporting a folder hands back its pages, and refuses what may not be read', async () => {
    // The most consequential use of the visibility condition in the codebase: a
    // file on a laptop outlives every permission change (ADR-0044).
    const session = await setup();
    const folder = await createFolder(session, 'Buchhaltung');
    const page = await expectJson<{ id: string }>(
      await fetch(
        `${base}/api/workspaces/${session.workspaceId}/pages`,
        auth(session, json({ title: 'Übersicht', parentPageId: folder })),
      ),
      201,
    );
    void page;

    const res = await fetch(`${base}/api/pages/${folder}/export`, auth(session));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    // The name survives the trip, which the plain `filename` parameter has no
    // encoding for.
    assert.match(
      res.headers.get('content-disposition') ?? '',
      /filename\*=UTF-8''Buchhaltung\.zip/,
    );

    const archive = Buffer.from(await res.arrayBuffer());
    const text = archive.toString('latin1');
    // A folder becomes a directory with an index, and its page a file beside it.
    assert.ok(text.includes('Buchhaltung/index.md'), 'the folder has an index');
    assert.ok(
      archive.includes(Buffer.from('Buchhaltung/Übersicht.md', 'utf8')),
      'and the page keeps its name, umlaut included',
    );

    // Somebody with no session gets nothing, and cannot tell the page exists.
    const anonymous = await fetch(`${base}/api/pages/${folder}/export`);
    assert.equal(anonymous.status, 401);
  });

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
    // Whatever this build of SONE writes, rather than a number spelt out here: a
    // literal would have to be edited by every schema bump, and a test that has
    // to be edited to keep passing stops being a check (ADR-0039 bumped it).
    assert.equal(row.rows[0]!.schema_version, SCHEMA_VERSION);
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

  const moveAfter = (
    session: Session,
    pageId: string,
    parentPageId: string | null,
    afterPageId: string | null,
  ): Promise<Response> =>
    fetch(
      `${base}/api/pages/${pageId}`,
      auth(session, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentPageId, afterPageId }),
      }),
    );

  const order = async (session: Session, parentId: string): Promise<string[]> => {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM pages WHERE parent_page_id = $1 ORDER BY idx, id`,
      [parentId],
    );
    return rows.rows.map((row) => row.id);
  };

  test('an entry can be placed between two siblings', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const first = await createPage(session, 'First', folder);
    const second = await createPage(session, 'Second', folder);
    const third = await createPage(session, 'Third', folder);

    await expectStatus(await moveAfter(session, third, folder, first), 200);
    assert.deepEqual(await order(session, folder), [first, third, second]);
  });

  test('an entry can be placed first', async () => {
    // null means first, and is deliberately different from omitting the field,
    // which means last.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const first = await createPage(session, 'First', folder);
    const second = await createPage(session, 'Second', folder);

    await expectStatus(await moveAfter(session, second, folder, null), 200);
    assert.deepEqual(await order(session, folder), [second, first]);
  });

  test('a move without a position still lands last', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const other = await createFolder(session, 'Other');
    const first = await createPage(session, 'First', folder);
    const second = await createPage(session, 'Second', folder);
    const arriving = await createPage(session, 'Arriving', other);

    await expectStatus(await move(session, arriving, folder), 200);
    assert.deepEqual(await order(session, folder), [first, second, arriving]);
  });

  test('reordering only rewrites the entry that moved', async () => {
    // Fractional indices, so a reorder is one row (ADR-0015). Renumbering every
    // sibling would make two people reordering the same folder collide over
    // rows neither of them touched.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const first = await createPage(session, 'First', folder);
    const second = await createPage(session, 'Second', folder);
    const third = await createPage(session, 'Third', folder);

    const before = await db.query<{ id: string; idx: string }>(
      `SELECT id, idx FROM pages WHERE parent_page_id = $1`,
      [folder],
    );
    await moveAfter(session, third, folder, first);
    const after = await db.query<{ id: string; idx: string }>(
      `SELECT id, idx FROM pages WHERE parent_page_id = $1`,
      [folder],
    );

    const changed = after.rows.filter(
      (row) => before.rows.find((other) => other.id === row.id)?.idx !== row.idx,
    );
    assert.deepEqual(changed.map((row) => row.id), [third]);
    assert.ok(second);
  });

  test('a sibling that is not there is refused, not guessed at', async () => {
    // A stale tree in the client, or a concurrent move. "Put it after that one"
    // has no meaning if that one is not here, and placing it somewhere
    // arbitrary would look like the drop landed wrong.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const other = await createFolder(session, 'Other');
    const page = await createPage(session, 'Page', folder);
    const elsewhere = await createPage(session, 'Elsewhere', other);

    const res = await moveAfter(session, page, folder, elsewhere);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'sibling_not_found' });
  });

  test('reordering survives a rebuild', async () => {
    // The index lives in the document, so a reorder that only touched the
    // projection would be undone by the next materialisation.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const first = await createPage(session, 'First', folder);
    const second = await createPage(session, 'Second', folder);

    await moveAfter(session, second, folder, null);
    const { rebuild } = await import('../src/materialize/rebuild.js');
    await rebuild(db, { workspaceId: session.workspaceId, log: () => {} });

    assert.deepEqual(await order(session, folder), [second, first]);
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

  // --- trash ---------------------------------------------------------------

  const archive = (session: Session, pageId: string): Promise<Response> =>
    fetch(`${base}/api/pages/${pageId}`, auth(session, { method: 'DELETE' }));

  const trash = async (session: Session): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/trash`,
      auth(session),
    );
    return (await expectJson<{ entries: Array<Record<string, unknown>> }>(res)).entries;
  };

  const restore = (session: Session, pageId: string): Promise<Response> =>
    fetch(`${base}/api/pages/${pageId}/restore`, auth(session, { method: 'POST' }));

  const destroy = (session: Session, pageId: string): Promise<Response> =>
    fetch(
      `${base}/api/pages/${pageId}/permanently`,
      auth(session, { method: 'DELETE' }),
    );

  test('an archived page appears in the trash and can be restored', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Deleted by mistake', folder);

    await expectStatus(await archive(session, pageId), 204);
    const entries = await trash(session);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!['id'], pageId);

    await expectStatus(await restore(session, pageId), 200);
    assert.deepEqual(await trash(session), []);

    const row = await db.query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM pages WHERE id = $1`,
      [pageId],
    );
    assert.equal(row.rows[0]!.archived_at, null);
  });

  test('the trash lists one deletion once, not every descendant', async () => {
    // Archiving a folder archives its subtree. Listing all of it would show one
    // deletion as forty entries and bury what somebody is looking for.
    const session = await setup();
    const folder = await createFolder(session, 'Project');
    const inner = await createFolder(session, 'Notes', folder);
    await createPage(session, 'One', inner);
    await createPage(session, 'Two', inner);

    await archive(session, folder);

    const entries = await trash(session);
    assert.equal(entries.length, 1, 'the folder that was deleted');
    assert.equal(entries[0]!['id'], folder);
    assert.equal(entries[0]!['descendants'], 3, 'and it says how much went with it');
  });

  test('restoring brings the subtree back with it', async () => {
    // It was archived as one action; restoring only the top would leave the
    // children in the trash, invisible from the tree and from the listing.
    const session = await setup();
    const folder = await createFolder(session, 'Project');
    const pageId = await createPage(session, 'Inside', folder);

    await archive(session, folder);
    await restore(session, folder);

    const rows = await db.query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM pages WHERE id = ANY($1::uuid[])`,
      [[folder, pageId]],
    );
    assert.ok(rows.rows.every((row) => row.archived_at === null));
  });

  test('a page whose folder is gone says so instead of moving', async () => {
    // Silently putting it somewhere else is how somebody loses track of it a
    // second time.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Orphan', folder);

    await archive(session, pageId);
    await archive(session, folder);

    const res = await restore(session, pageId);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'parent_missing' });
  });

  test('a folder whose parent is gone is restored to the root', async () => {
    // A folder may sit at the root, so it has somewhere to go (ADR-0019).
    const session = await setup();
    const outer = await createFolder(session, 'Outer');
    const inner = await createFolder(session, 'Inner', outer);

    await archive(session, inner);
    await archive(session, outer);

    const res = await restore(session, inner);
    const body = await expectJson<{ restoredToRoot: boolean }>(res);
    assert.equal(body.restoredToRoot, true);

    const row = await db.query<{ parent_page_id: string | null }>(
      `SELECT parent_page_id FROM pages WHERE id = $1`,
      [inner],
    );
    assert.equal(row.rows[0]!.parent_page_id, null);
  });

  test('the trash marks entries whose parent is gone', async () => {
    // So somebody can see the problem before pressing restore.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Orphan', folder);
    await archive(session, pageId);
    await archive(session, folder);

    const entries = await trash(session);
    const orphan = entries.find((entry) => entry['id'] === pageId);
    assert.equal(orphan?.['parentMissing'], true);
  });

  test('restoring something that is not archived is refused', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Live', folder);

    const res = await restore(session, pageId);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'not_archived' });
  });

  // --- permanent deletion --------------------------------------------------

  test('a live page cannot be destroyed in one step', async () => {
    // Deleting is always two steps: archive, then destroy. A single mistaken
    // call cannot take a live page with it.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Live', folder);

    const res = await destroy(session, pageId);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'not_archived' });

    const row = await db.query(`SELECT 1 FROM pages WHERE id = $1`, [pageId]);
    assert.equal(row.rowCount, 1, 'and it is still there');
  });

  test('an archived page can be destroyed, with its subtree', async () => {
    const session = await setup();
    const folder = await createFolder(session, 'Project');
    const pageId = await createPage(session, 'Inside', folder);

    await archive(session, folder);
    await expectStatus(await destroy(session, folder), 200);

    const rows = await db.query(`SELECT 1 FROM pages WHERE id = ANY($1::uuid[])`, [
      [folder, pageId],
    ]);
    assert.equal(rows.rowCount, 0);
  });

  test('destroying takes the document with it', async () => {
    // The CRDT log is where the content lives, so this is genuinely
    // irreversible — which is why it needs two steps and admin rights.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Gone', folder);

    await archive(session, pageId);
    await destroy(session, pageId);

    const updates = await db.query(`SELECT 1 FROM doc_updates WHERE doc_id = $1`, [
      pageId,
    ]);
    assert.equal(updates.rowCount, 0, 'no updates left to rebuild from');
  });

  test('an editor cannot destroy, only archive', async () => {
    // Destroying content is not the same kind of act as changing it.
    const session = await setup();
    const folder = await createFolder(session, 'Folder');
    const pageId = await createPage(session, 'Page', folder);
    await archive(session, pageId);

    const hash = await hashPassword(PASSWORD);
    const editor = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('destroyer@example.org','E',$1) RETURNING id`,
      [hash],
    );
    await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'member')`,
      [session.workspaceId, editor.rows[0]!.id],
    );
    await db.query(
      `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
       VALUES ($1,$2,'editor',true,$3)`,
      [pageId, editor.rows[0]!.id, session.userId],
    );
    const login = await fetch(
      `${base}/api/auth/login`,
      json({ email: 'destroyer@example.org', password: PASSWORD }),
    );

    const res = await fetch(`${base}/api/pages/${pageId}/permanently`, {
      method: 'DELETE',
      headers: { cookie: cookieFrom(login) },
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

  interface TagSummary {
    key: string;
    label: string;
    count: number;
    color: string;
    colorChosen: boolean;
  }

  const workspaceTags = async (session: Session): Promise<TagSummary[]> => {
    const res = await fetch(
      `${base}/api/workspaces/${session.workspaceId}/tags`,
      auth(session),
    );
    return (await expectJson<{ tags: TagSummary[] }>(res)).tags;
  };

  const setTagColor = (
    session: Session,
    key: string,
    color: string | null,
  ): Promise<Response> =>
    fetch(
      `${base}/api/workspaces/${session.workspaceId}/tags/${encodeURIComponent(key)}/color`,
      auth(session, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ color }),
      }),
    );

  test('every tag has a colour without anybody choosing one', async () => {
    // Derived from the name, so a tag is the same colour for everybody with
    // nothing stored — which is what lets tags have colours at all without the
    // registry ADR-0020 rejected.
    const session = await setup();
    const page = await createPage(session, 'Tagged');
    await setTags(session, page, ['urgent', 'later']);

    const tags = await workspaceTags(session);
    for (const tag of tags) {
      assert.ok(tag.color, `${tag.key} has a colour`);
      assert.notEqual(tag.color, 'grey', 'grey is reserved for a choice');
      assert.equal(tag.colorChosen, false);
    }
  });

  test('a chosen colour replaces the derived one', async () => {
    const session = await setup();
    const page = await createPage(session, 'Tagged');
    await setTags(session, page, ['urgent']);

    await expectStatus(await setTagColor(session, 'urgent', 'red'), 200);

    const [tag] = await workspaceTags(session);
    assert.equal(tag?.color, 'red');
    assert.equal(tag?.colorChosen, true);
  });

  test('clearing a colour returns to the derived one', async () => {
    // The row is deleted rather than storing the derived value: stored, it
    // would look like somebody chose it.
    const session = await setup();
    const page = await createPage(session, 'Tagged');
    await setTags(session, page, ['urgent']);
    await setTagColor(session, 'urgent', 'red');

    await expectStatus(await setTagColor(session, 'urgent', null), 200);

    const [tag] = await workspaceTags(session);
    assert.notEqual(tag?.color, 'red');
    assert.equal(tag?.colorChosen, false);

    const rows = await db.query(`SELECT count(*)::int AS n FROM workspace_tag_colors`);
    assert.equal((rows.rows[0] as { n: number }).n, 0, 'and nothing is left behind');
  });

  test('a colour follows the normalised tag, not the spelling', async () => {
    // "Urgent" and "urgent" are one tag, and colouring them separately would
    // say otherwise.
    const session = await setup();
    const page = await createPage(session, 'Tagged');
    await setTags(session, page, ['Urgent']);

    await expectStatus(await setTagColor(session, '  URGENT ', 'blue'), 200);

    const [tag] = await workspaceTags(session);
    assert.equal(tag?.color, 'blue');
  });

  test('a colour value is refused; only palette names are stored', async () => {
    // A name survives a theme change where a stored hex cannot.
    const session = await setup();
    const res = await setTagColor(session, 'urgent', '#ff0000');
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'unsupported_color' });
  });

  test('colouring a tag that nobody uses is harmless', async () => {
    // A row for an unused name is simply never read — this table is not the
    // authority on which tags exist (ADR-0020).
    const session = await setup();
    await expectStatus(await setTagColor(session, 'nobody-uses-this', 'green'), 200);
    assert.deepEqual(await workspaceTags(session), []);
  });

  test('an icon and its colours are stored and projected', async () => {
    // The column and the document key have existed since the first migration
    // and nothing ever wrote one.
    const session = await setup();
    const page = await createPage(session, 'Folder');

    await expectStatus(
      await fetch(`${base}/api/pages/${page}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({
          title: 'Folder',
          icon: { kind: 'icon', value: 'folder', color: 'blue' },
          titleColor: 'green',
        }),
      }),
      200,
    );

    const stored = await db.query<{ icon: Record<string, unknown> }>(
      `SELECT icon FROM pages WHERE id = $1`,
      [page],
    );
    assert.deepEqual(stored.rows[0]?.icon, {
      kind: 'icon',
      value: 'folder',
      color: 'blue',
      titleColor: 'green',
    });
  });

  test('clearing an icon leaves the title colour alone', async () => {
    // They are two decisions, and one is commonly wanted without the other.
    const session = await setup();
    const page = await createPage(session, 'Folder');
    const patch = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${base}/api/pages/${page}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ title: 'Folder', ...body }),
      });

    await patch({ icon: { kind: 'icon', value: 'folder' }, titleColor: 'red' });
    await expectStatus(await patch({ icon: null }), 200);

    const stored = await db.query<{ icon: Record<string, unknown> | null }>(
      `SELECT icon FROM pages WHERE id = $1`,
      [page],
    );
    assert.deepEqual(stored.rows[0]?.icon, { titleColor: 'red' });
  });

  test('an icon colour can be cleared', async () => {
    // It could not: the new icon was assigned onto the existing object, so a
    // request naming no colour left the previous one in place — "no colour"
    // was the one swatch that did nothing.
    const session = await setup();
    const page = await createPage(session, 'Folder');
    const patch = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${base}/api/pages/${page}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify(body),
      });

    await patch({ icon: { kind: 'icon', value: 'folder', color: 'red' } });
    await expectStatus(await patch({ icon: { kind: 'icon', value: 'folder' } }), 200);

    const stored = await db.query<{ icon: Record<string, unknown> }>(
      `SELECT icon FROM pages WHERE id = $1`,
      [page],
    );
    assert.deepEqual(stored.rows[0]?.icon, { kind: 'icon', value: 'folder' });
  });

  test('a rename does not disturb an icon', async () => {
    // Titles are renamed far more often than icons are set, and losing one to
    // the other would be a quiet, repeated annoyance.
    const session = await setup();
    const page = await createPage(session, 'Folder');
    await fetch(`${base}/api/pages/${page}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ title: 'Folder', icon: { kind: 'icon', value: 'folder' } }),
    });

    await expectStatus(
      await fetch(`${base}/api/pages/${page}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({ title: 'Renamed' }),
      }),
      200,
    );

    const stored = await db.query<{ title: string; icon: Record<string, unknown> | null }>(
      `SELECT title, icon FROM pages WHERE id = $1`,
      [page],
    );
    assert.equal(stored.rows[0]?.title, 'Renamed');
    assert.deepEqual(stored.rows[0]?.icon, { kind: 'icon', value: 'folder' });
  });

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
