/**
 * Asking a provider who somebody is.
 *
 * Discovery and the code exchange, against a provider this test runs — one that
 * answers correctly and can be made to misbehave. A mock that agrees with
 * whatever is asked of it would confirm the shape of the code and nothing about
 * whether it is safe (ADR-0024).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  OidcError,
  authorizationUrl,
  beginSignIn,
  discover,
  exchangeCode,
  fetchKeys,
  statesMatch,
} from '../src/auth/oidcFlow.js';

const ISSUER = 'https://login.example.org';

/** A provider that answers, with whatever overrides a test wants. */
function provider(
  overrides: {
    document?: Record<string, unknown>;
    status?: number;
    token?: Record<string, unknown>;
    tokenStatus?: number;
    onToken?: (body: URLSearchParams) => void;
  } = {},
): typeof globalThis.fetch {
  const document = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/keys`,
    ...overrides.document,
  };

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify(document), {
        status: overrides.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === document.token_endpoint) {
      overrides.onToken?.(new URLSearchParams(String(init?.body ?? '')));
      return new Response(JSON.stringify(overrides.token ?? { id_token: 'a.b.c' }), {
        status: overrides.tokenStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === document.jwks_uri) {
      return new Response(JSON.stringify({ keys: [{ kty: 'RSA', kid: 'k1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
}

test('a well-formed provider is discovered', async () => {
  const discovery = await discover(ISSUER, provider());
  assert.equal(discovery.token_endpoint, `${ISSUER}/token`);
});

test('a provider answering for another issuer is refused', async () => {
  // Either it is misconfigured or it is not the provider, and following it
  // anyway would mean verifying tokens against whatever it nominated.
  await assert.rejects(
    () => discover(ISSUER, provider({ document: { issuer: 'https://evil.example.org' } })),
    (error: OidcError) => error.code === 'issuer_mismatch',
  );
});

test('endpoints away from the issuer are refused', async () => {
  // One bad discovery document would otherwise redirect sign-in wherever it
  // liked, or send the client secret to somebody else.
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    await assert.rejects(
      () => discover(ISSUER, provider({ document: { [key]: 'https://evil.example.org/x' } })),
      (error: OidcError) => error.code === 'bad_discovery_document',
      key,
    );
  }
});

test('a plain-http issuer is refused, except on localhost', async () => {
  await assert.rejects(
    () => discover('http://login.example.org', provider()),
    (error: OidcError) => error.code === 'issuer_not_https',
  );
});

test('a provider that cannot be reached fails as a provider problem', async () => {
  const broken = (async () => {
    throw new Error('network');
  }) as typeof globalThis.fetch;

  await assert.rejects(
    () => discover(ISSUER, broken),
    (error: OidcError) => error.code === 'discovery_failed',
  );
});

test('each sign-in gets its own three secrets', () => {
  // state proves the response belongs to a request this instance made, nonce
  // ties the token to it, the verifier proves the code is redeemed by whoever
  // asked. Three guards, three steps — reusing one would leave two unguarded.
  const first = beginSignIn();
  const second = beginSignIn();

  assert.notEqual(first.state, second.state);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.verifier, second.verifier);
  assert.notEqual(first.state, first.nonce);
  assert.notEqual(first.state, first.verifier);
  assert.ok(first.state.length >= 32);
});

test('the authorization URL asks for a hashed challenge, never the verifier', async () => {
  // `plain` would send the verifier itself, which is the thing PKCE exists to
  // keep off the wire.
  const discovery = await discover(ISSUER, provider());
  const pending = beginSignIn();
  const url = new URL(
    authorizationUrl(discovery, {
      clientId: 'sone',
      redirectUri: 'https://sone.example/callback',
      pending,
    }),
  );

  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(url.searchParams.get('code_challenge'), pending.verifier);
  assert.equal(url.searchParams.get('state'), pending.state);
  assert.equal(url.searchParams.get('nonce'), pending.nonce);
  assert.match(url.searchParams.get('scope') ?? '', /openid/);
  assert.equal(url.origin + url.pathname, `${ISSUER}/authorize`);
});

test('states are compared without leaking how much matched', () => {
  const pending = beginSignIn();
  assert.equal(statesMatch(pending.state, pending.state), true);
  assert.equal(statesMatch(pending.state, `${pending.state}x`), false);
  assert.equal(statesMatch(pending.state, 'x'), false);
});

test('the client secret is sent in the body, not the URL', async () => {
  // A query string is written to access logs and browser history, and this is
  // the credential that proves the application is itself.
  let seen: URLSearchParams | null = null;
  const discovery = await discover(ISSUER, provider());

  await exchangeCode(
    discovery,
    {
      code: 'the-code',
      clientId: 'sone',
      clientSecret: 'shhh',
      redirectUri: 'https://sone.example/callback',
      verifier: 'v',
    },
    provider({ onToken: (body) => (seen = body) }),
  );

  assert.equal((seen as unknown as URLSearchParams).get('client_secret'), 'shhh');
  assert.equal((seen as unknown as URLSearchParams).get('code_verifier'), 'v');
});

test('a token response without an id token is a failure', async () => {
  // Whatever else came back, nobody was authenticated — treating it as an
  // anonymous success is how somebody signs in as nobody.
  const discovery = await discover(ISSUER, provider());
  await assert.rejects(
    () =>
      exchangeCode(
        discovery,
        {
          code: 'c',
          clientId: 'sone',
          clientSecret: 's',
          redirectUri: 'https://sone.example/callback',
          verifier: 'v',
        },
        provider({ token: { access_token: 'only-this' } }),
      ),
    (error: OidcError) => error.code === 'no_id_token',
  );
});

test('a refused exchange fails rather than returning something', async () => {
  const discovery = await discover(ISSUER, provider());
  await assert.rejects(
    () =>
      exchangeCode(
        discovery,
        {
          code: 'c',
          clientId: 'sone',
          clientSecret: 's',
          redirectUri: 'https://sone.example/callback',
          verifier: 'v',
        },
        provider({ tokenStatus: 401 }),
      ),
    (error: OidcError) => error.code === 'token_request_failed',
  );
});

test('the signing keys are read from the document, not guessed', async () => {
  const discovery = await discover(ISSUER, provider());
  const keys = await fetchKeys(discovery, provider());
  assert.equal(keys.length, 1);
});
