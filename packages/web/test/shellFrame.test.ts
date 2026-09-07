/**
 * The shell is a frame, and what scrolls is inside it (ADR-0144).
 *
 * Reported: with a long tree **and** a long page there are two scrollbars on
 * the right — one scrolling the whole window until the tree's last row appears,
 * one scrolling the page — and the account picture at the bottom of the rail
 * ends up below the window.
 *
 * Measured in Chromium at 1440×900, with 200 tree rows and 300 paragraphs:
 *
 * | | as shipped | with `min-block-size: 0` |
 * |---|---|---|
 * | `.sidebar` height | **6458px** | 900px |
 * | rail height | 6458px | 900px |
 * | the avatar's bottom edge | y = 6452 | y = 894 |
 * | the tree scrolls | **no** | yes |
 * | the window scrolls | **yes** | no |
 *
 * **The cause is one declaration written for something else.** `.sidebar` sets
 * `overflow: visible` so the account menu can hang out of the rail's 56px
 * column — and a grid item's automatic minimum size is only zero when its
 * overflow is *not* visible. So that line, whose subject is a popup, is also
 * what tells the sidebar it may never be shorter than its own tree.
 *
 * `.main` and `.right-panel` were never in danger, and for two different
 * reasons: the panel says `min-block-size: 0` out loud, and `.main` is saved by
 * declaring `overflow-y: auto` for its own sake. **Two of four columns were
 * bounded by accident**, which is why this file asserts all four.
 *
 * A layout is only really testable in a browser, and there is none in CI. So
 * these read the stylesheet, and the numbers above are the measurement they
 * stand in for.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

/** The declarations of the first rule with exactly this selector. */
function block(selector: string): string {
  const escaped = selector.replace(/[.[\]='*+?^$(){}|\\-]/g, (one) => `\\${one}`);
  const at = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(at, `no rule for ${selector}`);
  return at[2] ?? '';
}

describe('the shell holds its own height', () => {
  /**
   * The four columns of the grid, as `App` renders them.
   *
   * Written out because a stylesheet cannot say which elements are children of
   * `.app` — that is decided in the markup. What it can say is that each of
   * them is allowed to be shorter than its contents, which is the property
   * three of them were missing or getting by accident.
   */
  const COLUMNS = ['.icon-rail', '.sidebar', '.main', '.right-panel'];

  test('every column may be shorter than what is inside it', () => {
    for (const column of COLUMNS) {
      assert.match(
        block(column),
        /min-block-size:\s*0|min-height:\s*0/,
        `${column} cannot shrink, so a long column inside it grows the window instead`,
      );
    }
  });

  test('and the one that lets a popup out still says so', () => {
    /*
     * The regression this fix must not become. `overflow: hidden` would also
     * have bounded the sidebar — and cut off the account menu at the rail's
     * edge, which is the fault its own comment records having fixed once.
     *
     * The two declarations answer different questions, and the point of this
     * round is that they were being answered by one line.
     */
    assert.match(block('.sidebar'), /overflow:\s*visible/);
  });
});

describe('the furniture follows the theme that was chosen', () => {
  test('the scrollbars are thin', () => {
    // Asked for directly, and inherited, so the root is the only place it has
    // to be said.
    assert.match(css, /scrollbar-width:\s*thin/);
  });

  test('and a chosen theme tells the browser which one it is', () => {
    /*
     * `color-scheme: light dark` alone means *the system decides* — so
     * somebody who chose dark in SONE on a light laptop got a dark interface
     * with **light** scrollbars, light select popups and a light date picker.
     * Invisible until a scrollbar was worth looking at.
     *
     * The same shape as the three dark blocks (ADR-0135): a value set where the
     * system is asked and forgotten where the person is.
     */
    assert.match(css, /:root\s*\{[^}]*color-scheme:\s*light dark/s, 'the default still follows');
    /*
     * And declared with `:root` in front, beside the default rather than in the
     * theme blocks: `[data-theme='dark']` and `:root` weigh the same, so the
     * later one wins — and the root's is later. The first attempt at this fix
     * lost to source order and rendered a light scrollbar in a dark interface.
     */
    assert.match(block(":root[data-theme='dark']"), /color-scheme:\s*dark/);
    assert.match(block(":root[data-theme='light']"), /color-scheme:\s*light/);
  });
});
