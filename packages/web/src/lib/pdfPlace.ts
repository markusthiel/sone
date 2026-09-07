/**
 * SONE web — a selection in a PDF, made into lines (ADR-0151).
 *
 * The one part of putting a comment on a place in a document that is arithmetic
 * rather than layout, and therefore the one part a test can hold: turning what
 * `Range.getClientRects()` hands back into the rectangles a mark is drawn from.
 *
 * Everything else about a place — where the page's box is on the screen, what a
 * point of the page is in pixels — is measured or converted by the engine, and
 * neither belongs here.
 */

import { MAX_PLACE_RECTS, type PdfPlace } from '@sone/core';

/** The four edges, in whatever coordinates the caller is working in. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Do these two share more than half of the shorter one's height? */
function sameLine(one: Box, other: Box): boolean {
  const overlap = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);
  if (overlap <= 0) return false;
  const shorter = Math.min(one.bottom - one.top, other.bottom - other.top);
  return shorter > 0 && overlap > shorter / 2;
}

/**
 * One box per line of a selection.
 *
 * **Why not the rectangles as they come.** The text layer is one span per run of
 * glyphs, so a line of a PDF is routinely six or eight spans — a font change, a
 * kerning pair the producer set separately, a number. `getClientRects()` returns
 * a rectangle for each of them, and a sentence and a half across a paragraph
 * comes back as forty. Stored, that is forty rectangles to draw and a stored
 * anchor larger than the comment on it; drawn, it is a mark with a seam every
 * few characters where the boxes fail to meet.
 *
 * Joined by vertical overlap rather than by an equal top, because a superscript,
 * a smaller font in the same line and a subscript all sit at tops of their own —
 * grouping by the number would put each of them on a line by itself, which is
 * how a footnote marker gets a mark of its own floating above the sentence.
 *
 * Empty rectangles are dropped: a collapsed range at the end of a span produces
 * one, and a mark of no width is a mark nobody can see and every reader has to
 * decide what to do with.
 */
export function linesOf(rects: readonly Box[], limit: number = MAX_PLACE_RECTS): Box[] {
  const real = rects
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    .sort((one, other) => one.top - other.top || one.left - other.left);

  const lines: Box[] = [];
  for (const rect of real) {
    const line = lines.find((one) => sameLine(one, rect));
    if (!line) {
      lines.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      continue;
    }
    line.left = Math.min(line.left, rect.left);
    line.top = Math.min(line.top, rect.top);
    line.right = Math.max(line.right, rect.right);
    line.bottom = Math.max(line.bottom, rect.bottom);
  }

  /*
   * The first lines, when there are too many.
   *
   * A selection long enough to pass the bound is somebody marking most of a
   * page, and where it *begins* is what anybody scrolling to it is looking for.
   * The alternative — one box around the lot — draws over the margins and the
   * lines between, which claims a great deal the reader did not select.
   *
   * The quotation carries the whole of it either way: the mark says where, the
   * quotation says what.
   */
  return lines.slice(0, limit);
}

/**
 * Do these two places touch (ADR-0152)?
 *
 * What un-marking is asked with. A mark is taken off by selecting the passage
 * again and pressing the button — there is no click target, because the marks
 * are `pointer-events: none` so that the text above them stays selectable, and
 * turning that off would mean a passage could be marked exactly once.
 *
 * **Touching, not containing.** Nobody re-selects the same run of glyphs twice:
 * a drag over "roughly that sentence" starts a character early and ends a
 * character late, and a rule that asked for containment would answer "there is
 * nothing there" while the reader is looking straight at it. Overlap is what the
 * gesture means.
 *
 * Same file and same page first, and that is not a formality: two pages of a
 * document use the same coordinates, so on rectangles alone every mark on page
 * three would touch every mark on page four.
 */
export function touches(one: PdfPlace, other: PdfPlace): boolean {
  if (one.file !== other.file || one.page !== other.page) return false;
  return one.rects.some(([ax, ay, aw, ah]) =>
    other.rects.some(
      ([bx, by, bw, bh]) => ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah,
    ),
  );
}
