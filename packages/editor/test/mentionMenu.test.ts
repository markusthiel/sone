/**
 * When an `@` means somebody, and when it is an email address (ADR-0085).
 *
 * The whole risk of a trigger character is that it appears in ordinary text.
 * `/` is rare in prose and the slash menu opens only after whitespace for that
 * reason; `@` is not rare at all — every email address contains one, and
 * offering to turn `markus@example.org` into a mention as somebody types it
 * would be worse than useless.
 *
 * These drive the plugin through real transactions rather than calling its
 * `apply` by hand: what is under test is when the menu opens and closes as
 * somebody types, and that is a sequence of transactions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_ATTRS } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';

import { mentionMenu, mentionMenuPluginKey, mentionMenuState } from '../src/mentionMenu.js';
import { schema } from '../src/schema.js';

/** A document with one paragraph, and the caret at its end. */
function editing(text: string): EditorState {
  const paragraph = schema.nodes['paragraph']!.create(
    { [BLOCK_ATTRS.id]: 'p1' },
    text === '' ? null : schema.text(text),
  );
  const state = EditorState.create({
    doc: schema.nodes['doc']!.create(null, [paragraph]),
    plugins: [mentionMenu()],
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

test('an @ after a space opens the menu', () => {
  const state = type(editing('Kannst du'), ' @');
  // Position 11: the paragraph opens at 0, so "Kannst du" is 1–10 and the
  // space is 10.
  assert.deepEqual(mentionMenuState(state), { from: 11, query: '' });
});

test('an @ at the start of a block opens the menu', () => {
  const state = type(editing(''), '@');
  assert.equal(mentionMenuState(state)?.query, '');
});

test('an email address does not open the menu', () => {
  /*
   * The case that makes this trigger different from `/`. Somebody writing down
   * a colleague's address gets a menu over every character of the domain, and
   * pressing Enter to end the line picks a person out of it.
   */
  const state = type(editing(''), 'Schreib an markus@example.org');
  assert.equal(mentionMenuState(state), null);
});

test('what follows the @ becomes the query, spaces included', () => {
  // A name has a space in it. The slash menu closes on a space with no match,
  // which would make "Markus Thiel" unsearchable here.
  const state = type(editing(''), '@Markus Thiel');
  assert.equal(mentionMenuState(state)?.query, 'Markus Thiel');
});

test('a long run of prose after an @ closes it', () => {
  // An `@` in ordinary prose must not leave a menu capturing keys for the rest
  // of a paragraph. Length rather than a space, for the reason above.
  const state = type(editing(''), '@ und dann noch sehr viel weiterer Fließtext');
  assert.equal(mentionMenuState(state), null);
});

test('deleting the @ closes it', () => {
  let state = type(editing(''), '@Ma');
  assert.ok(mentionMenuState(state));

  // Back over all three characters.
  for (let i = 0; i < 3; i++) {
    state = state.apply(state.tr.delete(state.selection.head - 1, state.selection.head));
  }
  assert.equal(mentionMenuState(state), null);
});

test('moving the caret next to an existing @ does not open it', () => {
  // Opening requires a document change. Otherwise clicking into a sentence that
  // happens to contain an address opens a menu nobody asked for.
  const state = editing('bei @ irgendwo');
  const moved = state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(6))),
  );
  assert.equal(mentionMenuState(moved), null);
});

test('an @ inside a code block is code', () => {
  const code = schema.nodes['code']!.create(
    { [BLOCK_ATTRS.id]: 'c1' },
    schema.text('const a = 1'),
  );
  let state = EditorState.create({
    doc: schema.nodes['doc']!.create(null, [code]),
    plugins: [mentionMenu()],
  });
  state = state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(state.doc.content.size))),
  );
  state = type(state, ' @');
  assert.equal(mentionMenuState(state), null, 'a decorator is not a mention');
});

test('closing leaves the typed text alone', () => {
  // Escape means "not this", not "undo what I typed": somebody who wanted to
  // write an address should still have it.
  let state = type(editing(''), '@markus');
  state = state.apply(state.tr.setMeta(mentionMenuPluginKey, { close: true }));

  assert.equal(mentionMenuState(state), null);
  assert.equal(state.doc.textContent, '@markus');
});
