/**
 * SONE — the slash menu.
 *
 * Owns the *state* and the *commands*. It renders nothing: the menu's DOM lives
 * in `@sone/web`, because a menu is a piece of interface and this package must
 * stay free of any framework (ADR-0016).
 *
 * Four behaviours decide whether a slash menu feels right, and all four are
 * about when it should *not* appear or *not* stay open:
 *
 *   - It opens on `/` only at the start of a block or after whitespace. Typing
 *     a path like `src/index.ts`, or `and/or`, must not open a menu.
 *   - Arrow keys, Enter, Tab and Escape belong to the menu while it is open,
 *     and must not reach the document. Otherwise Enter both picks an item and
 *     splits the block.
 *   - A space with no matching item closes it. Someone typing "the plan is 50/50
 *     split" gets a menu on the slash, then keeps typing; without this rule it
 *     hangs around swallowing their Enter.
 *   - Moving the caret out of the query closes it.
 *
 * The selected index lives in plugin state rather than in the renderer, so the
 * keyboard handler and the menu cannot disagree about what is selected — which
 * is the classic bug in this kind of component.
 */

import { BLOCK_ATTRS } from '@sone/core';
import type { Node as PMNode } from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { schema } from './schema.js';
import { buildTable } from './tables.js';

/**
 * What choosing an item does.
 *
 * Described as data rather than as a command so the whole action fits in one
 * transaction. It used to be three dispatches — delete the query, split the
 * block, then run a command — and each one writes to Yjs and lets
 * y-prosemirror restore the selection from a relative position. Between them
 * the caret could end up several blocks away, which is what "I suddenly jump
 * some lines further into a text and cannot find the heading" was.
 *
 *   convert  — the block becomes this type, or a new block of it is added
 *   insert   — a node is placed (a divider, a table)
 *   external — the interface handles it, because it needs a file picker
 */
export type SlashAction =
  | { kind: 'convert'; type: string; attrs?: Record<string, unknown> }
  | { kind: 'insert'; build: () => PMNode | null }
  | { kind: 'external' };

export interface SlashItem {
  id: string;
  title: string;
  /** Shown under the title. Says what the block is for, not what it is called. */
  hint: string;
  /**
   * Extra terms that should match.
   *
   * People search for what they know a thing as: "h1", "ul", "checkbox",
   * "todo". Matching only the title would mean knowing SONE's vocabulary
   * before finding anything.
   */
  keywords: string[];
  group: 'text' | 'lists' | 'blocks';
  action: SlashAction;
}

const node = (name: string) => schema.nodes[name];

