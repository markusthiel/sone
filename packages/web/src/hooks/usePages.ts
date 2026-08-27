/**
 * SONE web — the page tree.
 *
 * Loaded over HTTP from the materialised projection, not from documents. That
 * is the payoff of ADR-0002: the sidebar is one indexed query.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  api,
  buildPageTree,
  type EntryKind,
  type PageNode,
  type PageSummary,
} from '../api/client.ts';

export function usePages(workspaceId: string | null): {
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
   * This closes that gap for the page you are looking at, immediately. Changes
   * made by other people still arrive on the next refetch rather than live;
   * that needs a workspace-level subscription, which the sync protocol does not
   * have yet.
   */
  applyTitle: (pageId: string, title: string) => void;
  createPage: (input: {
    title?: string;
    parentPageId?: string | null;
    kind?: EntryKind;
  }) => Promise<string | null>;
  archivePage: (pageId: string) => Promise<void>;
  renameEntry: (pageId: string, title: string) => Promise<void>;
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
    setLoading(true);
    void reload();
  }, [reload]);

  // Refetched when the tab regains focus. Someone else's rename or new page
  // would otherwise never appear in a tab left open, and polling for it would
  // be a request every few seconds for a change that usually has not happened.
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
    async (input: { title?: string; parentPageId?: string | null; kind?: EntryKind }) => {
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
  };
}
