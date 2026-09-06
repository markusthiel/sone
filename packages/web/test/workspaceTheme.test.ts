/**
 * Putting a workspace's theme on the page.
 *
 * It resolves to custom properties on the document root. No component reads a
 * theme and no document carries one: the properties change what the existing
 * variables resolve to, and the stylesheet falls back to its own answer where a
 * property is absent — which is what makes a theme gaps filled rather than a
 * replacement design.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { sanitiseTheme, themeProperties } from '@sone/core';

import { PALETTE_DEFAULTS } from '@sone/core';

import { codeOf, stylesOf } from './helpers/source.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = codeOf(new URL('../src/hooks/useWorkspaceTheme.ts', import.meta.url));
const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('properties are removed as well as set', () => {
  // A theme that stops specifying a heading colour has to leave no trace, or
  // the last colour anybody chose would survive its own deletion — the same
  // class of mistake as storing an explicit default.
  assert.match(hook, /removeProperty/);
  /*
   * And every prefix, not one of them.
   *
   * It was `--sone-theme-` alone, while `themeProperties` has always also
   * emitted `--accent`, `--accent-contrast` and `--sone-palette-*` — set and
   * never removed, so leaving a workspace with an accent for one without left
   * the first one's accent on the page. What the setter can produce is
   * asserted where it is produced (`core/test/surfaces.test.ts`); this is the
   * remover being able to recognise all of it.
   */
  for (const prefix of [
    '--sone-theme-',
    '--sone-palette-',
    '--sone-radius',
    '--sone-font',
    '--accent',
  ]) {
    assert.match(hook, new RegExp(`'${prefix}'`), `${prefix} is removed too`);
  }
});

test('a workspace does not follow somebody into the next one', () => {
  assert.match(hook, /return \(\) => clearTheme\(root, \{\}\)/);
});

