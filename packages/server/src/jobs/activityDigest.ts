/**
 * SONE server — a mail about what changed (ADR-0062).
 *
 * The only interesting part is the query, and it is interesting because of what
 * it must not do: put a restricted page's title in a mail. It uses
 * `visiblePagesCondition`, the same clause the tree and search use, per
 * recipient — writing a second answer to "who may see this" is the failure this
 * feature could have that would actually matter.
 *
 * Everything else follows the decisions: pages rather than changes, so a page
 * edited eleven times is one line; nothing already covered by the watermark;
 * and no mail at all when there is nothing to say.
 */

import { queryRows } from '../db/pool.js';
import { visiblePagesCondition } from '../pages/access.js';
import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../i18n/locale.js';
import { renderHtml, renderText, type Letter, type LetterLine } from '../mail/letter.js';
import { words, type AddressForm, type Say } from '../mail/words.js';

/** One column, without a second query per reader (ADR-0133). */
const localeOf = (value: string | null): SupportedLocale =>
  SUPPORTED_LOCALES.find((l) => l === (value ?? '').toLowerCase()) ?? FALLBACK_LOCALE;
import { sendMail, type Relay } from '../mail/send.js';
import type { Pool } from 'pg';

/** Pages in one mail. Beyond this the mail says how many more there were. */
const MAX_LINES = 20;

export interface DigestReader {
  userId: string;
  email: string;
  since: Date;
  /**
   * Everything visible, or only what this person watches (ADR-0064).
   *
   * `all` is what the digest has always done and stays the default: a release
   * that silently narrows what somebody receives is as bad as one that widens
   * it.
   */
  scope?: 'all' | 'watched';
}

export interface ChangedPage {
  pageId: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  lastEditor: string | null;
  editors: number;
}

/**
 * What changed that this person may see.
 *
 * One row per page, not per edit. `last_edited_at` is the whole basis: SONE has
 * no per-edit log to summarise and does not want one for this — a page that
 * changed is the fact a digest is about.
 */
export async function changedFor(
  pool: Pool,
  reader: DigestReader,
): Promise<ChangedPage[]> {
  return queryRows<ChangedPage>(
    pool,
    `SELECT p.id::text        AS "pageId",
            p.title           AS title,
            p.workspace_id::text AS "workspaceId",
            w.name            AS "workspaceName",
            u.display_name    AS "lastEditor",
            -- How many people touched it, from the snapshots taken since.
            --
            -- page_versions keys on doc_id and stores its people in an
            -- authors text[] with a taken_at: I wrote author_id, page_id and
            -- created_at, all three invented, and the SQL column guard named
            -- every one of them before the query ever ran.
            --
            -- One is "somebody changed this", more is "there was a conversation
            -- here", and that is the whole distinction a line needs to draw.
            (SELECT count(DISTINCT a)
               FROM page_versions v, unnest(v.authors) AS a
              WHERE v.doc_id = p.id AND v.taken_at > $2)::int AS editors
       FROM pages p
       JOIN workspaces w ON w.id = p.workspace_id
       JOIN workspace_members m
         ON m.workspace_id = p.workspace_id AND m.user_id = $1
       LEFT JOIN users u ON u.id = p.last_edited_by
      WHERE p.archived_at IS NULL
        AND p.last_edited_at > $2
        -- Not this person's own edits alone: a digest listing what somebody did
        -- themselves is a receipt, not news.
        AND (p.last_edited_by IS DISTINCT FROM $1 OR EXISTS (
              SELECT 1
                FROM page_versions v, unnest(v.authors) AS a
               WHERE v.doc_id = p.id AND v.taken_at > $2
                 AND a IS DISTINCT FROM $1::text
            ))
        -- The same condition the tree and search use, per recipient (ADR-0062).
        --
        -- The bypass is the reader's role **in that page's workspace**, which
        -- is what the condition documents and what every other caller passes.
        -- This passed users.is_instance_admin instead (ADR-0081), which is a
        -- different question and wrong in both directions: an instance
        -- administrator saw restricted titles from every workspace they belong
        -- to, and a workspace **owner** — who the tree shows everything —
        -- silently lost rows from their own digest.
        --
        -- The condition asks the membership question itself now (ADR-0087),
        -- which is what this call site needed most: a digest spans workspaces,
        -- so a single boolean computed once could never have been right here.
        AND ${visiblePagesCondition('p', '$1')}
        -- Watched, when that is the scope (ADR-0064).
        --
        -- The page itself, or anything under a watched folder: somebody who
        -- watches Projekte means the project pages, and a folder that only
        -- changes when it is renamed would be a subscription to nothing. The
        -- overlap operator over ancestor_ids, the same expansion the in: search
        -- filter uses -- recording the descendants instead would mean a set
        -- that goes stale the moment somebody moves a page.
        --
        -- A page watched and also under a watched folder appears once. That is
        -- a set, not a count.
        -- Aliased watch, not w: this statement already joins workspaces as w,
        -- and shadowing it inside a subquery made the SQL column guard resolve
        -- the outer w.id and w.name against watched_pages. It was right to
        -- complain -- a reader who has to track which w is which is a reader
        -- who will misread one of them.
        AND ($3::boolean IS NOT TRUE OR EXISTS (
              SELECT 1 FROM watched_pages watch
               WHERE watch.user_id = $1
                 AND (watch.page_id = p.id OR watch.page_id = ANY(p.ancestor_ids))
            ))
      ORDER BY p.last_edited_at DESC
      LIMIT ${MAX_LINES + 1}`,
    [reader.userId, reader.since, reader.scope === 'watched'],
  );
}

