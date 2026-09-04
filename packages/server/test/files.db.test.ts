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
import {
  LocalFileStore,
  categoryOf,
  detectType,
  isInlineImage,
  isInlineViewable,
  isPlayableVideo,
} from '../src/files/store.js';
import { contentDisposition, parseRange } from '../src/files/routes.js';
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
      registerAuthRoutes(router, {
        pool: db,
        signupMode: () => Promise.resolve('open' as const),
        secureCookies: false,
        // No relay in these suites: the reset is absent, which is the
        // ordinary case for an instance without mail (ADR-0059).
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        // No requirement in these suites (ADR-0065).
        secondFactorStanding: () => Promise.resolve({ kind: 'fine' as const }),
      });
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

    // --- byte ranges (ADR-0037) --------------------------------------------

    test('a download says it accepts ranges', async () => {
      // A client asks for a range because the first answer said it could. Video
      // depends on it: a browser seeks by asking, and Safari will not play a
      // <video> at all unless ranges are advertised.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const res = await fetch(`${base}/api/files/${created.id}`, {
        headers: { cookie: session.cookie },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('accept-ranges'), 'bytes');
      assert.equal(res.headers.get('content-length'), String(PNG.length));
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG, 'the whole file');
    });

    test('a range comes back as 206, with only those bytes', async () => {
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const res = await fetch(`${base}/api/files/${created.id}`, {
        headers: { cookie: session.cookie, range: 'bytes=2-5' },
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), `bytes 2-5/${PNG.length}`);
      assert.equal(res.headers.get('content-length'), '4');
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG.subarray(2, 6));
    });

    test('an open-ended range runs to the last byte', async () => {
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const res = await fetch(`${base}/api/files/${created.id}`, {
        headers: { cookie: session.cookie, range: 'bytes=4-' },
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-range'), `bytes 4-${PNG.length - 1}/${PNG.length}`);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG.subarray(4));
    });

    test('a range past the end is 416 and says how big the file is', async () => {
      // Not 200 with the whole file: a client asking for byte 900 of a 100-byte
      // file has the wrong idea about the size, and answering it hides that.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const res = await fetch(`${base}/api/files/${created.id}`, {
        headers: { cookie: session.cookie, range: 'bytes=99999-' },
      });
      assert.equal(res.status, 416);
      assert.equal(res.headers.get('content-range'), `bytes */${PNG.length}`);
    });

    test('a range still answers to the page permissions', async () => {
      // The check must not be somewhere a `Range` header can skip.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PNG),
        201,
      );

      const res = await fetch(`${base}/api/files/${created.id}`, {
        headers: { range: 'bytes=0-1' },
      });
      assert.equal(res.status, 401);
    });

    test('the security headers are on a partial response too', async () => {
      // Every one of them is load-bearing and documented as such; a 206 that
      // dropped them would be the interesting way in.
      const session = await setup();
      const created = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PDF, 'notes.pdf'),
        201,
      );

      const res = await fetch(`${base}/api/files/${created.id}`, {
        headers: { cookie: session.cookie, range: 'bytes=0-3' },
      });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
      assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
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
      assert.equal(detectType(Buffer.alloc(0)), null);
      assert.equal(detectType(Buffer.from([0x01, 0x00, 0x02, 0x00])), null);
    });

    test('text that looks like markup is stored as text, never as html', () => {
      // Text files are storable now, and this is the case that makes that safe.
      // detectType never produces text/html: anything textual becomes
      // text/plain, and `nosniff` stops the browser deciding otherwise. A file
      // full of <script> is served as plain text, which is what it is.
      const detected = detectType(Buffer.from('<html><script>alert(1)</script>'));
      assert.equal(detected?.mime, 'text/plain');
      assert.notEqual(detected?.mime, 'text/html');
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

      // Text is storable now, so this content is accepted — and the point of
      // the test survives intact: it is stored as what it is, not as what the
      // upload claimed. Under the declared type it would be served as an image;
      // under its real one it is plain text, which is harmless.
      const body = await expectJson<{ mimeType: string; inline: boolean }>(res, 201);
      assert.equal(body.mimeType, 'text/plain');
      assert.notEqual(body.mimeType, 'image/png');
    });

    test('bytes that are neither a known format nor text are still refused', () => {
      // The other half of the same rule, kept as its own case now that the one
      // above no longer covers it.
      assert.equal(detectType(Buffer.from([0xde, 0xad, 0x00, 0xbe, 0xef])), null);
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

    test('what a browser can draw is served inline; the rest is a download', async () => {
      // This reverses an earlier decision, and the earlier reasoning was not
      // wrong: a PDF viewer is a large attack surface pointed at user-supplied
      // bytes, and downloading was the cautious answer.
      //
      // Reversed deliberately, because a notes tool where a PDF cannot be read
      // in place is a notes tool people keep their PDFs somewhere else. What
      // makes it acceptable is unchanged and asserted below: the response
      // carries `nosniff` and a sandbox CSP, the type comes from the bytes and
      // never from the upload, and the viewer is the browser's own — already
      // sandboxed, already pointed at untrusted bytes all day.
      //
      // A Word file is still a download, for a plainer reason: nothing here can
      // render it.
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
      assert.match(pdfRes.headers.get('content-disposition') ?? '', /^inline/);

      // And the hardening that makes it acceptable travels with it.
      assert.equal(pdfRes.headers.get('x-content-type-options'), 'nosniff');

      // A PDF carries no sandbox, after two attempts that did.
      //
      // `sandbox` rendered only the first page; `sandbox allow-scripts` made
      // Chromium browsers refuse to render it at all. The built-in viewer is a
      // browser component, not page script, and it does not run inside a
      // sandboxed frame whatever tokens are set — there is no combination to
      // search for.
      //
      // What replaces it is asserted here and above: the type is decided from
      // the bytes, `nosniff` stops the browser reconsidering that, and the
      // document may load nothing at all. Those are what prevent active content
      // in this origin, which is the risk sandbox was there for.
      const pdfPolicy = pdfRes.headers.get('content-security-policy') ?? '';
      assert.match(pdfPolicy, /default-src 'none'/);
      assert.doesNotMatch(pdfPolicy, /sandbox/);
      assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');

      // Everything else keeps the bare policy: nothing else served here needs
      // to run at all.
      assert.match(imageRes.headers.get('content-security-policy') ?? '', /sandbox;/);
      assert.doesNotMatch(
        imageRes.headers.get('content-security-policy') ?? '',
        /allow-scripts/,
      );

      // Something nothing can render is still a download.
      const doc = await expectJson<{ url: string }>(
        await upload(
          session.cookie,
          session.pageId,
          zipWithFirstEntry('word/document.xml'),
          'notes.docx',
        ),
        201,
      );
      const docRes = await fetch(`${base}${doc.url}`, {
        headers: { cookie: session.cookie },
      });
      assert.match(docRes.headers.get('content-disposition') ?? '', /^attachment/);
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

    test('a share visitor can load a PDF, not only an image', async () => {
      // Reported from a shared link: the viewer showed {"error":"internal"}
      // where the document should be. An image in the same page worked, so the
      // difference is in what a PDF takes to serve rather than in the sharing.
      const session = await setup();
      const uploaded = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PDF, 'doc.pdf'),
        201,
      );

      await db.query(
        `INSERT INTO share_tokens
           (workspace_id, scope_page_id, include_subtree, role, token_hash,
            allow_anonymous, created_by)
         VALUES ($1,$2,true,'viewer',$3,true,$4)`,
        [
          session.workspaceId,
          session.pageId,
          createHash('sha256').update('a-pdf-share-token', 'utf8').digest(),
          session.userId,
        ],
      );

      const res = await fetch(`${base}/api/files/${uploaded.id}`, {
        headers: { cookie: 'sone_share=a-pdf-share-token' },
      });
      const body = res.status === 200 ? '' : await res.text();
      assert.equal(res.status, 200, body);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
    });

    test('a file a guest uploaded can be read back, by anyone who may', async () => {
      // Reported exactly this way: a PDF uploaded through a share link showed
      // {"error":"internal"} in the viewer — and not only for the guest. The
      // owner could not read it either, which points at what the upload stored
      // rather than at who was asking.
      const session = await setup();
      await db.query(
        `INSERT INTO share_tokens
           (workspace_id, scope_page_id, include_subtree, role, token_hash,
            allow_anonymous, created_by)
         VALUES ($1,$2,true,'editor',$3,true,$4)`,
        [
          session.workspaceId,
          session.pageId,
          createHash('sha256').update('guest-upload-token', 'utf8').digest(),
          session.userId,
        ],
      );

      const uploaded = await expectJson<{ id: string }>(
        await fetch(
          `${base}/api/pages/${session.pageId}/files?filename=guest.pdf`,
          {
            method: 'POST',
            headers: { cookie: 'sone_share=guest-upload-token' },
            body: new Uint8Array(PDF),
          },
        ),
        201,
      );

      // What the row looks like matters more than the response did.
      const row = await db.query<{ uploaded_by: string | null; storage_key: string }>(
        `SELECT uploaded_by, storage_key FROM files WHERE id = $1`,
        [uploaded.id],
      );
      assert.ok(row.rows[0], 'the row exists');

      const asOwner = await fetch(`${base}/api/files/${uploaded.id}`, {
        headers: { cookie: session.cookie },
      });
      const body = asOwner.status === 200 ? '' : await asOwner.text();
      assert.equal(asOwner.status, 200, body);
      assert.equal(asOwner.headers.get('content-type'), 'application/pdf');
    });

    test('serving a several-megabyte file works', async () => {
      // Measured rather than reasoned about: a 200 KB PDF displays and a 3.2 MB
      // one does not, and nothing else about the two differs. If size matters,
      // it has to show here.
      //
      // Written through the store rather than uploaded, because this harness
      // caps uploads at 1 KB — the point under test is serving, not the limit.
      const session = await setup();
      const large = Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024, 0x20)]);

      const store = new LocalFileStore(storageRoot);
      const stored = await store.put(large, 'pdf');

      const row = await db.query<{ id: string }>(
        `INSERT INTO files
           (workspace_id, page_id, filename, mime_type, size_bytes, storage_key,
            sha256, uploaded_by)
         VALUES ($1,$2,'big.pdf','application/pdf',$3,$4,$5,$6) RETURNING id`,
        [
          session.workspaceId,
          session.pageId,
          large.length,
          stored.key,
          createHash('sha256').update(large).digest(),
          session.userId,
        ],
      );

      const res = await fetch(`${base}/api/files/${row.rows[0]!.id}`, {
        headers: { cookie: session.cookie },
      });
      const body = res.status === 200 ? '' : await res.text();
      assert.equal(res.status, 200, body);

      const returned = Buffer.from(await res.arrayBuffer());
      assert.equal(returned.length, large.length, 'returned whole');
    });

    test('a filename with an umlaut can be served', async () => {
      // The actual bug, and it looked like a size problem for three rounds: a
      // 3.2 MB file failed and a 200 KB one worked, but what really differed
      // was that one was called "Eine App für alles.pdf".
      //
      // Node refuses to write a non-ASCII header and throws; the router turned
      // that into a 500, and the viewer showed {"error":"internal"} where the
      // document should have been. Every file with an umlaut, an accent or a
      // CJK character in its name was unreachable.
      const session = await setup();
      const uploaded = await expectJson<{ id: string }>(
        await upload(session.cookie, session.pageId, PDF, 'Für alles — Mac & i.pdf'),
        201,
      );

      const res = await fetch(`${base}/api/files/${uploaded.id}`, {
        headers: { cookie: session.cookie },
      });
      assert.equal(res.status, 200, res.status === 200 ? '' : await res.text());

      const disposition = res.headers.get('content-disposition') ?? '';
      // Both halves of RFC 6266: something any client understands, and the real
      // name for one that understands more.
      assert.match(disposition, /filename="[\x20-\x7e]*"/);
      assert.match(disposition, /filename\*=UTF-8''/);
      assert.ok(disposition.includes(encodeURIComponent('Für alles — Mac & i.pdf')));
    });

    test('a filename cannot break out of the header', () => {
      // It is chosen by whoever uploaded the file, so it is untrusted input
      // arriving in a header. A quote would end the field early and let the
      // rest be read as another parameter.
      const nasty = contentDisposition(false, 'evil"; filename="other.pdf');
      const plain = nasty.slice(0, nasty.indexOf("filename*"));
      assert.equal((plain.match(/"/g) ?? []).length, 2, 'exactly one quoted value');

      // And a newline cannot inject a second header, which is what Node was
      // refusing to allow in the first place.
      assert.doesNotMatch(contentDisposition(false, 'a\r\nX-Evil: 1.pdf'), /[\r\n]/);
    });

    test('a name that is entirely non-ASCII still has a usable fallback', () => {
      // Otherwise the plain form is empty and some clients save a file with no
      // name at all.
      assert.match(contentDisposition(false, '文档.pdf'), /filename="[^"]+"/);
      assert.ok(!contentDisposition(false, '文档.pdf').includes('filename=""'));
    });

    test('a guest with edit rights can upload', async () => {
      // Reported as "the image shows as text": the upload was refused with 401,
      // and an image block with no URL renders the filename as a label. So it
      // read as a picture turning into words rather than as a refused upload.
      const session = await setup();
      await db.query(
        `INSERT INTO share_tokens
           (workspace_id, scope_page_id, include_subtree, role, token_hash,
            allow_anonymous, created_by)
         VALUES ($1,$2,true,'editor',$3,true,$4)`,
        [
          session.workspaceId,
          session.pageId,
          createHash('sha256').update('an-editing-share-token', 'utf8').digest(),
          session.userId,
        ],
      );

      const res = await fetch(
        `${base}/api/pages/${session.pageId}/files?filename=photo.png`,
        {
          method: 'POST',
          headers: {
            cookie: 'sone_share=an-editing-share-token',
            'content-type': 'application/octet-stream',
          },
          body: PNG,
        },
      );
      const body = await expectJson<{ id: string }>(res, 201);
      assert.ok(body.id, 'and the file is addressable');
    });

    test('a guest with only read rights cannot upload', async () => {
      // The share cookie is a credential, not a promotion.
      const session = await setup();
      await db.query(
        `INSERT INTO share_tokens
           (workspace_id, scope_page_id, include_subtree, role, token_hash,
            allow_anonymous, created_by)
         VALUES ($1,$2,true,'viewer',$3,true,$4)`,
        [
          session.workspaceId,
          session.pageId,
          createHash('sha256').update('a-read-only-share-token', 'utf8').digest(),
          session.userId,
        ],
      );

      const res = await fetch(
        `${base}/api/pages/${session.pageId}/files?filename=photo.png`,
        {
          method: 'POST',
          headers: {
            cookie: 'sone_share=a-read-only-share-token',
            'content-type': 'application/octet-stream',
          },
          body: PNG,
        },
      );
      assert.equal(res.status, 403);
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
        // No relay here (ADR-0059).
        canSendMail: () => Promise.resolve(false),
        sendResetMail: () => Promise.resolve(),
        sendProviderMail: () => Promise.resolve(),
        secretKey: 'a-test-instance-secret-key-of-sufficient-length',
        instanceName: () => Promise.resolve('SONE'),
        // No requirement in these suites (ADR-0065).
        secondFactorStanding: () => Promise.resolve({ kind: 'fine' as const }),
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

// --- documents, not only images ---------------------------------------------

/** A minimal ZIP whose first entry is named, which is what identifies Office. */
function zipWithFirstEntry(name: string, extra = ''): Buffer {
  const filename = Buffer.from(name, 'ascii');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(filename.length, 26);
  return Buffer.concat([header, filename, Buffer.from(extra, 'ascii')]);
}

test('the modern Office formats are told apart by their first entry', () => {
  // They are all ZIP containers, and so are a great many other things. The
  // archive's first entry names the format.
  assert.match(detectType(zipWithFirstEntry('word/document.xml'))?.mime ?? '', /wordprocessingml/);
  assert.match(detectType(zipWithFirstEntry('xl/workbook.xml'))?.mime ?? '', /spreadsheetml/);
  assert.match(detectType(zipWithFirstEntry('ppt/presentation.xml'))?.mime ?? '', /presentationml/);
});

test('a zip that is not an Office document is still stored', () => {
  // An archive is a legitimate attachment. Refusing it would mean the only way
  // to attach one is to rename it, which teaches people to defeat the check.
  assert.equal(detectType(zipWithFirstEntry('notes/readme.txt'))?.mime, 'application/zip');
});

test('OpenDocument is identified by its declared mimetype entry', () => {
  // The specification requires that entry to be first and uncompressed,
  // precisely so the format can be identified this way.
  const odt = zipWithFirstEntry('mimetype', 'application/vnd.oasis.opendocument.text');
  assert.equal(detectType(odt)?.mime, 'application/vnd.oasis.opendocument.text');
});

test('plain text is recognised, and a binary is not called text', () => {
  // "Not a format I recognise" is not the same as "plain text": storing an
  // unknown binary as text/plain would have the browser try to display it.
  assert.equal(detectType(Buffer.from('Notes for Tuesday\n', 'utf8'))?.mime, 'text/plain');
  assert.equal(detectType(Buffer.from([0x01, 0x00, 0x02, 0x00, 0x03])), null);
});

test('an empty file is not text', () => {
  // Nothing to judge by, and calling it text would show an empty viewer rather
  // than saying the upload produced nothing.
  assert.equal(detectType(Buffer.alloc(0)), null);
});

test('what can be shown in place is decided by what a browser can draw', () => {
  // Not by which application made the file. A Word document cannot be rendered
  // without a converter this project does not have, and a card that says what
  // it is beats a viewer that shows an error.
  assert.equal(isInlineViewable('application/pdf'), true);
  assert.equal(isInlineViewable('text/plain'), true);
  assert.equal(isInlineViewable('image/png'), true);
  assert.equal(
    isInlineViewable(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    false,
  );
  assert.equal(isInlineImage('application/pdf'), false, 'a PDF is not an image');
});

test('video is recognised by its container, from a short list of brands', () => {
  // Unrecognised bytes keep being refused, which is what stops this becoming the
  // generic type everything unknown is stored as (ADR-0037).
  const ftyp = (brand: string): Buffer =>
    Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from(brand, 'ascii'),
      Buffer.alloc(16),
    ]);

  assert.equal(detectType(ftyp('isom'))?.mime, 'video/mp4');
  assert.equal(detectType(ftyp('mp42'))?.mime, 'video/mp4');
  assert.equal(detectType(ftyp('M4V '))?.mime, 'video/mp4');
  assert.equal(detectType(ftyp('qt  '))?.mime, 'video/quicktime');
  // The image brands in the same container keep their meaning.
  assert.equal(detectType(ftyp('avif'))?.mime, 'image/avif');
  assert.equal(detectType(ftyp('heic'))?.mime, 'image/heic');
  // And an unknown brand is still refused rather than guessed at.
  assert.equal(detectType(ftyp('zzzz')), null);

  // Matroska and WebM share a container and are told apart by the doctype.
  const ebml = (doctype: string): Buffer =>
    Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(8),
      Buffer.from(doctype, 'ascii'),
      Buffer.alloc(16),
    ]);
  assert.equal(detectType(ebml('webm'))?.mime, 'video/webm');
  assert.equal(detectType(ebml('matroska'))?.mime, 'video/x-matroska');
});

test('a video is served in place, and matroska is not called playable', () => {
  // It must not arrive as an attachment, or the browser offers to save it
  // instead of handing it to the player. Matroska is stored and not promised:
  // the container can hold anything and most browsers refuse it.
  assert.equal(isPlayableVideo('video/mp4'), true);
  assert.equal(isPlayableVideo('video/webm'), true);
  assert.equal(isPlayableVideo('video/quicktime'), true);
  assert.equal(isPlayableVideo('video/x-matroska'), false);
  assert.equal(isInlineViewable('video/mp4'), true);
  assert.equal(isInlineViewable('video/x-matroska'), false);
});

test('categories are coarse on purpose', () => {
  assert.equal(categoryOf('image/png'), 'image');
  // Its own category: a video is watched, which means a player and a duration
  // rather than a name and a size.
  assert.equal(categoryOf('video/mp4'), 'video');
  assert.equal(categoryOf('application/pdf'), 'pdf');
  assert.equal(categoryOf('text/csv'), 'text');
  assert.equal(categoryOf('application/zip'), 'archive');
  assert.equal(
    categoryOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'document',
  );
});

test('the range parser answers three things, not two', () => {
  // No range, one range, and unsatisfiable — and the third must not collapse
  // into the first, or a client with the wrong idea of the size is told nothing.
  assert.equal(parseRange(undefined, 100), null);
  assert.equal(parseRange('bytes=0-1,4-5', 100), null, 'multipart is not answered');
  assert.equal(parseRange('nonsense', 100), null);
  assert.equal(parseRange('bytes=-', 100), null);

  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  // Clamped rather than refused: asking for more than there is is ordinary.
  assert.deepEqual(parseRange('bytes=90-999', 100), { start: 90, end: 99 });
  // A suffix range, and one longer than the file is the whole file.
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });

  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=50-40', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
});
