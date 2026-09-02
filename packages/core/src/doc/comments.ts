/**
 * SONE core — comment threads (ADR-0046).
 *
 * A thread points at a range of text that other people are editing at the same
 * time, so the anchor is a pair of `Y.RelativePosition`s: a position named by the
 * item it sits beside rather than by how far along it is. That is the whole
 * reason this file exists — an offset would be wrong the first time somebody
 * typed a line above it, and a block id plus an offset would break the first time
 * that block was split.
 *
 * The positions are stored encoded, so an anchor is bytes and can live in the
 * document like any other value. Converting a ProseMirror position into one is
 * the editor's job (it needs the mapping); this file only stores and resolves.
 */

import * as Y from 'yjs';

import { DOC_KEYS } from './docSchema.js';

export const THREAD_KEYS = {
  /** Encoded Y.RelativePosition for the start of the commented range. */
  from: 'from',
  /** And its end. */
  to: 'to',
  /**
   * The text as it read when the comment was made.
   *
   * Not a cache — it is what the comment is *about*. "This paragraph is wrong"
   * is unreadable a week later if the paragraph has been rewritten, and the
   * quotation is the difference between a thread somebody can still understand
   * and one that has to be deleted because nobody can tell what it meant.
   */
  quote: 'quote',
  /** A decision that was made, kept rather than deleted. */
  resolved: 'resolved',
  /** Who resolved it, and when. */
  resolvedBy: 'resolvedBy',
  resolvedAt: 'resolvedAt',
  /** The messages, oldest first. */
  messages: 'messages',
  createdAt: 'createdAt',
} as const;

export const MESSAGE_KEYS = {
  id: 'id',
  /**
   * Who said this, as a field.
   *
   * Unlike prose, where authorship is inferred from client ids and pruned when
   * the words go (ADR-0022): a comment is a statement by a person, and an
   * unsigned comment is a different thing from a signed one. A guest carries the
   * same `guest:` key the people panel uses.
   */
  author: 'author',
  at: 'at',
  /** One text field. A document per message would be a second editor in a list. */
  text: 'text',
} as const;

/** How long a quotation is kept. Enough to recognise a passage, not to mirror it. */
export const MAX_QUOTE = 300;
export const MAX_MESSAGE = 4000;
/** Per page. A page needing more than this has a different problem. */
export const MAX_THREADS = 500;

export interface CommentMessage {
  id: string;
  author: string;
  at: number;
  text: string;
}

export interface CommentThread {
  id: string;
  /**
   * The anchor as stored.
   *
   * Returned as well as resolved, because the two consumers work in different
   * coordinate systems: this module resolves against the Yjs document, and the
   * editor has to resolve the same bytes against ProseMirror's positions through
   * y-prosemirror's mapping. Handing back only the resolved range would make the
   * editor decode the document a second time to get at them.
   */
  from: Uint8Array;
  to: Uint8Array;
  quote: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
  createdAt: number;
  messages: CommentMessage[];
  /**
   * Where the thread points, or null when the text is gone.
   *
   * A thread whose anchor no longer resolves is *detached*, not deleted: losing
   * it would mean somebody's objection vanishes when the text they objected to
   * is removed, which is the case where the objection matters most.
   *
   * Null covers two cases, and the second was a surprise the tests found. An
   * anchor can simply fail to decode. But when the commented text is *deleted*,
   * Yjs does not fail: a relative position binds to an item, and a deleted item
   * still has a place, so both ends resolve — to the same index. So a detached
   * thread usually presents as a range of length zero rather than as an error,
   * and treating only decode failure as detachment would have left a highlight
   * of no width sitting in the text for ever.
   */
  range: { from: number; to: number } | null;
}

export function threadsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(DOC_KEYS.comments);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Resolve an encoded relative position against this document.
 *
 * Null when the item it named is gone, which is exactly the detached case.
 */
function resolve(doc: Y.Doc, encoded: unknown): number | null {
  if (!(encoded instanceof Uint8Array)) return null;
  const relative = Y.decodeRelativePosition(encoded);
  const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
  return absolute ? absolute.index : null;
}

export function readThread(doc: Y.Doc, id: string, entry: Y.Map<unknown>): CommentThread {
  const messages: CommentMessage[] = [];
  const list = entry.get(THREAD_KEYS.messages);
  if (list instanceof Y.Array) {
    list.forEach((value) => {
      if (!(value instanceof Y.Map)) return;
      const text = value.get(MESSAGE_KEYS.text);
      messages.push({
        id: asString(value.get(MESSAGE_KEYS.id)),
        author: asString(value.get(MESSAGE_KEYS.author)),
        at: asNumber(value.get(MESSAGE_KEYS.at)),
        text: text instanceof Y.Text ? text.toString() : asString(text),
      });
    });
  }

  const from = resolve(doc, entry.get(THREAD_KEYS.from));
  const to = resolve(doc, entry.get(THREAD_KEYS.to));

  const fromBytes = entry.get(THREAD_KEYS.from);
  const toBytes = entry.get(THREAD_KEYS.to);

  return {
    id,
    from: fromBytes instanceof Uint8Array ? fromBytes : new Uint8Array(),
    to: toBytes instanceof Uint8Array ? toBytes : new Uint8Array(),
    quote: asString(entry.get(THREAD_KEYS.quote)),
    resolved: entry.get(THREAD_KEYS.resolved) === true,
    ...(typeof entry.get(THREAD_KEYS.resolvedBy) === 'string'
      ? { resolvedBy: entry.get(THREAD_KEYS.resolvedBy) as string }
      : {}),
    ...(typeof entry.get(THREAD_KEYS.resolvedAt) === 'number'
      ? { resolvedAt: entry.get(THREAD_KEYS.resolvedAt) as number }
      : {}),
    createdAt: asNumber(entry.get(THREAD_KEYS.createdAt)),
    messages,
    // Both ends have to resolve, and to different places.
    //
    // One surviving end would put a highlight over whatever now happens to sit
    // beside it, and a collapsed range means the text between them has been
    // deleted — see the note on `range`.
    range:
      from !== null && to !== null && from !== to
        ? { from: Math.min(from, to), to: Math.max(from, to) }
        : null,
  };
}

