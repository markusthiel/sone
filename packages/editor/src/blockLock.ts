/**
 * SONE editor — locking a single block (ADR-0049).
 *
 * The case the page lock cannot serve: a page of working notes with one table of
 * figures that must not move.
 *
 * `locked: true` in a block's props, and one `filterTransaction` that refuses
 * any transaction whose steps touch a locked block. One place, for the reason
 * the page lock goes through `editable`: fifteen guarded commands are fifteen
 * chances for one to be forgotten, and the forgotten one is a hole nobody finds
 * until a locked block changes.
 *
 * A filter rather than read-only nodes, because ProseMirror has no per-node
 * editability. What it does have is the chance to reject a transaction before it
 * is applied, which is exactly the question being asked: would this change a
 * block somebody locked?
 *
 * Like the page lock, this is a guard and not a permission — anybody who may
 * edit the page may unlock the block.
 */

import type { Node as PMNode } from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { BLOCK_ATTRS } from '@sone/core';

import { readProps, writeProps } from './schema.js';

export const blockLockKey = new PluginKey('sone-block-lock');

/** Is this node locked? */
export function isBlockLocked(node: PMNode): boolean {
  return readProps(node.attrs as Record<string, unknown>)['locked'] === true;
}

/** Every locked block's range in the document. */
function lockedRanges(state: EditorState): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  state.doc.descendants((node, pos) => {
    if (!node.isBlock) return true;
    if (isBlockLocked(node as PMNode)) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
      // Its children are inside it and covered by the range; no need to walk
      // into a locked table to find its cells.
      return false;
    }
    return true;
  });
  return ranges;
}

/**
 * Refuse a transaction that would change a locked block.
 *
 * Only the steps that replace content are inspected. A selection change, a
 * decoration rebuild or a mark on somebody else's paragraph are not edits to
 * this block, and rejecting them would make a locked block break the editor
 * around it rather than protect itself.
 */
export function blockLock(): Plugin {
  return new Plugin({
    key: blockLockKey,
    props: {
      /*
       * A locked block says so.
       *
       * Without this the only sign is that typing does nothing, which reads as
       * a broken editor rather than a locked block. A node decoration rather
       * than an attribute in the document: how a block is *drawn* is this
       * editor's business, and writing a presentation attribute into everybody's
       * document to style it here would be the wrong place for it.
       */
      decorations: (state) => {
        const found: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isBlock) return true;
          if (isBlockLocked(node as PMNode)) {
            found.push(Decoration.node(pos, pos + node.nodeSize, { 'data-locked': 'true' }));
            return false;
          }
          return true;
        });
        return DecorationSet.create(state.doc, found);
      },
    },
    filterTransaction: (tr: Transaction, state: EditorState) => {
      if (!tr.docChanged) return true;
      /*
       * Another client's change is never refused.
       *
       * A lock is a statement about this interface, not a fence around the
       * document: an edit that arrives over sync has already happened
       * elsewhere, and rejecting it here would make this client's document
       * differ from everybody else's — which is the divergence ADR-0002 exists
       * to prevent. The same reasoning as the page lock's, one layer down.
       */
      if (tr.getMeta('y-sync$') || tr.getMeta('addToHistory') === false) return true;

      /*
       * The lock's own change, which must never be refused.
       *
       * I had written that an attribute change is not a `ReplaceStep` and
       * therefore safe. It is not: `setNodeMarkup` produces a
       * `ReplaceAroundStep`, so locking a block also locked away the only way
       * to unlock it. The test that tried to unlock found it, which is the whole
       * reason to write a test that undoes what the previous one did.
       *
       * A meta rather than an exception for attribute-only steps: "does this
       * step change content" is a judgement, and a transaction saying what it is
       * for cannot be wrong about it.
       */
      if (tr.getMeta(blockLockKey) === 'set') return true;

      const ranges = lockedRanges(state);
      if (ranges.length === 0) return true;

      for (const step of tr.steps) {
        if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) continue;
        const { from, to } = step as unknown as { from: number; to: number };
        for (const range of ranges) {
          // Touching a locked block's inside, or replacing across it. A step
          // that ends exactly where a locked block begins is an edit to the
          // paragraph above it, which is why the comparison is strict.
          if (from < range.to && to > range.from) return false;
        }
      }
      return true;
    },
  });
}

/**
 * Lock or unlock the blocks the selection touches.
 *
 * Locking has to be possible *while* something is locked, or a block could never
 * be unlocked. The transaction says so with a meta, because `setNodeMarkup`
 * produces a `ReplaceAroundStep` like any other structural change — my first
 * version assumed an attribute change was invisible to the filter and locked
 * away the only way out.
 */
export function setBlockLocked(locked: boolean): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const targets: Array<{ pos: number; node: PMNode }> = [];

    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isBlock && node.type.spec.group?.includes('block')) {
        targets.push({ pos, node: node as PMNode });
      }
      return true;
    });

    if (targets.length === 0) return false;
    if (!dispatch) return true;

    // Announced, so the filter above lets it through — see the comment there.
    const tr = state.tr.setMeta(blockLockKey, 'set');
    for (const target of targets) {
      const props = readProps(target.node.attrs as Record<string, unknown>);
      // Deleted rather than set to false, like every other optional property: a
      // block nobody has locked carries nothing.
      if (locked) props['locked'] = true;
      else delete props['locked'];

      tr.setNodeMarkup(target.pos, undefined, {
        ...target.node.attrs,
        [BLOCK_ATTRS.props]: writeProps(props),
      });
    }

    dispatch(tr);
    return true;
  };
}
