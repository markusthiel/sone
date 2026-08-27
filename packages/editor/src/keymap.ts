/**
 * SONE — keymap.
 *
 * The keys that decide whether a block editor feels right. Four of them do most
 * of the work and each has a non-obvious correct behaviour:
 *
 *   Enter        splits the block, and a *second* Enter in an empty list item
 *                lifts it out rather than creating another empty item. Without
 *                that, leaving a list means reaching for the mouse.
 *   Tab          indents by nesting inside the previous sibling. Only valid
 *                when there *is* a previous sibling of a container type —
 *                indenting the first item of a list has no meaning.
 *   Shift-Tab    outdents by lifting into the grandparent.
 *   Backspace    at the start of a block converts it to a paragraph before
 *                merging, so backspacing out of a heading gives plain text
 *                rather than swallowing the previous block.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { NodeType } from 'prosemirror-model';
import {
  baseKeymap,
  chainCommands,
  createParagraphNear,
  deleteSelection,
  joinBackward,
  liftEmptyBlock,
  newlineInCode,
  selectNodeBackward,
  setBlockType,
  splitBlock,
  toggleMark,
} from 'prosemirror-commands';
import { Fragment, Slice } from 'prosemirror-model';
import type { Command, EditorState, Plugin } from 'prosemirror-state';

import {
  duplicateBlockSubtree,
  indentBlockSubtree,
  moveBlockDown,
  moveBlockUp,
  outdentBlockSubtree,
} from './blockOps.js';
import { toggleCollapsed } from './collapse.js';
import { canLink, selectLink } from './links.js';
import { readIndent, schema, writeIndent } from './schema.js';

/**
 * The block containing the selection head, with its position and depth.
 *
 * Walks outwards from the selection rather than assuming depth 1: a block may
 * be nested inside a container, and the innermost node carrying block
 * attributes is the one the user is editing.
 */
function currentBlock(
  state: EditorState,
): { node: import('prosemirror-model').Node; depth: number; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.spec.attrs && BLOCK_ATTRS.id in node.type.spec.attrs) {
      return { node, depth, pos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * Enter in an empty container block lifts it out instead of splitting.
 *
 * The behaviour people expect from every list they have ever used: Enter on an
 * empty bullet ends the list. Without it, the only way out is Backspace or the
 * mouse.
 */
const exitEmptyContainer: Command = (state, dispatch) => {
  const block = currentBlock(state);
  if (!block) return false;
  if (block.node.type.name === 'paragraph') return false;
  if (block.node.textContent.length > 0) return false;

  const indent = readIndent(block.node.attrs);

  // Indented: step out one level first. Repeated Enter then walks out of a
  // nested list one level at a time, which is what people expect.
  if (indent > 0) {
    if (dispatch) {
      dispatch(
        state.tr
          .setNodeAttribute(block.pos, BLOCK_ATTRS.indent, writeIndent(indent - 1))
          .scrollIntoView(),
      );
    }
    return true;
  }

  const paragraph = schema.nodes['paragraph'];
  if (!paragraph) return false;

  if (dispatch) {
    dispatch(
      state.tr
        .setNodeMarkup(block.pos, paragraph, {
          // The id is kept: this is the same block changing type, and a new id
          // would orphan every reference to it.
          [BLOCK_ATTRS.id]: block.node.attrs[BLOCK_ATTRS.id],
          [BLOCK_ATTRS.props]: null,
          [BLOCK_ATTRS.indent]: null,
        })
        .scrollIntoView(),
    );
  }
  return true;
};

/**
 * Indent and outdent, taking the block's indented children with it.
 *
 * Delegated to blockOps rather than implemented here. The version that lived in
 * this file shifted only the selected block, which turned its children into its
 * siblings — quietly, with nothing throwing and nothing looking wrong. That
 * shipped. See src/blockOps.ts.
 */
const indentBlock: Command = indentBlockSubtree;
const outdentBlock: Command = outdentBlockSubtree;

/**
 * Block types that continue when Enter is pressed.
 *
 * A heading is deliberately absent: Enter after a heading should start body
 * text, not another heading, which is what every editor does and what people
 * expect. Code has its own handler.
 */
const CONTINUING = new Set([
  'bulletList',
  'numberedList',
  'todo',
  'quote',
  'callout',
]);

/**
 * Attributes that must not be inherited by the next item.
 *
 * A new to-do after a completed one must not arrive already ticked, and a new
 * toggle must not arrive collapsed. Both would be actively wrong rather than
 * merely surprising.
 */
const RESET_ON_SPLIT: Record<string, unknown> = {
  checked: false,
  collapsed: false,
};

/**
 * Enter inside a list, to-do, quote or callout continues with another of the
 * same, at the same indent.
 *
 * The id is cleared rather than copied: block ids are globally unique because
 * the projection keys on them, so two blocks sharing one would have the second
 * overwrite the first. The blockIds plugin assigns a fresh one on the next
 * transaction.
 */
const continueSameBlock: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const spec = node.type.spec.attrs;
    if (!spec || !(BLOCK_ATTRS.id in spec)) continue;

    if (!CONTINUING.has(node.type.name)) return false;
    // An empty item is handled by exitEmptyContainer, which runs first: Enter
    // there leaves the list rather than adding another empty row.
    if (node.content.size === 0) return false;

    if (dispatch) {
      const attrs: Record<string, unknown> = { ...node.attrs, [BLOCK_ATTRS.id]: null };
      for (const [key, value] of Object.entries(RESET_ON_SPLIT)) {
        if (key in node.attrs) attrs[key] = value;
      }

      dispatch(
        state.tr
          .split($from.pos, 1, [{ type: node.type, attrs }])
          .scrollIntoView(),
      );
    }
    return true;
  }

  return false;
};

