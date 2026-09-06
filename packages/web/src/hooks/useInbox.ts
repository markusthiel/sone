/**
 * The notifications, fetched once for the two columns that show them.
 *
 * The menu counts them and the content lists them (ADR-0069), so the fetch
 * belongs above both rather than inside either — two copies would be two
 * requests and, worse, two answers that can disagree for a second after
 * something is marked read.
 *
 * Everything is fetched and the views filter in the browser. The list is what
 * one person was told about, not a feed: it is small, and a round trip per
 * click on a filter would be slower and less honest than counting what is
 * already here.
 */

import { NotifyScope, type SoneClient } from '@sone/client';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useNudge } from './useNudge.ts';

export interface InboxItem {
  id: string;
  kind: 'mention' | 'reply' | 'assignment';
  excerpt: string;
  createdAt: string;
  read: boolean;
  /** When it comes back, or null for "awake" (ADR-0075). */
  snoozedUntil: string | null;
  pageId: string;
  pageTitle: string;
  threadId: string | null;
  workspaceId: string;
  workspaceName: string;
}

export function useInbox(
  /**
   * The sync connection, so the server can say when something changed
   * (ADR-0093). Null before it exists and on a screen that has none — the hook
   * still works, with the focus refresh alone.
   */
  client?: SoneClient | null,
): {
  items: InboxItem[] | null;
  error: string | null;
  /** Given ids, or nothing at all for "declare bankruptcy on the list". */
  markRead: (ids?: string[]) => void;
  /** One row, either way round (ADR-0071). Ids are required to put back. */
  setRead: (ids: string[], read: boolean) => void;
  /** Aside until a moment, or back now with null (ADR-0075). */
  snooze: (ids: string[], until: Date | null) => void;
  /** Off the list for good (ADR-0115). Not reversible, unlike the rest. */
  remove: (ids: string[]) => void;
  /** Answer where you are (ADR-0076). Resolves when the server has it. */
  reply: (id: string, text: string) => Promise<void>;
  /** How many are waiting, for the badge on the bell. */
  unread: number;
  /** Read it again now. */
  refresh: () => void;
} {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Read again when somebody comes back to the window (ADR-0092).
   *
   * This ran once, with `[]` deps, and the comment on the count called that
   * "once per navigation" — which was true of a server-rendered application and
   * has never been true here: routing is `pushState`, so the hook is mounted
   * once per **full page load**. That is exactly "erst nach reload".
   *
   * `focus` and `visibilitychange`, the same pair `usePages` uses, rather than
   * a timer: a notification is not urgent enough to poll for and is wanted the
   * moment somebody looks.
   *
   * The limit ADR-0092 named — a badge that does not appear while somebody is
   * staring at the page — is gone: the sync connection now carries a nudge, and
   * that is the effect below. The focus pair stays, and is not redundant. It is
   * what covers the minutes when there was no connection at all: a laptop that
   * slept, a tab that was discarded, a deploy. A push tells you what happened
   * while you were listening; nothing tells you what happened while you were
   * not, so the two answer different questions.
   */
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void api
      .inbox(false)
      .then((result) => {
        if (!cancelled) setItems(result.notifications);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.code : 'network_error');
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  /*
   * The push (ADR-0093).
   *
   * The nudge carries no count — it says "your inbox changed", and the list
   * below is refetched and recounted. That is the same single source ADR-0092
   * settled on: a number on the wire would be a second answer to the question
   * this list already answers, and two answers is how the badge and the list
   * spent a release disagreeing.
   *
   * Refetched unconditionally rather than only when the tab is visible. A
   * hidden tab that skipped it would be a tab whose badge is stale the instant
   * somebody switches to it — which is the bug this replaces, moved somewhere
   * less obvious.
   *
   * Through the same hook the tree and the trash use (ADR-0097). It was written
   * inline here first and coalesced only in `usePages`; one projection can send
   * two nudges to one person within milliseconds — its inserts and its sweep of
   * deleted threads — and there was no reason for this to be the listener that
   * fetched twice.
   */
  useNudge(client, NotifyScope.Inbox, refresh);

  useEffect(() => {
    const again = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [refresh]);

  const markRead = useCallback((ids?: string[]) => {
    // Optimistic, and deliberately: the navigation that usually accompanies
    // this matters more than the acknowledgement, and a mark that fails is one
    // row that stays bold rather than an error nobody can act on.
    setItems((current) =>
      (current ?? []).map((one) =>
        ids === undefined || ids.includes(one.id) ? { ...one, read: true } : one,
      ),
    );
    void api.markInboxRead(ids).catch(() => {});
  }, []);

  /*
   * The same act, either direction (ADR-0071).
   *
   * Optimistic for the same reason, and it matters more here: putting a row
   * back to waiting has no navigation to hide a round trip behind, so a row
   * that only changed once the server answered would read as a key that
   * sometimes does nothing.
   */
  const setRead = useCallback((ids: string[], read: boolean) => {
    setItems((current) =>
      (current ?? []).map((one) => (ids.includes(one.id) ? { ...one, read } : one)),
    );
    void (read ? api.markInboxRead(ids) : api.markInboxUnread(ids)).catch(() => {});
  }, []);

  /*
   * Optimistic, like the other two, and for the same reason: the row leaves the
   * view it was in, and a row that only left once the server answered would
   * read as a button that sometimes does nothing.
   */
  const snooze = useCallback((ids: string[], until: Date | null) => {
    setItems((current) =>
      (current ?? []).map((one) =>
        ids.includes(one.id)
          ? { ...one, snoozedUntil: until === null ? null : until.toISOString() }
          : one,
      ),
    );
    void api.snoozeInbox(ids, until).catch(() => {});
  }, []);

  /*
   * Off the list, and **not** optimistic (ADR-0115).
   *
   * The other three are, because the worst a failed one costs is a row in the
   * wrong view, recoverable by looking again. This one cannot be undone by the
   * person or by the code: a row that vanished from the screen and stayed on
   * the server would come back on the next refresh with no explanation, and a
   * row that vanished from both when the request failed would be a deletion
   * that did not happen and cannot be retried.
   *
   * So the list is re-read from the server, and what the server did is what the
   * screen shows.
   */
  const remove = useCallback((ids: string[]) => {
    void api
      .removeFromInbox(ids)
      .then(() => {
        setItems((current) => (current ?? []).filter((one) => !ids.includes(one.id)));
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.code : 'network_error'));
  }, []);

  /*
   * Not optimistic, and that is the difference.
   *
   * Marking read and putting aside are decisions about a row in a list, and the
   * worst a failed one costs is a row in the wrong view. A reply is a sentence
   * addressed to somebody: showing it as sent when it was not is the one
   * failure here nobody could recover from, because the box that held the words
   * would already be empty. So this waits, and the box keeps the text until the
   * server has it.
   *
   * The row is marked read on the way, because the server does the same.
   */
  const reply = useCallback(async (id: string, text: string): Promise<void> => {
    await api.replyToNotification(id, text);
    setItems((current) => {
      const answered = (current ?? []).find((one) => one.id === id);
      const thread = answered?.threadId ?? null;
      return (current ?? []).map((one) =>
        one.id === id || (thread !== null && one.threadId === thread)
          ? { ...one, read: true }
          : one,
      );
    });
  }, []);

  /*
   * Counted from the list, not fetched a second time.
   *
   * The badge had its own `GET /api/inbox/count` inside `AccountMenu`, which
   * is how a number and a list that disagree come about — and they did, because
   * one of them was optimistically updated on "mark read" and the other was
   * not. One source, so pressing "read" moves both.
   */
  const unread = (items ?? []).filter(
    (one) =>
      !one.read &&
      (one.snoozedUntil === null || new Date(one.snoozedUntil).getTime() <= Date.now()),
  ).length;

  return { items, error, markRead, setRead, snooze, remove, reply, unread, refresh };
}
