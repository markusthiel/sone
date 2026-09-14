import { BLOCK_ATTRS } from '@sone/core';
import { isBlockLocked } from './blockLock.js';
import { TextSelection, type Transaction } from 'prosemirror-state';

/** Leave a writable paragraph after an embedded task without replacing other content. */
export function continueAfterSote(tr: Transaction, pos: number): boolean {
  const block = tr.doc.nodeAt(pos);
  const paragraph = tr.doc.type.schema.nodes['paragraph'];
  if (block?.type.name !== 'soteTasks' || !paragraph) return false;
  const after = pos + block.nodeSize;
  const next = tr.doc.nodeAt(after);
  // Repeated clicks reuse the blank line; existing writing is never overwritten.
  if (next?.type !== paragraph || next.content.size !== 0 || isBlockLocked(next)) {
    tr.insert(after, paragraph.create({ [BLOCK_ATTRS.indent]: block.attrs[BLOCK_ATTRS.indent] }));
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  return true;
}
