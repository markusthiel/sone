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
  assert.match(css, /\.ProseMirror h1\[data-block\][^{]*\{[^}]*font-weight: var\(--sone-heading-weight\)/);
});

test('the page title is furniture, and furniture may be firm', () => {
  /*
   * It used to take --sone-heading-weight, so the rule above — which is an
   * argument about prose — was being applied to something that is not prose.
   *
   * A heading inside a document introduces the paragraph under it, and a bold
   * one shouts at the thing it introduces. A page title is the label on the
   * thing you have open, in a row with the sidebar's labels and the breadcrumb.
   * Two jobs, two tokens; the shared one was the accident.
   */
  assert.match(css, /--sone-title-weight: 700/);
  assert.match(css, /\.page-title \{[^}]*font-weight: var\(--sone-title-weight\)/);
  assert.match(css, /\.page-title \{[^}]*letter-spacing: var\(--sone-title-tracking\)/);
  // And the document's own headings did not follow it.
  assert.doesNotMatch(css, /--sone-heading-weight: 700/);
});

test('a folder is titled exactly like a page', () => {
  // They were 2rem bold and 2.5rem light, so moving between a folder and a page
  // looked like moving between two applications. One rule now, and one element:
  // a folder's name is the same input, so there is nothing left to diverge.
  assert.match(css, /\.page-title \{[^}]*font-size: 2\.5rem/);
  assert.doesNotMatch(css, /\.folder-title/);
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
