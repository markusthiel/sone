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
    createPage,
    archivePage,
    renameEntry,
  };
}
