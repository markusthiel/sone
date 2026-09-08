/**
 * SONE — lighting the block somebody was taken to (ADR-0167).
 *
 * ADR-0166 wrote `data-found` straight onto the block's DOM element from the
 * right sidebar. It was reported not working the day it was released, and
 * measuring said why: **ProseMirror owns that element.** Its DOM observer sees
 * the attribute appear, treats it as a change to reconcile, and puts the
 * element back the way the document says — within a tick, which is far too
 * short for anybody to see.
 *
 * A decoration is the one way to put something on a rendered node and have it
 * stay: ProseMirror draws it, so ProseMirror keeps it, and it is mapped through
 * every transaction while it is on.
 *
 * ## It holds an id, not a position
 *
 * The panel that asks knows a block id and nothing else. A position would have
 * to be resolved at the moment of asking and mapped afterwards; the id is what
 * survives an edit anywhere else in the document, including one that moves this
 * block.
 *
 * The cost is a scan of the top level per redraw **while something is lit**,
 * which is a second and a half at a time and nothing at all the rest of the
 * time.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/** Which block is lit, or null. */
export const foundBlockKey = new PluginKey<string | null>('sone-found-block');

/** The transaction meta that turns it on and off. */
const SET_FOUND = 'sone-found-block';

/**
 * Light one block, or none.
 *
 * A transaction rather than a call into the view's DOM, so it goes through the
 * one path everything else here goes through — and so undo, collaboration and
 * a concurrent redraw all see a consistent state rather than an element with an
 * attribute nobody can account for.
 */
export function showFoundBlock(view: EditorView, blockId: string | null): void {
  view.dispatch(view.state.tr.setMeta(SET_FOUND, blockId));
}

/** Which block is currently lit. Exported for tests and for a second reader. */
export function foundBlockId(state: EditorState): string | null {
  return foundBlockKey.getState(state) ?? null;
}

export function foundBlock(): Plugin<string | null> {
  return new Plugin<string | null>({
    key: foundBlockKey,
    state: {
      init: () => null,
      apply(tr, current) {
        const next = tr.getMeta(SET_FOUND) as string | null | undefined;
        // `undefined` is "this transaction said nothing about it"; `null` is
        // "put it out". They are different answers and only one of them is a
        // decision.
        return next === undefined ? current : next;
      },
    },
    props: {
      decorations(state) {
        const wanted = foundBlockKey.getState(state);
        if (!wanted) return DecorationSet.empty;

        const found: Decoration[] = [];
        state.doc.forEach((node, offset) => {
          if (node.attrs[BLOCK_ATTRS.id] !== wanted) return;
          // The attribute the stylesheet already draws (ADR-0166): the ring
          // holds, the pulse is decoration, and only the pulse goes for
          // somebody who asked for less motion.
          found.push(Decoration.node(offset, offset + node.nodeSize, { 'data-found': '' }));
        });
        return found.length > 0 ? DecorationSet.create(state.doc, found) : DecorationSet.empty;
      },
    },
  });
}
