/**
 * SONE — a copy button on code blocks.
 *
 * A widget decoration rather than part of the node's rendering, for the same
 * reason the checkbox and the disclosure triangle are: it must be a real
 * element that can take a click, and it must not be inside the editable content
 * where the caret could land in it or a copy of the block could pick it up.
 *
 * The button reads the block's text from the document rather than from the DOM.
 * Reading the DOM would pick up whatever the renderer added — soft-wrap
 * markers, a syntax highlighter's spans, the button's own label — and quietly
 * copy something that is not what is on screen.
 */

import { BLOCK_ATTRS } from '@sone/core';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

export const codeCopyPluginKey = new PluginKey<DecorationSet>('sone-code-copy');

/** How long the button says it worked before going back to normal. */
const CONFIRM_MS = 1400;

function build(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'code') return;
    decorations.push(
      Decoration.widget(offset + 1, () => button(node.textContent), {
        side: -1,
        ignoreSelection: true,
        // No marks, so the button is never part of a copied range.
        marks: [],
      }),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

function button(text: string): HTMLElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'sone-code-copy';
  element.textContent = 'Copy';
  element.setAttribute('aria-label', 'Copy the code');
  element.contentEditable = 'false';

  element.addEventListener('click', (event) => {
    event.preventDefault();
    // Stopped here, or the click reaches the editor and moves the caret into
    // the block that was just copied.
    event.stopPropagation();

    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        element.textContent = 'Copied';
        element.dataset['state'] = 'done';
      })
      .catch(() => {
        // Clipboard access can be refused, and over plain http it does not
        // exist at all. Saying so beats a button that silently does nothing.
        element.textContent = 'Press ⌘C';
        element.dataset['state'] = 'failed';
      })
      .finally(() => {
        setTimeout(() => {
          element.textContent = 'Copy';
          delete element.dataset['state'];
        }, CONFIRM_MS);
      });
  });

  return element;
}

export function codeCopy(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeCopyPluginKey,
    state: {
      init: (_config, state) => build(state),
      apply: (tr, previous, _old, state) => {
        // Rebuilt only when the document changes: the button carries the text
        // it will copy, so editing a code block has to produce a new one.
        if (!tr.docChanged) return previous.map(tr.mapping, tr.doc);
        return build(state);
      },
    },
    props: {
      decorations: (state) => codeCopyPluginKey.getState(state),
    },
  });
}

/**
 * The text of the code around the selection, block or inline.
 *
 * Used by the formatting toolbar, so a phrase marked as code can be copied
 * without selecting it precisely. Returns null when the selection is not in
 * code at all, which is what tells the toolbar whether to offer the button.
 */
export function codeTextAt(state: EditorState): string | null {
  const { $from, empty } = state.selection;

  // A code block: the whole block, whatever is selected inside it.
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'code') return node.textContent;
  }

  // `inlineCode`, which is what the schema calls it — a first version looked
  // for 'code' and silently found nothing, so the button never appeared for
  // inline code at all.
  const codeMark = state.schema.marks['inlineCode'];
  if (!codeMark) return null;

  const inCode = empty
    ? codeMark.isInSet(state.storedMarks ?? $from.marks()) !== undefined
    : state.doc.rangeHasMark(state.selection.from, state.selection.to, codeMark);
  if (!inCode) return null;

  // The whole run of code, not just the selected part.
  //
  // Somebody who marked three words as code and put the caret in the middle
  // means those three words. Copying the selection would copy nothing, and
  // asking them to select it exactly is the work the button exists to avoid.
  const parent = $from.parent;
  const start = $from.parentOffset;

  let from = start;
  let to = start;
  parent.forEach((child, childOffset) => {
    if (!child.isText || !codeMark.isInSet(child.marks)) return;
    const childEnd = childOffset + child.nodeSize;
    if (childOffset <= start && start <= childEnd) {
      from = Math.min(from, childOffset);
      to = Math.max(to, childEnd);
    }
  });

  if (from === to) return null;
  return parent.textBetween(from, to);
}
