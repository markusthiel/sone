/**
 * SONE — switching notifications on for a device (ADR-0180).
 *
 * Three routes, and the shape of them is the feature: a browser asks for the
 * key it must subscribe against, hands back the endpoint the push service gave
 * it, and can hand it back again to stop.
 *
 * **Per device, not per account.** A subscription belongs to one browser on one
 * machine, which is what somebody means by "on this iPad" — and switching it off
 * on the iPad must not stop the phone.
 */

import type { Pool } from 'pg';

import { requireSession } from '../http/auth.js';
import type { Router } from '../http/router.js';
import { queryRows } from '../db/pool.js';
import { pushKeys } from './send.js';

export interface PushDeps {
  pool: Pool;
}

export function registerPushRoutes(router: Router, deps: PushDeps): void {
  /**
   * The key a browser subscribes against.
   *
   * Public by nature — it is handed to every push service — but behind a
   * session anyway: it is of no use to anybody without one, and an endpoint
   * that answers to nobody is an endpoint somebody has to think about.
   *
   * Asking for it is what makes the keypair, so an instance that never switches
   * this on never generates one.
   */
  router.get('/api/push/key', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;
    const keys = await pushKeys(deps.pool);
    ctx.send(200, { key: keys.publicKey });
  });

  /**
   * This device, from now on.
   *
   * The endpoint is the identity, so subscribing twice from one browser is one
   * row — a browser re-subscribes by itself when a push service rotates it, and
   * two rows would be two pushes for one notification.
   *
   * `ON CONFLICT … DO UPDATE` rather than `DO NOTHING`: the same endpoint
   * arriving for a *different* person is a machine somebody else has signed in
   * on, and the device belongs to whoever is at it now.
   */
  router.post('/api/push/subscriptions', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const body = await ctx.json<{ endpoint?: unknown }>();
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
    // Parsed rather than pattern-matched: what has to be true is that it is an
    // address this server can post to, and `URL` is the thing that knows.
    let audience: string;
    try {
      audience = new URL(endpoint).protocol;
    } catch {
      ctx.fail(422, 'invalid_endpoint');
      return;
    }
    if (audience !== 'https:') {
      ctx.fail(422, 'invalid_endpoint');
      return;
    }

    await deps.pool.query(
      `INSERT INTO push_subscriptions (endpoint, user_id) VALUES ($1, $2)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, failures = 0`,
      [endpoint, session.userId],
    );
    ctx.send(200, { ok: true });
  });

  /**
   * And no longer.
   *
   * Scoped to this person as well as to the endpoint: an endpoint is not a
   * secret worth guessing, but deleting a row on the strength of one alone
   * would let anybody with a session switch off somebody else's device.
   */
  router.post('/api/push/subscriptions/remove', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const body = await ctx.json<{ endpoint?: unknown }>();
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    if (endpoint === '') {
      ctx.fail(422, 'invalid_endpoint');
      return;
    }
    await deps.pool.query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
      [endpoint, session.userId],
    );
    ctx.send(200, { ok: true });
  });

  /**
   * Whether this device is switched on, as the server sees it.
   *
   * The browser knows its own subscription and could answer alone — but a
   * subscription the server has forgotten (a database restored from before it,
   * an endpoint deleted as gone) would then show as on and never arrive. The
   * server is the one that would be sending.
   */
  router.get('/api/push/subscriptions', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;
    const rows = await queryRows<{ endpoint: string }>(
      deps.pool,
      `SELECT endpoint FROM push_subscriptions WHERE user_id = $1`,
      [session.userId],
    );
    ctx.send(200, { endpoints: rows.map((row) => row.endpoint) });
  });
}
