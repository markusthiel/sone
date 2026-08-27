/**
 * SONE — editor construction.
 *
 * Binds a ProseMirror editor to a page's Y.XmlFragment through y-prosemirror.
 * One editor per page, one fragment per page (ADR-0015), which is what makes
 * selection across blocks, a single undo stack and drag between blocks work at
 * all.
 *
 * The undo plugin is y-prosemirror's, not prosemirror-history's: in a
 * collaborative document, undo must revert *this user's* last change rather
 * than the document's, and prosemirror-history has no notion of authorship.
 * Using the wrong one means undo occasionally reverts a colleague's edit, which
 * is the kind of bug that destroys trust in an editor.
 */

import { BLOCK_ATTRS } from '@sone/core';
import type { Awareness } from 'y-protocols/awareness';
import { EditorState, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  prosemirrorToYXmlFragment,
  redo as yRedo,
  undo as yUndo,
  yCursorPlugin,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
  yXmlFragmentToProsemirrorJSON,
} from 'y-prosemirror';
import { keymap } from 'prosemirror-keymap';
import { XmlElement as YXmlElement } from 'yjs';
import type * as Y from 'yjs';

import { blockIds, type IdGenerator } from './blockIds.js';
import { soneInputRules } from './inputRules.js';
import { soneKeymap } from './keymap.js';
import { listNumbers } from './listNumbers.js';
import { imagePaste, type ImageUploader } from './imagePaste.js';
import { markdownPaste } from './markdownPaste.js';
import { schema } from './schema.js';
import { slashMenu } from './slashMenu.js';
import { tableKeymap, tablePlugins } from './tables.js';

export interface EditorOptions {
  /** The page body fragment. See pageContent() in @sone/core. */
  fragment: Y.XmlFragment;
  /** Presence, for remote cursors. Omit for a solo editor. */
  awareness?: Awareness;
  /**
   * Whether the document may be edited.
   *
   * A function, not a boolean: a role can change while the document is open
   * (the server sends RoleChanged rather than disconnecting), and ProseMirror
   * calls this on every state change, so a live read keeps the editor in step
   * without recreating it.
   */
  editable?: () => boolean;
  /** Injected in tests so ids are deterministic. */
  generateId?: IdGenerator;
  /** Node views for atoms that mount their own renderer, e.g. collectionView. */
  nodeViews?: EditorView['props']['nodeViews'];
  /**
   * A change made *here*.
   *
   * Not called for changes arriving from Yjs, which includes the initial
   * population of the document when the editor mounts. Without that
   * distinction a consumer using this to track unsaved work would mark every
   * freshly opened page as edited before anyone touched it.
   */
  /**
   * Uploads an image and returns its URL.
   *
   * Injected because this package must not know about HTTP endpoints
   * (ADR-0016). Omitted means pasting an image does nothing, which is the right
   * behaviour for a read-only surface.
   */
  uploadImage?: ImageUploader;
  onChange?: (state: EditorState) => void;
  /**
   * Called after every transaction, not only document changes.
   *
   * The slash menu opens, filters and closes without the document changing, so
   * a renderer watching only `onChange` would never see it.
   */
  onStateChange?: (state: EditorState) => void;
}

export function createEditorState(opts: EditorOptions): EditorState {
  const plugins: Plugin[] = [
    ySyncPlugin(opts.fragment),
  ];

  if (opts.awareness) {
    plugins.push(yCursorPlugin(opts.awareness));
  }

  plugins.push(
    yUndoPlugin(),
    // Bound here rather than in soneKeymap, because these are the Yjs-aware
    // versions and soneKeymap must stay usable without a Yjs document (tests,
    // and any future non-collaborative surface).
    keymap({
      'Mod-z': yUndo,
      'Mod-y': yRedo,
      'Shift-Mod-z': yRedo,
    }),
    soneInputRules(),
    // Before soneKeymap, so Tab moves between cells inside a table instead of
    // indenting the paragraph in a cell. Outside a table goToNextCell refuses
    // and the block binding takes over.
    keymap(tableKeymap),
    ...soneKeymap(),
    blockIds(opts.generateId ? { generateId: opts.generateId } : {}),
    listNumbers(),
    ...tablePlugins(),
    markdownPaste(),
    // After markdownPaste: a paste carrying both files and text is an image
    // paste, and the text is usually the filename.
    ...(opts.uploadImage
      ? [imagePaste({ upload: opts.uploadImage, ...(opts.generateId ? { generateId: opts.generateId } : {}) })]
      : []),
    // After the keymap, so the menu's handleKeyDown sees Enter and the arrows
    // first while it is open. ProseMirror asks plugins in order and stops at
    // the first that handles a key; the other way round, Enter would split the
    // block instead of picking an item.
    slashMenu(),
  );

  return EditorState.create({ schema, plugins });
}

/**
 * Give an empty page one empty paragraph to type into.
 *
 * A fresh Y.XmlFragment is empty, but the ProseMirror schema requires `block+`
 * — so binding an editor to it yields an invalid document. y-prosemirror does
 * not seed one for you.
 *
 * Only the first client to open a page needs to do this, and doing it in a Yjs
 * transaction means two clients racing converge on one or two empty
 * paragraphs rather than a corrupt document. Two is harmless and the second
 * disappears on the next edit; a missing one prevents typing at all.
 */
