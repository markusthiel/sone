/**
 * Signing in through an identity provider, end to end (ADR-0024, ADR-0082).
 *
 * This file said that already, and it was not true. It made four `INSERT`
 * statements and asserted what Postgres does with them; it did not import
 * `oidcRoutes.ts`, and neither did anything else in the repository. So the
 * callback, the state comparison, the account linking and the session issue —
 * every decision this application makes about who somebody is — had never been
 * executed by a test.
 *
 * The cryptography around them is genuinely well covered: `oidcToken.test.ts`
 * builds real RSA-signed tokens and breaks them one property at a time, and
 * `oidcFlow.test.ts` drives discovery, PKCE and the exchange against a fake
 * provider. What was missing is the join between them: nothing signed a real
 * token *and* delivered it through a route, which is where the one line that
 * prevents account takeover lives.
 *
 * So: a provider that issues real tokens, and the routes, and a database.
 */

import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';

import { registerOidcRoutes } from '../src/auth/oidcRoutes.js';
import { createSession } from '../src/auth/session.js';
import { Router } from '../src/http/router.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase } from './support/db.js';

const SECRET = 'a-test-instance-secret-key-of-sufficient-length';
const CLIENT = 'sone';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'k1', alg: 'RS256' };

const b64 = (value: object | Buffer): string =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8')).toString(
    'base64url',
  );

