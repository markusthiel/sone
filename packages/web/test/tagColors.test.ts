/**
 * Where a tag chip gets its colour.
 *
 * Every tag has one derived from its own name (ADR-0020), so the same tag is the
 * same colour for everybody with nothing stored. A workspace may override it,
 * and the workspace tag list already carries the resolved answer.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { derivedTagColor } from '@sone/core';

test('a tag chip is coloured from the workspace answer, not from the draft', () => {
  // The colour source has to be the full tag list. A first version read it from
  // the filtered suggestions, which are empty whenever the input is — so every
  // chip would have lost its colour the moment somebody stopped typing.
  const source = readFileSync(
    new URL('../src/components/TagEditor.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /known\.find\(\(entry\) => entry\.key === keyOf\(tag\)\)\?\.color/);
  assert.doesNotMatch(source, /suggestions\.find\(\(entry\) => entry\.key/);
});

test('a tag with no workspace entry still gets a colour', () => {
  // A tag typed a moment ago is not in the list yet, and showing it grey until
  // the next refresh would make a new tag look unlike the same tag elsewhere.
  const source = readFileSync(
    new URL('../src/components/TagEditor.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /derivedTagColor\(tag\)/);
});
