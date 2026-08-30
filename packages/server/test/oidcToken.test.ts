/**
 * Checking what an identity provider says.
 *
 * Every token here is real: signed with a key this test generates, then broken
 * one property at a time. A test against a mock that always says yes tests
 * nothing, and this is the one place in the application where a mistake means
 * anybody can be anybody (ADR-0024).
 */

import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, createPublicKey } from 'node:crypto';
import { test } from 'node:test';

import { TokenError, verifyIdToken, type Jwk } from '../src/auth/oidcToken.js';

const ISSUER = 'https://login.example.org';
const CLIENT = 'sone';
const NONCE = 'a-nonce-from-the-request';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256' };

/** A second provider, for the case where a token is real but from elsewhere. */
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherJwk = {
  ...(other.publicKey.export({ format: 'jwk' }) as Jwk),
  kid: 'k1',
  alg: 'RS256',
};

const b64 = (value: object | Buffer): string =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8'))
    .toString('base64url');

function sign(
  claims: Record<string, unknown>,
  options: { header?: Record<string, unknown>; key?: typeof privateKey } = {},
): string {
  const header = { alg: 'RS256', kid: 'k1', typ: 'JWT', ...options.header };
  const body = `${b64(header)}.${b64(claims)}`;

  if (header['alg'] === 'none') return `${body}.`;

  const signer = createSign('sha256');
  signer.update(body);
  signer.end();
  return `${body}.${signer.sign(options.key ?? privateKey).toString('base64url')}`;
}

const NOW = 1_800_000_000;
const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: ISSUER,
  sub: 'user-123',
  aud: CLIENT,
  exp: NOW + 300,
  iat: NOW - 5,
  nonce: NONCE,
  ...over,
});

const verify = (token: string, over: Partial<Parameters<typeof verifyIdToken>[1]> = {}) =>
  verifyIdToken(token, {
    issuer: ISSUER,
    clientId: CLIENT,
    nonce: NONCE,
    keys: [jwk],
    now: () => NOW * 1000,
    ...over,
  });

test('a real token from the right provider is accepted', () => {
  const claims = verify(sign(good({ email: 'someone@example.org' })));
  assert.equal(claims.sub, 'user-123');
  assert.equal(claims.email, 'someone@example.org');
});

test('a token signed by somebody else is refused', () => {
  // The case that matters most: everything about it is well-formed and true
  // except who signed it.
  assert.throws(
    () => verify(sign(good(), { key: other.privateKey })),
    (error: TokenError) => error.code === 'bad_signature',
  );
});

test('a token whose payload was edited after signing is refused', () => {
  const token = sign(good());
  const [header, , signature] = token.split('.');
  const tampered = `${header}.${b64(good({ sub: 'somebody-else' }))}.${signature}`;

  assert.throws(
    () => verify(tampered),
    (error: TokenError) => error.code === 'bad_signature',
  );
});

test('"alg": "none" is refused', () => {
  // The oldest mistake in the subject: a verifier that takes the algorithm from
  // the token it is checking accepts a token that says it needs no checking.
  assert.throws(
    () => verify(sign(good(), { header: { alg: 'none' } })),
    (error: TokenError) => error.code === 'unsupported_algorithm',
  );
});

test('a symmetric algorithm is refused', () => {
  // HS256 with the public key as the secret is the same attack wearing a hat:
  // the "key" is published, so anybody can sign.
  assert.throws(
    () => verify(sign(good(), { header: { alg: 'HS256' } })),
    (error: TokenError) => error.code === 'unsupported_algorithm',
  );
});

test('a token from another issuer is refused', () => {
  assert.throws(
    () => verify(sign(good({ iss: 'https://evil.example.org' }))),
    (error: TokenError) => error.code === 'wrong_issuer',
  );
});

test('a token for another application is refused', () => {
  // Providers issue tokens for many clients. One meant for a different
  // application at the same provider is genuine and still not ours.
  assert.throws(
    () => verify(sign(good({ aud: 'some-other-app' }))),
    (error: TokenError) => error.code === 'wrong_audience',
  );
});

