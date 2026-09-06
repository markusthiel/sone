/**
 * SONE web — the page tree.
 *
 * Loaded over HTTP from the materialised projection, not from documents. That
 * is the payoff of ADR-0002: the sidebar is one indexed query.
 */

import { NotifyScope, type SoneClient } from '@sone/client';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  api,
  buildPageTree,
  type EntryKind,
  type PageNode,
  type PageSummary,
} from '../api/client.ts';
import type { EntryCover } from '@sone/core';
import { useNudge } from './useNudge.ts';

export function usePages(
  workspaceId: string | null,
  /**
   * The sync connection, so the server can say when the tree changed
   * (ADR-0096). Null before it exists — the hook still works, on focus alone.
   */
  client?: SoneClient | null,
): {
  pages: PageSummary[];
  tree: PageNode[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /**
   * Update one entry's title locally, without a request.
   *
   * The title lives in the CRDT document; the tree comes from the projection
   * over HTTP. Editing a page's heading therefore changed the document, the
   * document reached the server, the server updated the row — and the sidebar
   * went on showing the old name until something else happened to refetch it.
   *
   * This closes that gap for the page you are looking at, immediately, without
   * a request at all — which is still worth having: the server's own nudge
   * costs a round trip, and renaming the page in front of you should not.
   *
   * Somebody else's change used to arrive only on the next refetch. It arrives
   * on the nudge now (ADR-0096); this stays as the fast path for your own.
   */
  applyTitle: (pageId: string, title: string) => void;
  createPage: (input: {
    title?: string;
    parentPageId?: string | null;
    kind?: EntryKind;
  }) => Promise<string | null>;
  archivePage: (pageId: string) => Promise<void>;
  renameEntry: (pageId: string, title: string) => Promise<void>;
  /** A cover on an entry, or null to take it off (ADR-0117). */
  setEntryCover: (pageId: string, cover: EntryCover | null) => Promise<void>;
  moveEntry: (
    pageId: string,
    parentPageId: string | null,
    afterPageId?: string | null,
  ) => Promise<void>;
} {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      setPages([]);
      setLoading(false);
      return;
    }
    try {
      const result = await api.pages(workspaceId);
      setPages(result.pages);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    // Cleared before fetching, not only marked as loading.
    //
    // The old workspace's tree stayed in place until the new one arrived, and
    // anything reading it in that moment was reading the wrong workspace. What
    // it cost: opening the root redirects to the first page in the tree, so
    // switching workspaces opened a page from the one just left — and the
    // server refused it, correctly, with "you no longer have access".
    setPages([]);
    setLoading(true);
    void reload();
  }, [reload]);

  /*
   * The push (ADR-0096).
   *
   * This hook's own note said, for months, that somebody else's change arrives
   * "on the next refetch rather than live; that needs a workspace-level
   * subscription, which the sync protocol does not have yet". ADR-0093 gave the
   * protocol a nudge with a **scope** precisely so the next subject would cost
   * no protocol version, and this is that subject.
   *
   * **Coalesced**, by the hook that does it: one nudge is one reload of the
   * whole tree, and a change that arrives as many statements — an import
   * writing a subtree, a move touching several rows — would otherwise be one
   * reload each.
   */
  useNudge(client, NotifyScope.Pages, () => void reload());

  // Refetched when the tab regains focus. Someone else's rename or new page
  // would otherwise never appear in a tab left open, and polling for it would
  // be a request every few seconds for a change that usually has not happened.
  //
  // Kept beside the push rather than replaced by it, for the reason ADR-0093
  // gave for the bell: a push says what happened while the connection was up,
  // and nothing says what happened while it was not — a sleeping laptop, a
  // discarded tab, a deploy.
  useEffect(() => {
    const onFocus = (): void => {
      void reload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload]);

  const createPage = useCallback(
    async (input: {
      title?: string;
      parentPageId?: string | null;
      kind?: EntryKind;
      templateId?: string;
    }) => {
      if (!workspaceId) return null;
      try {
        const created = await api.createPage(workspaceId, input);
        await reload();
        return created.id;
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
        return null;
      }
    },
    [workspaceId, reload],
  );

  const archivePage = useCallback(
    async (pageId: string) => {
      try {
        await api.archivePage(pageId);
        await reload();
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
    },
    [reload],
  );

  const applyTitle = useCallback((pageId: string, title: string) => {
    setPages((previous) => {
      const index = previous.findIndex((page) => page.id === pageId);
      // Unchanged or unknown: return the same array so React does not re-render
      // the whole tree on every keystroke.
      if (index === -1 || previous[index]!.title === title) return previous;
      const next = [...previous];
      next[index] = { ...next[index]!, title };
      return next;
    });
  }, []);

  const renameEntry = useCallback(
    async (pageId: string, title: string) => {
      try {
        await api.renameEntry(pageId, title);
        await reload();
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
    },
    [reload],
  );

  /**
   * A cover on an entry, then a reload.
   *
   * The reload is what the folder view draws from: it renders the tree node it
   * was handed, so a cover that only changed on the server would appear at the
   * next refetch and look as though the click had done nothing.
   */
  const setEntryCover = useCallback(
    async (pageId: string, cover: EntryCover | null) => {
      try {
        await api.setEntryCover(pageId, cover);
        await reload();
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
    },
    [reload],
  );

  const moveEntry = useCallback(
    async (pageId: string, parentPageId: string | null, afterPageId?: string | null) => {
      try {
        await api.moveEntry(pageId, parentPageId, afterPageId);
        await reload();
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
    },
    [reload],
  );

  return {
    pages,
    tree: buildPageTree(pages),
    loading,
    error,
    reload,
    applyTitle,
    createPage,
    archivePage,
    renameEntry,
    setEntryCover,
    moveEntry,
  };
}
