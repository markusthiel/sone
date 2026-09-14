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
import { en, type MessageKey } from '../src/i18n/messages.en.ts';

/**
 * The destinations are built with the interface's words now (ADR-0148), so a
 * caller passes the catalogue in. English, because what these tests read is
 * which folders are offered and why — not what they are called.
 */
const say = (key: MessageKey): string => en[key];
import {
  canMoveInto,
  canReorderInto,
  canStep,
  findNode,
  moveRefusal,
  siblingsOf,
  stepTarget,
} from '../src/components/moveRules.ts';

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

test('the tree keeps mixed entries in index order, with ids breaking ties', () => {
  const mixed = buildPageTree([
    page('root', null, 'folder'),
    page('a-page', 'root', 'page'),
    page('b-folder', 'root', 'folder'),
    page('c-page', 'root', 'page'),
  ]);

  const children = mixed[0]!.children;
  assert.deepEqual(
    children.map((child) => child.kind),
    ['page', 'folder', 'page'],
    'entry kinds do not override the saved order',
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

  const options = destinations(tree, outer, say);
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

  assert.equal(destinations(tree, folder, say)[0]!.disabled, undefined);
  assert.ok(
    destinations(tree, doc, say)[0]!.disabled,
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
  const option = destinations(tree, doc, say).find((entry) => entry.id === 'folder');
  assert.equal(option?.disabled, 'Already here');
});

test('only folders are destinations', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('doc', 'folder', 'page'),
    page('other', null, 'folder'),
  ]);
  const other = tree.find((node) => node.id === 'other')!;
  const ids = destinations(tree, other, say).map((entry) => entry.id);
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

  for (const option of destinations(tree, outer, say)) {
    assert.equal(
      option.disabled === undefined,
      canMoveInto(tree, outer, option.id),
      `the dialog and canMoveInto disagree about ${String(option.id)}`,
    );
  }
});

// --- siblings, for reordering ----------------------------------------------

test('siblingsOf returns the tree order, not a second opinion', () => {
  // A drop between two rows has to land where the eye says it will, so the
  // order used to pick the preceding sibling must be the order on screen.
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('a', 'folder', 'page'),
    page('b', 'folder', 'page'),
    page('c', 'folder', 'page'),
  ]);

  const inFolder = siblingsOf(tree, 'folder').map((node) => node.id);
  const onScreen = tree[0]!.children.map((node) => node.id);
  assert.deepEqual(inFolder, onScreen);
});

test('siblingsOf at the root returns the top level', () => {
  const tree = buildPageTree([
    page('one', null, 'folder'),
    page('two', null, 'folder'),
  ]);
  assert.deepEqual(siblingsOf(tree, null).map((node) => node.id), ['one', 'two']);
});

test('siblingsOf a folder that is gone is empty rather than throwing', () => {
  // The tree in hand can be a moment out of date.
  const tree = buildPageTree([page('folder', null, 'folder')]);
  assert.deepEqual(siblingsOf(tree, 'vanished'), []);
});

test('reordering beside a row checks the parent, not the row', () => {
  // Dropping next to a page inside a folder is a move into that folder. The
  // rule that must hold: a folder still cannot end up inside its own subtree
  // by being dropped beside one of its descendants.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('inner', 'outer', 'folder'),
    page('leaf', 'inner', 'page'),
  ]);
  const outer = tree.find((node) => node.id === 'outer')!;
  const leaf = siblingsOf(tree, 'inner')[0]!;

  // "beside leaf" means "into inner", which is inside outer.
  assert.equal(canMoveInto(tree, outer, leaf.parentPageId), false);
});

// --- reordering without a mouse --------------------------------------------

test('moving up and down walks the list one place at a time', () => {
  // Dragging is a pointer-device feature; iOS never fires those events. These
  // are the only way to reorder on a tablet, and they work with a keyboard
  // too — so they are not a fallback, they are the general case.
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('a', 'folder', 'page'),
    page('b', 'folder', 'page'),
    page('c', 'folder', 'page'),
  ]);

  // b up: lands first, so it follows nothing.
  assert.equal(stepTarget(tree, 'b', 'up'), null);
  // c up: lands after a, which is what precedes b.
  assert.equal(stepTarget(tree, 'c', 'up'), 'a');
  // a down: lands after b.
  assert.equal(stepTarget(tree, 'a', 'down'), 'b');
});

test('the ends of a list cannot be stepped past', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('a', 'folder', 'page'),
    page('b', 'folder', 'page'),
  ]);

  assert.equal(stepTarget(tree, 'a', 'up'), undefined);
  assert.equal(stepTarget(tree, 'b', 'down'), undefined);
  assert.equal(canStep(tree, 'a', 'up'), false);
  assert.equal(canStep(tree, 'b', 'down'), false);
  assert.equal(canStep(tree, 'a', 'down'), true);
});