/**
 * The mail, grouped by workspace.
 *
 * One mail per workspace would be truer to ADR-0058's rule, and this is one mail
 * with a heading per workspace — because a digest of three quiet workspaces
 * would otherwise be three mails that each say one line, which is the failure
 * mode this whole feature is trying to avoid.
 */
export function composeDigest(
  pages: ChangedPage[],
  detail: 'title' | 'workspace',
  baseUrl: string,
  period: 'daily' | 'weekly',
  voice: { say: Say; locale: SupportedLocale } = { say: words('en'), locale: 'en' },
): Letter | null {
  const { say } = voice;
  if (pages.length === 0) return null;

  const shown = pages.slice(0, MAX_LINES);
  const more = pages.length - shown.length;

  /*
   * Grouped by id, headed by name (ADR-0081).
   *
   * It grouped by name, so two workspaces called "Projekte" — which is an
   * ordinary thing to have, one per team — merged into one heading, and a
   * reader saw pages from somewhere else listed under their own.
   */
  const byWorkspace = new Map<string, { name: string; pages: ChangedPage[] }>();
  for (const page of shown) {
    const group = byWorkspace.get(page.workspaceId) ?? { name: page.workspaceName, pages: [] };
    group.pages.push(page);
    byWorkspace.set(page.workspaceId, group);
  }

  // A workspace is a line, and the pages under it are details of it (ADR-0121).
  // `under` is the whole of the grouping — text indents them, the drawn form
  // sets them smaller and quieter, and neither can forget one the other has.
  const lines: LetterLine[] = [];
  for (const [, group] of byWorkspace) {
    const list = group.pages;
    lines.push({ text: say('digest.workspace', { workspace: group.name }) });
    for (const page of list) {
      /*
       * The instance's detail setting is honoured here too (ADR-0058).
       *
       * With `workspace`, a page is a count rather than a title: an operator who
       * decided titles must not leave the instance did not make an exception
       * for a mail that happens to list more of them.
       */
      if (detail === 'workspace') continue;
      /*
       * The whole line from the catalogue, not a title with a suffix glued on.
       *
       * It was `${title}${who}` where `who` was ` — Anna and 2 other(s)`, which
       * is three separate things a translator cannot reach: the dash, the
       * conjunction, and a count in brackets. A language that puts the
       * attribution somewhere else in the sentence cannot express it at all.
       */
      const others = page.editors - 1;
      const text =
        page.editors > 1
          ? say('digest.bySeveral', {
              title: page.title,
              who: page.lastEditor ?? say('digest.somebody'),
              others,
            })
          : page.lastEditor
            ? say('digest.byOne', { title: page.title, who: page.lastEditor })
            : page.title;
      lines.push({ text, url: `${baseUrl}/p/${page.pageId}`, under: true });
    }
    if (detail === 'workspace') {
      lines.push({ text: say('digest.changed', { count: list.length }), under: true });
    }
  }
  if (more > 0) lines.push({ text: say('digest.more', { count: more }) });

  return {
    subject: say(period === 'weekly' ? 'digest.subject.weekly' : 'digest.subject.daily'),
    lines,
    action: { label: say('digest.action'), url: baseUrl },
    footer: [say('notify.footer.stop'), `${baseUrl}/settings/notifications`],
    baseUrl,
    locale: voice.locale,
  };
}

export interface ActivityDigestDeps {
  pool: Pool;
  relay: Relay | null;
  detail: 'title' | 'workspace';
  baseUrl: string;
  /** „du" or „Sie", one setting for everything this instance says (ADR-0133). */
  addressForm?: AddressForm;
}

