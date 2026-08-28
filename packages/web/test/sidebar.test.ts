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
import { destinations } from '../src/components/MoveDialog.tsx';
import { canMoveInto, moveRefusal } from '../src/components/moveRules.ts';

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

// --- move destinations -----------------------------------------------------

test('the folder being moved and its subtree are offered but disabled', () => {
  // Marked rather than hidden. A folder missing from the list looks like a bug
  // or a permissions problem; one listed with a reason says what is going on.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('middle', 'outer', 'folder'),
    page('inner', 'middle', 'folder'),
    page('elsewhere', null, 'folder'),
  ]);
  const outer = tree.find((node) => node.id === 'outer')!;

  const options = destinations(tree, outer);
  const byId = new Map(options.map((option) => [option.id, option]));

  assert.ok(byId.get('outer')?.disabled, 'a folder cannot contain itself');
  assert.ok(byId.get('middle')?.disabled, 'nor can its own child');
  assert.ok(byId.get('inner')?.disabled, 'nor a grandchild');
  assert.equal(byId.get('elsewhere')?.disabled, undefined, 'an unrelated folder is fine');
});

test('the workspace root is offered to a folder and refused to a page', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
  ]);
  const folder = tree.find((node) => node.id === 'folder')!;
  const doc = folder.children[0]!;

  assert.equal(destinations(tree, folder)[0]!.disabled, undefined);
  assert.ok(
    destinations(tree, doc)[0]!.disabled,
    'a root full of loose pages is the pile folders exist to replace',
  );
});

test('the current parent is marked rather than offered', () => {
  // Moving something to where it already is does nothing, and an option that
  // does nothing is worse than one that is not there.
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
  ]);
  const doc = tree[0]!.children[0]!;
  const option = destinations(tree, doc).find((entry) => entry.id === 'folder');
  assert.equal(option?.disabled, 'Already here');
});

test('only folders are destinations', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
    page('other', null, 'folder'),
  ]);
  const other = tree.find((node) => node.id === 'other')!;
  const ids = destinations(tree, other).map((entry) => entry.id);
  assert.ok(!ids.includes('doc'), 'a page cannot hold anything');
});

// --- move rules, shared by the dialog and by dragging ----------------------

test('a folder cannot be dropped into itself or its own subtree', () => {
  // The rule that matters most: it would detach the whole branch from the
  // tree — still existing, unreachable from the root, with the ancestor paths
  // every share link is computed from recursing forever.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('middle', 'outer', 'folder'),
    page('inner', 'middle', 'folder'),
    page('elsewhere', null, 'folder'),
  ]);
  const outer = tree.find((node) => node.id === 'outer')!;

  assert.equal(canMoveInto(tree, outer, 'outer'), false);
  assert.equal(canMoveInto(tree, outer, 'middle'), false);
  assert.equal(canMoveInto(tree, outer, 'inner'), false, 'a grandchild too');
  assert.equal(canMoveInto(tree, outer, 'elsewhere'), true);
});

test('only folders can receive an entry', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
    page('other', null, 'folder'),
  ]);
  const other = tree.find((node) => node.id === 'other')!;
  assert.equal(canMoveInto(tree, other, 'doc'), false);
  assert.match(moveRefusal(tree, other, 'doc') ?? '', /folders/i);
});

test('only folders can sit at the workspace root', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
  ]);
  const folder = tree[0]!;
  const doc = folder.children[0]!;

  assert.equal(canMoveInto(tree, folder, null), true);
  assert.equal(canMoveInto(tree, doc, null), false);
});

test('dropping somewhere it already is refuses rather than doing nothing', () => {
  // A move that changes nothing would still write to the document and produce
  // an update for everyone, so it is refused rather than performed.
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
  ]);
  const doc = tree[0]!.children[0]!;
  assert.equal(moveRefusal(tree, doc, 'folder'), 'Already here');
});

test('a vanished destination is refused rather than throwing', () => {
  // The tree in hand can be a moment out of date — somebody else may have
  // deleted the folder being dropped on.
  const tree = buildPageTree([page('folder', null, 'folder')]);
  const folder = tree[0]!;
  assert.match(moveRefusal(tree, folder, 'gone') ?? '', /no longer exists/);
});

test('the dialog and dragging cannot disagree', () => {
  // They share one implementation; this asserts the dialog really consults it,
  // because two copies of these rules would drift and the failure would be
  // silent — offering a destination the server refuses, or refusing one it
  // would have accepted.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('inner', 'outer', 'folder'),
    page('free', null, 'folder'),
  ]);
  const outer = tree.find((node) => node.id === 'outer')!;

  for (const option of destinations(tree, outer)) {
    assert.equal(
      option.disabled === undefined,
      canMoveInto(tree, outer, option.id),
      `the dialog and canMoveInto disagree about ${String(option.id)}`,
    );
  }
});
