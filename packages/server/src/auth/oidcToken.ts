/**
 * SONE server — checking what an identity provider says.
 *
 * The whole of single sign-on rests on one question: is this token really from
 * the provider, really about this application, and really still valid? Every
 * other part of the flow is plumbing; this is the part where a mistake means
 * anybody can be anybody.
 *
 * So it is a pure function over a token and a key set, and its tests build real
 * tokens with a real key and then break them one property at a time. A test
 * against a mock that always says yes tests nothing (ADR-0024).
 *
 * ## No library
 *
 * Node verifies RS256 and ES256 with the key set converted from JWK, which it
 * does natively. A dependency here would be a dependency in the one place where
 * an unnoticed change is worst, and the code it would replace is short enough to
 * read in full.
 */

import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';

/** A key as a provider publishes it. */
export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

export interface VerifyOptions {
  issuer: string;
  clientId: string;
  /** The nonce sent with the request, which must come back unchanged. */
  nonce: string;
  keys: readonly Jwk[];
  /** Seconds of tolerance for clocks that disagree. */
  clockSkewSeconds?: number;
  now?: () => number;
}

export class TokenError extends Error {
  constructor(readonly code: string) {
    // A code, not a sentence (ADR-0011). It is also deliberately coarse:
    // telling a caller *which* check failed tells an attacker which one to
    // work on next.
    super(code);
    this.name = 'TokenError';
  }
}

const decodeSegment = (segment: string): Buffer =>
  Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** The algorithms accepted. Anything else, including `none`, is refused. */
const ALGORITHMS: Record<string, { hash: string; format: 'ieee-p1363' | undefined }> = {
  RS256: { hash: 'sha256', format: undefined },
  RS384: { hash: 'sha384', format: undefined },
  RS512: { hash: 'sha512', format: undefined },
  ES256: { hash: 'sha256', format: 'ieee-p1363' },
  ES384: { hash: 'sha384', format: 'ieee-p1363' },
};

/**
 * Verify an id token and return its claims.
 *
 * Throws TokenError on anything at all. There is no partial success here: a
 * token that fails one check is not a token that half belongs to somebody.
 */
export function verifyIdToken(token: string, options: VerifyOptions): IdTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('malformed_token');

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(decodeSegment(headerPart).toString('utf8')) as typeof header;
    claims = JSON.parse(decodeSegment(payloadPart).toString('utf8')) as IdTokenClaims;
  } catch {
    throw new TokenError('malformed_token');
  }

  // The algorithm is chosen from a list here, never taken from the token.
  //
  // A token that names its own algorithm can name `none`, and a verifier that
  // obeys accepts anything. This is the oldest mistake in the subject and it is
  // still worth writing down.
  const algorithm = ALGORITHMS[header.alg ?? ''];
  if (!algorithm) throw new TokenError('unsupported_algorithm');

  // Candidate keys: the named one, or every key when the token names none.
  //
  // Providers rotate keys and publish the new one before using it, so an
  // unknown `kid` means "fetch again", not "reject" — but that decision belongs
  // to the caller holding the cache, and here it simply finds nothing.
  const candidates = header.kid
    ? options.keys.filter((key) => key.kid === header.kid)
    : options.keys;
  if (candidates.length === 0) throw new TokenError('unknown_key');

  const signed = Buffer.from(`${headerPart}.${payloadPart}`, 'utf8');
  const signature = decodeSegment(signaturePart);

  const verified = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      const verifier = createVerify(algorithm.hash);
      verifier.update(signed);
      verifier.end();
      return verifier.verify(
        algorithm.format ? { key, dsaEncoding: algorithm.format } : key,
        signature,
      );
    } catch {
      // A key this build cannot construct — an unusual curve, a malformed
      // entry. Skipped rather than fatal: one bad key in a set must not stop a
      // good one from being tried.
      return false;
    }
  });
  if (!verified) throw new TokenError('bad_signature');

  // Only now are the claims worth reading. Checking them before the signature
  // would mean acting on values nobody has vouched for.
  if (claims.iss !== options.issuer) throw new TokenError('wrong_issuer');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.clientId)) throw new TokenError('wrong_audience');

  const skew = options.clockSkewSeconds ?? 60;
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) {
    throw new TokenError('expired');
  }
  if (typeof claims.iat === 'number' && claims.iat - skew > now) {
    throw new TokenError('issued_in_the_future');
  }

  // The nonce ties this token to the request that asked for it, which is what
  // stops one obtained elsewhere from being replayed here.
  if (!claims.nonce || !equal(claims.nonce, options.nonce)) {
    throw new TokenError('wrong_nonce');
  }

  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new TokenError('missing_subject');
  }

  return claims;
}

/** Compared without leaking how much matched. */
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
