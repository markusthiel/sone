/**
 * Router, health and maintenance tests.
 *
 * The router tests are unit tests over a real node:http server — cheap enough
 * that mocking would only reduce confidence. The maintenance tests need a
 * database and skip without one.
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';

import type { Pool } from 'pg';
import * as Y from 'yjs';
import { DOC_KEYS, META_KEYS, PAGE_KEYS, appendBlocks } from '@sone/core';

import { BodyError, MAX_BODY_BYTES, Router } from '../src/http/router.js';
import { checkReadiness, registerHealthRoutes } from '../src/http/health.js';
import { Maintenance, compactBacklog } from '../src/maintenance/job.js';
import { withTransaction } from '../src/db/pool.js';
import { materializeYDoc } from '../src/materialize/materialize.js';
import { appendUpdate } from '../src/doc/docStore.js';
import { createSession } from '../src/auth/session.js';
import { hashPassword } from '../src/auth/password.js';
import { COMPACT_THRESHOLD } from '../src/doc/docStore.js';
import {
  closeTestPool,
  getTestPool,
  hasDatabase,
  resetDatabase,
  seedWorkspace,
  uuid,
  type Fixture,
} from './support/db.js';

// --- router ----------------------------------------------------------------

describe('router', () => {
  let server: Server;
  let base: string;
  const router = new Router();

  before(async () => {
    router.get('/api/thing', (ctx) => ctx.send(200, { ok: true }));
    router.get('/api/thing/:id', (ctx) => ctx.send(200, { id: ctx.params['id'] }));
    router.get('/api/a/:a/b/:b', (ctx) =>
      ctx.send(200, { a: ctx.params['a'], b: ctx.params['b'] }),
    );
    router.post('/api/thing', async (ctx) => {
      const body = await ctx.json<{ name?: string }>();
      ctx.send(201, { name: body.name ?? null });
    });
    router.get('/api/boom', () => {
      throw new Error('internal detail that must not leak');
    });
    router.get('/api/query', (ctx) =>
      ctx.send(200, { q: ctx.url.searchParams.get('q') }),
    );

    server = createServer((req, res) => {
      void router.handle(req, res, 'http://localhost').then((handled) => {
        if (!handled) {
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
  });

  test('matches a static route', async () => {
    const res = await fetch(`${base}/api/thing`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  test('extracts a path parameter', async () => {
    const res = await fetch(`${base}/api/thing/abc-123`);
    assert.deepEqual(await res.json(), { id: 'abc-123' });
  });

  test('extracts multiple path parameters', async () => {
    const res = await fetch(`${base}/api/a/one/b/two`);
    assert.deepEqual(await res.json(), { a: 'one', b: 'two' });
  });

  test('decodes percent-encoded parameters', async () => {
    const res = await fetch(`${base}/api/thing/${encodeURIComponent('a b/c')}`);
    assert.deepEqual(await res.json(), { id: 'a b/c' });
  });

  test('a static segment is not shadowed by a parameter route', async () => {
    // '/api/thing' and '/api/thing/:id' differ in length, so this checks the
    // length guard rather than ordering luck.
    assert.equal((await fetch(`${base}/api/thing`)).status, 200);
    assert.equal((await fetch(`${base}/api/thing/x`)).status, 200);
  });

  test('an unknown path falls through so the caller decides', async () => {
    const res = await fetch(`${base}/api/nothing`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
  });

  test('a known path with the wrong method returns 405, not 404', async () => {
    // A 404 here would send someone hunting for a typo in the path.
    const res = await fetch(`${base}/api/thing/abc`, { method: 'DELETE' });
    assert.equal(res.status, 405);
    assert.deepEqual(await res.json(), { error: 'method_not_allowed' });
  });

  test('parses a JSON body', async () => {
    const res = await fetch(`${base}/api/thing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { name: 'Widget' });
  });

  test('an empty body parses as an empty object', async () => {
    const res = await fetch(`${base}/api/thing`, { method: 'POST' });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { name: null });
  });

  test('a handler exception yields 500 without leaking the message', async () => {
    const res = await fetch(`${base}/api/boom`);
    assert.equal(res.status, 500);
    const body = await res.text();
    assert.deepEqual(JSON.parse(body), { error: 'internal' });
    assert.ok(
      !body.includes('internal detail'),
      'the exception message must not reach the client',
    );
  });

  test('query parameters are available', async () => {
    const res = await fetch(`${base}/api/query?q=hello+world`);
    assert.deepEqual(await res.json(), { q: 'hello world' });
  });

  test('responses are marked no-store', async () => {
    // Several responses depend on credentials; a proxy caching one would serve
    // it to the wrong person.
    const res = await fetch(`${base}/api/thing`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('BodyError is thrown for malformed JSON', async () => {
    const res = await fetch(`${base}/api/thing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    // The handler does not catch it, so the router turns it into a 500. That
    // is acceptable for now and will become a 400 when the REST API adds
    // validation; recorded here so the behaviour is not a surprise.
    assert.equal(res.status, 500);
  });

  test('an oversized declared body is refused', async () => {
    const res = await fetch(`${base}/api/thing`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_BODY_BYTES + 1),
      },
      body: 'x'.repeat(MAX_BODY_BYTES + 1),
    });
    assert.equal(res.status, 500);
  });

  test('BodyError carries a machine-readable code', () => {
    const err = new BodyError('too big', 'body_too_large');
    assert.equal(err.code, 'body_too_large');
    assert.equal(err.name, 'BodyError');
  });
});

// --- health ----------------------------------------------------------------

describe('health (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let server: Server;
  let base: string;

  before(async () => {
    db = await getTestPool();
    const router = new Router();
    registerHealthRoutes(router, {
      pool: db,
      documentSchemaVersion: 1,
      syncProtocolVersion: 1,
    });
    server = createServer((req, res) => {
      void router.handle(req, res, 'http://localhost');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeTestPool();
  });

  test('liveness does not touch the database', async () => {
    // The distinction that keeps Docker from restarting a healthy server
    // because Postgres blipped.
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, 'ok');
  });

  test('readiness reports migrations, collation and contracts', async () => {
    const res = await fetch(`${base}/api/ready`);
    assert.equal(res.status, 200);
    const report = (await res.json()) as Awaited<ReturnType<typeof checkReadiness>>;
    assert.equal(report.ready, true);
    assert.equal(report.checks.database.ok, true);
    assert.equal(report.checks.migrations.ok, true);
    assert.equal(report.checks.collation.ok, true);
    assert.equal(report.checks.collation.value, 'C');
    assert.ok(report.contracts.migration);
  });

  test('readiness reports 503 when the database is unreachable', async () => {
    // Constructed rather than simulated: a readiness check that cannot fail is
    // not a readiness check.
    const { Pool } = await import('pg');
    const broken = new Pool({
      connectionString: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
      connectionTimeoutMillis: 500,
    });
    const report = await checkReadiness({
      pool: broken,
      documentSchemaVersion: 1,
      syncProtocolVersion: 1,
    });
    assert.equal(report.ready, false);
    assert.equal(report.checks.database.ok, false);
    await broken.end().catch(() => {});
  });

  test('version endpoint reports both contract versions', async () => {
    const res = await fetch(`${base}/api/version`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['documentSchema'], 1);
    assert.equal(body['syncProtocol'], 1);
  });
});

// --- maintenance -----------------------------------------------------------

describe('maintenance (database)', { skip: !hasDatabase ? 'SONE_TEST_DATABASE_URL not set' : false }, () => {
  let db: Pool;
  let fx: Fixture;

  before(async () => {
    db = await getTestPool();
  });
  after(async () => {
    await closeTestPool();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    fx = await seedWorkspace(db);
  });

  async function makePage(id: string): Promise<void> {
    const doc = new Y.Doc();
    doc.getMap(DOC_KEYS.meta).set(META_KEYS.schemaVersion, 1);
    const page = doc.getMap(DOC_KEYS.page);
    page.set(PAGE_KEYS.title, 'Page');
    page.set(PAGE_KEYS.idx, 'a0');
    await withTransaction(db, (client) =>
      materializeYDoc(client, id, doc, { throughSeq: 1, workspaceId: fx.workspaceId }),
    );
  }

  test('prunes long-expired sessions but keeps live ones', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('prune@example.org','P',$1) RETURNING id`,
      [hash],
    );
    const userId = user.rows[0]!.id;

    const live = await createSession(db, userId);
    const dead = await createSession(db, userId);
    await db.query(
      `UPDATE sessions SET expires_at = now() - interval '30 days' WHERE id = $1`,
      [dead.sessionId],
    );

    const report = await new Maintenance({ pool: db, log: () => {} }).runOnce();
    assert.equal(report.prunedSessions, 1);
    assert.deepEqual(report.errors, []);

    const remaining = await db.query<{ id: string }>(`SELECT id FROM sessions`);
    assert.deepEqual(
      remaining.rows.map((r) => r.id),
      [live.sessionId],
    );
  });

  test('prunes stale rate-limit rows', async () => {
    await db.query(
      `INSERT INTO auth_attempts (key, succeeded, attempted_at)
       VALUES ('login:old', false, now() - interval '2 days'),
              ('login:new', false, now())`,
    );
    const report = await new Maintenance({ pool: db, log: () => {} }).runOnce();
    assert.equal(report.prunedAttempts, 1);

    const left = await db.query<{ key: string }>(`SELECT key FROM auth_attempts`);
    assert.deepEqual(
      left.rows.map((r) => r.key),
      ['login:new'],
    );
  });

  test('compacts a document whose backlog exceeds the threshold', async () => {
    await makePage(uuid(1));
    const doc = new Y.Doc();
    for (let i = 0; i <= COMPACT_THRESHOLD; i++) {
      const before = Y.encodeStateVector(doc);
      appendBlocks(doc, [{ id: uuid(300 + i), type: 'paragraph', text: `b${i}` }]);
      await appendUpdate(db, uuid(1), Y.encodeStateAsUpdate(doc, before), null);
    }

    const compacted = await compactBacklog(db);
    assert.equal(compacted, 1);

    const snapshot = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_snapshots WHERE doc_id = $1`,
      [uuid(1)],
    );
    assert.equal(snapshot.rows[0]!.n, '1');

    const pending = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM doc_updates WHERE doc_id = $1`,
      [uuid(1)],
    );
    assert.equal(pending.rows[0]!.n, '0');
    doc.destroy();
  });

  test('leaves a small backlog alone', async () => {
    await makePage(uuid(1));
    const doc = new Y.Doc();
    appendBlocks(doc, [{ id: uuid(400), type: 'paragraph', text: 'only' }]);
    await appendUpdate(db, uuid(1), Y.encodeStateAsUpdate(doc), null);

    assert.equal(await compactBacklog(db), 0, 'compaction is not free; do not run it eagerly');
    doc.destroy();
  });

  test('reports stale search rows instead of silently fixing them', async () => {
    // Fixing it here would hide the cause. The operator needs to know a
    // workspace language changed and a rematerialise is due.
    await makePage(uuid(1));
    await db.query(
      `UPDATE workspaces SET search_config = 'german'::regconfig WHERE id = $1`,
      [fx.workspaceId],
    );

    const report = await new Maintenance({ pool: db, log: () => {} }).runOnce();
    assert.equal(report.staleSearchRows, 1);
  });

  test('one failing task does not stop the others', async () => {
    // The whole point of the job is running unattended.
    await db.query(`DROP VIEW stale_search_rows`);
    try {
      const report = await new Maintenance({ pool: db, log: () => {} }).runOnce();
      assert.ok(report.errors.length > 0, 'the failure must be reported');
      assert.ok(
        report.errors.some((e) => e.includes('report anomalies')),
        'and named',
      );
      // Pruning still ran.
      assert.equal(typeof report.prunedSessions, 'number');
      assert.ok(report.durationMs >= 0);
    } finally {
      await db.query(`
        CREATE VIEW stale_search_rows AS
          SELECT ps.page_id, ps.workspace_id, ps.built_with, w.search_config AS expected
            FROM page_search ps
            JOIN workspaces w ON w.id = ps.workspace_id
           WHERE ps.built_with <> w.search_config`);
    }
  });

  test('a second pass is skipped while the first is running', async () => {
    const job = new Maintenance({ pool: db, log: () => {} });
    const [first, second] = await Promise.all([job.runOnce(), job.runOnce()]);
    const skipped = [first, second].filter((r) =>
      r.errors.some((e) => e.includes('skipped')),
    );
    assert.equal(skipped.length, 1, 'exactly one pass must be skipped');
  });
});

// --- static files ----------------------------------------------------------

describe('static file serving', () => {
  let root: string;
  let server: Server;
  let base: string;

  before(async () => {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    root = await mkdtemp(path.join(tmpdir(), 'sone-static-'));
    await writeFile(path.join(root, 'index.html'), '<!doctype html>APP SHELL', 'utf8');
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await writeFile(path.join(root, 'assets', 'index-AbCdEfGh.js'), 'console.log(1)', 'utf8');

    const { createStaticHandler } = await import('../src/http/static.js');
    const handler = await createStaticHandler({ root }, () => {});

    server = createServer((req, res) => {
      void handler(req, res).then((handled) => {
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
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });

  test('serves the app shell at the root', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /APP SHELL/);
  });

  test('a client-side route returns the shell with status 200', async () => {
    // Not 404: the URL is valid (ADR-0016), the server simply does not resolve
    // it. A 404 here would make the browser show an error page for a real page.
    const res = await fetch(`${base}/p/00000000-0000-4000-8000-000000000001/some-slug`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /APP SHELL/);
  });

  test('index.html is never cached', async () => {
    // A cached shell keeps requesting asset hashes that no longer exist after
    // an upgrade — a blank page that only a hard refresh fixes.
    const res = await fetch(`${base}/`);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  });

  test('hashed assets are immutable', async () => {
    const res = await fetch(`${base}/assets/index-AbCdEfGh.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /immutable/);
  });

  test('a conditional request gets 304', async () => {
    const first = await fetch(`${base}/assets/index-AbCdEfGh.js`);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await fetch(`${base}/assets/index-AbCdEfGh.js`, {
      headers: { 'if-none-match': etag },
    });
    assert.equal(second.status, 304);
  });

  test('API paths are not served the shell', async () => {
    // Otherwise a mistyped API path returns HTML, and the client sees a
    // successful request full of nonsense instead of a 404.
    const res = await fetch(`${base}/api/whatever`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
  });

  test('path traversal cannot escape the root', async () => {
    for (const attempt of [
      '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/..%2f..%2fetc%2fpasswd',
    ]) {
      const res = await fetch(`${base}${attempt}`);
      const body = await res.text();
      assert.ok(!body.includes('root:'), `${attempt} must not read /etc/passwd`);
      // Falls through to the shell, which is the correct answer: it is just an
      // unrecognised client route.
      assert.match(body, /APP SHELL/);
    }
  });

  test('a POST is not served a file', async () => {
    const res = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(res.status, 404);
  });

  test('a HEAD request sends headers without a body', async () => {
    const res = await fetch(`${base}/assets/index-AbCdEfGh.js`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });

  test('a missing build degrades to API-only rather than failing', async () => {
    // Running the server without a built client is a legitimate development
    // setup, with Vite serving the frontend on its own port.
    const { createStaticHandler } = await import('../src/http/static.js');
    const handler = await createStaticHandler({ root: '/nonexistent/path' }, () => {});
    assert.equal(handler.available, false);
  });
});