function idToken(claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', kid: 'k1', typ: 'JWT' };
  const body = `${b64(header)}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256').update(body).sign(privateKey).toString('base64url');
  return `${body}.${signature}`;
}

let db: Pool;
let provider: Server;
let issuer: string;
let app: Server;
let base: string;
/** What the fake provider will put in the next id token. */
let nextClaims: Record<string, unknown> = {};

before(async () => {
  if (!hasDatabase) return;
  db = await getTestPool();
  await resetDatabase(db);

  // --- the provider --------------------------------------------------------
  provider = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
      return;
    }
    if (url.pathname === '/jwks') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname === '/token') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id_token: idToken(nextClaims) }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  // localhost, because `discover` requires https everywhere else — deliberately.
  issuer = `http://localhost:${(provider.address() as AddressInfo).port}`;

  await db.query(
    `INSERT INTO oidc_settings (issuer, client_id, button_label, allow_signup, enabled)
     VALUES ($1, $2, 'Anmelden', true, true)`,
    [issuer, CLIENT],
  );

  // --- the application -----------------------------------------------------
  app = createHttpServer();
  const router = new Router();
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

  registerOidcRoutes(router, {
    pool: db,
    clientSecret: 'the-client-secret',
    publicUrl: base,
    secureCookies: false,
    secretKey: SECRET,
  });
  app.on('request', (req, res) => {
    void router.handle(req, res, base).then((took) => {
      if (!took) {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
});

after(async () => {
  if (!hasDatabase) return;
  await new Promise<void>((resolve) => app.close(() => resolve()));
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await closeTestPool();
});

/**
 * Begin a sign-in; returns the pending cookie and the state inside it.
 *
 * With `session`, it begins a **link** instead: the same trip to the provider,
 * with the account it is for sealed into the blob (ADR-0084).
 */
async function start(session?: string): Promise<{ cookie: string; state: string; nonce: string }> {
  const res = await fetch(
    `${base}/api/auth/oidc/start${session ? '?link=1' : ''}`,
    { redirect: 'manual', ...(session ? { headers: { cookie: session } } : {}) },
  );
  assert.equal(res.status, 302, 'the browser is sent to the provider');

  const setCookie = res.headers.getSetCookie().find((one) => one.startsWith('sone_oidc='));
  assert.ok(setCookie, 'a pending cookie was set');

  const value = decodeURIComponent(setCookie.slice('sone_oidc='.length).split(';')[0] ?? '');
  // Signed, so the payload is base64url before the dot. A browser cannot forge
  // this; a test can read it, which is the point of splitting the two.
  const payload = JSON.parse(
    Buffer.from(value.split('.')[0] ?? '', 'base64url').toString('utf8'),
  ) as { state: string; nonce: string };

  return { cookie: `sone_oidc=${encodeURIComponent(value)}`, ...payload };
}

const callback = (cookie: string, state: string): Promise<Response> =>
  fetch(`${base}/api/auth/oidc/callback?code=abc&state=${encodeURIComponent(state)}`, {
    headers: { cookie },
    redirect: 'manual',
  });

/** An account with a password, and a session cookie for it. */
async function withAccount(email: string): Promise<{ userId: string; cookie: string }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, 'Eingeladen', 'x') RETURNING id::text AS id`,
    [email],
  );
  const userId = rows[0]!.id;
  const session = await createSession(db, userId);
  return { userId, cookie: `sone_session=${session.token}` };
}

const claimsFor = (sub: string, nonce: string, email: string) => ({
  iss: issuer,
  aud: CLIENT,
  sub,
  nonce,
  email,
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 300,
  iat: Math.floor(Date.now() / 1000),
});

describe('single sign-on (routes)', { concurrency: 1, skip: !hasDatabase }, () => {
  /** Extra servers a test stood up, closed together at the end. */
  const extra: Server[] = [];
  test('a good token makes an account and a session', async () => {
    const { cookie, state, nonce } = await start();
    nextClaims = {
      iss: issuer,
      aud: CLIENT,
      sub: 'provider-subject-1',
      nonce,
      email: 'neu@example.org',
      email_verified: true,
      name: 'Neu Hier',
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
    };

    const res = await callback(cookie, state);
    assert.equal(res.status, 302, 'and back into the application');

    const cookies = res.headers.getSetCookie();
    assert.ok(
      cookies.some((one) => one.startsWith('sone_session=') && !one.includes('Max-Age=0')),
      'a session cookie',
    );
    /*
     * And the pending cookie is gone (ADR-0082).
     *
     * `clearPending` and `setSessionCookie` both used `setHeader`, which
     * replaces — so on the one path that matters the clearing cookie was
     * discarded and the pending blob stayed in the browser for its full ten
     * minutes. The comment above `clearPending` said "cleared whatever happens
     * next"; it was true only where the sign-in failed.
     */
    assert.ok(
      cookies.some((one) => one.startsWith('sone_oidc=') && one.includes('Max-Age=0')),
      'the pending cookie is cleared on success too',
    );

    const account = await db.query<{ id: string }>(
      `SELECT u.id FROM users u
         JOIN oidc_identities i ON i.user_id = u.id
        WHERE i.subject = 'provider-subject-1'`,
    );
    assert.equal(account.rowCount, 1, 'the account exists and is linked');
  });

  test('a state that does not match is refused', async () => {
    const { cookie } = await start();
    const res = await callback(cookie, 'not-the-state-we-sent');
    assert.equal(res.status, 400);
  });

  test('a planted pending cookie is not accepted', async () => {
    /*
     * The reason the cookie is signed (ADR-0082).
     *
     * The state check only proves the provider's answer matches *whatever
     * pending blob the browser is carrying*, and the blob was plain JSON.
     * Anybody able to write a cookie for this host — a sibling subdomain, or
     * plain HTTP where secure cookies are off — could plant their own state,
     * nonce and verifier and complete a sign-in into their own account in
     * somebody else's browser.
     */
    const planted = Buffer.from(
      JSON.stringify({ state: 'mine', nonce: 'mine', verifier: 'mine' }),
      'utf8',
    ).toString('base64url');

    for (const cookie of [
      `sone_oidc=${encodeURIComponent(`${planted}.notasignature`)}`,
      // And unsigned, in the shape it used to have.
      `sone_oidc=${encodeURIComponent(JSON.stringify({ state: 'mine', nonce: 'm', verifier: 'v' }))}`,
    ]) {
      const res = await callback(cookie, 'mine');
      assert.equal(res.status, 400, 'no pending sign-in this instance began');
    }
  });

  test('an unverified address does not become an account', async () => {
    // The provider knows who they are; it has not established that the address
    // is theirs, and the address is what a later link would match on.
    const { cookie, state, nonce } = await start();
    nextClaims = {
      iss: issuer,
      aud: CLIENT,
      sub: 'provider-subject-2',
      nonce,
      email: 'ungeprueft@example.org',
      email_verified: false,
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
    };

    const res = await callback(cookie, state);
    assert.equal(res.status, 403);

    const none = await db.query(`SELECT 1 FROM oidc_identities WHERE subject = $1`, [
      'provider-subject-2',
    ]);
    assert.equal(none.rowCount, 0);
  });

  test('an address that already belongs to a local account cannot be taken over', async () => {
    /*
     * The single line that prevents account takeover, executed for the first
     * time. Matching is on (issuer, subject) and never on email; the insert
     * carries ON CONFLICT (email) DO NOTHING, and a colliding local address
     * returns no row, so the sign-in is refused rather than linked.
     *
     * It is load-bearing on a schema detail — the unique constraint on
     * `users.email` — so this asserts the outcome rather than the mechanism.
     */
    await db.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ('schon-da@example.org', 'Schon da', 'x')`,
    );

    const { cookie, state, nonce } = await start();
    nextClaims = {
      iss: issuer,
      aud: CLIENT,
      sub: 'provider-subject-3',
      nonce,
      email: 'schon-da@example.org',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
    };

    const res = await callback(cookie, state);
    assert.equal(res.status, 403, 'refused rather than linked');

    const linked = await db.query(`SELECT 1 FROM oidc_identities WHERE subject = $1`, [
      'provider-subject-3',
    ]);
    assert.equal(linked.rowCount, 0, 'and no identity was attached to the local account');
  });

  test('signing in twice reuses the account rather than making a second', async () => {
    const { cookie, state, nonce } = await start();
    nextClaims = {
      iss: issuer,
      aud: CLIENT,
      sub: 'provider-subject-1',
      nonce,
      email: 'neu@example.org',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
    };

    assert.equal((await callback(cookie, state)).status, 302);

    const rows = await db.query(`SELECT 1 FROM oidc_identities WHERE subject = $1`, [
      'provider-subject-1',
    ]);
    assert.equal(rows.rowCount, 1, 'still one identity');
  });

  test('a token from another provider is refused', async () => {
    // Real, correctly signed, and about somebody else's instance.
    const { cookie, state, nonce } = await start();
    nextClaims = {
      iss: 'https://somewhere.else.example',
      aud: CLIENT,
      sub: 'provider-subject-4',
      nonce,
      email: 'fremd@example.org',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
    };

    assert.equal((await callback(cookie, state)).status, 401);
  });

  test('somebody invited first can connect a provider afterwards', async () => {
    /*
     * The ordinary path, and the one that did not exist (ADR-0084).
     *
     * Being invited, setting a password, and *then* wanting the company's
     * provider is how almost everybody arrives. The only INSERT INTO
     * oidc_identities in the codebase was reachable through fresh-account
     * creation, so everybody who already had an account was shut out — while
     * ADR-0024 and the deployment guide described this as a thing you could do.
     */
    const anna = await withAccount('anna-link@example.org');

    const { cookie, state, nonce } = await start(anna.cookie);
    nextClaims = claimsFor('link-subject-1', nonce, 'anna-link@example.org');

    const res = await callback(`${cookie}; ${anna.cookie}`, state);
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') ?? '', /settings\/sign-in/);

    const linked = await db.query<{ user_id: string }>(
      `SELECT user_id::text AS user_id FROM oidc_identities WHERE subject = $1`,
      ['link-subject-1'],
    );
    assert.equal(linked.rows[0]?.user_id, anna.userId, 'attached to the account they had');

    // And the account keeps its password: connecting adds a way in, it does
    // not replace one.
    const still = await db.query<{ has: boolean }>(
      `SELECT password_hash IS NOT NULL AS has FROM users WHERE id = $1`,
      [anna.userId],
    );
    assert.equal(still.rows[0]?.has, true);
  });

  test('a link finished in somebody else´s browser is refused', async () => {
    /*
     * The blob says whose attempt this is; the cookie says who is holding the
     * browser. Both have to agree, or completing a link somewhere else would
     * attach your provider identity to their account — and then your provider
     * is a door into it.
     */
    const anna = await withAccount('anna-two@example.org');
    const bert = await withAccount('bert@example.org');

    const { cookie, state, nonce } = await start(anna.cookie);
    nextClaims = claimsFor('link-subject-2', nonce, 'anna-two@example.org');

    const res = await callback(`${cookie}; ${bert.cookie}`, state);
    assert.equal(res.status, 403);

    const none = await db.query(`SELECT 1 FROM oidc_identities WHERE subject = $1`, [
      'link-subject-2',
    ]);
    assert.equal(none.rowCount, 0);
  });

  test('a provider identity already used here cannot be linked again', async () => {
    // Refused rather than moved: an identity pointing at two accounts is a
    // question with no good answer at sign-in time.
    const clara = await withAccount('clara@example.org');
    const { cookie, state, nonce } = await start(clara.cookie);
    // 'provider-subject-1' belongs to the account made by the first test.
    nextClaims = claimsFor('provider-subject-1', nonce, 'neu@example.org');

    const res = await callback(`${cookie}; ${clara.cookie}`, state);
    assert.equal(res.status, 409);
  });

  test('linking without a session is a sign-in, not a link', async () => {
    // `?link=1` with no session is refused rather than quietly downgraded: the
    // two do different things, and guessing which was meant is how somebody
    // ends up with an account they did not want.
    const res = await fetch(`${base}/api/auth/oidc/start?link=1`, { redirect: 'manual' });
    assert.equal(res.status, 401);
  });

  test('a connected account can disconnect, and one with no password cannot', async () => {
    const dora = await withAccount('dora@example.org');
    const { cookie, state, nonce } = await start(dora.cookie);
    nextClaims = claimsFor('link-subject-3', nonce, 'dora@example.org');
    await callback(`${cookie}; ${dora.cookie}`, state);

    const shown = await (
      await fetch(`${base}/api/auth/oidc/link`, { headers: { cookie: dora.cookie } })
    ).json();
    assert.equal((shown as { linked: unknown }).linked !== null, true);
    assert.equal((shown as { canUnlink: boolean }).canUnlink, true);

    const off = await fetch(`${base}/api/auth/oidc/link`, {
      method: 'DELETE',
      headers: { cookie: dora.cookie },
    });
    assert.equal(off.status, 200);

    /*
     * And the door cannot be closed from the inside with nobody outside it.
     *
     * An account created *by* the provider has no password, so disconnecting
     * would leave no way in at all.
     */
    await db.query(`UPDATE users SET password_hash = NULL WHERE id = $1`, [dora.userId]);
    const relink = await start(dora.cookie);
    nextClaims = claimsFor('link-subject-3', relink.nonce, 'dora@example.org');
    await callback(`${relink.cookie}; ${dora.cookie}`, relink.state);

    const refused = await fetch(`${base}/api/auth/oidc/link`, {
      method: 'DELETE',
      headers: { cookie: dora.cookie },
    });
    assert.equal(refused.status, 409);
  });
  // --- three states that answered as one (ADR-0108) ------------------------

  /*
   * Reached through the routes rather than the helper, because the helper is
   * not what anybody sees.
   *
   * The interesting state is "enabled, and this process has no client secret".
   * It happens when a container restarts without `SONE_OIDC_CLIENT_SECRET`:
   * the settings screen goes on saying *enabled*, the sign-in button
   * disappears, and every diagnostic says *not configured* — about a provider
   * that is configured. Three states, one answer, and only one of them is a
   * fault somebody can fix.
   */
  async function withSecret(secret: string | null): Promise<string> {
    const server = createHttpServer();
    const router = new Router();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const at = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    registerOidcRoutes(router, {
      pool: db,
      clientSecret: secret,
      publicUrl: at,
      secureCookies: false,
      secretKey: SECRET,
    });
    server.on('request', (req, res) => {
      void router.handle(req, res, at).then((took) => {
        if (!took) {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    extra.push(server);
    return at;
  }

  after(async () => {
    for (const server of extra) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('enabled with no client secret is its own answer', async () => {
    const at = await withSecret(null);
    const res = await fetch(`${at}/api/auth/oidc/start`, { redirect: 'manual' });

    assert.equal(res.status, 503, 'configured and unusable is not the same as absent');
    assert.equal(((await res.json()) as { error: string }).error, 'no_client_secret');
  });

  test('and a provider that is switched off is still "not configured"', async () => {
    // Disabled and absent stay one answer on purpose: both mean "there is no
    // sign-in here", and neither is a fault to report.
    await db.query(`UPDATE oidc_settings SET enabled = false`);
    try {
      const at = await withSecret('the-client-secret');
      const res = await fetch(`${at}/api/auth/oidc/start`, { redirect: 'manual' });
      assert.equal(res.status, 404);
      assert.equal(((await res.json()) as { error: string }).error, 'not_configured');
    } finally {
      await db.query(`UPDATE oidc_settings SET enabled = true`);
    }
  });

  test('but the sign-in page is told nothing except yes or no', async () => {
    /*
     * The counterweight. `/config` is read by an anonymous browser, and which
     * kind of not-configured this instance is, is nobody's business until they
     * are signed in — the same argument this route already makes about not
     * naming the issuer publicly.
     */
    const at = await withSecret(null);
    const res = await fetch(`${at}/api/auth/oidc/config`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { enabled: false, buttonLabel: null });
  });
});
