/**
 * What a keyboard can reach.
 *
 * Written after finding that the PDF viewer I had just shipped could not be
 * scrolled without a mouse: a `div` with `overflow-y: auto` is not in the tab
 * order, so the document was readable with a pointer and a finger and by
 * nothing else. The accessibility note in the notes has been "a concern" for
 * several sessions, which is how a concern becomes a defect.
 *
 * Source-reading tests, like the rest of the suite here. They cannot prove a
 * browser behaves; they can prove the thing that makes it possible is present,
 * which is what was missing.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/styles.css');

test('a scrollable region is in the tab order and shows its focus', () => {
  // Both halves matter. A focusable element with no visible focus is worse than
  // one nobody can reach: somebody tabbing through the page loses their place.
  const viewer = read('../src/components/pdfViewer.ts');
  assert.match(viewer, /pages\.tabIndex = 0/);
  assert.match(viewer, /setAttribute\('role', 'region'\)/);
  assert.match(viewer, /setAttribute\('aria-label', labels\.document\)/);
  assert.match(css, /\.pdf-pages:focus-visible \{[^}]*outline: 2px solid/s);
});

test('a PDF can be paged, not only scrolled', () => {
  // ADR-0048 said paging controls were "a second way to move, not the only
  // way", and then I shipped only the scrolling column — the record described
  // an interface that did not exist. Scrolling a hundred pages to reach page
  // ninety is not a thing anybody does.
  const viewer = read('../src/components/pdfViewer.ts');
  assert.match(viewer, /back\.addEventListener\('click'/);
  assert.match(viewer, /forward\.addEventListener\('click'/);
  // Disabled at the ends rather than silently doing nothing.
  assert.match(viewer, /back\.disabled = current <= 1/);
  assert.match(viewer, /forward\.disabled = current >= doc\.numPages/);
  // And the count is announced politely, so a screen reader says "page 4 of 12"
  // when somebody pages instead of interrupting what it was reading.
  assert.match(viewer, /setAttribute\('aria-live', 'polite'\)/);
});

test('every icon-only button has a name', () => {
  // The discipline that did hold — 0 offenders when I audited. Counted rather
  // than trusted, because this is the kind that decays one component at a time,
  // and a button that is only a picture is invisible to a screen reader.
  const directory = new URL('../src/components/', import.meta.url);
  const offenders: string[] = [];

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.tsx')) continue;
    const source = readFileSync(new URL(file, directory), 'utf8');
    for (const match of source.matchAll(/<button\b((?:[^>]|\n)*?)>((?:.|\n){0,200}?)<\/button>/g)) {
      const attrs = match[1] ?? '';
      const body = (match[2] ?? '').replace(/\{\/\*(?:.|\n)*?\*\/\}/g, '');
      const icons = /<[A-Z]\w*Icon\s*\/?>/.test(body);
      const words = body.replace(/<[^>]*>/g, '').trim();
      const named = attrs.includes('aria-label') || attrs.includes('title');
      if (icons && !named && (words === '' || words === "{' '}")) offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], 'icon-only buttons with neither a label nor a title');
});

test('a closed drawer is unreachable, not merely unannounced', () => {
  // `aria-hidden` stops a screen reader reading it and does nothing about the
  // tab order — every button inside stays focusable. That was survivable while
  // a closed panel was removed from the DOM; both drawers now stay there to
  // slide, so a tab from the page would land in one nobody can see.
  for (const file of ['Sidebar.tsx', 'RightSidebar.tsx']) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.match(
      source,
      /\{\.\.\.\(open \? \{\} : \{ 'aria-hidden': true, inert: true \}\)\}/,
      `${file} makes a closed drawer inert`,
    );
  }
});

test('both drawers slide, with the same duration', () => {
  // The right panel appeared and vanished while the left one slid, which is the
  // difference somebody notices without being able to name it. Same duration
  // and easing, so the two sides behave alike rather than nearly alike.
  /*
   * Found by the rule's own content, not by counting from the first
   * `max-width: 799px` in the file.
   *
   * That is what this did, and it broke the day a *different* narrow-screen
   * rule was added above it — the slice then started at the wrong `.sidebar {`
   * and the window no longer held the transition. The assertion was right and
   * its aim was borrowed from whatever happened to come first.
   *
   * The drawer is the rule that translates the sidebar off-screen, so that is
   * what to look for.
   */
  const left = css.slice(css.indexOf('transform: translateX(-102%)'));
  assert.match(left.slice(0, 200), /transition: transform 160ms ease/);
  /*
   * The last `.right-panel {` rather than a computed one.
   *
   * There are two rules for that selector alone: the column, and the drawer
   * inside the narrow-screen media query. The drawer is the one that slides and
   * it is the later of the two.
   *
   * Matched at the start of a line, because `.right-panel {` as a plain
   * substring also occurs inside
   * `.app[data-right-panel='closed'] .right-panel { display: flex; }` — which
   * is where `lastIndexOf` landed.
   *
   * Three wrong anchors before this one: proximity to the first
   * `max-width: 799px`, then `translateX(102%)` (which matches the sidebar's
   * right-to-left variant first), then `lastIndexOf`. Each was unique on the
   * day it was written. A rule is found by being a rule.
   */
  const rules = [...css.matchAll(/^\s*\.right-panel \{/gm)];
  const drawer = rules[rules.length - 1];
  assert.ok(drawer?.index !== undefined, 'the drawer rule is there to read');
  assert.match(css.slice(drawer.index).slice(0, 700), /transition: transform 160ms ease/);
  // And a closed drawer keeps its box, or there is nothing to animate.
  assert.match(css, /\.app\[data-right-panel='closed'\] \.right-panel \{ display: flex; \}/);
});
