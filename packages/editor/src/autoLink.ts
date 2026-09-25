/**
 * SONE — addresses that become links by themselves.
 *
 * Reported as: *„Links sollten im editor automatisch als links erkannt werden,
 * momentan ist es reiner text, der eingesetzt wird."*
 *
 * The `link` mark, the command that applies it and the click that follows it
 * all existed (ADR-0016, ADR-0157). What did not exist is the moment in
 * between: typing or pasting an address left text, and the person had to select
 * it and reach for the shortcut to make it a link — for the one case where
 * there is nothing to decide.
 *
 * Two moments, because they are the only two an address arrives in:
 *
 *   - **Typing**, finished by a space or Enter. The word before the caret is
 *     looked at, and only then — nothing is decided while somebody is still in
 *     the middle of typing it.
 *   - **Pasting** a single address. It replaces what is selected and is linked,
 *     which is what was asked for, and is the one thing here that differs from
 *     how some other editors behave (they keep the selected words and hang the
 *     address on them).
 *
 * What is deliberately *not* linked is the larger half of this file's reason to
 * exist. `normaliseHref` answers "can this be a link" and is right to be
 * generous — it serves a person who has typed something into a link field and
 * meant it. Here nobody asked, so the question is "is this unmistakably an
 * address", and `example.org` does not pass it: so do `z.B.`, `Abs.2`, `1.5x`
 * and every sentence that ends without a space after the full stop. Guessing
 * wrong turns somebody's prose into a link they have to undo, in a document
 * that syncs the mistake to everybody else before they notice.
 *
 * So: a scheme, or `www.`, or something shaped exactly like a mail address.
 * Nothing else, however much it looks like a host.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { normaliseHref } from './links.js';
import { schema } from './schema.js';

/**
 * An address at the end of the text before the caret.
 *
 * Anchored at the end, because this only ever asks about the word somebody just
 * finished. The three alternatives are the three unmistakable shapes: a scheme,
 * the `www.` that has meant "address" since before schemes were typed out, and
 * a mail address.
 *
 * `[^\s<>]` rather than `\S`: angle brackets around an address are a
 * convention old enough to be in RFC 3986, and taking them into the href makes
 * a link nobody can follow.
 */
