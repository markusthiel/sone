/**
 * SONE web — the pages a `[[` can reach, across every workspace (ADR-0176).
 *
 * ## Why one list and not a search
 *
 * What makes the picker feel like part of typing is that it filters in memory:
 * `[[` and the list is there, another character and it narrows, with nothing in
 * between. A request per keystroke would put a network in the middle of that,
 * and a debounce would put a pause in it.
 *
 * So the list is fetched once — when a picker first opens, not on every page —
 * and kept for the session. The cap is on the server and is stated there: past
 * it, the rows are the most recently edited, and somebody with more pages than
 * that would need the picker to become a search.
 *
 * ## Why the cache is module-level
 *
 * The picker is mounted per page, so a hook holding this in state would refetch
 * on every page somebody opens. What is being cached is an answer about the
 * person, not about the page they happen to be reading.
 *
 * Nothing invalidates it. A page created in another workspace during this
 * session will not appear until a reload — which is the trade this makes for
 * never pausing while somebody types, and it is the same trade the members list
 * makes for the assignee picker.
 */

import { useEffect, useState } from 'react';

import { api } from '../api/client.ts';
import type { LinkablePage } from '../components/PageLinkMenu.tsx';

let cached: LinkablePage[] | null = null;
let inFlight: Promise<LinkablePage[]> | null = null;

/** Forget it, so the next asker fetches again. For tests and a logout. */
export function forgetLinkTargets(): void {
  cached = null;
  inFlight = null;
}

async function load(): Promise<LinkablePage[]> {
  if (cached) return cached;
  // One request even when three pickers ask at once, which is what a person
  // switching pages quickly produces.
  inFlight ??= api
    .linkTargets()
    .then((answer) => {
      cached = answer.pages.map((page) => ({
        id: page.id,
        title: page.title,
        parentPageId: page.parentPageId,
        kind: page.kind,
        workspaceId: page.workspaceId,
        workspaceName: page.workspaceName,
      }));
      return cached;
    })
    .catch(() => {
      // Not cached as empty: a dropped request should be retried by the next
      // asker, not remembered as "there is nothing to link to".
      inFlight = null;
      return [];
    });
  return inFlight;
}

/**
 * Every page this person may link to, or the empty list until it arrives.
 *
 * `wanted` is whether a picker is actually open. Nothing is fetched on a page
 * nobody links from.
 */
export function useLinkTargets(wanted: boolean): readonly LinkablePage[] {
  const [pages, setPages] = useState<readonly LinkablePage[]>(cached ?? []);

  useEffect(() => {
    if (!wanted) return undefined;
    if (cached) {
      setPages(cached);
      return undefined;
    }
    let live = true;
    void load().then((all) => {
      if (live) setPages(all);
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  return pages;
}
