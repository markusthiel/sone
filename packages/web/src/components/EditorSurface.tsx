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
import {
  authorHighlightKey,
  createEditor,
  insertFileBlock,
  highlightClients,
  insertImageUpload,
  seedEmptyPage,
  setFileDisplay,
} from '@sone/editor';

import { ApiError, api } from '../api/client.ts';
import { messageFor } from './Auth.tsx';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { registerHighlighter } from './authorHighlightBridge.ts';
import { BlockMenu } from './BlockMenu.tsx';
import { soneNodeViews } from './CollectionNodeView.tsx';
import { SelectionToolbar } from './SelectionToolbar.tsx';
import { SlashMenu } from './SlashMenu.tsx';
import { TableToolbar } from './TableToolbar.tsx';

interface EditorSurfaceProps {
  handle: PageHandle;
  /** Needed to upload files, which are authorised through their page. */
  pageId: string;
}

export function EditorSurface({ handle, pageId }: EditorSurfaceProps): ReactElement {
  // One uploader, shared by paste, drop and the Image slash item, so all three
  // report failures the same way.
  // The picker lives here, on a component that stays mounted.
  //
  // It was inside the slash menu, which unmounts when the menu closes — so the
  // dialog opened, somebody chose a photo, and the element that would have
  // heard about it no longer existed. Nothing happened, with no error.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Create a collection and place a block for it at the caret.
   *
   * The server first, then the document: the block carries the collection's id,
   * and there is no id until the collection exists. The other order would need
   * a placeholder node and a way to repair one whose request failed — a lot of
   * machinery to avoid one round trip.
   *
   * If the request fails, nothing is inserted and the error is shown. An empty
   * block promising a table that was never created is worse than no block.
   */
  const insertCollection = useCallback(async (): Promise<void> => {
    const view = viewRef.current;
    if (!view) return;

    try {
      const created = await api.createCollection(pageId);
      const type = view.state.schema.nodes['collectionView'];
      if (!type) return;

      const node = type.create({ collectionId: created.collectionId });
      view.dispatch(view.state.tr.replaceSelectionWith(node));
      view.focus();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [pageId]);

  /**
   * Upload a document and put a block for it where the caret is.
   *
   * The upload first, then the block. The block carries the file's id, its type
   * and its size — all of which the server decides from the bytes — so there is
   * nothing to insert until it answers. Inserting a placeholder first would need
   * a way to repair one whose upload failed, which is machinery to avoid one
   * round trip.
   */
  const attachFile = useCallback(
    async (file: File): Promise<void> => {
      const editor = viewRef.current;
      if (!editor) return;

      try {
        const uploaded = await api.uploadFile(pageId, file);
        insertFileBlock({
          fileId: uploaded.id,
          filename: uploaded.filename,
          mimeType: uploaded.mimeType,
          category: uploaded.category ?? 'document',
          sizeBytes: uploaded.sizeBytes,
        })(editor.state, editor.dispatch);
        editor.focus();
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
    },
    [pageId],
  );

  const uploader = useCallback(
    async (file: File) => {
      try {
        const result = await api.uploadFile(pageId, file);
        return { url: result.url, filename: result.filename };
      } catch (error) {
        const base = messageFor(
          error instanceof ApiError ? error.code : 'network_error',
        );
        // The detail is present only for an instance administrator, and it is
        // the part that identifies a deployment problem.
        const detail = error instanceof ApiError ? error.detail : undefined;
        throw new Error(detail ? `${base} (${detail})` : base);
      }
    },
    [pageId],
  );

  /**
   * Files dropped onto the page, placed where they were dropped.
   *
   * The caret is moved to the drop point first, because every insert here works
   * on the selection. Without it a file dropped at the end of a long page lands
   * wherever the caret happened to be, which is usually somewhere the person
   * cannot see.
   *
   * Uploaded one at a time rather than all at once. Dropping five files should
   * produce five blocks in the order they were dropped, and parallel uploads
   * finish in whatever order the network decides. It is also gentler on a
   * server that has just been handed several megabytes.
   */
  const dropFiles = useCallback(
    async (files: File[], at: { left: number; top: number }): Promise<void> => {
      const editor = viewRef.current;
      if (!editor || !canEditRef.current) return;

      const position = editor.posAtCoords(at);
      if (position) {
        editor.dispatch(
          editor.state.tr.setSelection(
            TextSelection.near(editor.state.doc.resolve(position.pos)),
          ),
        );
      }

      for (const file of files) {
        // An image is an image wherever it came from: the same block, the same
        // preview while it uploads. Only what cannot be an image becomes a file
        // block.
        if (file.type.startsWith('image/')) insertImageUpload(editor, file, uploader);
        else await attachFile(file);
      }
      editor.focus();
    },
    [attachFile, uploader],
  );


  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The view goes in state, not only a ref, because the slash menu is a React
  // child that needs it — a ref alone would not trigger the render that mounts
  // the menu.
  const [view, setView] = useState<EditorView | null>(null);
  // Bumped on every transaction. The slash menu opens, filters and closes
  // without the document changing, so nothing else would prompt a re-render.
  const [revision, setRevision] = useState(0);
  /**
   * A failure that has nowhere else to go.
   *
   * A failed image upload becomes a block in the document and says so there. A
   * failed collection has no block — that is the point, nothing is inserted —
   * so it needs somewhere to be said. Silent is the one option not available.
   */
  const [error, setError] = useState<string | null>(null);

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

    const created = createEditor(mount, {
      fragment,
      awareness: handle.awareness,
      editable: () => canEditRef.current,
      onStateChange: () => setRevision((n) => n + 1),
      uploadImage: uploader,
      // A collection is a block in the text (ADR-0021), and this is what draws
      // it. The node is an atom, so ProseMirror never descends into what React
      // mounts there.
      nodeViews: soneNodeViews((getPos, display) => {
        const view = viewRef.current;
        const pos = getPos();
        if (!view || pos === undefined) return;
        setFileDisplay(pos, display as 'card' | 'line' | 'full')(view.state, view.dispatch);
      }),
    });
    viewRef.current = created;
    setView(created);

    // The one command the side panel may send (see authorHighlightBridge).
    registerHighlighter((clients) => {
      created.dispatch(
        created.state.tr.setMeta(
          authorHighlightKey,
          highlightClients(clients ? new Set(clients) : null),
        ),
      );
    });

    return () => {
      registerHighlighter(null);
      created.destroy();
      viewRef.current = null;
      setView(null);
    };
    // Keyed on the document, not the handle: the handle object is recreated on
    // every notification, and rebuilding the editor for each of those would
    // make typing impossible.
  }, [handle.doc, handle.awareness, uploader]);

  // Tell ProseMirror to re-evaluate `editable` when the role changes. Without
  // this the editor keeps its previous editability until the next transaction,
  // so a downgraded user can still type for a moment.
  useEffect(() => {
    viewRef.current?.setProps({});
  }, [handle.canEdit]);

  return (
    <>
      {error && <p className="error">{messageFor(error)}</p>}

      <div
        className="editor-surface"
        // Files dropped onto the page.
        //
        // `dragover` has to be prevented for a drop to happen at all: without
        // it the browser navigates away to the file, which loses whatever was
        // being written.
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files ?? []);
          if (files.length === 0) return;
          event.preventDefault();
          void dropFiles(files, { left: event.clientX, top: event.clientY });
        }}
        ref={mountRef}
        // Focus lands on the ProseMirror element inside, which manages its own
        // tabindex and ARIA attributes.
        data-editable={handle.canEdit ? 'true' : 'false'}
      />

      {/* Outside the conditional block below, so it survives the slash menu
          closing. A file picker is asynchronous — the person may spend a minute
          in their photo library — and the element has to still be in the
          document when they come back. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared after reading, so choosing the same photo twice in a row
          // still fires a change event the second time.
          event.target.value = '';
          const editor = viewRef.current;
          if (!editor) return;
          for (const file of files) insertImageUpload(editor, file, uploader);
          editor.focus();
        }}
      />
      {/* A second picker, for documents.
        *
        * Separate from the image one rather than one input with a wider accept
        * list: the image path inserts an image block and shows a preview while
        * it uploads, and a document takes a different block. One input would
        * have to guess which from the file's type, which is exactly the guess
        * the server refuses to make from a declared type. */}
      <input
        ref={docInputRef}
        type="file"
        accept={
          '.pdf,.txt,.md,.csv,.docx,.xlsx,.pptx,.odt,.ods,.zip,' +
          'application/pdf,text/plain,text/csv,text/markdown,application/zip,' +
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
          'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
          'application/vnd.oasis.opendocument.text,' +
          'application/vnd.oasis.opendocument.spreadsheet'
        }
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          for (const file of files) void attachFile(file);
        }}
      />

      {view && handle.canEdit && (
        <>
          <SlashMenu
            view={view}
            revision={revision}
            onPickImage={() => fileInputRef.current?.click()}
            onPickFile={() => docInputRef.current?.click()}
            onInsertCollection={() => void insertCollection()}
          />
          <BlockMenu view={view} revision={revision} />
          <TableToolbar view={view} revision={revision} />
          <SelectionToolbar view={view} revision={revision} />
        </>
      )}
    </>
  );
}