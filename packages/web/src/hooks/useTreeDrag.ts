/**
 * SONE web — dragging entries in the tree.
 *
 * This replaces the HTML5 drag-and-drop it used to use. That never worked on
 * iOS — Safari does not fire those events — and I argued the picker was
 * sufficient there. It was not: the picker moves an entry *into* a folder and
 * cannot reorder, so the device this is mostly used from had no way to reorder
 * at all. "Other apps manage it" was the right answer.
 *
 * ## What is here, and what is not
 *
 * Only the tree's own rules: which row a point falls in, whether that means
 * before, inside or after it, and which of those are worth offering. The
 * gesture — hold versus scroll, when capture is taken, suppressing the click
 * that follows — lives in usePointerDrag, because the board needs it too and
 * every mistake this project has made in dragging was in that half.
 *
 * The row under the pointer is looked up with `elementFromPoint` rather than
 * listened for: during a captured pointer sequence every event is delivered to
 * the element that started it.
 */

import { usePointerDrag } from './usePointerDrag.ts';

export type DropIntent = 'before' | 'into' | 'after';

export interface DropPosition {
  rowId: string;
  intent: DropIntent;
}

export interface TreeDragOptions {
  /** Whether a drop at this position is allowed; drives the indicator. */
  canDrop: (draggedId: string, position: DropPosition) => boolean;
  onDrop: (draggedId: string, position: DropPosition) => void;
}

export interface TreeDrag {
  /** Attach to each row, along with `data-tree-row`. */
  onPointerDown: (event: React.PointerEvent) => void;
  /** The entry being dragged, once the gesture has committed to being one. */
  dragging: string | null;
  /** Where it would land, or null. */
  target: DropPosition | null;
  /**
   * Where the pointer is, for drawing the entry under it.
   *
   * The indicator lines say where a drop lands; they do not say what is
   * travelling. HTML5 dragging drew the element under the cursor for free, and
   * losing that made the gesture harder to read — so the position is exposed
   * and the tree draws its own.
   */
  pointer: { x: number; y: number } | null;
}

/** Read the row under a point, and where within it. */
function positionAt(x: number, y: number): DropPosition | null {
  const element = document.elementFromPoint(x, y);
  const row = element?.closest<HTMLElement>('[data-tree-row]');
  if (!row) return null;

  const rowId = row.dataset['treeRow'];
  if (!rowId) return null;

  const box = row.getBoundingClientRect();
  const offset = (y - box.top) / box.height;

  // A folder has an inside, so it gets a middle band. A page does not, so its
  // row splits in half and every drop beside it reorders.
  const edge = row.dataset['treeKind'] === 'folder' ? 0.3 : 0.5;
  const intent: DropIntent =
    offset < edge ? 'before' : offset > 1 - edge ? 'after' : 'into';

  if (intent !== 'before') return { rowId, intent };

  // "Before this row" and "after the one above it" are the same place when the
  // two are siblings — so one gap had two owners, and the two bands drew two
  // lines a few pixels apart. It looked like two places to drop between two
  // folders, because that is what it was.
  //
  // Collapsed onto the row above, which owns the gap below itself. Only for a
  // sibling: at a nesting boundary the gap genuinely has two meanings — after
  // the last child of the folder above, or before this entry at the outer
  // level — and those are different destinations rather than one drawn twice.
  const rows = [...document.querySelectorAll<HTMLElement>('[data-tree-row]')];
  const at = rows.indexOf(row);
  const previous = at > 0 ? rows[at - 1] : undefined;

  if (
    previous &&
    previous.dataset['treeParent'] === row.dataset['treeParent'] &&
    previous.dataset['treeRow']
  ) {
    return { rowId: previous.dataset['treeRow'], intent: 'after' };
  }

  return { rowId, intent };
}

/**
 * Would this drop leave the entry exactly where it already is?
 *
 * The gaps immediately above and below a row are its own position. Marking them
 * offers a move that changes nothing, and a test caught the sharper version of
 * the same mistake: the gap below the dragged row normalises to "after itself",
 * which is not a position at all.
 *
 * Read from the DOM because that is where the rendered order lives, and the
 * rendered order is what somebody is aiming at.
 */
function isNoop(draggedId: string, where: DropPosition): boolean {
  if (where.rowId === draggedId) return true;

  const rows = [...document.querySelectorAll<HTMLElement>('[data-tree-row]')];
  const dragged = rows.findIndex((row) => row.dataset['treeRow'] === draggedId);
  const target = rows.findIndex((row) => row.dataset['treeRow'] === where.rowId);
  if (dragged === -1 || target === -1) return false;

  const sameParent =
    rows[dragged]!.dataset['treeParent'] === rows[target]!.dataset['treeParent'];
  if (!sameParent) return false;

  // Directly above, dropping after it; or directly below, dropping before it.
  if (where.intent === 'after' && target === dragged - 1) return true;
  if (where.intent === 'before' && target === dragged + 1) return true;
  return false;
}

export function useTreeDrag(options: TreeDragOptions): TreeDrag {
  return usePointerDrag<DropPosition>({
    idFrom: (element) => element.dataset['treeRow'] ?? null,
    targetAt: (x, y, draggedId) => {
      const where = positionAt(x, y);
      // A drop that would leave the entry where it is offers nothing, and the
      // gap below it normalises to "after itself", which is not a position.
      if (where === null || isNoop(draggedId, where)) return null;
      return where;
    },
    canDrop: options.canDrop,
    onDrop: options.onDrop,
  });
}
