/**
 * The mode bar on a phone (ADR-0074).
 *
 * Stage four of ADR-0069, and the part of it that had to be got right rather
 * than merely built: a bar fixed to the bottom of a screen is in the way of two
 * things — the last line of what somebody is reading, and the last line of what
 * they are writing. Both are covered here, along with the rule that keeps it
 * the same set of places as the rail.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { keyboardTakesTheScreen } from '../src/hooks/useKeyboardOpen.ts';
import { codeOf, stylesOf } from './helpers/source.ts';

const bar = codeOf(new URL('../src/components/ModeBar.tsx', import.meta.url));
const rail = codeOf(new URL('../src/components/IconRail.tsx', import.meta.url));
const app = codeOf(new URL('../src/App.tsx', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('the bar is the rail, from the same list', () => {
  /*
   * ADR-0069 sketched it as "Seiten · Suchen · Posteingang · Du". That set is
   * not the rail's, and the difference is what makes it wrong: a phone would
   * offer fewer places than a desktop with no way to reach the missing ones —
   * the workspaces and the trash would exist and be unreachable.
   */
  assert.match(bar, /const modes = useModes\(\);/);
  assert.match(rail, /const \[tree, \.\.\.rest\] = useModes\(\);/);
  // Searching is not a place you are, so it is not here. It stays the labelled
  // row above the tree, where it is at both widths.
  assert.doesNotMatch(bar, /paths\.search/);
});

test('the two are never on screen at once, and the stylesheet decides', () => {
  // The breakpoint has one owner and it is the thing that draws it: a media
  // query in JavaScript would be a second copy of the number, and the two would
  // disagree on the pixel where it matters.
  assert.match(css, /\.mode-bar \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 799px\) \{[\s\S]*?\.mode-bar \{[\s\S]*?position: fixed/);
  assert.doesNotMatch(bar, /matchMedia/);
});

test('the account is drawn once, and the bar is the second place', () => {
  // Two mounted copies would be two requests for the same unread count and two
  // answers that can disagree for a moment.
  assert.match(app, /<IconRail here=\{mode\} account=\{isColumn \? accountMenu : null\} \/>/);
  assert.match(app, /<ModeBar here=\{mode\} account=\{isColumn \? null : accountMenu\} \/>/);
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.doesNotMatch(sidebar, /panel-modes/, 'the panel foot it replaces is gone');
  assert.doesNotMatch(sidebar, /<AccountMenu/);
});

test('every item in the bar says what it is', () => {
  // Five icons with no labels is a puzzle, and the face among them would read
  // as an accident rather than a choice — so the shell passes it a word.
  assert.match(bar, /<span className="bar-label">\{label\}<\/span>/);
  assert.match(app, /label=\{isColumn \? undefined : t\('mode\.you'\)\}/);
  assert.match(css, /\.bar-label \{[\s\S]*?font-size: 10px/);
});

test('the bar gives back the space it takes', () => {
  /*
   * Content that ends underneath a bar is content somebody cannot finish
   * reading, and a drawer running under it hides its last row behind five
   * icons. Both are paid back from one measurement.
   */
  assert.match(css, /--sone-bar: 56px;/);
  assert.match(
    css,
    /\.main \{ padding-block-end: calc\(var\(--sone-bar\) \+ env\(safe-area-inset-bottom, 0px\)\); \}/,
  );
  assert.match(
    css,
    /inset-block-end: calc\(var\(--sone-bar\) \+ env\(safe-area-inset-bottom, 0px\)\);/,
  );
  // And the home indicator's strip is padding inside the bar rather than a
  // taller bar, so the row of icons keeps its height.
  assert.match(css, /padding-block-end: env\(safe-area-inset-bottom, 0px\)/);
});

test('the bar gets out of the way of a keyboard', () => {
  // A bar sitting above an open keyboard takes the last line of the editor at
  // the moment that line matters most.
  assert.match(bar, /data-hidden=\{keyboard \? 'true' : undefined\}/);
  // And out of the tab order while it is not there to be seen: something
  // reachable by tab that cannot be seen is worse than something missing.
  assert.match(bar, /inert: true/);
  assert.match(css, /\.mode-bar\[data-hidden='true'\] \{ display: none; \}/);
});

test('the keyboard is measured, not inferred from focus', () => {
  /*
   * `visualViewport` is what the browser shrinks when the keyboard opens, so
   * the question has a direct answer. Inferring from focus gets the ordinary
   * case right and then hides the bar for somebody typing on a hardware
   * keyboard, where nothing is covering anything.
   */
  const hook = codeOf(new URL('../src/hooks/useKeyboardOpen.ts', import.meta.url));
  assert.match(hook, /window\.visualViewport/);
  assert.doesNotMatch(hook, /focusin|activeElement/);
  // Both events: `resize` is the keyboard opening, and `scroll` is the page
  // being pushed up under it, which some browsers report as the only change.
  assert.match(hook, /viewport\.addEventListener\('resize', measure\)/);
  assert.match(hook, /viewport\.addEventListener\('scroll', measure\)/);
});

test('a quarter of the screen is a keyboard; less is browser chrome', () => {
  // A ratio rather than a number of pixels, because both the screen and the
  // keyboard scale with the device.
  const phone = 844;
  assert.equal(keyboardTakesTheScreen(phone, 844), false, 'nothing covering it');
  // An address bar appearing takes about eighty pixels on a phone. It must not
  // count, or the bar would flicker away while somebody scrolls.
  assert.equal(keyboardTakesTheScreen(phone, 764), false, 'browser chrome');
  // A keyboard takes between a third and a half.
  assert.equal(keyboardTakesTheScreen(phone, 520), true);
  assert.equal(keyboardTakesTheScreen(phone, 430), true);
});

test('a browser with no visual viewport keeps its bar', () => {
  // A bar that is always there is a smaller fault than one that vanishes for
  // reasons nobody can see.
  const hook = codeOf(new URL('../src/hooks/useKeyboardOpen.ts', import.meta.url));
  assert.match(hook, /if \(!viewport\) return;/);
  assert.equal(keyboardTakesTheScreen(0, 0), false);
});

test('the keyboard hint is not shown where there is no keyboard', () => {
  // Two lines explaining j/k/e/u is two lines of the inbox gone, on the screen
  // with the least room for them.
  assert.match(css, /@media \(max-width: 799px\) \{\s*\.inbox-keys \{ display: none; \}/);
});
