/**
 * SONE web — the gesture half of dragging.
 *
 * Extracted so it is written once. Every mistake in this project's dragging has
 * been in the gesture rather than in what the gesture moves: capture taken too
 * early, which broke every click in the sidebar; the pointer type read from the
 * wrong event; state read inside a setState updater, which made a correct drop
 * occasionally do nothing. A board that needed its own copy of all that would
 * inherit the bugs and then drift.
 *
 * What is generic is here. What each surface decides — what counts as a
 * destination, and whether one is allowed — is a pair of callbacks, resolved
 * from coordinates rather than from event targets, because a captured pointer
 * delivers everything to the element the gesture started on.
 *
 * ## Telling a drag from a scroll
 *
 * A page has to scroll, and both gestures begin identically: a finger touches
 * something and moves.
 *
 * Time is the answer every touch interface uses. A press that stays still for
 * HOLD_MS is a drag; one that moves before then is a scroll, and nothing has
 * been prevented yet so the browser simply takes over. A mouse does not wait —
 * there is no competing gesture to protect and a hold would only feel slow.
 *
 * Scrolling is suppressed for the duration of a drag by a touchmove listener
 * with `passive: false`, added when the drag starts and removed when it ends.
 * `touch-action` cannot do this job: it is read when the gesture begins, and at
 * that moment neither the browser nor this code knows which gesture it is.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a finger must stay put before a drag begins. */
export const HOLD_MS = 350;
/** How far it may move in that time and still count as staying put. */
export const SLOP = 8;

export interface PointerDragOptions<T> {
  /**
   * What is being dragged, read from the element that was pressed.
   *
   * Returning null declines the gesture — used for controls inside a draggable
   * element that have their own behaviour.
   */
  idFrom: (element: HTMLElement) => string | null;

  /** What lies under a point, if anything. */
  targetAt: (x: number, y: number, draggedId: string) => T | null;

  /** Whether dropping there would do anything useful. */
  canDrop: (draggedId: string, target: T) => boolean;

  onDrop: (draggedId: string, target: T) => void;
}

export interface PointerDrag<T> {
  onPointerDown: (event: React.PointerEvent) => void;
  /** The id being dragged, once the gesture has committed to being one. */
  dragging: string | null;
  /** Where it would land, or null when nowhere useful. */
  target: T | null;
  /** Where the pointer is, for drawing what is travelling. */
  pointer: { x: number; y: number } | null;
}

export function usePointerDrag<T>(options: PointerDragOptions<T>): PointerDrag<T> {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<T | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // The same two values in refs.
  //
  // State drives the render; the refs are what `finish` reads. Reading state
  // inside a setState updater — and dispatching the drop from there — is a side
  // effect in a place React may run more than once or defer, and it made a
  // correct drop occasionally do nothing. The indicator and the committed drop
  // must agree, so they come from one source readable synchronously.
  const draggingRef = useRef<string | null>(null);
  const targetRef = useRef<T | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setDraggingBoth = useCallback((value: string | null) => {
    draggingRef.current = value;
    setDragging(value);
  }, []);

  const setTargetBoth = useCallback((value: T | null) => {
    targetRef.current = value;
    setTarget(value);
  }, []);

  const gesture = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    /**
     * Remembered from the press rather than read from each move.
     *
     * A gesture does not change device halfway through, so reading it again is
     * at best redundant — and wrong when an event does not carry the field, in
     * which case a mouse would wait for a hold that never comes.
     */
    pointerType: string;
    holdTimer: ReturnType<typeof setTimeout> | null;
    started: boolean;
    captured: boolean;
    element: HTMLElement;
  } | null>(null);

  /**
   * Suppress the click that follows a completed drag.
   *
   * A drag that began on a link ends over something else, and without this the
   * browser follows the link — so moving an entry would also navigate away.
   */
  const swallowNextClick = useCallback((element: HTMLElement) => {
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('click', onClick, { capture: true, once: true });
    requestAnimationFrame(() =>
      element.removeEventListener('click', onClick, { capture: true }),
    );
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      const current = gesture.current;
      gesture.current = null;
      if (!current) return;

      if (current.holdTimer) clearTimeout(current.holdTimer);
      try {
        if (current.captured) current.element.releasePointerCapture(current.pointerId);
      } catch {
        // Capture may already have been lost — the pointer left the window, or
        // the element was removed. Releasing is best-effort.
      }

      if (current.started) swallowNextClick(current.element);

      const wasDragging = draggingRef.current;
      const where = targetRef.current;

      setDraggingBoth(null);
      setTargetBoth(null);
      setPointer(null);

      if (commit && wasDragging && where !== null) {
        if (optionsRef.current.canDrop(wasDragging, where)) {
          optionsRef.current.onDrop(wasDragging, where);
        }
      }
    },
    [swallowNextClick, setDraggingBoth, setTargetBoth],
  );

  // Registered only while a drag is in progress, so an untouched surface
  // scrolls normally. `passive: false` is what makes preventDefault work.
  useEffect(() => {
    if (dragging === null) return undefined;
    const block = (event: TouchEvent): void => event.preventDefault();
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, [dragging]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;

      const element = event.currentTarget as HTMLElement;
      const id = optionsRef.current.idFrom(element);
      if (id === null) return;
      if ((event.target as HTMLElement).closest('button, input, select, textarea')) return;

      // Capture is taken when the drag *begins*, not here.
      //
      // Taking it on the press broke every click in the sidebar: with capture
      // set, the browser fires the click on the nearest common ancestor of the
      // press and release targets, which is the container rather than the link
      // inside it.
      const begin = (): void => {
        const current = gesture.current;
        if (!current || current.started) return;
        current.started = true;
        current.captured = true;
        try {
          current.element.setPointerCapture(current.pointerId);
        } catch {
          // Dragging without capture still works: the listeners are on the
          // element and the target comes from coordinates.
        }
        setDraggingBoth(current.id);
      };

      gesture.current = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: event.pointerType || 'mouse',
        started: false,
        captured: false,
        element,
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
            // Moved before the hold elapsed: a scroll. Abandoned quietly, since
            // nothing has been prevented.
            finish(false);
            return;
          }
        }

        moveEvent.preventDefault();
        setPointer({ x: moveEvent.clientX, y: moveEvent.clientY });

        // Only a destination that would be accepted. Marking one that will
        // refuse promises something that then does not happen, which reads as
        // the drop being lost rather than declined.
        const where = optionsRef.current.targetAt(
          moveEvent.clientX,
          moveEvent.clientY,
          current.id,
        );
        setTargetBoth(
          where !== null && optionsRef.current.canDrop(current.id, where) ? where : null,
        );
      };

      const cleanup = (): void => {
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onCancel);
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

      // On the element, not the document: pointer capture delivers the whole
      // sequence here, including events over other elements.
      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onCancel);
    },
    [finish, setDraggingBoth, setTargetBoth],
  );

  return { onPointerDown, dragging, target, pointer };
}
