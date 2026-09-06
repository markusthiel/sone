/**
 * SONE — authentication routes.
 *
 * Errors return a code, never a sentence (ADR-0011): the client owns the
 * catalogue, and a message already on screen must survive a language change.
 *
 * The session token travels in an HttpOnly cookie rather than a response body.
 * A token readable from JavaScript is a token an XSS can exfiltrate, and a
 * note-taking app renders a great deal of user-supplied content.
 */

import type { Pool } from 'pg';

import type { BrandInfo } from '../admin/settings.js';
import { AuthError, verifyPassword } from '../auth/password.js';
import { issueReset, redeemReset } from '../auth/reset.js';
import {
  checkSecondFactor,
  confirmEnrolment,
  hasSecondFactor,
  readTicket,
  recoveryCodesLeft,
  removeSecondFactor,
  signTicket,
  startEnrolment,
} from '../auth/secondFactor.js';
import {
  LOGIN_ATTEMPT_LIMIT,
  createSession,
  recentFailures,
  recordAttempt,
  changePassword,
  listSessions,
  login,
  resolveSession,
  revokeSession,
  SESSION_TTL_DAYS,
} from '../auth/session.js';
import {
  bootstrapInstance,
  inspectInvitation,
  register,
  type SignupMode,
} from '../auth/registration.js';
import { queryOne, queryRows } from '../db/pool.js';
import { createDefaultFolder } from '../pages/createEntry.js';
import { negotiateLocale } from '../i18n/locale.js';
import { STANDING_COLUMNS, STANDING_JOIN } from '../auth/standing.js';
import { WORKSPACE_ORDER_SQL } from '../workspaces/order.js';
import { BodyError, type RequestContext, type Router } from './router.js';
import {
  resolveSessionClaims,
  resolveShareTokenClaims,
  type AccessClaims,
} from '../auth/claims.js';

/**
 * What a resolved session knows.
 *
 * Derived from the resolver rather than declared, so it cannot drift from what
 * that function actually returns — the same definition `pages.ts` had, moved
 * here with the helper that uses it.
 */
export type Claims = NonNullable<Awaited<ReturnType<typeof resolveSessionClaims>>>;

export const SESSION_COOKIE = 'sone_session';

export interface AuthDeps {
  /**
   * Whether a relay is configured (ADR-0059).
   *
   * A function rather than a boolean, because an administrator can set the mail
   * server while the process runs — a value captured at startup would leave the
   * reset absent until a restart.
   */
  canSendMail: () => Promise<boolean>;
  /** Send one reset link. Injected, so this module does not reach into mail. */
  sendResetMail: (to: string, token: string, expiresAt: Date) => Promise<void>;
  /** Tell an account with no password where it actually signs in (ADR-0059). */
  sendProviderMail: (to: string) => Promise<void>;
  /** For signing the half-finished sign-in ticket, and sealing TOTP secrets. */
  secretKey: string;
  /** What an authenticator app calls this instance (ADR-0063). */
  instanceName: () => Promise<string>;
  /**
   * What the instance looks like (ADR-0123).
   *
   * Injected like everything else here, and read per request rather than
   * captured: an administrator changes a logo while the process runs, and a
   * value taken at startup would show the old mark until a restart.
   *
   * Optional, so a suite that is not about branding need not supply one — the
   * answer is then an instance with a name and nothing else, which is what a
   * fresh instance has.
   */
  brand?: () => Promise<BrandInfo>;
  /**
   * Note the browser somebody signed in from, and write once if it is new
   * (ADR-0130).
   *
   * Injected and optional, like every other mail here: a suite that is not
   * about it need not supply one, and an instance with no relay still records
   * the device — which is what keeps configuring mail later from delivering a
   * burst of letters about old browsers.
   */
  noteSignIn?: (
    userId: string,
    meta: { userAgent: string | null; ipPrefix: string | null },
  ) => Promise<unknown>;
  /**
   * Where an account stands against the requirement (ADR-0065).
   *
   * Injected, for the same reason the gate is installed rather than imported:
   * this module must not depend on the settings store.
   */
  secondFactorStanding: (userId: string) => Promise<{
    standing: { kind: 'fine' } | { kind: 'grace'; deadline: string } | { kind: 'blocked' };
    /** The facts it was decided from, so the caller need not ask again. */
    facts: { hasSecondFactor: boolean; hasPassword: boolean };
  }>;
  pool: Pool;
  /**
   * Who may create an account.
   *
   * A function, not a value.
   *
   * It was a value read once at startup, which meant an administrator could
   * change the setting, see it saved, see the interface report the new value —
   * and registration would carry on using whatever the environment said when
   * the container booted. A switch that does nothing is worse than no switch,
   * because it is believed.
   */
  signupMode: () => Promise<SignupMode>;
  /**
   * How the interface addresses somebody, where a language distinguishes it.
   *
   * A function for the same reason `signupMode` is: an administrator changing it
   * must see it take effect without a redeploy, and a switch that does nothing is
   * worse than no switch because it is believed.
   *
   * Optional so the test harnesses that build a router by hand need not know
   * about it; absent means "du", which is what the interface said before the
   * setting existed.
   */
  addressForm?: () => Promise<'informal' | 'formal'>;
  /** True when the public URL is https, so the cookie can be marked Secure. */
  secureCookies: boolean;
}

