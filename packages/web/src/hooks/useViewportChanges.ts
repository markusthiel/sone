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

export function useViewportChanges(active: boolean): number {
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

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', bump, { capture: true });
      window.removeEventListener('resize', bump);
      visual?.removeEventListener('resize', bump);
      visual?.removeEventListener('scroll', bump);
    };
  }, [active]);

  return token;
}
