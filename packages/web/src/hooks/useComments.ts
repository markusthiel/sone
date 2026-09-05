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
  readThreads,
  removeMessage,
  removeThread,
  resolveThread,
  threadsMap,
  type CommentThread,
} from '@sone/core';

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

export function useComments(doc: Y.Doc | null, author: string): CommentActions {
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
       * And tell the editor — with the threads, not just that there are some.
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
       */
      window.dispatchEvent(
        new CustomEvent('sone:comments-changed', { detail: readThreads(doc) }),
      );
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
      },
      text: string,
      mentions?: string[],
    ) => {
      if (!doc || text.trim() === '') return;
      addThread(doc, {
        id: newId(),
        from: anchor.from,
        to: anchor.to,
        ...(anchor.item ? { item: anchor.item } : {}),
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
    [doc],
  );

  const reply = useCallback(
    (threadId: string, text: string, mentions?: string[]) => {
      if (!doc || text.trim() === '') return;
      addMessage(doc, threadId, {
        id: newId(),
        author: who.current,
        text: text.trim(),
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
      });
    },
    [doc],
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
       * A thread about a canvas item has no range by design (ADR-0046), so
       * without the first term every canvas comment would have been filed under
       * "the text is gone" — an accusation rather than a fact. The item's own
       * existence is what a canvas thread depends on, and an item that is
       * deleted takes its thread's subject with it visibly.
       */
      open: threads.filter(
        (thread) => !thread.resolved && (thread.item !== null || thread.range !== null),
      ),
      detached: threads.filter(
        (thread) => !thread.resolved && thread.item === null && thread.range === null,
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
