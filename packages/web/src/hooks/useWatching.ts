/**
 * SONE web — which pages this person watches (ADR-0064).
 *
 * Its own hook beside `useFavourites`, and deliberately not part of it: a
 * favourite is "I come here often" and watching is "tell me when this changes".
 * Two hooks that look alike are cheaper than one control that means two things.
 *
 * Only ids are held. The tree already has the titles, and a second source for
 * them would be a second thing to keep in step — and one that would have to
 * repeat the visibility check to be safe.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../api/client.ts';

export function useWatching(workspaceId: string | null): {
  ids: Set<string>;
  toggle: (pageId: string, watching: boolean) => Promise<void>;
  error: string | null;
} {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (workspaceId === null) return;
    try {
      const result = await api.watched(workspaceId);
      setIds(new Set(result.watched));
      setError(null);
    } catch (err) {
      /*
       * A failure leaves the set empty, which draws every bell as "not
       * watched".
       *
       * That is the honest wrong answer rather than a broken screen: the worst
       * it costs is somebody clicking a bell that was already on, which the
       * server takes as a no-op.
       */
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = useCallback(
    async (pageId: string, watching: boolean) => {
      // Moved first, put back on failure: a bell that waits for a round trip
      // feels broken, and this is a preference rather than a document edit.
      setIds((previous) => {
        const next = new Set(previous);
        if (watching) next.add(pageId);
        else next.delete(pageId);
        return next;
      });
      try {
        await api.setWatching(pageId, watching);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
        setIds((previous) => {
          const next = new Set(previous);
          if (watching) next.delete(pageId);
          else next.add(pageId);
          return next;
        });
      }
    },
    [],
  );

  return { ids, toggle, error };
}
