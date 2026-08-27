/**
 * SONE — placeholders on empty blocks.
 *
 * An empty heading looks exactly like an empty paragraph, which made choosing a
 * block type feel as though nothing had happened: the type was applied to a new
 * empty block and there was no way to tell which line it was. The reported
 * symptom was having to hunt for the line that had become a heading.
 *
 * So the empty block holding the caret says what it is. Only that one: a
 * placeholder on every empty block turns a half-written page into a wall of grey
 * hints, which is the mistake this kind of feature usually makes.
 *
 * Implemented as a decoration carrying the text in an attribute, with CSS
 * drawing it through `content: attr(...)`. A widget would put a real element in
 * the flow, which the caret can end up behind and a copy can pick up.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const placeholderPluginKey = new PluginKey<DecorationSet>('sone-placeholders');

/**
 * What each block type says when empty.
 *
 * Phrased as what will be typed rather than as the type's name where that reads
 * better — "Heading 1" is a label, "List item" says what to do.
 */
const LABELS: Record<string, string> = {
  paragraph: 'Write something, or press / for blocks',
  bulletList: 'List item',
  numberedList: 'List item',
  todo: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Callout',
  code: 'Code',
};

function labelFor(typeName: string, attrs: Record<string, unknown>): string | null {
  if (typeName === 'heading') {
    const level = attrs['level'];
    return typeof level === 'number' ? `Heading ${level}` : 'Heading';
  }
  return LABELS[typeName] ?? null;
}

/**
 * The placeholder for the block holding the caret, and where it goes.
 *
 * Exported so the rule can be tested without reaching into a decoration's
 * internals — `Decoration.node` attributes are not readable from `spec`, which a
 * first draft of the test assumed and got an empty string back from.
 */
export function placeholderFor(
  state: EditorState,
): { label: string; pos: number; nodeSize: number } | null {
  const { selection } = state;

  // Only for a collapsed caret. During a selection the person is doing
  // something else, and a hint appearing mid-drag is a distraction.
  if (!selection.empty) return null;

  const $from = selection.$from;

  // The innermost block holding the caret.
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const attrs = node.type.spec.attrs;
    if (!attrs || !(BLOCK_ATTRS.id in attrs)) continue;

    if (node.content.size > 0) return null;

    const label = labelFor(node.type.name, node.attrs);
    if (!label) return null;

    return { label, pos: $from.before(depth), nodeSize: node.nodeSize };
  }

  return null;
}

function build(state: EditorState): DecorationSet {
  const found = placeholderFor(state);
  if (!found) return DecorationSet.empty;

  return DecorationSet.create(state.doc, [
    Decoration.node(found.pos, found.pos + found.nodeSize, {
      'data-placeholder': found.label,
      class: 'sone-has-placeholder',
    }),
  ]);
}

export function placeholders(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: placeholderPluginKey,
    state: {
      init: (_config, state) => build(state),
      // Rebuilt on every transaction, not only document changes: moving the
      // caret to a different empty block has to move the hint with it.
      apply: (_tr, _previous, _old, state) => build(state),
    },
    props: {
      decorations: (state) => placeholderPluginKey.getState(state),
    },
  });
}
