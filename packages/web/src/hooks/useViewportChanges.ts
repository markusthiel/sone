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

    /*
     * The element **and everything it sits inside**.
     *
     * Watching the element alone was not enough, and the reason is invisible
     * from the element's own point of view: the reading column is
     * `max-width: 46rem; margin-inline: auto`. On any window wider than that,
     * collapsing the sidebar — or dragging it narrower — changes how much room
     * there is, so the column **re-centres without changing width at all**.
     *
     * A ResizeObserver reports size. The text moved two hundred pixels sideways
     * and the observer had nothing to report, so nothing re-measured and the
     * gutter stayed where the text used to be — until the next selection or
     * edit happened to recompute it, which is why it "usually fixes itself when
     * you click on something else" (ADR-0083).
     *
     * The ancestors are what actually changed: the pane holding the column got
     * wider. Observing the chain catches that, and catches the next layout that
     * moves the text for a reason this hook has not been told about — which is
     * the whole job of a hook whose question is "did something move".
     *
     * Cheap: one observer, a handful of targets, and every notification is
     * coalesced into the same single frame as a scroll.
     *
     * Guarded on the constructor rather than assumed: jsdom does not implement
     * it, and a test environment missing an observer should lose the extra
     * re-measure rather than take the component down with a ReferenceError.
     */
    const observer =
      watch && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    if (observer && watch) {
      for (let element: HTMLElement | null = watch; element; element = element.parentElement) {
        observer.observe(element);
      }
    }

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
