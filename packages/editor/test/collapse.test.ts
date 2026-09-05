/**
 * Collapsing toggles.
 *
 * A toggle's children are the following blocks with a greater indent
 * (ADR-0018), so collapsing hides a run rather than changing structure. The rule
 * for which blocks are in that run is where this is either right or quietly
 * wrong.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import {
  collapse,
  collapsePluginKey,
  hiddenBlockPositions,
  hiddenChildCount,
  toggleCollapsed,
} from '../src/collapse.js';
import { schema } from '../src/schema.js';

const block = (
  type: string,
  text: string,
  id: string,
  indent = 0,
  attrs: Record<string, unknown> = {},
) => ({
  type,
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: indent > 0 ? String(indent) : null,
    ...attrs,
  },
  content: text ? [{ type: 'text', text }] : undefined,
});

const docOf = (content: unknown[]) =>
  schema.nodeFromJSON({ type: 'doc', content });

/** Text of the blocks a collapsed toggle hides. */
function hiddenTexts(content: unknown[]): string[] {
  const doc = docOf(content);
  return hiddenBlockPositions(doc).map((pos) => doc.nodeAt(pos)!.textContent);
}

test('an expanded toggle hides nothing', () => {
  assert.deepEqual(
    hiddenTexts([
      block('toggle', 'open', 't1', 0, { collapsed: false }),
      block('paragraph', 'child', 'p1', 1),
    ]),
    [],
  );
});

test('a collapsed toggle hides its indented children', () => {
  assert.deepEqual(
    hiddenTexts([
      block('toggle', 'closed', 't1', 0, { collapsed: true }),
      block('paragraph', 'child a', 'p1', 1),
      block('paragraph', 'child b', 'p2', 1),
      block('paragraph', 'after', 'p3', 0),
    ]),
    ['child a', 'child b'],
    'and nothing at or above its own level',
  );
});

test('a collapsed toggle hides deeper descendants too', () => {
  assert.deepEqual(
    hiddenTexts([
      block('toggle', 'closed', 't1', 0, { collapsed: true }),
      block('paragraph', 'child', 'p1', 1),
      block('paragraph', 'grandchild', 'p2', 2),
      block('paragraph', 'after', 'p3', 0),
    ]),
    ['child', 'grandchild'],
  );
});

test('the toggle itself is never hidden', () => {
  // Hiding the row that opens it would make a collapsed toggle unreachable.
  const texts = hiddenTexts([
    block('toggle', 'closed', 't1', 0, { collapsed: true }),
    block('paragraph', 'child', 'p1', 1),
  ]);
  assert.ok(!texts.includes('closed'));
});

test('a nested collapsed toggle needs no separate handling', () => {
  // Its children are already inside the outer toggle's run, so counting them
  // twice would be the bug to avoid.
  const positions = hiddenBlockPositions(
    docOf([
      block('toggle', 'outer', 't1', 0, { collapsed: true }),
      block('toggle', 'inner', 't2', 1, { collapsed: true }),
      block('paragraph', 'deep', 'p1', 2),
      block('paragraph', 'after', 'p2', 0),
    ]),
  );
  assert.equal(positions.length, 2, 'the inner toggle and its child, once each');
  assert.equal(new Set(positions).size, 2, 'no duplicates');
});

test('two collapsed toggles hide their own runs', () => {
  assert.deepEqual(
    hiddenTexts([
      block('toggle', 'first', 't1', 0, { collapsed: true }),
      block('paragraph', 'in first', 'p1', 1),
      block('toggle', 'second', 't2', 0, { collapsed: true }),
      block('paragraph', 'in second', 'p2', 1),
    ]),
    ['in first', 'in second'],
  );
});

test('a collapsed toggle with no children hides nothing', () => {
  assert.deepEqual(
    hiddenTexts([
      block('toggle', 'empty', 't1', 0, { collapsed: true }),
      block('paragraph', 'sibling', 'p1', 0),
    ]),
    [],
  );
});

test('the hidden count is what the marker shows', () => {
  // A collapsed toggle with no indication of content is indistinguishable from
  // an empty one.
  const doc = docOf([
    block('toggle', 'closed', 't1', 0, { collapsed: true }),
    block('paragraph', 'a', 'p1', 1),
    block('paragraph', 'b', 'p2', 2),
    block('paragraph', 'after', 'p3', 0),
  ]);
  assert.equal(hiddenChildCount(doc, 0), 2);
});

test('the gutter is widened for the count, by its digits', () => {
  /*
   * The marker is absolutely positioned in a 1.4em gutter and the count sits
   * inside it, so from ten upwards it ran out and printed over the first word
   * — reported with a screenshot reading "15Code Week" (ADR-0092).
   *
   * Only the document knows how wide it needs to be, and only the stylesheet
   * can reserve the space before anything is laid out. So the plugin puts the
   * digit count on the node and the stylesheet has a step per width.
   */
  const state = EditorState.create({
    schema,
    doc: docOf([
      block('toggle', 'closed', 't1', 0, { collapsed: true }),
      // Twelve, so the count is two digits — the case that overflowed.
      ...Array.from({ length: 12 }, (_unused, at) =>
        block('paragraph', `p${at}`, `id${at}`, 1),
      ),
    ]),
    plugins: [collapse()],
  });
  const set = collapsePluginKey.getState(state)!;
  const node = set
    .find()
    .map((one) => one as unknown as { type: { attrs?: Record<string, string> } })
    .find((one) => one.type.attrs?.['data-count-digits'] !== undefined);

  assert.ok(node, 'the block carries the width it needs');
  assert.equal(node!.type.attrs!['data-count-digits'], '2');
});

test('collapsing is a document change, so it is the same for everyone', () => {
  // Stored in the document rather than per browser: a toggle in a shared page
  // that is open for one person and closed for another is confusing when two
  // people are looking at it together.
  let state = EditorState.create({
    schema,
    doc: docOf([
      block('toggle', 'closed', 't1', 0, { collapsed: false }),
      block('paragraph', 'child', 'p1', 1),
    ]),
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));

  let next: EditorState | null = null;
  const applied = toggleCollapsed(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(applied);
  assert.equal(next!.doc.firstChild!.attrs['collapsed'], true);

  // And back.
  state = next!;
  toggleCollapsed(state, (tr) => {
    next = state.apply(tr);
  });
  assert.equal(next!.doc.firstChild!.attrs['collapsed'], false);
});

test('collapsing refuses outside a toggle', () => {
  let state = EditorState.create({
    schema,
    doc: docOf([block('paragraph', 'text', 'p1')]),
  });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  assert.equal(toggleCollapsed(state, undefined), false);
});

test('hidden content stays in the document', () => {
  // Decorated rather than removed. Removing would make collapsing an edit, and
  // expanding would have to reconstruct content — a design where a lost
  // expansion loses text.
  const doc = docOf([
    block('toggle', 'closed', 't1', 0, { collapsed: true }),
    block('paragraph', 'still here', 'p1', 1),
  ]);
  assert.equal(doc.childCount, 2);
  assert.match(doc.textContent, /still here/);
});
