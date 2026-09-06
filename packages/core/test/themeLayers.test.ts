/**
 * An instance's look, and a workspace's on top of it (ADR-0123).
 *
 * Asked for as: *„Und dann noch Branding auf Instanz-Ebene […] ein Basis-Design
 * das genutzt wird, wenn im Workspace nichts eingestellt ist."*
 *
 * Which is the same sentence a theme has always been described with, one level
 * up:
 *
 * > It fills gaps, it does not override.
 *
 * So this is that rule applied twice rather than a second mechanism. The
 * instance says what everything looks like where nobody has said otherwise; a
 * workspace fills in over it; and a workspace that has never opened its own
 * settings looks exactly like the instance, which is what "base design" means.
 *
 * The whole of the difficulty is one level down, in the two settings that are
 * maps: a workspace that names a red must not thereby discard the instance's
 * blue.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mergeThemes, sanitiseTheme, themeProperties } from '../src/doc/theme.js';

describe('what a workspace adds to an instance', () => {
  test('a setting the workspace made is the workspace’s', () => {
    const merged = mergeThemes(
      sanitiseTheme({ accent: '#336699', tint: 'blue' }),
      sanitiseTheme({ accent: '#993366' }),
    );

    assert.equal(merged.accent, '#993366');
    // And the one it said nothing about is still the instance's, which is the
    // whole point of there being a layer underneath.
    assert.equal(merged.tint, 'blue');
  });

  test('and a workspace with no theme at all is the instance', () => {
    const base = sanitiseTheme({ accent: '#336699', surfaces: { rail: 'inverted' } });
    assert.deepEqual(mergeThemes(base, {}), base);
  });

  test('neither side is modified', () => {
    // They are both read from a fetch and held in state; a merge that wrote
    // into one of them would be the settings form quietly showing the other
    // layer's values as its own.
    const base = sanitiseTheme({ palette: { blue: '#000011' } });
    const over = sanitiseTheme({ palette: { red: '#110000' } });
    mergeThemes(base, over);

    assert.deepEqual(base.palette, { blue: '#000011' });
    assert.deepEqual(over.palette, { red: '#110000' });
  });
});

describe('the two settings that are maps', () => {
  test('a palette is merged name by name', () => {
    /*
     * The mistake this exists to prevent. A whole-value overwrite means a
     * workspace that changed one colour discards every other colour the
     * instance chose — and it discards them invisibly, because the workspace's
     * own settings screen goes on showing seven unset names.
     */
    const merged = mergeThemes(
      sanitiseTheme({ palette: { blue: '#000011', green: '#001100' } }),
      sanitiseTheme({ palette: { blue: '#0000ff' } }),
    );

    assert.deepEqual(merged.palette, { blue: '#0000ff', green: '#001100' });
  });

  test('and so are the surfaces', () => {
    const merged = mergeThemes(
      sanitiseTheme({ surfaces: { rail: 'inverted', panel: 'sunken' } }),
      sanitiseTheme({ surfaces: { rail: 'accent' } }),
    );

    assert.deepEqual(merged.surfaces, { rail: 'accent', panel: 'sunken' });
  });

  test('an element keeps the properties the workspace did not mention', () => {
    // An element is a map of four properties in the same way. A workspace that
    // enlarges its headings has not asked for the instance's heading colour to
    // go away.
    const merged = mergeThemes(
      sanitiseTheme({ heading1: { color: 'blue', spaceAbove: 2 } }),
      sanitiseTheme({ heading1: { size: 2 } }),
    );

    assert.deepEqual(merged.heading1, { color: 'blue', spaceAbove: 2, size: 2 });
  });
});

describe('what comes out is a theme', () => {
  test('and is drawn by the same function as any other', () => {
    // Not a third shape with rules of its own: the merge produces a
    // `WorkspaceTheme`, so everything downstream — the properties, the
    // stylesheet, the remover — is unchanged and cannot disagree about a
    // layered theme.
    const properties = themeProperties(
      mergeThemes(
        sanitiseTheme({ accent: '#336699', corners: 'round' }),
        sanitiseTheme({ surfaces: { rail: 'inverted' } }),
      ),
    );

    assert.equal(properties['--accent'], '#336699');
    assert.ok(properties['--sone-radius-lg']);
    assert.ok(properties['--sone-theme-rail-bg']);
  });

  test('and a workspace cannot smuggle anything past the rules that way', () => {
    // Both layers arrive from a form and both go through `sanitiseTheme`;
    // merging is not a second door into the theme. Asserted because the merge
    // is the obvious place for somebody to later pass raw input through.
    const merged = mergeThemes(sanitiseTheme({}), sanitiseTheme({ surfaces: { page: 'inverted' } }));
    assert.equal(merged.surfaces, undefined);
  });
});
