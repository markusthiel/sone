/**
 * SONE web — dragging entries, with a finger or a mouse.
 *
 * This replaces the HTML5 drag-and-drop it used to use. That never worked on
 * iOS — Safari does not fire those events — and I argued the picker was
 * sufficient there. It was not: the picker moves an entry *into* a folder and
 * cannot reorder, so the device this is mostly used from had no way to reorder
 * at all. "Other apps manage it" was the right answer.
 *
 * ## Telling a drag from a scroll
 *
 * The one hard problem. A sidebar has to scroll, and both gestures start
 * identically: a finger touches a row and moves.
 *
 * The answer every touch interface uses is time. A press that stays still for a
 * moment is a drag; a press that moves before then is a scroll. So:
 *
 *   - Touch: the drag begins after HOLD_MS of not moving more than SLOP px. Any
 *     earlier movement cancels it and the browser scrolls as usual, because
 *     nothing has been prevented yet.
 *   - Mouse: no hold. A pointer with a button down that moves past SLOP is
 *     unambiguous — there is no competing gesture to protect.
 *
 * Once a drag begins, a document-level `touchmove` listener with
 * `passive: false` prevents the page from scrolling underneath it. That
 * listener is added at that moment and removed when the drag ends, so a tree
 * that is not being dragged scrolls normally. `touch-action` cannot do this
 * job: it is read when the gesture starts, and at that point we do not yet know
 * which gesture it is.
 *
 * ## Where the drop lands
 *
 * From `elementFromPoint` rather than from the events of the element under the
 * finger, because during a captured pointer sequence every event is delivered
 * to the element that started it. The row under the pointer has to be looked
 * up, not listened for.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a finger must stay put before a drag begins. */
const HOLD_MS = 350;
/** How far it may move in that time and still count as staying put. */
const SLOP = 8;

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
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<DropPosition | null>(null);

  // The same two values in refs.
  //
  // State drives the render; the refs are what `finish` reads. Reading state
  // inside a setState updater — and dispatching the drop from there — is a
  // side effect in a place React may run more than once or defer, and it made
  // a correct drop occasionally do nothing. The rendered indicator and the
  // committed drop must agree, so they come from one source that is readable
  // synchronously.
  const draggingRef = useRef<string | null>(null);
  const targetRef = useRef<DropPosition | null>(null);

  const setDraggingBoth = useCallback((value: string | null) => {
    draggingRef.current = value;
    setDragging(value);
  }, []);

  const setTargetBoth = useCallback((value: DropPosition | null) => {
    targetRef.current = value;
    setTarget(value);
  }, []);

  // Everything the gesture needs, in a ref: the listeners below are registered
  // once per drag and must not close over stale state.
  const gesture = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    /**
     * Remembered from the press rather than read from each move.
     *
     * A gesture does not change device halfway through, so reading it again on
     * every event is at best redundant — and at worst wrong, because a synthetic
     * or partially-implemented event may not carry it, and the fallback would
     * then treat a mouse as a finger.
     */
    pointerType: string;
    holdTimer: ReturnType<typeof setTimeout> | null;
    started: boolean;
    element: HTMLElement;
  } | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * Suppress the click that follows a completed drag.
   *
   * A drag on the row's label ends over some other row, and without this the
   * browser then follows the link — so moving a page would also navigate away
   * from the one being edited.
   */
  const swallowNextClick = useCallback((element: HTMLElement) => {
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('click', onClick, { capture: true, once: true });
    // Removed on the next frame if no click arrives, so an unrelated click
    // later is not eaten.
    requestAnimationFrame(() =>
      element.removeEventListener('click', onClick, { capture: true }),
    );
  }, []);

  const finish = useCallback((commit: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (!current) return;

    if (current.holdTimer) clearTimeout(current.holdTimer);
    try {
      current.element.releasePointerCapture(current.pointerId);
    } catch {
      // Capture may already have been lost — the pointer left the window, or
      // the element was removed. Releasing is best-effort.
    }

    if (current.started) swallowNextClick(current.element);

    const wasDragging = draggingRef.current;
    const where = targetRef.current;

    setDraggingBoth(null);
    setTargetBoth(null);

    if (commit && wasDragging && where && optionsRef.current.canDrop(wasDragging, where)) {
      optionsRef.current.onDrop(wasDragging, where);
    }
  }, [swallowNextClick, setDraggingBoth, setTargetBoth]);

  // Registered only while a drag is in progress, so an untouched tree scrolls
  // normally. `passive: false` is what makes preventDefault work at all.
  useEffect(() => {
    if (dragging === null) return undefined;

    const block = (event: TouchEvent): void => event.preventDefault();
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, [dragging]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Only the primary button, and never on a control inside the row: the
      // menu button and the disclosure triangle have their own jobs.
      if (event.button !== 0) return;
      const element = event.currentTarget as HTMLElement;
      const rowId = element.dataset['treeRow'];
      if (!rowId) return;
      // Buttons and inputs keep their own behaviour. Links deliberately do
      // not: the row's label *is* a link, and it covers most of the row — so
      // excluding it meant a drag started from the obvious place never
      // happened, and the browser's native link drag took over instead. That
      // is where the floating row with a green plus came from, and it cancels
      // this gesture as it goes.
      //
      // The link still navigates: a press that neither holds nor moves is
      // untouched by this code, so the click fires as usual.
      if ((event.target as HTMLElement).closest('button, input')) return;

      element.setPointerCapture(event.pointerId);

      const begin = (): void => {
        const current = gesture.current;
        if (!current || current.started) return;
        current.started = true;
        setDraggingBoth(current.id);
      };

      gesture.current = {
        id: rowId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: event.pointerType || 'mouse',
        started: false,
        element,
        // A mouse commits as soon as it moves past the slop; there is no
        // competing gesture to protect. A finger has to wait, because a
        // scroll looks identical until it moves.
        holdTimer:
          (event.pointerType || 'mouse') === 'mouse' ? null : setTimeout(begin, HOLD_MS),
      };

      const onMove = (moveEvent: PointerEvent): void => {
        const current = gesture.current;
        if (!current || moveEvent.pointerId !== current.pointerId) return;

        const dx = Math.abs(moveEvent.clientX - current.startX);
        const dy = Math.abs(moveEvent.clientY - current.startY);

        if (!current.started) {
          if (dx < SLOP && dy < SLOP) return;
          if (current.pointerType === 'mouse') {
            begin();
          } else {
            // Moved before the hold elapsed: this is a scroll. Abandon
            // quietly — nothing has been prevented, so the browser takes over.
            finish(false);
            return;
          }
        }

        moveEvent.preventDefault();

        // Only a destination that would actually be accepted.
        //
        // Showing an indicator on a row that will refuse the drop promises
        // something that then does not happen, which reads as the drop being
        // lost rather than declined.
        const where = positionAt(moveEvent.clientX, moveEvent.clientY);
        const useful =
          where !== null &&
          !isNoop(current.id, where) &&
          optionsRef.current.canDrop(current.id, where);
        setTargetBoth(useful ? where : null);
      };

      const onUp = (upEvent: PointerEvent): void => {
        if (gesture.current && upEvent.pointerId !== gesture.current.pointerId) return;
        cleanup();
        finish(true);
      };

      const onCancel = (): void => {
        cleanup();
        finish(false);
      };

      const cleanup = (): void => {
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onCancel);
      };

      // On the element, not the document: pointer capture delivers the whole
      // sequence here, including events over other rows.
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onCancel);
    },
    [finish, setDraggingBoth, setTargetBoth],
  );

  return { onPointerDown, dragging, target };
}
