/**
 * SONE — block operations that respect subtrees.
 *
 * Every operation here exists because the naive version of it silently damages
 * structure. Text blocks are flat siblings whose parent-child relationship is
 * an `indent` attribute (ADR-0018), so a block's children are not *inside* it —
 * they are the following blocks with a greater indent. Anything that moves,
 * copies, deletes or re-indents a block must take that run with it.
 *
 * The failure mode is quiet, which is what makes it worth this much care.
 * Indenting a parent without its children does not throw or look broken: the
 * children simply become siblings of the block that used to own them, and the
 * document reads subtly wrong from then on. That bug shipped, and this module
 * is the fix.
 *
 * Everything is expressed as a range over sibling positions rather than as
 * ProseMirror slices, because a subtree is a *run of siblings* here, not a
 * nested node. Slice-based helpers do not apply.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

import { readIndent, schema, writeIndent } from './schema.js';

/** A run of top-level children: a block and everything indented beneath it. */
export interface BlockRange {
  /** Index of the block itself among its parent's children. */
  index: number;
  /** Index one past the last descendant. */
  endIndex: number;
  /** Document position where the run starts. */
  from: number;
  /** Document position where the run ends. */
  to: number;
  indent: number;
  node: PMNode;
}

const isBlock = (node: PMNode): boolean =>
  node.type.spec.attrs !== undefined && BLOCK_ATTRS.id in node.type.spec.attrs;

/**
 * The block containing the selection, as an index into its parent.
 *
 * Returns the outermost *flat* block: the one whose siblings are the ones
 * indentation relates it to. Inside a structural container (a column) that is
 * the block within the column, not the column itself.
 */
export function selectedBlockIndex(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (isBlock($from.node(depth))) return $from.index(depth - 1);
  }
  return null;
}

/** The parent holding the flat run the selection is in, and its start offset. */
function selectionParent(state: EditorState): { parent: PMNode; start: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (isBlock($from.node(depth))) {
      return { parent: $from.node(depth - 1), start: $from.start(depth - 1) };
    }
  }
  return null;
}

/**
 * The range covering a block and its indented descendants.
 *
 * Descendants are the following siblings with a strictly greater indent, up to
 * the first one at the same or lower level. That definition is the whole
 * contract of ADR-0018 in one function, and everything else here builds on it.
 */
export function blockRangeAt(
  parent: PMNode,
  parentStart: number,
  index: number,
): BlockRange | null {
  if (index < 0 || index >= parent.childCount) return null;

  const node = parent.child(index);
  if (!isBlock(node)) return null;

  const indent = readIndent(node.attrs);

  let endIndex = index + 1;
  while (endIndex < parent.childCount) {
    const candidate = parent.child(endIndex);
    if (!isBlock(candidate)) break;
    if (readIndent(candidate.attrs) <= indent) break;
    endIndex += 1;
  }

  let from = parentStart;
  for (let i = 0; i < index; i++) from += parent.child(i).nodeSize;

  let to = from;
  for (let i = index; i < endIndex; i++) to += parent.child(i).nodeSize;

  return { index, endIndex, from, to, indent, node };
}

/** The range for the block the selection is in. */
export function selectedBlockRange(state: EditorState): BlockRange | null {
  const context = selectionParent(state);
  const index = selectedBlockIndex(state);
  if (!context || index === null) return null;
  return blockRangeAt(context.parent, context.start, index);
}

/** Nodes in a range, with every indent shifted by `delta`. */
function shiftIndents(
  parent: PMNode,
  range: BlockRange,
  delta: number,
): PMNode[] {
  const result: PMNode[] = [];
  for (let i = range.index; i < range.endIndex; i++) {
    const node = parent.child(i);
    const next = Math.max(0, readIndent(node.attrs) + delta);
    result.push(
      node.type.create(
        { ...node.attrs, [BLOCK_ATTRS.indent]: writeIndent(next) },
        node.content,
        node.marks,
      ),
    );
  }
  return result;
}

/**
 * Indent a block and everything beneath it.
 *
 * The whole run shifts by one, which preserves the relative structure. Shifting
 * only the block itself makes its children into its siblings — the bug this
 * module exists to fix.
 *
 * Refused when there is no preceding sibling to become the parent, and when it
 * would put the block more than one level below its predecessor. The tree
 * reader normalises that case, so allowing it would show something the server
 * stores differently.
 */
export const indentBlockSubtree: Command = (state, dispatch) => {
  const context = selectionParent(state);
  const range = selectedBlockRange(state);
  if (!context || !range) return false;
  if (range.index === 0) return false;

  const previousIndent = readIndent(context.parent.child(range.index - 1).attrs);
  if (range.indent > previousIndent) return false;

  if (dispatch) {
    const shifted = shiftIndents(context.parent, range, 1);
    dispatch(
      state.tr
        .replaceWith(range.from, range.to, Fragment.fromArray(shifted))
        .scrollIntoView(),
    );
  }
  return true;
};

/** Outdent a block and everything beneath it. Refused at the top level. */
export const outdentBlockSubtree: Command = (state, dispatch) => {
  const context = selectionParent(state);
  const range = selectedBlockRange(state);
  if (!context || !range) return false;
  if (range.indent === 0) return false;

  if (dispatch) {
    const shifted = shiftIndents(context.parent, range, -1);
    dispatch(
      state.tr
        .replaceWith(range.from, range.to, Fragment.fromArray(shifted))
        .scrollIntoView(),
    );
  }
  return true;
};

