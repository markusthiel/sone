/**
 * The job that actually sends a notification mail (ADR-0058, ADR-0081).
 *
 * `emailNotificationsHandler` composes the mail, decides its reply address and
 * hands it to the relay — and **nothing imported it**. The sweep beside it had
 * no test either. Both ends of this feature were covered: `claimForEmail`
 * against a real database, `composeNotificationEmail` and `sendMail` on their
 * own. The middle, where the decisions are, was not.
 *
 * That is the same shape as ADR-0078, and it hid the same kind of fault: the
 * reply address was taken from the batch's *oldest* notification, so a batch
 * whose oldest item was an assignment — which carries no thread — got no reply
 * address at all, however many answerable mentions were listed under it.
 *
 * So this runs the handler against a real database and a server that speaks
 * SMTP, and reads the headers off the wire.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:net';
import type { Pool } from 'pg';

import { emailNotificationsHandler } from '../src/jobs/emailNotifications.js';
import { tokenFromAddress, readReplyToken } from '../src/mail/replyToken.js';
import { closeTestPool, getTestPool, hasDatabase, resetDatabase, seedWorkspace } from './support/db.js';

const SECRET = 'a-test-instance-secret-key-of-sufficient-length';

let db: Pool;
let workspaceId: string;
let userId: string;

/** A relay that records the message it was handed. */
async function fakeRelay(): Promise<{ port: number; data: () => string; close: () => Promise<void> }> {
  let data = '';
  const server: Server = createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
            continue;
          }
          data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        const verb = line.split(' ')[0]?.toUpperCase() ?? '';
        if (verb === 'EHLO') socket.write('250 fake\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    data: () => data,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

before(async () => {
  if (!hasDatabase) return;
  db = await getTestPool();
  await resetDatabase(db);
  const fixture = await seedWorkspace(db, 'Mail');
  workspaceId = fixture.workspaceId;
  userId = fixture.userId;
  await db.query(`UPDATE users SET email = $2 WHERE id = $1`, [
    userId,
    'anna@example.org',
  ]);
});

after(async () => {
  if (hasDatabase) await closeTestPool();
});

/**
 * One notification waiting to be mailed. Returns its id.
 *
 * `messageId` is distinct even when there is no thread, because
 * `notifications_once_per_thing` is UNIQUE NULLS NOT DISTINCT over
 * (user_id, kind, thread_id, message_id) — so two unthreaded assignments for
 * one person collide (migration 0040). Worth knowing: it means a person holds
 * at most one assignment notification with nothing to distinguish it.
 */
let seq = 0;
async function waiting(kind: string, threadId: string | null): Promise<string> {
  seq += 1;
  const page = await db.query<{ id: string }>(
    `INSERT INTO pages (id, workspace_id, idx, title, kind)
     VALUES (gen_random_uuid(), $1, 'a' || floor(random() * 100000)::text, 'Eine Seite', 'page')
     RETURNING id::text AS id`,
    [workspaceId],
  );
  const row = await db.query<{ id: string }>(
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'Etwas', now() - interval '10 minutes')
     RETURNING id::text AS id`,
    [userId, workspaceId, page.rows[0]!.id, kind, threadId, `m${seq}`],
  );
  return row.rows[0]!.id;
}

const settingsWith = (port: number) => ({
  relay: {
    host: '127.0.0.1',
    port,
    user: '',
    password: '',
    from: 'sone@example.org',
    security: 'none' as const,
  },
  detail: 'title' as const,
  baseUrl: 'https://sone.example',
  replyMailbox: 'sone@example.org',
  secret: SECRET,
});

const job = (ids: string[]) => ({
  id: 'job-1',
  workspaceId,
  kind: 'email_notifications',
  payload: { userId, notificationIds: ids },
  createdBy: null,
  attempts: 1,
});

const context = { report: () => Promise.resolve() };

test('a batch whose oldest item is an assignment still carries a reply address', { skip: !hasDatabase }, async () => {
  /*
   * The bug this file was written for.
   *
   * The reply address named the batch's oldest notification, always.
   * Assignments carry no thread, so one at the head of a batch removed the
   * reply address from the whole mail — including three mentions underneath it
   * that could each have been answered. Silently, per batch.
   *
   * The old reasoning was "the first is the one the subject line names", which
   * is true for a batch of one and only then: with several, the subject is
   * "3 things in <workspace>" and names none of them.
   */
  const assignment = await waiting('assignment', null);
  const mention = await waiting('mention', 't-mention');

  const fake = await fakeRelay();
  try {
    await emailNotificationsHandler(db, settingsWith(fake.port))(job([assignment, mention]), context);

    const match = /Reply-To: (\S+)/.exec(fake.data());
    assert.ok(match, 'a reply address was sent at all');

    // And it names the item that can actually take a reply.
    const token = tokenFromAddress(match![1]!);
    assert.ok(token, 'the address carries a token');
    const read = readReplyToken(token!, SECRET);
    assert.ok(read.ok, 'and the token is one the poll would accept');
    assert.equal(read.ok && read.target.threadId, 't-mention');
  } finally {
    await fake.close();
  }
});

test('a batch with nothing answerable carries no reply address', { skip: !hasDatabase }, async () => {
  // Inviting a reply to something that has no conversation would be inviting
  // somebody to write into a void.
  const assignment = await waiting('assignment', null);

  const fake = await fakeRelay();
  try {
    await emailNotificationsHandler(db, settingsWith(fake.port))(job([assignment]), context);
    assert.doesNotMatch(fake.data(), /Reply-To:/);
    assert.match(fake.data(), /Auto-Submitted: auto-generated/);
  } finally {
    await fake.close();
  }
});

test('a notification mail says where to turn it off', { skip: !hasDatabase }, async () => {
  // ADR-0058 said this header was included. It was not, for as long as the
  // feature existed (ADR-0081).
  const mention = await waiting('mention', 't-off');

  const fake = await fakeRelay();
  try {
    await emailNotificationsHandler(db, settingsWith(fake.port))(job([mention]), context);
    assert.match(
      fake.data(),
      /List-Unsubscribe: <https:\/\/sone\.example\/settings\/notifications>/,
    );
  } finally {
    await fake.close();
  }
});
