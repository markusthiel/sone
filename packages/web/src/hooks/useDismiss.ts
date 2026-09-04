/**
 * Closing a floating menu, written once.
 *
 * Three menus had this effect copied into them — the account, the workspace
 * switcher, and now snoozing — and a fourth copy is where one of them quietly
 * loses the Escape key or the outside click and nobody notices for a month. The
 * sidebar's old account menu had exactly that: it stayed open until something
 * inside it was pressed, so it sat over the tree after a stray click.
 *
 * `pointerdown` rather than `click` for the outside press: a menu that closes
 * only once the button is released stays open under the finger, and the click
 * that follows lands on whatever the menu was covering.
 *
 * Focus goes back to the button on Escape. Somebody who dismissed a menu from
 * the keyboard is still at the control that opened it, and the browser will not
 * put them back there by itself.
 */

import { useEffect, type RefObject } from 'react';

export function useDismiss({
  open,
  inside,
  onDismiss,
}: {
  open: boolean;
  /**
   * The elements a press may land in without closing anything: the panel, and
   * the button that opened it. A ref holding null is skipped, so a menu that is
   * not mounted yet costs nothing.
   */
  inside: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** Called with the reason, because Escape also returns the focus. */
  onDismiss: (reason: 'outside' | 'escape') => void;
}): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      for (const ref of inside) {
        if (ref.current?.contains(event.target as Node)) return;
      }
      onDismiss('outside');
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss('escape');
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
    // The refs are stable objects; listing the array itself would rebind the
    // listeners on every render, because a literal array is a new one each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}
