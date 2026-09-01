/**
 * SONE web — undo on a canvas (ADR-0043).
 *
 * `Y.UndoManager`, not a stack of our own like the table has (ADR-0034). The
 * table's stack exists because its edits are HTTP requests with no shared log to
 * walk back; a canvas is a CRDT, and Yjs already knows how to invert a change in
 * a way that survives other people's edits arriving in between.
 *
 * The decision that matters is *whose* changes it undoes. By default the manager
 * tracks transactions with no origin, which are exactly the local ones — an
 * update arriving from the network carries the provider as its origin and is
 * never tracked. So undo takes back what you did, and cannot reach across the
 * board and reverse somebody else's stroke. On a shared surface that is not a
 * detail: undo that undoes other people's work is undo nobody dares press.
 *
 * Scoped to the canvas map, so pressing undo on a board cannot walk back into
 * the page's title or its tags.
 */

import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { canvasMap } from '@sone/core';

export interface CanvasHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useCanvasHistory(doc: Y.Doc | null): CanvasHistory {
  const [manager, setManager] = useState<Y.UndoManager | null>(null);
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (!doc) {
      setManager(null);
      return;
    }
    const next = new Y.UndoManager(canvasMap(doc), {
      // Strokes drawn in quick succession are one act to the person drawing
      // them, and one press should take back the last thing they did rather
      // than the last thing they touched. Half a second is about the gap
      // between "still doing that" and "started something else".
      captureTimeout: 500,
    });
    const read = (): void =>
      setState({ canUndo: next.canUndo(), canRedo: next.canRedo() });

    read();
    next.on('stack-item-added', read);
    next.on('stack-item-popped', read);
    setManager(next);

    return () => {
      next.off('stack-item-added', read);
      next.off('stack-item-popped', read);
      next.destroy();
      setManager(null);
    };
  }, [doc]);

  return {
    undo: () => manager?.undo(),
    redo: () => manager?.redo(),
    canUndo: state.canUndo,
    canRedo: state.canRedo,
  };
}
