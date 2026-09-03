/**
 * The address a notification can be answered at (ADR-0060).
 *
 * These are the tests that matter for replying by email, because the whole
 * security decision is here: the credential is the address a mail was sent
 * *to*, and a `From` header is decoration. Each test is one way somebody might
 * try to write into a workspace they were not invited to.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REPLY_DAYS,
  replyAddress,
  replyToken,
  readReplyToken,
  tokenFromAddress,
  type ReplyTarget,
} from '../src/mail/replyToken.js';

const SECRET = 'a-secret-long-enough-to-be-a-secret-key-here';
const target: ReplyTarget = {
  threadId: 't-42',
  messageId: 'm-7',
  userId: '00000000-0000-4000-8000-000000000001',
  internal: false,
};

test('a token round-trips, including which document the thread is in', () => {
  const read = readReplyToken(replyToken(target, SECRET), SECRET);
  assert.ok(read.ok);
  assert.deepEqual(read.target, target);

  // The internal flag survives, because a reply has to go into the document its
  // thread lives in — writing an internal reply into the page everybody can
  // read would be the worst bug this feature could have (ADR-0057).
  const internal = readReplyToken(
    replyToken({ ...target, internal: true }, SECRET),
    SECRET,
  );
  assert.ok(internal.ok);
  assert.equal(internal.target.internal, true);
});

test('a tampered payload is refused, not read', () => {
  // Somebody who understands the format and edits the user id out of their own
  // token: the signature covers the recipient, so this is the attack the design
  // exists to stop.
  const token = replyToken(target, SECRET);
  const [payload, mac] = token.split('.') as [string, string];
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const forged = decoded.replace(target.userId, '00000000-0000-4000-8000-000000000002');
  const attempt = `${Buffer.from(forged, 'utf8').toString('base64url')}.${mac}`;

  assert.deepEqual(readReplyToken(attempt, SECRET), { ok: false, reason: 'bad_signature' });
});

test('a token signed with another key is refused', () => {
  const token = replyToken(target, 'some-other-instance-secret-key-value');
  assert.deepEqual(readReplyToken(token, SECRET), { ok: false, reason: 'bad_signature' });
});

test('an expired token is refused, and says so', () => {
  // A Reply-To somebody finds in an archive two years later must not still
  // write into a page.
  const token = replyToken(target, SECRET);
  const later = new Date(Date.now() + (REPLY_DAYS + 1) * 86_400_000);
  assert.deepEqual(readReplyToken(token, SECRET, later), { ok: false, reason: 'expired' });
});

test('the signature is checked before the expiry', () => {
  /*
   * Because the two say different things about who sent it: an expired token
   * that was never signed by us is a forgery, and reporting it as "late" would
   * put a forged reply in the same bucket as a colleague's slow answer.
   */
  const stale = replyToken(target, 'a-different-key-entirely-for-this-test');
  const later = new Date(Date.now() + (REPLY_DAYS + 1) * 86_400_000);
  assert.deepEqual(readReplyToken(stale, SECRET, later), {
    ok: false,
    reason: 'bad_signature',
  });
});

test('nonsense is malformed rather than an exception', () => {
  // Whatever arrives in a Delivered-To header is not under our control.
  for (const junk of ['', '.', 'nodot', 'a.b.c', '!!!.???']) {
    const read = readReplyToken(junk, SECRET);
    assert.equal(read.ok, false, junk);
  }
});

test('the address uses sub-addressing, so one mailbox serves everything', () => {
  // `a+b@c` is delivered to `a@c` by every mailbox that supports it — the
  // difference between "configure a mailbox" and "configure DNS".
  const token = replyToken(target, SECRET);
  const address = replyAddress('sone@example.org', token);
  assert.equal(address, `sone+${token}@example.org`);
  assert.equal(tokenFromAddress(address), token);

  // And a plain address yields nothing rather than a guess.
  assert.equal(tokenFromAddress('sone@example.org'), null);
});
