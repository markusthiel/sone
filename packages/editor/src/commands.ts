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

/** How a video block is drawn (ADR-0037). */
export type VideoDisplayMode = 'player' | 'card' | 'link';

export interface VideoBlockAttrs {
  source: 'file' | 'embed' | 'stream';
  fileId?: string | null;
  /** For an embed or a stream: the address, already normalised by the allowlist. */
  url?: string;
  title?: string;
  display?: VideoDisplayMode;
}

/**
 * Insert a video block.
 *
 * One command for all three sources, as there is one node: what differs between
 * an upload, an embed and a stream is which attribute carries the address, not
 * what kind of thing is being put in the page.
 *
 * The player is the default in every case, which is what was asked for and is
 * also the only honest default — somebody inserting a video means to show a
 * video, and a card is what they choose afterwards if the page is a list of
 * links.
 */
export function insertVideoBlock(attrs: VideoBlockAttrs): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes['video'];
    if (!type) return false;
    if (!dispatch) return true;

    dispatch(
      state.tr.replaceSelectionWith(
        type.create({
          source: attrs.source,
          fileId: attrs.fileId ?? null,
          url: attrs.url ?? '',
          title: attrs.title ?? '',
          display: attrs.display ?? 'player',
        }),
      ),
    );
    return true;
  };
}

/**
 * Change how the video block at `pos` is drawn.
 *
 * A stream refuses anything but the player, here rather than only in the menu:
 * the menu is one caller, and a card for something that is interesting only
 * while it is live is a dead link tomorrow whoever asked for it.
 */
export function setVideoDisplay(pos: number, display: VideoDisplayMode): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'video') return false;
    if (node.attrs['source'] === 'stream' && display !== 'player') return false;
    if (!dispatch) return true;

    dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, display }));
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

/**
 * Show an image as a card or a line, and back.
 *
 * An image *is* a file with a special way of being drawn, so the card and the
 * line it can take are the file block's own — reached by making the block a
 * file block rather than by teaching a second component the same three layouts.
 * That duplication is what the file block's `···` menu was removed to undo.
 *
 * The conversion is lossless in the direction that matters: the file id and the
 * name survive both ways, and the block attributes — alignment, width, colour —
 * are carried across, because they are somebody's choices about this block and
 * not about which node type happens to hold it.
 */
export function showImageAs(pos: number, display: 'image' | 'card' | 'line'): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;

    const isImage = node.type.name === 'image';
    const isImageFile = node.type.name === 'file' && node.attrs['category'] === 'image';
    if (!isImage && !isImageFile) return false;

    const wantsImage = display === 'image';
    if (wantsImage === isImage) {
      // Already the right node type; only the file block's own display needs
      // changing, and an image node has none to change.
      if (isImage) return true;
      return setFileDisplay(pos, display === 'card' ? 'card' : 'line')(state, dispatch);
    }

    const target = state.schema.nodes[wantsImage ? 'image' : 'file'];
    if (!target) return false;

    // Shared block attributes travel; the rest is rebuilt from what each node
    // type needs.
    const carried = {
      [BLOCK_ATTRS.id]: node.attrs[BLOCK_ATTRS.id],
      [BLOCK_ATTRS.indent]: node.attrs[BLOCK_ATTRS.indent],
      [BLOCK_ATTRS.align]: node.attrs[BLOCK_ATTRS.align],
      [BLOCK_ATTRS.width]: node.attrs[BLOCK_ATTRS.width],
      [BLOCK_ATTRS.color]: node.attrs[BLOCK_ATTRS.color],
    };

    const url = isImage
      ? (node.attrs['url'] as string | null)
      : `/api/files/${String(node.attrs['fileId'] ?? '')}`;
    const fileId = isImage ? fileIdFrom(url) : (node.attrs['fileId'] as string | null);
    const name = isImage
      ? (node.attrs['alt'] as string) || 'Image'
      : (node.attrs['filename'] as string);

    // An image that is not one of ours — pasted from elsewhere, or still
    // uploading — has no file id, and a card for it could not be opened or
    // downloaded. Refused rather than half-built.
    //
    // Checked before the dispatch guard, or the command reports that it can act
    // on something it will refuse: a menu asking "is this available" would show
    // the entry and then do nothing.
    if (!fileId) return false;
    if (!dispatch) return true;

    const next = wantsImage
      ? target.create({ ...carried, url: `/api/files/${fileId}`, alt: name })
      : target.create({
          ...carried,
          fileId,
          filename: name,
          mimeType: 'image/*',
          category: 'image',
          display,
        });

    dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, next));
    return true;
  };
}

/** The id in `/api/files/<id>`, or null for a URL that is not ours. */
function fileIdFrom(url: string | null): string | null {
  const match = /^\/api\/files\/([^/?#]+)/.exec(url ?? '');
  return match?.[1] ?? null;
}