test('a failure is silent', () => {
  // The theme is decorative: losing it costs appearance and never content, and
  // an error banner about a heading colour would be louder than what it
  // reports.
  assert.match(hook, /\.catch\(\(\) => \{/);
});

test("a block's own colour wins over the theme", () => {
  // Somebody chose it. The theme only fills the gap where nobody did.
  assert.match(css, /h1\[data-block\]:not\(\[data-color\]\)/);
  assert.match(css, /--sone-theme-heading1-color, inherit/);
});

test('every theme property has a fallback in the stylesheet', () => {
  // A workspace with no theme has to render exactly as every workspace did
  // before themes existed, so no rule may depend on a property being set.
  const uses = [...css.matchAll(/var\((--sone-theme-[a-z0-9-]+)([^)]*)\)/g)];
  assert.ok(uses.length > 0, 'the properties are used at all');
  for (const [, name, rest] of uses) {
    assert.match(rest, /,\s*\S/, `${name} has no fallback`);
  }
});

// --- an instance underneath the workspace (ADR-0123) -------------------------

test('what is drawn is the instance’s design with the workspace’s over it', () => {
  /*
   * The merge is in `@sone/core` and tested there; what matters here is that
   * this hook is what applies it — and that it merges rather than choosing.
   *
   * The other direction is the one that has to stay wrong: the settings form
   * reads the workspace's theme from the same route and has to show what the
   * *workspace* set. A form displaying the instance's accent as its own is a
   * form where clearing a setting appears to change nothing.
   */
  assert.match(hook, /useMemo\(\(\) => mergeThemes\(base, theme\)/);
  assert.match(hook, /themeProperties\(merged\)/);
  assert.match(hook, /base: WorkspaceTheme = \{\}/, 'an instance with none is no instance');
});

// --- light and dark (ADR-0124) -----------------------------------------------

const app = codeOf(new URL('../src/App.tsx', import.meta.url));
const appearance = codeOf(new URL('../src/hooks/useAppearance.ts', import.meta.url));

test('there is exactly one writer of the scheme', () => {
  /*
   * The decision the whole record turns on. Both the theme and the scheme are
   * resolved once, above every branch of the router — applying the instance's
   * answer at the top and refining it inside the workspace would be two
   * writers of one attribute, which is a screen that changes colour a moment
   * after it appears.
   *
   * It also fixes something that was quietly wrong before: `useAppearance` was
   * called *only* by the appearance settings screen, so a signed-out sign-in
   * screen never carried an instance's colours at all.
   */
  assert.equal(app.match(/useAppearance\(/g)?.length, 1, 'one caller');
  assert.match(app, /useAppearance\(\s*resolveScheme\(/);
  // And nothing else sets the attribute the scheme is expressed as.
  assert.equal(appearance.match(/dataset\['theme'\]/g)?.length, 1);
});

test('the browser remembers the answer, and does not decide it', () => {
  /*
   * The first paint happens before the session has loaded, so something has to
   * be painted from memory — but what is stored is a copy of what was resolved
   * last time, never a preference. It is read only when there is no resolved
   * answer yet, and overwritten as soon as there is.
   */
  assert.match(appearance, /scheme\?: ColorScheme/, 'the answer arrives from outside');
  assert.match(appearance, /if \(!scheme\) return;/, 'and nothing is guessed before it does');
  assert.doesNotMatch(appearance, /setTheme/, 'no way to choose one here any more');
});

// --- treating one piece of furniture (ADR-0122) ------------------------------

test('a treated surface redefines the names its own contents read', () => {
  /*
   * The mechanism, stated so a later tidy-up has to argue with it.
   *
   * Nothing inside the sidebar is told that the sidebar was treated. The
   * container redefines `--text-primary` and friends for its own subtree, and
   * every row, label and line inside follows — the alternative was adding a
   * fallback to each of the several dozen rules that name a colour in there,
   * and the one that was forgotten is a row nobody can read.
   *
   * The fallback is `--sone-base-*` and not the name itself, because
   * `--text-primary: var(--text-primary)` is a cycle: both sides become
   * invalid and the whole interface loses its text colour.
   */
  for (const [area, surface] of [
    ['\\.icon-rail', 'rail'],
    ['\\.sidebar', 'sidebar'],
    ['\\.right-panel', 'panel'],
  ] as const) {
    const rule = new RegExp(`${area} \\{[^}]*\\}`).exec(css)?.[0] ?? '';
    for (const [name, base] of [
      ['--text-primary', 'ink'],
      ['--text-muted', 'muted'],
      ['--border-subtle', 'border'],
      ['--surface-hover', 'hover'],
    ]) {
      assert.ok(
        rule.includes(`${name}: var(--sone-theme-${surface}-${base}, var(--sone-base-${base}))`),
        `${area} redefines ${name}`,
      );
    }
    assert.doesNotMatch(rule, /var\(--text-primary\)\s*;/, 'and never from itself');
  }
});

test('the stylesheet reads every part a treatment sets', () => {
  /*
   * **The test the reported bug needed** (ADR-0131).
   *
   * The two halves are written in different files: the core decides what a
   * treatment resolves to, and the stylesheet decides which of those a surface
   * reads. ADR-0122 wrote `--sone-theme-<surface>-hover` into the stylesheet
   * and never emitted it, so an inverted rail took the *page's* hover — a light
   * box under a light icon, which is the icon vanishing when you point at it.
   *
   * Neither side's test could see it: each named its own four. This compares
   * them, from what the core emits, so a part added on either side alone fails.
   */
  for (const surface of ['rail', 'sidebar', 'panel'] as const) {
    const emitted = Object.keys(
      themeProperties(sanitiseTheme({ surfaces: { [surface]: 'inverted' } })),
    ).filter((name) => name.startsWith(`--sone-theme-${surface}-`));

    assert.ok(emitted.length > 0, `${surface} is treatable`);
    for (const name of emitted) {
      assert.ok(css.includes(`var(${name},`), `${name} is read, with a fallback`);
    }
  }
});

test('and a treated surface carries its own accent', () => {
  // The mark's third bar and every filled control are drawn in it. A surface
  // that does not carry its own is one where the logo and the buttons belong to
  // the page behind it — which on an accent-coloured rail is accent on accent.
  for (const [area, surface] of [
    ['\\.icon-rail', 'rail'],
    ['\\.sidebar', 'sidebar'],
    ['\\.right-panel', 'panel'],
  ] as const) {
    const rule = new RegExp(`${area} \\{[^}]*\\}`).exec(css)?.[0] ?? '';
    for (const name of ['--accent', '--accent-contrast', '--sone-accent']) {
      assert.ok(rule.includes(`${name}: var(--sone-theme-${surface}-accent`), `${area} ${name}`);
    }
  }
});

test('a popup goes back to what the page means', () => {
  // It floats above the page on the overlay surface, and the overlay surface is
  // not treated — so a menu opening out of an inverted rail would be drawn
  // light and handed the rail's light text.
  const rule =
    /:is\(\.icon-rail, \.sidebar, \.right-panel\)\s*:is\([^)]*\) \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(rule, /--text-primary: var\(--sone-base-ink\)/);
  assert.match(rule, /\.sidebar-account-menu/);
});

test('a treatment is a relationship, and each theme says what it means', () => {
  // The half that makes one stored `inverted` right for both readers. Declared
  // in each theme rather than computed once, so "the other end" is dark against
  // light and light against dark — a stored `#161615` would be a black bar
  // against a black page for everybody reading in the dark.
  //
  // That both themes declare all five is what `tokens.test.ts` enforces; this
  // is that they exist at all, and that neither is a literal.
  for (const part of ['bg', 'ink', 'muted', 'border', 'hover']) {
    assert.match(css, new RegExp(`--sone-inverse-${part}: var\\(--ink-`), part);
  }
  // And the accented pair mixes into the accent itself, never into
  // `transparent` — a mix with transparent pulls towards black, so a faded
  // white on a pale accent comes out grey (the trap `brand.test.ts` records).
  for (const name of ['--sone-accent-muted', '--sone-accent-hover']) {
    const value = new RegExp(`${name}: ([^;]+);`).exec(css)?.[1] ?? '';
    assert.match(value, /var\(--accent\)\s*\)$/, `${name} falls back to the accent`);
  }
});

test('the palette is defined once', () => {
  // The same eight names are used by tags, select options, block colours and
  // themes. Written out separately in each, "blue" could drift into four
  // slightly different blues without anybody noticing.
  for (const color of ['grey', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']) {
    assert.ok(css.includes(`--sone-palette-${color}:`), color);
  }
});

// --- the editor -------------------------------------------------------------

const settings = codeOf(new URL('../src/components/ThemeSettings.tsx', import.meta.url));

test('"As designed" removes the setting rather than storing its value', () => {
  // A stored default stops following the design the moment the design changes,
  // which is the whole reason block attributes use null for this.
  assert.match(settings, /event\.target\.value === '' \? undefined :/);
  assert.match(settings, /if \(value === undefined\) delete entry\[property\]/);
});

test('removing the last property removes the element', () => {
  // So "has a theme" and "has settings" keep meaning the same thing, exactly as
  // the server's own validation does.
  assert.match(settings, /if \(Object\.keys\(entry\)\.length === 0\) delete next\[element\]/);
});

test('the form shows what was stored, not what was sent', () => {
  // They differ when something was not usable, and a form claiming a setting
  // the server dropped is a form that lies quietly.
  assert.match(settings, /setTheme\(result\.theme\)/);
});

test('somebody who may not edit gets disabled controls, not a failed save', () => {
  // A form that lets somebody fill it in and then refuses is worse than one
  // that says up front it is read-only.
  assert.match(settings, /disabled=\{!canEdit\}/);
});

test('an element is set in steps and names, never in free values', () => {
  // Free numbers produce a heading that no longer relates to the body text.
  //
  // Narrowed when the palette editor arrived: that one *is* free values, and
  // deliberately — deciding what "blue" looks like is exactly the choice a
  // palette exists to hold, and it is made once for the workspace rather than
  // per element. So the rule is about the element table, not the file.
  assert.match(settings, /SIZE_STEPS/);
  assert.match(settings, /SPACE_STEPS/);
  assert.match(settings, /THEME_COLORS/);

  const table = settings.slice(settings.indexOf('<table className="theme-table">'));
  assert.doesNotMatch(table, /type="number"/);
  assert.doesNotMatch(table, /type="color"/);
});

// --- the workspace palette --------------------------------------------------

test('the palette the code holds and the palette the stylesheet holds agree', () => {
  /*
   * A colour input needs a value, so the eight defaults exist as data as well
   * as in the stylesheet — and since ADR-0136 the *server* needs them too: an
   * accent stored as a name still has to have a contrast colour computed for
   * it, and `var(--sone-palette-yellow)` has no luminance.
   *
   * So the data moved to `@sone/core`, where the measuring happens, and the
   * settings form reads it from there. Two lists became one. The stylesheet is
   * still a second place the same eight colours are written — it has to be,
   * they are what the browser resolves — and this is what keeps the two in
   * step.
   */
  for (const [name, inCode] of Object.entries(PALETTE_DEFAULTS)) {
    const inSheet = new RegExp(`--sone-palette-${name}: (#[0-9a-f]{6})`).exec(css)?.[1];
    // Grey is defined from the ink ramp rather than as a literal, so it has no
    // hex to compare — the check is that every other name agrees exactly.
    if (inSheet) assert.equal(inCode, inSheet, name);
  }
});

test('resetting a name removes it rather than storing the default', () => {
  // Stored, it would stop following a change to the design — the same
  // distinction every other setting here makes.
  const settingsSource = readFileSync(
    path.resolve(here, '../src/components/ThemeSettings.tsx'),
    'utf8',
  );
  assert.match(settingsSource, /delete palette\[name\]/);
});
