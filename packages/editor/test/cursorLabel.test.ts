/**
 * The label beside somebody else's caret.
 *
 * y-prosemirror's default cursor builder reads `user.name` and `user.color`
 * from each awareness state. SONE publishes `displayName` and `color`, so the
 * default found no name and rendered the awareness client id — a number where a
 * person's name should be.
 *
 * Fixed with a builder rather than by renaming the presence field: `displayName`
 * is what the rest of the application calls it, and bending the model to one
 * library's expectation is the wrong direction.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { presenceCursor } from '../src/editor.js';

let dom: JSDOM;
let previousDocument: unknown;

before(() => {
  dom = new JSDOM('<!doctype html><body></body>');
  previousDocument = (globalThis as Record<string, unknown>)['document'];
  (globalThis as Record<string, unknown>)['document'] = dom.window.document;
});

after(() => {
  (globalThis as Record<string, unknown>)['document'] = previousDocument;
  dom.window.close();
});

test('the caret label shows the name it is given', () => {
  // The argument is `awareness.user`, not the whole awareness state.
  // y-prosemirror reads `aw.user` and passes that — a first version of this
  // read `displayName` from it, which is never there, so every caret said
  // "Someone" in the library's fallback orange.
  const cursor = presenceCursor({ name: 'Markus', color: '#2563eb' });
  assert.match(cursor.textContent ?? '', /Markus/);
  assert.doesNotMatch(cursor.textContent ?? '', /\d{3,}/, 'not a client id');
});

test('a missing name reads as a person, not as nothing', () => {
  // Somebody who never set a display name. An empty label is a coloured box
  // with no meaning; "Someone" at least says a person is there.
  for (const state of [{}, { name: '' }, { name: 42 }]) {
    assert.match(presenceCursor(state).textContent ?? '', /Someone/);
  }
});

test('a display name is inserted as text, never as markup', () => {
  // It is somebody else's input and arrives from another client over the wire.
  const cursor = presenceCursor({ name: '<img src=x onerror=alert(1)>' });
  assert.equal(cursor.querySelectorAll('img').length, 0);
  assert.match(cursor.textContent ?? '', /<img/);
});

test('the colour is used, and a missing one does not become "undefined"', () => {
  const coloured = presenceCursor({ name: 'A', color: '#ff0000' });
  assert.match(coloured.getAttribute('style') ?? '', /#ff0000/);

  const plain = presenceCursor({ name: 'A' });
  assert.doesNotMatch(plain.getAttribute('style') ?? '', /undefined/);
});
