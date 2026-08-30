/**
 * SONE server — asking a provider who somebody is.
 *
 * Discovery, the authorization request, and the exchange of a code for tokens.
 * The token check itself is in `oidcToken.ts`; this is what happens either side
 * of it.
 *
 * `fetch` is injected rather than imported, so the tests can run a real provider
 * — one that issues real signed tokens and can be made to misbehave — instead of
 * a mock that agrees with whatever is asked of it (ADR-0024).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export class OidcError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OidcError';
  }
}

type Fetch = typeof globalThis.fetch;

/**
 * Read a provider's discovery document.
 *
 * The issuer in the document must equal the issuer that was configured. A
 * provider that answers for a different issuer than the one asked is either
 * misconfigured or is not the provider — and following it anyway would mean
 * verifying tokens against whatever it nominated.
 *
 * Every endpoint must be https and must live under the issuer. Without that,
 * one bad discovery document redirects sign-in wherever it likes.
 */
export async function discover(
  issuer: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<Discovery> {
  const base = issuer.replace(/\/+$/, '');
  if (!base.startsWith('https://') && !base.startsWith('http://localhost')) {
    throw new OidcError('issuer_not_https');
  }

  let body: unknown;
  try {
    const response = await fetchImpl(`${base}/.well-known/openid-configuration`);
    if (!response.ok) throw new OidcError('discovery_failed');
    body = await response.json();
  } catch (error) {
    throw error instanceof OidcError ? error : new OidcError('discovery_failed');
  }

  const document = body as Partial<Discovery>;
  if (document.issuer !== base) throw new OidcError('issuer_mismatch');

  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    const value = document[key];
    if (typeof value !== 'string' || !sameOrigin(value, base)) {
      throw new OidcError('bad_discovery_document');
    }
  }

  return document as Discovery;
}

/** Is this URL on the issuer's own origin? */
function sameOrigin(candidate: string, issuer: string): boolean {
  try {
    const url = new URL(candidate);
    const base = new URL(issuer);
    if (url.protocol !== base.protocol || url.host !== base.host) return false;
    return url.protocol === 'https:' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

export interface PendingSignIn {
  state: string;
  nonce: string;
  verifier: string;
}

/**
 * The three secrets an authorization request needs.
 *
 * `state` proves the response belongs to a request this instance made; `nonce`
 * ties the token to it; the PKCE verifier proves the code is being redeemed by
 * whoever asked for it. Each guards a different step, which is why there are
 * three rather than one reused.
 */
export function beginSignIn(): PendingSignIn {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
  };
}

/** The URL to send somebody to. */
export function authorizationUrl(
  discovery: Discovery,
  options: { clientId: string; redirectUri: string; pending: PendingSignIn },
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', options.pending.state);
  url.searchParams.set('nonce', options.pending.nonce);
  // S256, never `plain`. Plain sends the verifier itself, which is the thing
  // PKCE exists to keep off the wire.
  url.searchParams.set('code_challenge', challengeFor(options.pending.verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const challengeFor = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

/** Compared without leaking how much matched. */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface TokenResponse {
  id_token: string;
  access_token?: string;
}

/**
 * Exchange the code for tokens.
 *
 * The client secret goes in the body rather than the URL: a query string is
 * written to access logs and browser history, and this one is the credential
 * that proves this application is itself.
 */
export async function exchangeCode(
  discovery: Discovery,
  options: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    verifier: string;
  },
  fetchImpl: Fetch = globalThis.fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code_verifier: options.verifier,
  });

  let response: Response;
  try {
    response = await fetchImpl(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    throw new OidcError('token_request_failed');
  }

  if (!response.ok) throw new OidcError('token_request_failed');

  let parsed: Partial<TokenResponse>;
  try {
    parsed = (await response.json()) as Partial<TokenResponse>;
  } catch {
    throw new OidcError('token_request_failed');
  }

  if (typeof parsed.id_token !== 'string' || parsed.id_token === '') {
    // A provider that returns no id token has authenticated nobody, whatever
    // else it returned. Treated as a failure rather than as an anonymous
    // success.
    throw new OidcError('no_id_token');
  }

  return parsed as TokenResponse;
}

/** Fetch the provider's signing keys. */
export async function fetchKeys(
  discovery: Discovery,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<unknown[]> {
  try {
    const response = await fetchImpl(discovery.jwks_uri);
    if (!response.ok) throw new OidcError('jwks_failed');
    const body = (await response.json()) as { keys?: unknown[] };
    if (!Array.isArray(body.keys)) throw new OidcError('jwks_failed');
    return body.keys;
  } catch (error) {
    throw error instanceof OidcError ? error : new OidcError('jwks_failed');
  }
}
