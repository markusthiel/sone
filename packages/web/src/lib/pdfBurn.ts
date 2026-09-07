/**
 * SONE web — the marks, written into the file (ADR-0154).
 *
 * The last of the rounds `claude/pdf-markierungen-und-kommentare.md` planned,
 * and the one the other three were for. A place in a PDF has been a comment
 * since ADR-0151 and a highlight since ADR-0152, but both live in SONE's own
 * document — so a copy of the file sent to somebody outside carries none of it.
 *
 * This produces that copy **on demand**: the stored marks become real PDF
 * annotations, written by pdf.js's own writer into an incremental update.
 *
 * ## Why on demand and not at rest
 *
 * The decision was taken before any of this was built: *„die echte PDF-Datei mit
 * eingebrannten Markierungen entsteht auf Abruf beim Herunterladen"*. Storing a
 * second, annotated copy of every file would mean two files that can disagree,
 * a rewrite on every comment, and a stored object whose bytes no longer match
 * the hash the store names it by — which is the property the whole anchor rests
 * on (ADR-0151).
 *
 * ## Why the engine writes it
 *
 * The same rule ADR-0150 set for the text layer, applied to the other end. A
 * `/Highlight` is a dictionary, an appearance stream, a quad-point array in the
 * page's own space and an incremental update with a correct cross-reference
 * table — and writing one by hand is a PDF writer, in a file whose job is to
 * turn four numbers into four other numbers.
 *
 * What we hand pdf.js is the same shape its own highlight editor produces, which
 * is why the entries below look the way they do: `quadPoints` for the writer,
 * `outlines` for the appearance stream, and a `popup` when there is something to
 * say. Verified against `pdfjs-dist` 6.3.289 by producing a file and reading the
 * annotations back out of the bytes; the numbers are in ADR-0154.
 */

import type { PlaceRect } from '@sone/core';

/**
 * The little of a pdf.js document this needs.
 *
 * Structural rather than the engine's own type, for `PageShape`'s reason in the
 * viewer: what is being relied on should be legible, and it is two methods.
 */
export interface Burnable {
  annotationStorage: {
    setValue: (key: string, value: object) => void;
    remove: (key: string) => void;
  };
  saveDocument: () => Promise<Uint8Array>;
}

/**
 * What pdf.js calls a highlight.
 *
 * Copied rather than imported, for ADR-0048's reason: importing the engine here
 * to read one integer would put half a megabyte in front of everybody who never
 * opens a PDF, and this module is loaded with the application.
 *
 * **Copied *and* compared**, which is the arrangement ADR-0150 arrived at for
 * the vendored stylesheet: a test reads `AnnotationEditorType.HIGHLIGHT` out of
 * `pdfjs-dist` and asserts this is it, so an upgrade that renumbers goes red at
 * that moment rather than at the moment somebody's marks come out of the file
 * as ink scribbles.
 */
const HIGHLIGHT = 9;

/** The prefix pdf.js's writer looks for. Its own constant, not ours to choose. */
const KEY = 'pdfjs_internal_editor_';

/** A place to write into the file, with whatever there is to say about it. */
export interface BurnableMark {
  /** Counting from one, as a reader counts pages. */
  page: number;
  rects: PlaceRect[];
  /**
   * The conversation, when the mark is a comment thread.
   *
   * Absent for a plain mark, which has nothing to say — and an annotation with
   * an empty `/Contents` is a note that opens onto nothing.
   */
  contents?: string;
  /** Who began it, when that is known. */
  author?: string;
}

/**
 * Two weights of one colour, as on the screen (ADR-0152).
 *
 * The screen draws the accent at 16% for a discussed passage and 8% for a
 * marked one. A PDF viewer multiplies `CA` over the page instead of mixing, so
 * the numbers are not the same numbers — but the *ratio* is, which is what the
 * distinction is made of.
 */
const OPACITY = { comment: 0.4, plain: 0.2 } as const;

/**
 * Write the marks into the file and hand back the bytes.
 *
 * **The keys are deterministic and the old ones are removed first.** Saving
 * twice in one sitting is ordinary — somebody downloads, comments again,
 * downloads again — and pdf.js's storage is a map that outlives a save, so
 * appending a new key per mark per save would put every mark in the file as
 * many times as the button was pressed.
 */
export async function burnMarks(
  doc: Burnable,
  marks: readonly BurnableMark[],
  options: {
    /** The accent as the reader is seeing it, in 0–255 channels. */
    color: [number, number, number];
    /** Keys written by a previous save in this sitting, to be taken off first. */
    previous?: readonly string[];
  },
): Promise<{ bytes: Uint8Array; keys: string[] }> {
  for (const key of options.previous ?? []) doc.annotationStorage.remove(key);

  const keys: string[] = [];
  let at = 0;
  for (const mark of marks) {
    for (const [x, y, wide, tall] of mark.rects) {
      const key = `${KEY}sone-${at}`;
      at += 1;
      keys.push(key);

      const right = x + wide;
      const top = y + tall;
      doc.annotationStorage.setValue(key, {
        annotationType: HIGHLIGHT,
        color: options.color,
        opacity: mark.contents ? OPACITY.comment : OPACITY.plain,
        /*
         * Four corners, and the order is the specification's rather than a
         * reading order: upper-left, upper-right, lower-left, lower-right.
         * Written wrong, a viewer draws a bow tie.
         */
        quadPoints: [x, top, right, top, x, y, right, y],
        /*
         * The same rectangle again, as a closed path.
         *
         * `quadPoints` is what the annotation *is*; `outlines` is what its
         * appearance stream draws, and pdf.js writes no stream without one — an
         * annotation with no appearance is one that every viewer renders to its
         * own taste, which for a highlight means some of them render nothing.
         */
        outlines: [[x, y, right, y, right, top, x, top]],
        // Zero-based here, which is the one place in this feature it is.
        pageIndex: mark.page - 1,
        rect: [x, y, right, top],
        rotation: 0,
        ...(mark.author ? { user: mark.author } : {}),
        ...(mark.contents
          ? {
              popup: {
                contents: mark.contents,
                /*
                 * Beside the mark rather than over it, and closed.
                 *
                 * A note that opens itself covers the words it is about the
                 * moment the file is opened — which is the opposite of what a
                 * comment on a passage is for.
                 */
                rect: [right, y, right + 200, top + 100],
              },
            }
          : {}),
      });
    }
  }

  return { bytes: await doc.saveDocument(), keys };
}

/**
 * A thread's messages as the one string an annotation can hold.
 *
 * A PDF note is text and nothing else — there is no thread, no author per line
 * and no structure to lay a conversation out in. So the conversation is written
 * the way somebody would read it aloud, and the quotation is left out: it is the
 * text under the mark, and repeating it inside the note would say everything
 * twice.
 */
export function conversationText(
  messages: readonly { author: string; text: string }[],
  nameOf: (author: string) => string,
): string {
  return messages
    .map((message) => {
      const who = nameOf(message.author).trim();
      return who === '' ? message.text : `${who}: ${message.text}`;
    })
    .join('\n\n');
}
