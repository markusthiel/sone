/**
 * Refusing to serve, visibly.
 *
 * The fence was already right; the failure mode was not. Exiting left nothing
 * answering on the port, so the symptom was a blank page and a container
 * restart-looping, writing an accurate explanation to a log nobody was
 * watching.
 */

import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';

import { serveRefusal } from '../src/http/refusal.js';

let server: Server;
let base: string;

before(async () => {
  server = serveRefusal(0, {
    message: 'this database was last used by SONE 0.1.1-dev.9.g23c9271',
    code: 'downgrade',
    runningVersion: '0.1.1-dev.10.g0d11a0a',
    previousVersion: '0.1.1-dev.9.g23c9271',
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('the browser gets a page rather than nothing', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 503, 'refusing, not pretending to work');
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);

  const body = await res.text();
  // Both versions, as fields — so nobody has to find them in a paragraph.
  assert.match(body, /0\.1\.1-dev\.10\.g0d11a0a/);
  assert.match(body, /0\.1\.1-dev\.9\.g23c9271/);
  // And the way out.
  assert.match(body, /SONE_ALLOW_DOWNGRADE/);
});

test('the page is never cached', async () => {
  // The next start should be able to work; a cached refusal would outlive the
  // problem.
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
});

test('an unknown path gets the page too, not a 404', async () => {
  // A 404 would read as "this address is wrong" rather than "the server cannot
  // start".
  const res = await fetch(`${base}/some/deep/route`);
  assert.equal(res.status, 503);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
});

test('health reports unhealthy so a container notices', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string; code: string };
  assert.equal(body.error, 'version_fence');
  assert.equal(body.code, 'downgrade');
});

test('the API answers JSON, not HTML', async () => {
  // A client that was already open retries against /api and must get something
  // it can parse rather than a page.
  const res = await fetch(`${base}/api/workspaces`);
  assert.equal(res.status, 503);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = (await res.json()) as { runningVersion: string };
  assert.equal(body.runningVersion, '0.1.1-dev.10.g0d11a0a');
});

test('version strings are escaped into the page', async () => {
  // They come from the database, so they are not trusted input.
  const hostile = serveRefusal(0, {
    message: 'x',
    code: 'downgrade',
    runningVersion: '<script>alert(1)</script>',
    previousVersion: null,
  });
  await new Promise<void>((resolve) => hostile.once('listening', resolve));
  const address = hostile.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const body = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.ok(!body.includes('<script>alert(1)</script>'), 'not injected');
  assert.match(body, /&lt;script&gt;/);

  await new Promise<void>((resolve) => hostile.close(() => resolve()));
});
