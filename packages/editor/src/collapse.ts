/**
 * SONE — collapsing toggles, and clickable block markers.
 *
 * Two features from one plugin, because they are the same problem: a block whose
 * marker has to be clickable, in a document where markers are drawn by CSS
 * rather than being real elements.
 *
 * ## Collapsing
 *
 * A toggle's children are the following blocks with a greater indent
 * (ADR-0018), so collapsing is not a structural change — the blocks stay where
 * they are and are hidden. That has a consequence worth stating: a collapsed
 * toggle's content is still in the document, still synced, still searchable,
 * and still materialised. Collapsing is a view state that happens to be stored
 * in the document so it is the same for everyone, which is what people expect
 * of a toggle in a shared page.
 *
 * Hidden blocks are decorated rather than removed. Removing them would make
 * collapsing an edit, and expanding would have to reconstruct content — a
 * design where a lost expansion loses text.
 *
 * ## Markers
 *
 * A todo's checkbox and a toggle's triangle were drawn with CSS `::before`,
 * which cannot be clicked. So the only way to tick a box was a keyboard
 * shortcut, and the only way to open a toggle was nothing at all. Both are now
 * widget decorations: real elements, outside the editable content, that do not
 * appear in the document or in a copy.
 */

import { BLOCK_ATTRS } from '@sone/core';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { readIndent } from './schema.js';

export const collapsePluginKey = new PluginKey<DecorationSet>('sone-collapse');

const isBlock = (node: PMNode): boolean =>
  node.type.spec.attrs !== undefined && BLOCK_ATTRS.id in node.type.spec.attrs;

/**
 * Positions of blocks hidden by a collapsed toggle.
 *
 * A collapsed toggle hides the following blocks with a greater indent, up to the
 * first at the same level or shallower. A collapsed toggle *inside* a hidden run
 * needs no separate handling: its children are already hidden by the outer one.
 *
 * Pure and exported, because this rule is where collapsing is either right or
 * quietly wrong and it is worth testing without a view.
 */
export function hiddenBlockPositions(doc: PMNode): number[] {
  const hidden: number[] = [];

  // Indent of the shallowest collapsed toggle whose run we are inside, or null.
  let hidingFrom: number | null = null;

  doc.forEach((node, offset) => {
    if (!isBlock(node)) return;
    const indent = readIndent(node.attrs);

    if (hidingFrom !== null) {
      if (indent > hidingFrom) {
        hidden.push(offset);
        return;
      }
      // Back at or above the toggle's level: the run has ended.
      hidingFrom = null;
    }

    if (node.type.name === 'toggle' && node.attrs['collapsed'] === true) {
      hidingFrom = indent;
    }
  });

  return hidden;
}

/** How many blocks a toggle is hiding, for a count on the marker. */
export function hiddenChildCount(doc: PMNode, togglePos: number): number {
  let count = 0;
  let started = false;
  let toggleIndent = 0;

  doc.forEach((node, offset) => {
    if (!isBlock(node)) return;
    if (offset === togglePos) {
      started = true;
      toggleIndent = readIndent(node.attrs);
      return;
    }
    if (!started) return;
    if (readIndent(node.attrs) > toggleIndent) count += 1;
    else started = false;
  });

  return count;
}

/**
 * Flip a block's boolean attribute.
 *
 * Used for a toggle's `collapsed` and a todo's `checked`. One command rather
 * than two, because the difference between them is the attribute name.
 */
export function flipAttribute(pos: number, attribute: string): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || !(attribute in node.attrs)) return false;

    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          [attribute]: node.attrs[attribute] !== true,
        }),
      );
    }
    return true;
  };
}

/** Collapse or expand the toggle containing the selection. */
export const toggleCollapsed: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'toggle') {
      return flipAttribute($from.before(depth), 'collapsed')(state, dispatch);
    }
  }
  return false;
};

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const doc = state.doc;

  for (const pos of hiddenBlockPositions(doc)) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { class: 'sone-collapsed-hidden' }),
    );
  }

  // Markers. A widget rather than a node decoration, because it needs to be a
  // real element that can take a click and must not be part of the text.
  doc.forEach((node, offset) => {
    if (node.type.name === 'todo') {
      decorations.push(
        Decoration.widget(offset + 1, () => todoMarker(node), {
          // Left of the content, and ignored by the selection so the caret
          // cannot land inside it.
          side: -1,
          ignoreSelection: true,
          // Excluded from a copy: pasting a checkbox character into another
          // application is not what anybody meant.
          marks: [],
        }),
      );
    }

    if (node.type.name === 'toggle') {
      const count = node.attrs['collapsed'] === true ? hiddenChildCount(doc, offset) : 0;
      decorations.push(
        Decoration.widget(offset + 1, () => toggleMarker(node, count), {
          side: -1,
          ignoreSelection: true,
          marks: [],
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function todoMarker(node: PMNode): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sone-todo-marker';
  button.setAttribute('data-checked', String(node.attrs['checked'] === true));
  button.setAttribute(
    'aria-label',
    node.attrs['checked'] === true ? 'Mark as not done' : 'Mark as done',
  );
  // contentEditable false, or the browser treats the button as text to edit and
  // a keystroke can end up inside it.
  button.contentEditable = 'false';
  return button;
}

function toggleMarker(node: PMNode, hiddenCount: number): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sone-toggle-marker';
  const collapsed = node.attrs['collapsed'] === true;
  button.setAttribute('data-collapsed', String(collapsed));
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
  button.contentEditable = 'false';

  if (collapsed && hiddenCount > 0) {
    // The count is the difference between "this is closed" and "there is
    // something in here". A collapsed toggle with no indication of content is
    // indistinguishable from an empty one.
    const badge = document.createElement('span');
    badge.className = 'sone-toggle-count';
    badge.textContent = String(hiddenCount);
    badge.contentEditable = 'false';
    button.appendChild(badge);
  }

  return button;
}

export function collapse(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: collapsePluginKey,
    state: {
      init: (_config, state) => buildDecorations(state),
      apply: (tr, previous, _old, state) => {
        // Rebuilt on a document change only. Collapsing and checking are
        // document changes, and a selection move cannot alter either.
        if (!tr.docChanged) return previous.map(tr.mapping, tr.doc);
        return buildDecorations(state);
      },
    },
    props: {
      decorations: (state) => collapsePluginKey.getState(state),

      /**
       * Handle a click on a marker.
       *
       * `handleDOMEvents.mousedown` rather than `handleClick`: ProseMirror maps
       * a click to a document position, and a widget has no position of its own
       * — the click would be attributed to the text beside it and move the
       * caret instead.
       */
      handleDOMEvents: {
        mousedown: (view: EditorView, event: Event) => {
          const target = event.target as HTMLElement | null;
          const marker = target?.closest?.(
            '.sone-todo-marker, .sone-toggle-marker',
          ) as HTMLElement | null;
          if (!marker) return false;

          // The block the marker belongs to, found through the DOM because the
          // widget is not in the document.
          const blockElement = marker.closest('[data-block-id]');
          if (!blockElement) return false;
          const blockId = blockElement.getAttribute('data-block-id');
          if (!blockId) return false;

          let found: number | null = null;
          view.state.doc.forEach((node, offset) => {
            if (found === null && node.attrs[BLOCK_ATTRS.id] === blockId) found = offset;
          });
          if (found === null) return false;

          event.preventDefault();
          const attribute = marker.classList.contains('sone-todo-marker')
            ? 'checked'
            : 'collapsed';
          flipAttribute(found, attribute)(view.state, view.dispatch);
          return true;
        },
      },
    },
  });
}
