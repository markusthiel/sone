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

import { ENTRY_ICONS } from '@sone/core';
import * as lucide from 'lucide-react';

/** 'folder-open' is exported as FolderOpen. */
const componentName = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

test('every offered icon resolves to something drawable', () => {
  // A name stored in somebody's document has to keep resolving. Without this,
  // a typo or a rename upstream shows as a gap in the sidebar long after
  // anybody could connect the two.
  //
  // Checked by resolving the way the component does, not by looking the key up.
  // The first version only asked whether the name existed, and passed while
  // every icon in the picker rendered as the same sheet of paper — a Lucide
  // icon is a forwardRef *object*, and the component was testing for a
  // function.
  const missing = ENTRY_ICONS.filter((name) => {
    const found = (lucide as Record<string, unknown>)[componentName(name)];
    const usable = typeof found === 'function' || (typeof found === 'object' && found !== null);
    return !usable;
  });
  assert.deepEqual(missing, [], `not drawable: ${missing.join(', ')}`);
});

test('the component accepts what lucide actually exports', () => {
  // The half the check above cannot see: that EntryIconView agrees with it.
  const source = readFileSync(
    new URL('../src/components/EntryIconView.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /typeof found === 'object' && found !== null/);
});

test('the list is a choice, not a catalogue', () => {
  // Long enough to find something that fits, short enough to look at.
  //
  // The ceiling was 80 when the picker showed everything at once. It scrolls
  // now, so a wider set costs nothing to look at — but it stays bounded,
  // because the whole of Lucide is a search problem and a name stored in a
  // document has to keep resolving.
  assert.ok(ENTRY_ICONS.length >= 20, 'enough to choose from');
  assert.ok(ENTRY_ICONS.length <= 200, 'still a list somebody can scan');
});

test('no name appears twice', () => {
  assert.equal(new Set(ENTRY_ICONS).size, ENTRY_ICONS.length);
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
  const source = readFileSync(
    new URL('../src/components/EntryIconView.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /icon\?\.color \? \{ color:.*\} : undefined/);
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
