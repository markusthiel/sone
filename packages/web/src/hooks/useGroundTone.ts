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

import { parseComputed } from '../lib/computedColor.ts';

/**
 * The things a person points at, as opposed to the surfaces they sit on.
 *
 * Written out rather than inferred: an element is a control because it is one
 * of these, not because it happens to have a click handler, and a list is
 * something the next person can read and add to.
 */
const CONTROL = 'a, button, summary, [role="button"], [role="link"]';

/**
 * Is this element a control that somebody is currently pointing at (ADR-0153)?
 *
 * **Both halves, and the second one is the one I got wrong first.** `:hover`
 * matches every *ancestor* of the element under the pointer — so a rule that
 * skipped anything hovered walked straight past the rail, the shell and the
 * body, and answered with the page's white. The surface a mark sits on is
 * hovered whenever the mark is; that is not a state of the surface.
 *
 * `:hover` and `:active` are the two states that repaint a control's own
 * background in this interface. Asked of the element rather than tracked with
 * listeners: the browser already knows, and a second copy of "is the pointer
 * here" kept in React is a copy that can be wrong.
 *
 * Not `:focus-visible`. Focus draws an outline and never a background, and a
 * mark that changed when somebody tabbed past it would be a second surprise
 * added while removing the first.
 *
 * Wrapped, because `matches` throws on a selector an engine does not know, and
 * a mark must not disappear over a selector.
 */
function pointedAtControl(element: Element): boolean {
  try {
    if (!element.matches(CONTROL)) return false;
    return element.matches(':hover') || element.matches(':active');
  } catch {
    return false;
  }
}

/**
 * The colour actually behind an element.
 *
 * Walks up until something paints. A transparent background is not a colour —
 * it is the parent's — and stopping at the first one would call every element
 * light, because `rgba(0, 0, 0, 0)` parses to black with no alpha and reads as
 * a dark ground.
 *
 * **A control the pointer is on is stepped over** (ADR-0153). Reported as
 * *„wenn ich auf das Logo drauf klicke wird es dunkel"*: the mark sits inside
 * the rail's brand link, that link paints `--surface-hover` while the pointer
 * is on it, and on an accent-coloured rail that surface is the rail's own green
 * with a seventh of white mixed in. Measured, the rail is at luminance 0.164
 * and its hover surface at 0.229 — with the threshold at 0.216, so a hover
 * crossed it by thirteen thousandths and swapped in the mark inked for white
 * paper.
 *
 * The rule that follows is not about that arithmetic. **A control's hover is a
 * state of the control, not the surface the mark is drawn on**: which picture
 * belongs on a rail is a fact about the rail, and a picture that changes as the
 * pointer arrives is wrong even when both pictures would be legible.
 *
 * Semi-transparent surfaces are taken as their own colour rather than composited
 * with what is under them: the interface has none today, and guessing at a
 * composite would be a second, wronger answer than the one the browser has.
 */
function groundOf(element: Element | null): GroundTone {
  let at: Element | null = element;
  while (at) {
    if (pointedAtControl(at)) {
      at = at.parentElement;
      continue;
    }
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
