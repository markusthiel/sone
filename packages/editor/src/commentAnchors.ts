/**
 * SONE editor — anchoring a comment to a selection (ADR-0046).
 *
 * Two directions, and neither is a coordinate conversion.
 *
 * *Making* an anchor: a ProseMirror selection is a pair of document positions,
 * and what has to be stored is a pair of Yjs relative positions — bound to the
 * items beside them so they survive anybody's edits. y-prosemirror keeps the
 * mapping between the two worlds, and this asks it rather than counting
 * characters itself.
 *
 * *Drawing* one: the stored bytes are resolved back and become a decoration.
 *
 * Both directions are y-prosemirror's own — `absolutePositionToRelativePosition`
 * and its inverse — against the document's root fragment. I first wrote this
 * against individual `Y.XmlText` nodes, reusing the author highlight's private
 * conversion, which meant refusing any selection that spanned two paragraphs.
 * The library resolves against the whole fragment, so a selection across blocks
 * is one pair of positions and no special case.
 */

import { ySyncPluginKey } from 'y-prosemirror';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import * as Y from 'yjs';

import { MAX_QUOTE, type PdfPlace } from '@sone/core';

import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from 'y-prosemirror';

export interface CommentAnchor {
  from: Uint8Array;
  to: Uint8Array;
  quote: string;
  /**
   * A canvas item, when the comment is about one rather than about text
   * (ADR-0046).
   *
   * Optional and unused by this module: an anchor from the editor never has one.
   * It lives here because the panel takes *one* anchor type from either surface,
   * and a second type would mean the panel deciding which of two shapes it has
   * before it can do anything with it.
   */
  item?: string;
  /**
   * A place in a PDF, when the comment is about one (ADR-0151).
   *
   * Here for the same reason `item` is: the panel takes **one** anchor type
   * from every surface — prose, canvas, and now a document inside the page —
   * and a second shape would mean deciding which one it has before it can do
   * anything at all.
   *
   * Typed as the core's shape rather than restated: two descriptions of one
   * rectangle is how the two come to disagree about which corner it starts at.
   */
  place?: PdfPlace;
}

/** Every thread the editor should draw, in editor coordinates. */
export interface DrawnThread {
  id: string;
  from: Uint8Array;
  to: Uint8Array;
  /** A resolved thread keeps its place in the panel and loses its highlight. */
  resolved: boolean;
}

/**
 * Turn the current selection into an anchor, or null if there is nothing to
 * anchor to.
 *
 * Null for an empty selection, deliberately: a comment on a caret has no text
 * to quote and nothing to highlight, and the honest answer is that a comment
 * needs something to be about.
 */
export function anchorFromSelection(state: EditorState): CommentAnchor | null {
  const { from, to } = state.selection;
  if (to <= from) return null;

  const sync = ySyncPluginKey.getState(state) as
    | { binding?: { mapping?: unknown; type?: Y.XmlFragment }; type?: Y.XmlFragment }
    | undefined;
  const binding = sync?.binding;
  const type = binding?.type ?? sync?.type;
  if (!binding?.mapping || !type) return null;

  const mapping = binding.mapping as never;
  const start = absolutePositionToRelativePosition(from, type, mapping);
  const end = absolutePositionToRelativePosition(to, type, mapping);
  if (!start || !end) return null;

  return {
    from: Y.encodeRelativePosition(start),
    to: Y.encodeRelativePosition(end),
    // The words themselves, kept because they are what the comment is *about*
    // (ADR-0046). A space between blocks rather than nothing, so a quotation
    // spanning two paragraphs does not run two sentences together.
    quote: state.doc.textBetween(from, to, ' ').slice(0, MAX_QUOTE),
  };
}

/** One end, resolved. Null when it cannot be, which the caller treats as detached. */
function at(
  doc: Y.Doc,
  type: Y.XmlFragment,
  mapping: never,
  encoded: Uint8Array,
): number | null {
  try {
    return relativePositionToAbsolutePosition(
      doc,
      type,
      Y.decodeRelativePosition(encoded),
      mapping,
    );
  } catch {
    // A malformed anchor, or one naming a type that has been removed while this
    // ran. Skipped rather than taking every other mark down with it.
    return null;
  }
}

