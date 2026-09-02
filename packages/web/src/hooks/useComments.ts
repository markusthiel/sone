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
  start: (anchor: { from: Uint8Array; to: Uint8Array; quote: string }, text: string) => void;
  reply: (threadId: string, text: string) => void;
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
       * And tell the editor, from here rather than from a React effect.
       *
       * The marks are decorations, and decorations rebuild on a transaction —
       * so something has to dispatch one when a thread appears or goes. I had
       * that in an effect keyed on the threads prop, and deleting a thread left
       * its highlight in the text until a reload: the effect depends on props
       * reaching the editor and on my being right about when React re-renders,
       * and I was not able to say which of those failed.
       *
       * This does not depend on either. The document changed, so the thing that
       * noticed says so — the same channel the panel already uses to ask for a
       * passage to be revealed.
       */
      window.dispatchEvent(new CustomEvent('sone:comments-changed'));
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
    (anchor: { from: Uint8Array; to: Uint8Array; quote: string }, text: string) => {
      if (!doc || text.trim() === '') return;
      addThread(doc, {
        id: newId(),
        from: anchor.from,
        to: anchor.to,
        quote: anchor.quote,
        messageId: newId(),
        author: who.current,
        text: text.trim(),
      });
    },
    [doc],
  );

  const reply = useCallback(
    (threadId: string, text: string) => {
      if (!doc || text.trim() === '') return;
      addMessage(doc, threadId, { id: newId(), author: who.current, text: text.trim() });
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
      open: threads.filter((thread) => !thread.resolved && thread.range !== null),
      detached: threads.filter((thread) => !thread.resolved && thread.range === null),
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
