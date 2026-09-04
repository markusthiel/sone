/**
 * SONE — answering a comment thread from outside the editor (ADR-0076).
 *
 * Two callers: a reply that arrived by email (ADR-0060) and one typed into the
 * inbox. Both do the same two things, and the second of them was missing from
 * the first for as long as it existed.
 *
 * **Write the message into the document.** Comments live in the CRDT, not in a
 * table, so this is a document write like any other. A room holding that
 * document hears about it through the update bus and shows it to whoever has
 * the page open — that is what the bus is for, and it is now tested.
 *
 * **Then project it.** Notifications are written by the materialiser, from the
 * comments it finds. A reply that is only appended to the document notifies
 * nobody until something else happens to reproject the page — which is what the
 * email path did, so answering by mail told the person you were answering
 * exactly nothing. The room cannot cover for us: it applies an outside update
 * with the origin `remote-bus` and deliberately does not persist or project it,
 * because whoever wrote it is responsible for both.
 *
 * So the two halves live here, together, where a caller cannot take one and
 * forget the other.
 */

import type { Pool } from 'pg';

import { addMessage } from '@sone/core';

import { withTransaction } from '../db/pool.js';
import { applyToDocument, loadDoc } from '../doc/docStore.js';
import { projectInternalComments } from '../materialize/internalComments.js';
import { rematerialize } from '../materialize/rematerialize.js';

export interface ReplyInput {
  /** The document to write into: the page, or its internal comments (ADR-0057). */
  docId: string;
  /** The page the thread belongs to, which is what gets projected. */
  pageId: string;
  workspaceId: string;
  threadId: string;
  /** Who is answering. Stored as the author, and as the update's actor. */
  authorId: string;
  text: string;
  /** True when `docId` is the internal comments document. */
  internal?: boolean;
  /** How it arrived, when not typed in SONE (ADR-0060). */
  via?: 'email';
  trimmed?: boolean;
  hadAttachments?: boolean;
}

/** An id of our own. A mail's Message-ID belongs to the mail, not to a comment. */
function messageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Post a reply, and project the result.
 *
 * Returns false when nothing changed, which means the thread is not in the
 * document — deleted, or never there. `addMessage` is a no-op in that case
 * rather than an error, so the document's own answer is what decides.
 */
export async function postReply(pool: Pool, input: ReplyInput): Promise<boolean> {
  const { changed } = await applyToDocument(
    pool,
    input.docId,
    (doc) => {
      addMessage(doc, input.threadId, {
        id: messageId(),
        author: input.authorId,
        text: input.text,
        ...(input.via ? { via: input.via } : {}),
        ...(input.trimmed ? { trimmed: true } : {}),
        ...(input.hadAttachments ? { hadAttachments: true } : {}),
      });
    },
    input.authorId,
  );

  if (!changed) return false;

  if (input.internal) {
    /*
     * An internal document is not a page, so it does not get a page's
     * projection (ADR-0057): `materializeYDoc` would insert a page row for a
     * document nobody created. Its comments are projected on their own, into
     * their own table — the same branch the room takes.
     */
    const loaded = await loadDoc(pool, input.docId);
    try {
      await withTransaction(pool, (client) =>
        projectInternalComments(client, input.pageId, loaded.doc, {
          workspaceId: input.workspaceId,
        }),
      );
    } finally {
      loaded.doc.destroy();
    }
  } else {
    await rematerialize(pool, input.pageId, input.workspaceId, input.authorId);
  }

  return true;
}
