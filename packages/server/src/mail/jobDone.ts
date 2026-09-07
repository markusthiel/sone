/**
 * SONE server — a job that finished while nobody was looking (ADR-0138).
 *
 * A workspace export takes minutes. The settings screen polls while somebody
 * watches it, and the moment they close the tab nothing tells them anything —
 * so the ordinary shape of this is: ask for an export, go to lunch, come back
 * tomorrow, find that the archive expired overnight (`SONE_JOB_RESULT_HOURS`,
 * a day by default). An export somebody has to ask for twice.
 *
 * ## Who to tell, without a list of kinds
 *
 * **A job worth telling somebody about is one somebody asked for**, and the row
 * already records which those are. `jobs.created_by` is the person who pressed
 * the button; the sweep that turns aged notifications into work passes `null`
 * for it, deliberately and in so many words.
 *
 * So there is no table of "kinds that send mail" to keep in step with the
 * handlers — a job nobody asked for has nobody to tell, and that is a fact
 * about the row rather than a rule somebody has to remember.
 *
 * ## A link, and no token in it
 *
 * ADR-0126 built a share mail that carries a token and argued carefully about
 * it. This is the same question with the opposite answer, and the archive is
 * why: it is *every page of a workspace*, so a bearer link to it sitting in a
 * mailbox is the largest possible version of the thing ADR-0058 exists to
 * prevent — and the download route already refuses anybody but the asker
 * (ADR-0044).
 *
 * The letter therefore says **it is ready**, rather than handing it over. The
 * link opens the screen it was asked from, and the archive comes to somebody
 * signed in as themselves.
 */

import type { Pool } from 'pg';

import { readableSize } from '@sone/core';

import { queryOne } from '../db/pool.js';
import { recipientLocale } from '../i18n/locale.js';
import type { FinishedJob } from '../jobs/runner.js';
import type { Letter } from './letter.js';
import { words, type AddressForm } from './words.js';

export interface JobMailDeps {
  pool: Pool;
  baseUrl: string;
  instanceName: () => Promise<string>;
  addressForm?: () => Promise<AddressForm>;
  /** Absent when the instance has no relay: the letter is then not sent. */
  sendLetter?: (to: string, letter: Letter) => Promise<void>;
}

/** What the runner saw happen, once it had stopped retrying. */
export type Outcome = 'done' | 'failed';

const day = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * Tell whoever asked, if there is anybody to tell.
 *
 * Every reason there may not be is ordinary rather than an error, which is why
 * they are all early returns: no relay on this instance (ADR-0059), a job the
 * machinery queued for itself, an account with no address at all (ADR-0033),
 * and a kind whose result nobody fetches.
 *
 * Nothing here can fail a job. It is called after the state is written, and its
 * caller swallows what it throws: the export succeeded whether or not a mailbox
 * took a message about it, which is the rule ADR-0121 states for a grant and
 * this is the same one for a file.
 */
export async function tellAboutJob(
  deps: JobMailDeps,
  job: FinishedJob,
  outcome: Outcome,
): Promise<boolean> {
  if (!deps.sendLetter || !job.createdBy) return false;

  const account = await queryOne<{ email: string | null }>(
    deps.pool,
    `SELECT email FROM users WHERE id = $1 AND deactivated_at IS NULL`,
    [job.createdBy],
  );
  if (!account?.email) return false;

  const where = await queryOne<{ name: string }>(
    deps.pool,
    `SELECT name FROM workspaces WHERE id = $1`,
    [job.workspaceId],
  );

  const locale = await recipientLocale(deps.pool, job.createdBy, job.workspaceId);
  const say = words(locale, (await deps.addressForm?.()) ?? 'informal');
  const instance = await deps.instanceName();
  const workspace = where?.name ?? '';
  const base = deps.baseUrl.replace(/\/$/, '');
  // Where it was asked from, which is also where the download button is.
  const url = `${base}/workspace/${encodeURIComponent(job.workspaceId)}/export`;

  const letter: Letter =
    outcome === 'done'
      ? {
          subject: say('export.subject', { where: instance, workspace }),
          heading: say('export.heading', { workspace }),
          lines: [
            {
              // A count and a size, which are facts about the archive rather
              // than about what is in it — the line ADR-0058 draws.
              text: say('export.what', {
                pages: Number(job.result?.['pages'] ?? 0),
                size: readableSize(Number(job.result?.['bytes'] ?? 0)),
              }),
            },
            ...(job.expiresAt ? [{ text: say('export.until', { when: day(job.expiresAt) }) }] : []),
          ],
          action: { label: say('export.action'), url },
          footer: [say('export.footer.notAttached'), say('export.footer.signedIn')],
          baseUrl: base,
          locale,
        }
      : {
          subject: say('export.failed.subject', { where: instance, workspace }),
          heading: say('export.failed.heading', { workspace }),
          lines: [{ text: say('export.failed.why') }],
          action: { label: say('export.failed.action'), url },
          baseUrl: base,
          locale,
        };

  await deps.sendLetter(account.email, letter).catch(() => undefined);
  return true;
}
