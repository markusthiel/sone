/**
 * SONE server — signing in through an identity provider.
 *
 * Three routes: what the sign-in page needs to know, where to send somebody,
 * and what to do when they come back.
 *
 * The pending secrets — state, nonce, PKCE verifier — live in a short-lived
 * cookie rather than in a table. They belong to one browser and one attempt,
 * and a row would outlive both: a table of half-finished sign-ins is something
 * to expire, to clean up, and to reason about when two tabs are open. A cookie
 * is scoped to exactly the thing it describes.
 */

import type { Pool } from 'pg';

import type { RequestContext, Router } from '../http/router.js';
import { queryOne } from '../db/pool.js';
import { setSessionCookie } from '../http/auth.js';
import { createSession } from './session.js';
import {
  OidcError,
  authorizationUrl,
  beginSignIn,
  discover,
  exchangeCode,
  fetchKeys,
  statesMatch,
} from './oidcFlow.js';
import { verifyIdToken, type Jwk } from './oidcToken.js';

export interface OidcDeps {
  pool: Pool;
  /** From the environment, never the database (ADR-0024). */
  clientSecret: string | null;
  publicUrl: string;
  secureCookies: boolean;
}

interface Settings {
  issuer: string;
  client_id: string;
  button_label: string;
  allow_signup: boolean;
  enabled: boolean;
}

const PENDING_COOKIE = 'sone_oidc';

/** Where the provider sends people back to. */
const redirectUri = (publicUrl: string): string =>
  `${publicUrl.replace(/\/+$/, '')}/api/auth/oidc/callback`;

async function settingsFor(pool: Pool, deps: OidcDeps): Promise<Settings | null> {
  const row = await queryOne<Settings>(
    pool,
    `SELECT issuer, client_id, button_label, allow_signup, enabled FROM oidc_settings`,
  );
  // Configured but with no secret is not configured. Refused here rather than
  // at the moment somebody clicks the button, which is the worst time to find
  // out (ADR-0024).
  if (!row || !row.enabled || !deps.clientSecret) return null;
  return row;
}

export function registerOidcRoutes(router: Router, deps: OidcDeps): void {
  /**
   * What the sign-in page needs.
   *
   * Deliberately says nothing but whether there is a button and what it reads —
   * the issuer and client id are of no use to somebody who is not signed in,
   * and naming an internal identity server publicly is a small gift to whoever
   * is looking.
   */
  router.get('/api/auth/oidc/config', async (ctx) => {
    const settings = await settingsFor(deps.pool, deps);
    ctx.send(200, {
      enabled: settings !== null,
      buttonLabel: settings?.button_label ?? null,
    });
  });

  /** Send somebody to the provider. */
  router.get('/api/auth/oidc/start', async (ctx) => {
    const settings = await settingsFor(deps.pool, deps);
    if (!settings) {
      ctx.fail(404, 'not_configured');
      return;
    }

    let discovery;
    try {
      discovery = await discover(settings.issuer);
    } catch (error) {
      ctx.fail(502, error instanceof OidcError ? error.code : 'discovery_failed');
      return;
    }

    const pending = beginSignIn();

    // HttpOnly, so script cannot read the verifier; SameSite=Lax, because the
    // provider returns by a top-level navigation and Strict would drop it and
    // make every sign-in fail with nothing to see.
    ctx.res.setHeader('set-cookie', [
      `${PENDING_COOKIE}=${encodeURIComponent(JSON.stringify(pending))}`,
      'Path=/api/auth/oidc',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=600',
      ...(deps.secureCookies ? ['Secure'] : []),
    ].join('; '));

    redirectTo(
      ctx,
      authorizationUrl(discovery, {
        clientId: settings.client_id,
        redirectUri: redirectUri(deps.publicUrl),
        pending,
      }),
    );
  });

  /** And what to do when they come back. */
  router.get('/api/auth/oidc/callback', async (ctx) => {
    const settings = await settingsFor(deps.pool, deps);
    if (!settings || !deps.clientSecret) {
      ctx.fail(404, 'not_configured');
      return;
    }

    const pending = readPending(ctx);
    clearPending(ctx, deps);
    if (!pending) {
      ctx.fail(400, 'no_pending_sign_in');
      return;
    }

    const returned = ctx.url.searchParams.get('state') ?? '';
    if (!statesMatch(returned, pending.state)) {
      // The response does not belong to a request this instance made.
      ctx.fail(400, 'state_mismatch');
      return;
    }

    const code = ctx.url.searchParams.get('code');
    if (!code) {
      ctx.fail(400, 'no_code');
      return;
    }

    try {
      const discovery = await discover(settings.issuer);
      const tokens = await exchangeCode(discovery, {
        code,
        clientId: settings.client_id,
        clientSecret: deps.clientSecret,
        redirectUri: redirectUri(deps.publicUrl),
        verifier: pending.verifier,
      });

      const claims = verifyIdToken(tokens.id_token, {
        issuer: settings.issuer.replace(/\/+$/, ''),
        clientId: settings.client_id,
        nonce: pending.nonce,
        keys: (await fetchKeys(discovery)) as Jwk[],
      });

      const userId = await linkOrCreate(deps.pool, settings, claims);
      if (!userId) {
        // Known to the provider and unknown here, with sign-up off. Said
        // plainly: an instance that trusts a provider to authenticate is not
        // necessarily one that lets everybody at that provider in.
        ctx.fail(403, 'no_account_here');
        return;
      }

      const session = await createSession(deps.pool, userId);
      setSessionCookie(ctx, session.token, deps.secureCookies);
      redirectTo(ctx, '/');
    } catch (error) {
      ctx.fail(401, error instanceof OidcError ? error.code : 'sign_in_failed');
    }
  });
}