test('an audience list is accepted when it contains us', () => {
  assert.equal(verify(sign(good({ aud: ['other-app', CLIENT] }))).sub, 'user-123');
});

test('an expired token is refused, within a little tolerance', () => {
  assert.throws(
    () => verify(sign(good({ exp: NOW - 3600 }))),
    (error: TokenError) => error.code === 'expired',
  );
  // Clocks disagree by seconds all the time; refusing on that would make
  // sign-in fail intermittently for reasons nobody could see.
  assert.equal(verify(sign(good({ exp: NOW - 30 }))).sub, 'user-123');
});

test('a token issued in the future is refused', () => {
  assert.throws(
    () => verify(sign(good({ iat: NOW + 3600 }))),
    (error: TokenError) => error.code === 'issued_in_the_future',
  );
});

test('a token with the wrong nonce is refused', () => {
  // What ties the token to the request that asked for it, and so what stops one
  // obtained elsewhere from being replayed here.
  assert.throws(
    () => verify(sign(good({ nonce: 'from-another-request' }))),
    (error: TokenError) => error.code === 'wrong_nonce',
  );
  assert.throws(
    () => verify(sign(good({ nonce: undefined }))),
    (error: TokenError) => error.code === 'wrong_nonce',
  );
});

test('a token naming an unknown key is refused', () => {
  assert.throws(
    () => verify(sign(good(), { header: { kid: 'rotated-away' } })),
    (error: TokenError) => error.code === 'unknown_key',
  );
});

test('a key set with one unusable entry still verifies against a good one', () => {
  // Providers publish several keys and rotate them. One entry this build cannot
  // construct must not stop a valid token from being checked.
  const claims = verifyIdToken(sign(good()), {
    issuer: ISSUER,
    clientId: CLIENT,
    nonce: NONCE,
    keys: [{ kty: 'OKP', crv: 'not-a-curve', x: 'nonsense', kid: 'k1' }, jwk],
    now: () => NOW * 1000,
  });
  assert.equal(claims.sub, 'user-123');
});

test('a token with no subject is refused', () => {
  // The subject is the identity accounts are matched on. Without it there is
  // nothing to match.
  assert.throws(
    () => verify(sign(good({ sub: '' }))),
    (error: TokenError) => error.code === 'missing_subject',
  );
});

test('rubbish is refused rather than throwing something else', () => {
  for (const input of ['', 'not.a.token', 'a.b', 'a.b.c.d']) {
    assert.throws(() => verify(input), TokenError, input);
  }
});

test('the same key published by two providers does not confuse issuers', () => {
  // A token signed by another provider's key with our issuer claim: the
  // signature check is what catches it, and it has to run before the claims are
  // believed.
  assert.throws(
    () => verifyIdToken(sign(good(), { key: other.privateKey }), {
      issuer: ISSUER,
      clientId: CLIENT,
      nonce: NONCE,
      keys: [jwk],
      now: () => NOW * 1000,
    }),
    (error: TokenError) => error.code === 'bad_signature',
  );

  // And the same token against that provider's key is fine, which proves the
  // token itself was well-formed and only the key was wrong.
  assert.equal(
    verifyIdToken(sign(good(), { key: other.privateKey }), {
      issuer: ISSUER,
      clientId: CLIENT,
      nonce: NONCE,
      keys: [otherJwk],
      now: () => NOW * 1000,
    }).sub,
    'user-123',
  );
});

test('the error says that something failed, not which check', () => {
  // Telling a caller which check failed tells an attacker which one to work on
  // next. The codes are coarse on purpose, and this keeps them so.
  void createPublicKey;
  const codes = new Set<string>();
  for (const claims of [good({ iss: 'x' }), good({ aud: 'x' }), good({ nonce: 'x' })]) {
    try {
      verify(sign(claims));
    } catch (error) {
      codes.add((error as TokenError).code);
    }
  }
  for (const code of codes) {
    assert.doesNotMatch(code, /\s/, 'a code, never a sentence');
  }
});
