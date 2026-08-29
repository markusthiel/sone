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

const here = path.dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(path.resolve(here, '../src/hooks/useWorkspaceTheme.ts'), 'utf8');
const css = readFileSync(path.resolve(here, '../src/styles.css'), 'utf8');

test('properties are removed as well as set', () => {
  // A theme that stops specifying a heading colour has to leave no trace, or
  // the last colour anybody chose would survive its own deletion — the same
  // class of mistake as storing an explicit default.
  assert.match(hook, /removeProperty/);
  assert.match(hook, /startsWith\('--sone-theme-'\)/);
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

test('the palette is defined once', () => {
  // The same eight names are used by tags, select options, block colours and
  // themes. Written out separately in each, "blue" could drift into four
  // slightly different blues without anybody noticing.
  for (const color of ['grey', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']) {
    assert.ok(css.includes(`--sone-palette-${color}:`), color);
  }
});
