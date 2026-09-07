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

import {
  assignmentsFor,
  notificationsFor,
  textMentionsFor,
} from '../src/notifications/fromComments.js';

/*
 * Real uuids, because every id in this file ends in a uuid column.
 *
 * They read worse than 'anna' and 'bo' and they are the point: a value the
 * column would refuse is a value this file cannot learn anything from.
 */
const ANNA = '11111111-1111-4111-8111-111111111111';
const MARKUS = '22222222-2222-4222-8222-222222222222';
const BO = '33333333-3333-4333-8333-333333333333';
const BERT = '44444444-4444-4444-8444-444444444444';

const thread = (messages: Array<[string, string, string[]?]>): CommentThread => ({
  id: 't1',
  from: new Uint8Array(),
  to: new Uint8Array(),
  quote: 'die Zahlen',
  // About text, not a canvas item (ADR-0046) and not a place in a PDF
  // (ADR-0151).
  item: null,
  place: null,
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
  const out = notificationsFor([thread([[ANNA, 'Ich frage mich...', [ANNA]]])]);
  assert.deepEqual(out, [], 'not even when they name themselves');
});

test('a reply reaches the others in the thread', () => {
  // "In the thread" means having written in it — a definition somebody can
  // predict, unlike "everybody who can see the page".
  const out = notificationsFor([
    thread([
      [ANNA, 'Frage?'],
      [BERT, 'Antwort.'],
    ]),
  ]);
  assert.deepEqual(
    out.map((one) => [one.userId, one.kind, one.messageId]),
    [[ANNA, 'reply', 'm2']],
    'anna hears about bert’s reply, and bert hears nothing about his own',
  );
});

test('a mention beats a reply for the same message', () => {
  // Somebody named in a reply to their own thread would otherwise get two rows
  // for one message, and "you were asked" is the more useful of the two.
  const out = notificationsFor([
    thread([
      [ANNA, 'Frage?'],
      [BERT, 'Was meinst du, @anna?', [ANNA]],
    ]),
  ]);
  assert.deepEqual(
    out.map((one) => [one.userId, one.kind]),
    [[ANNA, 'mention']],
  );
});

test('a guest has no account to notify', () => {
  // Their name in a comment is a label, which ADR-0046 said it was — this is
  // where that stops being an abstract statement.
  const out = notificationsFor([
    thread([
      ['guest:Anna', 'Frage?'],
      [BERT, 'Antwort für @Anna', ['guest:Anna']],
    ]),
  ]);
  assert.deepEqual(out, []);
});

test('the excerpt is a copy, cut short', () => {
  // A copy on purpose: the message may be edited or deleted afterwards, and
  // what somebody was told at the time is what the inbox should still say.
  const long = 'x'.repeat(400);
  const out = notificationsFor([thread([[ANNA, 'Frage?'], [BERT, long]])]);
  assert.equal(out[0]?.excerpt.length, 140);
});

test('an assigned task tells the person once, not per edit', () => {
  // The block id stands in for the message id, which is what makes this
  // idempotent — and what 0039's constraint failed to enforce, because an
  // assignment has no thread and two NULLs are distinct in Postgres. Migration
  // 0040 is the fix; this is the shape of what it protects.
  const blocks = [
    { id: 'b1', type: 'todo', props: { assignee: ANNA }, plainText: 'Rechnung prüfen' },
    { id: 'b2', type: 'todo', props: {}, plainText: 'Nicht zugewiesen' },
    { id: 'b3', type: 'paragraph', props: { assignee: BERT }, plainText: 'Kein Vorgang' },
  ];
  const out = assignmentsFor(blocks);
  assert.deepEqual(
    out.map((one) => [one.userId, one.kind, one.messageId, one.threadId]),
    [[ANNA, 'assignment', 'b1', null]],
    'only the assigned task, keyed by its own block',
  );
});

test('a guest cannot be given a task', () => {
  // They have no account and therefore no inbox — the same reason a mention of
  // them is a label (ADR-0046).
  assert.deepEqual(
    assignmentsFor([
      { id: 'b1', type: 'todo', props: { assignee: 'guest:Anna' }, plainText: 'Etwas' },
    ]),
    [],
  );
});

