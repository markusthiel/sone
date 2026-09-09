/**
 * SONE — links.
 *
 * There was no way to make one. The `link` mark existed in the schema and
 * rendered correctly, and nothing could apply it — so links could arrive by
 * paste and never be created or edited.
 *
 * Three pieces here, all pure commands so the interface can drive them without
 * this package knowing about React (ADR-0016):
 *
 *   - a command to set, update or remove a link over the selection
 *   - the range a link occupies, so the interface can show and edit an existing
 *     one without the person having to select it exactly
 *   - normalisation, because what people paste and what a browser can follow are
 *     different things
 */

import type { Mark } from 'prosemirror-model';
import { Plugin, TextSelection, type Command, type EditorState } from 'prosemirror-state';

import { currentOrigin, homeRelative, isFollowable, isSameOrigin } from './hrefs.js';
import { schema } from './schema.js';

export interface LinkRange {
  from: number;
  to: number;
  href: string;
}

/**
 * The link at the selection, with the full extent of the mark.
 *
 * Returns the whole link even when only part of it is selected, so clicking
 * inside a link and pressing the shortcut edits that link rather than creating a
 * nested one.
 */
export function linkAt(state: EditorState): LinkRange | null {
  const type = schema.marks['link'];
  if (!type) return null;

  const { $from, empty } = state.selection;

  // `marks()` at a collapsed cursor reports the marks that would apply to typed
  // text, which is not the same as the marks on the character under it — so the
  // node at the position is checked directly.
  const parent = $from.parent;
  const index = $from.index();
  const node = parent.maybeChild(index);
  const mark: Mark | undefined =
    node?.marks.find((m) => m.type === type) ??
    (empty ? undefined : state.doc.rangeHasMark($from.pos, state.selection.to, type)
      ? type.isInSet($from.marks()) ?? undefined
      : undefined);

  if (!mark) return null;

  // Walk outwards to the mark's boundaries.
  let start = $from.pos - $from.textOffset;
  let end = start + (node?.nodeSize ?? 0);

  let i = index - 1;
  let pos = start;
  while (i >= 0) {
    const previous = parent.child(i);
    if (!mark.isInSet(previous.marks)) break;
    pos -= previous.nodeSize;
    i -= 1;
  }
  start = pos;

  i = index + 1;
  pos = end;
  while (i < parent.childCount) {
    const next = parent.child(i);
    if (!mark.isInSet(next.marks)) break;
    pos += next.nodeSize;
    i += 1;
  }
  end = pos;

  return { from: start, to: end, href: String(mark.attrs['href'] ?? '') };
}

/**
 * Normalise what someone typed or pasted into something a browser can follow.
 *
 * `example.org` is what people write and is not a URL — without a scheme a
 * browser resolves it against the current page and the link silently points at
 * a path on this instance. Bare addresses become https, and mail addresses
 * become mailto.
 *
 * Returns null for input that cannot be made into a link, so a caller can say
 * so rather than storing something broken.
 */
export function normaliseHref(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Anything with a scheme is taken as given, except the ones that execute.
  //
  // The list moved to `hrefs.ts` (ADR-0157), because the schema needs the same
  // answer for a *pasted* link and cannot import this file — it is the one this
  // file imports. Two copies of a security rule is one copy that stops being
  // updated.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (!isFollowable(trimmed)) return null;
    /*
     * An address pointing back here keeps the path and drops the host
     * (ADR-0177), so the sentence four lines below is true of a pasted link as
     * well as of a typed one — the handle menu's clipboard address is absolute
     * on purpose (ADR-0170), and it is the likeliest way an internal link is
     * made.
     */
    return homeRelative(trimmed, currentOrigin());
  }

  // Looks like an email address.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;

  // A relative link within this instance is legitimate and should stay relative,
  // so a shared page keeps working behind a different host.
  if (trimmed.startsWith('/')) return trimmed;

  // Anything else with a dot in it is treated as a host.
  if (/^[^\s/]+\.[^\s/]{2,}/.test(trimmed)) return `https://${trimmed}`;

  return null;
}