/**
 * Send to everybody whose hour it is.
 *
 * Eight in the reader's own timezone (ADR-0061), weekdays for daily and Monday
 * for weekly: a Sunday-morning mail about Saturday is a mail about work,
 * arriving on somebody's weekend, that nobody will act on before Monday.
 */
export async function sendActivityDigests(
  deps: ActivityDigestDeps,
): Promise<{ sent: number; empty: number; failed: string[] }> {
  if (!deps.relay) return { sent: 0, empty: 0, failed: [] };

  const due = await queryRows<{
    id: string;
    email: string;
    locale: string | null;
    is_instance_admin: boolean;
    activity_digest: 'daily' | 'weekly';
    digest_scope: 'all' | 'watched';
    since: Date;
  }>(
    deps.pool,
    `SELECT u.id::text AS id,
            u.email,
            u.locale,
            u.is_instance_admin,
            u.activity_digest,
            u.digest_scope,
            -- Since the last one, or since the period implies. Null would
            -- otherwise mean "everything ever", which is a first mail nobody
            -- reads.
            coalesce(
              u.activity_digest_sent_at,
              now() - CASE u.activity_digest WHEN 'weekly' THEN interval '7 days'
                                             ELSE interval '1 day' END
            ) AS since
       FROM users u
      WHERE u.activity_digest <> 'off'
        AND u.email IS NOT NULL
        AND u.deactivated_at IS NULL
        AND extract(hour from now() AT TIME ZONE coalesce(u.timezone, 'UTC')) = 8
        AND CASE u.activity_digest
              WHEN 'weekly' THEN
                extract(dow from now() AT TIME ZONE coalesce(u.timezone, 'UTC')) = 1
              ELSE
                extract(dow from now() AT TIME ZONE coalesce(u.timezone, 'UTC'))
                  BETWEEN 1 AND 5
            END
        -- Not twice in one day, whatever else happens to the timer.
        AND (u.activity_digest_sent_at IS NULL
             OR u.activity_digest_sent_at < now() - interval '20 hours')`,
  );

  let sent = 0;
  let empty = 0;

  const failed: string[] = [];

  for (const reader of due) {
    /*
     * One reader's failure is one reader's failure (ADR-0081).
     *
     * `sendMail` throwing used to escape this loop, so a single unreachable
     * address, or one relay hiccup, skipped everybody after that person for the
     * whole hour — and since the gate is "hour = 8 in your timezone", for the
     * whole day. The people who lost their digest were whoever happened to sort
     * after the failure, which is nobody's fault and nobody's to notice.
     */
    try {
      const pages = await changedFor(deps.pool, {
        userId: reader.id,
        email: reader.email,
        since: reader.since,
        scope: reader.digest_scope,
      });

      /*
       * The reader's own language (ADR-0133).
       *
       * No workspace fallback here, and deliberately: a digest spans every
       * workspace a person can see, so there is no one place whose language
       * would be the better guess. Their setting, or English.
       */
      const locale = localeOf(reader.locale);
      const composed = composeDigest(pages, deps.detail, deps.baseUrl, reader.activity_digest, {
        locale,
        say: words(locale, deps.addressForm ?? 'informal'),
      });

      if (!composed) {
        /*
         * The watermark moves for a quiet week too.
         *
         * Otherwise the next digest covers two weeks and the one after that
         * three, and "nothing happened" eventually becomes "here is a month of
         * everything".
         */
        await deps.pool.query(`UPDATE users SET activity_digest_sent_at = now() WHERE id = $1`, [
          reader.id,
        ]);
        empty += 1;
        continue;
      }

      /*
       * Sent first, then marked (ADR-0081).
       *
       * The mark used to move before the send, so a relay failure recorded the
       * day as delivered and lost it: the next digest starts from the new
       * watermark, and everything that happened in the window nobody was told
       * about is never mentioned again. Marking after means the failure case
       * repeats the window rather than dropping it — a digest somebody gets
       * twice is a nuisance, one they never get is a hole.
       */
      await sendMail(deps.relay, {
        to: reader.email,
        subject: composed.subject,
        body: renderText(composed),
        html: renderHtml(composed),
        unsubscribeUrl: `${deps.baseUrl}/settings/notifications`,
      });
      await deps.pool.query(`UPDATE users SET activity_digest_sent_at = now() WHERE id = $1`, [
        reader.id,
      ]);
      sent += 1;
    } catch (err) {
      failed.push(`${reader.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { sent, empty, failed };
}
