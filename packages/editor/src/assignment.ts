/**
 * SONE editor — assigning a task (ADR-0052's third kind).
 *
 * `assignee` in a task block's props, alongside `locked` (ADR-0049): a person's
 * id, so it survives a rename and does not match the wrong person when two
 * share a name.
 *
 * Only a task can carry one. A paragraph assigned to somebody is a note about
 * them rather than work, and offering it everywhere would make the notification
 * mean less each time it arrives.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { BLOCK_ATTRS } from '@sone/core';

import { readProps, writeProps } from './schema.js';

export const assignmentKey = new PluginKey('sone-assignment');

/** Who a block is assigned to, if anybody. */
export function readAssignee(node: PMNode): string | null {
  const who = readProps(node.attrs as Record<string, unknown>)['assignee'];
  return typeof who === 'string' && who !== '' ? who : null;
}

/** Assign the task the selection is in, or clear it. */
export function setAssignee(userId: string | null): Command {
  return (state, dispatch) => {
    const { from } = state.selection;
    const $pos = state.doc.resolve(from);

    // The nearest task around the caret, rather than whatever block it is in:
    // the command is offered from a task's own menu, and walking up is what
    // makes it work inside a task that holds a list.
    let depth = $pos.depth;
    while (depth > 0 && $pos.node(depth).type.name !== 'todo') depth -= 1;
    if (depth === 0) return false;

    const node = $pos.node(depth);
    if (!dispatch) return true;

    const props = readProps(node.attrs as Record<string, unknown>);
    // Deleted rather than set to empty, like every other optional property.
    if (userId) props['assignee'] = userId;
    else delete props['assignee'];

    dispatch(
      state.tr.setNodeMarkup($pos.before(depth), undefined, {
        ...node.attrs,
        [BLOCK_ATTRS.props]: writeProps(props),
      }),
    );
    return true;
  };
}

/**
 * Draw whose task it is.
 *
 * A widget at the end of the line rather than a decoration on the text: the
 * name is *about* the task and not part of it, and a mark inside the text would
 * be something somebody could select, copy and paste into another page.
 *
 * The names come from a callback rather than being passed once, because the
 * member list arrives after the editor is built — the same reason the comment
 * marks read their threads from a ref (ADR-0046).
 */
export function assignmentChips(nameOf: (userId: string) => string | null): Plugin {
  const build = (state: EditorState): DecorationSet => {
    const found: Decoration[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'todo') return true;
      const who = readAssignee(node as PMNode);
      if (!who) return false;

      found.push(
        Decoration.widget(
          pos + node.nodeSize - 1,
          () => {
            const chip = document.createElement('span');
            chip.className = 'todo-assignee';
            const name = nameOf(who);
            // A person who has left the workspace still has their task
            // assigned. Their id is not shown — it would be noise — but the
            // chip stays, because an assignment nobody can see is an assignment
            // nobody will reassign.
            chip.textContent = name ?? '?';
            if (name) chip.title = name;
            chip.setAttribute('contenteditable', 'false');
            return chip;
          },
          // Not part of the text: it must not be selected, copied, or treated
          // as a position the caret can sit in.
          { side: 1, ignoreSelection: true, marks: [] },
        ),
      );
      return false;
    });
    return DecorationSet.create(state.doc, found);
  };

  return new Plugin({
    key: assignmentKey,
    state: {
      init: (_, state) => build(state),
      apply: (tr, old, _oldState, newState) => (tr.docChanged ? build(newState) : old),
    },
    props: {
      decorations: (state) => assignmentKey.getState(state) as DecorationSet,
    },
  });
}