// --- cookies ---------------------------------------------------------------

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Exported so single sign-on can end in the same session as a password does.
 *
 * A second copy would be a second set of cookie attributes to keep in step, and
 * the one that drifted would be the one nobody was looking at.
 */
export function setSessionCookie(
  ctx: RequestContext,
  token: string,
  secure: boolean,
): void {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    // Lax rather than Strict: a shared link opened from an email must arrive
    // authenticated, and Strict drops the cookie on cross-site navigation.
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_DAYS * 86_400}`,
  ];
  if (secure) attrs.push('Secure');
  /*
   * Appended, not set.
   *
   * `setHeader` replaces, and the OIDC callback clears its pending cookie
   * immediately before calling this — so the clearing cookie was thrown away
   * and the pending blob survived a successful sign-in for its full ten
   * minutes (ADR-0082). Nothing else sets a cookie alongside this one today,
   * which is exactly why the collision went unseen.
   */
  const existing = ctx.res.getHeader('set-cookie');
  ctx.res.setHeader(
    'set-cookie',
    Array.isArray(existing)
      ? [...existing, attrs.join('; ')]
      : typeof existing === 'string'
        ? [existing, attrs.join('; ')]
        : attrs.join('; '),
  );
}

function clearSessionCookie(ctx: RequestContext, secure: boolean): void {
  const attrs = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) attrs.push('Secure');
  /*
   * Appended, not set.
   *
   * `setHeader` replaces, and the OIDC callback clears its pending cookie
   * immediately before calling this — so the clearing cookie was thrown away
   * and the pending blob survived a successful sign-in for its full ten
   * minutes (ADR-0082). Nothing else sets a cookie alongside this one today,
   * which is exactly why the collision went unseen.
   */
  const existing = ctx.res.getHeader('set-cookie');
  ctx.res.setHeader(
    'set-cookie',
    Array.isArray(existing)
      ? [...existing, attrs.join('; ')]
      : typeof existing === 'string'
        ? [existing, attrs.join('; ')]
        : attrs.join('; '),
  );
}

/**
 * Claims for a workspace, or null without a session.
 *
 * Moved here from `pages.ts` when the export route needed it. It was a private
 * helper there, and the alternative was a second copy — two functions deciding
 * who somebody is would be two places to disagree about it, which for an
 * authorisation helper is the worst kind of duplication.
 */
export async function claimsOrNull(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<Claims | null> {
  const token = sessionTokenFrom(ctx);
  if (!token) return null;
  return resolveSessionClaims(pool, token, workspaceId);
}

export const sessionTokenFrom = (ctx: RequestContext): string | null =>
  parseCookies(ctx.req.headers['cookie'])[SESSION_COOKIE] ?? null;

/**
 * The cookie a share visitor carries.
 *
 * Separate from the member cookie so the two cannot be confused, and so signing
 * in through a shared link does not silently mix the two credentials.
 *
 * It exists because a share visitor previously had no HTTP credential at all:
 * the token authenticated the WebSocket and nothing else, so every image in a
 * shared page returned 401 and failed to load. A cookie is the only shape that
 * works for an `<img src>`, which cannot set headers.
 */
export const SHARE_COOKIE = 'sone_share';

export const shareTokenFrom = (ctx: RequestContext): string | null =>
  parseCookies(ctx.req.headers['cookie'])[SHARE_COOKIE] ?? null;

/**
 * Give the browser the share token.
 *
 * Scoped to the whole site rather than to /s/, because the requests that need
 * it — `/api/files/...`, `/api/share/...` — are not under that prefix.
 *
 * HttpOnly, so a script cannot read it: the token is a bearer credential and
 * script access buys nothing the page cannot already do. SameSite=Lax, so it is
 * sent when somebody follows the link from an email, which is the normal way a
 * share link is used.
 */
export function setShareCookie(
  ctx: RequestContext,
  token: string,
  secure: boolean,
): void {
  const attrs = [
    `${SHARE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    // Session-scoped: a shared link is usually opened once, and a cookie that
    // outlives the browser would leave a credential behind on a shared machine.
  ];
  if (secure) attrs.push('Secure');
  /*
   * Appended, not set.
   *
   * `setHeader` replaces, and the OIDC callback clears its pending cookie
   * immediately before calling this — so the clearing cookie was thrown away
   * and the pending blob survived a successful sign-in for its full ten
   * minutes (ADR-0082). Nothing else sets a cookie alongside this one today,
   * which is exactly why the collision went unseen.
   */
  const existing = ctx.res.getHeader('set-cookie');
  ctx.res.setHeader(
    'set-cookie',
    Array.isArray(existing)
      ? [...existing, attrs.join('; ')]
      : typeof existing === 'string'
        ? [existing, attrs.join('; ')]
        : attrs.join('; '),
  );
}