test('a lone entry cannot move either way', () => {
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('only', 'folder', 'page'),
  ]);
  assert.equal(canStep(tree, 'only', 'up'), false);
  assert.equal(canStep(tree, 'only', 'down'), false);
});

test('top-level entries reorder among themselves', () => {
  // Read the order from the tree rather than assuming it. The helper gives
  // every entry the same idx, so buildPageTree breaks the tie on id — a first
  // version of this test assumed insertion order and failed for a reason that
  // had nothing to do with stepping.
  const tree = buildPageTree([
    page('one', null, 'folder'),
    page('two', null, 'folder'),
    page('three', null, 'folder'),
  ]);
  const ids = tree.map((node) => node.id);

  assert.equal(stepTarget(tree, ids[2]!, 'up'), ids[0]!);
  assert.equal(stepTarget(tree, ids[1]!, 'up'), null);
  assert.equal(stepTarget(tree, ids[0]!, 'down'), ids[1]!);
});

test('an entry that is not in the tree cannot move', () => {
  // The tree in hand can be a moment out of date.
  const tree = buildPageTree([page('folder', null, 'folder')]);
  assert.equal(stepTarget(tree, 'vanished', 'up'), undefined);
});

test('a step names a neighbour rather than a position', () => {
  // An index would be stale if somebody else reordered the list at the same
  // moment; a named neighbour is either still there or the server refuses.
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('a', 'folder', 'page'),
    page('b', 'folder', 'page'),
    page('c', 'folder', 'page'),
  ]);
  const target = stepTarget(tree, 'c', 'up');
  assert.equal(typeof target, 'string');
  assert.ok(findNode(tree, target as string), 'the target is a real entry');
});

// --- what a drop means, by where it lands ----------------------------------

test('a drop in the middle of a folder goes inside it', () => {
  // The middle band is what makes "into" reachable at all. Without it every
  // drop near a folder would reorder instead, and nesting by drag would be
  // impossible.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('doc', null, 'page'),
  ]);
  const doc = tree.find((node) => node.id === 'doc')!;
  assert.equal(canMoveInto(tree, doc, 'outer'), true);
});

test('a drop beside a row is judged against that row parent', () => {
  // Dropping next to a page inside a folder is a move into that folder, so the
  // subtree rule has to be checked against the parent — otherwise a folder
  // could be dropped beside its own descendant and detach the branch.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('inner', 'outer', 'folder'),
    page('leaf', 'inner', 'page'),
  ]);
  const outer = tree.find((node) => node.id === 'outer')!;
  const leaf = siblingsOf(tree, 'inner')[0]!;

  assert.equal(canMoveInto(tree, outer, leaf.parentPageId), false);
});

// --- reordering is not the same question as moving -------------------------

test('an entry can be reordered within the folder it is already in', () => {
  // The bug this pins down: reordering targets the parent the entry is already
  // in, and the move rules refuse that as "already here". Every drop between
  // two rows was therefore rejected in silence — the entry snapped back and a
  // reload showed it unmoved. Dragging to reorder had never worked.
  const tree = buildPageTree([
    page('folder', null, 'folder'),
    page('a', 'folder', 'page'),
    page('b', 'folder', 'page'),
  ]);
  const a = siblingsOf(tree, 'folder').find((node) => node.id === 'a')!;

  assert.equal(canMoveInto(tree, a, 'folder'), false, 'moving there is a no-op');
  assert.equal(canReorderInto(tree, a, 'folder'), true, 'reordering there is not');
});

test('reordering still refuses everything else a move refuses', () => {
  // Only the "already here" rule is relaxed. A folder must still not end up
  // inside its own subtree by being dropped beside one of its descendants.
  const tree = buildPageTree([
    page('outer', null, 'folder'),
    page('inner', 'outer', 'folder'),
    page('leaf', 'inner', 'page'),
    page('doc', null, 'page'),
  ]);
  const outer = tree.find((node) => node.id === 'outer')!;
  const doc = tree.find((node) => node.id === 'doc')!;

  assert.equal(canReorderInto(tree, outer, 'inner'), false, 'not into its own subtree');
  assert.equal(canReorderInto(tree, doc, null), false, 'a page still cannot sit at the root');
  assert.equal(canReorderInto(tree, outer, 'leaf'), false, 'a page still holds nothing');
});

test('reordering at the workspace root is allowed for a folder', () => {
  // Top-level folders are reordered against a null parent, which is the same
  // "already here" shape one level up.
  const tree = buildPageTree([
    page('one', null, 'folder'),
    page('two', null, 'folder'),
  ]);
  const one = tree.find((node) => node.id === 'one')!;
  assert.equal(canReorderInto(tree, one, null), true);
});
