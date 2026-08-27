/**
 * Sidebar visibility.
 *
 * There used to be a `drawerOpen` flag that only meant anything below 800px: at
 * wider widths the sidebar is a grid column and was drawn regardless. Hiding it
 * and then changing the window width brought it back on its own, which reads as
 * the app forgetting what it was told.
 *
 * The rule is small and easy to get subtly wrong, so it is pinned down here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * The rule, restated.
 *
 * Mirrors useSidebar: the state is one boolean, and the layouts differ in their
 * default rather than in what they store. Tested as a function because the hook
 * needs React and matchMedia, and the part worth protecting is the decision.
 */
function initialVisibility(isColumn: boolean, preference: boolean | null): boolean {
  if (!isColumn) return false;
  return preference ?? true;
}

test('a column shows by default', () => {
  // Someone who has never hidden it should see it.
  assert.equal(initialVisibility(true, null), true);
});

test('a column respects a remembered preference', () => {
  assert.equal(initialVisibility(true, false), false);
  assert.equal(initialVisibility(true, true), true);
});

test('an overlay starts hidden regardless of the preference', () => {
  // A drawer that opens itself covers the page.
  assert.equal(initialVisibility(false, true), false);
  assert.equal(initialVisibility(false, null), false);
  assert.equal(initialVisibility(false, false), false);
});

test('crossing the breakpoint re-applies that layout default', () => {
  // Carrying an open drawer into a column layout, or a hidden column into a
  // drawer, leaves the sidebar in a state neither layout means. This is the
  // behaviour that made a hidden sidebar reappear after a rotation.
  const hiddenColumn = initialVisibility(true, false);
  assert.equal(hiddenColumn, false);
  // Narrow now: hidden, as an overlay always starts.
  assert.equal(initialVisibility(false, false), false);
  // Wide again: the preference still says hidden, so it stays hidden.
  assert.equal(initialVisibility(true, false), false);
});

test('an unset preference reads as showing, not as hidden', () => {
  // localStorage.getItem returns null for both "never set" and "cleared", and
  // treating that as hidden would ship an app whose sidebar appears missing.
  assert.equal(initialVisibility(true, null), true);
});
