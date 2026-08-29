/**
 * SONE editor — presentation commands.
 *
 * How a block looks, as opposed to what it is. The three attributes are shared
 * by every block type (BLOCK_ATTRS in @sone/core), so this file has no per-type
 * cases and gains none when a new block is added.
 */

import {
  BLOCK_ATTRS,
  type BlockAlignment,
  type BlockColor,
  type BlockWidth,
} from '@sone/core';
import type { Node as PMNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';

/**
 * Set how the blocks in the selection are presented.
 *
 * `null` clears a setting, which is not the same as choosing a default value:
 * cleared means "as the design decides", so a later change to the design
 * reaches the block. A block that had `align: 'start'` written into it would
 * keep pointing left for ever, even if the design moved on.
 *
 * Applies to every block the selection touches, so setting a width on three
 * selected paragraphs does not silently do one.
 */
export function setBlockStyle(changes: {
  align?: BlockAlignment | null;
  width?: BlockWidth | null;
  color?: BlockColor | null;
}): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const targets: Array<{ pos: number; node: PMNode }> = [];

    state.doc.nodesBetween(from, to, (node, pos) => {
      // Only top-level blocks: a table cell's paragraph is inside the table,
      // and aligning it independently would fight the table's own layout.
      if (node.isBlock && node.type.spec.group?.includes('block')) {
        targets.push({ pos, node });
      }
      return true;
    });

    if (targets.length === 0) return false;
    if (!dispatch) return true;

    const tr = state.tr;
    for (const target of targets) {
      const attrs: Record<string, unknown> = { ...target.node.attrs };
      if ('align' in changes) attrs[BLOCK_ATTRS.align] = changes.align ?? null;
      if ('width' in changes) attrs[BLOCK_ATTRS.width] = changes.width ?? null;
      if ('color' in changes) attrs[BLOCK_ATTRS.color] = changes.color ?? null;
      tr.setNodeMarkup(target.pos, undefined, attrs);
    }

    dispatch(tr);
    return true;
  };
}

/** What the blocks in the selection currently carry, when they agree. */
export function currentBlockStyle(state: EditorState): {
  align: string | null;
  width: string | null;
  color: string | null;
} {
  const { from, to } = state.selection;
  let align: string | null = null;
  let width: string | null = null;
  let color: string | null = null;
  let seen = false;

  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isBlock || !node.type.spec.group?.includes('block')) return true;
    const nodeAlign = (node.attrs[BLOCK_ATTRS.align] as string | null) ?? null;
    const nodeWidth = (node.attrs[BLOCK_ATTRS.width] as string | null) ?? null;
    const nodeColor = (node.attrs[BLOCK_ATTRS.color] as string | null) ?? null;

    if (!seen) {
      align = nodeAlign;
      width = nodeWidth;
      color = nodeColor;
      seen = true;
      return true;
    }
    // Blocks that disagree report nothing rather than the first one's answer,
    // which would show a setting the other blocks do not have.
    if (nodeAlign !== align) align = null;
    if (nodeWidth !== width) width = null;
    if (nodeColor !== color) color = null;
    return true;
  });

  return { align, width, color };
}

/** How a file block is drawn. */
export type FileDisplay = 'card' | 'line' | 'full';

export interface FileBlockAttrs {
  fileId: string;
  filename: string;
  mimeType: string;
  category: string;
  sizeBytes?: number | null;
  display?: FileDisplay;
}

/**
 * Insert a file block.
 *
 * The default display depends on what the file is, because the useful default
 * differs: a PDF is usually attached to be read, so it opens as a viewer, while
 * a spreadsheet nothing here can render is a card with its name on it. Somebody
 * can change it either way — this only decides which is right more often.
 */
export function insertFileBlock(attrs: FileBlockAttrs): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes['file'];
    if (!type) return false;
    if (!dispatch) return true;

    const display: FileDisplay =
      attrs.display ?? (attrs.category === 'pdf' || attrs.category === 'text' ? 'full' : 'card');

    dispatch(
      state.tr.replaceSelectionWith(
        type.create({
          fileId: attrs.fileId,
          filename: attrs.filename,
          mimeType: attrs.mimeType,
          category: attrs.category,
          sizeBytes: attrs.sizeBytes ?? null,
          display,
        }),
      ),
    );
    return true;
  };
}

/** Change how the file block at `pos` is drawn. */
export function setFileDisplay(pos: number, display: FileDisplay): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'file') return false;
    if (!dispatch) return true;

    dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, display }));
    return true;
  };
}
