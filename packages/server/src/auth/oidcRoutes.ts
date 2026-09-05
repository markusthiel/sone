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

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Pool } from 'pg';

import type { RequestContext, Router } from '../http/router.js';
import { queryOne } from '../db/pool.js';
import { requireSession, setSessionCookie } from '../http/auth.js';
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
  /**
   * The instance secret, used to sign the pending cookie (ADR-0082).
   *
   * The state check proves the provider's response matches *whatever pending
   * blob the browser is carrying* — and the blob was plain JSON, neither signed
   * nor encrypted. Anybody able to write a cookie for this host (a sibling
   * subdomain, or plain HTTP where `secureCookies` is off) could therefore plant
   * their own state, nonce and verifier and complete a sign-in into their own
   * account in somebody else's browser. Signing it makes the blob something
   * only this instance can have produced.
   */
  secretKey: string;
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

  /**
   * Send somebody to the provider.
   *
   * Two ways in, one route. Without a session it is a sign-in; with `?link=1`
   * and a session it attaches the provider to the account already signed in
   * (ADR-0084). One route because everything up to the callback is identical —
   * discovery, the three secrets, the redirect — and the only difference is a
   * field in the sealed blob.
   */
  router.get('/api/auth/oidc/start', async (ctx) => {
    const settings = await settingsFor(deps.pool, deps);
    if (!settings) {
      ctx.fail(404, 'not_configured');
      return;
    }

    let linkTo: string | null = null;
    if (ctx.url.searchParams.get('link') === '1') {
      const auth = await requireSession(deps.pool, ctx);
      if (!auth) return;
      linkTo = auth.userId;
    }

    let discovery;
    try {
      discovery = await discover(settings.issuer);
    } catch (error) {
      ctx.fail(502, error instanceof OidcError ? error.code : 'discovery_failed');
      return;
    }

    const pending: Pending = { ...beginSignIn(), ...(linkTo ? { link: linkTo } : {}) };

    // HttpOnly, so script cannot read the verifier; SameSite=Lax, because the
    // provider returns by a top-level navigation and Strict would drop it and
    // make every sign-in fail with nothing to see.
    addCookie(ctx, [
      `${PENDING_COOKIE}=${encodeURIComponent(sealPending(pending, deps.secretKey))}`,
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

    const pending = readPending(ctx, deps.secretKey);
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

      /*
       * Attaching a provider to an account that already exists (ADR-0084).
       *
       * The normal way in is an invitation: somebody is invited, sets a
       * password, and *then* wants to use the company's provider instead. Until
       * now the only `INSERT INTO oidc_identities` in the codebase was reachable
       * through fresh-account creation, so everybody who already had an account
       * was permanently unable to use single sign-on — while two records and the
       * deployment guide described a linking flow that did not exist.
       *
       * The session is checked again here, not taken from the blob: the blob
       * says whose attempt this is, and the cookie says who is holding the
       * browser. Both have to agree, or finishing a link in somebody else's
       * browser would attach your provider identity to their account.
       */
      if (pending.link) {
        const auth = await requireSession(deps.pool, ctx);
        if (!auth) return;
        if (auth.userId !== pending.link) {
          ctx.fail(403, 'not_your_link');
          return;
        }

        const attached = await attachIdentity(deps.pool, settings, claims, auth.userId);
        if (attached !== 'linked') {
          /*
           * Refused rather than moved. An identity pointing at two accounts is
           * a question with no good answer at sign-in time, and taking one off
           * an account somebody else is using is not this route's decision.
           */
          ctx.fail(409, attached === 'taken' ? 'already_linked_elsewhere' : 'already_have_one');
          return;
        }
        redirectTo(ctx, '/settings/sign-in?linked=1');
        return;
      }

      const userId = await linkOrCreate(deps.pool, settings, claims);
      if (!userId) {
        // Known to the provider and unknown here, with sign-up off. Said
        // plainly: an instance that trusts a provider to authenticate is not
        // necessarily one that lets everybody at that provider in.
        ctx.fail(403, 'no_account_here');
        return;
      }

      /*
       * A session, and no second-factor step — which is the recorded rule
       * rather than an omission (ADR-0065, ADR-0084).
       *
       * The exemption exists because "an OIDC account authenticates at the
       * provider, which has its own second factor and is the right place for
       * one. Requiring TOTP of such an account would be requiring a second
       * factor on top of somebody else's first one." That argument is about the
       * *door*, not about the account, so it holds just as well for an account
       * that also has a password: the password door still asks for the second
       * factor, and the provider door still trusts the provider.
       *
       * The trade is real and belongs to the person who linked: an attacker who
       * takes their provider account gets in without their TOTP. That is the
       * trade every "sign in with…" makes, and linking is a deliberate act by
       * somebody already signed in.
       */
      const session = await createSession(deps.pool, userId);
      setSessionCookie(ctx, session.token, deps.secureCookies);
      redirectTo(ctx, '/');
    } catch (error) {
      /*
       * Logged, because this catch is coarse on purpose and the price is that a
       * bug here looks exactly like a forged token (ADR-0082). A TypeError, a
       * database outage inside `linkOrCreate`, a failure to create the session:
       * all of them answered 401 sign_in_failed and wrote nothing anywhere, on
       * a path no test has ever executed.
       */
      if (!(error instanceof OidcError)) {
        console.error('[oidc] sign-in failed for a reason that is not an OIDC error', error);
      }
      ctx.fail(401, error instanceof OidcError ? error.code : 'sign_in_failed');
    }
  });

  /**
   * Whether this account has a provider attached, and which (ADR-0084).
   *
   * Named, because "connected" without saying to what is not an answer
   * somebody can act on — an instance can change its provider, and an old
   * identity pointing at an issuer nobody uses any more should be visible as
   * exactly that.
   */
  router.get('/api/auth/oidc/link', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const row = await queryOne<{ issuer: string; last_seen: string | null }>(
      deps.pool,
      `SELECT issuer, last_seen::text FROM oidc_identities WHERE user_id = $1`,
      [auth.userId],
    );
    const settings = await settingsFor(deps.pool, deps);
    ctx.send(200, {
      available: settings !== null,
      buttonLabel: settings?.button_label ?? null,
      linked: row ? { issuer: row.issuer, lastSeen: row.last_seen } : null,
      /*
       * Whether removing it would lock them out.
       *
       * An account whose only way in is the provider must not be able to
       * disconnect it — that is a door closed from the inside with nobody on
       * the other side. The interface needs to know before it offers the
       * button, and the route refuses regardless.
       */
      canUnlink: row !== null && (await hasPassword(deps.pool, auth.userId)),
    });
  });

  /** Take it off again. */
  router.delete('/api/auth/oidc/link', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    if (!(await hasPassword(deps.pool, auth.userId))) {
      // The only way in. Refused with a code the interface can explain rather
      // than a bare 403: what somebody has to do first is set a password.
      ctx.fail(409, 'no_other_way_in');
      return;
    }

    const removed = await deps.pool.query(`DELETE FROM oidc_identities WHERE user_id = $1`, [
      auth.userId,
    ]);
    ctx.send(200, { removed: removed.rowCount ?? 0 });
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
  /**
   * Whose account this attempt is attaching a provider to (ADR-0084).
   *
   * Absent for an ordinary sign-in. Present when somebody already signed in
   * pressed "connect" in their settings — and the callback then refuses unless
   * the session still belongs to that same person, so a link cannot be
   * completed into somebody else's account by finishing it in their browser.
   *
   * Inside the signed blob, which is what makes it trustworthy at all.
   */
  link?: string;
}

