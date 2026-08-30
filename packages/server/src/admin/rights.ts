/**
 * SONE server — who may administer workspaces.
 *
 * One question asked in several routes, answered here so it cannot be answered
 * two ways. `is_instance_admin` used to be the only question anything asked;
 * now there are two, and every place that checks has to mean one of them
 * (ADR-0027).
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne } from '../db/pool.js';
import type { RequestContext } from '../http/router.js';
import { requireSession } from '../http/auth.js';

export interface Administrator {
  userId: string;
  /** Accounts, single sign-on, maintenance. */
  instance: boolean;
  /** Every workspace's membership and settings. Implied by `instance`. */
  workspaces: boolean;
}

/**
 * What this person may administer.
 *
 * An instance administrator holds the workspace right implicitly rather than
 * having a row that says so. Two sources for one answer is two answers as soon
 * as one is updated and the other is not.
 */
export async function administratorRights(
  db: Pool | PoolClient,
  userId: string,
): Promise<Administrator> {
  const row = await queryOne<{
    is_instance_admin: boolean;
    can_manage_workspaces: boolean;
  }>(
    db,
    `SELECT is_instance_admin, can_manage_workspaces FROM users WHERE id = $1`,
    [userId],
  );

  const instance = row?.is_instance_admin === true;
  return {
    userId,
    instance,
    workspaces: instance || row?.can_manage_workspaces === true,
  };
}

/**
 * Require the right to administer workspaces, or answer and return null.
 *
 * Forbidden rather than not-found: unlike a single workspace, the existence of
 * the administration area is not a secret — refusing to say it exists would
 * only puzzle somebody who has no way to reach it anyway.
 */
export async function requireWorkspaceAdministrator(
  pool: Pool,
  ctx: RequestContext,
): Promise<Administrator | null> {
  const session = await requireSession(pool, ctx);
  if (!session) return null;

  const rights = await administratorRights(pool, session.userId);
  if (!rights.workspaces) {
    ctx.fail(403, 'forbidden');
    return null;
  }
  return rights;
}

/** The same, for the things only an instance administrator may touch. */
export async function requireInstanceAdministrator(
  pool: Pool,
  ctx: RequestContext,
): Promise<Administrator | null> {
  const session = await requireSession(pool, ctx);
  if (!session) return null;

  const rights = await administratorRights(pool, session.userId);
  if (!rights.instance) {
    ctx.fail(403, 'forbidden');
    return null;
  }
  return rights;
}