/**
 * Backspace at the start of a non-paragraph block turns it into a paragraph.
 *
 * Tried before the default join, so backspacing at the start of a heading gives
 * plain text rather than merging it into whatever came before. Merging is still
 * what a second Backspace does, which matches every editor people are used to.
 */
const paragraphBeforeJoin: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;

  const block = currentBlock(state);
  if (!block) return false;

  const indent = readIndent(block.node.attrs);
  // Indented blocks outdent first, so Backspace at the start of a nested item
  // walks it out rather than merging it into its parent's text.
  if (indent > 0) {
    if (dispatch) {
      dispatch(
        state.tr.setNodeAttribute(
          block.pos,
          BLOCK_ATTRS.indent,
          writeIndent(indent - 1),
        ),
      );
    }
    return true;
  }

  if (block.node.type.name === 'paragraph') return false;

  const paragraph = schema.nodes['paragraph'];
  if (!paragraph) return false;

  if (dispatch) {
    dispatch(
      state.tr.setNodeMarkup(block.pos, paragraph, {
        [BLOCK_ATTRS.id]: block.node.attrs[BLOCK_ATTRS.id],
        [BLOCK_ATTRS.props]: null,
        [BLOCK_ATTRS.indent]: null,
      }),
    );
  }
  return true;
};

/** Toggle a block between a type and paragraph. Used by menus and shortcuts. */
export function toggleBlockType(
  type: NodeType,
  attrs: Record<string, unknown> = {},
): Command {
  return (state, dispatch) => {
    const block = currentBlock(state);
    const paragraph = schema.nodes['paragraph'];
    if (!block || !paragraph) return false;

    const alreadyThisType =
      block.node.type === type &&
      Object.entries(attrs).every(([key, value]) => block.node.attrs[key] === value);

    const target = alreadyThisType ? paragraph : type;
    // Indent is preserved across a type change: converting an indented bullet
    // to a heading should keep it where it sits, not jump it to the margin.
    const preserved = {
      [BLOCK_ATTRS.id]: block.node.attrs[BLOCK_ATTRS.id],
      [BLOCK_ATTRS.props]: null,
      [BLOCK_ATTRS.indent]: block.node.attrs[BLOCK_ATTRS.indent],
    };
    const nextAttrs = alreadyThisType ? preserved : { ...attrs, ...preserved };

    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(block.pos, target, nextAttrs).scrollIntoView());
    }
    return true;
  };
}

/** Toggle a todo's checked state without moving the caret. */
export const toggleTodo: Command = (state, dispatch) => {
  const block = currentBlock(state);
  if (!block || block.node.type.name !== 'todo') return false;
  if (dispatch) {
    dispatch(
      state.tr.setNodeAttribute(
        block.pos,
        'checked',
        block.node.attrs['checked'] !== true,
      ),
    );
  }
  return true;
};

