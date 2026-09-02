/**
 * Comment threads, and the one property that matters (ADR-0046).
 *
 * A thread points at a range of text that other people are editing at the same
 * time. If the anchor drifts, a comment quotes the wrong sentence — which is not
 * a layout bug but the application lying about who said what about what. So
 * these are anchor tests before they are anything else, and they edit the
 * document *from another client* rather than locally, because that is the case an
 * offset would pass and a relative position is needed for.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';

import {
  addMessage,
  addThread,
  commentText,
  readThreads,
  removeMessage,
  removeThread,
  resolveThread,
  threadsMap,
  participants,
} from '../src/doc/comments.js';

/** A document with some prose and a thread on one word of it. */
function docWithThread(): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  const text = doc.getText('body');
  text.insert(0, 'The quick brown fox jumps.');

  // "brown" is at 10..15.
  addThread(doc, {
    id: 't1',
    from: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 10)),
    to: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 15)),
    quote: 'brown',
    messageId: 'm1',
    author: 'u-1',
    text: 'Which brown?',
    at: 1000,
  });

  return { doc, text };
}

test('an anchor survives somebody else editing before it', () => {
  const { doc, text } = docWithThread();
  assert.deepEqual(readThreads(doc)[0]?.range, { from: 10, to: 15 });

  // Another client, inserting ahead of the range. An offset would still say
  // 10..15 and would now be quoting the wrong word.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  other.getText('body').insert(0, 'Look: ');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

  assert.equal(text.toString(), 'Look: The quick brown fox jumps.');
  assert.deepEqual(readThreads(doc)[0]?.range, { from: 16, to: 21 });
});

test('an anchor survives an edit inside the range', () => {
  const { doc, text } = docWithThread();

  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  // Inside "brown", making it "broXwn".
  other.getText('body').insert(13, 'X');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

  const range = readThreads(doc)[0]?.range;
  assert.ok(range);
  assert.equal(text.toString().slice(range.from, range.to), 'broXwn');
});

test('a thread whose text is deleted is detached, not gone', () => {
  const { doc } = docWithThread();

  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  other.getText('body').delete(10, 5);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

  const thread = readThreads(doc)[0];
  assert.ok(thread, 'the thread is still there');
  // Null, and the reason is subtler than "the anchor failed": Yjs resolves a
  // position whose item was deleted to the place that item held, so both ends
  // resolve — to the same index. A collapsed range is what deleted text looks
  // like, and treating only a decode failure as detachment would have left a
  // highlight of no width in the text for ever.
  assert.equal(thread.range, null, 'and it knows its text is gone');
  // The quotation is why it is still readable: without it, "Which brown?" is a
  // question about nothing.
  assert.equal(thread.quote, 'brown');
  assert.equal(thread.messages[0]?.text, 'Which brown?');
});

test('two people commenting on two ranges do not meet', () => {
  const { doc, text } = docWithThread();
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

  const theirText = other.getText('body');
  addThread(other, {
    id: 't2',
    from: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(theirText, 16)),
    to: Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(theirText, 19)),
    quote: 'fox',
    messageId: 'm2',
    author: 'u-2',
    text: 'Whose fox?',
    at: 2000,
  });

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));

  for (const each of [doc, other]) {
    const threads = readThreads(each);
    assert.deepEqual(
      threads.map((thread) => thread.quote),
      ['brown', 'fox'],
      'oldest first, on both screens',
    );
  }
  void text;
});

test('a message names its author, and that is not inferred', () => {
  const { doc } = docWithThread();
  addMessage(doc, 't1', { id: 'm2', author: 'guest:Anna', text: 'The dark one.', at: 3000 });

  const messages = readThreads(doc)[0]?.messages ?? [];
  assert.deepEqual(
    messages.map((one) => [one.author, one.text]),
    [
      ['u-1', 'Which brown?'],
      ['guest:Anna', 'The dark one.'],
    ],
  );
});

