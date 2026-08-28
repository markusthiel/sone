/**
 * SONE web — where an entry may be moved.
 *
 * One implementation, used by the move dialog and by dragging. Two copies of a
 * rule this fiddly would drift, and the failure would be silent in the worst
 * way: the interface would offer a destination the server then refuses, or
 * refuse one the server would have accepted.
 *
 * These mirror the server's checks rather than replacing them. The server
 * decides — it has to, since anything reachable over HTTP is reachable without
 * this code — and this exists so the interface can say *why* a destination is
 * unavailable before somebody tries it.
 */

import type { PageNode } from '../api/client.ts';

/** Null means the workspace root. */
export type MoveTarget = string | null;

/**
 * Why a move is not possible, or null if it is.
 *
 * Phrased for a person to read: these strings appear in the move dialog and in
 * the tooltip while dragging.
 */
export function moveRefusal(
  tree: PageNode[],
  entry: PageNode,
  target: MoveTarget,
  options: {
    /**
     * True when the entry is being placed at a position rather than merely put
     * somewhere.
     *
     * The difference matters for exactly one rule. Moving an entry to the
     * folder it is already in does nothing and is refused — but *reordering*
     * within that folder is the common case, and it targets the same parent.
     *
     * Conflating the two meant every drop between two rows was refused as
     * "already here", silently: the entry snapped back and a reload showed it
     * unmoved. Dragging to reorder had never worked, on any device.
     */
    reordering?: boolean;
  } = {},
): string | null {
  if (target === entry.id) return 'A folder cannot contain itself';

  if (target === null) {
    // Only folders may sit at the workspace root (ADR-0019). A root full of
    // loose pages is the pile folders exist to replace.
    return entry.kind === 'folder' ? null : 'Only folders can sit at the root';
  }

  const targetNode = findNode(tree, target);
  if (!targetNode) return 'That folder no longer exists';
  if (targetNode.kind !== 'folder') return 'Only folders can hold entries';

  if (entry.parentPageId === target && !options.reordering) return 'Already here';

  // The rule that matters most: moving a folder into its own subtree would
  // detach the whole branch from the tree — it would still exist, be
  // unreachable from the root, and the ancestor paths every share link is
  // computed from would recurse forever.
  if (isInsideSubtree(tree, entry.id, target)) {
    return 'This is inside the folder being moved';
  }

  return null;
}

/** Convenience for the common question. */
export const canMoveInto = (
  tree: PageNode[],
  entry: PageNode,
  target: MoveTarget,
): boolean => moveRefusal(tree, entry, target) === null;

/**
 * May this entry be placed among the children of `target`?
 *
 * The same rules, minus "already here" — which is what a reorder is. Every
 * other rule still applies: a folder still cannot be placed inside its own
 * subtree by being dropped beside one of its descendants.
 */
export const canReorderInto = (
  tree: PageNode[],
  entry: PageNode,
  target: MoveTarget,
): boolean => moveRefusal(tree, entry, target, { reordering: true }) === null;

/** Find a node anywhere in the tree. */
export function findNode(nodes: PageNode[], id: string): PageNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

/** Is `candidate` the same as `ancestorId`, or somewhere beneath it? */
export function isInsideSubtree(
  tree: PageNode[],
  ancestorId: string,
  candidate: string,
): boolean {
  const ancestor = findNode(tree, ancestorId);
  if (!ancestor) return false;

  const walk = (nodes: PageNode[]): boolean =>
    nodes.some((node) => node.id === candidate || walk(node.children));

  return walk(ancestor.children);
}

/**
 * The entries directly inside a folder, in the order the tree shows them.
 *
 * Used to work out which sibling a drop between two rows lands after. The tree
 * is already sorted, so this is a lookup rather than a sort — reordering has to
 * agree with what is on screen, not with a second opinion about order.
 */
export function siblingsOf(tree: PageNode[], parentId: string | null): PageNode[] {
  if (parentId === null) return tree;
  return findNode(tree, parentId)?.children ?? [];
}

/**
 * Where an entry lands when it is asked to move one place up or down.
 *
 * Returns the sibling it should follow, `null` for first, or `undefined` when
 * it cannot move — already at that end.
 *
 * Expressed in terms of "after which sibling" because that is what the API
 * takes, and because it is the form that survives somebody else reordering the
 * list at the same moment: an index would be stale, a named neighbour is either
 * still there or the server refuses.
 */
export function stepTarget(
  tree: PageNode[],
  pageId: string,
  direction: 'up' | 'down',
): string | null | undefined {
  const node = findNode(tree, pageId);
  if (!node) return undefined;

  const siblings = siblingsOf(tree, node.parentPageId);
  const at = siblings.findIndex((sibling) => sibling.id === pageId);
  if (at === -1) return undefined;

  if (direction === 'up') {
    if (at === 0) return undefined;
    // One place up means "after whatever precedes the entry above me", which is
    // null when that entry is the first.
    return at === 1 ? null : (siblings[at - 2]?.id ?? null);
  }

  if (at >= siblings.length - 1) return undefined;
  return siblings[at + 1]!.id;
}

/** Can this entry move that way at all? */
export const canStep = (
  tree: PageNode[],
  pageId: string,
  direction: 'up' | 'down',
): boolean => stepTarget(tree, pageId, direction) !== undefined;
