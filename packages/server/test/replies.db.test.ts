/**
 * Answering by mail, from the mailbox to the comment (ADR-0060, ADR-0078).
 *
 * `pollReplies` is the function that ties the four pieces together, and until
 * now **nothing imported it from a test**. Its parts were well covered — the
 * MIME reader, the token, the quote trimmer, the IMAP client each have their
 * own file — and every decision *between* them was a guess: which refusals get
 * an answer, which messages are left unread, and above all who is allowed to
 * post. The access check turned out to be the loosest rule in SONE (ADR-0078).
 *
 * So this runs the real thing: a real IMAP conversation over TLS into a real
 * database, and then looks in the document and in `page_comments` for the
 * sentence.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';

import { addThread, readThreads } from '@sone/core';

import { applyToDocument, loadDoc } from '../src/doc/docStore.js';
import { pollReplies, type RefusalReason } from '../src/jobs/replies.js';
import { replyToken } from '../src/mail/replyToken.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace } from './support/db.js';
import { fakeImap, mailboxAt } from './support/imap.js';

const SECRET = 'a-test-instance-secret-key-of-sufficient-length';

let db: Pool;

// The fake serves a self-signed certificate and the client verifies, as it
// should in production. Same trade as imap.test.ts.
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

before(async () => {
  if (!hasDatabase) return;
  db = await getTestPool();
  await resetDatabase(db);
});

after(async () => {
  if (hasDatabase) await closeTestPool();
});

interface Person {
  userId: string;
  workspaceId: string;
  pageId: string;
}

/** A workspace with one page, a thread on it, and a notification about it. */
async function scene(name: string): Promise<Person & { token: string }> {
  const { workspaceId, userId } = await seedWorkspace(db, `WS ${name}`);
  const page = await db.query<{ id: string }>(
    `INSERT INTO pages (id, workspace_id, idx, title)
     VALUES (gen_random_uuid(), $1, 'a0', $2) RETURNING id`,
    [workspaceId, `Seite ${name}`],
  );
  const pageId = page.rows[0]!.id;

  await applyToDocument(
    db,
    pageId,
    (doc) => {
      addThread(doc, {
        id: 't1',
        messageId: 'm0',
        author: userId,
        text: 'Was meinst du?',
        from: new Uint8Array(),
        to: new Uint8Array(),
        quote: 'etwas',
      });
    },
    userId,
  );

  await db.query(
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
     VALUES ($1, $2, $3, 'mention', 't1', 'm0', 'Was meinst du?')`,
    [userId, workspaceId, pageId],
  );

  const token = replyToken(
    { threadId: 't1', messageId: 'm0', userId, internal: false },
    SECRET,
  );

  return { userId, workspaceId, pageId, token };
}

/**
 * A mail as a mailbox would hand it over, delivered to a sub-address.
 *
 * The result is a string of *bytes*, not of characters: utf-8 encoded and then
 * read back as latin1, which is exactly what comes off the socket. Writing the
 * characters directly would test a mail nobody sends.
 */
function mailTo(token: string, body: string, from = 'Anna Beispiel <anna@example.org>'): string {
  const text = [
    `Delivered-To: sone+${token}@example.org`,
    `From: ${from}`,
    'To: sone@example.org',
    'Subject: Re: Was meinst du?',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ].join('\r\n');
  return Buffer.from(text, 'utf8').toString('latin1');
}

/** Run one poll against a fake mailbox, collecting what it tried to refuse. */
async function poll(messages: string[]): Promise<{
  result: { posted: number; refused: number; ignored: number };
  refusals: Array<{ to: string | null; reason: RefusalReason }>;
  markedRead: number[];
}> {
  const imap = await fakeImap(messages);
  const refusals: Array<{ to: string | null; reason: RefusalReason }> = [];
  try {
    const result = await pollReplies({
      pool: db,
      mailbox: mailboxAt(imap.port),
      secret: SECRET,
      refuse: async (to, reason) => {
        refusals.push({ to, reason });
      },
    });
    return { result, refusals, markedRead: imap.markedRead() };
  } finally {
    await imap.close();
  }
}

test('a reply arrives as a comment in the page, and is projected', { skip: !hasDatabase }, async () => {
  const anna = await scene('anna');

  const { result } = await poll([mailTo(anna.token, 'Ja, passt so.')]);
  assert.deepEqual(result, { posted: 1, refused: 0, ignored: 0 });

  const loaded = await loadDoc(db, anna.pageId);
  const thread = readThreads(loaded.doc).find((one) => one.id === 't1');
  loaded.doc.destroy();
  assert.equal(thread?.messages.at(-1)?.text, 'Ja, passt so.');
  // Written as whoever the token names, never as whoever the From header
  // claims. That is the whole security decision of this feature.
  assert.equal(thread?.messages.at(-1)?.author, anna.userId);

  const projected = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM page_comments WHERE page_id = $1`,
    [anna.pageId],
  );
  assert.ok(Number(projected.rows[0]!.n) > 0, 'the projection ran, so somebody is told');
});

