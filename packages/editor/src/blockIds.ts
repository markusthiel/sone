/**
 * SONE — block id assignment.
 *
 * Every block needs a stable, globally unique id: `blocks.id` is a primary key
 * in the projection, and a duplicate is refused rather than silently
 * reassigned (ADR-0015). Two situations produce blocks without one, and both
 * happen constantly:
 *
 *   - typing Enter, which splits a block and copies its attributes including
 *     the id
 *   - pasting, whether from inside SONE or from another application
 *
 * So ids cannot be a schema default. This plugin runs after every transaction
 * and assigns one to any block that lacks it or that shares it with a block
 * seen earlier in the document.
 *
 * The "seen earlier" rule is what makes Enter work: the split leaves two nodes
 * with the same id, the first keeps it, and the second gets a fresh one. Which
 * of the two keeps the original is arbitrary but must be consistent — document
 * order is the only ordering available, so the earlier one wins.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';

export const blockIdPluginKey = new PluginKey('sone-block-ids');

/**
 * Id generator.
 *
 * `crypto.randomUUID` where available. Blocks ids must be unique across the
 * whole instance, not merely within a document, because the projection keys on
 * them globally — so a counter or a document-local scheme is not enough.
 */
export type IdGenerator = () => string;

const defaultIdGenerator: IdGenerator = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for environments without the Web Crypto API. Not
  // cryptographically strong, but ids are identifiers rather than secrets.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
};

/** Does this node type carry block attributes? */
const isBlock = (node: PMNode): boolean =>
  node.type.spec.attrs !== undefined && BLOCK_ATTRS.id in node.type.spec.attrs;

/**
 * Find blocks needing an id.
 *
 * Returns positions and the id to set, or an empty array when nothing needs
 * changing — which is the common case, and returning early avoids appending an
 * empty transaction to every keystroke.
 */
function collectFixes(
  doc: PMNode,
  generate: IdGenerator,
): Array<{ pos: number; id: string }> {
  const fixes: Array<{ pos: number; id: string }> = [];
  const seen = new Set<string>();

  doc.descendants((node, pos) => {
    if (!isBlock(node)) return true;

    const id = node.attrs[BLOCK_ATTRS.id];
    if (typeof id !== 'string' || id === '' || seen.has(id)) {
      fixes.push({ pos, id: generate() });
    } else {
      seen.add(id);
    }
    return true;
  });

  return fixes;
}

export interface BlockIdOptions {
  /** Injected in tests so ids are deterministic. */
  generateId?: IdGenerator;
}

export function blockIds(options: BlockIdOptions = {}): Plugin {
  const generate = options.generateId ?? defaultIdGenerator;

  return new Plugin({
    key: blockIdPluginKey,

    /**
     * Assign ids as an appended transaction rather than by filtering.
     *
     * Appending keeps the user's transaction intact, so undo history and
     * collaborative updates see the edit the user made plus a separate
     * housekeeping step, rather than a rewritten version of their edit.
     */
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const fixes = collectFixes(newState.doc, generate);
      if (fixes.length === 0) return null;

      const tr = newState.tr;
      for (const fix of fixes) {
        const node = tr.doc.nodeAt(fix.pos);
        if (!node) continue;
        tr.setNodeAttribute(fix.pos, BLOCK_ATTRS.id, fix.id);
      }

      // Not added to the undo stack: undoing an id assignment would leave a
      // block without one, and the plugin would immediately assign a different
      // one, making undo appear to do nothing while changing the document.
      tr.setMeta('addToHistory', false);
      // Marked so other plugins can recognise this as housekeeping.
      tr.setMeta(blockIdPluginKey, true);
      return tr;
    },
  });
}

/**
 * Ensure ids on a document outside the editor.
 *
 * Used when importing or seeding a page, where there is no editor state to
 * append a transaction to.
 *
 * Rebuilds the tree rather than patching positions. The first attempt used
 * `Node.replace` with a single-node slice, which produces "Invalid content for
 * node doc" — replacing a range with a slice is not the same operation as
 * changing one node's attributes, and the difference only shows up at runtime.
 *
 * Nodes are visited in document order and a node is checked before its
 * children, so the same "earlier block keeps the id" rule applies as in the
 * plugin.
 */
export function assignMissingIds(
  doc: PMNode,
  generate: IdGenerator = defaultIdGenerator,
): PMNode {
  const seen = new Set<string>();

  const rebuild = (node: PMNode): PMNode => {
    if (node.isText) return node;

    let attrs = node.attrs;
    if (isBlock(node)) {
      const id = attrs[BLOCK_ATTRS.id];
      if (typeof id !== 'string' || id === '' || seen.has(id)) {
        attrs = { ...attrs, [BLOCK_ATTRS.id]: generate() };
        seen.add(attrs[BLOCK_ATTRS.id] as string);
      } else {
        seen.add(id);
      }
    }

    const children: PMNode[] = [];
    node.forEach((child) => children.push(rebuild(child)));

    return node.type.create(attrs, Fragment.fromArray(children), node.marks);
  };

  return rebuild(doc);
}

/** True when a transaction was produced by this plugin. */
export const isBlockIdHousekeeping = (tr: Transaction): boolean =>
  tr.getMeta(blockIdPluginKey) === true;

/** Every block id in a document, in document order. Used by tests. */
export function collectBlockIds(state: EditorState | PMNode): string[] {
  const doc = 'doc' in state ? state.doc : state;
  const ids: string[] = [];
  doc.descendants((node) => {
    if (isBlock(node)) {
      const id = node.attrs[BLOCK_ATTRS.id];
      if (typeof id === 'string') ids.push(id);
    }
    return true;
  });
  return ids;
}
