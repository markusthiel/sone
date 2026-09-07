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
  /**
   * What this thread is attached to, when it is not a range of text.
   *
   * Absent for a comment on prose, which is the overwhelming majority and which
   * had this shape before anything else existed — so absence means "text", and
   * nothing had to be rewritten to add this.
   *
   * A canvas item's id (ADR-0043). ADR-0046 deferred this saying the anchor
   * there "is an item id, which is a far simpler thing", and it was right: an
   * item id needs no relative position, no mapping through ProseMirror, and no
   * quotation to survive a rewrite — the item either exists or it does not.
   */
  item: 'item',
  /**
   * A place in a PDF, when the thread is about one (ADR-0151).
   *
   * The third anchor, and the simplest of the three: a file id, a page number
   * and rectangles in the page's own points. Nothing about it can move —
   * storage is content-addressed, so the bytes a file id names never change —
   * which is why it needs neither a relative position nor a resolution step.
   *
   * Absent for everything else, like `item`: absence is what every thread
   * written before this key existed says.
   */
  place: 'place',
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
  /**
   * Who was addressed in this message (ADR-0052).
   *
   * Ids beside the text, not names in it. A name alone breaks the moment
   * somebody is renamed, and matches the wrong person when two people share
   * one. Resolved when the message is written, because a mention is an act and
   * who was meant is decided at that moment.
   *
   * A plain array on the message rather than its own structure: a mention is
   * decided once and never edited, so there is nothing for two people to merge.
   */
  mentions: 'mentions',
  /**
   * How this message arrived, when it was not typed here (ADR-0060).
   *
   * `email` for a reply that came back through a notification. Absent for
   * everything written in SONE, which is the overwhelming majority — a key
   * that is usually missing costs nothing, and a key that is usually `app`
   * would be noise in every message ever written.
   *
   * Marked because quote trimming is guesswork: a reader should be able to tell
   * that a machine cut a reply rather than that a colleague wrote something
   * strange. `trimmed` says whether anything was actually dropped, so a reply
   * that needed no trimming does not claim it was cut.
   */
  via: 'via',
  trimmed: 'trimmed',
  /** Whether the mail carried attachments, which are not kept (ADR-0060). */
  attachments: 'attachments',
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
  /** Who was addressed, by id or guest key (ADR-0052). */
  mentions: string[];
  /** How it arrived, when not typed here (ADR-0060). */
  via?: 'email';
  trimmed?: boolean;
  hadAttachments?: boolean;
}

/**
 * A rectangle on a page, in the page's own points (ADR-0151).
 *
 * `[x, y, width, height]`, origin at the bottom left, which is the PDF's own
 * coordinate system and the only one that survives being read on another
 * screen. Screen pixels would be a mark that is right on the machine that made
 * it and wrong on the next one, at a different width or a different zoom.
 */
export type PlaceRect = [number, number, number, number];

export interface PdfPlace {
  /**
   * The file, by its id — never by the hash of its contents.
   *
   * Storage is content-addressed, so the same bytes uploaded into two
   * workspaces are one file; a mark keyed by that hash would be a comment
   * leaking across a boundary the rest of the system defends.
   */
  file: string;
  /** Counting from one, as a reader counts them. */
  page: number;
  /** One rectangle per line of a selection, so a wrapped phrase is one mark. */
  rects: PlaceRect[];
}

/** Enough rectangles for a selection across a paragraph, and not a page of them. */
export const MAX_PLACE_RECTS = 32;
/** A bound on a coordinate: the largest PDF page is 200 inches, or 14400 points. */
const MAX_POINT = 20_000;

/**
 * Whether a value is a place, checked rather than described (ADR-0092).
 *
 * The rule that file arrived at for anchors, applied to the shape that follows
 * it: a page number of zero, a rectangle of three numbers, a width of nothing —
 * each is a mark that nothing can draw, and the moment to say so is before it
 * is in somebody's document rather than when a reader opens the page.
 *
 * One home, for the route that accepts one and the interface that makes one.
 */
