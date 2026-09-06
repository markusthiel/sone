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
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n/locale.js';
import type { Letter } from './letter.js';
import { words, type AddressForm } from './words.js';

/**
 * The language a row's recipient reads (ADR-0133).
 *
 * Read in the same query as the address rather than by a second round trip per
 * reminder: these run in a loop of up to two hundred, unattended, and a query
 * each would be two hundred queries to answer a question that is one column.
 */
const localeOf = (value: string | null): SupportedLocale =>
  SUPPORTED_LOCALES.find((l) => l === (value ?? '').toLowerCase()) ?? FALLBACK_LOCALE;

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
  /**
   * How this instance addresses people (ADR-0133). One setting for everything
   * this server says, the interface included. Absent is the informal default.
   */
  addressForm?: () => Promise<AddressForm>;
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
  const address = (await deps.addressForm?.()) ?? 'informal';

  report.invitations = await chaseInvitations(deps, instance, address);
  report.links = await warnAboutLinks(deps, instance, detail, address);
  report.outages = await reportOutage(deps, instance, address);
  return report;
}

/**
 * An invitation nobody redeemed.
 *
 * To the **inviter** and not the invited. Somebody who never signed up did not
 * ask to hear from this instance twice, and the person who can do something —
 * resend it, or ask in the corridor — is the one who sent it.
 */
async function chaseInvitations(
  deps: ReminderDeps,
  instance: string,
  address: AddressForm,
): Promise<number> {
  const rows = await queryRows<{
    id: string;
    email: string | null;
    workspace: string;
    inviter: string;
    inviter_name: string;
    inviter_locale: string | null;
    workspace_locale: string | null;
  }>(
    deps.pool,
    // The inviter's own language, and the workspace's where they have not
    // chosen one — the order `recipientLocale` states, asked here in the join
    // that was already being made.
    `SELECT i.id, i.email, w.name AS workspace,
            u.email AS inviter, u.display_name AS inviter_name,
            u.locale AS inviter_locale, w.default_locale AS workspace_locale
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
    const locale = localeOf(row.inviter_locale ?? row.workspace_locale);
    const say = words(locale, address);
    await deps
      .sendLetter!(row.inviter, {
        subject: say('chase.subject', { where: instance }),
        heading: say('chase.heading'),
        lines: [
          {
            text: say(row.email ? 'chase.toAddress' : 'chase.asLink', {
              days: CHASE_AFTER_DAYS,
              who: row.email ?? '',
              workspace: row.workspace,
            }),
          },
          { text: say('chase.stillWorks') },
        ],
        action: { label: say('chase.action'), url: deps.baseUrl },
        baseUrl: deps.baseUrl,
        locale,
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
  address: AddressForm,
): Promise<number> {
  const rows = await queryRows<{
    id: string;
    expires_at: Date;
    title: string;
    workspace: string;
    owner: string;
    owner_locale: string | null;
    workspace_locale: string | null;
  }>(
    deps.pool,
    // `expires_at IS NOT NULL` is the hole this query would otherwise have: a
    // link that never expires is not a date in the past and not one in the
    // future either.
    `SELECT t.id, t.expires_at, p.title, w.name AS workspace, u.email AS owner,
            u.locale AS owner_locale, w.default_locale AS workspace_locale
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
    const locale = localeOf(row.owner_locale ?? row.workspace_locale);
    const say = words(locale, address);
    // A page with no title is named as a page rather than as an empty quotation
    // — and that phrase is itself a sentence, so it comes from the catalogue.
    const where = detail === 'title' ? row.title || say('link.somePage') : row.workspace;
    await deps
      .sendLetter!(row.owner, {
        subject: say('link.subject', { where: instance }),
        heading: say('link.heading', { what: where, when: day(row.expires_at) }),
        lines: [{ text: say('link.theyCannot') }, { text: say('link.makeNew') }],
        action: { label: say('link.action'), url: deps.baseUrl },
        baseUrl: deps.baseUrl,
        locale,
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
async function reportOutage(
  deps: ReminderDeps,
  instance: string,
  address: AddressForm,
): Promise<number> {
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

  const admins = await queryRows<{ email: string; locale: string | null }>(
    deps.pool,
    // Instance administrators, because a relay is an instance-wide thing and a
    // workspace owner can do nothing about an SMTP password.
    //
    // Each in their own language, resolved per row rather than once for the
    // loop: this is the one letter here with several recipients, and they need
    // not share a language just because they share a server.
    `SELECT email, locale FROM users
      WHERE is_instance_admin AND deactivated_at IS NULL AND email IS NOT NULL`,
  );

  for (const admin of admins) {
    // No workspace to fall back to: an outage belongs to the instance, and
    // there is no workspace whose language would be the better guess.
    const locale = localeOf(admin.locale);
    const say = words(locale, address);
    await deps
      .sendLetter!(admin.email, {
        subject: say('outage.subject', { where: instance, count: window.n }),
        heading: say('outage.heading'),
        lines: [
          { text: say('outage.window', { count: window.n, when: day(window.since) }) },
          { text: say('outage.notResent') },
        ],
        action: { label: say('outage.action'), url: deps.baseUrl },
        baseUrl: deps.baseUrl,
        locale,
      })
      .catch(() => undefined);
  }
  return admins.length;
}
