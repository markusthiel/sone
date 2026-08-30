/**
 * Type in the interface and in a document.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('headings are thin and set tight', () => {
  // Size carries the weight, not stroke width. A bold heading over a note
  // shouts at the thing it introduces.
  assert.match(css, /--sone-heading-weight: 300/);
  assert.match(css, /\.page-title \{[^}]*font-weight: var\(--sone-heading-weight\)/);
});

test('a heading size is written once', () => {
  // It was written twice — once for the heading and once inside the workspace
  // theme's multiplier — so changing one left the other applying the old size,
  // visible until somebody set a multiplier and then silently replaced.
  assert.match(css, /--sone-h1: /);
  assert.match(css, /calc\(var\(--sone-h1\) \* var\(--sone-theme-heading1-size, 1\)\)/);
  assert.doesNotMatch(css, /calc\(1\.9rem \* var\(--sone-theme-heading1-size/);
});

test('no font is fetched from a font service', () => {
  // This is self-hosted software. A stylesheet that reaches out to Google tells
  // Google who opened somebody's notes and when.
  assert.doesNotMatch(css, /@import|fonts\.googleapis|fonts\.gstatic/);
});

test('a section label is not a document heading', () => {
  // One names a place, the other names a passage. Opposite treatments on
  // purpose: small, firm and set apart against large, thin and quiet.
  assert.match(css, /\.settings-heading \{[^}]*text-transform: uppercase/);
  assert.match(css, /\.settings-heading \{[^}]*font-weight: 600/);
});
