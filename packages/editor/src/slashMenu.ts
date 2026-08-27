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
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { splitBlock } from 'prosemirror-commands';

import { insertDivider, toggleBlockType } from './keymap.js';
import { insertTable } from './tables.js';
import { schema } from './schema.js';

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
  run: Command;
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
    run: (state, dispatch) => {
      const paragraph = node('paragraph');
      return paragraph ? toggleBlockType(paragraph)(state, dispatch) : false;
    },
  },
  ...[1, 2, 3].map((level) => ({
    id: `heading-${level}`,
    title: `Heading ${level}`,
    hint: level === 1 ? 'Largest section title' : `Level ${level} section title`,
    keywords: [`h${level}`, 'heading', 'title', 'section', `#`.repeat(level)],
    group: 'text' as const,
    run: ((state, dispatch) => {
      const heading = node('heading');
      return heading ? toggleBlockType(heading, { level })(state, dispatch) : false;
    }) as Command,
  })),
  {
    id: 'bulletList',
    title: 'Bulleted list',
    hint: 'An unordered list',
    keywords: ['bullet', 'list', 'ul', 'unordered', 'dash', 'point'],
    group: 'lists',
    run: (state, dispatch) => {
      const type = node('bulletList');
      return type ? toggleBlockType(type)(state, dispatch) : false;
    },
  },
  {
    id: 'numberedList',
    title: 'Numbered list',
    hint: 'An ordered list',
    keywords: ['number', 'numbered', 'list', 'ol', 'ordered', '1.'],
    group: 'lists',
    run: (state, dispatch) => {
      const type = node('numberedList');
      return type ? toggleBlockType(type)(state, dispatch) : false;
    },
  },
  {
    id: 'todo',
    title: 'To-do',
    hint: 'A checkable task',
    keywords: ['todo', 'task', 'check', 'checkbox', 'tick', 'done'],
    group: 'lists',
    run: (state, dispatch) => {
      const type = node('todo');
      return type ? toggleBlockType(type, { checked: false })(state, dispatch) : false;
    },
  },
  {
    id: 'toggle',
    title: 'Toggle',
    hint: 'Collapsible section',
    keywords: ['toggle', 'collapse', 'details', 'fold', 'accordion'],
    group: 'lists',
    run: (state, dispatch) => {
      const type = node('toggle');
      return type ? toggleBlockType(type, { collapsed: false })(state, dispatch) : false;
    },
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: 'Quoted passage',
    keywords: ['quote', 'blockquote', 'citation', 'cite'],
    group: 'blocks',
    run: (state, dispatch) => {
      const type = node('quote');
      return type ? toggleBlockType(type)(state, dispatch) : false;
    },
  },
  {
    id: 'callout',
    title: 'Callout',
    hint: 'Highlighted note',
    keywords: ['callout', 'note', 'info', 'warning', 'aside', 'tip'],
    group: 'blocks',
    run: (state, dispatch) => {
      const type = node('callout');
      return type ? toggleBlockType(type)(state, dispatch) : false;
    },
  },
  {
    id: 'code',
    title: 'Code',
    hint: 'Preformatted code block',
    keywords: ['code', 'snippet', 'pre', 'monospace', 'terminal'],
    group: 'blocks',
    run: (state, dispatch) => {
      const type = node('code');
      return type ? toggleBlockType(type)(state, dispatch) : false;
    },
  },
  {
    id: 'table',
    title: 'Table',
    hint: 'Rows and columns',
    keywords: ['table', 'grid', 'rows', 'columns', 'spreadsheet'],
    group: 'blocks',
    run: insertTable({ rows: 3, columns: 3, headerRow: true }),
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: 'Horizontal rule',
    keywords: ['divider', 'rule', 'hr', 'separator', 'line', '---'],
    group: 'blocks',
    run: insertDivider,
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

/** Close the menu, leaving the typed text alone. */
export function closeSlashMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { close: true }));
}

/** Highlight an item, for mouse hover. */
export function setSlashIndex(view: EditorView, index: number): void {
  view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { setIndex: index }));
}

/**
 * Apply an item.
 *
 * The slash and the query are deleted first, in the same transaction that
 * closes the menu, so an undo returns to the typed text rather than to a state
 * with a stale menu. The item's own command then runs on the resulting state —
 * separately, because a block type change and a text deletion are different
 * edits and merging them makes the deletion undoable only together with the
 * conversion.
 *
 * ## Convert in place, or insert a new block
 *
 * This is the part that was wrong. The commands convert the *current* block, so
 * typing text and then reaching for `/heading` turned the paragraph that text
 * was in into a heading — the writing became the heading and no new block
 * appeared. From the outside the heading looks like it went somewhere else
 * entirely.
 *
 * So: an empty block is converted, and a block with content gets a new block
 * after it. That is what Notion does and what the gesture means — in an empty
 * block `/` says "this block is a heading", after text it says "add a heading
 * here".
 *
 * When the caret is not at the end, the split carries the trailing text into the
 * new block, which is the same thing Enter does at that position. Consistency
 * with Enter is worth more than a special case, and typing `/` mid-sentence is
 * not a thing people do on purpose.
 */
export function runSlashItem(view: EditorView, item: SlashItem): boolean {
  const state = slashMenuState(view.state);
  if (!state) return false;

  const tr = view.state.tr.delete(state.from, view.state.selection.head);
  tr.setMeta(slashMenuPluginKey, { close: true });
  view.dispatch(tr);

  if (blockHasContent(view.state)) {
    // A new block for the new thing, leaving the writing alone.
    splitBlock(view.state, view.dispatch);
  }

  const applied = item.run(view.state, view.dispatch);
  view.focus();
  return applied;
}

/**
 * Does the block containing the selection have text of its own?
 *
 * Checked after the slash and query have been removed, so "content" means text
 * the person wrote rather than the command they just typed.
 */
function blockHasContent(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const attrs = node.type.spec.attrs;
    if (attrs && BLOCK_ATTRS.id in attrs) {
      return node.textContent.trim().length > 0;
    }
  }
  return false;
}

/** Exported so tests can drive the plugin without a view. */
export function slashCloseTransaction(state: EditorState): Transaction {
  return state.tr.setMeta(slashMenuPluginKey, { close: true });
}
