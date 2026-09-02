/**
 * SONE server — turning comments into notifications (ADR-0052).
 *
 * Made here, in the projection, and never by the client that wrote the comment.
 * A client can be closed before its write lands, can be a build that knows
 * nothing about mentions, and — the reason that settles it — a notification a
 * client creates is a notification a client can forge.
 *
 * Two kinds come out of a thread: somebody was named in a message, and somebody
 * who has written in a thread got a reply. Nothing else, because everything else
 * is an activity feed and this is a list of what needs attention.
 */

import type { PoolClient } from 'pg';

import { isGuestKey, type CommentThread } from '@sone/core';

import { visiblePagesCondition } from '../pages/access.js';

/** A few words, so an inbox can be read without opening every page. */
const EXCERPT = 140;

interface Candidate {
  userId: string;
  kind: 'mention' | 'reply';
  threadId: string;
  messageId: string;
  excerpt: string;
}

/**
 * Who should be told about what, from a page's threads.
 *
 * Exported for its own test: the rules — no self-notification, a reply goes to
 * everybody in the thread who is not its author, a mention wins over a reply for
 * the same person and message — are worth checking without a database.
 */
export function notificationsFor(threads: CommentThread[]): Candidate[] {
  const out = new Map<string, Candidate>();

  for (const thread of threads) {
    /*
     * Who was in the thread *before* each message.
     *
     * Built as the messages are walked rather than taken once for the whole
     * thread, which is what I did first: that told the author of a later reply
     * about every message written before they joined. A notification about
     * something that happened before somebody arrived is not a reply to them.
     */
    const before = new Set<string>();

    for (const message of thread.messages) {
      const excerpt = message.text.slice(0, EXCERPT);

      for (const who of message.mentions) {
        // A guest has no account to notify. Their name in a comment is a label,
        // which is what ADR-0046 said it was — this is where that stops being an
        // abstract statement.
        if (isGuestKey(who)) continue;
        /*
         * Not the author, checked *here* as well as when the message is written.
         *
         * Core drops a self-mention on the way in, and that is not enough: this
         * reads a document, and a document can be written by an old build, by an
         * importer, or by a client that has been tampered with. The whole reason
         * this module exists on the server is that the client is not trusted to
         * decide who gets notified — so it must not be trusted about this
         * either. A test that hand-built a thread found it.
         */
        if (who === message.author) continue;
        out.set(`${who}:${message.id}`, {
          userId: who,
          kind: 'mention',
          threadId: thread.id,
          messageId: message.id,
          excerpt,
        });
      }

      for (const who of before) {
        if (who === message.author || isGuestKey(who)) continue;
        const key = `${who}:${message.id}`;
        /*
         * A mention wins.
         *
         * Somebody named in a reply to their own thread would otherwise get two
         * rows for one message — and "you were asked" is the more useful of the
         * two things to be told.
         */
        if (out.has(key)) continue;
        out.set(key, {
          userId: who,
          kind: 'reply',
          threadId: thread.id,
          messageId: message.id,
          excerpt,
        });
      }

      before.add(message.author);
    }
  }

  return [...out.values()];
}

/**
 * Write them, for the people who may actually read the page.
 *
 * The visibility check is in the insert rather than around it, and that is the
 * point: a notification for a page somebody cannot open would show them its
 * title and a quotation from it, so the disclosure would be the notification
 * rather than the click. The same condition the tree and search use, which is
 * the one that must not drift (ADR-0026).
 *
 * Membership is required by the join, so somebody who has left the workspace is
 * not notified — which is also the honest answer to what should happen.
 */
export async function writeNotifications(
  db: PoolClient,
  pageId: string,
  workspaceId: string,
  threads: CommentThread[],
): Promise<number> {
  const candidates = notificationsFor(threads);
  if (candidates.length === 0) return 0;

  const { rowCount } = await db.query(
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt)
     SELECT c.user_id, $2, $1, c.kind, c.thread_id, c.message_id, c.excerpt
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[])
              AS c(user_id, kind, thread_id, message_id, excerpt)
       JOIN pages p ON p.id = $1
       JOIN workspace_members m
         ON m.workspace_id = p.workspace_id AND m.user_id = c.user_id
      WHERE ${visiblePagesCondition('p', 'c.user_id', "m.role IN ('owner', 'admin')")}
     -- Made once per message. A page is reprojected whenever anything in it
     -- changes, so without this every edit would create the mention again.
     ON CONFLICT (user_id, kind, thread_id, message_id) DO NOTHING`,
    [
      pageId,
      workspaceId,
      candidates.map((one) => one.userId),
      candidates.map((one) => one.kind),
      candidates.map((one) => one.threadId),
      candidates.map((one) => one.messageId),
      candidates.map((one) => one.excerpt),
    ],
  );

  return rowCount ?? 0;
}
