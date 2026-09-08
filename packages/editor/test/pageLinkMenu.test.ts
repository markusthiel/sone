/**
 * When `[[` means *link a page* (ADR-0173).
 *
 * The third menu of this shape — after the slash menu and the mentions — and
 * the trigger is the part that is new. `/` is rare in prose and `@` is not, and
 * each got a rule to match. `[[` is rarer than either, but it is **two**
 * characters, and that changes what the opening test has to say: a single `[`
 * must open nothing, or the menu appears while somebody is writing a markdown
 * link or a footnote and captures the Enter that ends their line.
 *
 * Driven through real transactions rather than by calling `apply` by hand: what
 * is under test is when the menu opens and closes as somebody types, and that
 * is a sequence of transactions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { pageLinkMenu, pageLinkMenuState } from '../src/pageLinkMenu.js';
import { schema } from '../src/schema.js';

/** A document with one paragraph, and the caret at its end. */
function editing(text: string): EditorState {
  const paragraph = schema.nodes['paragraph']!.create(
    { [BLOCK_ATTRS.id]: 'p1' },
    text === '' ? null : schema.text(text),
  );
  const state = EditorState.create({
    doc: schema.nodes['doc']!.create(null, [paragraph]),
    plugins: [pageLinkMenu()],
  });
  return state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(state.doc.content.size))),
  );
}

/** Type text one character at a time, as somebody actually does. */
function type(state: EditorState, text: string): EditorState {
  let current = state;
  for (const character of text) {
    current = current.apply(current.tr.insertText(character, current.selection.head));
  }
  return current;
}

test('two brackets at the start of a block open the menu', () => {
  const state = type(editing(''), '[[');
  assert.deepEqual(pageLinkMenuState(state), { from: 1, query: '' });
});

test('one bracket opens nothing', () => {
  /*
   * The case that makes a two-character trigger different from `@`. A single
   * `[` is the beginning of a markdown link, a footnote marker, a citation —
   * and a menu over any of those captures Enter for the rest of the paragraph.
   */
  assert.equal(pageLinkMenuState(type(editing(''), '[')), null);
  assert.equal(pageLinkMenuState(type(editing('siehe '), '[1]')), null);
});

test('and neither does a bracket in the middle of a word', () => {
  // The same boundary rule the mentions use: at the start of a block, or after
  // whitespace or an opening bracket.
  assert.equal(pageLinkMenuState(type(editing(''), 'a[[')), null);
});

test('what follows becomes the query, spaces included', () => {
  // A page title has spaces in it — "Satzung des Vereins" — so a space cannot
  // close this the way it closes the slash menu.
  const state = type(editing(''), '[[Satzung des');
  assert.equal(pageLinkMenuState(state)?.query, 'Satzung des');
});

test('deleting a bracket closes it again', () => {
  // The trigger is re-read from the document on every transaction, so undoing
  // the thing that opened the menu closes it.
  const open = type(editing(''), '[[Satz');
  assert.ok(pageLinkMenuState(open));
  const shortened = open.apply(open.tr.delete(1, 3));
  assert.equal(pageLinkMenuState(shortened), null);
});

test('a long enough query closes it, so a stray [[ does not hold Enter', () => {
  /*
   * The guard the mentions need for the same reason and set at thirty: a space
   * cannot close this, so length has to. A title is longer than a name, so the
   * number here is larger — but there is a number, because `[[` in prose must
   * not leave a menu capturing Enter for the rest of a paragraph.
   */
  const state = type(editing(''), `[[${'x'.repeat(41)}`);
  assert.equal(pageLinkMenuState(state), null);
});

test('a newline closes it', () => {
  const open = type(editing(''), '[[Satz');
  assert.ok(pageLinkMenuState(open));
  const split = open.apply(open.tr.split(open.selection.head));
  assert.equal(pageLinkMenuState(split), null);
});

test('moving the caret next to an existing [[ opens nothing', () => {
  // Opening requires a document change. Otherwise arrowing through a paragraph
  // that mentions `[[` in passing pops a menu open under the caret.
  const written = editing('siehe [[irgendwo');
  const moved = written.apply(
    written.tr.setSelection(TextSelection.near(written.doc.resolve(9))),
  );
  assert.equal(pageLinkMenuState(moved), null);
});

test('never inside a code block', () => {
  // `[[` in code is code — a nested array literal, a shell test, a wiki link
  // being written *about*.
  const code = schema.nodes['code']!.create({ [BLOCK_ATTRS.id]: 'c1' });
  const state = EditorState.create({
    doc: schema.nodes['doc']!.create(null, [code]),
    plugins: [pageLinkMenu()],
  });
  const inside = state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(1))),
  );
  assert.equal(pageLinkMenuState(type(inside, '[[')), null);
});
