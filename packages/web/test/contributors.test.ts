/**
 * Who has written in a document.
 *
 * Read from the page's own CRDT, which is already open and already syncing —
 * so no request, and it updates as somebody else joins and types.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(
  new URL('../src/components/Contributors.tsx', import.meta.url),
  'utf8',
);

test('the list is read from the document, not fetched', () => {
  // The mapping is in the page's CRDT. Asking the server for it would be a
  // request for something already in memory, and it would not update when
  // somebody else starts typing.
  assert.match(source, /attributionUsers\(/);
  assert.match(source, /doc\.on\('update', read\)/);
  assert.match(source, /doc\.off\('update', read\)/, 'and unsubscribes');
});

test('names are looked up, never taken from the document', () => {
  // A name frozen at the time of writing would leave somebody who renamed
  // themselves appearing as two contributors (ADR-0022).
  assert.match(source, /\.members\(workspaceId\)/);
});

test('somebody who has left is still listed', () => {
  // They wrote what they wrote. Dropping them would quietly rewrite who worked
  // on the page.
  assert.match(source, /Somebody who has left/);
});

test('an empty list explains itself', () => {
  // Attribution is not retroactive, so a document full of writing can list
  // nobody. Left bare, that reads as a bug.
  assert.match(source, /Nobody is recorded yet/);
  assert.match(source, /not listed here/);
});

test('it says it is not the presence list', () => {
  // Presence answers who is here now; this answers whose writing this is.
  // Conflating them would make a page look abandoned the moment everybody
  // closed their laptop.
  assert.match(source, /whether or not they are here now/);
});

test('a panel open before a page is does not throw', () => {
  // Somebody switches page with the panel showing, and for a moment there is
  // no document to read.
  assert.match(source, /handle: PageHandle \| null/);
  assert.match(source, /if \(!handle\)/);
});

// --- choosing somebody ------------------------------------------------------

test('choosing the same person again clears the highlight', () => {
  // A highlight with no way off is a mode somebody gets stuck in.
  assert.match(source, /const next = chosen \? null : person\.userId/);
});

test('the panel does not reach into the editor itself', () => {
  // It has no view to dispatch on, and handing one across would let any panel
  // dispatch anything into the editor's own update path.
  assert.doesNotMatch(source, /EditorView/);
  assert.match(source, /onHighlight\?\.\(/);
});

test('the bridge is one command, and is cleared when the editor goes', () => {
  // A general bridge is how a codebase ends up with two ways to change the same
  // state, and the first thing to go wrong is that they disagree about which is
  // authoritative.
  const bridge = readFileSync(
    new URL('../src/components/authorHighlightBridge.ts', import.meta.url),
    'utf8',
  );
  assert.match(bridge, /export function registerHighlighter/);
  assert.match(bridge, /export function highlightAuthor/);
  assert.match(bridge, /current\?\.\(clients\)/, 'a call with no editor does nothing');

  const surface = readFileSync(
    new URL('../src/components/EditorSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(surface, /registerHighlighter\(null\)/, 'cleared on teardown');
});