export function seedEmptyPage(
  fragment: Y.XmlFragment,
  generateId: IdGenerator = () => {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(16)}`;
  },
): boolean {
  if (fragment.length > 0) return false;

  const doc = fragment.doc;
  const insert = (): void => {
    const paragraph = new YXmlElement('paragraph');
    paragraph.setAttribute(BLOCK_ATTRS.id, generateId());
    fragment.insert(0, [paragraph]);
  };

  if (doc) doc.transact(insert);
  else insert();
  return true;
}

export function createEditor(
  mount: HTMLElement,
  opts: EditorOptions,
): EditorView {
  const view = new EditorView(mount, {
    state: createEditorState(opts),
    editable: () => opts.editable?.() !== false,
    ...(opts.nodeViews ? { nodeViews: opts.nodeViews } : {}),

    /**
     * `this`, not the `view` const.
     *
     * ySyncPlugin dispatches a transaction from inside the EditorView
     * constructor, to populate the document from the Yjs fragment — before the
     * assignment to `view` below has happened. Referencing `view` there throws
     * "Cannot access 'view' before initialization", the editor never mounts,
     * and React unmounts the tree: a white page on every page open.
     *
     * ProseMirror binds `this` to the view for this callback, including during
     * construction, which is the only reference available at that moment.
     * Verified rather than assumed.
     */
    dispatchTransaction(this: EditorView, transaction) {
      const next = this.state.apply(transaction);
      this.updateState(next);

      // Transactions produced by the Yjs binding carry its plugin key as meta.
      // That covers both remote edits and the initial population at mount, and
      // neither is a change the local user made.
      const fromYjs = transaction.getMeta(ySyncPluginKey) !== undefined;
      if (transaction.docChanged && !fromYjs) opts.onChange?.(next);

      opts.onStateChange?.(next);
    },
    attributes: {
      // Spellcheck on, autocorrect off: a notes app contains a lot of
      // deliberate non-words — identifiers, names, abbreviations — and
      // autocorrect mangling them is worse than a red squiggle.
      spellcheck: 'true',
      autocorrect: 'off',
      autocapitalize: 'sentences',
      class: 'sone-editor',
      role: 'textbox',
      'aria-multiline': 'true',
    },
  });

  return view;
}

/**
 * Read a Yjs fragment as ProseMirror JSON, without an editor.
 *
 * Used for server-side rendering and for tests that assert on document
 * structure. Note this does not run the block id plugin, so a fragment written
 * by something other than the editor may contain blocks without ids.
 */
export function fragmentToJSON(fragment: Y.XmlFragment): unknown {
  return yXmlFragmentToProsemirrorJSON(fragment);
}

/**
 * Write a ProseMirror document into a Yjs fragment.
 *
 * Used by importers and when seeding a page. Destructive: it replaces the
 * fragment's contents, so it must not be called on a fragment an editor is
 * bound to.
 */
export function jsonToFragment(
  doc: Parameters<typeof prosemirrorToYXmlFragment>[0],
  fragment: Y.XmlFragment,
): Y.XmlFragment {
  return prosemirrorToYXmlFragment(doc, fragment);
}

export { schema } from './schema.js';
export { readProps, writeProps, BLOCK_TYPE_ORDER } from './schema.js';
export { blockIds, assignMissingIds, collectBlockIds } from './blockIds.js';
export { soneKeymap, toggleBlockType, toggleTodo, insertDivider } from './keymap.js';
export {
  blockRangeAt,
  deleteBlockSubtree,
  duplicateBlockSubtree,
  indentBlockSubtree,
  moveBlockDown,
  moveBlockUp,
  outdentBlockSubtree,
  selectedBlockRange,
  subtreeSize,
  type BlockRange,
} from './blockOps.js';
export { soneInputRules, INPUT_RULE_HELP } from './inputRules.js';
export { listNumbers, computeListNumbers } from './listNumbers.js';
export {
  TABLE_ACTIONS,
  buildTable,
  insertTable,
  isInTable,
  tablePlugins,
  type TableAction,
  type CreateTableOptions,
} from './tables.js';
export {
  imagePaste,
  insertImageUpload,
  type ImageUploader,
  type UploadedImage,
} from './imagePaste.js';
export {
  looksLikeMarkdown,
  markdownPaste,
  markdownToSlice,
  parseInline,
  parseMarkdownBlocks,
} from './markdownPaste.js';
export {
  canLink,
  linkAt,
  normaliseHref,
  removeLink,
  selectLink,
  setLink,
  type LinkRange,
} from './links.js';
export {
  SLASH_ITEMS,
  closeSlashMenu,
  openSlashMenu,
  filterSlashItems,
  runSlashItem,
  setSlashIndex,
  slashMenu,
  slashMenuPluginKey,
  slashMenuState,
  type SlashItem,
  type SlashMenuState,
} from './slashMenu.js';
