/**
 * Reading a cell value.
 *
 * The one place in the table that can be quietly wrong. A column's type can be
 * changed, so a cell may hold a value of an older kind — a number where the
 * column now says text. Reading `.value` blindly would drop `42` into a text box
 * as though somebody had typed it, and the next keystroke would save it as text.
 *
 * The tag on a stored value exists precisely so that cannot happen silently;
 * TypeScript refused to let me index past it, which is how this function came
 * to exist at all.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { textOf } from '../src/components/CollectionTable.tsx';

test('text-like kinds are read', () => {
  assert.equal(textOf({ kind: 'text', value: 'hello' }), 'hello');
  assert.equal(textOf({ kind: 'url', value: 'https://example.org' }), 'https://example.org');
  assert.equal(textOf({ kind: 'email', value: 'a@example.org' }), 'a@example.org');
  assert.equal(textOf({ kind: 'phone', value: '+49 30 1234' }), '+49 30 1234');
});

test('a value of another kind reads as empty, not as its contents', () => {
  // The case that matters: the column was changed and the old value is still
  // there. Showing it as text would invite somebody to "confirm" it, and the
  // next keystroke would store a number as a string.
  assert.equal(textOf({ kind: 'number', value: 42 }), '');
  assert.equal(textOf({ kind: 'checkbox', value: true }), '');
  assert.equal(textOf({ kind: 'date', start: '2026-01-01', end: null }), '');
});

test('an absent value reads as empty', () => {
  // "No value" and "empty string" have to look the same in a text box, since a
  // box cannot show the difference — but they are stored differently, which is
  // why writing an empty box clears the value rather than storing "".
  assert.equal(textOf(null), '');
});

test('a malformed value does not become the string "undefined"', () => {
  // A document written by an older version, or by something else entirely.
  assert.equal(textOf({ kind: 'text' } as never), '');
  assert.equal(textOf({ kind: 'text', value: 5 } as never), '');
});
