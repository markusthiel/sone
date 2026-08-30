/**
 * Switching workspaces.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const app = codeOf(new URL('../src/App.tsx', import.meta.url));
const hook = codeOf(new URL('../src/hooks/usePages.ts', import.meta.url));

test('the tree is cleared before the next one is fetched', () => {
  // It stayed in place until the new one arrived, so anything reading it in
  // that moment was reading the workspace just left.
  assert.match(hook, /setPages\(\[\]\);\s*\n\s*setLoading\(true\);/);
});

test('the root does not redirect while the tree is loading', () => {
  // Redirecting from a list that is still loading means redirecting to whatever
  // was there before — after a switch, a page in the old workspace, which the
  // server then refuses to somebody who only pressed a switcher.
  assert.match(app, /if \(pagesLoading\) return;/);
});

test('the redirect depends on the loading state, not only the list', () => {
  // Without it in the dependencies the guard would be read once and never
  // rechecked, which is the same bug with more code.
  assert.match(app, /\[route\.kind, pages, pagesLoading, navigate\]/);
});
