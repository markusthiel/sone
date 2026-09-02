/**
 * Who gets told about a comment (ADR-0052).
 *
 * The rules without a database, because they are rules rather than SQL: no
 * self-notification, a reply reaches everybody in the thread but its author, a
 * mention beats a reply for the same person and message, and a guest has no
 * account to notify.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CommentThread } from '@sone/core';

import { notificationsFor } from '../src/notifications/fromComments.js';

const thread = (messages: Array<[string, string, string[]?]>): CommentThread => ({
  id: 't1',
  from: new Uint8Array(),
  to: new Uint8Array(),
  quote: 'die Zahlen',
  resolved: false,
  createdAt: 0,
  range: { from: 1, to: 2 },
  messages: messages.map(([author, text, mentions], at) => ({
    id: `m${at + 1}`,
    author,
    at,
    text,
    mentions: mentions ?? [],
  })),
});

test('nobody is told about their own writing', () => {
  const out = notificationsFor([thread([['anna', 'Ich frage mich...', ['anna']]])]);
  assert.deepEqual(out, [], 'not even when they name themselves');
});

test('a reply reaches the others in the thread', () => {
  // "In the thread" means having written in it — a definition somebody can
  // predict, unlike "everybody who can see the page".
  const out = notificationsFor([
    thread([
      ['anna', 'Frage?'],
      ['bert', 'Antwort.'],
    ]),
  ]);
  assert.deepEqual(
    out.map((one) => [one.userId, one.kind, one.messageId]),
    [['anna', 'reply', 'm2']],
    'anna hears about bert’s reply, and bert hears nothing about his own',
  );
});

test('a mention beats a reply for the same message', () => {
  // Somebody named in a reply to their own thread would otherwise get two rows
  // for one message, and "you were asked" is the more useful of the two.
  const out = notificationsFor([
    thread([
      ['anna', 'Frage?'],
      ['bert', 'Was meinst du, @anna?', ['anna']],
    ]),
  ]);
  assert.deepEqual(
    out.map((one) => [one.userId, one.kind]),
    [['anna', 'mention']],
  );
});

test('a guest has no account to notify', () => {
  // Their name in a comment is a label, which ADR-0046 said it was — this is
  // where that stops being an abstract statement.
  const out = notificationsFor([
    thread([
      ['guest:Anna', 'Frage?'],
      ['bert', 'Antwort für @Anna', ['guest:Anna']],
    ]),
  ]);
  assert.deepEqual(out, []);
});

test('the excerpt is a copy, cut short', () => {
  // A copy on purpose: the message may be edited or deleted afterwards, and
  // what somebody was told at the time is what the inbox should still say.
  const long = 'x'.repeat(400);
  const out = notificationsFor([thread([['anna', 'Frage?'], ['bert', long]])]);
  assert.equal(out[0]?.excerpt.length, 140);
});