test('replying to a resolved thread opens it again', () => {
  // A reply nobody sees because the thread is closed is a reply lost.
  const { doc } = docWithThread();
  resolveThread(doc, 't1', true, 'u-1', 4000);
  assert.equal(readThreads(doc)[0]?.resolved, true);

  addMessage(doc, 't1', { id: 'm2', author: 'u-2', text: 'Actually, no.', at: 5000 });
  const thread = readThreads(doc)[0];
  assert.equal(thread?.resolved, false);
  assert.equal(thread?.resolvedBy, undefined, 'and forgets who closed it');
});

test('resolving keeps the thread, and removing is a different act', () => {
  const { doc } = docWithThread();
  resolveThread(doc, 't1', true, 'u-2', 4000);

  const thread = readThreads(doc)[0];
  assert.equal(thread?.resolved, true);
  assert.equal(thread?.resolvedBy, 'u-2', 'anybody may resolve, and it says who did');
  assert.deepEqual(thread?.range, { from: 10, to: 15 }, 'still anchored');

  removeThread(doc, 't1');
  assert.deepEqual(readThreads(doc), []);
});

test('a thread with no messages left goes with the last one', () => {
  // An anchor with nothing attached is a highlight nobody can explain.
  const { doc } = docWithThread();
  addMessage(doc, 't1', { id: 'm2', author: 'u-2', text: 'Agreed.', at: 3000 });

  removeMessage(doc, 't1', 'm1');
  assert.equal(readThreads(doc).length, 1);
  assert.equal(readThreads(doc)[0]?.messages.length, 1);

  removeMessage(doc, 't1', 'm2');
  assert.deepEqual(readThreads(doc), []);
  assert.equal(threadsMap(doc).size, 0);
});

test('comment text goes to the search index', () => {
  // A discussion about a decision is often where the decision is explained.
  const { doc } = docWithThread();
  addMessage(doc, 't1', { id: 'm2', author: 'u-2', text: 'Chestnut.', at: 3000 });
  assert.equal(commentText(doc), 'Which brown?\nChestnut.');
});

test('a deleted thread is gone from the list, not merely resolved', () => {
  // The half I could check when a highlight outlived its thread: whether the
  // model still had it. It does not — which located the fault in the redraw
  // rather than in the deletion.
  const { doc } = docWithThread();
  assert.equal(readThreads(doc).length, 1);

  removeThread(doc, 't1');
  assert.deepEqual(readThreads(doc), []);
  assert.equal(threadsMap(doc).size, 0, 'and nothing is left behind in the map');
});

test('a mention is stored as an id, and never of oneself', () => {
  // Ids beside the text, not names in it: a name breaks when somebody is
  // renamed and matches the wrong person when two share one (ADR-0052).
  const { doc } = docWithThread();

  addMessage(doc, 't1', {
    id: 'm2',
    author: 'user-a',
    text: 'Frage an @Anna und mich',
    // Somebody who writes their own name has not asked to be told about it, and
    // a message carrying a self-mention has recorded something untrue.
    mentions: ['user-b', 'user-a', 'user-b'],
  });

  const thread = readThreads(doc)[0];
  const reply = thread?.messages.at(-1);
  assert.deepEqual(reply?.mentions, ['user-b'], 'deduplicated, and without the author');
});

test('a thread´s participants are the people who wrote in it', () => {
  // A definition somebody can predict, which is the point of choosing it over
  // "everybody who can see the page" (ADR-0052).
  const { doc } = docWithThread();
  addMessage(doc, 't1', { id: 'm2', author: 'user-b', text: 'Ja' });
  addMessage(doc, 't1', { id: 'm3', author: 'user-a', text: 'Danke' });

  const thread = readThreads(doc)[0];
  assert.ok(thread);
  // Read from the fixture rather than assumed: its first author is 'u-1', which
  // my first version of this test guessed wrong.
  const first = thread.messages[0]?.author;
  assert.deepEqual(participants(thread).sort(), [first, 'user-a', 'user-b'].sort());
});
