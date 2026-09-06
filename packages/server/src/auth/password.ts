/**
 * SONE — password hashing and token generation.
 *
 * Uses only `node:crypto`. No bcrypt, no argon2 package — both are native
 * addons that complicate the Docker build across architectures, and ADR-0004
 * argues for fewer dependencies in exactly the places that must not break.
 * scrypt is in the standard library, memory-hard, and adequate here.
 *
 * If a future SONE wants Argon2id, the stored format carries an algorithm
 * prefix so both can coexist and old hashes upgrade on next login.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  type ScryptOptions,
} from 'node:crypto';

import { envNumber } from '../env.js';

/**
 * Promisified scrypt.
 *
 * Hand-wrapped rather than via promisify(): the callback overload that takes
 * an options object is not the one promisify's types pick up, so the options
 * argument would be rejected.
 */
const scrypt = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });

/**
 * scrypt parameters.
 *
 * N=2^16 with r=8, p=1 costs roughly 64 MB and ~100 ms on modest hardware.
 * Tuned to be uncomfortable for an attacker with the database and tolerable
 * for a Raspberry Pi running a family instance — which is a real deployment
 * target, not a hypothetical.
 */
/**
 * The recommended exponent, and the one anything lower is compared against.
 *
 * A hash at 2^16 costs a few hundred milliseconds, which is the point of it.
 */
export const RECOMMENDED_COST = 16;

/**
 * What a new hash costs, as the exponent of N (ADR-0010 amendment).
 *
 * Configurable because the server's own test suite registers an account per
 * test through the real route, and at 2^16 that was about half the runtime of
 * its largest file — a suite people stop running is worse than a slightly
 * slower one.
 *
 * Safe to lower only because a stored hash records its own parameters and
 * `verifyPassword` reports `needsRehash` against the *current* setting: raising
 * the cost again upgrades every password on its owner's next sign-in rather
 * than stranding it. Anything below the recommendation warns at startup and
 * appears as an anomaly in the maintenance panel, because a security parameter
 * somebody set carelessly must be visible where they look and not only in a log
 * line from three deploys ago.
 */
export const passwordCost = (): number =>
  // A floor at 2^10 rather than none: below that scrypt is not slow enough to
  // be doing anything, and a typo of 1 should not silently produce a hash worth
  // nothing. This clamp was here first and is now written the way the other
  // five are (ADR-0111) — including the record of a refused value, which this
  // one used to drop.
  envNumber('SONE_PASSWORD_COST', RECOMMENDED_COST, { min: 10, max: 20, integer: true });

const SCRYPT_PARAMS = { r: 8, p: 1, keylen: 32 } as const;
const SALT_BYTES = 16;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_credentials'
      | 'rate_limited'
      | 'expired'
      | 'revoked'
      | 'not_found'
      | 'weak_password',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Hash a password.
 *
 * Format: `scrypt$N$r$p$<salt base64>$<hash base64>`. Parameters are stored
 * per hash so they can be raised later without invalidating existing
 * passwords.
 */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_BYTES);
  const N = 1 << passwordCost();
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, {
    N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });

  return [
    'scrypt',
    N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns `needsRehash` when the stored hash used weaker parameters than the
 * current ones, so the caller can transparently upgrade it.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    // Unknown format: fail closed rather than guessing.
    return { valid: false, needsRehash: false };
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return { valid: false, needsRehash: false };
  }

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return { valid: false, needsRehash: false };
  }

  const valid =
    derived.length === expected.length && timingSafeEqual(derived, expected);

  return {
    valid,
    // Against the *current* setting, which is what makes a lowered cost
    // recoverable: raising it again upgrades every password on its owner's next
    // sign-in rather than stranding it (ADR-0010 amendment).
    needsRehash: valid && (N < 1 << passwordCost() || r < SCRYPT_PARAMS.r),
  };
}

/**
 * Minimum password policy.
 *
 * Length only, deliberately. Composition rules (one uppercase, one digit)
 * measurably push people towards `Password1!` and are not required by any
 * current guidance.
 */
export function assertPasswordAcceptable(password: string): void {
  const normalised = password.normalize('NFKC');
  if (normalised.length < 12) {
    throw new AuthError('password must be at least 12 characters', 'weak_password');
  }
  if (normalised.length > 1024) {
    // An unbounded password is a denial-of-service vector against scrypt.
    throw new AuthError('password must be at most 1024 characters', 'weak_password');
  }
}

// --- tokens ----------------------------------------------------------------

/**
 * Generate an opaque token.
 *
 * 256 bits of entropy, base64url so it survives being pasted into a URL.
 * Returned once; only the digest is ever stored.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Digest a token for storage and lookup.
 *
 * Plain SHA-256, no salt and no KDF: the token is already high-entropy
 * random, so there is nothing to guess offline. Using scrypt here would make
 * every request pay 100 ms for no security gain.
 */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Compare two digests without leaking timing information. */
export function tokensMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A token that carries a visible prefix.
 *
 * The prefix lets rate limiting and audit logs identify which token was used
 * without storing anything that grants access.
 */
export interface PrefixedToken {
  /** Give to the user, once. */
  token: string;
  /** Store. */
  hash: Buffer;
  /** Safe to log. */
  prefix: string;
}

export function generatePrefixedToken(): PrefixedToken {
  const token = generateToken();
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, 8),
  };
}
