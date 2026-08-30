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

test('a refusal is only believed once the connection has settled', () => {
  // Switching workspaces reconnects, and a page opened against the old
  // connection is refused — correctly, and for a page in the workspace somebody
  // has just arrived in. The refusal was true of a moment that had already
  // passed, and it was shown to somebody who had only pressed a switcher.
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /handle\.status === 'denied' && connectionState === 'ready'/);
});

test('a page really out of reach still says so', () => {
  // The connection becomes ready and the denial stands. Suppressing it
  // altogether would trade one wrong message for a missing one.
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /You no longer have access to this page/);
});
