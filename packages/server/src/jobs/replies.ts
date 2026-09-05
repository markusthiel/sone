/**
 * SONE server — turning a reply mail into a comment (ADR-0060).
 *
 * The poll that ties the four pieces together: fetch what is unread, read the
 * token out of the address it was delivered to, trim the reply to what somebody
 * typed, and write it into the document the thread lives in.
 *
 * Two rules run through all of it:
 *
 * - **The `From` header is never consulted.** The reply is written as whoever
 *   the token names. That is the whole reason this feature is safe to have.
 * - **A message that cannot be used is left unread**, and its sender is told
 *   once. A mailbox somebody else also uses must not lose their mail to us, and
 *   silence would leave somebody believing they had answered a colleague.
 */

import { internalDocId } from '@sone/core';
import { createHash } from 'node:crypto';

import { postReply } from '../comments/postReply.js';
import { queryOne } from '../db/pool.js';
import { fetchUnread, type Mailbox } from '../mail/imap.js';
import { addressIn, deliveredAddresses, readMail } from '../mail/readMail.js';
import { atLeast, resolvePageAccess } from '../pages/access.js';
import { readReplyToken, tokenFromAddress, type ReplyTarget } from '../mail/replyToken.js';
import { trimReply } from '../mail/trimReply.js';
import type { Pool } from 'pg';

