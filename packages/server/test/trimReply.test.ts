/**
 * What somebody actually wrote in a reply (ADR-0060).
 *
 * Quote detection is guesswork, so these tests are the *stated* rules — and one
 * of them is about not being clever: a sentence that begins "Am Montag schrieb
 * ich…" must survive, because cutting a reply there deletes what somebody said.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plainBody, trimReply } from '../src/mail/trimReply.js';

test('a quoted block is dropped', () => {
  const { text, trimmed } = trimReply(
    ['Ja, machen wir so.', '', '> Sollen wir den Vertrag kündigen?', '> — Anna'].join('\n'),
  );
  assert.equal(text, 'Ja, machen wir so.');
  assert.equal(trimmed, true);
});

test('an attribution line and everything after it is dropped', () => {
  for (const attribution of [
    'On Tue, 2 Sep 2026 at 14:03, Anna <anna@example.org> wrote:',
    'Am 02.09.2026 um 14:03 schrieb Anna:',
    '--- Ursprüngliche Nachricht ---',
    'Anna <anna@example.org> schrieb am Dienstag:',
  ]) {
    const { text } = trimReply(['Kurz: ja.', '', attribution, '> alter Text'].join('\n'));
    assert.equal(text, 'Kurz: ja.', attribution);
  }
});

test('a sentence that merely looks like an attribution survives', () => {
  /*
   * The rule that stops this being clever at somebody's expense. "Am Montag
   * schrieb ich das falsch" is a sentence, and an attribution match without
   * quoted text after it would have deleted the rest of the reply.
   */
  const body = [
    'Am Montag schrieb ich das falsch, sorry.',
    '',
    'Der richtige Betrag ist 420 Euro.',
  ].join('\n');
  const { text, trimmed } = trimReply(body);
  assert.equal(text, body);
  assert.equal(trimmed, false, 'nothing was dropped');
});

test('a signature is dropped, with or without the trailing space', () => {
  for (const marker of ['-- ', '--']) {
    const { text } = trimReply(['Passt.', '', marker, 'Anna Meier', 'Geschäftsführung'].join('\n'));
    assert.equal(text, 'Passt.', JSON.stringify(marker));
  }
});

test('a reply with nothing but a quote comes back empty', () => {
  // The caller answers this with a refusal mail rather than posting nothing:
  // silence would leave somebody believing they had answered a colleague.
  const { text, trimmed } = trimReply('> nur das Zitat\n> und mehr Zitat');
  assert.equal(text, '');
  assert.equal(trimmed, true);
});

test('an untrimmed reply says so', () => {
  const { text, trimmed } = trimReply('  Einfach nur eine Antwort.  ');
  assert.equal(text, 'Einfach nur eine Antwort.');
  assert.equal(trimmed, false, 'so the panel does not claim a machine cut it');
});

test('only the plain part is used', () => {
  // An HTML-only mail is refused rather than converted: a guess at what
  // somebody's markup meant would arrive in a page as a sentence they did not
  // write.
  assert.equal(
    plainBody([
      { mime: 'text/html', text: '<p>Ja</p>' },
      { mime: 'text/plain; charset=utf-8', text: 'Ja' },
    ]),
    'Ja',
  );
  assert.equal(plainBody([{ mime: 'text/html', text: '<p>Ja</p>' }]), null);
});
