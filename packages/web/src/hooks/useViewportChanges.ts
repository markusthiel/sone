/**
 * SONE web — keeping a fixed overlay attached to the text under it.
 *
 * The gutter controls, the slash menu and the formatting toolbar are all
 * `position: fixed` at coordinates measured from the document when a
 * transaction happened. Nothing recomputed them when the page moved, so any
 * scroll left them where they were while the text slid past — which is the
 * "handles jump by a few lines" report. On a tablet it happens constantly,
 * because the on-screen keyboard scrolls the page every time the caret moves
 * near the bottom.
 *
 * A scroll produces no transaction, so the components had no reason to
 * re-render and no way to notice.
 *
 * This returns a counter that changes whenever the page moves, which callers
 * put in their positioning effect's dependencies.
 *
 * Listeners are passive and capture-phase: passive so they never delay a
 * scroll, and capture so a scroll inside any container is seen — the editor
 * scrolls its own pane on some layouts, and a listener on `window` alone would
 * miss it.
 */

import { useEffect, useState } from 'react';

/**
 * @param watch An element whose own box should also be watched.
 *
 * The window is not the only thing that moves the text. Opening the page panel
 * or hiding the sidebar changes the editor's width without any window event at
 * all — and an overlay placed from the text's old position then sits wherever
 * the text used to be. That is how the block controls ended up inside the first
 * line, and it is not what I said it was when I first "fixed" it.
 */
export function useViewportChanges(active: boolean, watch?: HTMLElement | null): number {
  const [token, setToken] = useState(0);

  useEffect(() => {
    if (!active) return;

    let frame: number | null = null;
    const bump = (): void => {
      // Coalesced to one update per frame. A scroll fires dozens of events and
      // each one would otherwise re-measure and re-render.
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setToken((n) => n + 1);
      });
    };

    window.addEventListener('scroll', bump, { passive: true, capture: true });
    window.addEventListener('resize', bump, { passive: true });

    // The visual viewport moves when a software keyboard opens without the
    // layout viewport changing at all, so a resize listener alone misses it —
    // and that is exactly when an overlay ends up in the wrong place on a
    // tablet.
    const visual = window.visualViewport;
    visual?.addEventListener('resize', bump);
    visual?.addEventListener('scroll', bump);

    // And the element itself, for every reason the window knows nothing about.
    //
    // Guarded on the constructor rather than assumed: jsdom does not implement
    // it, and a test environment missing an observer should lose the extra
    // re-measure rather than take the component down with a ReferenceError.
    const observer =
      watch && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    observer?.observe(watch as Element);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', bump, { capture: true });
      window.removeEventListener('resize', bump);
      visual?.removeEventListener('resize', bump);
      visual?.removeEventListener('scroll', bump);
      observer?.disconnect();
    };
  }, [active, watch]);

  return token;
}
