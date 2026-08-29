/**
 * The icons an entry may carry.
 *
 * A curated list, not the whole of Lucide: two thousand icons is a search
 * problem rather than a choice. The list lives in core because the server
 * validates against it, and this is the half that checks the interface can
 * actually draw every name in it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

import * as lucide from 'lucide-react';

import { ICON_NAMES } from '../src/components/EntryIconView.tsx';

/** 'folder-open' is exported as FolderOpen. */
const componentName = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

test('every name the picker offers can be drawn', () => {
  // Derived from the set rather than hand-kept, so this checks the derivation:
  // a name that maps back to nothing would be a square in the grid that renders
  // as the default icon, indistinguishable from a real choice.
  const missing = ICON_NAMES.filter((name) => {
    const exported = name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    const found = (lucide as Record<string, unknown>)[exported];
    return !(typeof found === 'function' || (typeof found === 'object' && found !== null));
  });
  assert.deepEqual(missing.slice(0, 5), [], `not drawable: ${missing.length}`);
});

test('the same drawing does not appear under several names', () => {
  // lucide ships aliases and an `*Icon` duplicate of everything. Left in, the
  // grid shows the same picture three times and the search returns it three
  // times.
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
  assert.equal(
    ICON_NAMES.filter((name) => name.endsWith('-icon')).length,
    0,
    'no duplicates of the same drawing',
  );
});

test('the whole set is offered, not a chosen few', () => {
  // The list was fifty names somebody picked once. With a filter there is no
  // reason to choose for anybody.
  assert.ok(ICON_NAMES.length > 500, `only ${ICON_NAMES.length} offered`);
});

test('the picker filters rather than showing everything at once', () => {
  // Rendering two thousand icons is slow enough to feel like the menu is
  // broken.
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.match(menu, /name\.includes\(needle\)/);
  assert.match(menu, /\.slice\(0, 300\)/);
});

// --- drawing one ------------------------------------------------------------

test('a name that no longer resolves costs the icon, not the entry', () => {
  // A stored name can stop resolving — a rename upstream, a document written by
  // a newer version. The tree has to keep drawing the entry.
  const source = readFileSync(
    new URL('../src/components/EntryIconView.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /if \(!Chosen\) \{/);
  assert.match(source, /kind === 'folder' \? <FolderIcon \/> : <PageIcon \/>/);
});

test('an icon with no colour inherits rather than being coloured', () => {
  // Which is what lets the tree's own states — selected, muted, dragged — keep
  // working on an entry somebody gave an icon.
  //
  // Read through core now, so a palette name and a colour of one's own are
  // resolved the same way here as everywhere else — and a value that is neither
  // yields nothing, which is the same inheriting.
  const source = readFileSync(
    new URL('../src/components/EntryIconView.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /colorValue\(icon\?\.color\) \? \{ color: colorValue\(icon\?\.color\) \} : undefined/);
});

// --- choosing one -----------------------------------------------------------

const menu = readFileSync(
  new URL('../src/components/EntryMenu.tsx', import.meta.url),
  'utf8',
);

test('changing the icon keeps the colour somebody chose', () => {
  // Somebody who picked blue wants blue, not blue until they change their mind
  // about the shape.
  assert.match(menu, /icon\?\.color \? \{ color: icon\.color/);
});

test('the icon colour is unavailable while there is no icon', () => {
  // A colour for an icon that does not exist is a control that cannot do
  // anything, and one that stores a value nothing will draw.
  assert.match(menu, /disabled=\{!current\}/);
});

test('the name colour stands on its own', () => {
  // It is set through titleColor rather than through the icon, so a name can be
  // coloured with no icon at all.
  assert.match(menu, /apply\(\{ titleColor: color \}\)/);
});

test('a change applies straight away', () => {
  // Small, reversible and visible the moment it lands — a Save step would be
  // more ceremony than the decision deserves, and the tree redrawing is what
  // says it worked.
  //
  // Checked by what the choosing does, not by the absence of the word "Save" —
  // a first version asserted that and matched a different part of the file
  // entirely. Testing for a missing word is testing prose, and this is the
  // third time today it caught me.
  assert.match(menu, /\.setEntryIcon\(node\.id, changes\)/);
  assert.match(menu, /onClick=\{\(\) => chooseIcon\(name\)\}/, 'the click applies it');
});

test('a colour of your own sits beside the eight, not instead of them', () => {
  // The names are what make a workspace restylable — change what blue means and
  // every blue thing follows — so this is the escape for what a palette cannot
  // cover, not the ordinary way to pick a colour (ADR-0023).
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.match(menu, /THEME_COLORS\.map/);
  assert.match(menu, /type="color"/);
});

test('the picker is the platform’s own', () => {
  // Every platform has one people already know; a hand-built wheel would be a
  // worse version of something the browser ships.
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.doesNotMatch(menu, /conic-gradient|hue|saturation/);
});