export function isPlace(value: unknown): value is PdfPlace {
  if (!value || typeof value !== 'object') return false;
  const place = value as Record<string, unknown>;

  if (typeof place['file'] !== 'string' || place['file'] === '') return false;
  if (place['file'].length > 200) return false;

  const page = place['page'];
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 100_000) {
    return false;
  }

  const rects = place['rects'];
  if (!Array.isArray(rects) || rects.length === 0 || rects.length > MAX_PLACE_RECTS) {
    return false;
  }
  return rects.every((rect) => {
    if (!Array.isArray(rect) || rect.length !== 4) return false;
    const [x, y, width, height] = rect as unknown[];
    const numbers = [x, y, width, height];
    if (!numbers.every((one) => typeof one === 'number' && Number.isFinite(one))) return false;
    const [left, bottom, wide, tall] = numbers as number[];
    if (wide! <= 0 || tall! <= 0) return false;
    return [left!, bottom!, left! + wide!, bottom! + tall!].every(
      (one) => one >= -MAX_POINT && one <= MAX_POINT,
    );
  });
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
  /** A canvas item, when the thread is about one rather than about text. */
  item: string | null;
  /** A place in a PDF, when it is about one (ADR-0151). */
  place: PdfPlace | null;
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
  /*
   * Nothing to resolve.
   *
   * A thread about a canvas item carries no position, so its anchor bytes are
   * empty — and `decodeRelativePosition` on empty bytes throws "Unexpected end
   * of array", which took down the whole read rather than producing a null. A
   * test that added a canvas thread found it immediately, which is the argument
   * for writing the test before the interface that would have hit this.
   */
  if (encoded.length === 0) return null;
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
      const mentions = value.get(MESSAGE_KEYS.mentions);
      const text = value.get(MESSAGE_KEYS.text);
      messages.push({
        id: asString(value.get(MESSAGE_KEYS.id)),
        author: asString(value.get(MESSAGE_KEYS.author)),
        at: asNumber(value.get(MESSAGE_KEYS.at)),
        text: text instanceof Y.Text ? text.toString() : asString(text),
        mentions: Array.isArray(mentions)
          ? mentions.filter((one): one is string => typeof one === 'string')
          : [],
        /*
         * How it arrived, when it did not come from here (ADR-0060).
         *
         * Read defensively and left undefined for everything else, so the
         * panel's mark appears only where the document actually says so — I
         * wrote these keys and forgot to read them, and the test that asserted
         * the mark is what found it.
         */
        ...(value.get(MESSAGE_KEYS.via) === 'email' ? { via: 'email' as const } : {}),
        ...(value.get(MESSAGE_KEYS.trimmed) === true ? { trimmed: true } : {}),
        ...(value.get(MESSAGE_KEYS.attachments) === true ? { hadAttachments: true } : {}),
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
    item: (() => {
      const item = entry.get(THREAD_KEYS.item);
      return typeof item === 'string' && item !== '' ? item : null;
    })(),
    /*
     * Checked on the way out as well as on the way in (ADR-0151).
     *
     * The document is a CRDT: anything that ever reached it stays readable, and
     * a place written by an older build, or by a client that got it wrong, is
     * not a reason for the whole page's comments to fail to read. A shape that
     * is not a place reads as no place, which draws nothing.
     */
    place: (() => {
      const place = entry.get(THREAD_KEYS.place);
      const plain = place instanceof Y.Map ? place.toJSON() : place;
      return isPlace(plain) ? plain : null;
    })(),
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

/**
 * Whether the thing a thread was about is gone (ADR-0151).
 *
 * **One home, because it had four.** The panel asked it three times and the
 * hook once, each as `item === null && range === null` — and each would have
 * called a thread about page three of a PDF *detached*, because a place has no
 * item and resolves against no text.
 *
 * Detached means what it has always meant: a thread about a range of text whose
 * text is gone. A place does not detach — the file it names is content
 * addressed, so its bytes cannot change under the mark. Whether that file is
 * still shown on this page is a different sentence, and it belongs to whoever
 * draws the page rather than to the thread.
 */
export function isDetached(thread: CommentThread): boolean {
  return thread.item === null && thread.place === null && thread.range === null;
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
  /** Who was addressed in the first message (ADR-0052). */
  mentions?: string[];
  /** A place in a PDF, for a thread about one (ADR-0151). */
  place?: PdfPlace;
  /** A canvas item, for a thread about one rather than about text. */
  item?: string;
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
    // Only when there is one: absence means "about text", which is what every
    // thread written before this key existed says by saying nothing.
    if (input.item) entry.set(THREAD_KEYS.item, input.item);
    // The same, for a place in a PDF (ADR-0151). Refused rather than mended: a
    // rectangle nothing can draw is not a mark, and storing it would put the
    // question in every reader instead of here.
    if (input.place && isPlace(input.place)) entry.set(THREAD_KEYS.place, input.place);
    entry.set(THREAD_KEYS.quote, input.quote.slice(0, MAX_QUOTE));
    entry.set(THREAD_KEYS.createdAt, input.at ?? Date.now());

    const messages = new Y.Array<Y.Map<unknown>>();
    messages.push([
      message(input.messageId, input.author, input.text, input.at, input.mentions),
    ]);
    entry.set(THREAD_KEYS.messages, messages);

    map.set(input.id, entry);
  });
}

/** How a message arrived, when it did not come from here (ADR-0060). */
export interface Arrival {
  via?: 'email';
  trimmed?: boolean;
  hadAttachments?: boolean;
}

