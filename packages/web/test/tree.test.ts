/**
 * Page tree assembly tests.
 *
 * The server sends a flat list with parent ids; building the tree is the
 * client's job, and the ordering rules come from ADR-0015.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPageTree, type PageSummary } from '../src/api/client.ts';

const page = (
  id: string,
  idx: string,
  parentPageId: string | null = null,
  title = id,
): PageSummary => ({
  id,
  parentPageId,
  collectionId: null,
  idx,
  title,
  icon: null,
  archived: false,
  lastEditedAt: '2026-01-01T00:00:00Z',
});

test('nests children under their parents', () => {
  const tree = buildPageTree([
    page('root', 'a1'),
    page('child', 'a1', 'root'),
    page('grandchild', 'a1', 'child'),
  ]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.id, 'root');
  assert.equal(tree[0]!.children[0]!.id, 'child');
  assert.equal(tree[0]!.children[0]!.children[0]!.id, 'grandchild');
});

test('assigns depth for indentation', () => {
  const tree = buildPageTree([
    page('root', 'a1'),
    page('child', 'a1', 'root'),
  ]);
  assert.equal(tree[0]!.depth, 0);
  assert.equal(tree[0]!.children[0]!.depth, 1);
});

test('orders siblings by index, breaking ties on id', () => {
  // Fractional indices are deterministic, so two offline clients can produce
  // the same key; without the id tie-breaker the order is unstable (ADR-0015).
  const tree = buildPageTree([
    page('b', 'a1'),
    page('a', 'a1'),
    page('c', 'a2'),
  ]);
  assert.deepEqual(
    tree.map((n) => n.id),
    ['a', 'b', 'c'],
  );
});

test('a page whose parent is not in the list becomes a root, not a dropped page', () => {
  // This happens legitimately: a guest may see a subpage without seeing its
  // parent. Dropping it would make an accessible page unreachable in the
  // sidebar.
  const tree = buildPageTree([page('orphan', 'a1', 'missing-parent')]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.id, 'orphan');
});

test('an empty list yields an empty tree', () => {
  assert.deepEqual(buildPageTree([]), []);
});

test('every page appears exactly once', () => {
  const pages = [
    page('a', 'a1'),
    page('b', 'a2'),
    page('c', 'a1', 'a'),
    page('d', 'a1', 'c'),
    page('e', 'a1', 'missing'),
  ];
  const tree = buildPageTree(pages);

  const seen: string[] = [];
  const walk = (nodes: typeof tree): void => {
    for (const node of nodes) {
      seen.push(node.id);
      walk(node.children);
    }
  };
  walk(tree);

  assert.equal(seen.length, pages.length);
  assert.equal(new Set(seen).size, pages.length, 'no page may be duplicated');
});
