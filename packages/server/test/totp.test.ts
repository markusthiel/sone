/**
 * The arithmetic of a second factor (ADR-0063).
 *
 * The first test is against the vectors published in RFC 6238, not against this
 * implementation. An implementation that agrees with its own tests and
 * disagrees with every authenticator app is the failure this feature could
 * have, and only a published vector rules it out.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RECOVERY_COUNT,
  STEP_SECONDS,
  checkCode,
  codeAt,
  fromBase32,
  hashRecoveryCode,
  newRecoveryCodes,
  newSecret,
  openSecret,
  otpauthUri,
  sealSecret,
  toBase32,
} from '../src/auth/totp.js';

const SECRET_KEY = 'an-instance-secret-key-long-enough-to-be-one';

test('the codes match RFC 6238´s published vectors', () => {
  // The RFC's SHA-1 secret is the ASCII digits 1..0 repeated, and its table is
  // 8-digit; a 6-digit code is the last six of the same number.
  const secret = new Uint8Array(Buffer.from('12345678901234567890', 'ascii'));
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ];

  for (const [seconds, eightDigits] of vectors) {
    const step = Math.floor(seconds / STEP_SECONDS);
    assert.equal(codeAt(secret, step), eightDigits.slice(-6), `at T=${seconds}`);
  }
});

test('base32 round-trips, and tolerates what people paste', () => {
  const secret = newSecret();
  assert.deepEqual(fromBase32(toBase32(secret)), secret);

  // Spaces and lowercase, which is how a secret arrives when somebody copies it
  // off a screen.
  const text = toBase32(secret);
  const spaced = (text.match(/.{1,4}/g) ?? []).join(' ').toLowerCase();
  assert.deepEqual(fromBase32(spaced), secret);
});

test('a code is accepted one step either side, and not two', () => {
  // Thirty seconds of tolerance is a wrong clock; five minutes is a longer
  // window for a code somebody read over a shoulder (ADR-0063).
  const secret = newSecret();
  const now = new Date();
  const step = Math.floor(now.getTime() / 1000 / STEP_SECONDS);

  for (const offset of [-1, 0, 1]) {
    const found = checkCode(secret, codeAt(secret, step + offset), now);
    assert.equal(found.ok, true, `offset ${offset}`);
  }
  for (const offset of [-2, 2]) {
    assert.equal(checkCode(secret, codeAt(secret, step + offset), now).ok, false);
  }
});

test('a check says which step it was, so a code cannot be used twice', () => {
  // The caller refuses a step it has already accepted: otherwise somebody
  // reading a code over a shoulder has thirty seconds to use it too.
  const secret = newSecret();
  const now = new Date();
  const step = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  const found = checkCode(secret, codeAt(secret, step), now);
  assert.ok(found.ok);
  assert.equal(found.step, step);
});

test('nonsense is refused rather than thrown at', () => {
  const secret = newSecret();
  for (const junk of ['', 'abcdef', '12345', '1234567', '  ']) {
    assert.equal(checkCode(secret, junk).ok, false, JSON.stringify(junk));
  }
});

test('a sealed secret needs the instance key, and survives nothing else', () => {
  const secret = newSecret();
  const sealed = sealSecret(secret, SECRET_KEY);

  assert.deepEqual(openSecret(sealed, SECRET_KEY), secret);
  // A backup on a laptop without the environment is the case this is for.
  assert.equal(openSecret(sealed, 'a-different-instance-key-entirely'), null);
  // And a tampered blob is null rather than a throw or a wrong secret.
  assert.equal(openSecret(`${sealed}x`, SECRET_KEY), null);
  assert.equal(openSecret('nonsense', SECRET_KEY), null);
  // The plaintext is nowhere in the stored form.
  assert.ok(!sealed.includes(toBase32(secret)));
});

test('recovery codes are ten, hashed, and forgiving about how they are retyped', () => {
  const { codes, hashes } = newRecoveryCodes();
  assert.equal(codes.length, RECOVERY_COUNT);
  assert.equal(new Set(codes).size, RECOVERY_COUNT, 'all different');
  assert.equal(new Set(hashes).size, RECOVERY_COUNT);

  // Stored hashed, like session tokens: a stolen backup contains no working
  // codes (ADR-0010).
  for (const code of codes) assert.ok(!hashes.includes(code));

  // Retyped without the dashes, or in capitals, still matches — a code copied
  // off a screen by hand is copied loosely.
  const first = codes[0]!;
  assert.equal(hashRecoveryCode(first.replace(/-/g, '').toUpperCase()), hashes[0]);
});

test('the URI an app scans names the instance', () => {
  // So somebody with three SONE instances can tell the entries apart: an app
  // listing three identical "SONE" lines is an app somebody guesses in.
  const secret = newSecret();
  const uri = otpauthUri(secret, 'anna@example.org', 'SONE bei Thiel');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /issuer=SONE\+bei\+Thiel/);
  assert.match(uri, new RegExp(`secret=${toBase32(secret)}`));
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