/**
 * Apply a link to the selection, or to the link under the cursor.
 *
 * With an empty selection and no link under the cursor, the href is inserted as
 * its own text and linked — otherwise the command would appear to do nothing,
 * which is worse than a reasonable guess.
 */
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const type = schema.marks['link'];
    if (!type) return false;

    const normalised = normaliseHref(href);
    if (!normalised) return false;

    const existing = linkAt(state);
    const { from, to } = existing ?? state.selection;

    if (from === to) {
      // Nothing to attach the mark to: insert the address as the link text.
      if (dispatch) {
        const tr = state.tr.insertText(normalised, from);
        tr.addMark(from, from + normalised.length, type.create({ href: normalised }));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    if (dispatch) {
      const tr = state.tr;
      // Removed first: addMark over an existing link of a different href leaves
      // two marks and the browser follows whichever it finds first.
      tr.removeMark(from, to, type);
      tr.addMark(from, to, type.create({ href: normalised }));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Remove the link at the selection. */
export const removeLink: Command = (state, dispatch) => {
  const type = schema.marks['link'];
  if (!type) return false;

  const existing = linkAt(state);
  const { from, to } = existing ?? state.selection;
  if (from === to) return false;

  if (dispatch) {
    dispatch(state.tr.removeMark(from, to, type));
  }
  return true;
};

/**
 * Select the link under the cursor.
 *
 * Used before opening an editor for it, so the person can see what will change.
 */
export const selectLink: Command = (state, dispatch) => {
  const existing = linkAt(state);
  if (!existing) return false;
  if (dispatch) {
    dispatch(
      state.tr.setSelection(
        TextSelection.create(state.doc, existing.from, existing.to),
      ),
    );
  }
  return true;
};

/** True when a link could be applied: a selection, or a link to edit. */
export const canLink = (state: EditorState): boolean =>
  !state.selection.empty || linkAt(state) !== null;

/**
 * Follow a link (ADR-0157).
 *
 * Reported as *„wenn man im Text einen Link setzt dann kann man den nicht
 * öffnen"*, and it was two different absences wearing one coat.
 *
 * **A reader.** A page opened through a share link, or any page somebody may
 * not edit, is a document — and a link in a document is followed by clicking
 * it. Nothing here was stopping that on purpose; there was simply no handler,
 * and ProseMirror does not follow links itself.
 *
 * **A writer.** Inside an editable view a plain click must still put the caret
 * in the word, or a link would be a phrase nobody can correct. So the modifier
 * everything else uses opens it — `Cmd` where that is the platform's key,
 * `Ctrl` elsewhere — and the plain click is answered by the card the interface
 * puts over the caret instead.
 *
 * The scheme is asked again here even though nothing can now get a refused one
 * into the document: documents written before that door existed are still out
 * there, and a CRDT keeps whatever ever reached it.
 */
export function followLinks(): Plugin {
  return new Plugin({
    props: {
      /*
       * `handleDOMEvents.click`, not `handleClick`.
       *
       * `handleClick` is called from ProseMirror's own mouse state machine —
       * mousedown, then mouseup, then a resolved document position — and it is
       * the position that this does not need: the answer is on the anchor the
       * click landed in. Going through the DOM event directly also keeps the
       * behaviour the same in a read-only view, where that state machine has
       * rather less to do.
       */
      handleDOMEvents: {
        click(view, event) {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
          if (!anchor || !view.dom.contains(anchor)) return false;

          /*
           * `getAttribute`, not `.href`.
           *
           * The property is resolved against the page's own origin, so a
           * relative link comes back absolute and a refused scheme comes back
           * looking like something else entirely. The attribute is what the
           * document says.
           */
          const href = anchor.getAttribute('href');
          if (href === null || !isFollowable(href)) return false;

          // `metaKey` on a Mac and `ctrlKey` everywhere else, which is the pair
          // every other shortcut in this editor is built from.
          const asked = event.metaKey || event.ctrlKey;
          if (view.editable && !asked) return false;

          /*
           * A link home is left to the application (ADR-0171).
           *
           * Not prevented and not opened: the click carries on up to the
           * application's own interception, which navigates in place. Opening
           * it here would be a second copy of the application in a second tab,
           * with a second sync connection and the reading position gone — the
           * fault ADR-0170 named in the links panel, in the other place that
           * follows a link.
           *
           * Unless the modifier was held, which is the one gesture that does
           * mean *somewhere else*, in every browser and every application. An
           * address pointing home is not an exception to something that
           * general, so that case falls through to `openLink` below.
           */
          if (!asked && isSameOrigin(href, window.location.origin)) return false;

          openLink(href);
          // Handled, and the browser told so: without this it follows the
          // anchor as well and a read-only view opens two tabs.
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

/**
 * Open one, in a way that cannot reach back.
 *
 * `noopener` is the load-bearing word: without it the opened page gets a handle
 * on the window that opened it and can navigate it somewhere else. The schema
 * puts the same pair on every rendered anchor; this is the same guarantee for
 * the path that does not go through one.
 */
export function openLink(href: string): void {
  if (!isFollowable(href)) return;
  window.open(href, '_blank', 'noopener,noreferrer');
}
