/**
 * The block attributes a table cannot write itself.
 *
 * Enabling `columnResizing` installs prosemirror-tables' own node view, which
 * builds `<div class="tableWrapper"><table>…` in JavaScript and never consults
 * the schema's `toDOM`. So every attribute this project puts on a block —
 * `data-block`, `data-width`, `data-align`, `data-color` — is absent from a
 * table's rendered DOM. The stylesheet says so at length, having lost a release
 * to it, and lived with matching `.ProseMirror table` instead.
 *
 * That workaround covers the styling that is the same for every table. It cannot
 * cover the *per-block* settings, which is why "Column / Wide / Full page" did
 * nothing to a table: the width is in the document and never reaches the page.
 *
 * A node decoration is the way to add attributes to a node whose DOM somebody
 * else builds — it applies to the node view's outer element, which is the
 * wrapper. So the values are read from the node and put back on, and the width
 * rules that work for every other block work here too.
 */

import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { BLOCK_ATTRS } from '@sone/core';

/** The attributes to carry across, and the DOM names they take. */
const CARRIED: ReadonlyArray<[string, string]> = [
  [BLOCK_ATTRS.width, 'data-width'],
  [BLOCK_ATTRS.align, 'data-align'],
  [BLOCK_ATTRS.color, 'data-color'],
  [BLOCK_ATTRS.id, 'data-block-id'],
];

function decorationsFor(doc: PMNode): DecorationSet {
  const found: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;

    const attrs: Record<string, string> = { 'data-block': 'table' };
    for (const [key, name] of CARRIED) {
      const value = node.attrs[key];
      if (typeof value === 'string' && value !== '') attrs[name] = value;
    }
    found.push(Decoration.node(pos, pos + node.nodeSize, attrs));

    // No need to walk into a table: a nested one is not a thing this schema
    // allows, and descending would visit every cell of every table on every
    // document change.
    return false;
  });

  return DecorationSet.create(doc, found);
}

export function tableBlockAttrs(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => decorationsFor(state.doc),
    },
  });
}
