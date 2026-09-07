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

import type { CommentThread, PdfMark } from '@sone/core';

/**
 * One channel: what each document last said, and how to hear it (ADR-0152).
 *
 * Written once because there are now two of these — the threads and the marks
 * on a PDF — and they are the same three lines with a different payload. The
 * alternative was the same cache, the same replay and the same guard twice, and
 * the second copy is where a fix stops being applied to both.
 *
 * The listener's shape stays specific per channel, which is what the exported
 * wrappers below are for: `subscribeToThreads` hands back threads, not
 * `unknown`.
 */
function channel<T>(name: string): {
  announce: (doc: string, payload: T[]) => void;
  forget: (doc: string) => void;
  subscribe: (listener: (announcement: { doc: string; payload: T[] }) => void) => () => void;
} {
  /**
   * What each document last said.
   *
   * Module state, which is state outside React and therefore worth being
   * explicit about: it is a cache of the last message, not a second copy of the
   * truth. The document is the truth; this is here so that somebody who was not
   * listening when it spoke does not have to wait for it to speak again.
   */
  const latest = new Map<string, T[]>();

  return {
    announce: (doc, payload) => {
      latest.set(doc, payload);
      window.dispatchEvent(new CustomEvent(name, { detail: { doc, payload } }));
    },
    /*
     * This document is closed.
     *
     * Called when a hook lets go of a document — navigating to another page, or
     * closing the protected section. Without it, a surface mounted on the
     * *next* page would be replayed the last page's list and would draw
     * somebody else's marks over this document.
     *
     * Nothing is dispatched: there is no news, only a page that is gone.
     */
    forget: (doc) => void latest.delete(doc),
    subscribe: (listener) => {
      /*
       * The replay is the point. A subscriber is called once per document that
       * has announced, **synchronously, before this returns** — so a viewer can
       * be written as though the list had always been there.
       *
       * **Which means the listener runs inside its own subscriber's
       * constructor**, and that has cost an editor once (ADR-0154): the PDF
       * viewer subscribes halfway down `mountPdfViewer`, its listener reached a
       * `const` declared further down, and reading one in its dead zone is a
       * throw rather than an `undefined` — so the whole editor came down while
       * ProseMirror was building a node view.
       *
       * So: everything a listener touches must exist before `subscribe` is
       * called. Deferring the replay to a microtask would remove the hazard and
       * is not done, because it would also remove the guarantee — a subscriber
       * that must draw before the first paint would then draw a frame late.
       */
      for (const [doc, payload] of latest) listener({ doc, payload });

      const on = (event: Event): void => {
        const detail = (event as CustomEvent<{ doc?: unknown; payload?: unknown }>).detail;
        if (!detail || typeof detail.doc !== 'string' || !Array.isArray(detail.payload)) return;
        listener({ doc: detail.doc, payload: detail.payload as T[] });
      };
      window.addEventListener(name, on);
      return () => window.removeEventListener(name, on);
    },
  };
}

/** The event name, unchanged since ADR-0046 — and now written in one place. */
export const THREADS_CHANGED = 'sone:comments-changed';
/** And its counterpart for marks nobody has said anything about (ADR-0152). */
export const PDF_MARKS_CHANGED = 'sone:pdf-marks-changed';

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

export interface PdfMarkAnnouncement {
  doc: string;
  marks: PdfMark[];
}

const threads = channel<CommentThread>(THREADS_CHANGED);
const marks = channel<PdfMark>(PDF_MARKS_CHANGED);

export function announceThreads(doc: string, list: CommentThread[]): void {
  threads.announce(doc, list);
}

export function forgetThreads(doc: string): void {
  threads.forget(doc);
}

export function subscribeToThreads(
  listener: (announcement: ThreadAnnouncement) => void,
): () => void {
  return threads.subscribe(({ doc, payload }) => listener({ doc, threads: payload }));
}

export function announcePdfMarks(doc: string, list: PdfMark[]): void {
  marks.announce(doc, list);
}

export function forgetPdfMarks(doc: string): void {
  marks.forget(doc);
}

export function subscribeToPdfMarks(
  listener: (announcement: PdfMarkAnnouncement) => void,
): () => void {
  return marks.subscribe(({ doc, payload }) => listener({ doc, marks: payload }));
}
