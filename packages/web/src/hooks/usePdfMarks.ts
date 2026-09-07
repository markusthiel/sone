/**
 * SONE web — reading and writing the marks on a PDF (ADR-0152).
 *
 * The same shape as `useComments`, deliberately, because it is the same
 * arrangement: the marks live in the page's document, so this is an observer
 * rather than a fetch, and somebody who may mark but may not write the document
 * goes down a transport instead (ADR-0090).
 *
 * It is a second hook rather than more of the first one because a mark is not a
 * thread. The panel lists what was *said*; a mark says nothing, and folding it
 * into the comment list would mean every reader of that list asking "and does
 * this one have anything in it" — which is the shape ADR-0046 refused to store
 * in the first place.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';

import {
  addPdfMark,
  pdfMarksMap,
  readPdfMarks,
  removePdfMark,
  type PdfMark,
  type PdfPlace,
} from '@sone/core';

import { announcePdfMarks, forgetPdfMarks } from '../lib/threadAnnouncement.ts';

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Used **instead of** writing the document, when given. See `useComments`. */
export interface PdfMarkTransport {
  add: (input: { place: PdfPlace; quote: string }) => Promise<void>;
  remove: (markId: string) => Promise<void>;
}

export interface PdfMarkActions {
  marks: PdfMark[];
  add: (place: PdfPlace, quote: string) => void;
  remove: (markId: string) => void;
}

export function usePdfMarks(
  doc: Y.Doc | null,
  author: string,
  transport?: PdfMarkTransport | null,
): PdfMarkActions {
  const [marks, setMarks] = useState<PdfMark[]>([]);
  // In a ref for `useComments`'s reason: the callbacks below must not be
  // rebuilt when a name changes, and a mark must not be signed with whoever the
  // person was when the page first rendered.
  const who = useRef(author);
  who.current = author;

  useEffect(() => {
    if (!doc) {
      setMarks([]);
      return;
    }
    const map = pdfMarksMap(doc);
    const read = (): void => {
      const list = readPdfMarks(doc);
      setMarks(list);
      /*
       * And tell the viewer, which is not a React child of anything here: it is
       * a ProseMirror node view mounted four layers down, and the announcement
       * is how ADR-0151 already reaches it. The list travels with the message
       * because this runs inside the Yjs transaction, before React re-renders.
       */
      announcePdfMarks(doc.guid, list);
    };
    read();
    map.observeDeep(read);
    return () => {
      map.unobserveDeep(read);
      // Retired with the document it was about, or a viewer mounted on the next
      // page is replayed this one's marks.
      forgetPdfMarks(doc.guid);
    };
  }, [doc]);

  /*
   * No `doc.on('update')` here, and that is the difference from `useComments`.
   *
   * A thread's *range* changes when the text changes, because its anchor
   * resolves against the document — so that hook has to re-read on every edit.
   * A place cannot move: it names a file whose bytes are fixed and a rectangle
   * in that file's own coordinates (ADR-0151). Observing the map is enough, and
   * re-reading every mark on every keystroke would be work for a number that
   * cannot have changed.
   */

  const add = useCallback(
    (place: PdfPlace, quote: string): void => {
      if (transport) {
        void transport.add({ place, quote });
        return;
      }
      if (!doc) return;
      addPdfMark(doc, { id: newId(), place, quote, author: who.current });
    },
    [doc, transport],
  );

  const remove = useCallback(
    (markId: string): void => {
      if (transport) {
        void transport.remove(markId);
        return;
      }
      if (!doc) return;
      removePdfMark(doc, markId);
    },
    [doc, transport],
  );

  return useMemo(() => ({ marks, add, remove }), [marks, add, remove]);
}