/**
 * Where a thread's text is, in editor coordinates, or null when it is gone.
 *
 * Exported because the application needs it for one thread — revealing the words
 * a comment is about — and the plugin's own loop is not reachable from there.
 * Same conversion, one place.
 */
export function revealRange(
  state: EditorState,
  thread: { from: Uint8Array; to: Uint8Array },
): { from: number; to: number } | null {
  const sync = ySyncPluginKey.getState(state) as
    | { binding?: { mapping?: unknown; type?: Y.XmlFragment }; type?: Y.XmlFragment }
    | undefined;
  const binding = sync?.binding;
  const type = binding?.type ?? sync?.type;
  const doc = type?.doc;
  if (!binding?.mapping || !type || !doc) return null;

  const mapping = binding.mapping as never;
  const from = at(doc, type, mapping, thread.from);
  const to = at(doc, type, mapping, thread.to);
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

export const commentMarksKey = new PluginKey<DecorationSet>('sone-comment-marks');

/**
 * Draw a mark under every commented passage.
 *
 * The threads come from outside — the component reads the document and hands
 * them in — because the plugin should not also be a subscriber. One thing
 * knowing how to read comments is enough.
 */
export function commentMarks(
  threads: () => DrawnThread[],
  /**
   * How much to mark, read on every rebuild (ADR-0046).
   *
   * A function rather than a value, for the same reason the threads are: the
   * editor is created once and this changes while somebody reads.
   */
  markStyle: () => 'highlight' | 'underline' | 'off' = () => 'highlight',
): Plugin<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const sync = ySyncPluginKey.getState(state) as
      | { binding?: { mapping?: unknown; type?: Y.XmlFragment }; type?: Y.XmlFragment }
      | undefined;
    const binding = sync?.binding;
    const type = binding?.type ?? sync?.type;
    if (!binding?.mapping || !type) return DecorationSet.empty;

    const doc = type.doc;
    if (!doc) return DecorationSet.empty;
    const mapping = binding.mapping as never;

    const style = markStyle();
    // Nothing at all rather than a transparent decoration: an element in the
    // text that draws nothing is still an element, and it would keep taking
    // clicks from the words underneath.
    if (style === 'off') return DecorationSet.empty;

    const decorations: Decoration[] = [];
    for (const thread of threads()) {
      if (thread.resolved) continue;
      const from = at(doc, type, mapping, thread.from);
      const to = at(doc, type, mapping, thread.to);
      // Equal ends mean the text has been deleted: the thread is detached and
      // belongs in the panel, not in the margin (ADR-0046 and the note in
      // core's comments module — a deleted item still resolves to a position,
      // so detachment looks like a collapsed range rather than an error).
      if (from === null || to === null || to <= from) continue;

      decorations.push(
        Decoration.inline(
          from,
          to,
          { class: `sone-commented sone-commented-${style}`, 'data-thread': thread.id },
          { inclusiveEnd: false },
        ),
      );
    }
    return DecorationSet.create(state.doc, decorations);
  };

  return new Plugin<DecorationSet>({
    key: commentMarksKey,
    state: {
      init: (_config, state) => build(state),
      apply: (tr, current, _old, state) => {
        // Rebuilt when the document changes, when Yjs applies something, and
        // when the component says the threads have changed. Mapping the old set
        // through the transaction would be cheaper and would drift: a thread
        // whose text was deleted elsewhere has to stop being drawn, and a
        // mapped decoration does not know that.
        if (tr.docChanged || tr.getMeta(ySyncPluginKey) || tr.getMeta(commentMarksKey)) {
          return build(state);
        }
        return current;
      },
    },
    props: {
      decorations: (state) => commentMarksKey.getState(state) ?? DecorationSet.empty,
    },
  });
}
