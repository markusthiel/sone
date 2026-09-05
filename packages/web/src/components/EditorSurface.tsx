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
import { pageContent, readStreamLink, readVideoLink } from '@sone/core';
import {
  assignmentChips,
  authorHighlightKey,
  commentMarks,
  commentMarksKey,
  revealRange,
  type CommentAnchor,
  type DrawnThread,
  createEditor,
  insertFileBlock,
  insertVideoBlock,
  highlightClients,
  insertImageUpload,
  seedEmptyPage,
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
import { MentionMenu } from './MentionMenu.tsx';
import { SlashMenu } from './SlashMenu.tsx';
import { TableToolbar } from './TableToolbar.tsx';
import { VideoDialog } from './VideoDialog.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { usePageLocked } from '../hooks/usePageWidth.ts';
import { useT } from '../i18n/useT.tsx';
import { paths } from '../routes/paths.ts';
import { webVariant } from '../lib/imageVariant.ts';

interface EditorSurfaceProps {
  handle: PageHandle;
  /** Needed to upload files, which are authorised through their page. */
  pageId: string;
  /** The threads to mark, read by the page (ADR-0046). */
  threads: DrawnThread[];
  /** A selection somebody wants to comment on. */
  onComment: (anchor: CommentAnchor) => void;
  /** How much to mark a commented passage (ADR-0046). */
  markStyle: 'highlight' | 'underline' | 'off';
  /** The workspace's people, for assigning a task (ADR-0052). */
  members: Array<{ userId: string; displayName: string }>;
}

/**
 * What to say about a video this browser would not play.
 *
 * Names the format, because "this may not play" without saying what is wrong is
 * a sentence nobody can act on — and names the way out, which is a conversion
 * done by whatever the person already uses rather than by us (ADR-0037).
 */
function unplayableNotice(file: File): string {
  const looksAppleish = /quicktime|x-m4v/.test(file.type) || /\.mov$/i.test(file.name);
  return looksAppleish
    ? `${file.name} is a QuickTime file. It is uploaded and will play in Safari; other browsers usually cannot, because the video inside is HEVC. Exporting it as MP4 (H.264) plays everywhere.`
    : `${file.name} is a format this browser cannot play (${file.type || 'unknown type'}). It is uploaded, but MP4 (H.264) or WebM is what plays everywhere.`;
}

export function EditorSurface({
  handle,
  pageId,
  threads,
  onComment,
  markStyle,
  members,
}: EditorSurfaceProps): ReactElement {
  const { t } = useT();
  // One uploader, shared by paste, drop and the Image slash item, so all three
  // report failures the same way.
  // The picker lives here, on a component that stays mounted.
  //
  // It was inside the slash menu, which unmounts when the menu closes — so the
  // dialog opened, somebody chose a photo, and the element that would have
  // heard about it no longer existed. Nothing happened, with no error.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
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
   * Create a protected section and place a block for it at the caret.
   *
   * The same order as a collection and for the same reason: the block carries
   * an id, and there is no id until the server has made the document.
   *
   * The section is restricted the moment it exists (ADR-0026), so there is no
   * point at which it is part of this page in the ordinary way — which matters
   * more here than for a collection, because somebody creating one is doing it
   * precisely to keep something out of the page.
   */
  const insertProtectedSection = useCallback(async (): Promise<void> => {
    const view = viewRef.current;
    if (!view) return;

    try {
      const created = await api.createContainer(pageId);
      const type = view.state.schema.nodes['protectedSection'];
      if (!type) return;

      const node = type.create({ containerId: created.containerId });
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

  /**
   * Upload a video and insert a block for it (ADR-0037).
   *
   * Separate from `attachFile` because it inserts a different block, in the same
   * way the image path is separate: one input choosing between them by the file's
   * declared type would be exactly the guess the server refuses to make.
   *
   * Nothing is transcoded, here or on the server, and the reasons are in
   * ADR-0037. What happens instead is this warning: the browser is asked whether
   * it could play the file *before* it is sent, because an iPhone `.mov` carrying
   * HEVC is the ordinary case, most browsers draw a black rectangle for it, and a
   * sentence at the moment of choosing is worth more than any conversion we could
   * honestly run. It is a warning and not a refusal — the file may well play for
   * the person it is meant for, and it is their page.
   */
  const attachVideo = useCallback(
    async (file: File): Promise<void> => {
      const editor = viewRef.current;
      if (!editor) return;

      const probe = document.createElement('video');
      const verdict = file.type ? probe.canPlayType(file.type) : '';

      // Said while it happens, and this is the part that was missing.
      //
      // A video is the first thing this application sends whole: a photograph is
      // shrunk in the browser first (ADR-0029) and a document is usually small,
      // so until now an upload was over before anybody looked. Eight megabytes
      // is seconds, and seconds with nothing on screen is indistinguishable from
      // nothing happening — which is exactly how it was reported.
      setNotice(
        verdict === ''
          ? `Uploading ${file.name}… ${unplayableNotice(file)}`
          : `Uploading ${file.name}…`,
      );

      try {
        const uploaded = await api.uploadFile(pageId, file);
        insertVideoBlock({
          source: 'file',
          fileId: uploaded.id,
          title: uploaded.filename,
        })(editor.state, editor.dispatch);
        editor.focus();
        setError(null);
        // The warning outlives the upload; the progress does not.
        setNotice(verdict === '' ? unplayableNotice(file) : null);
      } catch (err) {
        setNotice(null);
        setError(err instanceof ApiError ? err.code : 'network_error');
      }
    },
    [pageId],
  );

  /**
   * Insert a video from an address.
   *
   * Read by the allowlist first, in the browser, so a link nothing embeds is
   * refused before a block exists rather than becoming a block that renders an
   * apology. The same rule runs at render time, from the same function, which is
   * what makes tightening the list reach documents already written.
   */
  const insertVideoLink = useCallback((raw: string): boolean => {
    const editor = viewRef.current;
    if (!editor) return false;

    const embed = readVideoLink(raw);
    const stream = embed ? null : readStreamLink(raw);
    if (!embed && !stream) return false;

    insertVideoBlock(
      embed
        ? { source: 'embed', url: embed.pageUrl }
        : { source: 'stream', url: stream!.url },
    )(editor.state, editor.dispatch);
    editor.focus();
    return true;
  }, []);

  const uploader = useCallback(
    async (file: File) => {
      try {
        // The original first, because it is the one the block refers to and the
        // one that must exist even if everything after this fails.
        const result = await api.uploadFile(pageId, file);

        // Then a smaller copy, if this is a photograph worth shrinking.
        //
        // Failures here are swallowed on purpose: a page that shows the
        // original is the behaviour SONE had yesterday, and losing an upload
        // because the second half of it did not work would be a worse trade
        // than sending a few megabytes (ADR-0029).
        void webVariant(file)
          .then((smaller) => {
            if (smaller) return api.uploadFile(pageId, smaller, result.id);
            return null;
          })
          .catch(() => null);

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
        // A dropped video becomes a video, not an attachment named after one
        // (ADR-0037). Decided from the browser's own type here because that is
        // all a drop carries; the server still decides from the bytes, and a
        // mismatch means an ordinary file block's worth of disagreement rather
        // than a wrong file stored.
        else if (file.type.startsWith('video/')) await attachVideo(file);
        else await attachFile(file);
      }
      editor.focus();
    },
    [attachFile, attachVideo, uploader],
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
  /**
   * Something worth saying that is not a failure.
   *
   * A video this browser cannot play is not an error: it uploaded, it is in the
   * page, and it may play perfectly for the person it was put there for.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Whether the "add a video" dialog is up (ADR-0037).
   *
   * Kept here rather than inside the slash menu, which unmounts the moment it
   * closes — the picker learnt that lesson already. It is still state in this
   * component, so anything that unmounts *this* takes the dialog with it; that is
   * what an editor crash looks like from the outside, and the node view no longer
   * throws for exactly that reason.
   */
  const [videoOpen, setVideoOpen] = useState(false);

  // `canEdit` is read through a ref so the editor sees the current value
  // without being recreated. A role can change while a page is open — the
  // server sends RoleChanged rather than disconnecting — and recreating the
  // view would throw away the caret and the undo stack.
  const canEditRef = useRef(handle.canEdit);
  /**
   * The current threads, for the marks plugin to read on every rebuild.
   *
   * A ref rather than a closure over the list: the editor is created once and
   * the threads change constantly, so a captured list would be the one that
   * existed when the page opened.
   */
  const threadsRef = useRef<DrawnThread[]>([]);
  /** userId → name, for the assignment chips (ADR-0052). */
  const membersRef = useRef<Map<string, string>>(new Map());
  membersRef.current = new Map(members.map((one) => [one.userId, one.displayName]));
  threadsRef.current = threads;
  /** Same reason as the threads: the editor is made once, this changes. */
  const markStyleRef = useRef(markStyle);
  markStyleRef.current = markStyle;

  /*
   * Redraw the marks when the threads or the style change.
   *
   * The plugin rebuilds its decorations on a transaction, and neither a ref nor
   * a prop is one — so something has to dispatch. Two triggers, because there
   * are two kinds of change and they arrive by different routes:
   *
   * The style is React state and arrives as a prop, so an effect is right.
   *
   * The threads are in the document, and a change there produces no editor
   * transaction at all — the body did not change, only a map beside it. That
   * used to be an effect on the threads prop too, and deleting a thread left its
   * highlight in the text until a reload. So the hook that noticed the document
   * change says so directly, and this listens.
   */
  useEffect(() => {
    const nudge = (event?: Event): void => {
      // The list from the event, when there is one: it was read after the change
      // and before React re-rendered, so it is newer than anything the props or
      // the ref can offer at this moment.
      const carried = (event as CustomEvent<DrawnThread[]> | undefined)?.detail;
      if (Array.isArray(carried)) threadsRef.current = carried;

      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.tr.setMeta(commentMarksKey, true));
    };
    nudge();
    window.addEventListener('sone:comments-changed', nudge);
    return () => window.removeEventListener('sone:comments-changed', nudge);
  }, [markStyle]);

  /**
   * Scroll to a thread's text when the panel asks.
   *
   * A window event rather than a callback threaded down: the panel and the
   * editor are siblings in different subtrees, and connecting two siblings by
   * passing a function up through three components and back down is more moving
   * parts than one named event. The panel already knows the thread's id; only
   * the editor can turn its anchor into a position.
   */
  useEffect(() => {
    const reveal = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail;
      const found = threadsRef.current.find((thread) => thread.id === id);
      const view = viewRef.current;
      if (!found || !view) return;

      const at = revealRange(view.state, found);
      if (!at) return;

      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.from, at.to)));
      view.focus();
      // Into view, and not more than that: a flash would be a second thing to
      // build and the selection already says which words.
      view.domAtPos(at.from).node.parentElement?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    };
    window.addEventListener('sone:reveal-comment', reveal);
    return () => window.removeEventListener('sone:reveal-comment', reveal);
  }, []);
  canEditRef.current = handle.canEdit;
  /** The lock, read from the document so it arrives like any other edit. */
  const locked = usePageLocked(handle.doc);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  /**
   * Whether what the document contains is known yet.
   *
   * This is the fix for empty paragraphs breeding on every visit.
   *
   * A document starts empty locally and fills in when the server's state
   * arrives. The editor used to mount immediately and seed an empty paragraph
   * into that empty fragment — correct for a genuinely new page, and wrong for
   * every existing one: the seed was a real CRDT insert, so when the server's
   * content merged in a moment later the page had its blocks *and* a stray empty
   * paragraph. One per visit, and where it landed depended on how the two
   * inserts ordered, which is why they appeared in the middle as often as at the
   * end.
   *
   * `synced` is the point at which the server has told us everything it has
   * (ADR-0012), so it is the earliest moment an empty fragment can be believed.
   * A fragment that already has content is also enough — that is a local copy
   * offline, and refusing to mount then would mean an offline page could not be
   * read.
   */
  const contentKnown =
    handle.status === 'synced' || pageContent(handle.doc).length > 0;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // Nothing is mounted until the content is known, because mounting is what
    // used to seed — see the note above.
    if (!contentKnown) return;

    const fragment = pageContent(handle.doc);

    // A page created by the API has an empty body, and the schema requires at
    // least one block. Only an editor may seed it: a viewer doing so would
    // write to a document it has no right to change.
    //
    // Safe here and only here: the fragment being empty now means the page is
    // empty, rather than meaning the content has not arrived.
    if (canEditRef.current) seedEmptyPage(fragment);

    const created = createEditor(mount, {
      fragment,
      awareness: handle.awareness,
      /*
       * The marks under commented passages (ADR-0046).
       *
       * Fed from a ref rather than from a closure over the current threads:
       * the editor is created once and the threads change constantly, so a
       * captured list would be the one that existed when the page opened.
       */
      plugins: [
        commentMarks(() => threadsRef.current, () => markStyleRef.current),
        // Whose task it is, from a ref for the same reason the marks are: the
        // member list arrives after the editor is built (ADR-0052).
        assignmentChips((userId) => membersRef.current.get(userId) ?? null),
      ],
      // The `/` menu's items, in this interface's language (ADR-0041). Given to
      // the plugin rather than applied when drawing, because the list is
      // filtered by what somebody typed — a German reader typing "übersch" has
      // to find "Überschrift 1".
      //
      // The English keywords stay and are matched as well: "h1" and "ul" are
      // typed by people in every language.
      localiseSlashItem: (item) => {
        const key = `slash.${item.id}` as MessageKey;
        const extra = t(`${key}.keywords` as MessageKey)
          .split(',')
          .map((word) => word.trim())
          .filter((word) => word !== '');
        return {
          ...item,
          title: t(key),
          hint: t(`${key}.hint` as MessageKey),
          keywords: [...item.keywords, ...extra],
        };
      },
      /*
       * One predicate, and the lock goes through it (ADR-0049).
       *
       * ProseMirror asks this for typing, pasting, dragging and every command,
       * so a locked page stops offering all of them at once. The alternative —
       * `if (locked)` in fifteen commands — is fifteen chances for one to be
       * forgotten, and the one forgotten is a hole nobody finds until a locked
       * page changes.
       */
      editable: () => canEditRef.current && !lockedRef.current,
      onStateChange: () => setRevision((n) => n + 1),
      uploadImage: uploader,
      // A collection is a block in the text (ADR-0021), and this is what draws
      // it. The node is an atom, so ProseMirror never descends into what React
      // mounts there.
      // A protected section is a document of its own, so opening one is
      // navigating to it rather than expanding something here.
      nodeViews: soneNodeViews(
        (containerId) => {
          window.location.assign(paths.page(containerId));
        },
        {
          pdf: {
            pageOf: (page, total) => t('file.pdfPageOf', { page, total }),
            loading: t('file.pdfLoading'),
            failed: t('file.pdfFailed'),
            openOriginal: t('file.pdfAllPages'),
            document: t('file.pdfDocument'),
            previous: t('file.pdfPrevious'),
            next: t('file.pdfNext'),
          },
          video: {
            hlsFailed: t('video.hlsFailed'),
            dashOnly: t('video.dashOnly'),
            openStream: t('video.openStream'),
          },
        },
      ),
    });
    viewRef.current = created;
    setView(created);

    /**
     * Who removed a block, when one disappears.
     *
     * A block that vanishes has been deleted from the document, and there are
     * only three candidates: this browser's own editor, y-prosemirror throwing
     * away an element it could not turn into a node, or an update from the
     * server — another client, or another tab. A Yjs transaction says which:
     * `local` separates this browser from the wire, and the origin names the
     * plugin.
     *
     * Two rounds of reasoning about a vanishing video went into mechanisms that
     * were real and not the cause, because nothing in the running application
     * could answer this question. Now it can, and it costs one observer.
     */
    const watchRemovals = (events: Array<{ changes: { deleted: Set<unknown> } }>, tx: {
      local: boolean;
      origin: unknown;
    }): void => {
      for (const event of events) {
        for (const item of event.changes.deleted) {
          const content = (item as { content?: { type?: { nodeName?: string } } }).content;
          const name = content?.type?.nodeName;
          if (typeof name !== 'string') continue;
          // eslint-disable-next-line no-console
          console.warn(
            `[sone] block removed: ${name} — ${tx.local ? 'by this browser' : 'from the network'}`,
            { origin: String((tx.origin as { key?: string })?.key ?? tx.origin) },
          );
        }
      }
    };
    fragment.observeDeep(watchRemovals as never);

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
      fragment.unobserveDeep(watchRemovals as never);
      registerHighlighter(null);
      created.destroy();
      viewRef.current = null;
      setView(null);
    };
    // Keyed on the document, not the handle: the handle object is recreated on
    // every notification, and rebuilding the editor for each of those would
    // make typing impossible.
  }, [handle.doc, handle.awareness, uploader, contentKnown]);

  // Tell ProseMirror to re-evaluate `editable` when the role changes. Without
  // this the editor keeps its previous editability until the next transaction,
  // so a downgraded user can still type for a moment.
  useEffect(() => {
    viewRef.current?.setProps({});
    // The lock too, and for the same reason: without this a page stays editable
    // until the next transaction, which is one keystroke too many.
  }, [handle.canEdit, locked]);

  return (
    <>
      {error && <p className="error">{messageFor(error)}</p>}
      {notice && (
        <p className="muted editor-notice">
          {notice}{' '}
          <button type="button" className="link-button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

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
        data-editable={handle.canEdit && !locked ? 'true' : 'false'}
        data-locked={locked ? 'true' : undefined}
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

      {/* A third picker, for video.
        *
        * Its own rather than a wider accept list on the document one, for the
        * reason written there: the two insert different blocks, and one input
        * would have to guess which from a declared type — the guess the server
        * refuses to make. */}
      <input
        ref={videoInputRef}
        type="file"
        // Everything the server will actually store (ADR-0037). A picker that
        // hides a format the server accepts is a file somebody cannot choose and
        // cannot be told why — which looks like the upload being broken.
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.m4v,.webm,.mov,.mkv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void attachVideo(file);
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
            onInsertProtectedSection={() => void insertProtectedSection()}
            onInsertVideo={() => setVideoOpen(true)}
          />
          {/* Naming somebody in the text (ADR-0085). The same people the
              assignee picker offers, from the one request this surface already
              makes. */}
          <MentionMenu view={view} revision={revision} people={members} />
          {videoOpen && (
            <VideoDialog
              onUpload={() => {
                setVideoOpen(false);
                videoInputRef.current?.click();
              }}
              onLink={insertVideoLink}
              onClose={() => setVideoOpen(false)}
            />
          )}
          <BlockMenu view={view} revision={revision} members={members} />
          <TableToolbar view={view} revision={revision} />
          {/* No comment button for somebody who may only read: commenting
              requires edit rights until there is a role that separates them
              (ADR-0046). A JSX comment cannot sit among attributes, which is
              the second time this week I have tried to put one there. */}
          <SelectionToolbar
            view={view}
            revision={revision}
            {...(handle.canEdit ? { onComment } : {})}
          />
        </>
      )}
    </>
  );
}