/**
 * SONE editor — linking a page from the writing (ADR-0173).
 *
 * The third menu of this shape, after the slash menu (ADR-0016) and the
 * mentions (ADR-0085), and deliberately so: a trigger, a query built from what
 * follows it, and a plugin state the interface renders. What differs is where
 * the list comes from — the pages of a workspace are no more this package's
 * business than the people in one, so this holds a position and a query and
 * never a list.
 *
 * ## Why the trigger is two characters
 *
 * `/` is rare in prose. `@` is not, and needed a word-boundary rule so that
 * `markus@example.org` opens nothing. `[` is somewhere between: it begins a
 * markdown link, a footnote marker, a citation — all things somebody writes in
 * a paragraph, and a menu over any of them captures the Enter that ends the
 * line.
 *
 * `[[` is the wiki convention for exactly this, it is what somebody who has
 * used another notes application will try first, and two characters is rare
 * enough in prose to need no cleverness beyond the boundary rule the mentions
 * already have.
 *
 * ## What it leaves behind
 *
 * Not an atom. A page link is **ordinary words wearing a link mark**, which is
 * ADR-0170's decision: a relative address survives an export, a copy into an
 * email and being read behind another host, and the page uuid inside it is what
 * a backlink index reads. The interface builds the address — this package knows
 * nothing about routes — and hands it here with the words to show.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { BLOCK_ATTRS } from '@sone/core';

import { isFollowable } from './hrefs.js';

/** The two characters that open it. */
const TRIGGER = '[[';

/**
 * How long a query may get before the menu gives up.
 *
 * The mentions need this guard for the same reason and set it at thirty: a page
 * title contains spaces, so a space cannot close the menu the way it closes the
 * slash menu, and length is what is left. Forty rather than thirty because a
 * title is longer than a name — *Protokoll der Mitgliederversammlung* is
 * already thirty-four.
 *
 * What the number is for: `[[` written in ordinary prose must not leave a menu
 * capturing Enter for the rest of the paragraph.
 */
const MAX_QUERY = 40;

export interface PageLinkMenuState {
  /** Where the first `[` is. */
  from: number;
  /** What has been typed after the pair. */
  query: string;
}

export const pageLinkMenuPluginKey = new PluginKey<PageLinkMenuState | null>(
  'sone-page-link-menu',
);

export const pageLinkMenuState = (state: EditorState): PageLinkMenuState | null =>
  pageLinkMenuPluginKey.getState(state) ?? null;

interface PageLinkMeta {
  close?: true;
}

/** The block containing the selection, if a page link may be written in it. */
function inBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const attrs = $from.node(depth).type.spec.attrs;
    if (attrs && BLOCK_ATTRS.id in attrs) {
      // Never inside a code block: `[[` there is code — a nested array literal,
      // a shell test, a wiki link somebody is writing *about*.
      return $from.node(depth).type.name !== 'code';
    }
  }
  return false;
}

/**
 * Whether a `[[` at this position begins a link rather than continuing a word.
 *
 * At the start of a block, or after whitespace or an opening bracket — the same
 * rule the mentions use, for the same reason.
 */
function opensHere(state: EditorState, at: number): boolean {
  if (at === 0) return true;
  const before = state.doc.textBetween(at - 1, at, '\n', '￼');
  if (before === '') return true;
  return /[\s([{]/.test(before);
}

export function pageLinkMenu(): Plugin<PageLinkMenuState | null> {
  return new Plugin<PageLinkMenuState | null>({
    key: pageLinkMenuPluginKey,

    state: {
      init: () => null,

      apply: (tr, previous, _oldState, newState) => {
        const meta = tr.getMeta(pageLinkMenuPluginKey) as PageLinkMeta | undefined;
        if (meta?.close) return null;

        if (previous) {
          const from = tr.mapping.map(previous.from);
          const head = newState.selection.head;

          // The pair must still be there and the caret still after it. Either
          // failing means the person has moved on — including by deleting one
          // of the two brackets, which is how somebody changes their mind.
          if (head < from + TRIGGER.length) return null;
          if (newState.doc.textBetween(from, from + TRIGGER.length) !== TRIGGER) return null;

          const query = newState.doc.textBetween(from + TRIGGER.length, head, '\n', '￼');
          if (query.includes('\n')) return null;
          if (query.length > MAX_QUERY) return null;

          return { from, query };
        }

        // Opening. Requires a document change, so moving the caret past an
        // existing `[[` does not open a menu.
        if (!tr.docChanged) return null;
        if (!inBlock(newState)) return null;

        const head = newState.selection.head;
        if (head < TRIGGER.length) return null;
        const start = head - TRIGGER.length;
        if (newState.doc.textBetween(start, head) !== TRIGGER) return null;
        if (!opensHere(newState, start)) return null;

        return { from: start, query: '' };
      },
    },

    props: {
      /**
       * Only Escape, and only while open.
       *
       * The arrows and Enter belong to the interface, because the interface
       * owns the list — this plugin does not know how many pages are in it or
       * which one is highlighted. The same division the mentions make.
       */
      handleKeyDown(view, event) {
        if (!pageLinkMenuState(view.state)) return false;
        if (event.key !== 'Escape') return false;
        closePageLinkMenu(view);
        return true;
      },
    },
  });
}

/** Close the menu, leaving the typed text alone. */
export function closePageLinkMenu(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(pageLinkMenuPluginKey, { close: true }));
}

/**
 * Replace `[[query` with the page's title, linked.
 *
 * One transaction — the deletion and the insertion together — because
 * y-prosemirror restores a relative selection between dispatches, and two
 * dispatches move the caret. The same reason `insertMention` and
 * `openSlashMenu` are each one.
 *
 * **No trailing space**, which is where this differs from `insertMention`. A
 * mention is an atom and a caret directly after one has nowhere ordinary to be;
 * the link mark is `inclusive: false`, so the caret after these words is
 * already outside the link and what gets typed next is ordinary text. A space
 * here would be a word the person did not type, and the sentence may want a
 * comma.
 *
 * The address is asked the same question every other address is asked
 * (ADR-0157). Nothing in this application builds an executing one for this
 * call; the guard is at the door rather than at the callers, because that is
 * the arrangement that survives a caller nobody has written yet.
 */
export function insertPageLink(
  view: EditorView,
  page: { href: string; label: string },
): boolean {
  const state = pageLinkMenuState(view.state);
  if (!state) return false;

  const type = view.state.schema.marks['link'];
  if (!type) return false;
  if (!isFollowable(page.href)) return false;

  const label = page.label.trim();
  if (label === '') return false;

  const head = view.state.selection.head;
  const tr = view.state.tr;
  tr.replaceWith(
    state.from,
    head,
    view.state.schema.text(label, [type.create({ href: page.href })]),
  );
  tr.setMeta(pageLinkMenuPluginKey, { close: true });
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
