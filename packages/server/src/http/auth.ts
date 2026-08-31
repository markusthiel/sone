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

import { AuthError } from '../auth/password.js';
import {
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
import { WORKSPACE_ORDER_SQL } from '../workspaces/order.js';
import { BodyError, type RequestContext, type Router } from './router.js';

export const SESSION_COOKIE = 'sone_session';

export interface AuthDeps {
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
  ctx.res.setHeader('set-cookie', attrs.join('; '));
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
  ctx.res.setHeader('set-cookie', attrs.join('; '));
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
  ctx.res.setHeader('set-cookie', attrs.join('; '));
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
      default_locale: string;
      icon: unknown;
    }>(
      deps.pool,
      `SELECT w.id, w.name, m.role, w.default_locale, w.icon
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
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

    const user = await queryOne<{
      locale: string | null;
      timezone: string | null;
      is_instance_admin: boolean;
      can_manage_workspaces: boolean;
    }>(
      deps.pool,
      // The rights come with the session, so the interface can hide a section
      // somebody cannot reach rather than showing it and failing on arrival
      // (ADR-0027).
      `SELECT locale, timezone, is_instance_admin, can_manage_workspaces
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
      },
      workspaces,
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

  router.patch('/api/auth/profile', async (ctx) => {
    const auth = await requireSession(deps.pool, ctx);
    if (!auth) return;
    const body = await readBody<{
      displayName?: string;
      locale?: string | null;
      timezone?: string | null;
    }>(ctx);
    if (!body) return;

    await deps.pool.query(
      `UPDATE users
          SET display_name = coalesce($2, display_name),
              locale = coalesce($3, locale),
              timezone = coalesce($4, timezone)
        WHERE id = $1`,
      [
        auth.userId,
        body.displayName?.trim().slice(0, 128) || null,
        body.locale ?? null,
        body.timezone ?? null,
      ],
    );
    ctx.sendEmpty(204);
  });
}