/** A redirect, written here because the router deals in JSON replies. */
function redirectTo(ctx: RequestContext, location: string): void {
  ctx.res.writeHead(302, { location });
  ctx.res.end();
}

interface Pending {
  state: string;
  nonce: string;
  verifier: string;
}

function readPending(ctx: RequestContext): Pending | null {
  const header = ctx.req.headers.cookie ?? '';
  const match = new RegExp(`(?:^|;\\s*)${PENDING_COOKIE}=([^;]+)`).exec(header);
  if (!match?.[1]) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<Pending>;
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.verifier !== 'string'
    ) {
      return null;
    }
    return parsed as Pending;
  } catch {
    return null;
  }
}

/** Cleared whatever happens next, so one attempt cannot be replayed. */
function clearPending(ctx: RequestContext, deps: OidcDeps): void {
  ctx.res.setHeader('set-cookie', [
    `${PENDING_COOKIE}=`,
    'Path=/api/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(deps.secureCookies ? ['Secure'] : []),
  ].join('; '));
}

/**
 * Find the account this identity belongs to, or make one.
 *
 * Matched on (issuer, subject) and never on email. An existing local account
 * with the same address is *not* adopted: linking one is a deliberate act by
 * somebody already signed in, because doing it here would let whoever can set
 * an address at the provider take over an account they have never had.
 */
async function linkOrCreate(
  pool: Pool,
  settings: Settings,
  claims: { sub: string; email?: string; email_verified?: boolean; name?: string },
): Promise<string | null> {
  const issuer = settings.issuer.replace(/\/+$/, '');

  const existing = await queryOne<{ user_id: string }>(
    pool,
    `UPDATE oidc_identities SET last_seen = now()
      WHERE issuer = $1 AND subject = $2
      RETURNING user_id`,
    [issuer, claims.sub],
  );
  if (existing) return existing.user_id;

  if (!settings.allow_signup) return null;

  // A provider that will not say whether it verified an address has not
  // verified it, and an unverified address is a claim rather than a fact.
  if (!claims.email || claims.email_verified !== true) return null;

  const created = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, NULL)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [claims.email.toLowerCase(), claims.name ?? claims.email],
  );

  // The address already belongs to a local account. Refused rather than
  // linked — see the note above.
  if (!created) return null;

  await pool.query(
    `INSERT INTO oidc_identities (issuer, subject, user_id, last_seen)
     VALUES ($1,$2,$3, now())`,
    [issuer, claims.sub, created.id],
  );
  return created.id;
}
