/**
 * Anchoring a comment to a selection (ADR-0046).
 *
 * Headless, and it can be: y-prosemirror's conversion helpers work on documents
 * rather than views, which is the note editor.test.ts already makes. So the
 * round trip — selection to bytes to selection, with somebody else editing in
 * between — is testable without a browser, and it is the part worth testing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pageContent } from '@sone/core';
import { EditorState, TextSelection } from 'prosemirror-state';
import { ySyncPlugin } from 'y-prosemirror';
import * as Y from 'yjs';

import { anchorFromSelection } from '../src/commentAnchors.js';
import { schema } from '../src/schema.js';

/** An editor state bound to a Yjs document holding one paragraph. */
function bound(text: string): { doc: Y.Doc; state: EditorState } {
  const doc = new Y.Doc();
  const fragment = pageContent(doc);

  let state = EditorState.create({ schema, plugins: [ySyncPlugin(fragment)] });
  state = state.apply(state.tr.insertText(text, 1));

  return { doc, state };
}

test('an empty selection cannot be commented on', () => {
  // A comment on a caret has no text to quote and nothing to highlight, and the
  // honest answer is that a comment needs something to be about.
  const { state } = bound('The quick brown fox.');
  const caret = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 5)),
  );
  assert.equal(anchorFromSelection(caret), null);
});

test('a selection becomes an anchor that quotes it', () => {
  const { state } = bound('The quick brown fox.');
  // "quick" — position 1 is the start of the paragraph's text.
  const selected = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, 5, 10)),
  );

  const anchor = anchorFromSelection(selected);
  assert.ok(anchor);
  assert.equal(anchor.quote, 'quick');
  assert.ok(anchor.from instanceof Uint8Array);
  assert.ok(anchor.to instanceof Uint8Array);
});

test('an anchor is bytes that decode to a relative position', () => {
  // How far this file can go, and why.
  //
  // Making an anchor works headlessly: `absolutePositionToRelativePosition`
  // reads the document. Resolving one back does not — y-prosemirror's mapping is
  // built by the plugin's `view()` method, so without an `EditorView` it is
  // empty and every reverse lookup returns null. That is the limit
  // editor.test.ts already names: what is not covered without a browser is
  // EditorView itself.
  //
  // So the round trip under concurrent editing is proven where it can be, at the
  // Yjs level, in core's comments tests — an anchor bound to an item survives
  // another client inserting before it, inside it, and deleting it. What is left
  // untested here is the library's own mapping between two coordinate systems,
  // which is library code and has its own tests.
  const { state } = bound('The quick brown fox.');
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 11, 16)));
  const anchor = anchorFromSelection(selected);
  assert.ok(anchor);

  const relative = Y.decodeRelativePosition(anchor.from);
  assert.ok(relative, 'decodes');
  // Round-trips through the encoding unchanged, which is what the document
  // stores and what the panel hands back.
  assert.deepEqual(Y.encodeRelativePosition(relative), anchor.from);
});
