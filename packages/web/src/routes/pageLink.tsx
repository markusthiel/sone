/**
 * SONE web — a link to a page, in whatever way this person is here (ADR-0113).
 *
 * `paths.ts` has stated the rule since ADR-0016, in its own header:
 *
 * > A share link keeps its prefix while navigating its subtree, or clicking a
 * > subpage drops the credential and hits a login wall mid-document.
 *
 * It was stated and not enforced. `paths.page()` and `paths.sharePage()` are two
 * functions, every component called the first one, and `paths.sharePage` had
 * **no callers at all** — the only correct builder in the codebase was dead
 * code, while the one place that needed it built the string by hand.
 *
 * So the mode is not a parameter any more. A component asks for a link to a
 * page and gets one that works where it is standing, because the token is in
 * context rather than in an argument somebody has to remember to pass.
 *
 * `scripts/check-page-links.mjs` keeps it that way: outside this directory,
 * `paths.page(` is not available to be called.
 *
 * ## Why a context and not a prop
 *
 * The bug was a prop that was never threaded. `FolderView` is rendered by the
 * share view and by the workspace shell and had no idea which; the collection
 * table, the gallery, the board, a relation cell and the editor's own container
 * link are all *page body* content with the same problem, several layers below
 * whoever knows the answer. A prop would have to reach every one of them
 * correctly, which is the arrangement ADR-0087 named: a parameter every caller
 * has to compute correctly is a parameter one caller computes wrongly.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react';

import { paths } from './paths.ts';

/**
 * The share token this subtree is being read through, or null.
 *
 * Null is the ordinary case — a signed-in member in the workspace shell — and
 * it is the default, so a component mounted anywhere gets workspace links
 * without anybody arranging it.
 */
const ShareTokenContext = createContext<string | null>(null);

export function ShareTokenProvider({
  token,
  children,
}: {
  token: string;
  children: ReactNode;
}): ReactNode {
  return <ShareTokenContext.Provider value={token}>{children}</ShareTokenContext.Provider>;
}

/** The token, for the rare caller that needs to know rather than to link. */
export const useShareToken = (): string | null => useContext(ShareTokenContext);

/** How to link to a page from here. */
export type PageLink = (pageId: string, title?: string, blockId?: string | null) => string;

/**
 * A function that builds a link to a page, correct for this place.
 *
 * Memoised on the token, so it can sit in an effect's dependency array without
 * re-running it on every render — which is where two of the call sites are.
 */
export function usePageLink(): PageLink {
  const token = useContext(ShareTokenContext);
  return useCallback(
    (pageId, title, blockId) =>
      token
        ? paths.sharePage(token, pageId, title, blockId)
        : paths.page(pageId, title, blockId),
    [token],
  );
}
