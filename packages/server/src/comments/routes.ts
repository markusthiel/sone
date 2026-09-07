/**
 * SONE server — writing a comment without writing the document (ADR-0090).
 *
 * ## Why a route exists at all
 *
 * Comments live in the page's CRDT (ADR-0046), so an editor writes one the same
 * way they write a sentence: a Yjs update over the sync connection. That is
 * still true and nothing here changes it.
 *
 * But the sync room's write gate is **document-wide**: `atLeast(role, 'editor')`
 * in `sync/server.ts`, and `room.ts` refuses the whole update below it. A Yjs
 * update that adds a thread is indistinguishable from one that rewrites the
 * page — it is opaque bytes, and deciding what it touches means applying it to
 * a scratch copy and diffing. So `commenter`, the level whose entire purpose is
 * "may say something and may not change anything", could not say anything.
 *
 * Not only guests. A **member** whose role or grant gives `commenter` was in
 * exactly the same position, which is why `SelectionToolbar` gates the comment
 * button on `canEdit` with a note saying commenting requires edit rights "until
 * there is a role that separates them". This is that separation.
 *
 * ## Why this is not two answers to one question
 *
 * ADR-0086 is about two *decisions* drifting apart. This is one decision —
 * `canComment`, from the same claims — reached over two transports, and the
 * transport follows the write right the person already has:
 *
 *   - somebody who may write the document writes it, and their comment rides
 *     along with everything else they type;
 *   - somebody who may not asks the server to write one specific thing.
 *
 * The guarantee that makes this safe is structural rather than parsed: these
 * routes never receive a document update. They receive a quotation, an anchor
 * and some text, and the server itself calls `addThread` / `addMessage`. There
 * is no argument to these routes that can touch a paragraph.
 *
 * ## What is deliberately not here
 *
 * **The internal document (ADR-0057).** These routes write the page's own
 * comments and take no parameter naming a document. An internal thread is
 * reached by a derived id over sync, and that path already refuses anybody who
 * is not a workspace user — a second door to it, in the module a share link
 * talks to, is the last thing that should exist.
 *
 * **Resolving.** Closing somebody else's thread is a judgement about the page,
 * not a contribution to it, and it stays where it was.
 */

import type { Pool } from 'pg';
import * as Y from 'yjs';

import { addMessage, addThread, guestKey, isPlace, readThreads } from '@sone/core';

import { canComment, loadPageLocation } from '../auth/claims.js';
import { applyToDocument, loadDoc } from '../doc/docStore.js';
import { queryOne, withTransaction } from '../db/pool.js';
import { claimsForRequest } from '../http/auth.js';
import { rematerialize } from '../materialize/rematerialize.js';
import { BodyError, type RequestContext, type Router } from '../http/router.js';
import type { AccessClaims } from '../auth/claims.js';

export interface CommentDeps {
  pool: Pool;
}

/** The same cap core enforces, checked here so an over-long body is refused. */
const MAX_MESSAGE = 4000;
const MAX_QUOTE = 300;

/**
 * An id of our own, in the shape the client already writes.
 *
 * Not the client's: an id chosen by the caller is an id the caller can reuse to
 * overwrite a thread that is already there.
 */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * How this message signs itself.
 *
 * A member signs with their user id. A visitor holding a link has no account,
 * so they sign with the `guest:` key ADR-0022 defined for prose attribution and
 * ADR-0046 named for exactly this case — and the consequence is the one that
 * record already accepted: two visitors who both type "Anna" are one name in
 * the thread. More visible here than in a list of contributors, and still the
 * honest answer, because there is nothing else to tell them apart by.
 *
 * **The name may come with the request, and only for a visitor.** The first
 * version refused it, on the grounds that a request naming its own author is a
 * request that can sign somebody else's name. That is right about a member and
 * empty about a guest: the name on a share session was typed into a box by the
 * same person, over a different wire. What actually stops a visitor from
 * signing as a colleague is the `guest:` prefix, which the panel draws as a
 * guest badge — not where the string arrived from.
 *
 * And refusing it did not leave the name alone, it lost it: the share cookie
 * cannot say which visitor is asking, so the session resolved on this path was
 * a nameless one and every guest comment was signed "Guest" (ADR-0092).
 */