/** The items, in the order they are offered. */
export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: 'paragraph',
    title: 'Text',
    hint: 'Plain paragraph',
    keywords: ['text', 'paragraph', 'p', 'plain', 'body'],
    group: 'text',
    action: { kind: 'convert', type: 'paragraph' },
  },
  ...[1, 2, 3].map((level) => ({
    id: `heading-${level}`,
    title: `Heading ${level}`,
    hint: level === 1 ? 'Largest section title' : `Level ${level} section title`,
    keywords: [`h${level}`, 'heading', 'title', 'section', '#'.repeat(level)],
    group: 'text' as const,
    action: { kind: 'convert' as const, type: 'heading', attrs: { level } },
  })),
  {
    id: 'bulletList',
    title: 'Bulleted list',
    hint: 'An unordered list',
    keywords: ['bullet', 'list', 'ul', 'unordered', 'dash', 'point'],
    group: 'lists',
    action: { kind: 'convert', type: 'bulletList' },
  },
  {
    id: 'numberedList',
    title: 'Numbered list',
    hint: 'An ordered list',
    keywords: ['number', 'numbered', 'list', 'ol', 'ordered', '1.'],
    group: 'lists',
    action: { kind: 'convert', type: 'numberedList' },
  },
  {
    id: 'todo',
    title: 'To-do',
    hint: 'A checkable task',
    keywords: ['todo', 'task', 'check', 'checkbox', 'tick', 'done'],
    group: 'lists',
    action: { kind: 'convert', type: 'todo', attrs: { checked: false } },
  },
  {
    id: 'toggle',
    title: 'Toggle',
    hint: 'Collapsible section',
    keywords: ['toggle', 'collapse', 'details', 'fold', 'accordion'],
    group: 'lists',
    action: { kind: 'convert', type: 'toggle', attrs: { collapsed: false } },
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: 'Quoted passage',
    keywords: ['quote', 'blockquote', 'citation', 'cite'],
    group: 'blocks',
    action: { kind: 'convert', type: 'quote' },
  },
  {
    id: 'callout',
    title: 'Callout',
    hint: 'Highlighted note',
    keywords: ['callout', 'note', 'info', 'warning', 'aside', 'tip'],
    group: 'blocks',
    action: { kind: 'convert', type: 'callout' },
  },
  {
    id: 'code',
    title: 'Code',
    hint: 'Preformatted code block',
    keywords: ['code', 'snippet', 'pre', 'monospace', 'terminal'],
    group: 'blocks',
    action: { kind: 'convert', type: 'code' },
  },
  {
    id: 'image',
    title: 'Image',
    hint: 'Upload a picture',
    keywords: ['image', 'picture', 'photo', 'upload', 'file', 'img'],
    group: 'blocks',
    // A file picker needs a user gesture and a DOM element, neither of which a
    // transaction has. The interface handles this one.
    action: { kind: 'external' },
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'Rows and columns',
    keywords: ['table', 'grid', 'rows', 'columns', 'spreadsheet'],
    group: 'blocks',
    action: { kind: 'insert', build: () => buildTable({ rows: 3, columns: 3 }) },
  },
  {
    id: 'file',
    title: 'File',
    hint: 'A PDF, a document, a spreadsheet — shown here or offered to open',
    keywords: [
      'file',
      'document',
      'pdf',
      'word',
      'excel',
      'attachment',
      'upload',
      'datei',
      'dokument',
      'anhang',
    ],
    group: 'blocks',
    // External for the same reason the image is: a file picker needs a user
    // gesture and a DOM element, and a transaction has neither.
    action: { kind: 'external' },
  },
  {
    id: 'protected',
    title: 'Protected section',
    hint: 'A part of this page only the people you add can open',
    keywords: [
      'protected',
      'private',
      'secret',
      'restricted',
      'permission',
      'geschützt',
      'privat',
      'vertraulich',
    ],
    group: 'blocks',
    // External: creating one is a request to the server, which makes the
    // document before the block that refers to it exists. A transaction cannot
    // wait for that, and a block pointing at a container that failed to be
    // created would be a locked door with nothing behind it.
    action: { kind: 'external' },
  },
  {
    id: 'collection',
    title: 'Table of entries',
    hint: 'A collection: rows with columns, each row a page of its own',
    keywords: [
      'collection',
      'database',
      'grid',
      'board',
      'entries',
      'records',
      'list',
      'sammlung',
      'datenbank',
    ],
    group: 'blocks',
    // External for the same reason the image is: the collection has to be
    // created on the server before there is an id to put in the node, and a
    // transaction cannot wait for a request.
    //
    // Deliberately not called "Table": that is the simple grid above, and two
    // things called the same thing in one menu is a worse problem than a longer
    // name.
    action: { kind: 'external' },
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: 'Horizontal rule',
    keywords: ['divider', 'rule', 'hr', 'separator', 'line', '---'],
    group: 'blocks',
    action: {
      kind: 'insert',
      build: () => schema.nodes['divider']?.create() ?? null,
    },
  },
];

/**
 * Filter items by query.
 *
 * A prefix match on the title ranks above a prefix match on a keyword, which
 * ranks above a substring match anywhere. That ordering is what makes typing
 * "h1" land on Heading 1 rather than on whatever else happens to contain "h".
 *
 * Pure and exported so the ranking can be tested without an editor.
 */
export function filterSlashItems(
  query: string,
  items: readonly SlashItem[] = SLASH_ITEMS,
): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...items];

  const scored: Array<{ item: SlashItem; score: number }> = [];

  for (const item of items) {
    const title = item.title.toLowerCase();
    let score = -1;

    if (title.startsWith(needle)) score = 0;
    else if (item.keywords.some((k) => k.toLowerCase().startsWith(needle))) score = 1;
    else if (title.includes(needle)) score = 2;
    else if (item.keywords.some((k) => k.toLowerCase().includes(needle))) score = 3;

    if (score >= 0) scored.push({ item, score });
  }

  // Stable within a score band, so the declared order survives — otherwise the
  // menu reshuffles as someone types, and they lose their place.
  return scored
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