const sha1 = (data: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha1').update(data).digest());

export interface ReplyDeps {
  pool: Pool;
  mailbox: Mailbox;
  secret: string;
  /**
   * Tell somebody their reply could not be used. One mail, never more.
   *
   * `to` is null when the `From` header holds nothing that can be written to.
   * The refusal still happens — it is the caller's business what to do when it
   * cannot be delivered, and quietly doing nothing is not one of the options
   * (ADR-0078).
   */
  refuse: (to: string | null, reason: RefusalReason) => Promise<void>;
}

export type RefusalReason =
  | 'expired_link'
  | 'not_for_us'
  | 'no_text'
  | 'thread_gone'
  | 'no_access';

/**
 * Where a thread lives, from the notification that announced it.
 *
 * The token names a thread and a message; the notification is what knows which
 * *page* they belong to. Looking it up is therefore necessary — and it is also
 * a second check for free: a token whose notification has been deleted, or
 * which never matched one, cannot post.
 */
async function locate(
  pool: Pool,
  target: ReplyTarget,
): Promise<{ pageId: string; workspaceId: string } | null> {
  return queryOne<{ pageId: string; workspaceId: string }>(
    pool,
    `SELECT n.page_id::text AS "pageId", n.workspace_id::text AS "workspaceId"
       FROM notifications n
       JOIN pages p ON p.id = n.page_id
       JOIN workspaces w ON w.id = n.workspace_id
      WHERE n.thread_id = $1 AND n.message_id = $2 AND n.user_id = $3
        -- A page in the trash and a workspace on its way out are not places to
        -- write to. The same condition the inbox route uses, for the same
        -- reason and in the same words.
        AND p.archived_at IS NULL AND w.deleted_at IS NULL`,
    [target.threadId, target.messageId, target.userId],
  );
}

/**
 * Whether this person may still write to that page.
 *
 * Checked at the moment the reply arrives, not when the notification was sent:
 * somebody removed from a workspace in the meantime must not be able to post
 * from an old mail. This is the one place where a fortnight-long token could
 * otherwise outlive the access it was issued under.
 *
 * **It asks the same question the inbox route asks, in the same words.** It did
 * not: it took any row in `workspace_members` as permission, which is a weaker
 * rule than the one the rest of SONE enforces, and weaker in two ways that
 * matter. A **guest** is a member of a workspace and gets nothing by role
 * (ADR-0026) — but was accepted here. A **restricted** page ignores the member
 * default and grants only what was granted explicitly — but this never looked
 * at `restricted`, at `page_permissions`, or at `page_group_permissions`, so a
 * plain member could answer by mail on a page they cannot open in SONE.
 *
 * Being mentioned on a page is what produces the notification, and the
 * notification is what carries the token. Losing access afterwards is exactly
 * the case this function exists for, and it was the case it got wrong.
 */
async function mayComment(pool: Pool, pageId: string, userId: string): Promise<boolean> {
  const { access } = await resolvePageAccess(pool, { pageId, userId });
  return atLeast(access, 'commenter');
}

/** One poll. Returns what it did, for the job's result. */
export async function pollReplies(deps: ReplyDeps): Promise<{
  posted: number;
  refused: number;
  ignored: number;
}> {
  let posted = 0;
  let refused = 0;
  let ignored = 0;

  await fetchUnread(deps.mailbox, async (message) => {
    const mail = readMail(message.raw);
    // The bare address, not the header. See `addressIn`: handing the whole
    // header to the relay produced an envelope every relay rejects, and the
    // throw left the mail unread to be tried again forever.
    const sender = addressIn(mail.headers.get('from'));

    const token = deliveredAddresses(mail.headers)
      .map((address) => tokenFromAddress(address))
      .find((one): one is string => one !== null);

    if (!token) {
      // Not addressed to us at all. Left alone and *not* answered: replying to
      // every stray mail in a shared mailbox would make SONE a nuisance.
      ignored += 1;
      return 'leave';
    }

    const read = readReplyToken(token, deps.secret);
    if (!read.ok) {
      /*
       * A forged or malformed token gets nothing back, an expired one does.
       *
       * Answering a bad signature would confirm to whoever sent it that the
       * address is live and the format is close — and there is nobody to help,
       * because nobody legitimate produces one. An expired token is a real
       * person whose mail sat too long, and they deserve to know.
       */
      if (read.reason === 'expired') {
        await deps.refuse(sender, 'expired_link');
        refused += 1;
        return 'read';
      }
      ignored += 1;
      return 'leave';
    }

    const where = await locate(deps.pool, read.target);
    if (!where) {
      await deps.refuse(sender, 'thread_gone');
      refused += 1;
      return 'read';
    }

    if (!(await mayComment(deps.pool, where.pageId, read.target.userId))) {
      await deps.refuse(sender, 'no_access');
      refused += 1;
      return 'read';
    }

    const body = mail.text === null ? null : trimReply(mail.text);
    if (body === null || body.text === '') {
      await deps.refuse(sender, 'no_text');
      refused += 1;
      return 'read';
    }

    const docId = read.target.internal
      ? internalDocId(where.pageId, sha1)
      : where.pageId;

    /*
     * Written *and projected*, which it was not (ADR-0076).
     *
     * This appended the message to the document and stopped. Notifications are
     * written by the materialiser from the comments it finds, so a reply that
     * arrived by mail told the person being answered nothing at all — until
     * somebody happened to edit that page and the projection ran for another
     * reason. The two halves live together now, in one place, where a caller
     * cannot take one and forget the other.
     */
    const written = await postReply(deps.pool, {
      docId,
      pageId: where.pageId,
      workspaceId: where.workspaceId,
      threadId: read.target.threadId,
      authorId: read.target.userId,
      text: body.text,
      ...(read.target.internal ? { internal: true } : {}),
      via: 'email',
      // Marked, because quote trimming is guesswork and a reader should be able
      // to tell that a machine cut a reply rather than that a colleague wrote
      // something strange (ADR-0060).
      ...(body.trimmed ? { trimmed: true } : {}),
      ...(mail.hadAttachments ? { hadAttachments: true } : {}),
    });

    if (!written) {
      // The thread is not in the document any more: deleted while the mail was
      // in flight. The same answer as a thread that was never there.
      await deps.refuse(sender, 'thread_gone');
      refused += 1;
      return 'read';
    }

    posted += 1;
    return 'read';
  });

  return { posted, refused, ignored };
}
