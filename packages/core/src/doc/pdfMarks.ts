/**
 * SONE core — a mark on a document, with nothing said about it (ADR-0152).
 *
 * ADR-0151 made a place in a PDF something a comment can be *about*. This is the
 * other thing a reader does to a document: marking a passage without writing
 * anything — the highlighter rather than the margin note.
 *
 * ## Why this is not a thread with no messages
 *
 * It was the obvious first answer, and ADR-0046 had already ruled it out from
 * the other side: *"a thread with no messages is not a thread — it would arrive
 * on another screen as a highlight over nothing"*. A highlight over nothing is
 * precisely what this is meant to be, so the two want opposite things from one
 * shape. Every place that reads threads would then have to ask "and does this
 * one have anything in it", which is the same rule in five files again.
 *
 * So: its own map, beside the comments in the same document. A mark carries a
 * place, the words it sits on, who put it there and when — and nothing else.
 *
 * ## Why the quotation is here
 *
 * A thread explains itself in its messages. A mark has no messages, so without
 * the words it sits on it is a rectangle on page seven of a file, and the only
 * way to learn what it is about is to open the file and look. The quotation is
 * the whole of what a mark can say.
 */

import * as Y from 'yjs';

import { isPlace, type PdfPlace, MAX_QUOTE } from './comments.js';
import { DOC_KEYS } from './docSchema.js';

export const PDF_MARK_KEYS = {
  /** Where, in the page's own points — the shape ADR-0151 defined. */
  place: 'place',
  /** The words it sits on. See the note above; this is not a cache either. */
  quote: 'quote',
  /** A user id, or a `guest:` key (ADR-0022). */
  author: 'author',
  createdAt: 'createdAt',
} as const;

/**
 * How many marks one page may hold.
 *
 * The same bound and the same reason as `MAX_THREADS`: a document that grows
 * without anybody deciding to is a document that eventually will not open. The
 * route turns the refusal into an answer rather than a silent success.
 */
export const MAX_PDF_MARKS = 500;

export interface PdfMark {
  id: string;
  place: PdfPlace;
  quote: string;
  author: string;
  createdAt: number;
}

export function pdfMarksMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(DOC_KEYS.pdfMarks);
}

export interface NewPdfMark {
  id: string;
  place: PdfPlace;
  quote: string;
  author: string;
  at?: number;
}

/**
 * Put a mark on a place.
 *
 * Refused rather than mended when the place is not one, exactly as `addThread`
 * refuses a place it cannot draw (ADR-0151): a rectangle of three numbers
 * written through is a question every reader has to answer instead of this one
 * line.
 */
export function addPdfMark(doc: Y.Doc, input: NewPdfMark): void {
  if (!isPlace(input.place)) return;
  const map = pdfMarksMap(doc);
  if (map.size >= MAX_PDF_MARKS) return;

  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set(PDF_MARK_KEYS.place, input.place);
    entry.set(PDF_MARK_KEYS.quote, input.quote.slice(0, MAX_QUOTE));
    entry.set(PDF_MARK_KEYS.author, input.author);
    entry.set(PDF_MARK_KEYS.createdAt, input.at ?? Date.now());
    map.set(input.id, entry);
  });
}

/**
 * Take one off.
 *
 * A fact rather than a throw when it is not there: somebody pressing the button
 * twice, or two people un-marking the same passage at once, is ordinary — and
 * the route reports what the document says happened.
 */
export function removePdfMark(doc: Y.Doc, id: string): void {
  doc.transact(() => pdfMarksMap(doc).delete(id));
}

/**
 * Every mark, oldest first.
 *
 * A shape that is not a place reads as no mark at all, rather than as a mark
 * nothing can draw. The document is a CRDT — anything that ever reached it stays
 * readable — so one bad entry written by an older build must not take the page's
 * other marks with it.
 */
export function readPdfMarks(doc: Y.Doc): PdfMark[] {
  const marks: PdfMark[] = [];
  for (const [id, entry] of pdfMarksMap(doc).entries()) {
    if (!(entry instanceof Y.Map)) continue;

    const stored = entry.get(PDF_MARK_KEYS.place);
    const place = stored instanceof Y.Map ? stored.toJSON() : stored;
    if (!isPlace(place)) continue;

    const at = entry.get(PDF_MARK_KEYS.createdAt);
    marks.push({
      id,
      place,
      quote: typeof entry.get(PDF_MARK_KEYS.quote) === 'string'
        ? (entry.get(PDF_MARK_KEYS.quote) as string)
        : '',
      author: typeof entry.get(PDF_MARK_KEYS.author) === 'string'
        ? (entry.get(PDF_MARK_KEYS.author) as string)
        : '',
      createdAt: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    });
  }
  return marks.sort((one, other) => one.createdAt - other.createdAt);
}

/** Who made a mark here — for "somebody marked this", not for a permission. */
export function pdfMarkAuthor(doc: Y.Doc, id: string): string | null {
  const entry = pdfMarksMap(doc).get(id);
  if (!(entry instanceof Y.Map)) return null;
  const author = entry.get(PDF_MARK_KEYS.author);
  return typeof author === 'string' && author !== '' ? author : null;
}
