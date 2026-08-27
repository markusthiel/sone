/**
 * SONE web — whether the sidebar is showing.
 *
 * One state, not two.
 *
 * There used to be a `drawerOpen` flag that only meant anything below 800px: at
 * wider widths the sidebar is a grid column and is drawn regardless. So hiding
 * it and then changing the window width — rotating a tablet, entering split
 * view — brought it back on its own, which reads as the app forgetting what it
 * was told.
 *
 * The two layouts genuinely differ, and the difference is in the default rather
 * than in the state:
 *
 *   - As a column, showing is the sensible default and hiding is a preference
 *     worth remembering.
 *   - As a drawer, hidden is the only sensible default — a drawer that opens
 *     itself covers the page — and it closes again on navigation.
 *
 * So the preference is persisted and consulted only for the column layout.
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sone.sidebarVisible';
/** Matches the breakpoint in the stylesheet. Changing one requires the other. */
const COLUMN_QUERY = '(min-width: 800px)';

function readPreference(): boolean {
  try {
    // Absent means showing: someone who has never hidden it should see it.
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function useSidebar(route: unknown): {
  visible: boolean;
  /** True when the sidebar is a column rather than an overlay. */
  isColumn: boolean;
  toggle: () => void;
  close: () => void;
} {
  const [isColumn, setIsColumn] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COLUMN_QUERY).matches,
  );
  const [visible, setVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia(COLUMN_QUERY).matches ? readPreference() : false;
  });

  // Following the media query rather than a resize handler: matchMedia fires
  // once when the answer changes instead of on every pixel.
  useEffect(() => {
    const query = window.matchMedia(COLUMN_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setIsColumn(event.matches);
      // Crossing the breakpoint re-applies that layout's default: the
      // remembered preference for a column, hidden for a drawer. Carrying an
      // open drawer into a column layout, or a hidden column into a drawer,
      // leaves the sidebar in a state neither layout means.
      setVisible(event.matches ? readPreference() : false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // A drawer closes on navigation, or tapping a page on a phone leaves it
  // covering the page that was just opened. A column does not: hiding it is a
  // preference, and undoing that on every click would be maddening.
  useEffect(() => {
    if (!isColumn) setVisible(false);
  }, [route, isColumn]);

  const toggle = useCallback(() => {
    setVisible((previous) => {
      const next = !previous;
      if (isColumn) {
        try {
          localStorage.setItem(KEY, String(next));
        } catch {
          // Storage disabled; the preference simply does not survive a reload.
        }
      }
      return next;
    });
  }, [isColumn]);

  const close = useCallback(() => {
    setVisible(false);
    if (isColumn) {
      try {
        localStorage.setItem(KEY, 'false');
      } catch {
        // As above.
      }
    }
  }, [isColumn]);

  return { visible, isColumn, toggle, close };
}
