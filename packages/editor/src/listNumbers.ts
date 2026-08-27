/**
 * SONE — numbered list numbering.
 *
 * Numbers are computed and attached as decorations rather than drawn by CSS.
 *
 * CSS counters cannot do this. Blocks are flat siblings carrying an indent
 * attribute (ADR-0018), so there is no element to hang a `counter-reset` on
 * when a nested run begins or ends — a counter would either run continuously
 * through nested items, or reset on every item. Both are visibly wrong, and no
 * selector expresses "reset when the previous sibling had a smaller indent".
 *
 * So the rules are applied here, where the document structure is actually
 * available:
 *
 *   - a run of numbered items at the same indent numbers 1, 2, 3…
 *   - a deeper run starts again at 1
 *   - returning to a shallower level continues where that level left off
 *   - any non-numbered block at a given indent ends the run at that indent and
 *     everything deeper
 *
 * The last rule is the one people notice: a paragraph between two numbered
 * items restarts the numbering, which is what every word processor does.
 */

import { BLOCK_ATTRS } from '@sone/core';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { readIndent } from './schema.js';

export const listNumberPluginKey = new PluginKey<DecorationSet>('sone-list-numbers');

export interface NumberedItem {
  pos: number;
  indent: number;
  number: number;
}

/**
 * Assign a number to every numbered list item in a document.
 *
 * Exported separately from the plugin so it can be tested without a view, and
 * so a server-side renderer can produce the same numbers as the editor. Those
 * agreeing matters: a page printed or exported with different numbering than
 * the editor showed is a bug people report as data loss.
 */
export function computeListNumbers(doc: PMNode): NumberedItem[] {
  const items: NumberedItem[] = [];
  // Running count per indent level. Index is the indent.
  const counters: number[] = [];

  doc.descendants((node, pos) => {
    // Structural containers restart numbering inside themselves, which falls
    // out of resetting the counters when one is entered.
    if (node.type.name === 'column') {
      counters.length = 0;
      return true;
    }

    if (!node.isBlock || node.type.name === 'doc') return true;
    if (!(BLOCK_ATTRS.id in node.type.spec.attrs!)) return true;

    const indent = readIndent(node.attrs);

    if (node.type.name === 'numberedList') {
      // Anything deeper than this item is a run that has ended.
      counters.length = indent + 1;
      counters[indent] = (counters[indent] ?? 0) + 1;
      items.push({ pos, indent, number: counters[indent]! });
    } else {
      // A non-numbered block ends the run at its own level and below, but
      // leaves shallower runs intact — so a paragraph nested under item 2 does
      // not stop item 3 from following.
      counters.length = indent;
    }

    return true;
  });

  return items;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations = computeListNumbers(doc).map((item) =>
    // A node decoration rather than a widget: a widget would sit inside the
    // editable text and the caret could be placed in it.
    Decoration.node(item.pos, item.pos + (doc.nodeAt(item.pos)?.nodeSize ?? 1), {
      'data-number': String(item.number),
    }),
  );
  return DecorationSet.create(doc, decorations);
}

export function listNumbers(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: listNumberPluginKey,
    state: {
      init: (_config, state) => buildDecorations(state.doc),
      apply: (tr, previous) => {
        // Recomputed only when the document changed. Numbering depends on
        // structure, so a selection change cannot affect it, and recomputing on
        // every keystroke in a long document would be wasteful.
        if (!tr.docChanged) return previous.map(tr.mapping, tr.doc);
        return buildDecorations(tr.doc);
      },
    },
    props: {
      decorations: (state) => listNumberPluginKey.getState(state),
    },
  });
}
