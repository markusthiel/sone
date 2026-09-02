/**
 * Two questions about the stylesheet that I kept answering wrongly by eye.
 *
 * A class in the markup with no rule behind it is the quieter mirror of dead
 * CSS: the markup says a structure exists, nothing draws it, and the panel looks
 * plausible with whatever spacing it inherited. Nine of those were in the tree
 * when this was written, four of them mine from this week.
 *
 * And a selector declared twice in the same scope is the fault that produced a
 * pale hover on filled buttons twice, three rules for one gutter, and an
 * `ellipsis` applied to the workspace switcher instead of the menu. The list
 * below is a ratchet: what is already there is allowed and named, and a new one
 * fails.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** Selectors that were already declared more than once when this test was written. */
const KNOWN_DUPLICATES = new Set([
  '.ProseMirror',
  ".ProseMirror > [data-block]:only-child:empty::after",
  ".ProseMirror [data-block='code']",
  ".ProseMirror [data-block='image'] img",
  '.ProseMirror [data-block]',
  '.ProseMirror h1[data-block]',
  '.ProseMirror h2[data-block]',
  '.ProseMirror h3[data-block]',
  '.ProseMirror p[data-block]',
  '.ProseMirror table th',
  '.asset-meta',
  ".block-handle[aria-expanded='true']",
  '.collection-add',
  '.collection-table',
  '.contributor',
  '.dialog',
  '.dialog-item',
  '.entry-menu-label',
  ".entry-more[aria-expanded='true']",
  '.pdf-fallback',
  '.right-body',
  '.settings-nav-item',
  '.sidebar-account-menu button',
  '.sidebar-version',
  ".switcher-item[data-drop='after']::after",
  '.tag-chip',
  '.tag-chip svg',
  '.tree-children',
  '.tree-link',
  ".tree-link[aria-current='page']",
  '.tree-row',
  ".tree-row[data-drop='after']::after",
  '.version-body li',
  '.video-line',
  '.view-rule input',
  '.workspace-table td',
  'body',
]);

test('every class in the markup has a rule behind it', () => {
  const directory = new URL('../src/components/', import.meta.url);
  const missing: string[] = [];

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.tsx')) continue;
    const source = readFileSync(new URL(file, directory), 'utf8');
    for (const match of source.matchAll(/className="([a-z][a-z0-9 -]*)"/g)) {
      for (const name of (match[1] ?? '').split(/\s+/)) {
        if (name === '') continue;
        if (!new RegExp(`\\.${name}\\b`).test(css)) missing.push(`${name} (${file})`);
      }
    }
  }

  assert.deepEqual([...new Set(missing)], [], 'classes used in markup with no rule');
});

test('no selector is declared twice in the same scope, beyond the known list', () => {
  // Top-level rules only: a selector repeated inside a media query is a
  // deliberate override for that width, which is what media queries are for.
  const counts = new Map<string, number>();
  for (const match of css.matchAll(/^([.#a-z][^{\n]*)\{/gm)) {
    const selector = (match[1] ?? '').trim();
    counts.set(selector, (counts.get(selector) ?? 0) + 1);
  }

  const fresh = [...counts]
    .filter(([selector, count]) => count > 1 && !KNOWN_DUPLICATES.has(selector))
    .map(([selector]) => selector);

  assert.deepEqual(fresh, [], 'new duplicate selectors — merge them instead');
});
