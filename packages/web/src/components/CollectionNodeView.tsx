/**
 * SONE web — a collection, in the flow of the text.
 *
 * The `collectionView` node has been in the schema since the first draft,
 * carrying `collectionId`, `viewId` and `display`. Nothing rendered it: the
 * folder shape was built instead, and then the table was parked underneath the
 * page while the model was corrected (ADR-0021). This is the node view it was
 * always waiting for, and it is what makes a collection a block you can put
 * between two paragraphs, as Craft does.
 *
 * ## Mounting React inside ProseMirror
 *
 * The node is an atom and `isolating`, so ProseMirror never descends into it and
 * never tries to reconcile what React puts there. That is the contract that
 * makes this safe: two libraries owning one subtree is a bug factory, and here
 * the boundary is explicit — ProseMirror owns the `<div>`, React owns
 * everything inside it.
 *
 * `stopEvent` returns true for everything. Without it, typing in a cell would
 * be read as typing in the document: ProseMirror would try to place a selection
 * inside a node it considers a single opaque unit, and the keystroke would end
 * up in neither place.
 */

import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';

import { applyBlockAttrs } from './blockAttrs.ts';
import { CollectionTable } from './CollectionTable.tsx';
import { fileNodeView, type FileViewLabels } from './FileNodeView.ts';
import { videoNodeView, type VideoViewLabels } from './VideoNodeView.ts';
import { protectedSectionView } from './ProtectedSectionView.ts';

/**
 * The little of a ProseMirror node this needs.
 *
 * Structural rather than an import: prosemirror-model is a dependency of the
 * editor package, not of this one, and adding it here to name a type would put
 * a second copy of it in the tree — the same hazard check-single-crdt.mjs
 * guards against for Yjs.
 */
interface PMNodeLike {
  type: { name: string };
  attrs: Record<string, unknown>;
}

class CollectionNodeView implements NodeView {
  readonly dom: HTMLElement;
  private root: Root | null = null;
  private collectionId: string | null;
  private attrs: Record<string, unknown> = {};

  private attrsOf(): Record<string, unknown> {
    return this.attrs;
  }

  constructor(
    node: PMNodeLike,
    private readonly select: () => void,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'collection-block';
    // Kept out of the editor's own text handling: a table is not text, and a
    // caret has no meaning inside one.
    this.dom.contentEditable = 'false';

    // A click on the block's own frame selects it.
    //
    // The gutter appears for the selected block, and `stopEvent` below keeps
    // every event from ProseMirror — so clicking a table selected nothing and
    // its ⋮⋮ never came. It appeared for a moment after inserting one, because
    // the insertion leaves the selection on the block, and then never again.
    //
    // Only the frame, and this is the difference from the file and the video:
    // a table is full of controls, and most of it is somebody working in a cell.
    // Anything interactive keeps its click; the padding around the table is what
    // selects.
    this.dom.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [role="tab"], td, th')) return;
      this.select();
    });

    this.collectionId = (node.attrs['collectionId'] as string | null) ?? null;
    this.attrs = node.attrs;
    this.render();
  }

  private render(): void {
    // See blockAttrs.ts: a node view carries these itself, or the block has no
    // width as far as the stylesheet is concerned.
    applyBlockAttrs(this.dom, this.attrsOf());

    if (!this.collectionId) {
      // A block whose collection is missing — an id that never resolved, or a
      // document from elsewhere. Said plainly rather than rendered as an empty
      // box somebody would take for a broken table.
      this.dom.textContent = 'This table is not available.';
      this.dom.classList.add('collection-block-missing');
      return;
    }

    this.root ??= createRoot(this.dom);
    this.root.render(createElement(CollectionTable, { collectionId: this.collectionId }));
  }

  /**
   * Accept an update in place when only the collection changed.
   *
   * Returning false would have ProseMirror destroy and rebuild the node view,
   * which unmounts React and loses whatever was half-typed in a cell.
   */
  update(node: PMNodeLike): boolean {
    if (node.type.name !== 'collectionView') return false;

    this.attrs = node.attrs;
    const next = (node.attrs['collectionId'] as string | null) ?? null;
    if (next !== this.collectionId) {
      this.collectionId = next;
      this.render();
      return true;
    }

    // The table itself is React's and must not be torn down for a width change —
    // that would remount it and lose whatever somebody was typing in a cell. So
    // the presentation attributes are applied without redrawing.
    applyBlockAttrs(this.dom, node.attrs);
    return true;
  }

  /**
   * Everything inside belongs to React.
   *
   * Without this, a keystroke in a cell is handled by ProseMirror as a
   * keystroke in the document.
   */
  stopEvent(): boolean {
    return true;
  }

  /** Nothing here for ProseMirror to reconcile. */
  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    // Deferred: React refuses to unmount a root while it is rendering, and
    // ProseMirror can destroy a node view from inside a transaction that began
    // in a React event handler.
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
  }
}

/**
 * The node views this editor needs.
 *
 * Still a function rather than a constant: it took an argument while the file
 * view could change how it was displayed, and keeping the shape means the next
 * view that needs something from the surface does not change every caller.
 */
export const soneNodeViews = (
  onOpenContainer: (containerId: string) => void,
  /** The words a node view needs in the reader's language (ADR-0041). */
  labels: FileViewLabels & { video: VideoViewLabels },
): EditorView['props']['nodeViews'] => ({
  collectionView: (node, view, getPos) =>
    new CollectionNodeView(node as unknown as PMNodeLike, () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    }),
  file: fileNodeView(labels),
  video: videoNodeView(labels.video),
  protectedSection: protectedSectionView(onOpenContainer),
});
