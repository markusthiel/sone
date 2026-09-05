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
/**
 * A uuid, for a column that holds one.
 *
 * A mention node's `userId` is written by a client, so it is whatever a client
 * put there — and the projection is not the place to find that out from
 * Postgres.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An author key as an account id, or null when it is not one.
 *
 * `actor_id` is `uuid REFERENCES users (id)`, nullable precisely for "there is
 * no account to name". A comment's author is a user id **or** a `guest:` key
 * (ADR-0046), and this passed it through unchecked — so the moment a visitor
 * replied through a share link, the INSERT tried `'guest:Lars'::uuid` and threw
 * `22P02`.
 *
 * That is not a lost notification, it is a lost **page**. The insert runs
 * inside the projection's transaction, so the whole rewrite rolled back:
 * comment counts, blocks, search row, all of it — and the guest's message stays
 * in the document, so every later projection hit the same value and rolled back
 * again. `isPermanentWriteFailure` does not count `22P02`, so the room retried
 * for ever rather than saying so (ADR-0092).
 *
 * `textMentionsFor` guards exactly this, one function down, and this one was
 * never given the same guard.
 */
function accountOrNull(author: string): string | null {
  return !isGuestKey(author) && UUID.test(author) ? author : null;
}

const EXCERPT = 140;

interface Candidate {
  userId: string;
  /**
   * Who caused it, when that is known (ADR-0058).
   *
   * Null for anything whose actor cannot be determined, and for rows written
   * before the column existed. A name is not content, so there is no reason of
   * principle to leave it out — it simply was not recorded until the email work
   * needed it and found it missing.
   */
  actorId: string | null;
  kind: 'mention' | 'reply' | 'assignment';
  threadId: string | null;
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
          actorId: accountOrNull(message.author),
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
          actorId: accountOrNull(message.author),
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
 * Who has been given a task on this page (ADR-0052).
 *
 * The block id stands in for the message id, which is what makes this idempotent
 * for free: reassigning writes a row for the new person and finds the old one
 * already there, and re-projecting an unchanged page writes nothing.
 *
 * The consequence, and it is the right one: assigning the same task to somebody
 * twice — assign, unassign, assign again — tells them once. A notification is
 * "you have this", not a log of who decided what.
 */
export function assignmentsFor(
  blocks: Array<{ id: string; type: string; props: Record<string, unknown>; plainText: string }>,
  /** Whose edit produced this projection, if anybody's (ADR-0058). */
  assignedBy: string | null = null,
): Candidate[] {
  const out: Candidate[] = [];
  for (const block of blocks) {
    if (block.type !== 'todo') continue;
    const who = block.props['assignee'];
    if (typeof who !== 'string' || who === '' || isGuestKey(who)) continue;
    out.push({
      userId: who,
      /*
       * Whoever's edit produced this projection.
       *
       * A todo block records its assignee and not who assigned it, so the
       * actor here is the person whose write created the row — which is the
       * same person in every ordinary case and is honestly null when the
       * projection was not caused by anybody's edit.
       */
      actorId: assignedBy,
      kind: 'assignment',
      threadId: null,
      messageId: block.id,
      excerpt: block.plainText.slice(0, EXCERPT),
    });
  }
  return out;
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

/**
 * Who was named in the page's own text (ADR-0085).
 *
 * A mention in a comment and a mention in a paragraph are the same act — "look
 * at this, I mean you" — so they are the same kind of notification, addressed
 * by the block instead of by the message. The block is what makes it stable:
 * one per person per block, so editing the sentence around a name does not
 * announce it again, and it is also where the notification sends somebody.
 *
 * Never to the person who wrote it. Somebody who has just typed a colleague's
 * name knows they typed it, and a mention of *yourself* is a note to self —
 * which is a fine thing to write and not a thing to be told about.
 *
 * **Who wrote it comes from the document, not from the actor** (ADR-0091). This
 * compared against `actorId`, which is the projection's actor — set in the sync
 * room on every inbound message from every connection, before the
 * write-permission check, and kept for the next flush. So it was not "who typed
 * this", it was "who last said anything": whoever had the page open when the
 * flush ran. And the person most likely to have a page open the moment somebody
 * names them is the person being named — whose own mention was then dropped as
 * a note to self, permanently, because `ON CONFLICT DO NOTHING` prevents a
 * duplicate and never fills a gap.
 *
 * `writtenBy` is null when the document does not say — an old page, or
 * attribution pruned after the writer's other words went (ADR-0022). Then
 * nothing is filtered, and a self-mention notifies once. That is the right way
 * round: telling somebody about their own sentence is a small annoyance, and
 * silently dropping everybody else's is the bug this replaces.
 */
export function textMentionsFor(
  mentions: Array<{ userId: string; blockId: string; writtenBy?: string | null }>,
  blocks: Array<{ id: string; plainText: string }>,
  actorId: string | null,
): Candidate[] {
  if (mentions.length === 0) return [];
  const textOf = new Map(blocks.map((block) => [block.id, block.plainText]));

  return mentions
    .filter((one) => {
      // A guest key is not an account and the column is a uuid: inserting one
      // aborts the whole projection with `invalid input syntax for type uuid`,
      // which takes the page's comment counts and search row down with it.
      // `notificationsFor` and `assignmentsFor` both drop these; this did not.
      if (isGuestKey(one.userId) || !UUID.test(one.userId)) return false;
      // Written by somebody, and that somebody is not the person named.
      return one.writtenBy == null || one.writtenBy !== one.userId;
    })
    .map((one) => ({
      userId: one.userId,
      /*
       * Who to name as "X mentioned you", and the document knows better than
       * the flush does. Falls back to the actor when it does not — and never
       * uses a guest key, which the column cannot hold.
       */
      actorId:
        one.writtenBy && !isGuestKey(one.writtenBy) && UUID.test(one.writtenBy)
          ? one.writtenBy
          : actorId,
      kind: 'mention' as const,
      // No thread. The uniqueness constraint is NULLS NOT DISTINCT over
      // (user_id, kind, thread_id, message_id), so the block id alone keeps
      // this to one notification (migration 0040).
      threadId: null,
      messageId: one.blockId,
      excerpt: (textOf.get(one.blockId) ?? '').slice(0, EXCERPT),
    }));
}

export async function writeNotifications(
  db: PoolClient,
  pageId: string,
  workspaceId: string,
  threads: CommentThread[],
  /** Task blocks, for assignments (ADR-0052). */
  blocks: Array<{
    id: string;
    type: string;
    props: Record<string, unknown>;
    plainText: string;
  }> = [],
  /** Whose edit produced this projection, for an assignment's actor (ADR-0058). */
  actorId: string | null = null,
  /** Who was named in the page's own text (ADR-0085). */
  mentions: Array<{ userId: string; blockId: string }> = [],
): Promise<number> {
  const candidates = [
    ...notificationsFor(threads),
    ...assignmentsFor(blocks, actorId),
    ...textMentionsFor(mentions, blocks, actorId),
  ];
  if (candidates.length === 0) return 0;

  const { rowCount } = await db.query(
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt, actor_id)
     SELECT c.user_id, $2, $1, c.kind, c.thread_id, c.message_id, c.excerpt, c.actor_id
       FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::uuid[])
              AS c(user_id, kind, thread_id, message_id, excerpt, actor_id)
       JOIN pages p ON p.id = $1
       JOIN workspace_members m
         ON m.workspace_id = p.workspace_id AND m.user_id = c.user_id
      WHERE ${visiblePagesCondition('p', 'c.user_id')}
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
      candidates.map((one) => one.actorId),
    ],
  );

  return rowCount ?? 0;
}
