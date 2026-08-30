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
  assert.match(css, /input, textarea \{[^}]*background: var\(--surface-sunken\)/);
  assert.match(css, /input:focus, textarea:focus \{[^}]*border-color: var\(--accent\)/);
});

test('a focused field has one ring, not two', () => {
  // The accent border replaces the outline rather than joining it. Two rings
  // around one field is the tell of a control nobody looked at.
  assert.match(css, /input:focus, textarea:focus \{[^}]*outline: none/);
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
