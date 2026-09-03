/**
 * SONE server — the arithmetic of a second factor (ADR-0063).
 *
 * Three pure pieces, none of which needs a database: computing a code from a
 * secret, keeping that secret encrypted, and making recovery codes.
 *
 * The TOTP part is checked against the test vectors published in RFC 6238
 * rather than against itself. An implementation that agrees with its own tests
 * and disagrees with every authenticator app is the failure this feature could
 * have, and the vectors are the only thing that rules it out.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Seconds per code. Thirty, as every authenticator app assumes. */
export const STEP_SECONDS = 30;

/** Digits in a code. */
export const DIGITS = 6;

/**
 * How far out of step a clock may be.
 *
 * One step either side and no more: thirty seconds of tolerance is a wrong
 * clock, while five minutes is a longer window for a code somebody read over a
 * shoulder (ADR-0063).
 */
export const SKEW_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A secret as an authenticator app wants to read it. */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** And back, ignoring the spaces and padding people paste along with it. */
export function fromBase32(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A new secret. Twenty bytes, which is what RFC 4226 assumes for SHA-1. */
export const newSecret = (): Uint8Array => new Uint8Array(randomBytes(20));

/**
 * The code for one time step.
 *
 * HMAC-SHA1 and dynamic truncation, exactly as RFC 4226 describes it. SHA-1 is
 * not a choice here: it is what authenticator apps implement, and a stronger
 * hash would produce codes nobody's phone agrees with.
 */
export function codeAt(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  // Written as two 32-bit halves because a step number is comfortably inside
  // 2^53 but bitwise operators are not, and `writeUInt32BE` twice is clearer
  // than a BigInt for a value that will never need one.
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = createHmac('sha1', Buffer.from(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const truncated =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Whether a code is right, and which step it was.
 *
 * The step comes back so the caller can refuse to accept it twice: a code that
 * has been used cannot be used again inside its window, or somebody reading it
 * over a shoulder has thirty seconds to use it too (ADR-0063).
 */
export function checkCode(
  secret: Uint8Array,
  code: string,
  now: Date = new Date(),
): { ok: true; step: number } | { ok: false } {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return { ok: false };

  const current = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  for (let offset = -SKEW_STEPS; offset <= SKEW_STEPS; offset += 1) {
    const step = current + offset;
    const expected = codeAt(secret, step);
    // Constant time, though the comparison is of six digits either party
    // already knows the shape of: the habit is cheaper than the exception.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

/**
 * The URI an authenticator app reads out of a QR code.
 *
 * The instance name is the issuer, so somebody with three SONE instances can
 * tell the entries apart — an app that lists three identical "SONE" lines is an
 * app somebody guesses in.
 */
export function otpauthUri(secret: Uint8Array, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const parameters = new URLSearchParams({
    secret: toBase32(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}

/**
 * The secret, encrypted for storage.
 *
 * AES-256-GCM under a key derived from `SONE_SECRET_KEY`. A TOTP secret cannot
 * be hashed because a code has to be checked against it, so encryption is the
 * only option — and it protects the realistic case rather than the impossible
 * one: a backup on a laptop, a dump in a ticket, a restored staging copy. Not
 * somebody holding both the database and the environment, which nothing helps
 * with (ADR-0063).
 */
const keyFor = (secretKey: string): Buffer =>
  createHash('sha256').update(`totp:${secretKey}`, 'utf8').digest();

export function sealSecret(secret: Uint8Array, secretKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secretKey), iv);
  const body = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  // Version-prefixed, so a future change of algorithm can be told from a
  // failure to decrypt — the difference between "this needs upgrading" and
  // "something is wrong".
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
}

export function openSecret(sealed: string, secretKey: string): Uint8Array | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(secretKey),
      Buffer.from(parts[1] ?? '', 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[2] ?? '', 'base64url'));
    return new Uint8Array(
      Buffer.concat([decipher.update(Buffer.from(parts[3] ?? '', 'base64url')), decipher.final()]),
    );
  } catch {
    // A wrong key, a tampered blob, a truncated column: all the same answer,
    // because none of them is a secret this server can use.
    return null;
  }
}

/** How many recovery codes are made at once. */
export const RECOVERY_COUNT = 10;

/**
 * Ten codes, and the hashes to store.
 *
 * Hashed like session tokens (ADR-0010): they are credentials, and a stolen
 * backup must contain no working ones. Grouped in fours because a code somebody
 * copies off a screen by hand is copied wrong otherwise.
 */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  for (let made = 0; made < RECOVERY_COUNT; made += 1) {
    const raw = randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 12);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`.toLowerCase());
  }
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** The stored form. Dashes and case are stripped, because people retype them. */
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256')
    .update(code.toLowerCase().replace(/[^a-z0-9]/g, ''), 'utf8')
    .digest('hex');
