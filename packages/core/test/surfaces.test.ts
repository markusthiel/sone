/**
 * Treating the furniture separately (ADR-0122).
 *
 * Asked for as: *„einzelne Elemente behandeln, z.B. die neue schmale Leiste
 * dunkel und Rest hell"* — and the point of the request is that a theme which
 * only recolours everything at once is the thing every tool already has:
 * *„dass dann halt alle Farben anders sind, aber sonst verändert sich nichts."*
 *
 * The rule this must not break is the one that makes a theme safe:
 *
 * > Steps, not values. […] Free numbers produce a heading that no longer
 * > relates to the body text underneath it.
 *
 * So a surface is not given a colour. It is given a **treatment** — a named
 * relationship — and the stylesheet resolves what that means in the scheme the
 * reader is actually in. `inverted` is the whole argument in one word: it is
 * light-on-dark for somebody in the light theme and dark-on-light for somebody
 * in the dark one, from one stored value.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sanitiseTheme, themeProperties } from '../src/doc/theme.js';

describe('what a theme may say about a surface', () => {
  test('a named treatment on a named surface', () => {
    const theme = sanitiseTheme({ surfaces: { rail: 'inverted', sidebar: 'sunken' } });
    assert.deepEqual(theme.surfaces, { rail: 'inverted', sidebar: 'sunken' });
  });

  test('and nothing else', () => {
    /*
     * A colour here would be the whole point lost: `#101010` on the rail is
     * black in both schemes, so a workspace that set it would have a black bar
     * against a black page for everybody who reads in the dark.
     *
     * Unknown values are dropped rather than rejected, the rule the rest of
     * this file follows: a theme arrives from a form, and one stale field
     * should not cost somebody the rest of their settings.
     */
    const theme = sanitiseTheme({
      surfaces: { rail: '#101010', sidebar: 'shiny', page: 'inverted', 7: 'sunken' },
    });
    assert.equal(theme.surfaces, undefined);
  });

  test('the page is not among them, on purpose', () => {
    /*
     * Inverting the reading surface is "dark mode for this workspace", and that
     * is the reader's choice rather than the workspace's — somebody outside in
     * the sun wants light regardless of what a workspace prefers, which is the
     * argument the stylesheet already makes for `prefers-color-scheme`.
     *
     * The three that can be treated are furniture: the rail, the tree beside
     * it, and the panel on the other side.
     */
    assert.equal(sanitiseTheme({ surfaces: { page: 'inverted' } }).surfaces, undefined);
    assert.equal(sanitiseTheme({ surfaces: { topbar: 'accent' } }).surfaces, undefined);
  });

  test('“follow” is stored as nothing at all', () => {
    // Absent and "as the design decides" are the same state (ADR-0021), and a
    // stored default is a value that stops being right the moment the design
    // changes underneath it.
    assert.equal(sanitiseTheme({ surfaces: { rail: 'follow' } }).surfaces, undefined);
  });
});

