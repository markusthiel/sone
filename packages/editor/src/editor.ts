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

import type { Awareness } from 'y-protocols/awareness';
import { EditorState, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  prosemirrorToYXmlFragment,
  redo as yRedo,
  undo as yUndo,
  yCursorPlugin,
  ySyncPlugin,
  yUndoPlugin,
  yXmlFragmentToProsemirrorJSON,
} from 'y-prosemirror';
import { keymap } from 'prosemirror-keymap';
import type * as Y from 'yjs';

import { blockIds, type IdGenerator } from './blockIds.js';
import { soneInputRules } from './inputRules.js';
import { soneKeymap } from './keymap.js';
import { schema } from './schema.js';

export interface EditorOptions {
  /** The page body fragment. See pageContent() in @sone/core. */
  fragment: Y.XmlFragment;
  /** Presence, for remote cursors. Omit for a solo editor. */
  awareness?: Awareness;
  /** False renders the document without allowing edits. */
  editable?: boolean;
  /** Injected in tests so ids are deterministic. */
  generateId?: IdGenerator;
  /** Node views for atoms that mount their own renderer, e.g. collectionView. */
  nodeViews?: EditorView['props']['nodeViews'];
  onChange?: (state: EditorState) => void;
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
    ...soneKeymap(),
    blockIds(opts.generateId ? { generateId: opts.generateId } : {}),
  );

  return EditorState.create({ schema, plugins });
}

export function createEditor(
  mount: HTMLElement,
  opts: EditorOptions,
): EditorView {
  const view = new EditorView(mount, {
    state: createEditorState(opts),
    editable: () => opts.editable !== false,
    ...(opts.nodeViews ? { nodeViews: opts.nodeViews } : {}),
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      view.updateState(next);
      if (transaction.docChanged) opts.onChange?.(next);
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
export { soneInputRules, INPUT_RULE_HELP } from './inputRules.js';
