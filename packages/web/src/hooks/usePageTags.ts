/**
 * SONE web — a page's tags, and the workspace's.
 *
 * Read from the Yjs document rather than from the API, so a tag added by
 * somebody else appears without a refetch — tags live on the page (ADR-0020),
 * which is exactly what makes that possible.
 *
 * Written through the API rather than straight to the document. Writing the
 * document directly would work and would skip the permission check: the server
 * refuses a tag change from a viewer, and going through it means the interface
 * cannot accidentally allow what the server forbids.
 */

import { readTags } from '@sone/core';
import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';

import { ApiError, api, type WorkspaceTag } from '../api/client.ts';

export function usePageTags(
  doc: Y.Doc | null,
  pageId: string | null,
  workspaceId: string,
): {
  tags: string[];
  known: WorkspaceTag[];
  setTags: (tags: string[]) => void;
  error: string | null;
} {
  const [tags, setLocalTags] = useState<string[]>([]);
  const [known, setKnown] = useState<WorkspaceTag[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Followed live: the page map changes when anyone edits the tags.
  useEffect(() => {
    if (!doc) {
      setLocalTags([]);
      return;
    }
    const update = (): void => setLocalTags(readTags(doc));
    update();
    doc.on('update', update);
    return () => doc.off('update', update);
  }, [doc]);

  // The workspace's tags, for suggestions. Refetched when the page changes,
  // because a tag added on one page should be suggested on the next.
  useEffect(() => {
    let cancelled = false;
    void api
      .workspaceTags(workspaceId)
      .then((result) => {
        if (!cancelled) setKnown(result.tags);
      })
      .catch(() => {
        // Suggestions are a convenience. Failing to load them must not stop
        // someone typing a tag.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, pageId]);

  const setTags = useCallback(
    (next: string[]) => {
      if (!pageId) return;
      // Applied locally first so the chip appears on the keystroke; the
      // document update from the server confirms it.
      setLocalTags(next);
      void api
        .setTags(pageId, next)
        .then(() => api.workspaceTags(workspaceId))
        .then((result) => setKnown(result.tags))
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.code : 'network_error');
          // Reverted to whatever the document actually holds, so a refused
          // change does not leave a chip that is not really there.
          if (doc) setLocalTags(readTags(doc));
        });
    },
    [doc, pageId, workspaceId],
  );

  return { tags, known, setTags, error };
}
