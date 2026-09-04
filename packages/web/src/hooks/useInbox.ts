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

  return { items, error, markRead };
}
