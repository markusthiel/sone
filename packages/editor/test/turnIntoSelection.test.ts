/**
 * Turning several blocks at once (ADR-0165).
 *
 * Reported with four selected lines and a screenshot of the toolbar over them:
 *
 * > Wenn ich mehrere Zeilen Text markiere würde ich diese gerne auch im Verbund
 * > umwandeln können. … Das geht bisher nur einzeln.
 *
 * `toggleBlockType` read `currentBlock(state)` — the one block the selection's
 * *head* is in — and changed that. Its sibling `setBlockStyle`, in the menu
 * right above it, has always walked `nodesBetween(from, to)`: the same menu
 * answered its two questions about the same selection at two different scopes.
 *
 * Headless, because every question here is about a document and none of them is
 * about a view: what four blocks became, what happened to the one in the middle
 * that cannot hold text, and whether the ids survived.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';

import { blockIds } from '../src/blockIds.js';
import { soneKeymap, toggleBlockType } from '../src/keymap.js';
import { schema } from '../src/schema.js';

let idCounter = 0;
const deterministicId = (): string =>
  `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

function stateWith(docJSON: unknown): EditorState {
  return EditorState.create({
    schema,
    doc: schema.nodeFromJSON(docJSON),
    plugins: [...soneKeymap(), blockIds({ generateId: deterministicId })],
  });
}

const line = (type: string, text: string, id: string, indent?: number) => ({
  type,
  attrs: {
    [BLOCK_ATTRS.id]: id,
    [BLOCK_ATTRS.props]: null,
    [BLOCK_ATTRS.indent]: indent ? String(indent) : null,
  },
  content: [{ type: 'text', text }],
});

const divider = (id: string) => ({
  type: 'divider',
  attrs: { [BLOCK_ATTRS.id]: id, [BLOCK_ATTRS.props]: null, [BLOCK_ATTRS.indent]: null },
});

function run(state: EditorState, command: Command, label: string): EditorState {
  let next: EditorState | null = null;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  assert.ok(applied, `command did not apply: ${label}`);
  assert.ok(next, `command applied but dispatched nothing: ${label}`);
  return next!;
}

/** Select from inside the first block to inside the last one. */
function selectAcross(state: EditorState, from: number, to: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

const names = (state: EditorState): string[] => {
  const found: string[] = [];
  state.doc.forEach((node) => found.push(node.type.name));
  return found;
};

const bullet = schema.nodes['bulletList']!;
const heading = schema.nodes['heading']!;

/** The four lines from the report. */
const FOUR = {
  type: 'doc',
  content: [
    line('paragraph', 'Überblick Räumlichkeiten', 'a'),
    line('paragraph', 'Anmeldungen', 'b'),
    line('paragraph', 'Programmbeiträge', 'c'),
    line('paragraph', 'Mail Erinnerung', 'd'),
  ],
};

test('four selected paragraphs become four bullets', () => {
  let state = stateWith(FOUR);
  // From inside the first to inside the last, which is what dragging does.
  state = selectAcross(state, 2, state.doc.content.size - 2);

  state = run(state, toggleBlockType(bullet), 'to bullets');
  assert.deepEqual(names(state), ['bulletList', 'bulletList', 'bulletList', 'bulletList']);
});

test('and their ids come with them', () => {
  // A type change is not a new block. Four new ids would orphan every comment,
  // every link and every outline entry pointing at them — four times over.
  let state = stateWith(FOUR);
  state = selectAcross(state, 2, state.doc.content.size - 2);
  state = run(state, toggleBlockType(bullet), 'to bullets');

  const ids: unknown[] = [];
  state.doc.forEach((node) => ids.push(node.attrs[BLOCK_ATTRS.id]));
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
});

test('pressing it again turns all four back', () => {
  let state = stateWith({
    type: 'doc',
    content: [
      line('bulletList', 'eins', 'a'),
      line('bulletList', 'zwei', 'b'),
      line('bulletList', 'drei', 'c'),
    ],
  });
  state = selectAcross(state, 2, state.doc.content.size - 2);

  state = run(state, toggleBlockType(bullet), 'back to paragraphs');
  assert.deepEqual(names(state), ['paragraph', 'paragraph', 'paragraph']);
});

test('a mixed selection is made the same, not flipped one by one', () => {
  /*
   * Two bullets and two paragraphs, and the answer is four bullets.
   *
   * Flipping each block on its own would swap the two kinds and leave the
   * selection as mixed as it was — pressing "bullet list" and getting a
   * different mixture is the one outcome nobody is asking for. It turns back
   * only when every selected block is already that type.
   */
  let state = stateWith({
    type: 'doc',
    content: [
      line('bulletList', 'eins', 'a'),
      line('paragraph', 'zwei', 'b'),
      line('bulletList', 'drei', 'c'),
      line('paragraph', 'vier', 'd'),
    ],
  });
  state = selectAcross(state, 2, state.doc.content.size - 2);

  state = run(state, toggleBlockType(bullet), 'all of them');
  assert.deepEqual(names(state), ['bulletList', 'bulletList', 'bulletList', 'bulletList']);
});

test('a block that cannot hold text is stepped over', () => {
  // A divider in the middle of the selection is not a line of writing, and
  // refusing the whole conversion because one is in the way would make the
  // command fail for a reason nobody can see.
  let state = stateWith({
    type: 'doc',
    content: [line('paragraph', 'eins', 'a'), divider('b'), line('paragraph', 'zwei', 'c')],
  });
  state = selectAcross(state, 2, state.doc.content.size - 2);

  state = run(state, toggleBlockType(bullet), 'around the divider');
  assert.deepEqual(names(state), ['bulletList', 'divider', 'bulletList']);
});

test('each block keeps its own indent', () => {
  // Indent is a property of the block, not of the conversion: four lines at
  // three different depths are still at three different depths afterwards.
  let state = stateWith({
    type: 'doc',
    content: [
      line('paragraph', 'eins', 'a'),
      line('paragraph', 'zwei', 'b', 1),
      line('paragraph', 'drei', 'c', 2),
    ],
  });
  state = selectAcross(state, 2, state.doc.content.size - 2);
  state = run(state, toggleBlockType(bullet), 'to bullets');

  const indents: unknown[] = [];
  state.doc.forEach((node) => indents.push(node.attrs[BLOCK_ATTRS.indent]));
  assert.deepEqual(indents, [null, '1', '2']);
});

test('a caret in one block still turns that one block', () => {
  // The behaviour every shortcut and the block menu already had. A selection of
  // nothing is a selection of the block it sits in.
  let state = stateWith(FOUR);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));

  state = run(state, toggleBlockType(heading, { level: 2 }), 'to heading');
  assert.deepEqual(names(state), ['heading', 'paragraph', 'paragraph', 'paragraph']);
  assert.equal(state.doc.firstChild!.attrs['level'], 2);
});
