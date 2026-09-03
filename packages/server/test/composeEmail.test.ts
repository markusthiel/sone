/**
 * What a notification email says — and above all what it does not (ADR-0058).
 *
 * The first test is the record's central decision, and it is written as a
 * search for content rather than a check of wording: a future change that adds
 * an excerpt "for context" has to make this fail.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composeNotificationEmail, type Waiting } from '../src/mail/compose.js';

const waiting = (over: Partial<Waiting> = {}): Waiting => ({
  kind: 'mention',
  pageTitle: 'Q3 Planung',
  pageId: '00000000-0000-4000-8000-000000000001',
  actor: 'Anna',
  ...over,
});

const base = {
  workspaceName: 'Thiel',
  detail: 'title' as const,
  baseUrl: 'https://sone.example.org',
  locale: 'de' as const,
};

test('the mail carries no comment text, whatever it is given', () => {
  // The composer is never handed a body, and this asserts the shape of its
  // input rather than trusting the caller: there is nowhere to put one.
  const composed = composeNotificationEmail({ ...base, waiting: [waiting()] });
  assert.ok(composed);
  const whole = `${composed.subject}\n${composed.body}`;

  // A secret nobody should be able to smuggle out: it is not in the input type,
  // so it cannot be in the output.
  assert.doesNotMatch(whole, /Vertrag|Meyer|können wir/);
  // And the mail says so, so a recipient knows the silence is deliberate rather
  // than a truncation.
  assert.match(whole, /absichtlich keinen Kommentartext/);
});

test('who and where, and a link', () => {
  const composed = composeNotificationEmail({ ...base, waiting: [waiting()] });
  assert.ok(composed);
  assert.match(composed.subject, /Anna/);
  assert.match(composed.subject, /Q3 Planung/);
  assert.match(composed.body, /hat dich erwähnt auf/);
  assert.match(composed.body, /https:\/\/sone\.example\.org\/p\/00000000-/);
});

test('an instance can withhold even the title', () => {
  // For an operator who cannot accept a title leaving the instance. Then the
  // mail says where to look and nothing about what is there.
  const composed = composeNotificationEmail({
    ...base,
    detail: 'workspace',
    waiting: [waiting()],
  });
  assert.ok(composed);
  assert.doesNotMatch(`${composed.subject}\n${composed.body}`, /Q3 Planung/);
  assert.match(composed.body, /Thiel/);
});

test('four notifications are one mail', () => {
  // Not four. The fourth teaches somebody to filter the sender.
  const composed = composeNotificationEmail({
    ...base,
    waiting: [
      waiting(),
      waiting({ kind: 'reply', actor: 'Bo' }),
      waiting({ kind: 'assignment', pageTitle: 'Rechnungen' }),
      waiting({ actor: 'Cem' }),
    ],
  });
  assert.ok(composed);
  assert.match(composed.subject, /4 Benachrichtigungen in Thiel/);
  // Each one named, each with its own link.
  assert.equal(composed.body.match(/\/p\//g)?.length, 4);
});

test('nothing waiting is no mail', () => {
  // Rather than an empty one: a mail that says nothing has still interrupted
  // somebody.
  assert.equal(composeNotificationEmail({ ...base, waiting: [] }), null);
});

test('the unsubscribe route requires signing in', () => {
  // A URL that changes settings without authentication is a credential printed
  // in a message that gets forwarded — and the failure mode is somebody else
  // turning your notifications off (ADR-0058).
  const composed = composeNotificationEmail({ ...base, waiting: [waiting()] });
  assert.ok(composed);
  assert.match(composed.body, /\/settings\/notifications/);
  assert.doesNotMatch(composed.body, /token=|unsubscribe\?/);
});
