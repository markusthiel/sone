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

import type { EditorView, NodeView } from 'prosemirror-view';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';

import { CollectionTable } from './CollectionTable.tsx';
import { fileNodeView } from './FileNodeView.ts';

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

  constructor(node: PMNodeLike) {
    this.dom = document.createElement('div');
    this.dom.className = 'collection-block';
    // Kept out of the editor's own text handling: a table is not text, and a
    // caret has no meaning inside one.
    this.dom.contentEditable = 'false';

    this.collectionId = (node.attrs['collectionId'] as string | null) ?? null;
    this.render();
  }

  private render(): void {
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

    const next = (node.attrs['collectionId'] as string | null) ?? null;
    if (next !== this.collectionId) {
      this.collectionId = next;
      this.render();
    }
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
 * A function rather than a constant, because the file view needs a way to
 * dispatch a command and only the surface has the view to dispatch on.
 */
export const soneNodeViews = (
  setFileDisplayAt: (getPos: () => number | undefined, display: string) => void,
): EditorView['props']['nodeViews'] => ({
  collectionView: (node) => new CollectionNodeView(node as unknown as PMNodeLike),
  file: fileNodeView(setFileDisplayAt),
});
