/**
 * SONE web — reading and writing a page's comment threads (ADR-0046).
 *
 * One place that knows how to read comments, so the panel, the marks in the text
 * and the count on the tab all see the same list. The threads live in the
 * document, so this is an observer rather than a fetch: a reply typed on somebody
 * else's laptop appears here by the same mechanism their typing does.
 *
 * Deep, because a thread's own keys are where a reply and a resolve land —
 * observing the map alone would miss everything except threads appearing and
 * disappearing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import {
  addMessage,
  addThread,
  isDetached,
  type PdfPlace,
  readThreads,
  removeMessage,
  removeThread,
  resolveThread,
  threadsMap,
  type CommentThread,
} from '@sone/core';

import { announceThreads, forgetThreads } from '../lib/threadAnnouncement.ts';

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface CommentActions {
  threads: CommentThread[];
  /** Open threads still anchored to text, which is what the margin draws. */
  open: CommentThread[];
  /** Threads whose text is gone. They keep their quotation (ADR-0046). */
  detached: CommentThread[];
  resolved: CommentThread[];
  start: (
    anchor: { from: Uint8Array; to: Uint8Array; quote: string },
    text: string,
    /** Who was named in it (ADR-0085). */
    mentions?: string[],
  ) => void;
  reply: (threadId: string, text: string, mentions?: string[]) => void;
  setResolved: (threadId: string, resolved: boolean) => void;
  removeOne: (threadId: string) => void;
  removeReply: (threadId: string, messageId: string) => void;
}

/**
 * How a message reaches the document when this person may not write it.
 *
 * `post` returns once the server has written the thread; the room's update bus
 * then sends it back over sync, so it arrives here by the same path a
 * colleague's would. Nothing has to be inserted locally and reconciled — which
 * is the version of this that produces two threads when the round trip is slow.
 */
export interface CommentTransport {
  start: (input: {
    from: Uint8Array;
    to: Uint8Array;
    quote: string;
    item?: string;
    /** A place in a PDF (ADR-0151). */
    place?: PdfPlace;
    text: string;
  }) => Promise<void>;
  reply: (threadId: string, text: string) => Promise<void>;
}

/**
 * @param transport used **instead of** writing the document, when given.
 *
 * The branch is here rather than at the call sites because there are several —
 * the panel's composer, the margin, the canvas — and each of them asking "may I
 * write this document" is how one of them ends up asking wrongly. They call
 * `start` and `reply`; which wire it goes down is this hook's business
 * (ADR-0090).
 */
export function useComments(
  doc: Y.Doc | null,
  author: string,
  transport?: CommentTransport | null,
): CommentActions {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  // The author of the next message. In a ref so the callbacks below do not have
  // to be rebuilt when a name changes — and so a reply cannot be attributed to
  // whoever the person was when the panel first rendered.
  const who = useRef(author);
  who.current = author;

  useEffect(() => {
    if (!doc) {
      setThreads([]);
      return;
    }
    const map = threadsMap(doc);
    const read = (): void => {
      setThreads(readThreads(doc));
      /*
       * And tell the surfaces — with the threads, not just that there are some.
       *
       * The marks are decorations, and decorations rebuild on a transaction, so
       * something has to dispatch one when a thread appears or goes.
       *
       * The announcement carries the list because of *when* it happens: this
       * runs synchronously inside the Yjs transaction, before React has
       * re-rendered, so anything reading a prop or a ref at that moment sees the
       * state from before the change. An empty event made the editor redraw the
       * *previous* list — which is why the very first comment on a page showed
       * no highlight at all until a reload, and why every later one was drawing
       * one change behind without it being obvious.
       *
       * And it says *which document*, which it did not (ADR-0151). A page with
       * a protected section runs a second copy of this hook over a second
       * document, and both were announcing on the same event with nothing to
       * tell them apart.
       */
      announceThreads(doc.guid, readThreads(doc));
    };
    read();
    map.observeDeep(read);
    // The anchors resolve against the document, so a thread's *range* changes
    // when the text changes even though the thread itself did not. Without this
    // the margin marks would sit still while the words moved.
    doc.on('update', read);
    return () => {
      map.unobserveDeep(read);
      doc.off('update', read);
      // And the announcement is retired with the document it was about, or a
      // surface mounted on the next page is replayed this one's threads.
      forgetThreads(doc.guid);
    };
  }, [doc]);

  const start = useCallback(
    (
      anchor: {
        from: Uint8Array;
        to: Uint8Array;
        quote: string;
        /** A canvas item, when the comment is about one (ADR-0046). */
        item?: string;
        /** A place in a PDF, when it is about one (ADR-0151). */
        place?: PdfPlace;
      },
      text: string,
      mentions?: string[],
    ) => {
      if (!doc || text.trim() === '') return;
      if (transport) {
        void transport.start({
          from: anchor.from,
          to: anchor.to,
          quote: anchor.quote,
          ...(anchor.item ? { item: anchor.item } : {}),
          ...(anchor.place ? { place: anchor.place } : {}),
          text: text.trim(),
        });
        return;
      }
      addThread(doc, {
        id: newId(),
        from: anchor.from,
        to: anchor.to,
        ...(anchor.item ? { item: anchor.item } : {}),
        ...(anchor.place ? { place: anchor.place } : {}),
        quote: anchor.quote,
        messageId: newId(),
        author: who.current,
        text: text.trim(),
        // Who was named (ADR-0085). The field has existed since ADR-0052 and
        // nothing could ever set it, so the notification kind, the mail
        // preference and the inbox filter were all in place with nothing able
        // to produce one.
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
      });
    },
    [doc, transport],
  );

  const reply = useCallback(
    (threadId: string, text: string, mentions?: string[]) => {
      if (!doc || text.trim() === '') return;
      if (transport) {
        void transport.reply(threadId, text.trim());
        return;
      }
      addMessage(doc, threadId, {
        id: newId(),
        author: who.current,
        text: text.trim(),
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
      });
    },
    [doc, transport],
  );

  const setResolved = useCallback(
    (threadId: string, resolved: boolean) => {
      if (!doc) return;
      resolveThread(doc, threadId, resolved, who.current);
    },
    [doc],
  );

  const removeOne = useCallback(
    (threadId: string) => {
      if (doc) removeThread(doc, threadId);
    },
    [doc],
  );

  const removeReply = useCallback(
    (threadId: string, messageId: string) => {
      if (doc) removeMessage(doc, threadId, messageId);
    },
    [doc],
  );

  const grouped = useMemo(
    () => ({
      /*
       * "Detached" means the text a comment pointed at is gone.
       *
       * A thread about a canvas item has no range by design (ADR-0046), so a
       * bare `range === null` would have filed every canvas comment under "the
       * text is gone" — an accusation rather than a fact. The item's own
       * existence is what a canvas thread depends on, and an item that is
       * deleted takes its thread's subject with it visibly.
       *
       * **The two are complements, and are now written as complements**
       * (ADR-0151). They were two separate expressions, and the third anchor
       * satisfied neither: a thread about a place in a PDF has no item and no
       * range, so it appeared in no group the panel draws — a comment somebody
       * wrote and nobody could see. One sentence, in `isDetached`, and this
       * asks it once each way.
       */
      open: threads.filter(
        (thread) => !thread.resolved && !isDetached(thread),
      ),
      detached: threads.filter(
        (thread) => !thread.resolved && isDetached(thread),
      ),
      resolved: threads.filter((thread) => thread.resolved),
    }),
    [threads],
  );

  return {
    threads,
    ...grouped,
    start,
    reply,
    setResolved,
    removeOne,
    removeReply,
  };
}
