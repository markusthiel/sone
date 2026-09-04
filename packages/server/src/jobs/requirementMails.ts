/**
 * SONE server — telling people a second factor is coming (ADR-0065).
 *
 * **Two mails, not five.** One when the requirement is switched on and one
 * three days before the deadline. A feature that mails somebody daily about a
 * thing they intend to do at the weekend has taught them to filter it.
 *
 * Which of the two has been sent is recorded per account rather than inferred
 * from dates: a sweep that ran twice in an hour, or after a clock change, must
 * not send twice.
 */

import { queryRows } from '../db/pool.js';
import { GRACE_DAYS, WARN_DAYS_BEFORE } from '../auth/requirement.js';
import { sendMail, type Relay } from '../mail/send.js';
import type { Pool } from 'pg';

export interface RequirementMailDeps {
  pool: Pool;
  relay: Relay | null;
  baseUrl: string;
  required: boolean;
  since: string;
}

/**
 * Send whichever of the two mails is due.
 *
 * Only to accounts that actually need to act: no factor, and a password of
 * their own. A single sign-on account is exempt (ADR-0065) and mailing it would
 * be telling somebody to do something that does not apply to them.
 */
export async function sendRequirementMails(
  deps: RequirementMailDeps,
): Promise<{ announced: number; warned: number }> {
  if (!deps.required || !deps.relay) return { announced: 0, warned: 0 };

  const since = Date.parse(deps.since);
  if (!Number.isFinite(since)) return { announced: 0, warned: 0 };

  const deadline = since + GRACE_DAYS * 86_400_000;
  const warnFrom = deadline - WARN_DAYS_BEFORE * 86_400_000;
  const stage = Date.now() >= warnFrom ? 'warned' : 'announced';

  const due = await queryRows<{ id: string; email: string }>(
    deps.pool,
    `SELECT u.id::text AS id, u.email
       FROM users u
      WHERE u.email IS NOT NULL
        AND u.deactivated_at IS NULL
        -- Their own password, so a provider account is not told to do
        -- something that does not apply to it.
        AND u.password_hash IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM second_factors f
           WHERE f.user_id = u.id AND f.confirmed_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM requirement_mails m
           WHERE m.user_id = u.id AND m.stage = $1
        )`,
    [stage],
  );

  const days = Math.max(1, Math.ceil((deadline - Date.now()) / 86_400_000));
  let sent = 0;

  for (const person of due) {
    /*
     * Recorded before sending, not after.
     *
     * A relay that accepts the mail and then times out would otherwise leave
     * the row unwritten and the mail sent — and the next sweep would send it
     * again. One missed mail is better than a duplicate every minute.
     */
    await deps.pool.query(
      `INSERT INTO requirement_mails (user_id, stage) VALUES ($1, $2)
       ON CONFLICT (user_id, stage) DO NOTHING`,
      [person.id, stage],
    );

    await sendMail(deps.relay, {
      to: person.email,
      subject:
        stage === 'warned'
          ? 'SONE: two-step sign-in required soon'
          : 'SONE: two-step sign-in will be required',
      body:
        `Two-step sign-in is becoming a requirement on this SONE instance.\n\n` +
        `You have ${days} day(s) to set up an authenticator app. After that, ` +
        `signing in will only take you to the setup screen.\n\n` +
        `${deps.baseUrl}/settings/sign-in\n`,
    });
    sent += 1;
  }

  return stage === 'warned' ? { announced: 0, warned: sent } : { announced: sent, warned: 0 };
}