const TRAILING_ADDRESS =
  /(?:^|\s)((?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[a-z]{2,})$/i;

/** The same shapes, but as the whole of what was pasted. */
const WHOLE_ADDRESS =
  /^(?:(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[a-z]{2,})$/i;

/**
 * Drop the punctuation a sentence leaves clinging to an address.
 *
 * "Siehe https://example.org." ends in a full stop that belongs to the German
 * sentence, not to the host — and `)` likewise, when the address was put in
 * brackets. Anything that is genuinely part of an address is allowed to stay:
 * a trailing `/` is a path, and a closing bracket is kept when the address
 * opened one, which is how Wikipedia's addresses survive this.
 */
export function trimTrailingPunctuation(address: string): string {
  let end = address.length;
  while (end > 0) {
    const character = address[end - 1] ?? '';
    if (character === ')' ) {
      // Balanced: part of the path. Unbalanced: somebody's bracket.
      const opens = (address.slice(0, end).match(/\(/g) ?? []).length;
      const closes = (address.slice(0, end).match(/\)/g) ?? []).length;
      if (opens >= closes) break;
      end -= 1;
      continue;
    }
    if ('.,;:!?"\'»«'.includes(character)) {
      end -= 1;
      continue;
    }
    break;
  }
  return address.slice(0, end);
}

/** Is this unmistakably an address, rather than merely convertible into one? */
export function looksLikeAddress(text: string): boolean {
  return WHOLE_ADDRESS.test(text.trim());
}

/**
 * Link the address immediately before `at`, if there is one.
 *
 * Returns a transaction to dispatch, or null. Kept separate from both callers
 * because typing and Enter want the same answer at different moments, and a
 * second copy of the decision is a second thing to keep right.
 */
function linkAddressBefore(state: EditorState, at: number): Transaction | null {
  const type = schema.marks['link'];
  if (!type) return null;

  const $at = state.doc.resolve(at);
  // Text of the current block only: an address does not run across a block
  // boundary, and `textBetween` over a wider range would invent one.
  if (!$at.parent.isTextblock) return null;

  /*
   * Not inside code.
   *
   * A code block is the one place in the document where an address is being
   * shown rather than offered, and a link in it changes what the sample says.
   */
  if ($at.parent.type.spec.code) return null;

  const start = $at.start();
  if (at <= start) return null;

  const before = state.doc.textBetween(start, at, '\n', '\n');
  const match = TRAILING_ADDRESS.exec(before);
  if (!match) return null;

  const raw = match[1] ?? '';
  const address = trimTrailingPunctuation(raw);
  if (address.length === 0) return null;

  const href = normaliseHref(address);
  if (!href) return null;

  const from = at - raw.length;
  const to = from + address.length;

  // Already a link — including one somebody made by hand with a different
  // address, which is theirs and not to be overwritten.
  if (state.doc.rangeHasMark(from, to, type)) return null;

  const tr = state.tr.addMark(from, to, type.create({ href }));
  /*
   * The mark is not carried on to what is typed next.
   *
   * `addMark` over a range that ends at the caret leaves the mark in the stored
   * set, so the rest of the sentence would be swallowed by the link — the
   * failure people know from mail clients, and the reason some of them refuse
   * to trust autolinking at all.
   */
  tr.removeStoredMark(type);
  return tr;
}

export const autoLinkKey = new PluginKey('soneAutoLink');

/**
 * Typing, leaving a block, and pasting an address.
 */
export function autoLink(): Plugin {
  return new Plugin({
    key: autoLinkKey,
    props: {
      /*
       * The space is inserted here rather than by letting ProseMirror do it.
       *
       * Returning false after dispatching would mean two transactions for one
       * keystroke: the mark, then the character. Undo would then take two
       * presses to get back to where the person was, which is exactly the kind
       * of small wrongness nobody reports and everybody feels.
       */
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (text !== ' ') return false;
        const linked = linkAddressBefore(view.state, from);
        if (!linked) return false;
        linked.insertText(text, from, to);
        view.dispatch(linked.scrollIntoView());
        return true;
      },

      handlePaste(view: EditorView, event: ClipboardEvent) {
        const type = schema.marks['link'];
        if (!type) return false;

        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        /*
         * Only plain text.
         *
         * Anything carrying HTML was copied from a page, and ProseMirror's own
         * parser knows more about it than this does — including the links it
         * already contains.
         */
        if (clipboard.getData('text/html')) return false;

        const text = clipboard.getData('text/plain').trim();
        if (!looksLikeAddress(text)) return false;

        const href = normaliseHref(text);
        if (!href) return false;

        const { from, to } = view.state.selection;
        const { $from } = view.state.selection;
        if ($from.parent.type.spec.code) return false;

        // Replaces what is selected, rather than hanging the address on it:
        // asked for in so many words.
        const tr = view.state.tr.replaceWith(
          from,
          to,
          schema.text(text, [type.create({ href })]),
        );
        tr.removeStoredMark(type);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },

    /*
     * Leaving the block — Enter, most of the time.
     *
     * Not a key handler, on purpose. ProseMirror asks plugins for a key in
     * order and stops at the first that takes it, so an Enter handler here
     * would work or not depending on where this plugin sits in a list of
     * twenty-odd — and it would keep working until somebody reordered them for
     * an unrelated reason. Asking afterwards *whether the caret left a block*
     * needs no such luck, and it also covers the ways out that are not Enter.
     */
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;

      // Where the caret was, in the document as it now is.
      let left = oldState.selection.from;
      for (const transaction of transactions) left = transaction.mapping.map(left, -1);

      /*
       * Still in the same block? Then nothing was left, and there is nothing to
       * decide yet.
       *
       * Compared by *position*, not by node. The first version of this asked
       * whether `oldState.selection.$from.parent === newState.selection.$from.parent`
       * — and a node is rebuilt on every edit, so two identical objects are
       * never the same object. The condition was therefore true on every single
       * keystroke: typing `https://n` linked those nine characters the moment
       * they matched, and everything after them stayed outside the link, which
       * is the report this fixes.
       */
      const $left = newState.doc.resolve(left);
      if ($left.start() === newState.selection.$from.start()) return null;

      return linkAddressBefore(newState, left);
    },
  });
}
