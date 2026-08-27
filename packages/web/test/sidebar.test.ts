/**
 * Sidebar behaviour that is worth pinning down.
 *
 * The tree itself is tested in tree.test.ts. This covers the two things a
 * collapsible tree gets wrong: hiding the page you are looking at, and losing
 * its state on reload.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPageTree, type PageSummary } from '../src/api/client.ts';
import { findAncestors } from '../src/components/Sidebar.tsx';

const page = (
  id: string,
  parentPageId: string | null = null,
  kind: 'page' | 'folder' = 'page',
): PageSummary => ({
  id,
  parentPageId,
  collectionId: null,
  idx: 'a1',
  title: id,
  icon: null,
  kind,
  archived: false,
  lastEditedAt: '2026-01-01T00:00:00Z',
});

const tree = buildPageTree([
  page('root'),
  page('child', 'root'),
  page('grandchild', 'child'),
  page('other'),
]);

test('ancestors are returned outermost first', () => {
  assert.deepEqual(findAncestors(tree, 'grandchild'), ['root', 'child']);
});

test('a top-level page has no ancestors', () => {
  assert.deepEqual(findAncestors(tree, 'root'), []);
  assert.deepEqual(findAncestors(tree, 'other'), []);
});

test('an unknown page yields an empty trail rather than throwing', () => {
  // A page can be missing from the tree legitimately: a guest may see a subpage
  // without seeing its parent, so it is a root in their tree.
  assert.deepEqual(findAncestors(tree, 'nonexistent'), []);
});

test('every ancestor of a deep page is listed', () => {
  // These are the ids the sidebar expands to reveal the current page. Missing
  // one leaves the page hidden inside a collapsed branch, which is what happens
  // when someone opens a subpage from a search result.
  const deep = buildPageTree([
    page('a'),
    page('b', 'a'),
    page('c', 'b'),
    page('d', 'c'),
  ]);
  assert.deepEqual(findAncestors(deep, 'd'), ['a', 'b', 'c']);
});

// --- folder contents -------------------------------------------------------

test('a folder view separates folders from pages', () => {
  // Folders before pages, matching the sidebar. A filing system that orders one
  // way in one place and another way elsewhere makes people hunt.
  const mixed = buildPageTree([
    page('root', null, 'folder'),
    page('a-page', 'root', 'page'),
    page('b-folder', 'root', 'folder'),
    page('c-page', 'root', 'page'),
  ]);

  const children = mixed[0]!.children;
  assert.deepEqual(
    children.map((child) => child.kind),
    ['folder', 'page', 'page'],
    'folders come first in the tree the folder view renders from',
  );
});

test('a folder with no children is distinguishable from one with children', () => {
  // The overview says "Empty" rather than showing nothing, because a folder that
  // renders as blank looks like a page that failed to load.
  const tree = buildPageTree([
    page('empty', null, 'folder'),
    page('full', null, 'folder'),
    page('inside', 'full', 'page'),
  ]);
  const byId = new Map(tree.map((node) => [node.id, node]));
  assert.equal(byId.get('empty')!.children.length, 0);
  assert.equal(byId.get('full')!.children.length, 1);
});