test('a mail with no token is left unread and answered with nothing', { skip: !hasDatabase }, async () => {
  // A mailbox somebody else also uses must not lose their mail to us, and
  // replying to every stray mail would make SONE a nuisance.
  const stray = [
    'Delivered-To: sone@example.org',
    'From: Werbung <spam@example.net>',
    'Subject: Angebot',
    '',
    'Kaufen Sie etwas.',
    '',
  ].join('\r\n');

  const { result, refusals, markedRead } = await poll([stray]);
  assert.deepEqual(result, { posted: 0, refused: 0, ignored: 1 });
  assert.deepEqual(refusals, []);
  assert.deepEqual(markedRead, [], 'left where it was');
});

test('a forged token is left unread and answered with nothing', { skip: !hasDatabase }, async () => {
  /*
   * Answering a bad signature would confirm to whoever sent it that the address
   * is live and the format is close — and there is nobody to help, because
   * nobody legitimate produces one.
   */
  const anna = await scene('bea');
  const forged = `${anna.token.slice(0, -4)}zzzz`;

  const { result, refusals, markedRead } = await poll([mailTo(forged, 'Hallo?')]);
  assert.deepEqual(result, { posted: 0, refused: 0, ignored: 1 });
  assert.deepEqual(refusals, []);
  assert.deepEqual(markedRead, []);
});