/** Insert a divider followed by an empty paragraph to type into. */
export const insertDivider: Command = (state, dispatch) => {
  const divider = schema.nodes['divider'];
  const paragraph = schema.nodes['paragraph'];
  if (!divider || !paragraph) return false;
  if (dispatch) {
    const tr = state.tr.replaceSelection(
      new Slice(Fragment.from([divider.create(), paragraph.create()]), 0, 0),
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Exposed for tests and for menu items that need the same behaviour. */
export const indentCommand = (): Command => indentBlock;
export const outdentCommand = (): Command => outdentBlock;

export function soneKeymap(): Plugin[] {
  const heading = schema.nodes['heading'];
  const bullet = schema.nodes['bulletList'];
  const numbered = schema.nodes['numberedList'];
  const todo = schema.nodes['todo'];
  const code = schema.nodes['code'];
  const quote = schema.nodes['quote'];

  const bindings: Record<string, Command> = {
    // Order matters: exiting an empty container is tried before splitting, or
    // Enter on an empty bullet would create another empty bullet forever.
    Enter: chainCommands(
      newlineInCode,
      exitEmptyContainer,
      // Before splitBlock, which is why this exists at all: ProseMirror's
      // splitBlock creates a block of the parent's *default* type, so Enter at
      // the end of a to-do produced a paragraph. Pressing Enter to add the next
      // item in a list is the single most common keystroke in a notes app.
      continueSameBlock,
      liftEmptyBlock,
      splitBlock,
    ),

    // A hard line break inside a block, for the cases where a new block is
    // not wanted.
    'Shift-Enter': (state, dispatch) => {
      if (dispatch) {
        dispatch(state.tr.insertText('\n').scrollIntoView());
      }
      return true;
    },

    Tab: indentBlock,
    'Shift-Tab': outdentBlock,

    Backspace: chainCommands(
      deleteSelection,
      paragraphBeforeJoin,
      joinBackward,
      selectNodeBackward,
    ),

    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,

    'Mod-b': toggleMark(schema.marks['strong']!),
    'Mod-i': toggleMark(schema.marks['em']!),
    'Mod-Shift-x': toggleMark(schema.marks['strikethrough']!),
    'Mod-e': toggleMark(schema.marks['inlineCode']!),

    // Mod-K is the link shortcut everywhere, so it must not fall through to the
    // browser's search bar. It only selects the link — the interface opens an
    // editor for it, because a URL cannot be typed into a keymap.
    'Mod-k': (state, dispatch) => {
      if (!canLink(state)) return false;
      // Returns true even without dispatching, so the key is consumed and the
      // interface can react to the selection it leaves behind.
      selectLink(state, dispatch);
      return true;
    },

    'Mod-Enter': toggleTodo,
    'Mod-Shift-Minus': insertDivider,
    // Collapse or expand the toggle the caret is in. Mod-. because it is free
    // on every platform and adjacent to nothing destructive.
    'Mod-.': toggleCollapsed,

    // Reordering. Alt rather than Mod, because Mod-Shift-Up is a text selection
    // shortcut on every platform and taking it away would be worse than not
    // offering this.
    'Alt-Shift-ArrowUp': moveBlockUp,
    'Alt-Shift-ArrowDown': moveBlockDown,
    'Mod-d': duplicateBlockSubtree,
  };

  if (heading) {
    // Mod-Alt-1..3 rather than Mod-1..3, which browsers use for tab switching.
    for (const level of [1, 2, 3, 4, 5, 6]) {
      bindings[`Mod-Alt-${level}`] = toggleBlockType(heading, { level });
    }
  }
  if (bullet) bindings['Mod-Shift-8'] = toggleBlockType(bullet);
  if (numbered) bindings['Mod-Shift-7'] = toggleBlockType(numbered);
  if (todo) bindings['Mod-Shift-9'] = toggleBlockType(todo);
  if (quote) bindings['Mod-Shift-b'] = toggleBlockType(quote);
  if (code) bindings['Mod-Shift-c'] = toggleBlockType(code);

  const paragraph = schema.nodes['paragraph'];
  if (paragraph) {
    bindings['Mod-Alt-0'] = setBlockType(paragraph);
  }

  return [
    keymap(bindings),
    // Base keymap last, so the bindings above win where they overlap.
    keymap(baseKeymap),
  ];
}

export { createParagraphNear };
