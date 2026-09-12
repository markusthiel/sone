/**
 * SONE — the job that wakes devices (ADR-0180).
 *
 * ## Why a job and not a send on the spot
 *
 * The notification row is written inside the transaction that projects a page
 * (ADR-0008). Sending a push there would put four network requests to Apple
 * inside a database transaction, hold the row locks for as long as the slowest
 * of them, and roll the projection back if one failed.
 *
 * So the same transaction writes a job row instead — a second insert, no
 * network — and the runner sends. Which also means a push is retried exactly as
 * everything else is, and an instance whose push service is unreachable for an
 * hour does not stop projecting pages.
 */

import type { Pool, PoolClient } from 'pg';

import { enqueue, type Job, type JobHandler } from '../jobs/runner.js';
import { wake } from './send.js';

export const PUSH_WAKE = 'push-wake';

/**
 * Queue a wake for these people.
 *
 * Called with the same client the notification was written on, so the two
 * commit together: a push about a notification that was rolled back is a
 * notification somebody opens the application to find gone.
 *
 * Silent when nobody was actually notified — a page is reprojected on every
 * edit, and the insert that precedes this is `ON CONFLICT DO NOTHING`, so "who
 * was newly told" is already the honest list.
 */
export async function queueWake(
  db: Pool | PoolClient,
  workspaceId: string,
  userIds: readonly string[],
): Promise<void> {
  const people = [...new Set(userIds)].filter((one) => one !== '');
  if (people.length === 0) return;
  await enqueue(db, {
    kind: PUSH_WAKE,
    workspaceId,
    payload: { userIds: people },
    // Nobody asked for it in the sense the queue means: it follows from a
    // notification, and the person who caused it is not its owner.
    createdBy: null,
  });
}

/**
 * Send the wakes one job asks for.
 *
 * `contact` is this instance's own address, for the `sub` claim — read per run
 * rather than captured, so an operator who corrects the public URL does not
 * have to restart for the next push to name it right.
 */
export function pushWakeHandler(pool: Pool, contact: () => string): JobHandler {
  return async (job: Job) => {
    const payload = job.payload as { userIds?: unknown };
    const userIds = Array.isArray(payload.userIds)
      ? payload.userIds.filter((one): one is string => typeof one === 'string')
      : [];
    const sending = await wake(pool, userIds, contact());
    // Returned rather than logged: the queue keeps a result per job, and "three
    // sent, one endpoint gone" is what somebody debugging a silent phone wants
    // to find there.
    return { result: { ...sending, people: userIds.length } };
  };
}