/** Truncated client address, for the rate-limit ledger. See ADR-0010. */
function ipPrefix(ctx: RequestContext): string | null {
  const forwarded = ctx.req.headers['x-forwarded-for'];
  const raw =
    (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded?.[0]) ??
    ctx.req.socket.remoteAddress ??
    null;
  if (!raw) return null;
  const address = raw.trim().replace(/^::ffff:/, '');
  if (address.includes(':')) return `${address.split(':').slice(0, 3).join(':')}::/48`;
  const octets = address.split('.');
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24` : null;
}

// --- session context -------------------------------------------------------

export interface AuthenticatedRequest {
  userId: string;
  sessionId: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
}

/**
 * Resolve the caller, or answer 401 and return null.
 *
 * Returning null rather than throwing keeps the happy path in each route free
 * of try/catch, and the 401 shape identical everywhere.
 */
/**
 * The requirement check, installed by the server rather than imported here.
 *
 * `requireSession` is used by every module, and having it reach into the
 * settings store would make half the codebase depend on it. The server sets
 * this once at startup; without it — in a test that registers routes by hand —
 * the gate is simply absent, which is the behaviour of an instance that does
 * not require anything.
 */
let secondFactorGate:
  | ((pool: Pool, userId: string, path: string) => Promise<string | null>)
  | null = null;

export function installSecondFactorGate(
  gate: (pool: Pool, userId: string, path: string) => Promise<string | null>,
): void {
  secondFactorGate = gate;
}

export async function requireSession(
  pool: Pool,
  ctx: RequestContext,
): Promise<AuthenticatedRequest | null> {
  const token = sessionTokenFrom(ctx);
  if (!token) {
    ctx.fail(401, 'not_authenticated');
    return null;
  }
  const resolved = await resolveSession(pool, token);
  if (!resolved) {
    ctx.fail(401, 'not_authenticated');
    return null;
  }

  /*
   * The requirement, checked at the one gate every authenticated request goes
   * through (ADR-0065).
   *
   * Here rather than in each route, because a rule enforced route by route is a
   * rule with a hole in it the day somebody adds a route. The cost is one
   * settings read and one small query per request, and only when the
   * requirement is actually switched on — a check that runs on every request
   * has to be free when the feature is off.
   */
  if (secondFactorGate) {
    const refusal = await secondFactorGate(pool, resolved.user.userId, ctx.url.pathname);
    if (refusal) {
      // 403 and a named code, not 401: the session is valid and signing in
      // again would change nothing. The interface reads the code and shows the
      // enrolment screen.
      ctx.fail(403, refusal);
      return null;
    }
  }

  return {
    userId: resolved.user.userId,
    sessionId: resolved.sessionId,
    displayName: resolved.user.displayName,
    email: resolved.user.email,
    isGuest: resolved.user.isGuest,
  };
}

/** Map an AuthError to a status code. */
function statusFor(err: AuthError): number {
  switch (err.code) {
    case 'rate_limited':
      return 429;
    case 'not_found':
      return 404;
    case 'weak_password':
      return 422;
    default:
      return 401;
  }
}

async function readBody<T>(ctx: RequestContext): Promise<T | null> {
  try {
    return await ctx.json<T>();
  } catch (err) {
    if (err instanceof BodyError) {
      ctx.fail(err.code === 'body_too_large' ? 413 : 400, err.code);
      return null;
    }
    throw err;
  }
}

// --- routes ----------------------------------------------------------------

/**
 * One of the three answers, or null for "leave it alone".
 *
 * Checked rather than trusted: the columns carry a CHECK, and a rejected write
 * would be a 500 where this is a quiet no-op (ADR-0061).
 */
const when = (
  value: unknown,
): 'immediately' | 'daily' | 'off' | null =>
  value === 'immediately' || value === 'daily' || value === 'off' ? value : null;

export function registerAuthRoutes(router: Router, deps: AuthDeps): void {
  /**
   * Whether the instance needs first-run setup, and which signup mode it uses.
   *
   * Unauthenticated on purpose: the login screen has to know what to render
   * before anyone can log in. It leaks only whether the instance is configured,
   * which is visible from the login page regardless.
   */
  router.get('/api/instance', async (ctx) => {
    const row = await queryOne<{ n: string }>(
      deps.pool,
      `SELECT count(*)::text AS n FROM workspaces`,
    );
    ctx.send(200, {
      needsSetup: Number(row?.n ?? 0) === 0,
      signupMode: await deps.signupMode(),
      suggestedLocale: negotiateLocale(ctx.req.headers['accept-language']),
      // Sent with the instance rather than with the session, because the sign-in
      // screen is addressed too and there is nobody to ask yet.
      addressForm: (await deps.addressForm?.()) ?? 'informal',
      /*
       * Whether this instance can send mail at all (ADR-0059, ADR-0126).
       *
       * It was `canResetPassword`, which named one consequence of the fact
       * rather than the fact. A second reader arrived — the share dialog, which
       * offers to mail a link only where there is a relay — and two fields
       * carrying one boolean is the duplication this codebase keeps removing.
       *
       * What ADR-0059 decided is unchanged: with no relay the reset is
       * *absent* rather than broken, and the sign-in screen must not offer a
       * link to a form that can only ever say "a link is on its way" about a
       * mail nobody will send.
       *
       * Sent with the instance for the same reason as the form of address:
       * there is nobody to ask yet.
       */
      canSendMail: await deps.canSendMail(),
      /*
       * What this instance looks like (ADR-0123).
       *
       * Here rather than on the session, because that is the point of it: an
       * instance's look that only appears once somebody is inside is branding
       * for people who already know where they are. This is the one route that
       * answers with nobody signed in, which is why the form of address travels
       * on it too.
       */
      brand: (await deps.brand?.()) ?? {
        name: await deps.instanceName(),
        theme: {},
        logo: null,
      },
    });
  });

  router.post('/api/auth/setup', async (ctx) => {
    const body = await readBody<{
      email?: string;
      password?: string;
      displayName?: string;
      workspaceName?: string;
    }>(ctx);
    if (!body) return;

    if (!body.email || !body.password || !body.workspaceName) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    try {
      const result = await bootstrapInstance(deps.pool, {
        email: body.email,
        password: body.password,
        displayName: body.displayName ?? '',
        workspaceName: body.workspaceName,
      });
      // A workspace with no folders cannot hold a page at all, since pages
      // live in folders (ADR-0019) — so a fresh instance would show a "new
      // page" button that refuses. Created after the bootstrap transaction
      // rather than inside it: writing a CRDT document is not part of
      // registering an account, and if this fails the instance is still usable
      // because the person can create a folder themselves.
      // workspaceId is nullable on the shared result type because invited
      // signups may not create one; bootstrap always does.
      if (result.workspaceId) {
        try {
          await createDefaultFolder(deps.pool, result.workspaceId, result.userId);
        } catch (err) {
          console.error('[setup] could not create the default folder', err);
        }
      }

      setSessionCookie(ctx, result.session.token, deps.secureCookies);
      ctx.send(201, { userId: result.userId, workspaceId: result.workspaceId });
    } catch (err) {
      if (err instanceof AuthError) ctx.fail(statusFor(err), err.code);
      else throw err;
    }
  });

  router.post('/api/auth/login', async (ctx) => {
    const body = await readBody<{ email?: string; password?: string }>(ctx);
    if (!body) return;
    if (!body.email || !body.password) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    try {
      const session = await login(deps.pool, {
        email: body.email,
        password: body.password,
        userAgent: ctx.req.headers['user-agent'] ?? null,
        ipPrefix: ipPrefix(ctx),
      });

      /*
       * Note the browser (ADR-0130).
       *
       * Swallowed and never awaited for its result: somebody who typed the
       * right password is signed in whether or not their mailbox took a
       * message about it, which is ADR-0121's rule for a grant applied to a
       * session.
       */
      await deps
        .noteSignIn?.(session.userId, {
          userAgent: ctx.req.headers['user-agent'] ?? null,
          ipPrefix: ipPrefix(ctx),
        })
        .catch(() => undefined);

      /*
       * The password was checked in full before we got here (ADR-0063).
       *
       * Including its scrypt cost, which is the point: the second step must not
       * be usable to learn whether a password was right. A wrong password never
       * reaches this line at all.
       */
      if (await hasSecondFactor(deps.pool, session.userId)) {
        /*
         * The session exists but its cookie is not set. Instead the caller gets
         * a ticket naming the account, signed and good for five minutes.
         *
         * Signed rather than stored, like the reply and reset tokens: no table,
         * nothing to sweep, and nothing that can go missing between two
         * requests a few seconds apart. Five minutes because that is somebody
         * reaching for their phone, not somebody leaving for lunch.
         */
        await revokeSession(deps.pool, session.sessionId);
        ctx.send(200, {
          needsSecondFactor: true,
          ticket: signTicket(session.userId, deps.secretKey),
        });
        return;
      }

      setSessionCookie(ctx, session.token, deps.secureCookies);
      ctx.sendEmpty(204);
    } catch (err) {
      if (err instanceof AuthError) ctx.fail(statusFor(err), err.code);
      else throw err;
    }
  });

  router.post('/api/auth/signup', async (ctx) => {
    const body = await readBody<{
      email?: string;
      password?: string;
      displayName?: string;
      invitationToken?: string;
    }>(ctx);
    if (!body) return;
    if (!body.email || !body.password) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    try {
      const result = await register(deps.pool, await deps.signupMode(), {
        email: body.email,
        password: body.password,
        displayName: body.displayName ?? '',
        invitationToken: body.invitationToken ?? null,
        userAgent: ctx.req.headers['user-agent'] ?? null,
        ipPrefix: ipPrefix(ctx),
      });
      setSessionCookie(ctx, result.session.token, deps.secureCookies);
      ctx.send(201, { userId: result.userId, workspaceId: result.workspaceId });
    } catch (err) {
      if (err instanceof AuthError) ctx.fail(statusFor(err), err.code);
      else throw err;
    }
  });

  /** Inspect an invitation before signing up, so the form can be pre-filled. */
  router.get('/api/auth/invitation/:token', async (ctx) => {
    const info = await inspectInvitation(deps.pool, ctx.params['token'] ?? '');
    if (!info) {
      ctx.fail(404, 'invitation_invalid');
      return;
    }
    ctx.send(200, {
      workspaceName: info.workspaceName,
      email: info.email,
      role: info.role,
      remainingUses: info.remainingUses,
    });
  });

  router.post('/api/auth/logout', async (ctx) => {
    const token = sessionTokenFrom(ctx);
    if (token) {
      const resolved = await resolveSession(deps.pool, token);
      if (resolved) await revokeSession(deps.pool, resolved.sessionId);
    }
    // Cleared unconditionally: a stale cookie must not survive a logout just
    // because the session had already expired.
    clearSessionCookie(ctx, deps.secureCookies);
    ctx.sendEmpty(204);
  });

  /**
   * The current session, plus the workspaces it can reach.
   *
   * One request rather than two, because the client needs both before it can
   * render anything and a second round trip is a second chance to flicker.
   */
  router.get('/api/auth/session', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const workspaces = await queryRows<{
      id: string;
      name: string;
      role: string;
      role_name: string;
      rights: string[];
      is_owner: boolean;
      default_locale: string;
      icon: unknown;
    }>(
      deps.pool,
      // The standing, not the old enum word (ADR-0102). The same fragment
      // /api/workspaces uses, for the same reason as the order clause below.
      `SELECT w.id, w.name, w.default_locale, w.icon, ${STANDING_COLUMNS}
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         ${STANDING_JOIN}
        WHERE m.user_id = $1
          -- A workspace marked for deletion stops appearing to its members
          -- (ADR-0027). It is not gone, and somebody with the right can put it
          -- back; what it must not do is keep looking like somewhere to write.
          AND w.deleted_at IS NULL
        -- The person's own order (ADR-0031). The same clause /api/workspaces
        -- uses, because the client opens the first entry when no workspace is
        -- remembered: two sorts here would mean the switcher's first row and
        -- the workspace you land in are different ones.
        ${WORKSPACE_ORDER_SQL}`,
      [auth.userId],
    );

    /*
     * The requirement facts, once, before the reply is assembled.
     *
     * `deps.secondFactorStanding` now returns both the standing and the facts
     * it was decided from, so the two things the session needs cost one query
     * rather than two.
     */
    const standing = await deps.secondFactorStanding(auth.userId);

    const user = await queryOne<{
      locale: string | null;
      timezone: string | null;
      is_instance_admin: boolean;
      can_manage_workspaces: boolean;
      mentions_when: string;
      assignments_when: string;
      replies_when: string;
      activity_digest: string;
      digest_scope: string;
      color_scheme: string | null;
    }>(
      deps.pool,
      // The rights come with the session, so the interface can hide a section
      // somebody cannot reach rather than showing it and failing on arrival
      // (ADR-0027).
      `SELECT locale, timezone, is_instance_admin, can_manage_workspaces,
              mentions_when, assignments_when, replies_when, activity_digest,
              digest_scope, color_scheme
         FROM users WHERE id = $1`,
      [auth.userId],
    );

    ctx.send(200, {
      user: {
        id: auth.userId,
        email: auth.email,
        displayName: auth.displayName,
        isGuest: auth.isGuest,
        locale: user?.locale ?? null,
        timezone: user?.timezone ?? null,
        isInstanceAdmin: user?.is_instance_admin === true,
        // Implied by being an instance administrator, exactly as the server
        // decides it — one answer, in one place.
        canManageWorkspaces:
          user?.is_instance_admin === true || user?.can_manage_workspaces === true,
        /*
         * Whether to be emailed, per kind (ADR-0058).
         *
         * In the session because the screen that shows them is already reading
         * it, and a second request for three booleans would be a second thing
         * to keep in step with the profile patch that changes them.
         */
        /*
         * One question, one query (ADR-0063, ADR-0065).
         *
         * This asked twice: `hasSecondFactor` for the settings screen, and then
         * a standing that read the same fact plus whether the account has a
         * password of its own. Two queries, on the route every page load hits,
         * for facts that come out of one row — the exact "two answers to one
         * question" this codebase keeps having removed from it, written by me
         * two commits earlier.
         *
         * The standing is sent with the session because the banner and the
         * enrolment-only screen both need it. `blocked` rarely reaches here —
         * the gate refuses the request that would return it — but it is in the
         * type because this route stays reachable while blocked *by design*, so
         * the interface can find out why it is stuck.
         */
        hasSecondFactor: standing.facts.hasSecondFactor,
        secondFactorStanding: standing.standing,
        mentionsWhen: user?.mentions_when ?? 'immediately',
        assignmentsWhen: user?.assignments_when ?? 'immediately',
        repliesWhen: user?.replies_when ?? 'off',
        activityDigest: user?.activity_digest ?? 'off',
        digestScope: user?.digest_scope ?? 'all',
        /*
         * Light or dark, as *this person* answered it (ADR-0124).
         *
         * Null is a state and not a missing value: it means "as the workspace
         * says", which is a different answer from `system` — that one is the
         * choice to let the device decide, and it overrides a workspace.
         *
         * Sent with the session because the interface paints the whole screen
         * from it, and a second request would be a second moment at which the
         * colours could change under somebody.
         */
        colorScheme: user?.color_scheme ?? null,
      },
      /*
       * Named, not passed through (ADR-0102).
       *
       * The rows went out as they came back, so the reply carried
       * `default_locale` in snake case and the client type had to match the
       * database's spelling. Three of the four columns added here are new, and
       * a listing where some fields are named one way and some another is a
       * listing every caller reads twice.
       *
       * `defaultLocale` is added rather than substituted: the old spelling is
       * what the browser reads today, and renaming it is a client change with
       * nothing to do with an enum column.
       */
      workspaces: workspaces.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        roleName: row.role_name,
        rights: row.rights,
        isOwner: row.is_owner,
        default_locale: row.default_locale,
        defaultLocale: row.default_locale,
        icon: row.icon ?? null,
      })),
    });
  });

  router.get('/api/auth/sessions', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const sessions = await listSessions(deps.pool, auth.userId, auth.sessionId);
    ctx.send(200, { sessions });
  });

  router.delete('/api/auth/sessions/:id', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const target = ctx.params['id'] ?? '';
    // Only your own sessions, and the check is a scoped delete rather than a
    // read-then-write so there is no window between them.
    const result = await deps.pool.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [target, auth.userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      ctx.fail(404, 'session_not_found');
      return;
    }
    if (target === auth.sessionId) clearSessionCookie(ctx, deps.secureCookies);
    ctx.sendEmpty(204);
  });

  router.post('/api/auth/password', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const body = await readBody<{ currentPassword?: string; newPassword?: string }>(ctx);
    if (!body) return;
    if (!body.currentPassword || !body.newPassword) {
      ctx.fail(422, 'missing_fields');
      return;
    }

    try {
      // Keeps this session alive and revokes the others (ADR-0010).
      await changePassword(
        deps.pool,
        auth.userId,
        body.currentPassword,
        body.newPassword,
        auth.sessionId,
      );
      ctx.sendEmpty(204);
    } catch (err) {
      if (err instanceof AuthError) ctx.fail(statusFor(err), err.code);
      else throw err;
    }
  });

  /**
   * Ask for a reset link (ADR-0059).
   *
   * **The same answer for every input**, always 200 with the same body. Whether
   * the address has an account, whether it signs in through a provider,
   * whether a mail actually went out — all of it is the caller's business and
   * none of it is the internet's. An honest "no such account" turns a list of
   * email addresses into a list of this instance's members.
   *
   * Rate limited on the mechanism sign-in already uses, keyed by address: two
   * limiters are two answers to "is this too many" and they drift.
   */
  /**
   * The second step of signing in (ADR-0063).
   *
   * The ticket proves a password was accepted a moment ago; it grants nothing
   * on its own. A wrong code here is rate limited on the same mechanism as the
   * password, keyed by account, so a stolen password plus a code generator gets
   * ten tries rather than unlimited ones.
   */
  router.post('/api/auth/login/second', async (ctx) => {
    const body = await readBody<{ ticket?: string; code?: string }>(ctx);
    if (!body) return;

    const userId = readTicket(body.ticket ?? '', deps.secretKey);
    if (!userId) {
      // Expired or forged: the same answer, because there is nothing useful to
      // tell either one.
      ctx.fail(401, 'ticket_expired');
      return;
    }

    const rateKey = `second:${userId}`;
    if ((await recentFailures(deps.pool, rateKey)) >= LOGIN_ATTEMPT_LIMIT) {
      ctx.fail(429, 'rate_limited');
      return;
    }

    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await checkSecondFactor(client, userId, body.code ?? '', deps.secretKey);
      await client.query('COMMIT');

      if (!found.ok) {
        await recordAttempt(deps.pool, rateKey, false, ipPrefix(ctx));
        ctx.fail(401, found.reason === 'replayed' ? 'code_already_used' : 'wrong_code');
        return;
      }

      const session = await createSession(deps.pool, userId, {
        userAgent: ctx.req.headers['user-agent'] ?? null,
        ipPrefix: ipPrefix(ctx),
      });
      // The other sign-in path, and the same note (ADR-0130). Here rather than
      // inside `createSession`, because a session is also made by registering
      // and by accepting an invitation — where "a browser you have not used"
      // is every browser and the letter would be noise.
      await deps
        .noteSignIn?.(userId, {
          userAgent: ctx.req.headers['user-agent'] ?? null,
          ipPrefix: ipPrefix(ctx),
        })
        .catch(() => undefined);
      setSessionCookie(ctx, session.token, deps.secureCookies);
      ctx.send(200, {
        // So somebody who has just spent their ninth code hears about it.
        ...(found.usedRecovery ? { usedRecovery: true } : {}),
        recoveryCodesLeft: await recoveryCodesLeft(deps.pool, userId),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /** Begin enrolling. The secret is shown here and stored pending. */
  router.post('/api/auth/second-factor/start', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;

    const started = await startEnrolment(
      deps.pool,
      auth.userId,
      auth.email ?? auth.userId,
      await deps.instanceName(),
      deps.secretKey,
    );
    if (!started) {
      // One is already confirmed. Replacing it silently would disarm the
      // account for anybody holding a session (ADR-0063).
      ctx.fail(409, 'already_enrolled');
      return;
    }
    ctx.send(200, started);
  });

  /** Finish enrolling by proving a code, and hand over the recovery codes. */
  router.post('/api/auth/second-factor/confirm', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const body = await readBody<{ code?: string }>(ctx);
    if (!body) return;

    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const done = await confirmEnrolment(
        client,
        auth.userId,
        body.code ?? '',
        deps.secretKey,
      );
      await client.query('COMMIT');

      if (!done.ok) {
        ctx.fail(422, done.reason);
        return;
      }
      // Once, and never again: they are stored hashed, so the server could not
      // show them a second time even if somebody asked.
      ctx.send(200, { recoveryCodes: done.recoveryCodes });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * Turn it off, which needs the password (ADR-0063).
   *
   * An open laptop must not be enough to remove somebody's second factor —
   * that is the exact situation it exists for.
   */
  router.post('/api/auth/second-factor/remove', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const body = await readBody<{ password?: string }>(ctx);
    if (!body) return;

    const row = await queryOne<{ password_hash: string | null }>(
      deps.pool,
      `SELECT password_hash FROM users WHERE id = $1`,
      [auth.userId],
    );
    const check = row?.password_hash
      ? await verifyPassword(body.password ?? '', row.password_hash)
      : { valid: false, needsRehash: false };
    if (!check.valid) {
      ctx.fail(403, 'wrong_password');
      return;
    }

    await removeSecondFactor(deps.pool, auth.userId);
    ctx.sendEmpty(204);
  });

  router.post('/api/auth/reset/request', async (ctx) => {
    let body: { email?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 320) : '';

    /*
     * Answered before anything else, and identically.
     *
     * `sent: true` is not a claim that a mail was sent — it is the sentence the
     * screen shows, and it is the same sentence in every case. Naming the field
     * `sent` would have been a small lie in a JSON key, which is why it is not
     * called that.
     */
    const answer = (): void => ctx.send(200, { asked: true });

    if (email === '' || !(await deps.canSendMail())) {
      // No relay means the feature is absent, and the sign-in screen does not
      // offer it — but a request that arrives anyway is answered the same way
      // rather than explaining the instance's configuration to a stranger.
      answer();
      return;
    }

    const rateKey = `reset:${email.toLowerCase()}`;
    if ((await recentFailures(deps.pool, rateKey)) >= LOGIN_ATTEMPT_LIMIT) {
      // Still the same answer: a rate limit that only appears for real
      // addresses is an oracle with a delay.
      answer();
      return;
    }
    await recordAttempt(deps.pool, rateKey, false, null);

    const issued = await issueReset(deps.pool, email);
    if (issued) {
      try {
        /*
         * The form answered identically above; the mail may differ (ADR-0059).
         *
         * A mail reaches only somebody who controls that mailbox, so it is a
         * private channel: telling them their account signs in through a
         * provider costs nothing there, where saying it on screen would tell a
         * stranger which addresses have accounts and of what kind.
         *
         * Without this they got silence — protected into waiting for a mail
         * that was never coming.
         */
        if ('kind' in issued) await deps.sendProviderMail(issued.email);
        else await deps.sendResetMail(issued.email, issued.token, issued.expiresAt);
      } catch {
        // Logged by the mail path; not reported here, because the report would
        // differ from the one an unknown address gets.
      }
    }
    answer();
  });

  /**
   * Set a new password with a link (ADR-0059).
   *
   * This one *does* distinguish its refusals, and that is not a contradiction:
   * whoever holds a token already knows the account exists. What they learn
   * here — expired, already used, password too short — is about the link in
   * their hand, and hiding it would only mean somebody retyping a good password
   * against a dead link.
   */
  router.post('/api/auth/reset', async (ctx) => {
    let body: { token?: unknown; password?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (token === '' || password === '') {
      ctx.fail(422, 'unknown_link');
      return;
    }

    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const outcome = await redeemReset(client, token, password);
      await client.query('COMMIT');

      if (!outcome.ok) {
        ctx.fail(422, outcome.reason);
        return;
      }
      // No session: a link in an inbox that signs somebody in is a link in an
      // inbox that signs somebody in. The screen sends them to sign in.
      ctx.send(200, { reset: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  router.patch('/api/auth/profile', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const body = await readBody<{
      displayName?: string;
      locale?: string | null;
      timezone?: string | null;
      /*
       * Whether to be emailed, per kind (ADR-0058).
       *
       * On this route rather than one of their own: they are three fields of a
       * person's own account, like the locale beside them, and a second route
       * would be a second place to authorise the same thing.
       *
       * `coalesce` means absent leaves the value alone, which is what makes it
       * safe for the appearance screen to patch a locale without carrying
       * somebody's mail preferences along.
       */
      /**
       * When each kind is worth a mail (ADR-0061, amended).
       *
       * One answer per kind, replacing the tick plus the separate schedule:
       * "at once when mentioned, the rest tomorrow" was unsayable before.
       */
      mentionsWhen?: 'immediately' | 'daily' | 'off';
      assignmentsWhen?: 'immediately' | 'daily' | 'off';
      repliesWhen?: 'immediately' | 'daily' | 'off';
      /** A mail about what changed, off unless chosen (ADR-0062). */
      activityDigest?: 'off' | 'daily' | 'weekly';
      /** Everything visible, or only what is watched (ADR-0064). */
      digestScope?: 'all' | 'watched';
      /**
       * Light or dark, or null to follow the workspace (ADR-0124).
       *
       * The one field on this route with a **three-way**: absent, null, and a
       * value are three different requests. `coalesce` cannot express that, so
       * the two nullable fields are handled below with a sentinel.
       */
      colorScheme?: 'light' | 'dark' | 'system' | null;
    }>(ctx);
    if (!body) return;

    /*
     * Refused rather than stored, because the column has a CHECK on it: an
     * unchecked write would be a 500 where this is a plain refusal, which is
     * the rule the notification schedules already follow.
     */
    if (
      'colorScheme' in body &&
      body.colorScheme !== null &&
      !['light', 'dark', 'system'].includes(body.colorScheme ?? '')
    ) {
      ctx.fail(422, 'invalid_color_scheme');
      return;
    }

    /*
     * Absent, null, and a value are three requests; `coalesce` knows two.
     *
     * Every field here is `coalesce($n, column)`, where absent and null are the
     * same thing — which is right for a field that cannot be unset and wrong
     * for one that can. The locale has been wrong since it was written: the
     * appearance screen sends `locale: null` for "match my browser", and the
     * old value survived it, so somebody who once chose German could never get
     * back to following their browser. ADR-0041 is explicit that absence is a
     * meaningful state there.
     *
     * A sentinel rather than a second UPDATE or a built statement: `''` is not
     * a value either column may hold — the locale has a format CHECK and the
     * scheme has a list — so "leave it alone" has a representation that cannot
     * collide with a real one.
     */
    /** The new value, or `''` for "none given" — which absent and null both are. */
    const given = (key: 'locale' | 'colorScheme'): string => {
      const value = body[key];
      return typeof value === 'string' ? value : '';
    };
    /** Whether the caller asked for it to be cleared, rather than saying nothing. */
    const cleared = (key: 'locale' | 'colorScheme'): boolean =>
      key in body && body[key] === null;

    await deps.pool.query(
      `UPDATE users
          SET display_name = coalesce($2, display_name),
              -- Three-way (ADR-0124): $10 says "clear it", $3 empty says
              -- "leave it", anything else is the new value.
              locale = CASE WHEN $10 THEN NULL ELSE coalesce(nullif($3, ''), locale) END,
              timezone = coalesce($4, timezone),
              -- Checked against the three it may be rather than trusted: the
              -- column has a CHECK, and a rejected write there would be a 500
              -- where this is a quiet no-op (ADR-0061).
              mentions_when = coalesce($5, mentions_when),
              assignments_when = coalesce($6, assignments_when),
              replies_when = coalesce($7, replies_when),
              activity_digest = coalesce($8, activity_digest),
              digest_scope = coalesce($9, digest_scope),
              color_scheme =
                CASE WHEN $11 THEN NULL ELSE coalesce(nullif($12, ''), color_scheme) END
        WHERE id = $1`,
      [
        auth.userId,
        body.displayName?.trim().slice(0, 128) || null,
        given('locale'),
        body.timezone ?? null,
        when(body.mentionsWhen),
        when(body.assignmentsWhen),
        when(body.repliesWhen),
        body.activityDigest === 'off' ||
        body.activityDigest === 'daily' ||
        body.activityDigest === 'weekly'
          ? body.activityDigest
          : null,
        body.digestScope === 'all' || body.digestScope === 'watched'
          ? body.digestScope
          : null,
        cleared('locale'),
        cleared('colorScheme'),
        given('colorScheme'),
      ],
    );
    ctx.sendEmpty(204);
  });
}

/**
 * Claims for a request that either credential may carry.
 *
 * A member's session cookie **or** a share link's cookie. `claimsFor` below
 * reads only the first, which is right for a workspace route and wrong for
 * anything a link's visitor may also reach — files were the first such route,
 * and comments are the second.
 *
 * It lived privately in `files/routes.ts`. Here now, because the second copy is
 * where the two stop agreeing about who somebody is (ADR-0086), and because
 * this is a question about credentials, which is what this file is.
 *
 * The three answers are distinguished on purpose, and a first version of the
 * files route collapsed them. **No credential** earns 401, which tells a
 * signed-out browser to authenticate. **A credential that does not grant this**
 * earns 404, which does not confirm that the thing exists.
 */
export async function claimsForRequest(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<
  | { kind: 'ok'; claims: AccessClaims }
  /** Nothing was presented: the caller should sign in, or open the link. */
  | { kind: 'anonymous' }
  /** Something was presented and it does not grant this. */
  | { kind: 'rejected' }
> {
  const sessionToken = sessionTokenFrom(ctx);
  const shareToken = shareTokenFrom(ctx);

  if (!sessionToken && !shareToken) return { kind: 'anonymous' };

  if (sessionToken) {
    const claims = await resolveSessionClaims(pool, sessionToken, workspaceId);
    // Tried first: somebody signed in who also opened a share link should be
    // judged by their own rights, which may be greater than the link's and are
    // never lesser.
    if (claims) return { kind: 'ok', claims };
  }

  if (shareToken) {
    // Not a visit: this is a picture loading or a comment being posted, and it
    // cannot say which visitor it belongs to. See `track` for what tracking it
    // anyway cost.
    /*
     * Signed in, but not into this workspace — which a link with
     * `allow_anonymous: false` still admits (ADR-0101). The session was tried
     * first above and gave nothing here; that it exists at all is the fact this
     * link asks for.
     */
    const resolved = await resolveShareTokenClaims(pool, shareToken, {
      track: false,
      signedIn: Boolean(sessionToken),
    });
    // A link needing a password is not authenticated by the cookie alone. The
    // sync connection handles unlocking; an ordinary request is not the place to.
    // Neither a password nor an account still owing: both are "this link has
    // not admitted anybody yet" (ADR-0101).
    if (resolved && !resolved.passwordRequired && !resolved.signInRequired) {
      if (resolved.claims.workspaceId === workspaceId) {
        return { kind: 'ok', claims: resolved.claims };
      }
    }
  }

  return { kind: 'rejected' };
}

/**
 * The caller's claims for a workspace, or an answered request and null.
 *
 * A **member's** claims: this reads the session cookie only. A route a share
 * link may also reach wants `claimsForRequest` above.
 *
 * Moved here from `http/pages.ts`, where it was a local function, when a second
 * route needed it (ADR-0054's collection list). Here rather than in
 * `auth/claims.ts`, which is where I put it first by going on the file's name:
 * `claimsOrNull` and `sessionTokenFrom` are both in *this* file, and a helper
 * belongs beside the two functions it is made of.
 *
 * The two failures are distinguished on purpose. No session at all is 401, so a
 * client knows to sign in; a session without access to *this* workspace is 403,
 * because signing in again will not help.
 */
export async function claimsFor(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
): Promise<Claims | null> {
  if (!sessionTokenFrom(ctx)) {
    ctx.fail(401, 'not_authenticated');
    return null;
  }
  const claims = await claimsOrNull(pool, ctx, workspaceId);
  if (!claims) {
    ctx.fail(403, 'not_authorized');
    return null;
  }
  return claims;
}
