/**
 * What a workspace theme may say.
 *
 * The rules live in core so the server that validates and the client that
 * renders cannot disagree. These cover the two things that matter: that a bad
 * value cannot get in, and that a theme only ever fills gaps.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  readEntryIcon,
  readTitleColor,
  sanitiseTheme,
  themeProperties,
} from '../src/doc/theme.js';

test('a usable setting survives', () => {
  assert.deepEqual(sanitiseTheme({ heading1: { size: 2, color: 'blue' } }), {
    heading1: { size: 2, color: 'blue' },
  });
});

test('an unknown element is dropped, and the rest kept', () => {
  // A theme arrives from a form, and one stale field should not cost somebody
  // the rest of their settings.
  assert.deepEqual(
    sanitiseTheme({ heading1: { size: 1 }, banner: { size: 3 } }),
    { heading1: { size: 1 } },
  );
});

test('a value outside the steps is dropped', () => {
  // Free numbers produce a heading that no longer relates to the body text, and
  // whoever set it cannot see that is what happened.
  assert.deepEqual(sanitiseTheme({ heading1: { size: 47 } }), {});
  assert.deepEqual(sanitiseTheme({ body: { color: '#ff0000' } }), {}, 'names, not values');
});

test('an element with nothing usable is omitted rather than stored empty', () => {
  // So "has a theme" and "has settings" mean the same thing.
  assert.deepEqual(sanitiseTheme({ heading1: { size: 'huge' } }), {});
});

test('nonsense yields an empty theme rather than throwing', () => {
  for (const input of [null, undefined, 'theme', 42, ['heading1']]) {
    assert.deepEqual(sanitiseTheme(input), {});
  }
});

test('the input is not modified', () => {
  const input = { heading1: { size: 1, bogus: true } };
  sanitiseTheme(input);
  assert.deepEqual(input, { heading1: { size: 1, bogus: true } });
});

test('only what the theme sets becomes a property', () => {
  // Everything else keeps falling through to the stylesheet's own answer, which
  // is what makes a theme gaps filled rather than a replacement design.
  const properties = themeProperties({ heading1: { color: 'blue' } });
  assert.deepEqual(Object.keys(properties), ['--sone-theme-heading1-color']);
});

test('an empty theme produces no properties at all', () => {
  // A workspace with no theme has to render exactly as every workspace did
  // before themes existed.
  assert.deepEqual(themeProperties({}), {});
});

test('a size is a multiplier, so it composes with the reading scale', () => {
  // Somebody reading at a larger scale should see this workspace's proportions
  // larger — not a different design.
  const bigger = themeProperties({ heading1: { size: 1 } });
  const smaller = themeProperties({ heading1: { size: -1 } });

  assert.ok(Number(bigger['--sone-theme-heading1-size']) > 1);
  assert.ok(Number(smaller['--sone-theme-heading1-size']) < 1);
  assert.equal(themeProperties({ heading1: { size: 0 } })['--sone-theme-heading1-size'], '1.0000');
});

// --- entry icons ------------------------------------------------------------

test('an emoji icon with a colour is read', () => {
  assert.deepEqual(readEntryIcon({ kind: 'emoji', value: '📁', color: 'blue' }), {
    kind: 'emoji',
    value: '📁',
    color: 'blue',
  });
});

test('a malformed icon yields null rather than throwing', () => {
  // It comes out of a document another client wrote, and an entry with a bad
  // icon should lose its icon and not its place in the tree.
  for (const input of [null, 'folder', 42, [], { kind: 'lucide', value: 'folder' }, {}]) {
    assert.equal(readEntryIcon(input), null);
  }
});

test('a colour outside the palette is dropped, the icon kept', () => {
  assert.deepEqual(readEntryIcon({ kind: 'emoji', value: '📁', color: '#ff0000' }), {
    kind: 'emoji',
    value: '📁',
  });
});

test('a long value is refused', () => {
  // An emoji is a handful of code points; a long string here is either a
  // mistake or somebody putting a paragraph in the sidebar.
  assert.equal(readEntryIcon({ kind: 'emoji', value: 'a'.repeat(40) }), null);
  assert.equal(readEntryIcon({ kind: 'emoji', value: '   ' }), null);
});

test('the title colour is read separately from the icon', () => {
  // Colouring a name and colouring its icon are two decisions, and one is
  // commonly wanted without the other.
  assert.equal(readTitleColor({ titleColor: 'green' }), 'green');
  assert.equal(readTitleColor({ kind: 'emoji', value: '📁' }), null);
  assert.equal(readTitleColor({ titleColor: 'chartreuse' }), null);
});
