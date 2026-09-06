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


/**
 * The three outbound calls, bounded (ADR-0108).
 *
 * Node's `fetch` has no default timeout. A provider that accepts the connection
 * and then says nothing — a half-open firewall, an overloaded identity server,
 * a name that now resolves somewhere quiet — leaves the request outstanding and
 * the person waiting on a blank page. Nothing here was bounded.
 *
 * Both an `AbortSignal` and a race, for the reason `LocalFileStore.checkWritable`
 * gives about the same pairing: the signal is what actually releases the socket,
 * and the race is what makes the bound hold for a `fetchImpl` that ignores it —
 * which every test's does, and which is exactly where a bound that only *looks*
 * enforced would go unnoticed.
 */
export const PROVIDER_TIMEOUT_MS = 10_000;

async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OidcError(code));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), expiry]);
  } finally {
    if (timer) clearTimeout(timer);
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
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<Discovery> {
  const base = issuer.replace(/\/+$/, '');
  if (!base.startsWith('https://') && !base.startsWith('http://localhost')) {
    throw new OidcError('issuer_not_https');
  }

  let body: unknown;
  try {
    body = await bounded(
      async (signal) => {
        const response = await fetchImpl(`${base}/.well-known/openid-configuration`, { signal });
        if (!response.ok) throw new OidcError('discovery_failed');
        return response.json();
      },
      timeoutMs,
      'discovery_timeout',
    );
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
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
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
    // Bounded like the other two, and this is the one in the middle of the
    // flow: the authorization code has been handed over, so hanging here costs
    // a code that cannot be used again (ADR-0108).
    response = await bounded(
      (signal) =>
        fetchImpl(discovery.token_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal,
        }),
      timeoutMs,
      'token_request_timeout',
    );
  } catch (error) {
    throw error instanceof OidcError ? error : new OidcError('token_request_failed');
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
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<unknown[]> {
  try {
    return await bounded(
      async (signal) => {
        const response = await fetchImpl(discovery.jwks_uri, { signal });
        if (!response.ok) throw new OidcError('jwks_failed');
        const body = (await response.json()) as { keys?: unknown[] };
        if (!Array.isArray(body.keys)) throw new OidcError('jwks_failed');
        return body.keys;
      },
      timeoutMs,
      'jwks_timeout',
    );
  } catch (error) {
    throw error instanceof OidcError ? error : new OidcError('jwks_failed');
  }
}

/**
 * What a provider says about itself, remembered for a little while (ADR-0108).
 *
 * ## Why this exists at all
 *
 * Not to save a request. A sign-in discovers twice — once at `/start`, and
 * again at `/callback` **after the authorization code has been handed over**.
 * A provider that is briefly unreachable at that second moment costs somebody a
 * code that is now spent, and they begin again with no idea why. Remembering
 * the document makes the callback depend on the provider being up once rather
 * than twice.
 *
 * ## Why the keys are here too, and why that was the dangerous half
 *
 * `verifyIdToken` says this, and has said it since ADR-0024:
 *
 * > Providers rotate keys and publish the new one before using it, so an
 * > unknown `kid` means "fetch again", not "reject" — but that decision belongs
 * > to the caller holding the cache, and here it simply finds nothing.
 *
 * There was no caller holding a cache. Every sign-in fetched the keys afresh,
 * so a rotation resolved itself and the sentence described a problem nobody
 * had. **Caching the keys is what creates it**: between a rotation and the
 * entry expiring, every sign-in would fail with `unknown_key`.
 *
 * So the cache and `refresh` are one change. The caller asks again, once, when
 * verification fails for a key it has not seen — which is the decision that
 * comment always said belonged to it.
 *
 * `refresh` is the caller's word rather than something decided here, because an
 * unknown `kid` is also what a forged token looks like. A directory that
 * refetched on its own would let anybody make this server call its provider as
 * often as they liked; the caller is the one that knows it has already tried.
 */
export interface ProviderDirectoryOptions {
  fetchImpl?: Fetch;
  /** How long a document or a key set is trusted. Ten minutes by default. */
  ttlMs?: number;
  timeoutMs?: number;
  /** Injectable so expiry can be tested without waiting for it. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class ProviderDirectory {
  private readonly fetchImpl: Fetch;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  private readonly documents = new Map<string, { value: Discovery; until: number }>();
  private readonly keySets = new Map<string, { value: unknown[]; until: number }>();

  constructor(options: ProviderDirectoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  async discover(issuer: string): Promise<Discovery> {
    const key = issuer.replace(/\/+$/, '');
    const held = this.documents.get(key);
    if (held && held.until > this.now()) return held.value;

    const value = await discover(issuer, this.fetchImpl, this.timeoutMs);
    this.documents.set(key, { value, until: this.now() + this.ttlMs });
    return value;
  }

  /**
   * The provider's signing keys.
   *
   * `refresh` skips the remembered set and replaces it — for the one caller
   * that has a token naming a key it has never seen.
   */
  async keys(discovery: Discovery, opts: { refresh?: boolean } = {}): Promise<unknown[]> {
    const key = discovery.jwks_uri;
    const held = this.keySets.get(key);
    if (!opts.refresh && held && held.until > this.now()) return held.value;

    const value = await fetchKeys(discovery, this.fetchImpl, this.timeoutMs);
    this.keySets.set(key, { value, until: this.now() + this.ttlMs });
    return value;
  }

  /** Forget everything. For a test, and for a settings change. */
  forget(): void {
    this.documents.clear();
    this.keySets.clear();
  }
}
