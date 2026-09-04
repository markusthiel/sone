/**
 * Whether an on-screen keyboard is covering the bottom of the screen.
 *
 * The mode bar lives there (ADR-0074), and a bar that sits above a keyboard is
 * a bar between somebody and the sentence they are writing — it steals the last
 * line of the editor at exactly the moment that line matters most.
 *
 * Measured rather than guessed at. `visualViewport` is what the browser shrinks
 * when the keyboard opens, so the question "is something covering the bottom"
 * has a direct answer instead of being inferred from focus. Inferring from
 * focus gets the ordinary case right and then hides the bar for somebody typing
 * on a hardware keyboard, where nothing is covering anything.
 *
 * Where there is no `visualViewport`, the bar stays. A bar that is always there
 * is a smaller fault than one that vanishes for reasons nobody can see.
 */

import { useEffect, useState } from 'react';

/**
 * A keyboard, as opposed to the browser's own chrome.
 *
 * A ratio rather than a number of pixels, because both the screen and the
 * keyboard scale with the device. A quarter is the line: an on-screen keyboard
 * takes between a third and a half of a phone's screen, and the tallest thing
 * the browser itself hides or shows — an address bar — is nowhere near that.
 */
export function keyboardTakesTheScreen(
  windowHeight: number,
  viewportHeight: number,
): boolean {
  if (windowHeight <= 0 || viewportHeight <= 0) return false;
  return viewportHeight < windowHeight * 0.75;
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const measure = (): void => {
      setOpen(keyboardTakesTheScreen(window.innerHeight, viewport.height));
    };
    measure();
    // Both events: `resize` is the keyboard opening, and `scroll` is the page
    // being pushed up under it, which some browsers report as the only change.
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);

  return open;
}
