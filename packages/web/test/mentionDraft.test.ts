/**
 * Naming somebody in a comment, where the text is a string (ADR-0085).
 *
 * A mention in the page is a node carrying an id. A comment message has `text`
 * and a separate `mentions: string[]`, so the id cannot live inside the
 * sentence — and something has to decide which of the ids somebody picked while
 * typing are still meant when they press Enter.
 *
 * These are the rules that decide it, and the trigger rule, which has to match
 * the editor plugin's or an `@` would mean different things two centimetres
 * apart.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mentionQueryAt,
  mentionsInDraft,
  withMention,
} from '../src/components/mentionDraft.ts';

test('an @ after a space begins a query', () => {
  assert.deepEqual(mentionQueryAt('Kannst du @Mar', 14), { from: 10, query: 'Mar' });
});

test('an @ at the start begins a query', () => {
  assert.deepEqual(mentionQueryAt('@An', 3), { from: 0, query: 'An' });
});

test('an email address does not', () => {
  // The same rule as the editor's plugin, and the reason both have one: `@` is
  // not rare in prose the way `/` is.
  assert.equal(mentionQueryAt('Schreib an markus@thiel.email', 29), null);
});

test('a name with a space in it is still one query', () => {
  // A space cannot close this the way it closes the slash menu — "Markus
  // Thiel" would be unsearchable.
  assert.deepEqual(mentionQueryAt('@Markus Thiel', 13), { from: 0, query: 'Markus Thiel' });
});

test('a long run of prose after an @ is not a query', () => {
  const text = '@ und dann noch sehr viel weiterer Fließtext hinterher';
  assert.equal(mentionQueryAt(text, text.length), null);
});

test('the caret before the @ is not in it', () => {
  // Clicking back into the sentence must close the list: an `@` two words on is
  // not what is being typed.
  assert.equal(mentionQueryAt('bei @Anna nachfragen', 3), null);
});

test('choosing somebody replaces the query and leaves the caret after the name', () => {
  const at = mentionQueryAt('Kannst du @Mar', 14)!;
  const next = withMention('Kannst du @Mar', at, { userId: 'u1', label: 'Markus Thiel' });

  assert.equal(next.text, 'Kannst du @Markus Thiel ');
  assert.equal(next.caret, next.text.length, 'ready to carry on with the sentence');
});

test('choosing in the middle of a sentence keeps what follows', () => {
  const text = 'Frag @An bitte noch heute';
  const at = mentionQueryAt(text, 8)!;
  const next = withMention(text, at, { userId: 'u1', label: 'Anna' });

  assert.equal(next.text, 'Frag @Anna  bitte noch heute');
});

test('a name still in the text counts; one deleted does not', () => {
  /*
   * The rule, and the honest behaviour available to a string: type a name,
   * change your mind, delete it, and the notification goes with it. Keeping
   * every id ever picked would send somebody a notification about a sentence
   * that does not name them.
   */
  const picked = [
    { userId: 'u1', label: 'Anna' },
    { userId: 'u2', label: 'Bert' },
  ];
  assert.deepEqual(mentionsInDraft('@Anna schaust du?', picked), ['u1']);
  assert.deepEqual(mentionsInDraft('Niemand mehr', picked), []);
  assert.deepEqual(mentionsInDraft('@Anna und @Bert', picked), ['u1', 'u2']);
});

test('the same person named twice is one mention', () => {
  assert.deepEqual(
    mentionsInDraft('@Anna, @Anna!', [{ userId: 'u1', label: 'Anna' }]),
    ['u1'],
  );
});
