/**
 * SONE web — telling the surfaces that the threads changed (ADR-0151).
 *
 * The comment hook reads the threads out of a Yjs document; three things draw
 * them, and two of them are not React. The editor's marks are ProseMirror
 * decorations, which rebuild on a transaction and so have to be *told*; the PDF
 * viewer is a node view mounted from inside that editor, four layers below the
 * nearest place a prop could be handed down from. A window event has been the
 * message between them since ADR-0046. This is that event, given a home.
 *
 * It exists rather than a `dispatchEvent` in the hook for two reasons, and both
 * of them were faults rather than tidiness:
 *
 * **Two documents were shouting on one channel.** A page with a protected
 * section has a second comment document (ADR-0093), read by a second copy of the
 * hook, and both announced their own threads on the same event with no way to
 * tell them apart. Whichever ran last is what the editor drew — so opening a
 * page with internal comments redrew the public marks from a list of threads
 * whose anchors resolve against a different document, which is to say from
 * nothing. Every announcement now says which document it is about, and a
 * listener that only draws one document's threads can say so.
 *
 * **A listener that arrives late heard nothing.** An event is gone the moment it
 * is dispatched. The hook announces when the page opens; the viewer is mounted
 * later, by the editor, when a file block comes into view — so it missed every
 * announcement and drew no marks at all until somebody happened to write a
 * comment. The last announcement per document is kept, and a new subscriber is
 * given it at once.
 */

import type { CommentThread } from '@sone/core';

/** The event name, unchanged since ADR-0046 — and now written in one place. */
export const THREADS_CHANGED = 'sone:comments-changed';

export interface ThreadAnnouncement {
  /**
   * Which document these threads are in, by its Yjs guid.
   *
   * The guid rather than a page id: a page's public comments and its internal
   * ones share a page id and are two documents, which is the distinction that
   * was missing.
   */
  doc: string;
  threads: CommentThread[];
}

/**
 * What each document last said.
 *
 * Module state, which is state outside React and therefore worth being explicit
 * about: it is a cache of the last message, not a second copy of the truth. The
 * document is the truth; this is here so that somebody who was not listening
 * when it spoke does not have to wait for it to speak again.
 */
const latest = new Map<string, CommentThread[]>();

export function announceThreads(doc: string, threads: CommentThread[]): void {
  latest.set(doc, threads);
  window.dispatchEvent(
    new CustomEvent<ThreadAnnouncement>(THREADS_CHANGED, { detail: { doc, threads } }),
  );
}

/**
 * This document is closed.
 *
 * Called when the hook lets go of a document — navigating to another page, or
 * closing the protected section. Without it, a viewer mounted on the *next* page
 * would be replayed the last page's threads, and the marks would be somebody
 * else's comments drawn over this document.
 *
 * Nothing is dispatched: there is no news, only a page that is gone.
 */
export function forgetThreads(doc: string): void {
  latest.delete(doc);
}

/**
 * Listen, and hear what has already been said.
 *
 * The replay is the point. A subscriber is called once per document that has
 * announced, synchronously, before this returns — so a viewer can be written as
 * though the threads had always been there.
 */
export function subscribeToThreads(
  listener: (announcement: ThreadAnnouncement) => void,
): () => void {
  for (const [doc, threads] of latest) listener({ doc, threads });

  const on = (event: Event): void => {
    const detail = (event as CustomEvent<ThreadAnnouncement>).detail;
    if (!detail || typeof detail.doc !== 'string' || !Array.isArray(detail.threads)) return;
    listener(detail);
  };
  window.addEventListener(THREADS_CHANGED, on);
  return () => window.removeEventListener(THREADS_CHANGED, on);
}
