/**
 * SONE web — how wide the sidebar is.
 *
 * Because the tree's problem is space, not text. A page called
 * "02.03.2026 - 09:05 - Notiz" needs about 200px of label; three levels of
 * nesting inside a 260px sidebar leave it 180. Truncation is then correct
 * behaviour and still useless, and every clever alternative is worse:
 *
 * - A middle ellipsis would keep the tail and throw away the date, which for
 *   date-prefixed titles is exactly the wrong half.
 * - Wrapping to two lines doubles the height of a list of thirty dated notes,
 *   which is the case that made this a problem in the first place.
 * - Less indentation per level makes the nesting unreadable, and the nesting is
 *   why somebody put the notes in a folder.
 *
 * So: the person decides. Remembered locally like the sidebar's own visibility,
 * because it is a preference about this screen rather than a fact about the
 * account — somebody on a laptop and a large monitor wants two different
 * numbers and would be annoyed by one following them around.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sone.sidebarWidth';

/**
 * Bounds rather than free rein.
 *
 * The lower one is where the row's own controls stop fitting; the upper one is
 * where the sidebar stops being a sidebar. A value outside them, from an old
 * build or a hand-edited store, is clamped rather than honoured.
 */
export const MIN_SIDEBAR = 200;
export const MAX_SIDEBAR = 520;
const DEFAULT_SIDEBAR = 260;

const clamp = (value: number): number =>
  Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, Math.round(value)));

export function useSidebarWidth(): {
  width: number;
  /** Begin a drag from the sidebar's right edge. */
  startResize: (event: { clientX: number; preventDefault: () => void }) => void;
  /** Put it back, for the double-click somebody will try. */
  reset: () => void;
} {
  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(KEY));
      return Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT_SIDEBAR;
    } catch {
      // A browser with storage refused still gets a sidebar.
      return DEFAULT_SIDEBAR;
    }
  });

  // Written to the document rather than passed down: the width belongs to the
  // grid template, which is a rule in the stylesheet and not a component.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }, [width]);

  const remember = useCallback((value: number) => {
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // Not remembering is a smaller failure than not resizing.
    }
  }, []);

  const startResize = useCallback(
    (event: { clientX: number; preventDefault: () => void }) => {
      event.preventDefault();
      const from = event.clientX;
      const before = width;

      /*
       * Listeners on the window, removed on release.
       *
       * On the handle they would stop firing the moment the pointer moved off
       * it — which during a drag is immediately, since the handle is four
       * pixels wide.
       */
      const move = (moved: MouseEvent): void => {
        setWidth(clamp(before + (moved.clientX - from)));
      };
      const done = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', done);
        document.body.style.removeProperty('cursor');
        document.body.style.removeProperty('user-select');
        // Read from the element, because `width` in this closure is the value
        // the drag started from.
        const settled = Number.parseInt(
          document.documentElement.style.getPropertyValue('--sidebar-width'),
          10,
        );
        if (Number.isFinite(settled)) remember(settled);
      };

      // While dragging: the resize cursor everywhere, and no text selection —
      // otherwise a drag across the page selects half of it.
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', done);
    },
    [width, remember],
  );

  const reset = useCallback(() => {
    setWidth(DEFAULT_SIDEBAR);
    remember(DEFAULT_SIDEBAR);
  }, [remember]);

  return { width, startResize, reset };
}
