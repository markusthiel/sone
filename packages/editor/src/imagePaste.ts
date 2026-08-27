/**
 * SONE — pasting and dropping images.
 *
 * An image arrives as bytes and has to become a URL before it can be a block,
 * which means an upload — an asynchronous step in the middle of a synchronous
 * paste handler. Two consequences shape everything here:
 *
 *   1. A placeholder block is inserted immediately and filled in when the upload
 *      finishes. Without one, pasting a photo does nothing visible for several
 *      seconds and people paste again.
 *
 *   2. The placeholder is found again by block id, not by position. By the time
 *      the upload returns the document has moved: the person kept typing, or a
 *      collaborator edited above. A stored position would put the image
 *      somewhere else entirely — the same class of bug as the slash menu taking
 *      over the wrong block.
 *
 * The uploader is injected. This package must not know about HTTP endpoints
 * (ADR-0016), and injecting it also makes the failure paths testable.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { schema, writeProps } from './schema.js';

export interface UploadedImage {
  url: string;
  /** Shown until a caption is written, and used as alt text. */
  filename: string;
}

/**
 * Upload a file and return its URL.
 *
 * Rejecting is a normal outcome — a file too large, a type refused, a network
 * that dropped — and the reason is shown on the block rather than thrown away.
 */
export type ImageUploader = (file: File) => Promise<UploadedImage>;

export const imagePastePluginKey = new PluginKey('sone-image-paste');

/** Types the editor will attempt to upload. Matches the server's allowlist. */
const UPLOADABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

function imagesFrom(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => UPLOADABLE.has(file.type));
}

/**
 * Insert a placeholder and start the upload.
 *
 * Exported so a toolbar or a slash item can use the same path as paste: one
 * implementation of "an image is arriving" rather than three that drift.
 */
export function insertImageUpload(
  view: EditorView,
  file: File,
  upload: ImageUploader,
  generateId: () => string = () => crypto.randomUUID(),
): void {
  const imageType = schema.nodes['image'];
  if (!imageType) return;

  const blockId = generateId();

  // `uploading` in props rather than a separate node type: a failed upload
  // leaves a real image block with an explanation on it, which the person can
  // delete or retry, instead of a placeholder node that has to be cleaned up
  // by code that might not run.
  const placeholder = imageType.create({
    [BLOCK_ATTRS.id]: blockId,
    [BLOCK_ATTRS.props]: writeProps({ uploading: true, filename: file.name }),
    [BLOCK_ATTRS.indent]: null,
    url: null,
    alt: file.name,
  });

  view.dispatch(view.state.tr.replaceSelectionWith(placeholder).scrollIntoView());

  void upload(file)
    .then((result) => {
      patchBlock(view, blockId, {
        url: result.url,
        alt: result.filename,
        props: writeProps({ filename: result.filename }),
      });
    })
    .catch((error: unknown) => {
      // The failure is shown on the block. Removing it would lose the fact that
      // something was pasted at all, which is worse than an error someone can
      // see and act on.
      patchBlock(view, blockId, {
        props: writeProps({
          uploading: false,
          failed: true,
          filename: file.name,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    });
}

/**
 * Update a block found by its id.
 *
 * Searched for rather than remembered by position, because by the time an
 * upload returns the document has moved — the person kept typing, or a
 * collaborator edited above. Returns false when the block is gone, which is a
 * normal outcome: someone may have deleted it while it was uploading.
 */
function patchBlock(
  view: EditorView,
  blockId: string,
  attrs: { url?: string | null; alt?: string; props?: string | null },
): boolean {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.attrs[BLOCK_ATTRS.id] === blockId) {
      found = pos;
      return false;
    }
    return true;
  });

  if (found === null) return false;

  const node = view.state.doc.nodeAt(found);
  if (!node) return false;

  const tr = view.state.tr.setNodeMarkup(found, undefined, {
    ...node.attrs,
    ...(attrs.url !== undefined ? { url: attrs.url } : {}),
    ...(attrs.alt !== undefined ? { alt: attrs.alt } : {}),
    ...(attrs.props !== undefined ? { [BLOCK_ATTRS.props]: attrs.props } : {}),
  });
  // Not in the undo stack: an upload completing is not an edit the person made,
  // and undoing it would leave a placeholder pointing at a file that exists.
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
  return true;
}

export interface ImagePasteOptions {
  upload: ImageUploader;
  /** Injected in tests so ids are deterministic. */
  generateId?: () => string;
}

export function imagePaste(options: ImagePasteOptions): Plugin {
  return new Plugin({
    key: imagePastePluginKey,
    props: {
      handlePaste(view, event) {
        const files = imagesFrom(event.clipboardData?.files);
        if (files.length === 0) return false;

        // Never inside a code block: an image there is not representable, and
        // silently placing it after the block would be a surprise.
        const { $from } = view.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.spec.code) return false;
        }

        event.preventDefault();
        for (const file of files) {
          insertImageUpload(view, file, options.upload, options.generateId);
        }
        return true;
      },

      handleDrop(view, event) {
        const dragEvent = event as DragEvent;
        const files = imagesFrom(dragEvent.dataTransfer?.files);
        if (files.length === 0) return false;

        event.preventDefault();

        // Dropped where the pointer is, not where the caret was. A drop that
        // lands at the previous cursor position is the single most confusing
        // thing a drop target can do.
        const at = view.posAtCoords({
          left: dragEvent.clientX,
          top: dragEvent.clientY,
        });
        if (at) {
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(at.pos)),
            ),
          );
        }

        for (const file of files) {
          insertImageUpload(view, file, options.upload, options.generateId);
        }
        return true;
      },
    },
  });
}
