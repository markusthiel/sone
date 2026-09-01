/**
 * SONE web — whether the page has been scrolled (ADR-0042).
 *
 * The bar at the top has no line and no fill of its own until there is something
 * above the fold, because that is the only moment the line has a job. This is
 * the one piece of JavaScript the whole motion decision needs.
 *
 * A `scroll` listener rather than an `IntersectionObserver` on a sentinel: the
 * observer is the tidier instrument and needs an element in the document that
 * exists only to be watched, which is a thing in the tree that means nothing to
 * anybody reading it.
 *
 * Passive, and it sets a boolean rather than a pixel count — so a page being
 * scrolled causes at most one render, at the top, and none after that.
 */

import { useCallback, useEffect, useState } from 'react';

export function useScrolled(): {
  scrolled: boolean;
  /** Attach to the element that scrolls. */
  ref: (node: HTMLElement | null) => void;
} {
  const [scrolled, setScrolled] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);

  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);

  useEffect(() => {
    if (!node) return;

    const read = (): void => {
      // Two pixels rather than zero: a trackpad's rubber-banding and a sub-pixel
      // scroll position both report a fraction, and a line that flickers on and
      // off while somebody rests their fingers is worse than no line.
      setScrolled(node.scrollTop > 2);
    };

    read();
    node.addEventListener('scroll', read, { passive: true });
    return () => node.removeEventListener('scroll', read);
  }, [node]);

  return { scrolled, ref };
}
