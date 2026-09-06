/**
 * The decisions the brand work made, held in place.
 *
 * Each of these is a thing that was wrong once and is cheap to make wrong
 * again: a shadow typed out instead of named, a token used without being
 * declared, a grid template that writes the default where the variable belongs.
 * None of them fails loudly in a browser, which is why they are here.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { FONT_PAIRS, sanitiseTheme, themeProperties } from '@sone/core';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

/** The custom properties declared in one rule, by its selector. */
function tokensIn(selector: string): Set<string> {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
  );
  const body = pattern.exec(css)?.[1] ?? '';
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
}

test('depth is named, not typed out', () => {
  // Thirty-odd literals, two of which had drifted apart while describing the
  // same height. A shadow is a token now; a raw one in this file is a
  // regression rather than a special case.
  const raw = [...css.matchAll(/box-shadow:[^;]*rgb\(0 0 0[^;]*;/g)].map((m) => m[0]);
  assert.deepEqual(raw, [], 'box-shadows written as literals');
});

test('every token the stylesheet spends is a token the stylesheet declares', () => {
  // --sone-shadow-floating was used twice and declared nowhere, so a popover
  // and a tooltip rendered flat; --sone-warning was used three times with two
  // different fallbacks, which is the same bug wearing a disguise. A fallback
  // inside var() hides exactly this, so the check is on the declaration.
  const declared = new Set([
    ...tokensIn(":root,\n[data-theme='light']"),
    ...tokensIn(':root'),
  ]);
  for (const name of ['--sone-shadow-sm', '--sone-shadow-md', '--sone-shadow-lg',
    '--sone-shadow-floating', '--sone-warning', '--ink-500']) {
    assert.ok(declared.has(name), `${name} is declared`);
  }
  assert.doesNotMatch(css, /var\(--sone-(shadow|warning)[a-z-]*,/, 'no var() fallbacks left');
});

test('quiet text is a step each theme owns', () => {
  /*
   * This used to assert the two step names, which is a copy of the two lines it
   * was checking — and it passed happily while `--ink-400` was 4.27:1 on a
   * hovered row in the dark theme, because the name was still the name
   * (ADR-0135).
   *
   * Whether either value clears AA is computed now, over both themes and every
   * tint a workspace can set, in `contrast.test.ts`. What is left here is the
   * relationship that decision rests on: **muted is a different step in each
   * theme.** A shared one would be a value chosen against one background and
   * applied to the other, which is exactly how the failing values got in.
   */
  const light = /:root,\n\[data-theme='light'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const dark = /\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const step = (body: string): string =>
    /--text-muted: var\((--ink-[0-9]+)\)/.exec(body)?.[1] ?? '';

  assert.ok(step(light), 'the light theme names a step for muted text');
  assert.ok(step(dark), 'and so does the dark one');
  assert.notEqual(step(light), step(dark), 'and it is not the same step');
});

test('the faces are served from here', () => {
  // Self-hosting is what makes a brand face compatible with the decision in
  // typography.test.ts rather than an exception to it.
  assert.match(css, /@font-face/);
  assert.match(css, /url\('\/fonts\/archivo-latin-wght-normal\.woff2'\)/);
  assert.match(css, /url\('\/fonts\/jetbrains-mono-latin-wght-normal\.woff2'\)/);
  assert.doesNotMatch(css, /src:\s*url\('https?:/);
});

/** The families this instance actually serves, and the file each comes from. */
const served = new Map(
  [...css.matchAll(/font-family: '([^']+)';[\s\S]*?src: url\('(\/fonts\/[^']+)'\)/g)].map(
    (m) => [m[1] as string, m[2] as string],
  ),
);

/** The face a stack actually asks for; the rest are what the machine already has. */
const firstOf = (stack: string): string => {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.startsWith("'") ? first.slice(1, -1) : first;
};

test('every face a pair can name is one this instance serves', () => {
  /*
   * The failure this exists for (ADR-0127): a pair that names a font nobody
   * ships. It costs nothing at build time and nothing in a test that reads only
   * the core — the first sign of it is a workspace whose text quietly falls
   * back to Georgia, on somebody else's machine.
   *
   * The *first* entry of each stack and not every quoted one: `'Times New
   * Roman'` is quoted because it has spaces in it, not because anybody is
   * fetching it. Everything after the first is what the reader already has.
   */
  for (const pair of FONT_PAIRS) {
    const properties = themeProperties(sanitiseTheme({ fonts: pair }));
    for (const name of ['--sone-font', '--sone-font-mono'] as const) {
      const stack = properties[name];
      if (!stack) continue;
      const face = firstOf(stack);
      // A stack starting with something the machine has — `-apple-system`, or
      // `ui-monospace` — asks for no download at all, which is the whole point
      // of the `system` pair.
      if (!stack.trim().startsWith("'")) continue;

      const file = served.get(face);
      assert.ok(file, `${face} is declared for ${pair}`);
      assert.ok(
        existsSync(new URL(`../public${file}`, import.meta.url)),
        `${file} is in the repository`,
      );
    }
  }
});

test('the system pair asks for nothing to be downloaded', () => {
  // The point of offering it: a reader on a metered connection, or an operator
  // who would rather serve no webfont at all, gets an interface with none in
  // it. It has to lead with a face the machine already has.
  const properties = themeProperties(sanitiseTheme({ fonts: 'system' }));
  for (const name of ['--sone-font', '--sone-font-mono'] as const) {
    assert.equal(served.has(firstOf(properties[name] ?? '')), false, name);
  }
});

test('a dragged sidebar keeps its width when the right panel opens', () => {
  // The 1100px rule out-specifies the 800px one, so writing 260px here meant
  // the sidebar snapped back to the default the moment the panel opened — and
  // returned when it closed, which reads as the panel resizing the sidebar.
  const rule =
    /\.app\.with-sidebar\[data-right-panel='open'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /var\(--sidebar-width, 260px\)/);
  assert.match(rule, /var\(--rail-width\)/);
});

test('the rail is absent below the breakpoint rather than empty', () => {
  // Its destinations are in the drawer there. A fixed strip would spend 56px of
  // a phone repeating what is one tap away — and a zero-width column would
  // still draw its border, which is the sidebar's lesson applied again.
  assert.match(css, /\.icon-rail \{[^}]*display: none/);
  assert.match(css, /@media \(min-width: 800px\) \{\s*\.icon-rail \{ display: flex; \}/);
});

test('a surface with no tint set is opaque', () => {
  /*
   * `transparent` is rgb(0 0 0 / 0), so mixing 16% of it into the chrome did
   * not mix in nothing — it mixed in 16% of nothing at all and came out at 0.84
   * alpha. Every surface was slightly see-through. Invisible on a column
   * against the page, and unmistakable on the sidebar's drawer, where the page
   * showed through the navigation.
   *
   * A colour mixed with itself is itself, so the fallback is the base and the
   * tinted case is untouched.
   */
  assert.doesNotMatch(css, /--sone-theme-tint, transparent/);
  for (const mix of css.match(/color-mix\(in srgb, var\(--sone-theme-tint[^;]*/g) ?? []) {
    const parsed = /var\(--sone-theme-tint, (.+?)\) \d+%, (.+?)\)\s*;?$/.exec(mix.trim());
    assert.ok(parsed, `a tint mix names its fallback: ${mix}`);
    assert.equal(parsed?.[1], parsed?.[2], `the fallback is the base: ${mix}`);
  }
});

test('the tint reaches both ways into dark', () => {
  // It reached somebody who chose dark and vanished for somebody whose system
  // chose it for them — the same interface by two routes, one of them tinted.
  const automatic =
    /:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
  assert.ok(automatic.length > 0, 'the automatic dark theme was found');
  for (const name of ['--surface-chrome', '--surface-page', '--surface-hover']) {
    assert.match(
      automatic,
      new RegExp(`${name}: color-mix\\(in srgb, var\\(--sone-theme-tint`),
      `${name} mixes the tint in the automatic dark theme too`,
    );
  }
});
