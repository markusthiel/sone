/**
 * SONE editor — naming somebody in the text (ADR-0085).
 *
 * The same shape as the slash menu, and deliberately so: a trigger character, a
 * query built from what follows it, and a plugin state the interface renders.
 * What differs is where the list comes from. Slash commands are a fixed
 * catalogue this package owns; the people in a workspace are not, so this
 * plugin holds a query and never a list — the interface fetches, filters and
 * draws, and calls `insertMention` when somebody is chosen.
 *
 * That division is the reason this is not simply the slash menu with a
 * different character. `@sone/editor` has no business knowing how this
 * application asks a server who is in a workspace, any more than it knows how
 * translations are stored.
 *
 * **The trigger is `@` at a word boundary.** An `@` in the middle of a word is
 * an email address, and offering to turn `markus@example.org` into a mention as
 * somebody types it would be worse than useless.
 */

import { TextSelection } from 'prosemirror-state';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { BLOCK_ATTRS } from '@sone/core';

export interface MentionMenuState {
  /** Where the `@` is. */
  from: number;
  /** What has been typed after it. */
  query: string;
}

export const mentionMenuPluginKey = new PluginKey<MentionMenuState | null>(
  'sone-mention-menu',
);

export const mentionMenuState = (state: EditorState): MentionMenuState | null =>
  mentionMenuPluginKey.getState(state) ?? null;

interface MentionMeta {
  close?: true;
}

/** The block containing the selection, if a mention may be written in it. */
function inBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const attrs = $from.node(depth).type.spec.attrs;
    if (attrs && BLOCK_ATTRS.id in attrs) {
      // Never inside a code block: an `@` there is code, and a decorator or a
      // shell command is the ordinary reason for one.
      return $from.node(depth).type.name !== 'code';
    }
  }
  return false;
}

/**
 * Whether an `@` at this position begins a mention rather than an address.
 *
 * At the start of a block, or after whitespace or an opening bracket. Anything
 * else is the middle of a word: `markus@example.org`, a handle inside a URL, a
 * decorator.
 */
function opensMention(state: EditorState, at: number): boolean {
  if (at === 0) return true;
  const before = state.doc.textBetween(at - 1, at, '\n', '￼');
  if (before === '') return true;
  return /[\s([{]/.test(before);
}

export function mentionMenu(): Plugin<MentionMenuState | null> {
  return new Plugin<MentionMenuState | null>({
    key: mentionMenuPluginKey,

    state: {
      init: () => null,

      apply: (tr, previous, _oldState, newState) => {
        const meta = tr.getMeta(mentionMenuPluginKey) as MentionMeta | undefined;
        if (meta?.close) return null;

        if (previous) {
          const from = tr.mapping.map(previous.from);
          const head = newState.selection.head;

          // The `@` must still be there and the caret still after it. Either
          // failing means the person has moved on.
          if (head < from + 1) return null;
          if (newState.doc.textBetween(from, from + 1) !== '@') return null;

          const query = newState.doc.textBetween(from + 1, head, '\n', '￼');
          if (query.includes('\n')) return null;

          /*
           * A name can contain a space — "Markus Thiel" — so a space cannot
           * close this the way it closes the slash menu. What closes it is
           * length: nobody's name is being searched for after thirty
           * characters, and an `@` in ordinary prose must not leave a menu
           * capturing Enter for the rest of a paragraph.
           */
          if (query.length > 30) return null;

          return { from, query };
        }

        // Opening. Requires a document change, so moving the caret next to an
        // existing `@` does not open a menu.
        if (!tr.docChanged) return null;
        if (!inBlock(newState)) return null;

        const head = newState.selection.head;
        if (head < 1) return null;
        if (newState.doc.textBetween(head - 1, head) !== '@') return null;
        if (!opensMention(newState, head - 1)) return null;

        return { from: head - 1, query: '' };
      },
    },

    props: {
      /**
       * Only Escape, and only while open.
       *
       * The arrows and Enter belong to the interface here, because the
       * interface owns the list — this plugin does not know how many people are
       * in it or which one is highlighted. It offers `closeMentionMenu` and
       * `insertMention`, and the component wires its own keys.
       */
      handleKeyDown(view, event) {
        if (!mentionMenuState(view.state)) return false;
        if (event.key !== 'Escape') return false;
        closeMentionMenu(view);
        return true;
      },
    },
  });
}

/** Close the menu, leaving the typed text alone. */
export function closeMentionMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(mentionMenuPluginKey, { close: true }));
}

/**
 * Replace the `@query` with a mention of this person.
 *
 * One transaction: the deletion and the insertion together, so
 * y-prosemirror has no intermediate state to restore a relative selection
 * against — the same reason `openSlashMenu` is one transaction.
 *
 * A trailing space, because a mention is an atom and a caret sitting directly
 * after one has nowhere ordinary to be. Somebody who types a name almost always
 * carries on with the sentence.
 */
export function insertMention(
  view: EditorView,
  person: { userId: string; label: string },
): boolean {
  const state = mentionMenuState(view.state);
  if (!state) return false;

  const type = view.state.schema.nodes['mention'];
  if (!type) return false;

  const head = view.state.selection.head;
  const tr = view.state.tr;
  tr.replaceWith(
    state.from,
    head,
    type.create({ userId: person.userId, label: person.label }),
  );
  tr.insertText(' ', tr.selection.from);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.from)));
  tr.setMeta(mentionMenuPluginKey, { close: true });
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
