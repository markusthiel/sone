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
  colorValue,
  isCustomColor,
  readChosenColor,
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
  // A colour of one's own is accepted now (ADR-0023); a colour that is neither
  // a palette name nor a six-digit hex still is not.
  assert.deepEqual(sanitiseTheme({ body: { color: 'chartreuse' } }), {});
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

test('an icon with a colour is read', () => {
  assert.deepEqual(readEntryIcon({ kind: 'icon', value: 'folder', color: 'blue' }), {
    kind: 'icon',
    value: 'folder',
    color: 'blue',
  });
});

test('a malformed name is refused; an unknown one is not', () => {
  // Checked by shape rather than against a list. The closed list was justified
  // as "a promise the name resolves", and that promise only ever held for the
  // icon set installed at the time — what actually protects an entry is the
  // interface drawing its default when a name does not resolve.
  assert.equal(readEntryIcon({ kind: 'icon', value: 42 }), null);
  assert.equal(readEntryIcon({ kind: 'icon', value: 'Folder' }), null, 'lower case only');
  assert.equal(readEntryIcon({ kind: 'icon', value: 'a b' }), null, 'no spaces');
  assert.equal(readEntryIcon({ kind: 'icon', value: 'x'.repeat(80) }), null, 'bounded');

  // A name this version does not know is stored: a newer client may draw it,
  // and refusing would lose somebody's choice on the way through an older one.
  assert.deepEqual(readEntryIcon({ kind: 'icon', value: 'not-yet-known' }), {
    kind: 'icon',
    value: 'not-yet-known',
  });
});

test('a malformed icon yields null rather than throwing', () => {
  // It comes out of a document another client wrote, and an entry with a bad
  // icon should lose its icon and not its place in the tree.
  for (const input of [null, 'folder', 42, [], { kind: 'emoji', value: '📁' }, {}]) {
    assert.equal(readEntryIcon(input), null);
  }
});

test('an unusable colour is dropped, the icon kept', () => {
  // A hex is a colour now. Something that is neither a name nor a hex is still
  // dropped, and dropping it must not cost the icon it was attached to.
  assert.deepEqual(readEntryIcon({ kind: 'icon', value: 'folder', color: 'chartreuse' }), {
    kind: 'icon',
    value: 'folder',
  });
});

test('the title colour is read separately from the icon', () => {
  // Colouring a name and colouring its icon are two decisions, and one is
  // commonly wanted without the other.
  assert.equal(readTitleColor({ titleColor: 'green' }), 'green');
  assert.equal(readTitleColor({ kind: 'icon', value: 'folder' }), null);
  assert.equal(readTitleColor({ titleColor: 'chartreuse' }), null);
});

// --- a colour of one's own --------------------------------------------------

test('a palette name resolves to the workspace variable', () => {
  // Which is what makes a workspace restylable: change what blue means and
  // every blue thing follows.
  assert.equal(colorValue('blue'), 'var(--sone-palette-blue)');
});

test('a custom colour is itself', () => {
  assert.equal(colorValue('#ff8800'), '#ff8800');
  assert.equal(readChosenColor('#FF8800'), '#ff8800', 'stored lower case');
});

test('a value that is neither yields nothing to draw', () => {
  // What lets an older client fall back to the design's own answer rather than
  // breaking on a value it does not recognise.
  for (const input of ['chartreuse', '#fff', '#ff88', 'rgb(1,2,3)', 42, null]) {
    assert.equal(colorValue(input), undefined, String(input));
    assert.equal(readChosenColor(input), null, String(input));
  }
});

test('shorthand and alpha are not offered', () => {
  // Six digits only. A three-digit form and an eight-digit one would each need
  // their own handling everywhere a colour is read, for no choice somebody
  // cannot already make.
  assert.equal(isCustomColor('#fff'), false);
  assert.equal(isCustomColor('#ffffff80'), false);
  assert.equal(isCustomColor('#ffffff'), true);
});

test('a theme and an icon both accept either shape', () => {
  // One field, two shapes — not two fields (ADR-0023).
  assert.deepEqual(sanitiseTheme({ body: { color: '#123456' } }), {
    body: { color: '#123456' },
  });
  assert.equal(
    themeProperties({ body: { color: '#123456' } })['--sone-theme-body-color'],
    '#123456',
  );
  assert.equal(readEntryIcon({ kind: 'icon', value: 'folder', color: '#abcdef' })?.color, '#abcdef');
  assert.equal(readTitleColor({ titleColor: '#abcdef' }), '#abcdef');
});

// --- the workspace palette --------------------------------------------------

test('changing a name changes everything that stored it', () => {
  // The half that makes names worth having. Nothing that stored "blue" knows
  // this happened; it follows because it stored a name (ADR-0023).
  const properties = themeProperties({ palette: { blue: '#0a84ff' } });
  assert.equal(properties['--sone-palette-blue'], '#0a84ff');
});

test('only the eight names, and only literals', () => {
  // A name mapped to another name would be an alias — one more thing that can
  // point at itself, for no gain.
  assert.deepEqual(sanitiseTheme({ palette: { chartreuse: '#123456' } }), {});
  assert.deepEqual(sanitiseTheme({ palette: { blue: 'green' } }), {});
  assert.deepEqual(sanitiseTheme({ palette: { blue: '#ABCDEF' } }), {
    palette: { blue: '#abcdef' },
  });
});

test('a workspace that changed nothing overrides nothing', () => {
  // Every name it has not touched keeps the design's own value, so a partly
  // set palette is not a half-broken one.
  assert.deepEqual(themeProperties({ palette: { red: '#ff0000' } }), {
    '--sone-palette-red': '#ff0000',
  });
  assert.deepEqual(themeProperties({}), {});
});

test('the palette survives alongside element settings', () => {
  // They live in one object and are read in one pass; losing one to the other
  // would be the kind of thing noticed only after somebody set both.
  const theme = sanitiseTheme({
    palette: { green: '#00ff00' },
    heading1: { size: 1 },
  });
  assert.deepEqual(theme, { palette: { green: '#00ff00' }, heading1: { size: 1 } });
});

test('a tint and an accent survive, and their contrast is computed', () => {
  // Two whole-interface knobs rather than a colour per surface: the surfaces are
  // a ramp of one grey, and setting them separately would let a workspace set
  // them inconsistently (ADR-0023).
  const theme = sanitiseTheme({ tint: '#F7F5F0', accent: 'green' });
  assert.equal(theme.tint, '#f7f5f0', 'lowercased like every other literal');
  assert.equal(theme.accent, 'green', 'or one of the eight names');

  const properties = themeProperties({ accent: '#eedd55' });
  assert.equal(properties['--accent'], '#eedd55');
  // A pale accent needs dark text on it. Computed, never chosen: offering the
  // choice would be offering a way to make a button unreadable.
  assert.equal(properties['--accent-contrast'], '#141210');
  assert.equal(themeProperties({ accent: '#1b4d3e' })['--accent-contrast'], '#ffffff');

  // The tint is one property; the stylesheet holds the proportions, because that
  // is where the ramp's relationships are readable beside the tokens.
  assert.deepEqual(themeProperties({ tint: '#f0e6d2' }), {
    '--sone-theme-tint': '#f0e6d2',
  });
});

test('nonsense is dropped rather than stored', () => {
  // The same rule the palette follows: unknown values are dropped, not
  // rejected, so an older build reading a newer theme degrades quietly.
  const theme = sanitiseTheme({ tint: 'chartreuse', accent: 42 });
  assert.equal(theme.tint, undefined);
  assert.equal(theme.accent, undefined);
});
