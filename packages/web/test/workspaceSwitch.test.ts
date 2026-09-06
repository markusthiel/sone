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
  //
  // Named rather than matched whole: the list grew when the landing page
  // arrived, and a test that spells out every dependency fails on every
  // addition without any of them being wrong.
  const deps = /\}, \[route\.kind, ([^\]]+)\]\);/.exec(app)?.[1] ?? '';
  assert.match(deps, /pagesLoading/);
  assert.match(deps, /workspaceId/, 'and the workspace, since landing is per workspace');
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
  assert.match(view, /t\('page\.noAccess'\)/);
});

test('a mode about one workspace offers a way to change it', () => {
  /*
   * Reported as the shares screen being inconsistent: a link created a moment
   * ago was simply absent, because all three lists are scoped to one workspace
   * and the screen named neither it nor a way to switch (ADR-0114).
   *
   * A wiring assertion, and said plainly: what it can see is that the two
   * per-workspace modes are given the chooser the Workspaces mode already had.
   * What it cannot see is the rendered head — `Sidebar` draws `panelChooser`
   * wherever it is given one, and that half has been true since ADR-0070.
   */
  assert.match(app, /mode === 'shares' \|\| mode === 'trash' \? \(/);

  // The inbox deliberately gets none: it spans workspaces (ADR-0052) and
  // filters by them in its own panel, so a chooser would be a second answer to
  // a question that screen already answers better.
  const chooser = /panelChooser=\{([\s\S]*?)\n {8}\}/.exec(app)?.[1] ?? '';
  assert.ok(chooser.length > 0, 'the chooser branch is where it was');
  assert.doesNotMatch(chooser, /'inbox'/);
});

test('the trash says its retention once, not its workspace twice', () => {
  // The scope line used to carry "{workspace} · 30 days". With the workspace
  // named by the chooser directly above it, that is the same fact in two
  // consecutive lines, which reads as two different ones.
  assert.match(app, /t\('trash\.scope'\)/);
});
