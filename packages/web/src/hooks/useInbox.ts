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

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../api/client.ts';

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

export function useInbox(): {
  items: InboxItem[] | null;
  error: string | null;
  /** Given ids, or nothing at all for "declare bankruptcy on the list". */
  markRead: (ids?: string[]) => void;
  /** One row, either way round (ADR-0071). Ids are required to put back. */
  setRead: (ids: string[], read: boolean) => void;
  /** Aside until a moment, or back now with null (ADR-0075). */
  snooze: (ids: string[], until: Date | null) => void;
  /** Answer where you are (ADR-0076). Resolves when the server has it. */
  reply: (id: string, text: string) => Promise<void>;
} {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

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

  return { items, error, markRead, setRead, snooze, reply };
}