export interface SlashMenuState {
  /** Position of the `/` that opened the menu. */
  from: number;
  /** Text typed after the slash. */
  query: string;
  /** Index into the filtered list. */
  index: number;
  items: SlashItem[];
}

export const slashMenuPluginKey = new PluginKey<SlashMenuState | null>('sone-slash-menu');

/** Read the menu state, or null when closed. */
export const slashMenuState = (state: EditorState): SlashMenuState | null =>
  slashMenuPluginKey.getState(state) ?? null;

/**
 * May a slash at this position open the menu?
 *
 * Start of the block, or preceded by whitespace. Anything else is part of a
 * word — a path, a fraction, "and/or" — and opening a menu there is an
 * interruption rather than a help.
 */
function slashOpensMenu(state: EditorState, slashPos: number): boolean {
  const $slash = state.doc.resolve(slashPos);
  if ($slash.parentOffset === 0) return true;
  const before = state.doc.textBetween(slashPos - 1, slashPos);
  return /\s/.test(before);
}

/** The block containing the selection, if it is a SONE block. */
function inBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const attrs = $from.node(depth).type.spec.attrs;
    if (attrs && BLOCK_ATTRS.id in attrs) {
      // Never inside a code block: a slash there is code.
      return $from.node(depth).type.name !== 'code';
    }
  }
  return false;
}

interface SlashMeta {
  close?: true;
  move?: number;
  setIndex?: number;
}

export function slashMenu(): Plugin<SlashMenuState | null> {
  return new Plugin<SlashMenuState | null>({
    key: slashMenuPluginKey,

    state: {
      init: () => null,

      apply: (tr, previous, _oldState, newState) => {
        const meta = tr.getMeta(slashMenuPluginKey) as SlashMeta | undefined;
        if (meta?.close) return null;

        if (previous && meta?.move !== undefined) {
          const count = previous.items.length;
          if (count === 0) return previous;
          // Wraps, so holding Down does not stall at the bottom.
          const index = (previous.index + meta.move + count) % count;
          return { ...previous, index };
        }
        if (previous && meta?.setIndex !== undefined) {
          return { ...previous, index: meta.setIndex };
        }

        if (previous) {
          const from = tr.mapping.map(previous.from);
          const head = newState.selection.head;

          // The slash itself must still be there, and the caret must still be
          // after it. Either failing means the user has moved on.
          if (head < from + 1) return null;
          if (newState.doc.textBetween(from, from + 1) !== '/') return null;

          const query = newState.doc.textBetween(from + 1, head, '\n', '\uFFFC');
          // A newline means the block was split; the menu no longer applies.
          if (query.includes('\n')) return null;

          const items = filterSlashItems(query);

          // A space with nothing matching closes it. Without this, ordinary
          // prose containing a slash leaves a dead menu capturing Enter.
          if (items.length === 0 && /\s/.test(query)) return null;
          // A long run with no matches is not a query any more.
          if (items.length === 0 && query.length > 12) return null;

          return {
            from,
            query,
            items,
            // Clamped rather than reset: someone who has moved down two items
            // and types another character should stay near where they were.
            index: Math.min(previous.index, Math.max(0, items.length - 1)),
          };
        }

        // Opening. Requires a document change, so moving the caret next to an
        // existing slash does not open a menu.
        if (!tr.docChanged) return null;
        if (!inBlock(newState)) return null;

        const head = newState.selection.head;
        if (head < 1) return null;
        if (newState.doc.textBetween(head - 1, head) !== '/') return null;
        if (!slashOpensMenu(newState, head - 1)) return null;

        return { from: head - 1, query: '', index: 0, items: filterSlashItems('') };
      },
    },

    props: {
      /**
       * The menu owns these keys while it is open.
       *
       * Returning true stops them reaching the document, which is the whole
       * point: without it Enter would both pick an item and split the block.
       */
      handleKeyDown(view, event) {
        const state = slashMenuState(view.state);
        if (!state) return false;

        switch (event.key) {
          case 'ArrowDown':
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { move: 1 }));
            return true;
          case 'ArrowUp':
            view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { move: -1 }));
            return true;
          case 'Enter':
          case 'Tab': {
            const item = state.items[state.index];
            if (!item) return false;
            runSlashItem(view, item);
            return true;
          }
          case 'Escape':
            closeSlashMenu(view);
            return true;
          default:
            return false;
        }
      },
    },
  });
}

