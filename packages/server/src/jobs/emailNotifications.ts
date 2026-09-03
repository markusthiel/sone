/**
 * SONE server — turning waiting notifications into one mail each (ADR-0058).
 *
 * Two halves, and the seam between them is a decision the record did not make.
 *
 * The sweep finds people with notifications that are old enough, unread and not
 * yet claimed, and enqueues one job per person per workspace. The job composes
 * and sends. The queue owns the retries, because `jobs.attempts` exists for
 * exactly that and a sweep of its own would retry a permanently rejected
 * address for ever.
 *
 * **`emailed_at` therefore means "claimed for mail", not "delivered".** It is
 * set when the job is enqueued, not when the relay accepts. That is the
 * uncomfortable half of the choice and it is the right way round: the
 * alternative is a sweep that re-enqueues the same batch every minute while a
 * relay is misconfigured, which turns one wrong setting into an unbounded
 * queue. A send that fails after its retries is a failed job an administrator
 * can see, and the person is told in the inbox — which is the primary channel
 * anyway.
 */

import { composeNotificationEmail, type Waiting } from '../mail/compose.js';
import { sendMail, type Relay } from '../mail/send.js';
import { queryRows } from '../db/pool.js';
import { enqueue, type JobHandler } from './runner.js';
import type { Pool } from 'pg';

export const EMAIL_NOTIFICATIONS = 'email_notifications';

/** How long a notification waits before it is worth a mail. */
export const EMAIL_DELAY_MINUTES = Number(process.env['SONE_EMAIL_DELAY_MINUTES'] ?? 5);

export interface MailSettings {
  relay: Relay | null;
  detail: 'title' | 'workspace';
  baseUrl: string;
}

interface Candidate {
  user_id: string;
  workspace_id: string;
  ids: string[];
}

/**
 * Find who has mail waiting, and claim it.
 *
 * One statement: the select and the claim have to be atomic or two ticks
 * overlapping would each enqueue the same batch. `FOR UPDATE SKIP LOCKED` is
 * what makes a second sweep running concurrently pass over rows the first has
 * taken rather than waiting for them.
 *
 * The per-person preference is applied here rather than when the notification
 * is written: somebody who turns mail off should stop receiving it for things
 * that were already waiting, and a preference read at write time would have
 * decided their next week.
 */
export async function claimForEmail(pool: Pool): Promise<Candidate[]> {
  return queryRows<Candidate>(
    pool,
    `WITH ready AS (
       SELECT n.id, n.user_id, n.workspace_id
         FROM notifications n
         JOIN users u ON u.id = n.user_id
        WHERE n.emailed_at IS NULL
          AND n.read_at IS NULL
          AND n.created_at < now() - ($1 || ' minutes')::interval
          -- Deactivated accounts and accounts with no address get no mail, and
          -- neither does a kind somebody has turned off.
          AND u.email IS NOT NULL
          AND u.deactivated_at IS NULL
          AND CASE n.kind
                WHEN 'mention' THEN u.email_mentions
                WHEN 'assignment' THEN u.email_assignments
                ELSE u.email_replies
              END
        ORDER BY n.created_at
        FOR UPDATE OF n SKIP LOCKED
     ), claimed AS (
       UPDATE notifications SET emailed_at = now()
        WHERE id IN (SELECT id FROM ready)
       RETURNING id, user_id, workspace_id
     )
     SELECT user_id, workspace_id, array_agg(id::text) AS ids
       FROM claimed
      GROUP BY user_id, workspace_id`,
    [String(EMAIL_DELAY_MINUTES)],
  );
}

/**
 * The sweep, run on the same timer as the job runner.
 *
 * Does nothing at all without a relay: no claim, no job, no queue filling up.
 * An instance without SMTP settings is a normal instance (ADR-0058).
 */
export async function sweepForEmail(pool: Pool, settings: MailSettings): Promise<number> {
  if (!settings.relay) return 0;

  const batches = await claimForEmail(pool);
  for (const batch of batches) {
    await enqueue(pool, {
      workspaceId: batch.workspace_id,
      kind: EMAIL_NOTIFICATIONS,
      payload: { userId: batch.user_id, notificationIds: batch.ids },
      // Nobody asked for it: this job exists because a notification aged, not
      // because a person pressed something.
      createdBy: null,
    });
  }
  return batches.length;
}

/**
 * The handler holds the pool itself.
 *
 * `JobContext` offers only `report` — a job says what is happening, it does not
 * get a database. I wrote this against a context with a pool on it, which is
 * the shape I assumed rather than the one that exists.
 */
export function emailNotificationsHandler(pool: Pool, settings: MailSettings): JobHandler {
  return async (job) => {
    if (!settings.relay) return { result: { skipped: 'no relay configured' } };

    const payload = job.payload as { userId?: unknown; notificationIds?: unknown };
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    const ids = Array.isArray(payload.notificationIds)
      ? payload.notificationIds.filter((one): one is string => typeof one === 'string')
      : [];
    if (!userId || ids.length === 0) return { result: { skipped: 'nothing to send' } };

    /*
     * Read the rows back rather than trusting the payload.
     *
     * The job may run a minute after the sweep, and a page's title can have
     * changed — but more importantly a notification whose page has since been
     * deleted must not produce a mail pointing at a page that is gone.
     */
    const rows = await queryRows<{
      kind: string;
      page_title: string;
      page_id: string;
      workspace_name: string;
      email: string;
      locale: string | null;
    }>(
      pool,
      `SELECT n.kind,
              coalesce(p.title, '') AS page_title,
              n.page_id::text AS page_id,
              w.name AS workspace_name,
              u.email,
              u.locale
         FROM notifications n
         JOIN pages p ON p.id = n.page_id AND p.archived_at IS NULL
         JOIN workspaces w ON w.id = n.workspace_id
         JOIN users u ON u.id = n.user_id
        WHERE n.id = ANY($1::uuid[]) AND n.user_id = $2
        ORDER BY n.created_at`,
      [ids, userId],
    );

    if (rows.length === 0) return { result: { skipped: 'nothing left to send' } };

    const waiting: Waiting[] = rows.map((row) => ({
      kind: row.kind === 'assignment' ? 'assignment' : row.kind === 'reply' ? 'reply' : 'mention',
      pageTitle: row.page_title,
      pageId: row.page_id,
      /*
       * Null, because a notification does not record who caused it.
       *
       * Found by writing `LEFT JOIN users a ON a.id = n.actor_id` and watching
       * Postgres say the column does not exist. SQL is not typechecked, so this
       * would have shipped and failed on the first mail.
       */
      actor: null,
    }));

    const first = rows[0]!;
    const composed = composeNotificationEmail({
      waiting,
      workspaceName: first.workspace_name,
      detail: settings.detail,
      baseUrl: settings.baseUrl,
      locale: first.locale === 'de' ? 'de' : 'en',
    });
    if (!composed) return { result: { skipped: 'nothing to say' } };

    await sendMail(settings.relay, {
      to: first.email,
      subject: composed.subject,
      body: composed.body,
    });

    return { result: { sent: 1, notifications: rows.length } };
  };
}