test('an expired token is refused, and the mail is consumed', { skip: !hasDatabase }, async () => {
  const anna = await scene('cara');
  const longAgo = new Date(Date.now() - 30 * 86_400_000);
  const stale = replyToken(
    { threadId: 't1', messageId: 'm0', userId: anna.userId, internal: false },
    SECRET,
    longAgo,
  );

  const { result, refusals, markedRead } = await poll([mailTo(stale, 'Zu spät.')]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.deepEqual(refusals, [{ to: 'anna@example.org', reason: 'expired_link' }]);
  assert.deepEqual(markedRead, [1], 'consumed, or it would be refused every two minutes');
});

test('the refusal goes to a bare address, not to the From header', { skip: !hasDatabase }, async () => {
  /*
   * The header was handed to the relay whole, producing
   * `RCPT TO:<Anna Beispiel <anna@example.org>>` — which every relay rejects.
   * The throw happened before the message was marked read, so the mail stayed
   * unread, the rest of the batch was abandoned, and the failure repeated every
   * two minutes for as long as that mail sat there (ADR-0078).
   */
  const anna = await scene('dora');
  const stale = replyToken(
    { threadId: 't1', messageId: 'm0', userId: anna.userId, internal: false },
    SECRET,
    new Date(Date.now() - 30 * 86_400_000),
  );

  const { refusals } = await poll([
    mailTo(stale, 'Zu spät.', '"Beispiel, Anna" <anna@example.org>'),
  ]);
  assert.deepEqual(refusals, [{ to: 'anna@example.org', reason: 'expired_link' }]);
});

test('a From header holding no address refuses to nobody rather than to nonsense', { skip: !hasDatabase }, async () => {
  const anna = await scene('edda');
  const stale = replyToken(
    { threadId: 't1', messageId: 'm0', userId: anna.userId, internal: false },
    SECRET,
    new Date(Date.now() - 30 * 86_400_000),
  );

  const { refusals, markedRead } = await poll([
    mailTo(stale, 'Zu spät.', 'Anonymous'),
  ]);
  assert.deepEqual(refusals, [{ to: null, reason: 'expired_link' }]);
  assert.deepEqual(markedRead, [1], 'still consumed; the caller says so out loud');
});

test('a deleted notification cannot be posted from', { skip: !hasDatabase }, async () => {
  // The token names a thread; the notification is what says which page it is
  // on. Deleting it is therefore a revocation, and the only one there is for a
  // fortnight-long credential.
  const anna = await scene('frida');
  await db.query(`DELETE FROM notifications WHERE user_id = $1`, [anna.userId]);

  const { result, refusals } = await poll([mailTo(anna.token, 'Trotzdem.')]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(refusals[0]?.reason, 'thread_gone');
});

test('a page in the trash is not a place to write to', { skip: !hasDatabase }, async () => {
  const anna = await scene('gerda');
  await db.query(`UPDATE pages SET archived_at = now() WHERE id = $1`, [anna.pageId]);

  const { result, refusals } = await poll([mailTo(anna.token, 'Noch was.')]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(refusals[0]?.reason, 'thread_gone');
});

test('a workspace on its way out is not a place to write to', { skip: !hasDatabase }, async () => {
  // The inbox route has checked this since it was written; the mail path never
  // did (ADR-0078).
  const anna = await scene('hanna');
  await db.query(`UPDATE workspaces SET deleted_at = now() WHERE id = $1`, [anna.workspaceId]);

  const { result, refusals } = await poll([mailTo(anna.token, 'Hallo?')]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(refusals[0]?.reason, 'thread_gone');
});

test('losing membership stops a token that is still valid', { skip: !hasDatabase }, async () => {
  const anna = await scene('ida');
  await db.query(`DELETE FROM workspace_members WHERE user_id = $1`, [anna.userId]);

  const { result, refusals } = await poll([mailTo(anna.token, 'Ich bin noch da.')]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(refusals[0]?.reason, 'no_access');
});

test('a guest cannot answer by mail, though a guest is a member', { skip: !hasDatabase }, async () => {
  /*
   * The bug this file was written for.
   *
   * The check was `JOIN workspace_members`, which a guest satisfies. A guest
   * gets nothing by role (ADR-0026) — being in a workspace as a guest means
   * being shown particular things, not everything — and the inbox route has
   * always refused them. The mail path accepted them for as long as it existed.
   */
  const anna = await scene('jana');
  /*
   * Demoted the way the members route demotes somebody: the role row and the
   * ownership column (ADR-0102).
   *
   * This line used to write the enum word alone, and it worked — because the
   * fixture wrote the word alone too, so the compatibility bridge was reading
   * it. Production has written `role_id` since ADR-0087, so the demotion this
   * test performed was a demotion the running server never performs, and the
   * guest refusal below was being proved against a shape that does not occur.
   */
  await db.query(
    `UPDATE workspace_members
        SET role_id = (SELECT id FROM roles WHERE key = 'guest' AND workspace_id IS NULL),
            is_owner = false
      WHERE user_id = $1`,
    [anna.userId],
  );

  const { result, refusals } = await poll([mailTo(anna.token, 'Als Gast.')]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(refusals[0]?.reason, 'no_access');

  const loaded = await loadDoc(db, anna.pageId);
  const thread = readThreads(loaded.doc).find((one) => one.id === 't1');
  loaded.doc.destroy();
  assert.equal(thread?.messages.length, 1, 'nothing was written');
});

test('a restricted page refuses a member with no grant on it', { skip: !hasDatabase }, async () => {
  /*
   * The same bug from the other side. A restricted page ignores the member
   * default and grants only what was granted explicitly (ADR-0026); the old
   * check never looked at `restricted` at all, so a member could answer by mail
   * on a page they cannot open in SONE.
   *
   * The owner of a workspace cannot be locked out of it, so this needs a second
   * person who is only a member.
   */
  const anna = await scene('kara');
  const other = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ($1, 'Mitglied') RETURNING id`,
    [`member-${Date.now()}@example.org`],
  );
  const memberId = other.rows[0]!.id;
  await db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role_id, is_owner)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'member' AND workspace_id IS NULL), false)`,
    [anna.workspaceId, memberId],
  );
  await db.query(
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
     VALUES ($1, $2, $3, 'mention', 't1', 'm0', 'Was meinst du?')`,
    [memberId, anna.workspaceId, anna.pageId],
  );
  const theirToken = replyToken(
    { threadId: 't1', messageId: 'm0', userId: memberId, internal: false },
    SECRET,
  );

  // Unrestricted first: a plain member may answer, which is what makes the
  // next assertion about restriction rather than about membership.
  const before = await poll([mailTo(theirToken, 'Vor der Beschränkung.')]);
  assert.equal(before.result.posted, 1);

  await db.query(`UPDATE pages SET restricted = true WHERE id = $1`, [anna.pageId]);

  const after = await poll([mailTo(theirToken, 'Nach der Beschränkung.')]);
  assert.deepEqual(after.result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(after.refusals[0]?.reason, 'no_access');

  const loaded = await loadDoc(db, anna.pageId);
  const thread = readThreads(loaded.doc).find((one) => one.id === 't1');
  loaded.doc.destroy();
  assert.equal(
    thread?.messages.at(-1)?.text,
    'Vor der Beschränkung.',
    'the second one is not in the document',
  );
});

test('an umlaut survives the journey', { skip: !hasDatabase }, async () => {
  /*
   * The bug this caught by accident, and the one most likely to have been seen
   * by somebody using this instance: a plain 8-bit utf-8 body — what a phone
   * sends — had its bytes re-encoded on the way in, so `Grüße` arrived as
   * `GrÃ¼ÃŸe` (ADR-0078). Base64 and quoted-printable were right, and every
   * umlaut test there was had been written for those two.
   */
  const anna = await scene('ulla');

  await poll([mailTo(anna.token, 'Grüße aus Eberbach — schöner Vorschlag!')]);

  const loaded = await loadDoc(db, anna.pageId);
  const last = readThreads(loaded.doc).find((one) => one.id === 't1')?.messages.at(-1);
  loaded.doc.destroy();
  assert.equal(last?.text, 'Grüße aus Eberbach — schöner Vorschlag!');
});

test('a reply with no text is refused rather than posted empty', { skip: !hasDatabase }, async () => {
  const anna = await scene('lena');
  const htmlOnly = [
    `Delivered-To: sone+${anna.token}@example.org`,
    'From: anna@example.org',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Nur HTML</p>',
    '',
  ].join('\r\n');

  const { result, refusals } = await poll([htmlOnly]);
  assert.deepEqual(result, { posted: 0, refused: 1, ignored: 0 });
  assert.equal(refusals[0]?.reason, 'no_text');
});

test('what is posted is marked as having arrived by mail', { skip: !hasDatabase }, async () => {
  // A reader should be able to tell that a machine cut a quotation rather than
  // that a colleague wrote something strange (ADR-0060). This is the only path
  // that sets those flags, so it is the only place they can be checked.
  const anna = await scene('mira');
  const quoted = [
    'Klingt gut.',
    '',
    'Am 04.09.2026 schrieb SONE:',
    '> Was meinst du?',
  ].join('\r\n');

  await poll([mailTo(anna.token, quoted)]);

  const loaded = await loadDoc(db, anna.pageId);
  const last = readThreads(loaded.doc).find((one) => one.id === 't1')?.messages.at(-1);
  loaded.doc.destroy();
  assert.equal(last?.text, 'Klingt gut.');
  assert.equal(last?.via, 'email');
  assert.equal(last?.trimmed, true);
});

test('a batch survives one message it cannot use', { skip: !hasDatabase }, async () => {
  // Each message is decided on its own. A refusal that threw used to abandon
  // everything after it in the same poll (ADR-0078).
  const anna = await scene('nora');
  const stale = replyToken(
    { threadId: 't1', messageId: 'm0', userId: anna.userId, internal: false },
    SECRET,
    new Date(Date.now() - 30 * 86_400_000),
  );

  const { result, markedRead } = await poll([
    mailTo(stale, 'Zu spät.'),
    mailTo(anna.token, 'Aber das hier zählt.'),
  ]);
  assert.deepEqual(result, { posted: 1, refused: 1, ignored: 0 });
  assert.deepEqual(markedRead, [1, 2]);

  const loaded = await loadDoc(db, anna.pageId);
  const thread = readThreads(loaded.doc).find((one) => one.id === 't1');
  loaded.doc.destroy();
  assert.equal(thread?.messages.at(-1)?.text, 'Aber das hier zählt.');
});
