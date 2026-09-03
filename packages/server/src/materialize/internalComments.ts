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
import { readDocument } from './readDocument.js';
import type { Pool, PoolClient } from 'pg';
import type * as Y from 'yjs';

export interface InternalProjectionOptions {
  workspaceId: string;
}

export async function projectInternalComments(
  db: Pool | PoolClient,
  pageId: string,
  doc: Y.Doc,
  _opts: InternalProjectionOptions,
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
}