/**
 * Move a block and its subtree past the previous sibling at the same level.
 *
 * "Sibling at the same level" matters: moving up past a *child* of the block
 * above would put this block inside it, which is a reparenting rather than a
 * reorder and is not what the person asked for.
 */
export const moveBlockUp: Command = (state, dispatch) => {
  const context = selectionParent(state);
  const range = selectedBlockRange(state);
  if (!context || !range || range.index === 0) return false;

  // Walk back to the start of the preceding run at this indent or shallower.
  let previousIndex = range.index - 1;
  while (previousIndex > 0) {
    const indent = readIndent(context.parent.child(previousIndex).attrs);
    if (indent <= range.indent) break;
    previousIndex -= 1;
  }

  const previous = blockRangeAt(context.parent, context.start, previousIndex);
  if (!previous) return false;
  // Only reorder among equals. A shallower predecessor means this block is the
  // first child of it, and there is nothing to swap with.
  if (previous.indent !== range.indent) return false;

  if (dispatch) {
    const moving: PMNode[] = [];
    for (let i = range.index; i < range.endIndex; i++) moving.push(context.parent.child(i));
    const displaced: PMNode[] = [];
    for (let i = previous.index; i < previous.endIndex; i++) {
      displaced.push(context.parent.child(i));
    }

    // Offset of the caret inside the moving block, so it can be restored after
    // the run lands somewhere else. Without this the caret jumps to whatever
    // now occupies the old position, which reads as the wrong block moving.
    const caretOffset = state.selection.from - range.from;

    const tr = state.tr.replaceWith(
      previous.from,
      range.to,
      Fragment.fromArray([...moving, ...displaced]),
    );

    const target = previous.from + caretOffset;
    if (target > 0 && target <= tr.doc.content.size) {
      const $pos = tr.doc.resolve(Math.min(target, tr.doc.content.size - 1));
      tr.setSelection(TextSelection.near($pos));
    }

    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Move a block and its subtree past the next sibling at the same level. */
export const moveBlockDown: Command = (state, dispatch) => {
  const context = selectionParent(state);
  const range = selectedBlockRange(state);
  if (!context || !range) return false;
  if (range.endIndex >= context.parent.childCount) return false;

  const next = blockRangeAt(context.parent, context.start, range.endIndex);
  if (!next) return false;
  if (next.indent !== range.indent) return false;

  if (dispatch) {
    const moving: PMNode[] = [];
    for (let i = range.index; i < range.endIndex; i++) moving.push(context.parent.child(i));
    const displaced: PMNode[] = [];
    for (let i = next.index; i < next.endIndex; i++) displaced.push(context.parent.child(i));

    const caretOffset = state.selection.from - range.from;
    const displacedSize = displaced.reduce((total, node) => total + node.nodeSize, 0);

    const tr = state.tr.replaceWith(
      range.from,
      next.to,
      Fragment.fromArray([...displaced, ...moving]),
    );

    // The moving run now begins after the displaced one.
    const target = range.from + displacedSize + caretOffset;
    if (target > 0 && target < tr.doc.content.size) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
    }

    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Duplicate a block and its subtree.
 *
 * Ids are cleared rather than copied. Block ids are globally unique — the
 * projection keys on them — so duplicating them would produce two blocks
 * claiming one row, and the second would overwrite the first. Clearing lets the
 * blockIds plugin assign fresh ones, which is the one place that knows how.
 */
export const duplicateBlockSubtree: Command = (state, dispatch) => {
  const context = selectionParent(state);
  const range = selectedBlockRange(state);
  if (!context || !range) return false;

  if (dispatch) {
    const copies: PMNode[] = [];
    for (let i = range.index; i < range.endIndex; i++) {
      const node = context.parent.child(i);
      copies.push(
        node.type.create(
          { ...node.attrs, [BLOCK_ATTRS.id]: null },
          node.content,
          node.marks,
        ),
      );
    }
    dispatch(state.tr.insert(range.to, Fragment.fromArray(copies)).scrollIntoView());
  }
  return true;
};

/**
 * Delete a block and its subtree.
 *
 * Deleting only the block would leave its children behind at a greater indent,
 * where the tree reader normalises them onto whatever now precedes them — so
 * they would silently reattach to an unrelated block.
 *
 * Refuses to empty the document: the schema requires at least one block, and an
 * empty document cannot be typed into.
 */
export const deleteBlockSubtree: Command = (state, dispatch) => {
  const context = selectionParent(state);
  const range = selectedBlockRange(state);
  if (!context || !range) return false;

  const removing = range.endIndex - range.index;
  if (removing >= context.parent.childCount) {
    // Replace with an empty paragraph instead, which is what someone deleting
    // the only block means.
    const paragraph = schema.nodes['paragraph'];
    if (!paragraph) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .replaceWith(range.from, range.to, paragraph.create())
          .scrollIntoView(),
      );
    }
    return true;
  }

  if (dispatch) {
    dispatch(state.tr.delete(range.from, range.to).scrollIntoView());
  }
  return true;
};

/** Descendant count for a block, for showing "move 3 blocks" in a menu. */
export function subtreeSize(state: EditorState): number {
  const range = selectedBlockRange(state);
  return range ? range.endIndex - range.index : 0;
}