function authorOf(claims: AccessClaims, given: unknown): string {
  if (claims.principal.kind !== 'anonymous') return claims.principal.userId;
  const asked = typeof given === 'string' ? given.trim() : '';
  return guestKey(asked !== '' ? asked : claims.principal.displayName);
}

/**
 * Base64 back to the bytes `Y.encodeRelativePosition` produced — decoded, not
 * merely decoded-looking.
 *
 * The first version checked that the string was base64 and wrote the bytes
 * through, on the grounds that a relative position is opaque and an anchor that
 * resolves nowhere is a *detached* thread, which is a state the panel already
 * draws on purpose (ADR-0046).
 *
 * That was wrong, and a test with three junk bytes in it found out how. An
 * anchor that is not a relative position does not resolve to nothing — reading
 * it **throws**, inside `readThreads`, which the materialiser calls. So a
 * visitor could post a few bytes and leave the page unable to project: no
 * comment counts, no notifications, no search row, for everybody, until
 * somebody found the thread in the document and deleted it.
 *
 * So the anchor is decoded here. Not resolved — that needs the document and
 * would refuse a legitimate anchor whose text has since been deleted — but
 * parsed, which is the difference between "points nowhere" and "is not one".
 */
function anchorBytes(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    return new Uint8Array(Buffer.from(value, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Would a thread with these anchors be readable?
 *
 * Asked by **doing what the reader does**, on a document of its own: write the
 * thread into an empty `Y.Doc` and read it back. If that throws, the same call
 * would throw inside the materialiser, on the real page, for everybody.
 *
 * A narrower check was tried first and was not enough. `decodeRelativePosition`
 * accepts three arbitrary bytes without complaint and `readThreads` then fails
 * on them further in — so "it decodes" and "it can be read" are two different
 * questions, and only the second one is the one that matters. Validating by
 * running the reader cannot drift from the reader, which a hand-written parser
 * of the same bytes would do the first time Yjs changed the format.
 *
 * The scratch document is empty, so the anchors resolve to nothing and the
 * thread comes back detached — which is correct and is not what is being
 * checked. Detached is a state the panel draws (ADR-0046); unreadable is not a
 * state at all.
 */
function readableAnchors(from: Uint8Array, to: Uint8Array): boolean {
  const scratch = new Y.Doc();
  try {
    addThread(scratch, {
      id: 'probe',
      from,
      to,
      quote: '',
      messageId: 'probe',
      author: 'probe',
      text: 'probe',
    });
    readThreads(scratch);
    return true;
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
}

export function registerCommentRoutes(router: Router, deps: CommentDeps): void {
  /**
   * Who is asking, and may they comment on this page.
   *
   * 404 for every refusal that is not "no credential at all", like everywhere
   * else: a 403 on a page id confirms the page exists.
   */
  const commenterOn = async (
    ctx: RequestContext,
    pageId: string,
  ): Promise<{ claims: AccessClaims; workspaceId: string } | null> => {
    const page = await loadPageLocation(deps.pool, pageId);
    if (!page) {
      ctx.fail(404, 'not_found');
      return null;
    }

    const resolved = await claimsForRequest(deps.pool, ctx, page.workspaceId);
    if (resolved.kind === 'anonymous') {
      ctx.fail(401, 'not_authenticated');
      return null;
    }
    if (resolved.kind !== 'ok' || !canComment(resolved.claims, page)) {
      ctx.fail(404, 'not_found');
      return null;
    }

    return { claims: resolved.claims, workspaceId: page.workspaceId };
  };

  /** The text of a message, or null with the request already answered. */
  const textFrom = async (
    ctx: RequestContext,
  ): Promise<{ text: string; body: Record<string, unknown> } | null> => {
    let body: Record<string, unknown>;
    try {
      body = await ctx.json<Record<string, unknown>>();
    } catch (err) {
      if (err instanceof BodyError) {
        ctx.fail(err.code === 'body_too_large' ? 413 : 400, err.code);
        return null;
      }
      throw err;
    }

    const text = typeof body['text'] === 'string' ? body['text'].trim() : '';
    if (text === '') {
      ctx.fail(422, 'empty_message');
      return null;
    }
    if (text.length > MAX_MESSAGE) {
      ctx.fail(422, 'message_too_long');
      return null;
    }
    return { text, body };
  };

  /**
   * Start a thread.
   *
   * The anchor arrives as two base64 relative positions, because that is what
   * the editor produced and JSON has no bytes. They are written through
   * unexamined — a relative position is opaque to everything except Yjs, and
   * an anchor that resolves nowhere makes a detached thread, which is a state
   * the panel already draws (ADR-0046). The one thing checked is that it is
   * base64, so a stray string cannot be stored as an anchor.
   */
  router.post('/api/pages/:pageId/comments', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const who = await commenterOn(ctx, pageId);
    if (!who) return;

    const read = await textFrom(ctx);
    if (!read) return;

    const from = anchorBytes(read.body['from']);
    const to = anchorBytes(read.body['to']);
    if (!from || !to || !readableAnchors(from, to)) {
      ctx.fail(422, 'invalid_anchor');
      return;
    }
    const item = typeof read.body['item'] === 'string' ? read.body['item'] : undefined;

    /*
     * A place in a PDF, refused rather than mended (ADR-0151).
     *
     * The same rule the anchor above arrived at, for the shape that follows it:
     * a page of zero, a rectangle of three numbers, a width of nothing — none
     * of them is a mark anything can draw, and a shape written through
     * unexamined is a question every reader has to answer instead of this one
     * line.
     *
     * Absent is not refused: almost every comment is about text and says so by
     * saying nothing.
     */
    const place = read.body['place'];
    if (place !== undefined && !isPlace(place)) {
      ctx.fail(422, 'invalid_place');
      return;
    }
    const quote =
      typeof read.body['quote'] === 'string' ? read.body['quote'].slice(0, MAX_QUOTE) : '';

    const threadId = newId('t');
    const messageId = newId('m');
    const author = authorOf(who.claims, read.body['name']);

    const { changed } = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        addThread(doc, {
          id: threadId,
          from,
          to,
          quote,
          messageId,
          author,
          text: read.text,
          ...(item ? { item } : {}),
          ...(isPlace(place) ? { place } : {}),
          // No mentions. A visitor cannot enumerate the workspace's people and
          // must not be able to address one by id; a member commenting through
          // this route has the panel's own picker and the sync path. The reply
          // rule below covers what a mention would have been for here: whoever
          // is already in the thread is told.
        });
      },
      // Not the author: this column takes a user id, and a guest key is not
      // one. The message carries who wrote it, which is where a comment's
      // authorship belongs (ADR-0046).
      actorIdFor(who.claims),
    );
    if (!changed) {
      // `addThread` is a no-op past MAX_THREADS, and a silent 201 would be a
      // comment somebody believes they made.
      ctx.fail(409, 'too_many_threads');
      return;
    }

    await rematerialize(deps.pool, pageId, who.workspaceId, actorIdFor(who.claims));
    await notifyLinkOwner(deps.pool, {
      claims: who.claims,
      pageId,
      workspaceId: who.workspaceId,
      threadId,
      messageId,
      excerpt: read.text.slice(0, 200),
    });

    ctx.send(201, { threadId, messageId });
  });

  /** Reply to one. */
  router.post('/api/pages/:pageId/comments/:threadId/messages', async (ctx) => {
    const pageId = ctx.params['pageId'] ?? '';
    const threadId = ctx.params['threadId'] ?? '';
    const who = await commenterOn(ctx, pageId);
    if (!who) return;

    const read = await textFrom(ctx);
    if (!read) return;

    const messageId = newId('m');
    const { changed } = await applyToDocument(
      deps.pool,
      pageId,
      (doc) => {
        addMessage(doc, threadId, {
          id: messageId,
          author: authorOf(who.claims, read.body['name']),
          text: read.text,
        });
      },
      actorIdFor(who.claims),
    );
    // `addMessage` does nothing when the thread is not there — deleted, or
    // never was. The document's own answer decides, as it does for a reply
    // arriving by mail.
    if (!changed) {
      ctx.fail(404, 'not_found');
      return;
    }

    // The projection is what writes notifications, and a reply goes to
    // everybody already in the thread. So a guest's answer reaches the people
    // discussing it without a mention and without a name they could not have
    // known.
    await rematerialize(deps.pool, pageId, who.workspaceId, actorIdFor(who.claims));

    ctx.send(201, { messageId });
  });
}

/** The user id to record as the update's actor, or null for a visitor. */
function actorIdFor(claims: AccessClaims): string | null {
  return claims.principal.kind === 'anonymous' ? null : claims.principal.userId;
}

/**
 * Tell whoever shared the page that a visitor opened a thread on it.
 *
 * A reply notifies everybody already in the thread, which is the rule the
 * projection applies and it needs no help. A **new** thread has nobody in it
 * yet, so a visitor's first comment would notify nobody at all — and a comment
 * nobody hears about is a comment lost, which is the lesson ADR-0081 paid for
 * with a queue that never retried.
 *
 * Who to tell is not a guess: a visitor is holding a link, and a link has
 * somebody who made it. That person chose to let this page out, so they are the
 * one who owes it an answer.
 *
 * Written here rather than in `notificationsFor` because that function reads a
 * *document*, and a document knows nothing about who shared it. Teaching it
 * would mean carrying the share token through the materialiser for the sake of
 * one case.
 *
 * Best-effort on purpose: the comment is already in the document, and failing
 * the request after that would tell the visitor their comment did not happen.
 */
async function notifyLinkOwner(
  pool: Pool,
  input: {
    claims: AccessClaims;
    pageId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
    excerpt: string;
  },
): Promise<void> {
  if (input.claims.principal.kind !== 'anonymous') return;
  const tokenId = input.claims.grants[0]?.tokenId;
  if (!tokenId) return;

  const owner = await queryOne<{ created_by: string | null }>(
    pool,
    `SELECT created_by FROM share_tokens WHERE id = $1`,
    [tokenId],
  );
  if (!owner?.created_by) return;

  await pool.query(
    // The membership join and the ON CONFLICT are the same ones
    // `writeNotifications` uses: somebody who has left the workspace is not
    // told, and a page reprojected twice does not notify twice. No visibility
    // condition is needed on top — this is the person who shared the page.
    `INSERT INTO notifications
       (user_id, workspace_id, page_id, kind, thread_id, message_id, excerpt, actor_id)
     SELECT $1, $2, $3, 'reply', $4, $5, $6, NULL
       FROM workspace_members m
      WHERE m.workspace_id = $2 AND m.user_id = $1
     ON CONFLICT (user_id, kind, thread_id, message_id) DO NOTHING`,
    [
      owner.created_by,
      input.workspaceId,
      input.pageId,
      input.threadId,
      input.messageId,
      input.excerpt,
    ],
  );
}

/**
 * The people whose names a page's comments need, and nobody else.
 *
 * A visitor holding a link is shown comments written by members, and a comment
 * whose author has no name is a comment you cannot read — "somebody objected
 * here" is barely better than no comment at all.
 *
 * The obvious fix is to hand the panel the workspace's member list, and it is
 * wrong: that is a directory of everybody who works here, given to whoever
 * forwards a link. `ShareSession` passes `members={[]}` on purpose.
 *
 * So the answer is the narrow one. This reads the page's own document,
 * collects the ids that actually wrote a message on **this page**, and returns
 * names for those. Not a lookup the caller can steer: the ids come from the
 * document, never from the request, so it cannot be asked "who is this id".
 */
export async function commentAuthorsOf(
  pool: Pool,
  pageId: string,
): Promise<Array<{ id: string; name: string }>> {
  const loaded = await loadDoc(pool, pageId);
  let ids: string[];
  try {
    ids = [
      ...new Set(
        readThreads(loaded.doc)
          .flatMap((thread) => thread.messages.map((message) => message.author))
          // A guest key carries its own name; only accounts need looking up.
          .filter((author) => !author.startsWith('guest:')),
      ),
    ];
  } finally {
    loaded.doc.destroy();
  }
  if (ids.length === 0) return [];

  const rows = await pool.query<{ id: string; display_name: string }>(
    // Names only. Not addresses: a name is what a thread needs to be readable,
    // and an address is a way to reach somebody who never chose to be reached
    // by whoever holds this link.
    `SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows.rows.map((row) => ({ id: row.id, name: row.display_name }));
}
