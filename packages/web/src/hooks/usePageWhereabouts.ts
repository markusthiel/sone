/**
 * SONE web — finding the page an address names, wherever it is (ADR-0175).
 *
 * A page address carries no workspace, deliberately (ADR-0016): *"the session
 * carries it, so a page moving between workspaces does not invalidate every
 * link to it"*. That is the right shape for an address and it leaves one
 * question open — **which workspace is this page in?** — which nobody was
 * asking.
 *
 * The consequence was a link that pointed at a real page and did not open it:
 * the sync client is built with one workspace in its credentials, and the
 * server refuses the room for anything else, correctly and first:
 *
 *     if (page.workspaceId !== claims.workspaceId) return null;
 *     // A page in another workspace is invisible regardless of grants.
 *
 * The interface then said *"you no longer have access to this page"*, which was
 * not true and pointed nowhere useful. The inbox met this and solved it by
 * carrying a workspace id **beside** the address; a link written in a document
 * cannot do that — it is only an address. So the address stays as it is, and
 * where it lives is looked up.
 *
 * ## The tree first, the server only when it has to be
 *
 * The ordinary case is a page in the workspace somebody is standing in, and the
 * tree already knows every entry in it. So the request happens only for an
 * address the tree does not account for, which is the cross-workspace case and
 * the archived-page case and nothing else.
 */

import { useEffect, useState } from 'react';

import { ApiError, api } from '../api/client.ts';

/** What was learned about a page, or null while nothing has been. */
export interface PageFound {
  pageId: string;
  /** Its workspace, or null when the server would not say — see `nowhere`. */
  workspaceId: string | null;
}

export type Whereabouts =
  /** Open it on the connection there is. */
  | { status: 'here' }
  /** The tree has not arrived; nothing is decided yet. */
  | { status: 'looking' }
  /** The tree does not account for it, so the server is being asked. */
  | { status: 'asking' }
  /** It is in another of this person's workspaces, and needs a switch. */
  | { status: 'elsewhere'; workspaceId: string }
  /** Gone, or never theirs. The server answers the same for both on purpose. */
  | { status: 'nowhere' };

/**
 * The decision, as a function of what is known.
 *
 * Separated from the effect that fetches so it can be stated without a network
 * or a React tree: every branch here is a rule, and the rules are the part
 * worth holding.
 */
export function whereabouts(input: {
  pageId: string | null;
  /** Whether the current workspace's tree lists it. */
  inTree: boolean;
  treeLoaded: boolean;
  workspaceId: string;
  found: PageFound | null;
}): Whereabouts {
  if (!input.pageId) return { status: 'here' };
  if (input.inTree) return { status: 'here' };
  if (!input.treeLoaded) return { status: 'looking' };

  /*
   * An answer about another page is not an answer.
   *
   * Two addresses in quick succession — following a link, then the back button
   * — and the first reply can arrive after the second question. Without this,
   * a stale answer switches the workspace out from under the page somebody is
   * now looking at.
   */
  if (!input.found || input.found.pageId !== input.pageId) return { status: 'asking' };

  if (input.found.workspaceId === null) return { status: 'nowhere' };
  if (input.found.workspaceId === input.workspaceId) {
    /*
     * In this workspace after all, and the tree simply does not list it.
     *
     * An archived page is the ordinary reason, and it is exactly what a link
     * written before it was archived points at. Answering "not here" for those
     * would be a link that stopped working for the wrong reason.
     */
    return { status: 'here' };
  }
  return { status: 'elsewhere', workspaceId: input.found.workspaceId };
}

/**
 * Where the page named by this address is, asking the server when it must.
 *
 * The caller opens the document only on `here` — which is what keeps the
 * connection from ever being asked for a room it will be refused.
 */
export function usePageWhereabouts(input: {
  pageId: string | null;
  inTree: boolean;
  treeLoaded: boolean;
  workspaceId: string;
}): Whereabouts {
  const [found, setFound] = useState<PageFound | null>(null);
  const { pageId, inTree, treeLoaded, workspaceId } = input;

  const asking = !!pageId && !inTree && treeLoaded;

  useEffect(() => {
    if (!asking || !pageId) return undefined;
    // Already answered for this page; a second request would learn the same
    // thing and could arrive out of order with a newer one.
    if (found?.pageId === pageId) return undefined;

    let live = true;
    void api
      .page(pageId)
      .then((page) => {
        if (live) setFound({ pageId, workspaceId: page.workspaceId });
      })
      .catch((error: unknown) => {
        if (!live) return;
        /*
         * A refusal is an answer: not there, or not theirs, and the server does
         * not distinguish them on purpose. Anything else — a dropped
         * connection, a proxy page — is not an answer, and leaving `found` null
         * keeps the state at `asking` rather than reporting a page as gone
         * because the network hiccuped.
         */
        const status = error instanceof ApiError ? error.status : 0;
        if (status === 404 || status === 403) setFound({ pageId, workspaceId: null });
      });
    return () => {
      live = false;
    };
  }, [asking, pageId, found]);

  return whereabouts({ pageId, inTree, treeLoaded, workspaceId, found });
}
