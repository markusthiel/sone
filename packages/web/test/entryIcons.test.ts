/**
 * The icons an entry may carry.
 *
 * A curated list, not the whole of Lucide: two thousand icons is a search
 * problem rather than a choice. The list lives in core because the server
 * validates against it, and this is the half that checks the interface can
 * actually draw every name in it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENTRY_ICONS } from '@sone/core';
import * as lucide from 'lucide-react';

/** 'folder-open' is exported as FolderOpen. */
const componentName = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

test('every offered icon exists in the set that draws it', () => {
  // A name stored in somebody's document has to keep resolving. Without this,
  // a typo or a rename upstream shows as a gap in the sidebar long after
  // anybody could connect the two.
  const missing = ENTRY_ICONS.filter(
    (name) => !(componentName(name) in (lucide as Record<string, unknown>)),
  );
  assert.deepEqual(missing, [], `not in lucide-react: ${missing.join(', ')}`);
});

test('the list is a choice, not a catalogue', () => {
  // Long enough to find something that fits, short enough to look at.
  assert.ok(ENTRY_ICONS.length >= 20, 'enough to choose from');
  assert.ok(ENTRY_ICONS.length <= 80, 'few enough to scan');
});

test('no name appears twice', () => {
  assert.equal(new Set(ENTRY_ICONS).size, ENTRY_ICONS.length);
});