function message(
  id: string,
  author: string,
  text: string,
  at?: number,
  mentions?: string[],
  // One object rather than three more positional parameters: a call with four
  // trailing booleans is a call nobody can read.
  arrival?: Arrival,
): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  entry.set(MESSAGE_KEYS.id, id);
  entry.set(MESSAGE_KEYS.author, author);
  entry.set(MESSAGE_KEYS.at, at ?? Date.now());
  /*
   * Only when there are any, and never the author.
   *
   * Somebody who writes "@me" has not asked to be told about it, and the check
   * belongs here rather than in the projection: the projection would have to
   * know which of several people wrote a message it is looking at, and it
   * already knows — but a message that carries a self-mention has recorded
   * something that was never true.
   */
  const addressed = (mentions ?? []).filter((who) => who !== author);
  if (addressed.length > 0) entry.set(MESSAGE_KEYS.mentions, [...new Set(addressed)]);
  // Only when it did not come from here, so an ordinary message carries nothing
  // extra (ADR-0060).
  if (arrival?.via) {
    entry.set(MESSAGE_KEYS.via, arrival.via);
    if (arrival.trimmed) entry.set(MESSAGE_KEYS.trimmed, true);
    if (arrival.hadAttachments) entry.set(MESSAGE_KEYS.attachments, true);
  }
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
  input: {
    id: string;
    author: string;
    text: string;
    at?: number;
    /** Who was addressed (ADR-0052). */
    mentions?: string[];
    /** How it arrived, when not typed here (ADR-0060). */
    via?: 'email';
    trimmed?: boolean;
    hadAttachments?: boolean;
  },
): void {
  const entry = threadsMap(doc).get(threadId);
  if (!(entry instanceof Y.Map)) return;
  const list = entry.get(THREAD_KEYS.messages);
  if (!(list instanceof Y.Array)) return;

  doc.transact(() => {
    list.push([
      message(input.id, input.author, input.text, input.at, input.mentions, {
        ...(input.via ? { via: input.via } : {}),
        ...(input.trimmed ? { trimmed: input.trimmed } : {}),
        ...(input.hadAttachments ? { hadAttachments: input.hadAttachments } : {}),
      }),
    ]);
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

/**
 * The people a message addresses, and the people in a thread (ADR-0052).
 *
 * Two questions the projection asks and nothing else should have to answer
 * twice: who was mentioned in this message, and who is *in* this conversation —
 * which means having written in it, a definition somebody can predict.
 */
export function addressedBy(message: CommentMessage): string[] {
  return message.mentions;
}

export function participants(thread: CommentThread): string[] {
  return [...new Set(thread.messages.map((message) => message.author))];
}

/**
 * Where a page's internal comments live (ADR-0057).
 *
 * A second document, whose id is *derived* from the page's rather than stored:
 * nothing to keep in step, and no row that can go missing while its updates
 * remain. Deterministic, so every process computes the same id without
 * coordination — which is what lets a sync room open one on demand.
 *
 * UUIDv5 over a fixed namespace, by hand: the algorithm is a SHA-1 of the
 * namespace bytes followed by the name, with the version and variant bits set.
 * Written out rather than taking a dependency for twenty lines.
 */
export const INTERNAL_NAMESPACE = '6f9f6b1e-4a4a-5f6c-8f2e-1d3c5b7a9e01';

export function internalDocId(pageId: string, sha1: (data: Uint8Array) => Uint8Array): string {
  const bytes = new Uint8Array(16 + pageId.length);
  const hex = INTERNAL_NAMESPACE.replace(/-/g, '');
  for (let at = 0; at < 16; at += 1) {
    bytes[at] = Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16);
  }
  for (let at = 0; at < pageId.length; at += 1) bytes[16 + at] = pageId.charCodeAt(at);

  const digest = sha1(bytes);
  const out = digest.slice(0, 16);
  // Version 5, and the RFC 4122 variant. Without these two lines the result is
  // a hash rather than a uuid, and Postgres refuses it as a uuid column value.
  out[6] = ((out[6] ?? 0) & 0x0f) | 0x50;
  out[8] = ((out[8] ?? 0) & 0x3f) | 0x80;

  const text = [...out].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/**
 * How a client asks for the internal document of a page (ADR-0057).
 *
 * A suffix on the page id in the existing open message, rather than a new field
 * in it. The open message is `[Open, requestId, pageId]` on the wire; adding a
 * boolean would change that shape and cost a protocol version — which was just
 * released unchanged, and which every client and server would then have to agree
 * about for the sake of one bit.
 *
 * An older server sees an id it cannot find and refuses, which is the correct
 * answer from a server that does not have this feature.
 */
export const INTERNAL_SUFFIX = '#internal';

export const asInternalRequest = (pageId: string): string => `${pageId}${INTERNAL_SUFFIX}`;

export function readInternalRequest(asked: string): { pageId: string; internal: boolean } {
  return asked.endsWith(INTERNAL_SUFFIX)
    ? { pageId: asked.slice(0, -INTERNAL_SUFFIX.length), internal: true }
    : { pageId: asked, internal: false };
}