/**
 * The block containing the selection, as a position and node.
 *
 * Returns the outermost flat block, which is the one a slash command acts on.
 */
function blockAt(state: EditorState): { pos: number; node: PMNode; depth: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const attrs = node.type.spec.attrs;
    if (attrs && BLOCK_ATTRS.id in attrs) {
      return { pos: $from.before(depth), node, depth };
    }
  }
  return null;
}

/**
 * Open the menu without typing a slash.
 *
 * For the `+` button: requiring `/` means knowing the shortcut exists, and a
 * control someone can see beats one they have to be told about.
 *
 * One transaction. Splitting and then inserting as two dispatches gave
 * y-prosemirror an intermediate state to restore a relative selection against,
 * and the caret could come back somewhere else.
 */
export function openSlashMenu(view: EditorView): boolean {
  const block = blockAt(view.state);
  if (!block) return false;
  if (block.node.type.spec.code) return false;

  const tr = view.state.tr;
  const hasContent = block.node.textContent.trim().length > 0;

  if (hasContent) {
    // Split at the end of the block, so nothing is carried into the new one.
    const end = block.pos + block.node.nodeSize - 1;
    tr.setSelection(TextSelection.near(tr.doc.resolve(end)));
    tr.split(tr.selection.from, 1, [
      { type: block.node.type, attrs: { ...block.node.attrs, [BLOCK_ATTRS.id]: null } },
    ]);
  }

  tr.insertText('/', tr.selection.from);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Close the menu, leaving the typed text alone. */
export function closeSlashMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { close: true }));
}

/** Highlight an item, for mouse hover. */
export function setSlashIndex(view: EditorView, index: number): void {
  view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { setIndex: index }));
}

/**
 * Apply an item, in a single transaction.
 *
 * Three dispatches used to do this — delete the query, split the block, run a
 * command — and each one writes to Yjs and lets y-prosemirror restore the
 * selection from a relative position captured against the previous state. The
 * caret could end up several blocks away, which is what "I suddenly jump some
 * lines further into a text and cannot find the heading" was.
 *
 * The convert case also no longer creates a paragraph and then changes its
 * type: the split names the target type directly, so the block is never briefly
 * something else.
 *
 * Returns false for an `external` item, which the interface handles.
 */
export function runSlashItem(view: EditorView, item: SlashItem): boolean {
  const state = slashMenuState(view.state);
  if (!state) return false;
  if (item.action.kind === 'external') return false;

  const tr = view.state.tr;
  tr.setMeta(slashMenuPluginKey, { close: true });

  // The slash and the query, gone first so "has content" means text the person
  // wrote rather than the command they just typed.
  tr.delete(state.from, view.state.selection.head);

  const block = blockAt(
    // A cheap way to resolve the block against the post-delete document without
    // applying the transaction: positions after a delete at the caret are
    // unchanged for the block itself.
    { ...view.state, doc: tr.doc, selection: tr.selection } as EditorState,
  );
  if (!block) return false;

  const hasContent = block.node.textContent.trim().length > 0;

  if (item.action.kind === 'insert') {
    const node = item.action.build();
    if (!node) return false;
    if (hasContent) {
      // After the block, leaving the writing alone.
      tr.insert(block.pos + block.node.nodeSize, node);
    } else {
      tr.replaceWith(block.pos, block.pos + block.node.nodeSize, node);
    }
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return true;
  }

  const targetType = schema.nodes[item.action.type];
  if (!targetType) return false;
  const attrs = {
    ...block.node.attrs,
    ...(item.action.attrs ?? {}),
    // A new block gets its own id from the plugin; a converted one keeps its.
    ...(hasContent ? { [BLOCK_ATTRS.id]: null } : {}),
  };

  if (hasContent) {
    // Split straight into the target type: the new block is never briefly a
    // paragraph that then changes.
    const end = block.pos + block.node.nodeSize - 1;
    tr.setSelection(TextSelection.near(tr.doc.resolve(end)));
    tr.split(tr.selection.from, 1, [{ type: targetType, attrs }]);
  } else {
    tr.setNodeMarkup(block.pos, targetType, attrs);
    tr.setSelection(TextSelection.near(tr.doc.resolve(block.pos + 1)));
  }

  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Exported so tests can drive the plugin without a view. */
export function slashCloseTransaction(state: EditorState): Transaction {
  return state.tr.setMeta(slashMenuPluginKey, { close: true });
}
