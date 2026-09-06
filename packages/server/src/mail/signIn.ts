/**
 * SONE server — the first sign-in, and every unfamiliar one after (ADR-0130).
 *
 * The last two of the six mails proposed beside ADR-0121, and they turn out to
 * be one question asked twice:
 *
 *   *is this browser new to this account?*
 *
 * The first time there is nothing to compare against, and that is the welcome;
 * every time after, there is, and that is the notice.
 *
 * ## It is a notice, not a control
 *
 * An attacker who copies a user agent defeats it entirely, and nothing here is
 * ever consulted to decide whether a request is allowed. What it is good for is
 * the ordinary case: a stolen password used from somebody else's machine looks
 * different, and on a self-hosted instance this is the only thing that would
 * say so.
 *
 * ## And it never fails a sign-in
 *
 * Everything here is wrapped by its caller and swallowed. Somebody who typed
 * the right password is signed in whether or not their mailbox took a message
 * about it — the rule ADR-0121 states for a grant, applied to a session.
 */

import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { queryOne } from '../db/pool.js';
import type { Letter } from './letter.js';

export interface SignInMailDeps {
  pool: Pool;
  baseUrl: string;
  instanceName: () => Promise<string>;
  /** Whether an instance sends a welcome at all. Off unless somebody chose it. */
  welcome?: () => Promise<boolean>;
  canSendMail?: () => Promise<boolean>;
  sendLetter?: (to: string, letter: Letter) => Promise<void>;
}

/** What a browser is, as far as this table is concerned. */
const agentHash = (userAgent: string | null): Buffer =>
  createHash('sha256').update(userAgent ?? '').digest();

/**
 * Note the device, and write once if there is anything to say.
 *
 * Returns what it did, for the tests and for a caller that wants to log it.
 *
 * The insert is the decision: `ON CONFLICT DO NOTHING RETURNING` tells us in
 * one statement whether this browser was already known, with no gap between
 * asking and recording in which a second sign-in could slip through and produce
 * two letters about one device.
 */
export async function noteSignIn(
  deps: SignInMailDeps,
  userId: string,
  meta: { userAgent: string | null; ipPrefix: string | null },
): Promise<'known' | 'first' | 'new'> {
  /*
   * How many browsers this account had *before* this one.
   *
   * Read first, because the insert below is what makes it one — and "was there
   * anything to compare against" is the whole difference between a welcome and
   * a warning.
   */
  const before = await queryOne<{ n: number }>(
    deps.pool,
    `SELECT count(*)::int AS n FROM known_devices WHERE user_id = $1`,
    [userId],
  );

  const noted = await queryOne<{ user_id: string }>(
    deps.pool,
    `INSERT INTO known_devices (user_id, agent_hash) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING user_id`,
    [userId, agentHash(meta.userAgent)],
  );
  if (!noted) return 'known';

  const first = (before?.n ?? 0) === 0;
  if (!deps.sendLetter) return first ? 'first' : 'new';
  if (deps.canSendMail && !(await deps.canSendMail())) return first ? 'first' : 'new';
  if (first && !(await deps.welcome?.())) return 'first';

  const account = await queryOne<{ email: string | null; display_name: string }>(
    deps.pool,
    `SELECT email, display_name FROM users WHERE id = $1`,
    [userId],
  );
  if (!account?.email) return first ? 'first' : 'new';

  const instance = await deps.instanceName();
  await deps
    .sendLetter(
      account.email,
      first
        ? welcomeLetter(deps, instance, account.display_name)
        : newDeviceLetter(deps, instance, meta),
    )
    .catch(() => undefined);

  return first ? 'first' : 'new';
}

/**
 * Somebody signed in from a browser this account has not used.
 *
 * What it says is what was actually seen: when, and the coarse network address.
 * **Not a device name** — "Firefox on Linux" is a guess parsed out of a string
 * anybody can set, and a guess in a security notice is worse than a fact,
 * because the reader checks it against what they know and a wrong guess makes
 * them dismiss a real warning.
 *
 * The user agent itself goes in as it was received. It is this account's own
 * data going to this account, and on a self-hosted instance the person reading
 * it is often the person who can act on it.
 */
function newDeviceLetter(
  deps: SignInMailDeps,
  instance: string,
  meta: { userAgent: string | null; ipPrefix: string | null },
): Letter {
  return {
    subject: `${instance}: a new sign-in to your account`,
    heading: 'Somebody signed in from a browser this account has not used.',
    lines: [
      { text: `Just now, from ${meta.ipPrefix ?? 'an address this instance could not see'}.` },
      ...(meta.userAgent ? [{ text: meta.userAgent.slice(0, 200), under: true }] : []),
      {
        text:
          'If that was you, there is nothing to do. If it was not, change your ' +
          'password now and tell whoever runs this instance.',
      },
    ],
    action: { label: 'Open your settings', url: `${deps.baseUrl.replace(/\/$/, '')}/settings` },
    footer: [
      // Said plainly, because the alternative is somebody trusting it to be
      // more than it is.
      'This is sent once per browser. A browser is not proof of who was using it.',
    ],
    baseUrl: deps.baseUrl,
    locale: 'en',
  };
}

/**
 * The first sign-in of all.
 *
 * Off unless an instance turns it on. A welcome is the one mail here nobody
 * needs: on an instance where an administrator makes accounts for colleagues
 * and tells them in person, it is a message about something they were just
 * told. The operator who wants it is the one who switches it on.
 */
function welcomeLetter(deps: SignInMailDeps, instance: string, name: string): Letter {
  return {
    subject: `${instance}: welcome`,
    heading: name ? `Welcome, ${name}.` : 'Welcome.',
    lines: [
      { text: `Your account on ${instance} is ready and you are signed in.` },
      {
        text:
          'Notes live in workspaces, and you will see the ones you have been ' +
          'given. Everything you write stays on this server.',
      },
    ],
    action: { label: 'Open SONE', url: deps.baseUrl },
    baseUrl: deps.baseUrl,
    locale: 'en',
  };
}
