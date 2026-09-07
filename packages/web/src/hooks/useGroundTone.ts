/**
 * SONE web — what colour the surface under something actually is (ADR-0149).
 *
 * Asked because an instance may upload two marks, one inked for light grounds
 * and one for dark, and *„das System sollte dann selbst erkennen welches Logo am
 * besten dort sitzt"*.
 *
 * **The theme cannot answer it.** A workspace may treat the rail — `raised`,
 * `inverted`, `accent` (ADR-0122) — so the rail of a light instance can be the
 * darkest surface on the screen; and a treatment compiles to `var(--accent)`,
 * which is a colour only after the browser has resolved a custom property that
 * may itself be a workspace's own hex. The one place that knows is the element,
 * once it is drawn.
 *
 * So this measures, in the spirit of ADR-0135: the ground is arithmetic, not an
 * opinion about which theme is on.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { groundTone, type GroundTone } from '@sone/core';

/**
 * A computed background colour, in the two forms a browser actually returns.
 *
 * **Measured, not assumed, and the first version was wrong because of it.** It
 * read `rgb(16, 16, 16)` and took any three numbers as channels — which is
 * right until a surface is a `color-mix` (ADR-0135), and then Chrome computes
 * `color(srgb 0.980392 0.972549 0.956863)`. Those are the same three channels
 * on a scale of one, so the near-white rail every instance has by default was
 * read as near-black and would have been given the mark drawn for dark
 * surfaces.
 *
 * The scale comes from the function name rather than from the size of the
 * numbers. A guess like "all three are below one, so it must be the 0–1 form"
 * gets `rgb(1, 1, 1)` — nearly black — exactly backwards.
 *
 * Anything else returns null, which the caller reads as "keep looking, then
 * assume the page's own light ground": a form nobody has seen is not a licence
 * to invent a colour for it.
 */
export function parseComputed(
  value: string,
): { r: number; g: number; b: number; alpha: number } | null {
  const numbers = (value.match(/[\d.]+/g) ?? []).map(Number);
  if (numbers.length < 3) return null;
  const [first, second, third, fourth] = numbers as [number, number, number, number?];

  if (/^rgba?\(/.test(value)) {
    return { r: first, g: second, b: third, alpha: fourth ?? 1 };
  }
  /*
   * `color(srgb r g b / a)`, and any other space written the same way.
   *
   * Channels 0–1. A wider space than sRGB is read as though it were sRGB, which
   * is wrong by a few percent of saturation and cannot change the answer to
   * "light or dark" — the alternative is a colour-space conversion in a hook
   * that decides between two pictures.
   */
  if (value.startsWith('color(')) {
    return { r: first * 255, g: second * 255, b: third * 255, alpha: fourth ?? 1 };
  }
  return null;
}

/**
 * The colour actually behind an element.
 *
 * Walks up until something paints. A transparent background is not a colour —
 * it is the parent's — and stopping at the first one would call every element
 * light, because `rgba(0, 0, 0, 0)` parses to black with no alpha and reads as
 * a dark ground.
 *
 * Semi-transparent surfaces are taken as their own colour rather than composited
 * with what is under them: the interface has none today, and guessing at a
 * composite would be a second, wronger answer than the one the browser has.
 */
function groundOf(element: Element | null): GroundTone {
  let at: Element | null = element;
  while (at) {
    const parsed = parseComputed(getComputedStyle(at).backgroundColor);
    if (parsed && parsed.alpha > 0) return groundTone(parsed);
    at = at.parentElement;
  }
  // Nothing paints all the way up, which is the page's own ground.
  return 'light';
}

/**
 * The tone of the surface this element sits on, kept current.
 *
 * Measured in a layout effect, so the answer is in before the browser paints and
 * nobody sees one mark swapped for the other.
 *
 * **A callback ref, not a `RefObject`** — the same reason ADR-0142 gave for
 * `useChoiceList`: the caller attaches this to an `<img>` in one branch and an
 * `<svg>` in the other, and no single `RefObject<T>` fits both. A callback takes
 * whatever it is given, which is what "the element I am drawn as" actually
 * means.
 */
export function useGroundTone(): {
  tone: GroundTone;
  ref: (node: Element | null) => void;
} {
  const node = useRef<Element | null>(null);
  const [tone, setTone] = useState<GroundTone>('light');
  // Stable, so attaching it does not detach and reattach on every render.
  const ref = useCallback((element: Element | null) => {
    node.current = element;
  }, []);

  /*
   * After every render, and not only on mount.
   *
   * The first version measured once with `[ref]` and was wrong in a way the
   * tests caught immediately: a mark that stays mounted while the surface under
   * it is replaced — a different rail, a workspace switch that re-renders
   * around it — kept the answer it had been given the first time. Nothing about
   * a ground is a prop, so there is no dependency list that describes it.
   *
   * Cheap: a walk up a handful of elements reading one property, and `setTone`
   * bails out when the answer has not moved, so a stable ground costs one extra
   * comparison per render and no re-render at all.
   */
  useLayoutEffect(() => {
    setTone((current) => {
      const found = groundOf(node.current);
      return found === current ? current : found;
    });
  });

  /*
   * And when the ground changes without anything re-rendering.
   *
   * Watched at `<html>`, which is enough on purpose: a workspace's theme is
   * written there as custom properties (`useWorkspaceTheme`) and light-or-dark
   * is `data-theme` on the same element, which ADR-0124 made sure has exactly
   * one writer.
   */
  useLayoutEffect(() => {
    const observer = new MutationObserver(() => setTone(groundOf(node.current)));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'class'],
    });
    return () => observer.disconnect();
  }, []);

  return { tone, ref };
}
