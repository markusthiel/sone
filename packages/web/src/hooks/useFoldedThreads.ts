/**
 * SONE web — which comment threads are folded (ADR-0046).
 *
 * Remembered, because folding a thread is something somebody did on purpose and
 * a reload undoing it is the application forgetting an instruction.
 *
 * Three places it could live, and only one is right:
 *
 * *In the document* would let one person fold a thread for everybody, and a
 * page's comments are not one reader's business to hide. That is the same
 * argument the mark switch makes.
 *
 * *On the account* would follow somebody between a phone and a desk, where the
 * amount of panel they want is not the same.
 *
 * *In the browser*, keyed by page, which is where view state belongs.
 *
 * A set of the *closed* threads rather than the open ones, so a thread that
 * arrives while nobody is looking is open. A new comment hidden by a preference
 * somebody set last week is a comment nobody reads.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sone.foldedComments';
/**
 * How many pages are remembered.
 *
 * Bounded, because this grows for ever otherwise: every page anybody folds a
 * thread on leaves an entry, and a page that has been deleted leaves one that
 * can never be cleaned up by anything that knows what it is. The pages nobody
 * has touched in thirty visits are the ones whose folding nobody remembers
 * either.
 */
const MAX_PAGES = 30;

type Stored = Record<string, string[]>;

function readAll(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Stored = {};
    for (const [page, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(ids)) out[page] = ids.filter((id): id is string => typeof id === 'string');
    }
    return out;
  } catch {
    // Unreadable or refused. A panel that will not open because a preference
    // could not be parsed is worse than a panel that forgot one.
    return {};
  }
}

export function useFoldedThreads(
  pageId: string | null,
  /** The threads that exist now, so ids for deleted ones are not kept. */
  existing: string[],
): {
  closed: Set<string>;
  toggle: (threadId: string) => void;
  setAll: (closed: boolean) => void;
} {
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!pageId) {
      setClosed(new Set());
      return;
    }
    const stored = readAll()[pageId] ?? [];
    // Intersected with what is actually there: a thread deleted while somebody
    // was away should not leave an id that quietly folds a *different* thread
    // if ids were ever reused, and should not be written back for ever either.
    setClosed(new Set(stored.filter((id) => existing.includes(id))));
    // Deliberately not keyed on `existing`: this reads the stored set when the
    // page changes, and re-reading it every time a thread appears would undo
    // whatever somebody has folded since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const persist = useCallback(
    (next: Set<string>) => {
      if (!pageId) return;
      try {
        const all = readAll();
        const kept = [...next].filter((id) => existing.includes(id));
        if (kept.length === 0) delete all[pageId];
        else all[pageId] = kept;

        // Newest last, oldest dropped. `pageId` is re-inserted above, so it is
        // always among the survivors.
        const pages = Object.keys(all);
        for (const page of pages.slice(0, Math.max(0, pages.length - MAX_PAGES))) {
          delete all[page];
        }
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        // Folded for this session and not remembered, which is the state this
        // hook replaced. Better than refusing to fold.
      }
    },
    [pageId, existing],
  );

  const toggle = useCallback(
    (threadId: string) => {
      setClosed((current) => {
        const next = new Set(current);
        if (next.has(threadId)) next.delete(threadId);
        else next.add(threadId);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setAll = useCallback(
    (shut: boolean) => {
      const next = shut ? new Set(existing) : new Set<string>();
      setClosed(next);
      persist(next);
    },
    [existing, persist],
  );

  return { closed, toggle, setAll };
}
