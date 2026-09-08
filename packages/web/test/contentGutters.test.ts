/**
 * Two things that were only wrong on a phone (ADR-0119).
 *
 * Both reported from a phone, both invisible on a desktop, and both the same
 * shape underneath: a rule that is *almost* complete, whose missing half only
 * decides anything at a width nobody was looking at.
 *
 *   - The shares screen had its own copy of the reading column's measure and
 *     not its gutter. Above 46rem the auto margins hide that; below it there
 *     are no auto margins left to give, so the text sat flush against both
 *     edges of the screen.
 *
 *   - The account menu on the mode bar set both inline insets and inherited a
 *     200px width from the rule above it. A box with both insets *and* a width
 *     is over-constrained, so the browser dropped one — and put the menu at the
 *     left edge under an avatar sitting at the right.
 *
 * Stylesheet assertions, and said plainly: what they can see is the rules, and
 * what no test here can see is layout — jsdom does not lay anything out. The
 * second one below is nonetheless a real check rather than a wire, because
 * over-constraint is decided by the two blocks together and it reads both.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

/**
 * The declarations of the rule with exactly this selector.
 *
 * Anchored at the start of a line, because `.sidebar-account-menu` is a
 * substring of `.rail-account .sidebar-account-menu` and an unanchored search
 * reads the wrong block — which is how this test first passed the wrong rule
 * and failed on it.
 */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Leading whitespace allowed: a rule inside a media query is indented, and
  // the mode bar's is.
  const found = new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, 'm').exec(css);
  assert.ok(found, `no rule for ${selector}`);
  return found[1] ?? '';
}

test('there is one reading column, and it has a gutter', () => {
  /*
   * The measure is `.page-body` and nothing else. A second definition of it is
   * a second answer to how wide the writing is — and this one had two of the
   * three lines, the missing one being the padding.
   *
   * The count is the check rather than the absence of one particular copy: what
   * went wrong is that a screen wrote its own, and the next screen to do it
   * will not be called `.shares`.
   */
  const columns = [...css.matchAll(/max-(?:width|inline-size): 46rem/g)];
  assert.equal(columns.length, 1, 'a second reading column is a second measure');
  // The top one is `--page-body-block-start` since ADR-0163, because a cover
  // that runs to the top edge cancels exactly that much and a number written
  // twice is a number that stops agreeing with itself. The side gutter — the
  // thing this test is about — is still written here.
  assert.match(block('.page-body'), /padding: 0 20px 40vh/, 'and the column has its gutter');
  assert.match(
    block('.page-body'),
    /padding-block-start: var\(--page-body-block-start\)/,
    'with the top one named, because a cover to the top edge cancels it',
  );
});

test('every screen in the content area sits in it', () => {
  // The trash and the inbox always did; the shares screen was rendered straight
  // into `.main`, which has no inline padding of its own — deliberately, since
  // a page's own column supplies it.
  for (const file of ['SharesScreen', 'Trash', 'InboxScreen']) {
    const source = codeOf(new URL(`../src/components/${file}.tsx`, import.meta.url));
    assert.match(source, /className="page-body/, `${file} is in the reading column`);
  }
  assert.doesNotMatch(block('.main'), /padding-inline|padding: /, 'which is why .main has none');
});

test('the menu on the mode bar is not over-constrained', () => {
  /*
   * The actual rule, read from both blocks rather than asserted as a string.
   *
   * A positioned box may set both inline insets **or** a width, not both: with
   * both, one inset is ignored, and which one depends on the writing
   * direction. The base rule gives every account menu 200px; the bar's variant
   * pins it to both edges of the screen — so the variant has to say what
   * happens to the width, and it did not.
   */
  const base = block('.sidebar-account-menu');
  const onBar = block('.bar-account .sidebar-account-menu');

  assert.match(base, /inline-size: \d+px/, 'the base rule sizes the menu');
  assert.match(onBar, /inset-inline: /, 'and the bar pins it to both edges');
  assert.match(
    onBar,
    /inline-size: auto/,
    'so the bar must release the width, or one of its insets is dropped',
  );
});
