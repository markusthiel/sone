/**
 * Signing this instance to a push service (ADR-0180).
 *
 * > Und jetzt bitte noch echte App-Benachrichtigungen die ich ein und
 * > ausschalten kann im Profil.
 *
 * A push is accepted by a push service only if it is signed with the key the
 * browser subscribed against — which is what stops anybody who learns an
 * endpoint from pushing to it. That is RFC 8292, one JWT, and it is the whole
 * of the cryptography here: **no payload is sent**, so RFC 8291's encryption is
 * not implemented and its keys are never stored.
 *
 * Verified rather than asserted about: the signature is checked back against
 * the public half, because a signature that is merely the right length is a
 * signature that fails at Apple and nowhere else.
 */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

import { audienceOf, authorisation, base64url, generateKeys, isGone } from '../src/push/vapid.js';

const ENDPOINT = 'https://web.push.apple.com/QOc1/abcdef';
const CONTACT = 'https://sone.example';

const fromBase64url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('the public half is the uncompressed point a browser asks for', async () => {
  /*
   * Sixty-five bytes beginning `0x04`. A browser hands this to
   * `pushManager.subscribe` as `applicationServerKey`, and anything else there
   * is refused before a single push is ever sent.
   */
  const keys = await generateKeys();
  const raw = fromBase64url(keys.publicKey);
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 0x04);
});

test('and it is base64url, not base64', () => {
  // `+` and `/` in a header value are a push nobody receives.
  const bytes = new Uint8Array([251, 255, 190, 0]);
  assert.match(base64url(bytes), /^[A-Za-z0-9_-]+$/);
});

test('the audience is the push service, not the endpoint', () => {
  // The origin, which is what the specification asks for — sending the whole
  // endpoint puts the device's address in the claim for no reason.
  assert.equal(audienceOf(ENDPOINT), 'https://web.push.apple.com');
});

test('the header carries a signature the public key verifies', async () => {
  /*
   * The assertion that matters. WebCrypto signs into `r || s`, which is what
   * JWS calls ES256 — a DER-wrapped signature is the ordinary mistake here and
   * is the right length, so only verifying catches it.
   */
  const keys = await generateKeys();
  const header = await authorisation({ endpoint: ENDPOINT, keys, contact: CONTACT });

  const token = /vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(token, 'the header has the shape a push service parses');
  const [signing, signature] = [
    token[1]!.split('.').slice(0, 2).join('.'),
    token[1]!.split('.')[2]!,
  ];

  const publicKey = await webcrypto.subtle.importKey(
    'raw',
    fromBase64url(token[2]!),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    fromBase64url(signature),
    Buffer.from(signing),
  );
  assert.equal(ok, true, 'signed with the key it names');
});

test('the claims are the three that are asked for, and no more', async () => {
  const keys = await generateKeys();
  const header = await authorisation({
    endpoint: ENDPOINT,
    keys,
    contact: CONTACT,
    now: 1_700_000_000_000,
  });
  const claims = JSON.parse(
    fromBase64url(/vapid t=([^.]+)\.([^.]+)\./.exec(header)![2]!).toString(),
  ) as Record<string, unknown>;

  assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'sub']);
  assert.equal(claims['aud'], 'https://web.push.apple.com');
  assert.equal(claims['sub'], CONTACT);
});

test('the contact is the instance, never a person', async () => {
  /*
   * `sub` exists so a push service can get in touch about a misbehaving sender.
   * A person's mail address has no business being sent to Apple over somebody
   * else's comment — and this is a caller's decision, so the test is that the
   * function carries through what it is given rather than reaching for one.
   */
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/push/vapid.ts', import.meta.url), 'utf8'),
  );
  assert.doesNotMatch(source, /email|mailto/i);
});

test('it expires inside the day the specification allows', async () => {
  const keys = await generateKeys();
  const at = 1_700_000_000_000;
  const header = await authorisation({ endpoint: ENDPOINT, keys, contact: CONTACT, now: at });
  const claims = JSON.parse(
    fromBase64url(/vapid t=([^.]+)\.([^.]+)\./.exec(header)![2]!).toString(),
  ) as { exp: number };

  const seconds = claims.exp - Math.floor(at / 1000);
  assert.ok(seconds > 0 && seconds < 24 * 60 * 60, `${seconds}s`);
  // Well inside it, so a clock a little out of step is not a refused push.
  assert.equal(seconds, 12 * 60 * 60);
});

test('two instances do not share a key', async () => {
  const a = await generateKeys();
  const b = await generateKeys();
  assert.notEqual(a.publicKey, b.publicKey);
});

test('only a gone endpoint is gone', () => {
  // 404 and 410 are the two the specification gives for a subscription that no
  // longer exists. A 500 is this afternoon's problem, not the device's, and
  // deleting on one would quietly switch somebody's notifications off.
  assert.equal(isGone(404), true);
  assert.equal(isGone(410), true);
  for (const status of [201, 400, 429, 500, 502, 503]) {
    assert.equal(isGone(status), false, String(status));
  }
});
