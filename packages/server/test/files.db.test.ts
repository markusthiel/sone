/**
 * File upload and serving.
 *
 * A file store reachable by upload is the most dangerous surface in the
 * application: the content is supplied by people, served from the origin that
 * holds everyone's notes, and shared. Most of these tests are about what is
 * refused rather than what works.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';

import { registerAuthRoutes, SESSION_COOKIE, parseCookies } from '../src/http/auth.js';
import { registerPageRoutes } from '../src/http/pages.js';
import { Router } from '../src/http/router.js';
import { registerFileRoutes } from '../src/files/routes.js';
import { LocalFileStore, detectType, isInlineImage } from '../src/files/store.js';
import { hashPassword } from '../src/auth/password.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';
import { expectJson, expectStatus } from './support/http.js';

const PASSWORD = 'correct-horse-battery-staple';

/** A minimal valid PNG: signature plus enough bytes to be a file. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 3)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(64, 1)]);

describe(
  'files (database)',
  { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false },
  () => {
    let db: Pool;
    let server: Server;
    let base: string;
    let storageRoot: string;

    before(async () => {
      db = await getTestPool();
      storageRoot = await mkdtemp(path.join(tmpdir(), 'sone-files-'));

      const router = new Router();
      registerAuthRoutes(router, { pool: db, signupMode: () => Promise.resolve('open' as const), secureCookies: false });
      registerPageRoutes(router, { pool: db });
      registerFileRoutes(router, {
        pool: db,
        store: new LocalFileStore(storageRoot),
        maxUploadBytes: 1024,
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
      await rm(storageRoot, { recursive: true, force: true });
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

    async function setup(): Promise<{ cookie: string; pageId: string; workspaceId: string; userId: string }> {
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
      const cookie = cookieFrom(res);

      const folder = await db.query<{ id: string }>(
        `SELECT id FROM pages WHERE workspace_id = $1 AND kind = 'folder' LIMIT 1`,
        [body.workspaceId],
      );
      const page = await fetch(
        `${base}/api/workspaces/${body.workspaceId}/pages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ title: 'Page', parentPageId: folder.rows[0]!.id }),
        },
      );
      const created = await expectJson<{ id: string }>(page, 201);
      return { cookie, pageId: created.id, workspaceId: body.workspaceId, userId: body.userId };
    }

    const upload = (
      cookie: string,
      pageId: string,
      bytes: Buffer,
      filename = 'image.png',
    ): Promise<Response> =>
      fetch(`${base}/api/pages/${pageId}/files?filename=${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
      });

    // --- type detection ----------------------------------------------------

    test('types are detected from the bytes', () => {
      assert.equal(detectType(PNG)?.mime, 'image/png');
      assert.equal(detectType(JPEG)?.mime, 'image/jpeg');
      assert.equal(detectType(PDF)?.mime, 'application/pdf');
    });

    test('unrecognised bytes are refused rather than given a generic type', () => {
      // A stored file with an unknown type is one somebody will eventually be
      // tempted to serve.
      assert.equal(detectType(Buffer.from('<html><script>alert(1)</script>')), null);
      assert.equal(detectType(Buffer.alloc(0)), null);
      assert.equal(detectType(Buffer.from('just text')), null);
    });

    test('SVG is not an inline type', () => {
      // An SVG is a document that can carry script, so serving one inline from
      // the application's own origin is a cross-site scripting vector — and a
      // notes app is exactly where someone pastes one without thinking.
      assert.equal(isInlineImage('image/svg+xml'), false);
      assert.equal(isInlineImage('text/html'), false);
      assert.equal(isInlineImage('application/pdf'), false);
      assert.equal(isInlineImage('image/png'), true);
    });

    // --- upload ------------------------------------------------------------

    test('an image can be uploaded and fetched back', async () => {
      const session = await setup();
      const res = await upload(session.cookie, session.pageId, PNG);
      const body = await expectJson<{ id: string; url: string; mimeType: string }>(res, 201);
      assert.equal(body.mimeType, 'image/png');

      const fetched = await fetch(`${base}${body.url}`, {
        headers: { cookie: session.cookie },
      });
      await expectStatus(fetched, 200);
      assert.equal(fetched.headers.get('content-type'), 'image/png');
      const bytes = Buffer.from(await fetched.arrayBuffer());
      assert.ok(bytes.equals(PNG), 'the bytes must come back unchanged');
    });

    test('the declared content type is ignored; the bytes decide', async () => {
      // A browser will send image/png for anything, and a file stored under a
      // type it does not have is a file that will be served under that type.
      const session = await setup();
      const res = await fetch(`${base}/api/pages/${session.pageId}/files`, {
        method: 'POST',
        headers: { cookie: session.cookie, 'content-type': 'image/png' },
        body: new Uint8Array(Buffer.from('<html><script>alert(1)</script></html>')),
      });
      assert.equal(res.status, 415);
      assert.deepEqual(await res.json(), { error: 'unsupported_file_type' });
    });

    test('a file larger than the limit is refused', async () => {
      const session = await setup();
      const large = Buffer.concat([PNG, Buffer.alloc(2048, 9)]);
      const res = await upload(session.cookie, session.pageId, large);
      assert.equal(res.status, 413);
    });

    test('an empty upload is refused', async () => {
      const session = await setup();
      const res = await upload(session.cookie, session.pageId, Buffer.alloc(0));
      assert.equal(res.status, 422);
    });

    test('identical bytes are stored once', async () => {
      // Content-addressed storage: the same screenshot pasted into five pages is
      // one file on disk.
      const session = await setup();
      const first = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );
      const second = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      assert.notEqual(first.id, second.id, 'two attachments');
      const rows = await db.query<{ storage_key: string }>(
        `SELECT DISTINCT storage_key FROM files`,
      );
      assert.equal(rows.rowCount, 1, 'one set of bytes');
    });

    // --- authorisation -----------------------------------------------------

    test('an anonymous caller cannot upload', async () => {
      const session = await setup();
      const res = await fetch(`${base}/api/pages/${session.pageId}/files`, {
        method: 'POST',
        body: new Uint8Array(PNG),
      });
      assert.equal(res.status, 401);
    });

    test('an anonymous caller cannot fetch', async () => {
      const session = await setup();
      const body = await expectJson<{ url: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );
      const res = await fetch(`${base}${body.url}`);
      assert.equal(res.status, 401);
    });

    test('a viewer cannot upload', async () => {
      const session = await setup();
      const hash = await hashPassword(PASSWORD);
      const guest = await db.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash, is_guest)
         VALUES ('v@example.org','V',$1,true) RETURNING id`,
        [hash],
      );
      await db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'guest')`,
        [session.workspaceId, guest.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO page_permissions (page_id, user_id, role, include_subtree, granted_by)
         VALUES ($1,$2,'viewer',false,$3)`,
        [session.pageId, guest.rows[0]!.id, session.userId],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'v@example.org', password: PASSWORD }),
      );

      const res = await upload(cookieFrom(login), session.pageId, PNG);
      assert.equal(res.status, 403);
    });

    test('a file in another workspace is not fetchable, and looks absent', async () => {
      const session = await setup();
      const body = await expectJson<{ url: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const hash = await hashPassword(PASSWORD);
      await db.query(
        `INSERT INTO users (email, display_name, password_hash)
         VALUES ('out@example.org','Out',$1)`,
        [hash],
      );
      const login = await fetch(
        `${base}/api/auth/login`,
        json({ email: 'out@example.org', password: PASSWORD }),
      );

      const res = await fetch(`${base}${body.url}`, {
        headers: { cookie: cookieFrom(login) },
      });
      // 404 rather than 403: the difference would confirm a file exists in a
      // workspace the caller cannot see.
      assert.equal(res.status, 404);
    });

    // --- serving headers ---------------------------------------------------

    test('an image is served inline, a PDF as an attachment', async () => {
      // A PDF viewer is a large attack surface pointed at user-supplied bytes,
      // so it is downloaded rather than rendered in place.
      const session = await setup();

      const image = await expectJson<{ url: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );
      const pdf = await expectJson<{ url: string }>(
        await upload(session.cookie, session.pageId, PDF, 'doc.pdf'),
        201,
      );

      const imageRes = await fetch(`${base}${image.url}`, {
        headers: { cookie: session.cookie },
      });
      const pdfRes = await fetch(`${base}${pdf.url}`, {
        headers: { cookie: session.cookie },
      });

      assert.match(imageRes.headers.get('content-disposition') ?? '', /^inline/);
      assert.match(pdfRes.headers.get('content-disposition') ?? '', /^attachment/);
    });

    test('the hardening headers are present', async () => {
      const session = await setup();
      const body = await expectJson<{ url: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );
      const res = await fetch(`${base}${body.url}`, {
        headers: { cookie: session.cookie },
      });

      // nosniff stops a browser deciding the type for itself; the sandbox policy
      // means even a file somehow served as a document cannot run script or
      // reach the origin.
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
      // Private, because the URL is authorised per person: a shared cache must
      // not hand one workspace's image to another.
      assert.match(res.headers.get('cache-control') ?? '', /private/);
    });

    test('a filename with a path or quotes cannot break the header', async () => {
      const session = await setup();
      const body = await expectJson<{ filename: string; url: string }>(
        await upload(session.cookie, session.pageId, PNG, '../../etc/pa"sswd.png'),
        201,
      );
      assert.ok(!body.filename.includes('/'), body.filename);
      assert.ok(!body.filename.includes('"'), body.filename);

      const res = await fetch(`${base}${body.url}`, {
        headers: { cookie: session.cookie },
      });
      await expectStatus(res, 200);
    });

    // --- storage -----------------------------------------------------------

    test('an unwritable directory is reported, not discovered later', async () => {
      // The alternative is finding out on somebody's first photo, where it
      // becomes a 500 that says nothing about a directory they could fix in a
      // minute.
      //
      // A regular file as the root, so mkdir fails immediately. Deliberately
      // not an unreachable path: one of those does not fail, it never answers,
      // and the outstanding filesystem request keeps the process alive — which
      // is exactly how the previous version of this test made CI hang for
      // fifteen minutes with every assertion passing.
      const filePath = path.join(storageRoot, 'blocked-root');
      await writeFile(filePath, 'x');

      const problem = await new LocalFileStore(filePath).checkWritable(500);
      assert.ok(problem, 'an unwritable root should be reported');
      assert.match(problem!, /not writable/);
    });

    test('a probe that never answers is reported as such', async () => {
      // A stalled network mount says neither yes nor no. The fake attempt holds
      // no operating-system resource, so this can be tested without leaving
      // something pending that stops the process exiting.
      const store = new LocalFileStore(storageRoot);
      const problem = await store.checkWritable(50, () => new Promise(() => {}));
      assert.match(problem ?? '', /did not respond/);
    });

    test('a writable directory reports no problem', async () => {
      const store = new LocalFileStore(storageRoot);
      assert.equal(await store.checkWritable(), null);
    });

    test('a share visitor can load a file, using only the share cookie', async () => {
      // The bug this covers: images in a shared page returned 401 and failed to
      // load, and the boot handler turned that into "SONE failed to start" —
      // one picture replacing the whole application.
      const session = await setup();
      const uploaded = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const link = await db.query<{ id: string }>(
        `INSERT INTO share_tokens
           (workspace_id, scope_page_id, include_subtree, role, token_hash,
            allow_anonymous, created_by)
         VALUES ($1,$2,true,'viewer',$3,true,$4) RETURNING id`,
        [
          session.workspaceId,
          session.pageId,
          createHash('sha256').update('a-share-token-for-this-test', 'utf8').digest(),
          session.userId,
        ],
      );
      assert.ok(link.rows[0]);

      const res = await fetch(`${base}/api/files/${uploaded.id}`, {
        // No member cookie at all — only the share cookie.
        headers: { cookie: 'sone_share=a-share-token-for-this-test' },
      });
      await expectStatus(res, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
    });

    test('a file is refused without any credential', async () => {
      // The share cookie is a credential, not a bypass.
      const session = await setup();
      const uploaded = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );
      const res = await fetch(`${base}/api/files/${uploaded.id}`);
      assert.equal(res.status, 401);
    });

    test('a storage failure is a named error, not a bare 500', async () => {
      // "Something went wrong" is true and useless. A deployment problem has to
      // name itself.
      const session = await setup();
      const failing = new Router();
      registerAuthRoutes(failing, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
      });
      // A root that is a regular file, so mkdir fails immediately with
      // ENOTDIR. Deliberately not an unreachable path: one of those does not
      // fail, it *hangs*, and a hanging store hangs the request — the browser
      // spins instead of being told anything. The startup probe reports an
      // unresponsive directory for exactly that reason.
      const filePath = path.join(storageRoot, 'not-a-directory');
      await writeFile(filePath, 'x');

      registerFileRoutes(failing, {
        pool: db,
        store: new LocalFileStore(filePath),
        maxUploadBytes: 1024,
      });

      const broken = createServer((req, res) => {
        void failing.handle(req, res, 'http://localhost').then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
          }
        });
      });
      await new Promise<void>((resolve) => broken.listen(0, '127.0.0.1', resolve));
      const address = broken.address();
      const brokenBase =
        typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';

      try {
        const res = await fetch(`${brokenBase}/api/pages/${session.pageId}/files`, {
          method: 'POST',
          headers: { cookie: session.cookie, 'content-type': 'application/octet-stream' },
          body: new Uint8Array(PNG),
        });
        assert.equal(res.status, 500);
        const body = (await res.json()) as { error: string; detail?: string };
        assert.equal(body.error, 'storage_unavailable');
        // The owner of a fresh instance is its administrator, so the reason is
        // included — a path and an errno, which is what somebody fixing a
        // deployment needs and what previously reached only the container log.
        assert.match(body.detail ?? '', /ENOTDIR|EEXIST|not a directory/i);
      } finally {
        await new Promise<void>((resolve) => broken.close(() => resolve()));
      }
    });

    test('the store refuses a key that could escape its root', async () => {
      const store = new LocalFileStore(storageRoot);
      for (const key of ['../escape', '/etc/passwd', 'ab/../../x', 'not-a-key']) {
        await assert.rejects(
          () => store.get(key),
          /unsafe storage key|not found/,
          `${key} must not resolve`,
        );
      }
    });

    test('a missing file on disk is a server error, not a 404', async () => {
      // The row exists and the bytes do not, which means storage was restored
      // without its files. Saying "not found" would suggest the reference is
      // wrong when the deployment is.
      const session = await setup();
      const body = await expectJson<{ id: string; url: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );
      await db.query(`UPDATE files SET storage_key = $2 WHERE id = $1`, [
        body.id,
        'ff/' + 'f'.repeat(62) + '.png',
      ]);

      const res = await fetch(`${base}${body.url}`, {
        headers: { cookie: session.cookie },
      });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'file_missing_from_storage' });
    });
  },
);