test('nor can a name that is not an account at all', () => {
  /*
   * The same class as the two before it, third place, still live in `main`
   * until ADR-0094 — and this one had never been reported, because it needs a
   * document whose `assignee` prop is a plain name: an import, an older build,
   * a client bug.
   *
   * `props` is whatever is in the document, `user_id` is a uuid column, and the
   * INSERT runs inside the projection's transaction. So a todo block assigned
   * to `'anna'` did not lose a notification, it lost the **page**: its blocks,
   * its comment counts and its search row rolled back on every projection, for
   * ever.
   */
  assert.deepEqual(
    assignmentsFor([
      { id: 'b1', type: 'todo', props: { assignee: 'anna' }, plainText: 'Etwas' },
      { id: 'b2', type: 'todo', props: { assignee: 42 }, plainText: 'Etwas' },
      { id: 'b3', type: 'todo', props: { assignee: '' }, plainText: 'Etwas' },
    ]),
    [],
  );

  // And a real one beside them is still told: one malformed value costs one
  // notification, not the batch.
  assert.deepEqual(
    assignmentsFor([
      { id: 'b1', type: 'todo', props: { assignee: 'anna' }, plainText: 'Kaputt' },
      { id: 'b2', type: 'todo', props: { assignee: BO }, plainText: 'Echt' },
    ]).map((one) => one.userId),
    [BO],
  );
});

test('a comment naming something that is not an account names nobody', () => {
  // `mentions` is written by a client, so it holds whatever a client put there.
  // `notificationsFor` dropped the `guest:` prefix and nothing else — the same
  // gap, one function up (ADR-0094).
  assert.deepEqual(
    notificationsFor([thread([[ANNA, 'Schau mal, @anna', ['anna']]])]),
    [],
  );
});

test('a reply to somebody who is not an account tells nobody', () => {
  /*
   * The subtler half: `user_id` here comes from a *previous message's author*,
   * not from a mention. A document written by an importer can hold an author
   * that is neither a uuid nor a `guest:` key, and the reply candidate built
   * from it went into the same column.
   */
  const out = notificationsFor([
    thread([
      ['anna-als-name', 'Frage?'],
      [MARKUS, 'Antwort.'],
    ]),
  ]);
  assert.deepEqual(out, []);
});

test('a notification records who caused it', () => {
  /*
   * Absent until the email work needed it and found it missing: a notification
   * said what happened, where and to whom, and not by whom — so "Anna mentioned
   * you" was a sentence the data could not produce (ADR-0058).
   *
   * With **real uuids**, which this file did not have. `actor_id` is
   * `uuid REFERENCES users (id)`, so `'anna'` is a value the column would have
   * refused — and a fixture Postgres would refuse is a fixture that cannot find
   * out what Postgres does. That is exactly how the guest case below stayed
   * invisible until somebody replied through a share link (ADR-0092).
   */
  const [mention] = notificationsFor([thread([[ANNA, 'schau mal', [BO]]])]);
  assert.equal(mention?.userId, BO);
  assert.equal(mention?.actorId, ANNA, 'the message´s author');
});

test('a guest is not an account, so nothing is pointed at them', () => {
  /*
   * The worst fault of its batch, and it was reported as "eine Antwort auf
   * einen Kommentar wird nicht eingetragen".
   *
   * A comment's author is a user id **or** a `guest:` key (ADR-0046), and this
   * passed it straight into a uuid column. A visitor replying through a share
   * link therefore threw `22P02` **inside the projection's transaction**, so
   * the page's comment counts, blocks and search row rolled back with it — and
   * the message stays in the document, so every later projection threw again.
   * `22P02` is not a code the room treats as permanent, so it retried for ever
   * instead of saying anything.
   *
   * `textMentionsFor` was given this guard three days ago (ADR-0091) after the
   * same class of bug. This is the fourth time in this codebase that a rule
   * held in two of three places.
   */
  const [reply] = notificationsFor([
    thread([
      [ANNA, 'Was meint ihr?'],
      ['guest:Lars', 'Ich finde es gut.'],
    ]),
  ]);

  assert.equal(reply?.userId, ANNA, 'she is still told about the answer');
  assert.equal(reply?.kind, 'reply');
  assert.equal(reply?.actorId, null, 'and there is no account to name');
});

