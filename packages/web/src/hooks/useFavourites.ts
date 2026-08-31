/**
 * SONE web — the caller's favourites, in the workspace being looked at.
 *
 * Kept separate from the page tree because they are separate data: the tree is
 * the workspace's and comes from the CRDT projection, favourites are one
 * person's and live only in Postgres.
 *
 * Asked for per workspace, though. The list spans every workspace somebody
 * belongs to — which is right for the data and wrong for a sidebar, since a
 * sidebar is a view of one workspace. Unscoped, it showed shortcuts to pages
 * this session cannot open, and the refusal read as "you no longer have access
 * to this page" rather than "that page is somewhere else".
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api, type FavouriteEntry } from '../api/client.ts';

export function useFavourites(workspaceId: string | null): {
  favourites: FavouriteEntry[];
  ids: Set<string>;
  toggle: (pageId: string, favourite: boolean) => Promise<void>;
  error: string | null;
} {
  const [favourites, setFavourites] = useState<FavouriteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (workspaceId === null) return;
    try {
      const result = await api.favourites(workspaceId);
      setFavourites(result.favourites);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
    // Reloaded when the workspace changes, not only when it appears: switching
    // used to leave the previous workspace's shortcuts in the sidebar.
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = useCallback(
    async (pageId: string, favourite: boolean) => {
      // Applied first, so the star responds to the tap rather than after a round
      // trip. Reverted by the reload if the request fails.
      setFavourites((previous) =>
        favourite
          ? previous
          : previous.filter((entry) => entry.pageId !== pageId),
      );

      try {
        await api.setFavourite(pageId, favourite);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
      // Reloaded either way: on success to pick up the title and order the
      // server assigned, on failure to undo the optimistic removal.
      await reload();
    },
    [reload],
  );

  return {
    favourites,
    // A set, because the sidebar asks "is this one" for every row it draws.
    ids: new Set(favourites.map((entry) => entry.pageId)),
    toggle,
    error,
  };
}
