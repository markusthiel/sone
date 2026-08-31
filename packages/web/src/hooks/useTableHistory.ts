/**
 * SONE web — undoing what a collection table just did (ADR-0034).
 *
 * Not the editor's undo and not the CRDT's. A collection's edits go over HTTP to
 * the projection rather than into the Yjs document the page is written in, so
 * `Ctrl+Z` in the page has nothing to reverse them with — and one paste creating
 * fifty pages is not something a text undo stack should be asked to model.
 *
 * So: a stack of this table's own operations, in this browser, since it was
 * opened. Every entry knows both directions, which is what makes redo free —
 * archiving and restoring are each other's inverse, and a cell write is a write
 * back. Nothing here needs to know what the operation *was*, only how to go
 * either way.
 *
 * Bounded and local, and honest about it: emptied on reload, and it does not
 * attempt to undo somebody else's edit. There is one case where that is visibly
 * wrong — somebody changes a cell, then you undo your own earlier edit to it and
 * their value goes — and it is accepted, because the alternative is either no
 * undo at all or a shared history, which is a different feature and mostly a way
 * to surprise two people at once.
 */

import { useCallback, useRef, useState } from 'react';

export interface HistoryEntry {
  /** Named for a person: "paste 12 entries", "empty the table". */
  label: string;
  /** Do it again. */
  forward: () => Promise<void>;
  /** Put it back. */
  backward: () => Promise<void>;
}

/**
 * How many operations are kept.
 *
 * Deep enough to get out of a mistake, shallow enough that it is a safety net
 * rather than a document history — which is what the CRDT log is, and which this
 * must not pretend to be.
 */
export const HISTORY_DEPTH = 20;

export interface History {
  /** Record something already done. Clears anything that had been undone. */
  push: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /** What undo would reverse, for the button's title. */
  undoLabel: string | null;
  redoLabel: string | null;
  busy: boolean;
}

export function useTableHistory(onError: (code: string) => void): History {
  // The stack in a ref and the labels in state.
  //
  // The ref is what `undo` reads, because reading state inside a callback that
  // is also what updates it is how a correct undo occasionally does nothing —
  // the same mistake the drag hook records.
  const stack = useRef<HistoryEntry[]>([]);
  const cursor = useRef(0);
  const [labels, setLabels] = useState<{ undo: string | null; redo: string | null }>({
    undo: null,
    redo: null,
  });
  const [busy, setBusy] = useState(false);

  const publish = useCallback(() => {
    setLabels({
      undo: cursor.current > 0 ? (stack.current[cursor.current - 1]?.label ?? null) : null,
      redo:
        cursor.current < stack.current.length
          ? (stack.current[cursor.current]?.label ?? null)
          : null,
    });
  }, []);

  const push = useCallback(
    (entry: HistoryEntry) => {
      // Anything undone is discarded, as every undo stack does: doing something
      // new after going back means the branch you went back from is gone.
      stack.current = [...stack.current.slice(0, cursor.current), entry].slice(-HISTORY_DEPTH);
      cursor.current = stack.current.length;
      publish();
    },
    [publish],
  );

  const step = useCallback(
    async (direction: 'undo' | 'redo') => {
      const at = direction === 'undo' ? cursor.current - 1 : cursor.current;
      const entry = stack.current[at];
      if (!entry || busy) return;

      setBusy(true);
      try {
        await (direction === 'undo' ? entry.backward() : entry.forward());
        cursor.current = direction === 'undo' ? at : at + 1;
        publish();
      } catch {
        // Left where it was on failure. An entry that has been consumed but not
        // applied is worse than a button that did nothing: the next press would
        // reverse the wrong operation.
        onError('network_error');
      } finally {
        setBusy(false);
      }
    },
    [busy, onError, publish],
  );

  return {
    push,
    undo: useCallback(() => step('undo'), [step]),
    redo: useCallback(() => step('redo'), [step]),
    undoLabel: labels.undo,
    redoLabel: labels.redo,
    busy,
  };
}
