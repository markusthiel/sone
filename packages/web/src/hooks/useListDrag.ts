/**
 * SONE web — dragging rows in a flat list.
 *
 * The switcher's rows are a list somebody arranges (ADR-0031), and a list is not
 * a tree: there is no inside, no nesting boundary, and every row is a sibling of
 * every other. `useTreeDrag` answers a harder question and answers it with a
 * document-wide `[data-tree-row]` lookup, so reusing it in a panel that floats
 * over the sidebar would let the tree's rows become drop targets for a workspace.
 *
 * So this is a second consumer of `usePointerDrag` rather than a generalisation
 * of the tree's hook. The gesture — hold versus scroll, pointer capture,
 * swallowing the click that follows — is the shared part, and it is the part
 * every dragging bug in this project has been in.
 *
 * Rows are scoped to one container, and carry `data-list-row="<id>"`.
 */

import type { RefObject } from 'react';

import { usePointerDrag } from './usePointerDrag.ts';

/**
 * Where a drop would land: directly after `afterId`, or first when null.
 *
 * One field, not a row plus an intent. A flat list's gaps are the only
 * destinations, and naming a gap by the row above it means each gap has exactly
 * one name — the thing the tree had to normalise towards after drawing two lines
 * a few pixels apart for one gap.
 */
export interface ListDropPosition {
  afterId: string | null;
}

export interface ListDragOptions {
  /** The element the rows live in; nothing outside it is a target. */
  container: RefObject<HTMLElement | null>;
  onDrop: (draggedId: string, position: ListDropPosition) => void;
}

export interface ListDrag {
  /** Attach to each row, along with `data-list-row`. */
  onPointerDown: (event: React.PointerEvent) => void;
  /** The row being dragged, once the gesture has committed to being one. */
  dragging: string | null;
  /** Where it would land, or null when nowhere useful. */
  target: ListDropPosition | null;
  /** Where the pointer is, for drawing what is travelling. */
  pointer: { x: number; y: number } | null;
}

function rowsIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>('[data-list-row]')];
}

export function useListDrag(options: ListDragOptions): ListDrag {
  const { container, onDrop } = options;

  const drag = usePointerDrag<ListDropPosition>({
    idFrom: (element) => element.dataset['listRow'] ?? null,

    targetAt: (x, y, draggedId) => {
      const root = container.current;
      const element = document.elementFromPoint(x, y);
      const row = element?.closest<HTMLElement>('[data-list-row]');
      // Read from the DOM, and confined to this container: a panel floating over
      // the page tree would otherwise accept the tree's rows as destinations.
      if (!row || !root?.contains(row)) return null;

      const rows = rowsIn(root);
      const at = rows.indexOf(row);
      const dragged = rows.findIndex((candidate) => candidate.dataset['listRow'] === draggedId);
      if (at === -1 || dragged === -1) return null;

      // The top half of a row means the gap above it, which is the gap below the
      // row before — one gap, one name.
      const box = row.getBoundingClientRect();
      const above = (y - box.top) / box.height < 0.5;
      const index = above ? at - 1 : at;

      // Its own two gaps change nothing. Offering them promises a move and then
      // does not make one, which reads as the drop having been lost.
      if (index === dragged || index === dragged - 1) return null;

      return { afterId: index < 0 ? null : (rows[index]!.dataset['listRow'] ?? null) };
    },

    // Every position this produces is already a real move; the filtering happens
    // above, where the indices are in hand.
    canDrop: () => true,
    onDrop,
  });

  return drag;
}
