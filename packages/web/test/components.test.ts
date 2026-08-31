/**
 * The shared components: fields, buttons, and everything that floats.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('a field is a surface at rest and a border when focused', () => {
  // A form of equally weighted boxes reads as heavy before anybody has read a
  // single label.
  // Matched loosely on purpose: the selector grew a list of exclusions when
  // checkboxes turned out to be caught by it, and a test that spells the
  // selector out fails on every such correction without any of them being
  // wrong.
  assert.match(css, /background: var\(--surface-sunken\);\n  transition: border-color/);
  assert.match(css, /:focus,\s*\n?textarea:focus \{[^}]*border-color: var\(--accent\)/);
});

test('a focused field has one ring, not two', () => {
  // The accent border replaces the outline rather than joining it. Two rings
  // around one field is the tell of a control nobody looked at.
  assert.match(css, /:focus,\s*\n?textarea:focus \{[^}]*outline: none/);
});

test('everything else keeps a visible focus ring', () => {
  // The exception above is only allowed because it replaces the ring with
  // something at least as visible.
  assert.match(css, /button:focus-visible, a:focus-visible[^{]*\{[^}]*outline: 2px solid/);
});

test('a primary button looks the same whichever class was remembered', () => {
  // Two rules styled it — `.btn.primary` and `.primary` — and one hardcoded
  // white text, which is wrong the moment the accent lightens for dark mode
  // and black is what reads on it.
  assert.match(css, /button\.primary \{[^}]*color: var\(--accent-contrast\)/);
  assert.doesNotMatch(css, /button\.primary \{[^}]*color: #fff/);
});

test('there are three button weights and no fourth', () => {
  // A fourth is how a screen ends up with three things that all look slightly
  // important.
  assert.match(css, /button\.btn\.primary \{/);
  assert.match(css, /button\.btn\.quiet \{/);
});

test('everything that floats shares one treatment', () => {
  // Height is expressed by the overlay surface, because a shadow on a dark
  // background reads as dirt.
  const lifts = css.match(/box-shadow: 0 8px 28px/g) ?? [];
  assert.ok(lifts.length >= 3, `only ${lifts.length} panels share the lift`);
  assert.match(css, /background: var\(--surface-overlay\)/);
});

// --- the areas --------------------------------------------------------------

test('the sidebar is separated by a surface, not by a rule', () => {
  // A step of surface groups; a line divides. The sidebar and the page are one
  // thing you are working in, not two placed beside each other, and a strong
  // rule between them says the opposite.
  assert.match(css, /border-inline-end: 1px solid var\(--border-subtle\)/);
  assert.match(css, /\.page-body \{[^}]*max-width: 46rem/);
});

test('the furniture is tinted and the writing is not', () => {
  // The other way round to begin with: the page was the sunken surface and the
  // sidebar sat on white above it. Wrong way for a writing tool — paper is the
  // brightest thing on a desk.
  assert.match(css, /body \{[^}]*background: var\(--surface-page\)/);
  for (const area of ['\\.sidebar', '\\.topbar', '\\.right-panel']) {
    assert.match(
      css,
      new RegExp(`${area} \\{[^}]*background: var\\(--surface-chrome\\)`),
      `${area} is furniture`,
    );
  }
});

test('editing a title is a line, not a box', () => {
  // The field rule fills a focused input with a surface and draws a border
  // round it, which is right for a form: clicking a heading turned it into a
  // white bar across the page and read as a dialog having opened.
  //
  // The selector has to carry an element to outweigh that rule, which is the
  // trap already recorded beside it.
  assert.match(css, /input\.page-title:focus[^{]*\{[^}]*background: transparent/);
  assert.match(
    css,
    /input\.page-title:focus[^{]*\{[^}]*border-block-end-color: var\(--border-default\)/,
  );
  // Declared transparent at rest, so showing it moves nothing.
  assert.match(
    css,
    /\.page-title,\s*\n\.folder-title \{[^}]*border-block-end: 1px solid transparent/,
  );
});

test('the writing has no surface of its own', () => {
  // A sheet under the text sounded right and looked wrong: on a wide screen the
  // column read as a lighter panel floating in a darker window — a distinction
  // nobody asked for, and one the eye keeps re-noticing.
  assert.doesNotMatch(css, /\.page-body \{[^}]*background: var\(--surface\)/);
});

test('a checkbox is not treated as a text field', () => {
  // The field rule sets a full-width box 44px tall, which is right for
  // something you type in and absurd for a checkbox: they rendered as enormous
  // blue lozenges filling the row.
  assert.match(css, /input:not\(:where\(\[type='checkbox'\]/);
  assert.match(css, /input\[type='checkbox'\], input\[type='radio'\] \{[^}]*accent-color: var\(--accent\)/);
});

test('the settings navigation reads down the left, not down the middle', () => {
  // A column flex box centres its children without align-items, and the text
  // inside each child centres without text-align. Both were missing, so the
  // entries sat in the middle of a left-hand column.
  assert.match(css, /\.settings-nav-item \{[^}]*align-items: flex-start/);
  assert.match(css, /\.settings-nav-item \{[^}]*text-align: start/);
});

test('the field rule cannot outweigh a class written for one field', () => {
  // Chained `:not(a):not(b):not(c)` adds three classes' worth of specificity, so
  // the generic rule beat `.page-title` and drew a box around the page heading.
  // `:where()` contributes none.
  assert.match(css, /input:not\(:where\(\[type='checkbox'\], \[type='radio'\], \[type='color'\]\)\)/);
  assert.doesNotMatch(css, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/);
});

test('the sidebar footer is laid out in one rule', () => {
  // There were two, and the later one set `display: flex` without a direction —
  // so the earlier one's `column` stayed and the four marks stacked. A property
  // left unset is not a property left alone.
  const rules = css.match(/\.sidebar-footer \{/g) ?? [];
  assert.equal(rules.length, 2, 'one for placement, one for layout');
  assert.doesNotMatch(css, /\.sidebar-footer \{[^}]*flex-direction: column/);
});
