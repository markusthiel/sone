/**
 * SONE server — reading an inbox (ADR-0052).
 *
 * Three routes: the count, the list, and marking things read.
 *
 * The count is separate from the list on purpose. It is on a button somebody
 * sees on every page, so it has to be one indexed count rather than a list
 * fetched and measured — and it is read once per navigation, not polled.
 */

import type { Pool } from 'pg';

import { queryOne, queryRows } from '../db/pool.js';
import { requireSession } from '../http/auth.js';
import type { Router } from '../http/router.js';

export interface InboxDeps {
  pool: Pool;
}

export function registerInboxRoutes(router: Router, deps: InboxDeps): void {
  /**
   * How many things are waiting, across every workspace.
   *
   * Not per workspace: an inbox that only counts where somebody happens to be
   * standing is an inbox that hides the question they were asked somewhere
   * else, which is the case this whole feature exists for.
   */
  router.get('/api/inbox/count', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const row = await queryOne<{ n: string }>(
      deps.pool,
      `SELECT count(*)::text AS n FROM notifications
        WHERE user_id = $1 AND read_at IS NULL
          -- Asleep does not count (ADR-0075). A badge that keeps counting what
          -- somebody deliberately put aside is a badge they stop believing,
          -- which is the one thing this number must not become.
          AND (snoozed_until IS NULL OR snoozed_until <= now())`,
      [session.userId],
    );

    ctx.send(200, { unread: Number(row?.n ?? 0) });
  });

  /**
   * What is in it, newest first.
   *
   * Read ones included, because an inbox that hides what has been read is a
   * list somebody cannot go back to — and going back to "what did Anna ask me
   * last week" is half of what this is for. `?unread=true` narrows it.
   *
   * The page's title comes from the projection rather than the notification: a
   * page that has been renamed since should show its name now, unlike the
   * excerpt, which is deliberately the words as they were.
   */
  router.get('/api/inbox', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    const onlyUnread = ctx.url.searchParams.get('unread') === 'true';

    const rows = await queryRows<{
      id: string;
      kind: string;
      excerpt: string;
      created_at: Date;
      read_at: Date | null;
      snoozed_until: Date | null;
      page_id: string;
      page_title: string;
      workspace_id: string;
      workspace_name: string;
      thread_id: string | null;
    }>(
      deps.pool,
      `SELECT n.id, n.kind, n.excerpt, n.created_at, n.read_at, n.snoozed_until,
              n.page_id, p.title AS page_title, n.thread_id,
              n.workspace_id, w.name AS workspace_name
         FROM notifications n
         JOIN pages p ON p.id = n.page_id
         JOIN workspaces w ON w.id = n.workspace_id
        WHERE n.user_id = $1
          AND p.archived_at IS NULL
          -- A workspace on its way out is not a place to be sent (ADR-0027).
          AND w.deleted_at IS NULL
          -- "Unread" means waiting for you, and something asleep is not
          -- (ADR-0075). The full listing keeps it: the views are computed in
          -- the browser and one of them is the list of what is asleep.
          AND ($2::boolean IS NOT TRUE
               OR (n.read_at IS NULL
                   AND (n.snoozed_until IS NULL OR n.snoozed_until <= now())))
        ORDER BY n.created_at DESC
        LIMIT 100`,
      [session.userId, onlyUnread],
    );

    ctx.send(200, {
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        excerpt: row.excerpt,
        createdAt: row.created_at,
        read: row.read_at !== null,
        /** When it comes back, or null. Past moments are sent as null: a
         *  notification that has woken is simply awake, and leaving the moment
         *  in would make every reader repeat the comparison. */
        snoozedUntil:
          row.snoozed_until && row.snoozed_until.getTime() > Date.now()
            ? row.snoozed_until
            : null,
        pageId: row.page_id,
        pageTitle: row.page_title,
        threadId: row.thread_id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
      })),
    });
  });

  /**
   * Mark things read, or put them back.
   *
   * By id, because read means "opened the thing it points at" — an inbox that
   * empties itself because somebody glanced at it is one that loses things.
   *
   * With no ids, everything: after a week away the list is long and somebody has
   * to be able to declare bankruptcy on it.
   *
   * `read: false` undoes one. A row opened by accident, or read and then not
   * dealt with, has to be able to go back to waiting — otherwise "unread" is a
   * one-way door and people stop trusting the list enough to click anything in
   * it. Only by id: "mark everything unread" answers no question anybody has,
   * and it would resurrect a bankruptcy somebody declared on purpose.
   */
  router.post('/api/inbox/read', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    let body: { ids?: unknown; read?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((one): one is string => typeof one === 'string')
      : null;
    const read = body.read !== false;
    if (!read && ids === null) {
      ctx.fail(422, 'ids_required');
      return;
    }

    const { rowCount } = await deps.pool.query(
      read
        ? `UPDATE notifications
              SET read_at = now()
            WHERE user_id = $1
              AND read_at IS NULL
              -- Scoped to this person either way: an id from somebody else's
              -- inbox matches nothing rather than being an error, which is the
              -- same answer as an id that never existed.
              AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`
        : `UPDATE notifications
              SET read_at = NULL
            WHERE user_id = $1
              AND read_at IS NOT NULL
              AND id = ANY($2::uuid[])`,
      [session.userId, ids],
    );

    ctx.send(200, { marked: rowCount ?? 0 });
  });

  /**
   * Put something aside until a time (ADR-0075).
   *
   * The moment is decided by the browser and sent whole, rather than named
   * ("tomorrow") and worked out here. "Tomorrow morning" is a question about a
   * clock on a desk, and the browser is standing next to it; the server would
   * have to reconstruct the same answer from a stored timezone that can be
   * wrong, absent, or a week out of date because somebody travelled.
   *
   * `until: null` wakes it now, which is the undo. Only by id, like putting
   * something back to unread: "snooze everything" is not a thing anybody means.
   */
  router.post('/api/inbox/snooze', async (ctx) => {
    const session = await requireSession(deps.pool, ctx);
    if (!session) return;

    let body: { ids?: unknown; until?: unknown };
    try {
      body = await ctx.json();
    } catch {
      ctx.fail(400, 'invalid_body');
      return;
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((one): one is string => typeof one === 'string')
      : null;
    if (ids === null || ids.length === 0) {
      ctx.fail(422, 'ids_required');
      return;
    }

    let until: Date | null = null;
    if (body.until !== null && body.until !== undefined) {
      if (typeof body.until !== 'string') {
        ctx.fail(422, 'invalid_time');
        return;
      }
      const when = new Date(body.until);
      /*
       * In the future, and not absurdly far into it.
       *
       * A moment in the past would be a notification that is asleep and awake
       * at once, and a year is where "put this aside" stops meaning that and
       * starts meaning "delete it without saying so".
       */
      const YEAR = 365 * 24 * 60 * 60 * 1000;
      if (
        Number.isNaN(when.getTime()) ||
        when.getTime() <= Date.now() ||
        when.getTime() > Date.now() + YEAR
      ) {
        ctx.fail(422, 'invalid_time');
        return;
      }
      until = when;
    }

    const { rowCount } = await deps.pool.query(
      `UPDATE notifications SET snoozed_until = $3
        WHERE user_id = $1
          -- Scoped to this person: an id from somebody else's inbox matches
          -- nothing rather than being an error, which is the same answer as an
          -- id that never existed.
          AND id = ANY($2::uuid[])`,
      [session.userId, ids, until],
    );

    ctx.send(200, { snoozed: rowCount ?? 0 });
  });
}
