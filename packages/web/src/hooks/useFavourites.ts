/**
 * SONE web — the caller's favourites.
 *
 * Kept separate from the page tree because they are separate data: the tree is
 * the workspace's and comes from the CRDT projection, favourites are one
 * person's and live only in Postgres. Merging them into one request would tie a
 * shortcut list to a workspace it may point out of.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api, type FavouriteEntry } from '../api/client.ts';

export function useFavourites(enabled: boolean): {
  favourites: FavouriteEntry[];
  ids: Set<string>;
  toggle: (pageId: string, favourite: boolean) => Promise<void>;
  error: string | null;
} {
  const [favourites, setFavourites] = useState<FavouriteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await api.favourites();
      setFavourites(result.favourites);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [enabled]);

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