/** Every thread, oldest first. */
export function readThreads(doc: Y.Doc): CommentThread[] {
  const threads: CommentThread[] = [];
  threadsMap(doc).forEach((entry, id) => {
    if (!(entry instanceof Y.Map)) return;
    threads.push(readThread(doc, id, entry));
  });
  return threads.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt,
  );
}

export interface NewThread {
  id: string;
  /** Encoded relative positions, from the editor. */
  from: Uint8Array;
  to: Uint8Array;
  quote: string;
  messageId: string;
  author: string;
  text: string;
  at?: number;
}

/**
 * Start a thread, with its first message.
 *
 * One transaction, because a thread with no messages is not a thread — it would
 * arrive on another screen as a highlight over nothing.
 */
export function addThread(doc: Y.Doc, input: NewThread): void {
  const map = threadsMap(doc);
  if (map.size >= MAX_THREADS) return;

  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set(THREAD_KEYS.from, input.from);
    entry.set(THREAD_KEYS.to, input.to);
    entry.set(THREAD_KEYS.quote, input.quote.slice(0, MAX_QUOTE));
    entry.set(THREAD_KEYS.createdAt, input.at ?? Date.now());

    const messages = new Y.Array<Y.Map<unknown>>();
    messages.push([message(input.messageId, input.author, input.text, input.at)]);
    entry.set(THREAD_KEYS.messages, messages);

    map.set(input.id, entry);
  });
}

function message(id: string, author: string, text: string, at?: number): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set(MESSAGE_KEYS.id, id);
  entry.set(MESSAGE_KEYS.author, author);
  entry.set(MESSAGE_KEYS.at, at ?? Date.now());
  // Y.Text rather than a string: two people editing one message is rare, and
  // "rare" is not "never" — and it costs nothing to have it merge instead of
  // one of them losing a sentence.
  const text_ = new Y.Text();
  text_.insert(0, text.slice(0, MAX_MESSAGE));
  entry.set(MESSAGE_KEYS.text, text_);
  return entry;
}

/** Reply. The way anybody is addressed, guest or member (ADR-0046). */
export function addMessage(
  doc: Y.Doc,
  threadId: string,
  input: { id: string; author: string; text: string; at?: number },
): void {
  const entry = threadsMap(doc).get(threadId);
  if (!(entry instanceof Y.Map)) return;
  const list = entry.get(THREAD_KEYS.messages);
  if (!(list instanceof Y.Array)) return;

  doc.transact(() => {
    list.push([message(input.id, input.author, input.text, input.at)]);
    // Replying to a resolved thread reopens it: somebody had more to say, and a
    // reply nobody sees because the thread is closed is a reply lost.
    if (entry.get(THREAD_KEYS.resolved) === true) {
      entry.delete(THREAD_KEYS.resolved);
      entry.delete(THREAD_KEYS.resolvedBy);
      entry.delete(THREAD_KEYS.resolvedAt);
    }
  });
}

/**
 * Resolve a thread, or open it again.
 *
 * Anybody who may comment may resolve. Restricting it to the thread's author
 * sounds tidier and is wrong in practice: the person who fixes the paragraph is
 * usually not the person who complained about it.
 */
export function resolveThread(
  doc: Y.Doc,
  threadId: string,
  resolved: boolean,
  by: string,
  at?: number,
): void {
  const entry = threadsMap(doc).get(threadId);
  if (!(entry instanceof Y.Map)) return;
  doc.transact(() => {
    if (!resolved) {
      entry.delete(THREAD_KEYS.resolved);
      entry.delete(THREAD_KEYS.resolvedBy);
      entry.delete(THREAD_KEYS.resolvedAt);
      return;
    }
    entry.set(THREAD_KEYS.resolved, true);
    entry.set(THREAD_KEYS.resolvedBy, by);
    entry.set(THREAD_KEYS.resolvedAt, at ?? Date.now());
  });
}

/** Remove a thread entirely. Deleting a discussion is not resolving one. */
export function removeThread(doc: Y.Doc, threadId: string): void {
  doc.transact(() => threadsMap(doc).delete(threadId));
}

/**
 * Remove one message.
 *
 * A thread left with no messages is removed with it: an anchor with nothing
 * attached is a highlight nobody can explain.
 */
export function removeMessage(doc: Y.Doc, threadId: string, messageId: string): void {
  const map = threadsMap(doc);
  const entry = map.get(threadId);
  if (!(entry instanceof Y.Map)) return;
  const list = entry.get(THREAD_KEYS.messages);
  if (!(list instanceof Y.Array)) return;

  doc.transact(() => {
    for (let at = 0; at < list.length; at += 1) {
      const value = list.get(at);
      if (value instanceof Y.Map && value.get(MESSAGE_KEYS.id) === messageId) {
        list.delete(at, 1);
        break;
      }
    }
    if (list.length === 0) map.delete(threadId);
  });
}

/** The text of every thread, for the search index (ADR-0046). */
export function commentText(doc: Y.Doc): string {
  return readThreads(doc)
    .flatMap((thread) => thread.messages.map((one) => one.text))
    .filter((text) => text !== '')
    .join('\n');
}
