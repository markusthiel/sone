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

  if (entry.parentPageId === target) return 'Already here';

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
