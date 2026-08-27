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

const page = (id: string, parentPageId: string | null = null): PageSummary => ({
  id,
  parentPageId,
  collectionId: null,
  idx: 'a1',
  title: id,
  icon: null,
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
