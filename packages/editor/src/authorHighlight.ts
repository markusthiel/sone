/**
 * SONE editor — highlighting one person's writing.
 *
 * The drawing half. The arithmetic lives in `authorship.ts` and is tested
 * against plain Yjs documents; this turns an index inside a Y.XmlText into a
 * position in the editor, which only the live binding can do.
 *
 * ## Why the positions come from y-prosemirror
 *
 * The editor's positions and the document's indices are not the same numbers: a
 * paragraph boundary costs a position in the editor and nothing in the text.
 * Computing the offset here would mean re-deriving the mapping y-prosemirror
 * already maintains, and being subtly wrong about it puts a highlight over the
 * wrong sentence — a confident false claim about who wrote what, which is worse
 * than showing nothing.
 *
 * ## Nothing is drawn until somebody asks
 *
 * The decoration set is empty unless a person is selected, so a document nobody
 * is inspecting pays nothing. When one is, it is rebuilt on document change
 * rather than cached against edits: an edit is exactly what changes the answer.
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';

import { eachAuthoredText, rangesForClients } from './authorship.js';

export interface AuthorHighlightState {
  /** The clients whose writing to mark, or null for none. */
  clients: Set<number> | null;
  decorations: DecorationSet;
}

export const authorHighlightKey = new PluginKey<AuthorHighlightState>('sone-author-highlight');

/** Ask for a person's writing to be marked, or pass null to stop. */
export function highlightClients(clients: Set<number> | null): { clients: Set<number> | null } {
  return { clients };
}

/**
 * Build the decorations for the given clients.
 *
 * Returns an empty set rather than throwing when the binding is not ready: the
 * plugin runs on every transaction, including ones dispatched before
 * y-prosemirror has bound the document, and a highlight is not worth an
 * exception in the editor's own update path.
 */
function buildDecorations(state: EditorState, clients: Set<number> | null): DecorationSet {
  if (!clients || clients.size === 0) return DecorationSet.empty;

  const sync = ySyncPluginKey.getState(state) as
    | { binding?: { mapping?: unknown; type?: Y.XmlFragment }; type?: Y.XmlFragment }
    | undefined;
  const binding = sync?.binding;
  const type = binding?.type ?? sync?.type;
  if (!binding?.mapping || !type) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  eachAuthoredText(type, (text, ranges) => {
    const mine = rangesForClients(ranges, clients);
    if (mine.length === 0) return;

    for (const range of mine) {
      // Through y-prosemirror's own mapping, both ends. A relative position
      // survives concurrent edits, which is what makes this correct while
      // somebody else is typing.
      const from = relativeToAbsolute(state, type, text, range.from, binding.mapping);
      const to = relativeToAbsolute(state, type, text, range.to, binding.mapping);
      if (from === null || to === null || to <= from) continue;

      decorations.push(
        Decoration.inline(from, to, { class: 'sone-authored' }, { inclusiveEnd: false }),
      );
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * One end of a range, in editor coordinates.
 *
 * Through **y-prosemirror's own** `relativePositionToAbsolutePosition`, which is
 * the inverse of the `absolutePositionToRelativePosition` the comment anchors
 * already use. Same pair, same file in the library, and this is the half that
 * was missing here.
 *
 * What stood here instead re-derived the position: look the `Y.XmlText` up in
 * the binding's mapping, find that node in the document, add one for entering
 * it, add the index. Every step of that reasoning is right about a
 * `Y.XmlElement` and wrong about a `Y.XmlText` — y-prosemirror maps an element
 * to a node and a text to an **array** of text nodes (`meta.mapping.set(ytext,
 * ptexts)`). An array is truthy, so it sailed past the guard, and then no node
 * in the document was ever identity-equal to it. Every range was skipped, the
 * decoration set was always empty, and the People panel's button toggled over a
 * page where nothing happened (ADR-0091).
 *
 * The header of this file says the reason not to compute the offset here is
 * that re-deriving y-prosemirror's mapping and being subtly wrong puts a
 * highlight over the wrong sentence. The code under it re-derived the mapping.
 */
function relativeToAbsolute(
  state: EditorState,
  root: Y.XmlFragment,
  text: Y.XmlText,
  index: number,
  mapping: unknown,
): number | null {
  try {
    const doc = text.doc;
    if (!doc) return null;

    const relative = Y.createRelativePositionFromTypeIndex(text, index);
    const absolute = relativePositionToAbsolutePosition(
      doc,
      root,
      relative,
      mapping as never,
    );
    if (absolute === null) return null;
    return absolute <= state.doc.content.size ? absolute : null;
  } catch {
    // A type that has been removed from the document while this ran. Skipped
    // rather than dropping every other highlight with it.
    return null;
  }
}

/**
 * The plugin.
 *
 * Its state holds the chosen clients and the decorations for them. Rebuilding
 * on every document change is deliberate: an edit is exactly what changes who
 * wrote what, and a stale highlight is the failure this feature cannot afford.
 */
export function authorHighlight(): Plugin<AuthorHighlightState> {
  return new Plugin<AuthorHighlightState>({
    key: authorHighlightKey,
    state: {
      init: () => ({ clients: null, decorations: DecorationSet.empty }),
      apply(tr, value, _old, newState) {
        const asked = tr.getMeta(authorHighlightKey) as
          | { clients: Set<number> | null }
          | undefined;

        if (asked) {
          return {
            clients: asked.clients,
            decorations: buildDecorations(newState, asked.clients),
          };
        }

        if (!value.clients) return value;

        /*
         * Recomputed when y-prosemirror says so, and only then.
         *
         * That announcement is the one moment the Yjs document and the editor's
         * document agree. A **local** edit reaches this `apply` first and Yjs
         * afterwards — y-prosemirror writes the change inside the view's update,
         * which runs after the state is applied — so recomputing here reads the
         * authorship from *before* the keystroke and lays it over the document
         * from *after* it. Every character typed above a highlight moved the
         * text and left the mark behind, which is the wrong-highlight failure
         * this file says is worse than showing nothing.
         *
         * It also rebuilds on a binding announcement because the first request
         * usually arrives before there is a binding, and without it the
         * highlight would stay empty until something else happened.
         */
        if (tr.getMeta(ySyncPluginKey)) {
          return {
            clients: value.clients,
            decorations: buildDecorations(newState, value.clients),
          };
        }

        /*
         * Otherwise the marks are *moved*, not recomputed.
         *
         * ProseMirror's own mapping knows where every position went, which is
         * exactly the question a local edit raises and the only one that can be
         * answered before Yjs has heard about it. What it cannot know is that
         * the typing *changed who wrote what* — and it does not have to, because
         * the recompute above follows one transaction later.
         */
        if (tr.docChanged) {
          return {
            clients: value.clients,
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        }

        return value;
      },
    },
    props: {
      decorations(state) {
        return authorHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}
