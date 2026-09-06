/**
 * SONE server — letters about something that did not happen (ADR-0129).
 *
 * Three of the six mails proposed beside ADR-0121, and the three that have no
 * moment to hang on:
 *
 *   an invitation nobody redeemed        — to whoever sent it
 *   a guest link about to expire         — to whoever made it
 *   a run of mail that did not go out    — to the instance's administrators
 *
 * ## The difficulty is remembering
 *
 * Each of these is true for days at a stretch, and the maintenance job comes
 * round every five minutes. Without a memory, "an invitation nobody redeemed
 * after three days" is a letter every five minutes for as long as nobody
 * redeems it.
 *
 * So each reminder is **claimed before it is sent**: the row goes into
 * `reminders` first, and the letter goes out only if the insert was the one
 * that won. A send that then fails is not retried, which is the right way
 * round — at most once beats possibly for ever, and what is missed is a
 * reminder rather than the thing it is about.
 *
 * The exception is an instance with **no relay at all** (ADR-0059): nothing is
 * claimed there, because marking every reminder as sent while sending none
 * would mean configuring mail a week later delivers silence.
 *
 * ## Who and where, never what (ADR-0058)
 *
 * Unchanged. An address that was invited is not content; a page's title is, so
 * the link reminder names the page only where the instance allows a title to
 * leave at all.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import type { Letter } from './letter.js';

export interface ReminderDeps {
  pool: Pool;
  baseUrl: string;
  instanceName: () => Promise<string>;
  /** How much a mail may name (ADR-0058). Absent is the cautious answer. */
  emailDetail?: () => Promise<'title' | 'workspace'>;
  /**
   * Whether this instance has a relay at all (ADR-0059).
   *
   * Asked separately from `sendLetter`, and this is not belt-and-braces: the
   * wiring in `main.ts` always *has* a sender, and that sender quietly does
   * nothing when there is no relay. Without this check every reminder would be
   * claimed while none was sent, and configuring mail a week later would
   * deliver silence — which is the one thing claiming-before-sending must not
   * cost.
   */
  canSendMail?: () => Promise<boolean>;
  /** Absent means no relay, and then nothing is sent and nothing is claimed. */
  sendLetter?: (to: string, letter: Letter) => Promise<void>;
}

/** How long an invitation may sit unredeemed before its sender is reminded. */
export const CHASE_AFTER_DAYS = 3;
/** How near an expiry has to be before the person who made the link hears. */
export const WARN_WITHIN_DAYS = 7;

export interface ReminderReport {
  invitations: number;
  links: number;
  outages: number;
}

/**
 * Claim one reminder.
 *
 * Returns false if somebody — an earlier pass, or another instance running the
 * same maintenance — already has it. `ON CONFLICT DO NOTHING` makes that one
 * statement rather than a read and a write with a gap in the middle.
 */
async function claim(pool: Pool, kind: string, subjectId: string): Promise<boolean> {
  const row = await queryOne<{ subject_id: string }>(
    pool,
    `INSERT INTO reminders (kind, subject_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING subject_id`,
    [kind, subjectId],
  );
  return row !== null;
}

const day = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * One pass over all three.
 *
 * Independently guarded by its caller, like every other maintenance task: one
 * of these failing must not stop the others, because the whole point is that
 * they run unattended.
 */
export async function sendReminders(deps: ReminderDeps): Promise<ReminderReport> {
  const report: ReminderReport = { invitations: 0, links: 0, outages: 0 };
  // No relay, nothing to do, and nothing claimed. See the note above.
  if (!deps.sendLetter) return report;
  if (deps.canSendMail && !(await deps.canSendMail())) return report;

  const instance = await deps.instanceName();
  const detail = (await deps.emailDetail?.()) ?? 'workspace';

  report.invitations = await chaseInvitations(deps, instance);
  report.links = await warnAboutLinks(deps, instance, detail);
  report.outages = await reportOutage(deps, instance);
  return report;
}

/**
 * An invitation nobody redeemed.
 *
 * To the **inviter** and not the invited. Somebody who never signed up did not
 * ask to hear from this instance twice, and the person who can do something —
 * resend it, or ask in the corridor — is the one who sent it.
 */
async function chaseInvitations(deps: ReminderDeps, instance: string): Promise<number> {
  const rows = await queryRows<{
    id: string;
    email: string | null;
    workspace: string;
    inviter: string;
    inviter_name: string;
  }>(
    deps.pool,
    `SELECT i.id, i.email, w.name AS workspace,
            u.email AS inviter, u.display_name AS inviter_name
       FROM invitations i
       JOIN workspaces w ON w.id = i.workspace_id
       JOIN users u ON u.id = i.invited_by
      WHERE i.uses = 0
        AND i.revoked_at IS NULL
        AND i.expires_at > now()
        AND i.created_at < now() - ($1 || ' days')::interval
        AND u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM reminders r
           WHERE r.kind = 'invitation_unredeemed' AND r.subject_id = i.id
        )
      LIMIT 200`,
    [String(CHASE_AFTER_DAYS)],
  );

  let sent = 0;
  for (const row of rows) {
    if (!(await claim(deps.pool, 'invitation_unredeemed', row.id))) continue;
    await deps
      .sendLetter!(row.inviter, {
        subject: `${instance}: an invitation is still waiting`,
        heading: 'Nobody has used this invitation yet.',
        lines: [
          {
            text: row.email
              ? `You invited ${row.email} to ${row.workspace} ${CHASE_AFTER_DAYS} days ago.`
              : `You made an invitation link for ${row.workspace} ${CHASE_AFTER_DAYS} days ago.`,
          },
          { text: 'It still works. Send it again, or withdraw it if it was a mistake.' },
        ],
        action: { label: 'Open the invitations', url: deps.baseUrl },
        baseUrl: deps.baseUrl,
        locale: 'en',
      })
      .catch(() => undefined);
    sent += 1;
  }
  return sent;
}

