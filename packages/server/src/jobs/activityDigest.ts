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
import { sendMail, type Relay } from '../mail/send.js';
import type { Pool } from 'pg';

/** Pages in one mail. Beyond this the mail says how many more there were. */
const MAX_LINES = 20;

export interface DigestReader {
  userId: string;
  email: string;
  isAdmin: boolean;
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
        AND ${visiblePagesCondition('p', '$1', '$3')}
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
        AND ($4::boolean IS NOT TRUE OR EXISTS (
              SELECT 1 FROM watched_pages watch
               WHERE watch.user_id = $1
                 AND (watch.page_id = p.id OR watch.page_id = ANY(p.ancestor_ids))
            ))
      ORDER BY p.last_edited_at DESC
      LIMIT ${MAX_LINES + 1}`,
    [reader.userId, reader.since, reader.isAdmin, reader.scope === 'watched'],
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
): { subject: string; body: string } | null {
  if (pages.length === 0) return null;

  const shown = pages.slice(0, MAX_LINES);
  const more = pages.length - shown.length;

  const byWorkspace = new Map<string, ChangedPage[]>();
  for (const page of shown) {
    const list = byWorkspace.get(page.workspaceName) ?? [];
    list.push(page);
    byWorkspace.set(page.workspaceName, list);
  }

  const lines: string[] = [];
  for (const [workspace, list] of byWorkspace) {
    lines.push(`${workspace}:`);
    for (const page of list) {
      /*
       * The instance's detail setting is honoured here too (ADR-0058).
       *
       * With `workspace`, a page is a count rather than a title: an operator who
       * decided titles must not leave the instance did not make an exception
       * for a mail that happens to list more of them.
       */
      if (detail === 'workspace') continue;
      const who =
        page.editors > 1
          ? ` — ${page.lastEditor ?? 'somebody'} and ${page.editors - 1} other(s)`
          : page.lastEditor
            ? ` — ${page.lastEditor}`
            : '';
      lines.push(`  ${page.title}${who}`);
      lines.push(`  ${baseUrl}/p/${page.pageId}`);
    }
    if (detail === 'workspace') {
      lines.push(`  ${list.length} page(s) changed`);
    }
    lines.push('');
  }
  if (more > 0) lines.push(`and ${more} more.`);

  return {
    subject:
      period === 'weekly' ? 'SONE: what changed this week' : 'SONE: what changed yesterday',
    body: `${lines.join('\n')}\n`,
  };
}

export interface ActivityDigestDeps {
  pool: Pool;
  relay: Relay | null;
  detail: 'title' | 'workspace';
  baseUrl: string;
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
): Promise<{ sent: number; empty: number }> {
  if (!deps.relay) return { sent: 0, empty: 0 };

  const due = await queryRows<{
    id: string;
    email: string;
    is_instance_admin: boolean;
    activity_digest: 'daily' | 'weekly';
    digest_scope: 'all' | 'watched';
    since: Date;
  }>(
    deps.pool,
    `SELECT u.id::text AS id,
            u.email,
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

  for (const reader of due) {
    const pages = await changedFor(deps.pool, {
      userId: reader.id,
      email: reader.email,
      isAdmin: reader.is_instance_admin,
      since: reader.since,
      scope: reader.digest_scope,
    });

    const composed = composeDigest(
      pages,
      deps.detail,
      deps.baseUrl,
      reader.activity_digest,
    );

    /*
     * The watermark moves either way.
     *
     * A quiet week that sent no mail must still advance it, or the next digest
     * covers two weeks and the one after that three — and "nothing happened"
     * would eventually become "here is a month of everything".
     */
    await deps.pool.query(`UPDATE users SET activity_digest_sent_at = now() WHERE id = $1`, [
      reader.id,
    ]);

    if (!composed) {
      empty += 1;
      continue;
    }

    await sendMail(deps.relay, {
      to: reader.email,
      subject: composed.subject,
      body: composed.body,
    });
    sent += 1;
  }

  return { sent, empty };
}