test('an assignment names whoever´s edit produced it', () => {
  // A todo block records who it is *for* and not who gave it, so the actor is
  // the person whose write created the row — the same person in every ordinary
  // case, and honestly null when no edit caused the projection.
  const blocks = [
    { id: 'b1', type: 'todo', props: { assignee: BO }, plainText: 'Rechnung prüfen' },
  ];
  assert.equal(assignmentsFor(blocks, ANNA)[0]?.actorId, ANNA);
  assert.equal(assignmentsFor(blocks)[0]?.actorId, null, 'nobody, rather than a guess');
});

// --- mentions in the page's own text (ADR-0085) ------------------------------

const block = (id: string, text: string) => ({ id, plainText: text });

test('somebody named in a paragraph is told, with the sentence they were named in', () => {
  /*
   * A mention in a comment and a mention in a paragraph are the same act —
   * "look at this, I mean you". Until this existed there was no way to make
   * either: the `mentions` field, the notification kind, the per-kind mail
   * setting and the inbox filter were all in place, and nothing could produce
   * one (ADR-0085).
   */
  const out = textMentionsFor(
    [{ userId: ANNA, blockId: 'p1', writtenBy: MARKUS }],
    [block('p1', 'Kannst du @Anna hier draufschauen?')],
    MARKUS,
  );

  assert.deepEqual(out, [
    {
      userId: ANNA,
      actorId: MARKUS,
      kind: 'mention',
      threadId: null,
      messageId: 'p1',
      excerpt: 'Kannst du @Anna hier draufschauen?',
    },
  ]);
});

test('naming yourself is a note to self, and the document decides who "self" is', () => {
  /*
   * This test used to pass the same id as `actorId` and assert nothing came
   * back — which was true, and was a test of the wrong rule.
   *
   * The actor is the projection's, and the projection's actor is whoever last
   * sent a sync message: a reader opening the page qualified. So the filter was
   * dropping mentions of *whoever happened to be looking*, and the person most
   * likely to be looking when somebody names them is the person being named
   * (ADR-0091). `writtenBy` comes from the document instead.
   */
  assert.deepEqual(
    textMentionsFor(
      [{ userId: MARKUS, blockId: 'p1', writtenBy: MARKUS }],
      [block('p1', '@Markus: nicht vergessen')],
      MARKUS,
    ),
    [],
    'he wrote it himself',
  );

  // And the case that was broken: he is merely the one with the page open.
  const out = textMentionsFor(
    [{ userId: MARKUS, blockId: 'p1', writtenBy: ANNA }],
    [block('p1', '@Markus schaust du?')],
    MARKUS,
  );
  assert.equal(out.length, 1, 'somebody else named him');
  assert.equal(out[0]?.actorId, ANNA, 'and the notification names them, not the actor');
});

test('a document that cannot say who wrote it notifies rather than staying silent', () => {
  // An old page, or attribution pruned after the writer's other words went
  // (ADR-0022). Telling somebody about their own sentence is a small annoyance;
  // silently dropping everybody else's is the bug this replaced.
  const out = textMentionsFor(
    [{ userId: MARKUS, blockId: 'p1', writtenBy: null }],
    [block('p1', '@Markus: nicht vergessen')],
    MARKUS,
  );
  assert.equal(out.length, 1);
});

test('a name that is not an account is dropped rather than crashing the projection', () => {
  /*
   * `user_id` is a uuid column and a mention node's `userId` is written by a
   * client, so it is whatever a client put there. A guest key reached the
   * INSERT and aborted the **whole projection** — the page's comment counts,
   * its search row and its notifications with it.
   *
   * `notificationsFor` drops a guest key and `assignmentsFor` drops a guest
   * key. This one did not: the third of three places, which is where a rule
   * goes to be forgotten.
   */
  assert.deepEqual(
    textMentionsFor(
      [
        { userId: 'guest:Anna', blockId: 'p1', writtenBy: MARKUS },
        { userId: 'nicht-mal-eine-id', blockId: 'p1', writtenBy: MARKUS },
      ],
      [block('p1', 'egal')],
      MARKUS,
    ),
    [],
  );
});

test('a mention whose block has gone carries an empty excerpt rather than throwing', () => {
  // The document and the projected blocks are read in the same pass, so this
  // should not happen — and "should not happen" is not a reason to take a
  // projection down.
  const out = textMentionsFor([{ userId: ANNA, blockId: 'weg', writtenBy: MARKUS }], [], null);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.excerpt, '');
});
