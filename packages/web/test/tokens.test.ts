/**
 * The token layer (ADR-0028).
 *
 * The test that matters here compares the two themes. A token added to one and
 * forgotten in the other shows nothing wrong until somebody switches, and then
 * shows an inherited value that is almost right — which is the hardest kind of
 * mistake to see, because everything looks correct until it does not.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

/** The custom properties declared in one rule, by its selector. */
function tokensIn(selector: string): Set<string> {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`,
  );
  const body = pattern.exec(css)?.[1] ?? '';
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
}

test('both themes fill exactly the same set of tokens', () => {
  const light = tokensIn(":root,\n\\[data-theme='light'\\]");
  const dark = tokensIn("\\[data-theme='dark'\\]");

  assert.ok(light.size > 10, 'the light theme was found');

  const missingInDark = [...light].filter((name) => !dark.has(name));
  const missingInLight = [...dark].filter((name) => !light.has(name));

  assert.deepEqual(missingInDark, [], 'declared in light and not in dark');
  assert.deepEqual(missingInLight, [], 'declared in dark and not in light');
});

test('the media query fills the same set as the chosen dark theme', () => {
  // Somebody following their system and somebody choosing dark must get the
  // same interface, or one of the two is a theme nobody maintains.
  const chosen = tokensIn("\\[data-theme='dark'\\]");
  const automatic = tokensIn(":root:not\\(\\[data-theme='light'\\]\\)");

  const missing = [...chosen].filter((name) => !automatic.has(name));
  assert.deepEqual(missing, [], 'in the chosen dark theme and not in the automatic one');
});

test('the outward names are aliases, not values', () => {
  // Several thousand lines use --sone-*. They keep working because they point
  // at tokens now — this change moved the decisions without moving the code
  // that depends on them.
  assert.match(css, /--sone-bg: var\(--surface\)/);
  assert.match(css, /--sone-text: var\(--text-primary\)/);
});

test('no theme is written twice', () => {
  // It was: once under prefers-color-scheme and once under data-theme, six
  // values each. Every variable added afterwards had to be added in three
  // places, and the one that was forgotten was wrong in exactly one theme.
  assert.doesNotMatch(css, /html\[data-theme='dark'\]\s*\{\s*--sone-bg:/);
});
