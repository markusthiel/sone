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
import { ySyncPluginKey } from 'y-prosemirror';
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
      const from = relativeToAbsolute(state, text, range.from, binding);
      const to = relativeToAbsolute(state, text, range.to, binding);
      if (from === null || to === null || to <= from) continue;

      decorations.push(
        Decoration.inline(from, to, { class: 'sone-authored' }, { inclusiveEnd: false }),
      );
    }
  });

  return DecorationSet.create(state.doc, decorations);
}

/** One end of a range, in editor coordinates. */
function relativeToAbsolute(
  state: EditorState,
  text: Y.XmlText,
  index: number,
  binding: { mapping?: unknown },
): number | null {
  try {
    const relative = Y.createRelativePositionFromTypeIndex(text, index);
    const doc = text.doc;
    if (!doc) return null;

    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
    if (!absolute) return null;

    // y-prosemirror keeps a node for each Yjs type; the position of that node
    // plus the index inside it is the editor position.
    const mapping = binding.mapping as Map<unknown, unknown> | undefined;
    const node = mapping?.get(text);
    if (!node) return null;

    const found = findNodePosition(state, node);
    if (found === null) return null;

    const position = found + 1 + absolute.index;
    return position <= state.doc.content.size ? position : null;
  } catch {
    // A type that has been removed from the document while this ran. Skipped
    // rather than dropping every other highlight with it.
    return null;
  }
}

/** Where a node sits in the document, or null if it is no longer there. */
function findNodePosition(state: EditorState, target: unknown): number | null {
  let found: number | null = null;

  state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if ((node as unknown) === target) {
      found = pos;
      return false;
    }
    return true;
  });

  return found;
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

        // Rebuilt when the document changed, and also when y-prosemirror
        // announced a binding: the first request often arrives before the
        // binding exists, and without this the highlight would stay empty until
        // the next keystroke.
        if (tr.docChanged || tr.getMeta(ySyncPluginKey)) {
          return {
            clients: value.clients,
            decorations: buildDecorations(newState, value.clients),
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
