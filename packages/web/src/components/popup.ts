/**
 * SONE web — activating something in a popup without breaking touch.
 *
 * Every floating menu here had the same shape:
 *
 *     onPointerDown={(event) => { event.preventDefault(); choose(item); }}
 *
 * with a comment explaining that the editor loses its selection on mousedown,
 * so the command has to run before that. The reasoning is correct for a mouse
 * and wrong for a finger, and it produced three separate complaints from one
 * mistake:
 *
 *   1. **Items fire on touch-down.** `pointerdown` is the moment the finger
 *      lands, so the menu acted before anyone lifted — there was no way to
 *      touch an item and change your mind.
 *
 *   2. **The menu could not be scrolled.** `preventDefault()` on that event
 *      cancels the browser's scroll gesture, so dragging inside a list that is
 *      taller than its box did nothing.
 *
 *   3. **The choice landed where the finger was.** Once the menu closed, the
 *      rest of the tap — touchend, then a synthetic click — was delivered to
 *      whatever sat underneath, which is the editor, and moved the caret there.
 *
 * The fix separates the two jobs that were being done by one event.
 *
 * `mousedown` is prevented **on the container**, which is what actually keeps
 * the editor's selection: it is the mouse's focus-stealing event, and on touch
 * the browser only synthesises it after the tap has finished, where preventing
 * it is harmless and in fact stops symptom 3.
 *
 * The action runs on `click`, which fires after a tap completes and does *not*
 * fire if the finger moved to scroll. That is precisely the distinction between
 * "choose this" and "scroll the list", and the browser already knows how to
 * make it.
 */

import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Props for a popup container that must not steal the editor's selection.
 *
 * Spread onto the element that wraps the interactive items.
 */
export const keepsEditorSelection = {
  onMouseDown: (event: ReactMouseEvent): void => {
    // Not pointerdown: preventing that one cancels touch scrolling.
    event.preventDefault();
  },
} as const;

/**
 * Props for an item inside such a popup.
 *
 * `touchAction: 'manipulation'` removes the browser's double-tap-to-zoom delay
 * without disabling the pan gesture the surrounding list needs.
 */
export function popupItem(activate: () => void): {
  onClick: (event: ReactMouseEvent) => void;
  style: { touchAction: 'manipulation' };
} {
  return {
    onClick: (event: ReactMouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      activate();
    },
    style: { touchAction: 'manipulation' },
  };
}
