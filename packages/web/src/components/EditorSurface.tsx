/**
 * SONE web — the editor surface.
 *
 * The only component that touches ProseMirror. Everything about it is imperative
 * and lives outside React's render cycle on purpose: ProseMirror owns its DOM,
 * and letting React re-render into it produces a fight neither wins — lost
 * cursors, duplicated nodes, and input that drops characters under load.
 *
 * So the view is created once per page and destroyed on unmount. React is told
 * nothing about the document contents.
 */

import type { PageHandle } from '@sone/client';
import { pageContent } from '@sone/core';
import { createEditor, seedEmptyPage } from '@sone/editor';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, type ReactElement } from 'react';

interface EditorSurfaceProps {
  handle: PageHandle;
}

export function EditorSurface({ handle }: EditorSurfaceProps): ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // `canEdit` is read through a ref so the editor sees the current value
  // without being recreated. A role can change while a page is open — the
  // server sends RoleChanged rather than disconnecting — and recreating the
  // view would throw away the caret and the undo stack.
  const canEditRef = useRef(handle.canEdit);
  canEditRef.current = handle.canEdit;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const fragment = pageContent(handle.doc);

    // A page created by the API has an empty body, and the schema requires at
    // least one block. Only an editor may seed it: a viewer doing so would
    // write to a document it has no right to change.
    if (canEditRef.current) seedEmptyPage(fragment);

    const view = createEditor(mount, {
      fragment,
      awareness: handle.awareness,
      editable: () => canEditRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Keyed on the document, not the handle: the handle object is recreated on
    // every notification, and rebuilding the editor for each of those would
    // make typing impossible.
  }, [handle.doc, handle.awareness]);

  // Tell ProseMirror to re-evaluate `editable` when the role changes. Without
  // this the editor keeps its previous editability until the next transaction,
  // so a downgraded user can still type for a moment.
  useEffect(() => {
    viewRef.current?.setProps({});
  }, [handle.canEdit]);

  return (
    <div
      className="editor-surface"
      ref={mountRef}
      // Focus lands on the ProseMirror element inside, which manages its own
      // tabindex and ARIA attributes.
      data-editable={handle.canEdit ? 'true' : 'false'}
    />
  );
}