/**
 * Add a cookie without discarding one already set.
 *
 * `setHeader` **replaces**. The callback cleared the pending cookie and then
 * set the session cookie, both with `setHeader`, so on the one path that
 * matters — a successful sign-in — the clearing cookie was thrown away and the
 * pending blob stayed in the browser for its full ten minutes. The comment on
 * `clearPending` said "cleared whatever happens next", and it was true only on
 * the failure paths, where `ctx.fail` merges what `setHeader` left behind
 * (ADR-0082).
 */
function addCookie(ctx: RequestContext, cookie: string): void {
  const existing = ctx.res.getHeader('set-cookie');
  const all = Array.isArray(existing)
    ? [...existing, cookie]
    : typeof existing === 'string'
      ? [existing, cookie]
      : [cookie];
  ctx.res.setHeader('set-cookie', all);
}

const signPending = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');

/** The pending blob, with a signature only this instance can produce. */
function sealPending(pending: Pending, secret: string): string {
  const payload = JSON.stringify(pending);
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signPending(payload, secret)}`;
}

function readPending(ctx: RequestContext, secret: string): Pending | null {
  const header = ctx.req.headers.cookie ?? '';
  const match = new RegExp(`(?:^|;\\s*)${PENDING_COOKIE}=([^;]+)`).exec(header);
  if (!match?.[1]) return null;

  try {
    const [encoded, signature] = decodeURIComponent(match[1]).split('.');
    if (!encoded || !signature) return null;

    const payload = Buffer.from(encoded, 'base64url').toString('utf8');
    const expected = signPending(payload, secret);
    // Constant time, and length-checked first: timingSafeEqual throws on a
    // length mismatch rather than answering false.
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }

    const parsed = JSON.parse(payload) as Partial<Pending>;
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
  addCookie(ctx, [
    `${PENDING_COOKIE}=`,
    'Path=/api/auth/oidc',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(deps.secureCookies ? ['Secure'] : []),
  ].join('; '));
}

/** Whether this account can still be signed into without the provider. */
async function hasPassword(pool: Pool, userId: string): Promise<boolean> {
  const row = await queryOne<{ has: boolean }>(
    pool,
    `SELECT password_hash IS NOT NULL AS has FROM users WHERE id = $1`,
    [userId],
  );
  return row?.has === true;
}

/**
 * Attach a provider identity to an account that already exists (ADR-0084).
 *
 * Returns false when that identity already belongs to somebody else here. The
 * insert carries `ON CONFLICT (issuer, subject) DO NOTHING`, so the refusal is
 * the database's answer rather than a check-then-write with a gap in it.
 *
 * One provider per account: the unique constraint on `user_id` makes a second
 * link replace nothing and fail, which is the honest behaviour while there is
 * one provider configured per instance.
 */
async function attachIdentity(
  pool: Pool,
  settings: Settings,
  claims: { sub: string },
  userId: string,
): Promise<'linked' | 'taken' | 'already_have_one'> {
  const issuer = settings.issuer.replace(/\/+$/, '');
  try {
    const row = await queryOne<{ user_id: string }>(
      pool,
      `INSERT INTO oidc_identities (issuer, subject, user_id, last_seen)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (issuer, subject) DO UPDATE SET last_seen = now()
         WHERE oidc_identities.user_id = $3
       RETURNING user_id`,
      [issuer, claims.sub, userId],
    );
    // No row means the identity exists and belongs to somebody else: the
    // `DO UPDATE ... WHERE` matched nothing.
    return row ? 'linked' : 'taken';
  } catch (error) {
    /*
     * `oidc_identities_one_per_user` — this account already has an identity at
     * this issuer, under a different subject.
     *
     * Distinguished because the two are different sentences to a person: "that
     * provider account belongs to somebody else here" and "you already have one
     * connected; disconnect it first". Both would otherwise be a bare failure.
     */
    if ((error as { code?: string }).code === '23505') return 'already_have_one';
    throw error;
  }
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

  /*
   * `ON CONFLICT (lower(email)) WHERE email IS NOT NULL`, matching the index
   * that exists — and this said `ON CONFLICT (email)`, which matches nothing
   * (ADR-0082).
   *
   * The unique index on this table is `users_email_key ON users (lower(email))
   * WHERE email IS NOT NULL`: an expression, and partial. Postgres infers an
   * arbiter by matching both, so the old clause raised
   * "there is no unique or exclusion constraint matching the ON CONFLICT
   * specification" — on **every** attempt to create an account.
   *
   * Which means signing in through a provider for the first time has never
   * worked. The throw landed in the callback's coarse catch and became
   * `401 sign_in_failed` with nothing written anywhere, so it was
   * indistinguishable from a forged token; and no test had ever executed this
   * function. The first test that ran it found this in its first second.
   */
  const created = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, NULL)
     ON CONFLICT (lower(email)) WHERE email IS NOT NULL DO NOTHING
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