describe('what a surface becomes', () => {
  test('a treatment is a whole small scheme, and every part is an indirection', () => {
    /*
     * The half that makes dark mode free. Nothing here is a colour: each
     * property points at a variable the stylesheet defines twice — once per
     * scheme — so the same stored `inverted` resolves to opposite ends
     * depending on where the reader is.
     *
     * **The list was four and had to be seven.** ADR-0122 described a `hover`
     * and the stylesheet reads one; nothing emitted it, so a hover inside an
     * inverted rail painted the *page's* hover — a light box under a light
     * icon, which is the icon disappearing when you point at it. Reported, and
     * invisible to this test because the test named the same four the code did.
     *
     * So the parts are read off what is emitted rather than listed again here.
     * A treatment that forgets one is now a treatment that fails a test.
     */
    for (const treatment of ['raised', 'sunken', 'inverted', 'accent'] as const) {
      const properties = themeProperties(sanitiseTheme({ surfaces: { rail: treatment } }));
      const parts = Object.keys(properties)
        .filter((name) => name.startsWith('--sone-theme-rail-'))
        .map((name) => name.slice('--sone-theme-rail-'.length));

      assert.deepEqual(
        parts.sort(),
        ['accent', 'accent-ink', 'accent-quiet', 'bg', 'border', 'hover', 'ink', 'muted'],
        `${treatment} says everything a surface needs`,
      );
      for (const part of parts) {
        assert.match(
          properties[`--sone-theme-rail-${part}`] ?? '',
          /^var\(--/,
          `${treatment}.${part} is a variable, never a colour`,
        );
      }
    }
  });

  test('and a surface that is not the page has its own accent', () => {
    /*
     * The other half of the same report: *„Das selbe gilt für die
     * Akzentfarbe."*
     *
     * The mark's third bar is `var(--accent)` and a filled button is drawn in
     * it. On an accent-coloured rail that is accent on accent — a logo that
     * vanishes — so the pair is swapped there: the button becomes the contrast
     * colour with accent-coloured text.
     *
     * On an inverted surface it is the *other* scheme's accent, because
     * `--accent-500` on near-black is the same too-dark green the dark theme
     * already replaces with `--accent-300`.
     */
    const accented = themeProperties(sanitiseTheme({ surfaces: { rail: 'accent' } }));
    assert.equal(accented['--sone-theme-rail-accent'], 'var(--accent-contrast)');
    assert.equal(accented['--sone-theme-rail-accent-ink'], 'var(--accent)');

    const inverted = themeProperties(sanitiseTheme({ surfaces: { rail: 'inverted' } }));
    assert.equal(inverted['--sone-theme-rail-accent'], 'var(--sone-inverse-accent)');
  });

  test('and a surface nobody treated emits nothing', () => {
    // The stylesheet's own fallback is what draws it, which is what keeps a
    // theme "gaps filled" rather than a replacement design (ADR-0023).
    const properties = themeProperties(sanitiseTheme({ surfaces: { rail: 'sunken' } }));

    assert.ok(properties['--sone-theme-rail-bg']);
    assert.equal(properties['--sone-theme-sidebar-bg'], undefined);
    assert.equal(properties['--sone-theme-panel-bg'], undefined);
  });

  test('an accented surface takes the computed contrast, never a chosen one', () => {
    // A pale accent needs dark text on it and a deep one needs light text. A
    // workspace that could choose would be a workspace that can make a rail
    // nobody can read.
    const properties = themeProperties(sanitiseTheme({ surfaces: { sidebar: 'accent' } }));

    assert.equal(properties['--sone-theme-sidebar-bg'], 'var(--accent)');
    assert.equal(properties['--sone-theme-sidebar-ink'], 'var(--accent-contrast)');
  });
});

describe('corners', () => {
  test('three steps, and the middle one is what the design already does', () => {
    assert.equal(sanitiseTheme({ corners: 'round' }).corners, 'round');
    assert.equal(sanitiseTheme({ corners: 'sharp' }).corners, 'sharp');
    assert.equal(sanitiseTheme({ corners: '12px' }).corners, undefined, 'not a length');
    // And the middle one is stored as nothing, the rule `follow` follows: a
    // theme that stored `soft` would keep today's radii after the design had
    // moved on from them.
    assert.equal(sanitiseTheme({ corners: 'soft' }).corners, undefined);
  });

  test('and they move the three radii together', () => {
    /*
     * Three tokens from one choice, because the relationship between them is
     * the design: *„a small control with a large radius reads as a pill by
     * accident"*. Letting a workspace set them separately is letting it break
     * that on purpose.
     */
    const round = themeProperties(sanitiseTheme({ corners: 'round' }));
    assert.ok(round['--sone-radius-sm']);
    assert.ok(round['--sone-radius']);
    assert.ok(round['--sone-radius-lg']);

    const small = Number.parseInt(round['--sone-radius-sm'] ?? '0', 10);
    const large = Number.parseInt(round['--sone-radius-lg'] ?? '0', 10);
    assert.ok(small < large, 'and they keep their order');
  });
});

describe('what a theme leaves behind', () => {
  test('every property it can set starts with one of two prefixes', () => {
    /*
     * **The bug this found.** `clearTheme` removes properties beginning with
     * `--sone-theme-` when a theme changes — and `themeProperties` has always
     * also emitted `--accent`, `--accent-contrast` and `--sone-palette-*`,
     * which it therefore never removed. Switching from a workspace with an
     * accent to one without left the first workspace's accent on the page.
     *
     * Asserted here rather than in the hook, because the list of prefixes is a
     * property of what this function emits: the remover has to be able to
     * recognise everything the setter can produce, and a new prefix added here
     * without changing the remover is the same bug again.
     */
    const everything = themeProperties(
      sanitiseTheme({
        tint: 'blue',
        accent: '#336699',
        corners: 'round',
        fonts: 'reading',
        palette: { blue: '#001122' },
        surfaces: { rail: 'inverted', sidebar: 'accent', panel: 'sunken' },
        heading1: { size: 2, color: 'red' },
      }),
    );

    assert.ok(Object.keys(everything).length > 10, 'a theme that says a lot');
    for (const name of Object.keys(everything)) {
      assert.match(
        name,
        /^--(sone-theme-|sone-palette-|sone-radius|sone-font|accent)/,
        `${name} is recognisable as a theme's doing`,
      );
    }
  });
});
