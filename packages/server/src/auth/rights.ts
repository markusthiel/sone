/**
 * SONE server — asking whether somebody may do a thing (ADR-0087).
 *
 * Until now the question was written out as `role === 'owner' || role ===
 * 'admin'`, in five files, for eight different things. That comparison is not a
 * check, it is a *guess* that the eight things belong together — and it means
 * granting somebody the ability to make a group also grants them the ability to
 * change everybody's role and rename the workspace.
 *
 * So each of them gets a name, and the name is what routes ask for.
 *
 * ## Two ways to hold a right
 *
 * The role, or the instance-wide right to administer workspaces (ADR-0027) —
 * which is how somebody looks after a workspace they are not in. That second
 * way arrived after the first, and ADR-0027 records what happened next: routes
 * that had been written before it silently did not honour it, including one
 * where the right worked only if you were *not* a member. Asked in one place
 * here for the same reason it was consolidated there.
 *
 * ## Refusals
 *
 * Not-found for somebody who is not in the workspace at all, forbidden for a
 * member who lacks the right. The difference is deliberate and is the
 * convention every administration route here already follows: "you may not
 * manage groups here" confirms that a workspace exists.
 */

import type { Right } from '@sone/core';
import type { Pool } from 'pg';

import { administratorRights } from '../admin/rights.js';
import { requireSession } from '../http/auth.js';
import type { RequestContext } from '../http/router.js';
import { loadWorkspaceStanding } from './standing.js';

/** Does this person hold this right in this workspace? No answering, no refusing. */
export async function holdsRight(
  pool: Pool,
  workspaceId: string,
  userId: string,
  right: Right,
): Promise<{ member: boolean; held: boolean }> {
  const standing = await loadWorkspaceStanding(pool, userId, workspaceId);
  if (standing.rights.has(right)) return { member: true, held: true };

  // The instance-wide way in, asked whatever the membership is. Fetching it
  // only when the membership is missing was a real bug: somebody who manages
  // workspaces *and happens to be an ordinary member of one* was refused,
  // while the same person could have acted by leaving the workspace first
  // (ADR-0067). A right that a membership takes away is not a right.
  const instance = await administratorRights(pool, userId);
  return { member: standing.isMember, held: instance.workspaces };
}

/**
 * Require a right, or answer and return null.
 *
 * Returns the user id so a caller does not repeat the session lookup, in the
 * shape `requireSession` already uses.
 */
export async function requireRight(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
  right: Right,
): Promise<string | null> {
  return requireAnyRight(pool, ctx, workspaceId, [right]);
}

/**
 * The same, for a route that two different rights both reach.
 *
 * There is exactly one so far and it is worth naming rather than generalising
 * from: **reading the list of roles**. You need it to define what a role means
 * (`roles.manage`) and you need it to give somebody one (`people.manage`), and
 * a list that only the first could read would leave the second with a picker
 * that has nothing in it — a control that is present, empty, and unexplained.
 *
 * Not "any member may read it": which roles a workspace has defined, and what
 * each one may do, is a description of how the place is run.
 */
export async function requireAnyRight(
  pool: Pool,
  ctx: RequestContext,
  workspaceId: string,
  rights: readonly Right[],
): Promise<string | null> {
  const session = await requireSession(pool, ctx);
  if (!session) return null;

  let member = false;
  for (const right of rights) {
    const answer = await holdsRight(pool, workspaceId, session.userId, right);
    if (answer.held) return session.userId;
    member = member || answer.member;
  }

  ctx.fail(member ? 403 : 404, member ? 'forbidden' : 'not_found');
  return null;
}
