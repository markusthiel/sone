/**
 * What is drawn over what (ADR-0134).
 *
 * Reported twice: *„Die Anfasser und das + liegen leider immer noch über dem
 * Menü, wenn die Seitenleiste ausgeklappt wird."* The block gutter — the `+`
 * and the grip beside a paragraph — was drawn on top of the sidebar drawer and
 * on top of the dimming behind it, so opening the sidebar on a narrow screen
 * left two editor controls floating over the folder list.
 *
 * ## Why the stylesheet had no answer
 *
 * Every `z-index` in it was a number somebody picked while looking at one
 * problem. `.block-gutter: 30` was picked so the controls would sit above the
 * text they annotate; `.sidebar: 20` was picked so the drawer would sit above
 * the page. Both are reasonable on their own, and together they are this bug —
 * because nothing anywhere said **which of the two is the page and which is the
 * thing covering it.**
 *
 * So this file states the order, in the one form a stylesheet cannot: as pairs,
 * each with the reason it has to hold. It reads the numbers out of the sheet
 * rather than restating them, which is the difference between a test and a
 * second copy of the code (ADR-0131).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/**
 * Every `z-index` a selector is given, highest first.
 *
 * Highest rather than first, because a selector may appear in several blocks —
 * `.sidebar` is a grid column above 800px and a fixed drawer below it — and
 * what matters is the largest value it can reach.
 */
function layersOf(selector: string): number[] {
  const found: number[] = [];
  // Every block whose selector list mentions this class, and the z-index inside
  // it. Split on the brace rather than parsed: a declaration never contains one,
  // so `selectors { declarations }` is unambiguous at this level, and an at-rule
  // wrapping them leaves the inner rules exactly as they are.
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = block[1] ?? '';
    const body = block[2] ?? '';
    // Followed by something that cannot continue a class name, so `.scrim` does
    // not match `.scrim-right`.
    if (!new RegExp(`\\${selector}(?![\\w-])`).test(selectors)) continue;
    const z = /z-index:\s*(-?\d+)/.exec(body);
    if (z) found.push(Number(z[1]));
  }
  return found.sort((a, b) => b - a);
}

const highest = (selector: string): number => {
  const all = layersOf(selector);
  assert.ok(all.length > 0, `${selector} has no z-index in the stylesheet`);
  return all[0]!;
};

/**
 * The order, and why each pair has to hold.
 *
 * Written as *what is underneath* → *what is on top*, because that is the
 * question each pair answers.
 */
const ABOVE: Array<[under: string, over: string, because: string]> = [
  // --- the reported bug -----------------------------------------------------
  [
    '.block-gutter',
    '.scrim',
    'the gutter belongs to the page, and the scrim is what dims the page — a control that stays bright over a dimmed page is a control that looks pressable and is not',
  ],
  [
    '.block-gutter',
    '.sidebar',
    'the sidebar drawer covers the page on a narrow screen, and two editor controls over the folder list is what was reported',
  ],
  [
    '.block-gutter',
    '.right-panel',
    'the same drawer from the other side, which nobody reported only because it opens less often',
  ],

  // --- and the rule underneath it ------------------------------------------
  [
    '.topbar',
    '.scrim',
    'the page’s own header is the page, and it dims with it',
  ],
  [
    '.canvas-handle',
    '.scrim',
    'a handle on the drawing plane is as much the page as a handle on a paragraph',
  ],

  // --- a scrim is under the thing it dims for ------------------------------
  [
    '.scrim',
    '.sidebar',
    'the dimming is for the drawer, so the drawer stands in front of it',
  ],
  ['.scrim-right', '.right-panel', 'the same, on the other side'],
  [
    '.dialog-scrim',
    '.video-dialog',
    'a dialog is what its own scrim is dimming for',
  ],

  // --- what has to stay reachable above a drawer ---------------------------
  [
    '.sidebar',
    '.sidebar-account-menu',
    'a menu opened from inside the drawer has to come out over it',
  ],
  [
    '.sidebar',
    '.app-error',
    'something has gone wrong, and a drawer is not a reason not to say so',
  ],

  // --- the thing under the cursor -----------------------------------------
  [
    '.app-error',
    '.drag-preview',
    'what is being dragged follows the pointer over everything, or it disappears behind whatever it is being dragged towards',
  ],
];

for (const [under, over, because] of ABOVE) {
  test(`${over} is drawn over ${under}`, () => {
    const low = highest(under);
    const high = highest(over);
    assert.ok(low < high, `${because}\n  ${under}: ${low}\n  ${over}: ${high}`);
  });
}

test('nothing in the page reaches the level of the things that cover it', () => {
  /*
   * The general form of the bug, so the next control that picks a number out of
   * the air is caught by the same rule rather than by somebody's screenshot.
   *
   * The scrim is the boundary: everything drawn *inside* the reading area is
   * below it, and everything that covers the reading area is above it. A
   * control that reaches the scrim's level is a control that will one day be
   * found floating over a drawer.
   */
  const scrim = highest('.scrim');
  for (const inThePage of [
    '.block-gutter',
    '.topbar',
    '.canvas-handle',
    '.canvas-ink',
    '.canvas-comment-mark',
    '.pdf-bar',
    '.collection-title-column',
    '.sidebar-resize',
  ]) {
    assert.ok(
      highest(inThePage) < scrim,
      `${inThePage} sits at ${highest(inThePage)}, at or above the scrim's ${scrim}`,
    );
  }
});

test('the gutter still stands above what it annotates', () => {
  /*
   * The other half, and the reason the number was 30 to begin with. The
   * controls sit *over* the block — beside a paragraph that is empty margin,
   * over a full-width photograph that is not — so they have to win against
   * everything drawn inside the reading column.
   *
   * Fixing the drawer by putting the gutter underneath the page would have
   * traded a reported bug for an unreported one.
   */
  const gutter = highest('.block-gutter');
  for (const insideTheColumn of [
    '.canvas-comment-mark',
    '.canvas-ink',
    '.canvas-handle',
    '.collection-title-column',
  ]) {
    assert.ok(
      highest(insideTheColumn) < gutter,
      `${insideTheColumn} would cover the gutter`,
    );
  }
});
