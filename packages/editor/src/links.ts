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
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

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
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const scheme = trimmed.slice(0, trimmed.indexOf(':')).toLowerCase();
    // javascript: and data: in a link are a script-execution vector, and a
    // notes app is full of pasted text. Refused rather than sanitised, because
    // sanitising a URL scheme correctly is not something to attempt by hand.
    if (scheme === 'javascript' || scheme === 'data' || scheme === 'vbscript') {
      return null;
    }
    return trimmed;
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
