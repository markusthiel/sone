/**
 * SONE server — projecting a page's internal comments (ADR-0057).
 *
 * Not a page's projection. The room writes with its own key as the page id, and
 * `materializeDocument` *inserts* a page row — so running it against a derived
 * document id produced a page nobody created, titled nothing, sitting in the
 * workspace. This projects the comments and nothing else, keyed by the page they
 * belong to rather than by the document they live in.
 */

// In the server, not core: it resolves comment anchors against the document,
// which is a projection concern rather than a document one.
import { writeNotifications } from '../notifications/fromComments.js';
import { readDocument } from './readDocument.js';
import type { Pool, PoolClient } from 'pg';
import type * as Y from 'yjs';

export interface InternalProjectionOptions {
  workspaceId: string;
}

export async function projectInternalComments(
  db: PoolClient,
  pageId: string,
  doc: Y.Doc,
  opts: InternalProjectionOptions,
): Promise<void> {
  /*
   * Read with the *page's* id, not the document's.
   *
   * `readDocument` takes an id for its warnings and for the page map it expects
   * to find. An internal document has no page map — it holds threads and
   * nothing else — so the page half of what comes back is empty and unused.
   */
  const parsed = readDocument(doc, pageId);

  // Rewritten from the document rather than diffed, the same discipline the
  // page's own comment projection uses: a diff would have to decide what an
  // absent row means, and "the thread was deleted" and "this projection is
  // behind" want different answers.
  await db.query(`DELETE FROM page_comments_internal WHERE page_id = $1`, [pageId]);
  if (parsed.comments.length === 0) return;

  await db.query(
    `INSERT INTO page_comments_internal (
       page_id, thread_id, quote, resolved, detached, messages, opened_by,
       created_at, last_message_at
     )
     SELECT $1, unnest($2::text[]), unnest($3::text[]), unnest($4::boolean[]),
            unnest($5::boolean[]), unnest($6::integer[]), unnest($7::text[]),
            to_timestamp(unnest($8::bigint[]) / 1000.0),
            to_timestamp(unnest($9::bigint[]) / 1000.0)
     ON CONFLICT (page_id, thread_id) DO NOTHING`,
    [
      pageId,
      parsed.comments.map((thread) => thread.id),
      parsed.comments.map((thread) => thread.quote),
      parsed.comments.map((thread) => thread.resolved),
      parsed.comments.map((thread) => thread.detached),
      parsed.comments.map((thread) => thread.messages),
      parsed.comments.map((thread) => thread.openedBy),
      parsed.comments.map((thread) => thread.createdAt),
      parsed.comments.map((thread) => thread.lastMessageAt),
    ],
  );

  /*
   * And the notifications a mention in one of these deserves (ADR-0057).
   *
   * The record left this out as the safe direction — "a mention nobody is told
   * about is a smaller fault than one told to somebody who cannot read the
   * thread". Reading the write showed the fear was answered for the case it
   * named: the insert joins `workspace_members`, so a share-link visitor, who
   * has no row there, can never be a recipient.
   *
   * It was not answered for a **member** who may not read the page (ADR-0110).
   * "Only a member can be a recipient" was doing the work of "only somebody who
   * may open it", and a guest is a member. The visibility condition is what
   * separates those two, and it did not: it has been corrected rather than a
   * second check added here, because a second check here is how the two answers
   * to this question got out of step in the first place.
   *
   * So this is one call, not a second notification path. The thread ids come
   * from a different document and cannot collide with the page's own, which is
   * what lets both use the same table and the same "once per message" rule.
   */
  await writeNotifications(db, pageId, opts.workspaceId, parsed.commentThreads);
}