/**
 * A link about to stop working.
 *
 * Worth having only since ADR-0126, and worth having *because* of it: links
 * expire by default now, so the failure this prevents — a client who cannot
 * open the page they were sent last month — is one that can actually happen.
 */
async function warnAboutLinks(
  deps: ReminderDeps,
  instance: string,
  detail: 'title' | 'workspace',
): Promise<number> {
  const rows = await queryRows<{
    id: string;
    expires_at: Date;
    title: string;
    workspace: string;
    owner: string;
  }>(
    deps.pool,
    // `expires_at IS NOT NULL` is the hole this query would otherwise have: a
    // link that never expires is not a date in the past and not one in the
    // future either.
    `SELECT t.id, t.expires_at, p.title, w.name AS workspace, u.email AS owner
       FROM share_tokens t
       JOIN pages p ON p.id = t.scope_page_id
       JOIN workspaces w ON w.id = t.workspace_id
       JOIN users u ON u.id = t.created_by
      WHERE t.revoked_at IS NULL
        AND t.expires_at IS NOT NULL
        AND t.expires_at > now()
        AND t.expires_at < now() + ($1 || ' days')::interval
        AND u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM reminders r
           WHERE r.kind = 'share_link_expiring' AND r.subject_id = t.id
        )
      LIMIT 200`,
    [String(WARN_WITHIN_DAYS)],
  );

  let sent = 0;
  for (const row of rows) {
    if (!(await claim(deps.pool, 'share_link_expiring', row.id))) continue;
    const where = detail === 'title' ? row.title || 'a page' : row.workspace;
    await deps
      .sendLetter!(row.owner, {
        subject: `${instance}: a link you shared expires soon`,
        heading: `A link to ${where} stops working on ${day(row.expires_at)}.`,
        lines: [
          { text: 'Whoever you sent it to will not be able to open it after that.' },
          { text: 'Make a new one if they still need it, or let it lapse.' },
        ],
        action: { label: 'Open SONE', url: deps.baseUrl },
        baseUrl: deps.baseUrl,
        locale: 'en',
      })
      .catch(() => undefined);
    sent += 1;
  }
  return sent;
}

/**
 * A run of mail that did not go out.
 *
 * **A broken relay cannot send the mail that says the relay is broken.** So
 * this is not a warning: it is a report of a window that has closed, sent by
 * the relay that has started working again — which is the only moment at which
 * it can be sent at all.
 *
 * What covers the *current* outage is the number on the administration screen,
 * which needs no relay to be true. This adds the part that screen cannot: the
 * operator is told without having to be looking.
 *
 * Keyed on the newest failure it covers, so a later outage is a different
 * subject rather than the same one again.
 */
async function reportOutage(deps: ReminderDeps, instance: string): Promise<number> {
  /*
   * The newest failure, by when it failed — not `max(id)`.
   *
   * A uuid is random, so the largest one is not the latest one: the first
   * version keyed the subject on `max(id::text)`, and a second outage whose
   * job happened to sort lower than the first was silently treated as the same
   * window and never reported. Found by the test for exactly that case, which
   * passed and failed depending on the ids the run generated.
   */
  const window = await queryOne<{ newest: string; n: number; since: Date }>(
    deps.pool,
    `SELECT (SELECT id FROM jobs
              WHERE kind = 'email_notifications' AND state = 'failed'
              ORDER BY finished_at DESC NULLS LAST, id DESC
              LIMIT 1)::text AS newest,
            count(*)::int AS n,
            min(finished_at) AS since
       FROM jobs
      WHERE kind = 'email_notifications' AND state = 'failed'`,
  );
  if (!window?.newest || window.n === 0) return 0;
  if (!(await claim(deps.pool, 'mail_outage', window.newest))) return 0;

  const admins = await queryRows<{ email: string }>(
    deps.pool,
    // Instance administrators, because a relay is an instance-wide thing and a
    // workspace owner can do nothing about an SMTP password.
    `SELECT email FROM users
      WHERE is_instance_admin AND deactivated_at IS NULL AND email IS NOT NULL`,
  );

  for (const admin of admins) {
    await deps
      .sendLetter!(admin.email, {
        subject: `${instance}: ${window.n} notifications did not go out`,
        heading: 'Some mail from this instance failed to send.',
        lines: [
          {
            text:
              `${window.n} notification${window.n === 1 ? '' : 's'} failed since ` +
              `${day(window.since)}. This message arrived, so the relay is answering now.`,
          },
          // The mails themselves are gone: a notification is about something
          // that has already happened, and re-sending a week-old one is worse
          // than not sending it.
          { text: 'The failed ones are not resent. Check the relay settings.' },
        ],
        action: { label: 'Open the administration', url: deps.baseUrl },
        baseUrl: deps.baseUrl,
        locale: 'en',
      })
      .catch(() => undefined);
  }
  return admins.length;
}
