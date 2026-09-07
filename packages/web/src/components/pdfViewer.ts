/**
 * SONE web — reading a PDF in a page (ADR-0048).
 *
 * The engine is pdf.js; everything around it is ours. Pages are drawn to
 * canvases we place in a scrolling column, with our own bar over it — not the
 * prebuilt pdf.js viewer, which brings its own toolbar and its own idea of what
 * a document should look like into a page that has had a lot of thought spent on
 * exactly that.
 *
 * Imperative rather than a React component, because a file block is a
 * ProseMirror node view — the same arrangement the collection and video views
 * use.
 *
 * The engine is imported dynamically and nothing else in this file is: half a
 * megabyte must not land on somebody who never opens a PDF. A test asserts the
 * import stays dynamic, because a static one would be an invisible regression.
 */

import { isPlace, type CommentThread, type PdfMark, type PdfPlace, type PlaceRect } from '@sone/core';

import { resolvedColor } from '../lib/computedColor.ts';
import { burnMarks, conversationText, type Burnable, type BurnableMark } from '../lib/pdfBurn.ts';
import { linesOf, touches } from '../lib/pdfPlace.ts';
import { subscribeToPdfMarks, subscribeToThreads } from '../lib/threadAnnouncement.ts';

const MAX_SCALE = 2;
/** How near the viewport a page has to be before it is worth drawing. */
const NEAR = '600px';

interface ViewerLabels {
  /** "Page 3 of 12" — the numbers are filled in by the caller's translation. */
  pageOf: (page: number, total: number) => string;
  loading: string;
  failed: string;
  openOriginal: string;
  document: string;
  previous: string;
  next: string;
  /** The button over a selection (ADR-0151). */
  comment: string;
  /** What a drawn mark says it is. */
  commented: string;
  /** The highlighter beside it, and the same button taking one off (ADR-0152). */
  mark: string;
  unmark: string;
  /** What a plain mark says it is, having nothing else to say. */
  marked: string;
  /** The copy with the marks written into it (ADR-0154). */
  download: string;
  /** And what that copy is called, beside the original's name. */
  markedSuffix: string;
}

/**
 * The little of a pdf.js viewport this file needs (ADR-0151).
 *
 * Structural rather than the engine's own type, and named here so that what is
 * being relied on is legible: two conversions and the size of the page at scale
 * one. Both conversions are the engine's — they invert the transform the page
 * was drawn with, rotation included, and the hand-written version of that is
 * `height - y`, which is silently wrong on every landscape scan.
 */
/** What this viewer is showing, and what may be done to it. */
export interface ViewerSubject {
  /**
   * The file, by its id (ADR-0151).
   *
   * Handed in rather than read back out of the URL. The viewer is given
   * `/api/files/<id>`; taking the id out of that string again would be a second
   * place that knows how the route is built, and it would be wrong on the day
   * the route changes without anything failing to compile.
   */
  fileId: string;
  /**
   * Whether the highlighter is offered at all (ADR-0152).
   *
   * A share-link visitor may comment on a place and may not mark one. Not
   * because a highlighter is more dangerous than a sentence — it says strictly
   * less — but because taking a mark off again would have to be offered too,
   * and a link can only tell two visitors apart by the name they typed
   * (ADR-0046). The pair is offered together or not at all.
   */
  mayMark: boolean;
  /** What the file is called, for the copy somebody downloads (ADR-0154). */
  filename: string;
  /**
   * Who an author id belongs to, for the notes in that copy.
   *
   * A function rather than a list, and read at the moment of a save: the viewer
   * is built once and the workspace's people arrive over HTTP afterwards. A
   * name nobody knows comes back empty, and the note leaves it off rather than
   * writing "Unknown" — that would be a fact about our records, not about the
   * document.
   */
  nameOf: (author: string) => string;
}

interface PageShape {
  width: number;
  height: number;
  convertToPdfPoint: (x: number, y: number) => number[];
  convertToViewportPoint: (x: number, y: number) => number[];
}

export interface PdfViewerHandle {
  destroy: () => void;
}

/**
 * Draw a PDF into a container.
 *
 * Returns a handle rather than nothing, because a node view is destroyed and
 * recreated as somebody edits around it — a viewer that kept a document open and
 * an observer running after that would leak both.
 */
export function mountPdfViewer(
  container: HTMLElement,
  url: string,
  labels: ViewerLabels,
  what: ViewerSubject,
): PdfViewerHandle {
  const { fileId, mayMark, filename, nameOf } = what;
  container.className = 'pdf-viewer';
  container.textContent = '';

  const status = document.createElement('p');
  status.className = 'pdf-status';
  status.textContent = labels.loading;
  container.append(status);

  const pages = document.createElement('div');
  pages.className = 'pdf-pages';
  /*
   * Focusable, and that is not a nicety.
   *
   * A `div` with `overflow-y: auto` is not in the tab order, so a keyboard could
   * not scroll this at all — the document was readable with a mouse and a finger
   * and by nothing else. `tabindex="0"` puts it in the order and the browser's
   * own arrow-key scrolling then works, which is why no key handler is needed
   * here.
   */
  pages.tabIndex = 0;
  pages.setAttribute('role', 'region');
  pages.setAttribute('aria-label', labels.document);

  const bar = document.createElement('div');
  bar.className = 'pdf-bar';

  /*
   * Paging controls, which ADR-0048 said were "a second way to move, not the
   * only way" — and which I then did not build. The record described an
   * interface that did not exist until this.
   *
   * A second way matters more than it sounds: scrolling a hundred pages to
   * reach page ninety is not a thing anybody does, and on a phone the column
   * scrolls inside a page that also scrolls.
   */
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'pdf-step';
  back.setAttribute('aria-label', labels.previous);
  back.textContent = '\u2191';

  const forward = document.createElement('button');
  forward.type = 'button';
  forward.className = 'pdf-step';
  forward.setAttribute('aria-label', labels.next);
  forward.textContent = '\u2193';

  const indicator = document.createElement('span');
  indicator.className = 'pdf-indicator';
  // Polite, so a screen reader says "page 4 of 12" when somebody pages rather
  // than interrupting whatever it was reading.
  indicator.setAttribute('aria-live', 'polite');
  /**
   * A copy of the file with the marks in it (ADR-0154).
   *
   * In the bar rather than in the block's own row of controls, and beside the
   * page count: this is a thing about *this document as it is being read*, and
   * the row below the viewer is about the file as an attachment.
   *
   * Hidden until there is something to write. A button that produces an
   * identical copy of the file is a button that has nothing to do, and offering
   * it is a small promise broken every time somebody presses it.
   */
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'pdf-step pdf-download';
  download.setAttribute('aria-label', labels.download);
  download.title = labels.download;
  download.textContent = '\u2913';
  download.hidden = true;

  bar.append(indicator, download, back, forward);

  let cancelled = false;
  let observer: IntersectionObserver | null = null;
  const cleanups: Array<() => void> = [];

  /*
   * ---- Places (ADR-0151) ----------------------------------------------------
   *
   * A comment can be about a place in this document: a page and rectangles in
   * that page's own points. Two directions, and both go through the engine's
   * viewport rather than through arithmetic here — see `PageShape`.
   */

  /** The scale-1 viewport of each page that has been drawn, for both directions. */
  const shapes = new Map<number, PageShape>();

  /**
   * Something drawn on a page, and why (ADR-0152).
   *
   * Two reasons now: a passage somebody is discussing, and a passage somebody
   * marked and said nothing about. They are drawn in **two weights of one
   * colour** rather than in two colours — a second hue would be a second
   * convention to learn for a distinction that is one of degree.
   */
  interface Drawn {
    rects: PlaceRect[];
    kind: 'comment' | 'plain';
    title: string;
    /** The thread, when there is one — what a reveal names and a click will. */
    id?: string;
  }

  /**
   * The commented places, per comment document and then per page.
   *
   * **Per document, and that is not over-thinking it.** A page with a protected
   * section has two comment documents (ADR-0093) and each announces only its
   * own threads, so one map would be overwritten by whichever spoke last — the
   * internal marks vanishing every time somebody replied in public, and the
   * other way round.
   */
  const byDoc = new Map<string, CommentThread[]>();
  const everyThread = (): CommentThread[] => [...byDoc.values()].flat();

  /**
   * And the plain marks, per document, kept whole rather than by page.
   *
   * Whole because they are asked two questions: what to draw on page seven, and
   * which of them a selection is sitting on — and the second needs the id, which
   * a list of rectangles has thrown away.
   */
  const marksByDoc = new Map<string, PdfMark[]>();
  const everyMark = (): PdfMark[] => [...marksByDoc.values()].flat();

  const placesOn = (number: number): Drawn[] => {
    const all: Drawn[] = [];
    for (const thread of everyThread()) {
      if (thread.place?.page !== number) continue;
      all.push({
        rects: thread.place.rects,
        kind: 'comment',
        title: labels.commented,
        id: thread.id,
      });
    }
    for (const mark of everyMark()) {
      if (mark.place.page !== number) continue;
      all.push({ rects: mark.place.rects, kind: 'plain', title: labels.marked });
    }
    return all;
  };

  /*
   * ---- Being taken to a passage (ADR-0156) -----------------------------------
   *
   * Declared here, above the drawing and the subscriptions that read them,
   * because a subscription replays synchronously into a half-built body and
   * that cost an editor once (ADR-0154).
   */

  /** Which page to scroll to, once there is a document to scroll. */
  let showPage: ((page: number) => void) | null = null;
  /** The thread the panel asked for, while it is being shown. */
  let wanted: string | null = null;
  /** How long a mark stays found. Long enough to look at, short enough to end. */
  const FOUND_MS = 1600;
  let stopBeingFound: ReturnType<typeof setTimeout> | null = null;

  /**
   * Draw the marks for one page.
   *
   * **In percentages of the page box, not in pixels.** The text layer has to be
   * re-scaled on every resize because the engine positions its spans in pixels
   * (ADR-0150); a mark does not, because a fraction of the page is the same
   * fraction at every width. So the marks follow a sidebar opening, a window
   * drag and a scrollbar appearing with no observer and no work at all.
   *
   * Under the text layer in the stacking order, so that the transparent spans
   * above still take the pointer — a mark that swallowed the selection would
   * mean a passage could be commented on exactly once.
   */
  const drawMarks = (slot: HTMLElement, number: number): void => {
    slot.querySelector('.pdf-marks')?.remove();
    const shape = shapes.get(number);
    const places = placesOn(number);
    if (!shape || places.length === 0) return;

    const marks = document.createElement('div');
    marks.className = 'pdf-marks';
    for (const drawn of places) {
      for (const [x, y, wide, tall] of drawn.rects) {
        // A PDF counts up from the foot of the page and a screen counts down
        // from the top, so the rectangle's corners swap: the *lower* left in
        // the document is the *upper* left on the screen.
        const [ax, ay] = shape.convertToViewportPoint(x, y + tall);
        const [bx, by] = shape.convertToViewportPoint(x + wide, y);
        const mark = document.createElement('div');
        mark.className = 'pdf-mark';
        mark.dataset['kind'] = drawn.kind;
        if (drawn.id !== undefined) mark.dataset['thread'] = drawn.id;
        // The one the panel asked for (ADR-0156). Set while drawing rather than
        // found and decorated afterwards: the page being revealed is usually
        // not drawn yet at the moment of the ask.
        if (drawn.id !== undefined && drawn.id === wanted) mark.dataset['found'] = 'true';
        mark.title = drawn.title;
        mark.style.left = `${(Math.min(ax!, bx!) / shape.width) * 100}%`;
        mark.style.top = `${(Math.min(ay!, by!) / shape.height) * 100}%`;
        mark.style.width = `${(Math.abs(bx! - ax!) / shape.width) * 100}%`;
        mark.style.height = `${(Math.abs(by! - ay!) / shape.height) * 100}%`;
        marks.append(mark);
      }
    }
    const text = slot.querySelector('.textLayer');
    if (text) slot.insertBefore(marks, text);
    else slot.append(marks);
  };

  /*
   * ---- A copy with the marks in it (ADR-0154) --------------------------------
   *
   * **Above the subscriptions, and that is not a tidiness.** They replay their
   * last announcement synchronously, before they return (ADR-0151), so their
   * listener runs in the middle of this function's own body — and everything it
   * touches has to exist by the time it does. Declared below them, the question
   * `redrawEverything` asks was a `const` in its dead zone, which is a throw and
   * not an `undefined`: the whole editor came down, because this runs while
   * ProseMirror is building a node view.
   */

  /** The open document, once there is one. Nothing can be written before that. */
  let burnable: Burnable | null = null;
  /** The keys a previous save wrote, so a second one replaces rather than adds. */
  let written: string[] = [];

  /** Everything this file carries, in the shape the writer takes. */
  const whatToWrite = (): BurnableMark[] => [
    ...everyThread().map((thread) => ({
      page: thread.place!.page,
      rects: thread.place!.rects,
      contents: conversationText(thread.messages, nameOf),
      ...(thread.messages[0] ? { author: nameOf(thread.messages[0].author) } : {}),
    })),
    ...everyMark().map((mark) => ({ page: mark.place.page, rects: mark.place.rects })),
  ];

  /** Offered only when there is something to write; see the button above. */
  const offerTheCopy = (): void => {
    download.hidden = burnable === null || whatToWrite().length === 0;
  };


  const redrawEverything = (): void => {
    for (const slot of pages.querySelectorAll<HTMLElement>('.pdf-page')) {
      drawMarks(slot, Number(slot.dataset['page'] ?? '0'));
    }
    // The same news changes both: a page with nothing marked has nothing to
    // offer a copy of (ADR-0154).
    offerTheCopy();
  };

  const stopThreads = subscribeToThreads(({ doc, threads }) => {
    byDoc.set(
      doc,
      // This file's, and still open. A resolved thread keeps its place in the
      // panel and loses its mark, which is the rule the text already follows.
      threads.filter(
        (thread) => !thread.resolved && thread.place !== null && thread.place.file === fileId,
      ),
    );
    redrawEverything();
  });
  cleanups.push(() => stopThreads());

  /**
   * The panel asked for a passage (ADR-0156).
   *
   * Two scrolls, and they are two because this viewer is a column *inside* a
   * page that also scrolls: `showPage` moves the right page to the top of the
   * column, and the column itself may be entirely below the fold.
   *
   * `scrollIntoView` here and deliberately not in `goTo`. ADR-0048 refused it
   * for paging, because it moves every ancestor and paging a PDF should not
   * move the page around it — but moving every ancestor is exactly what
   * somebody who pressed "show me this" has asked for.
   */
  const takeMeThere = (event: Event): void => {
    const detail = (event as CustomEvent<{ file?: unknown; page?: unknown; thread?: unknown }>)
      .detail;
    if (!detail || detail.file !== fileId) return;
    if (typeof detail.page !== 'number' || !Number.isFinite(detail.page)) return;

    wanted = typeof detail.thread === 'string' ? detail.thread : null;
    container.scrollIntoView({ block: 'center', behavior: 'smooth' });
    showPage?.(detail.page);
    // For the pages already drawn; the one being revealed is usually not among
    // them yet, and `drawMarks` reads `wanted` when its turn comes.
    redrawEverything();

    if (stopBeingFound) clearTimeout(stopBeingFound);
    stopBeingFound = setTimeout(() => {
      // A mark that stayed lit would make the *next* reveal look like nothing
      // happened.
      wanted = null;
      redrawEverything();
    }, FOUND_MS);
  };
  window.addEventListener('sone:reveal-place', takeMeThere);
  cleanups.push(() => {
    window.removeEventListener('sone:reveal-place', takeMeThere);
    if (stopBeingFound) clearTimeout(stopBeingFound);
  });

  const stopMarks = subscribeToPdfMarks(({ doc, marks }) => {
    marksByDoc.set(
      doc,
      marks.filter((mark) => mark.place.file === fileId),
    );
    redrawEverything();
  });
  cleanups.push(() => stopMarks());

  /*
   * What is offered over a selection, and what it would send.
   *
   * Computed when the buttons appear rather than when one is pressed: pressing
   * one is a `mousedown` on a button, which in some browsers collapses the
   * selection before the click is delivered — so by then there would be nothing
   * left to read.
   */
  const tools = document.createElement('div');
  tools.className = 'pdf-selection-tools';
  // The press must not take the selection with it: `mousedown` on a button
  // collapses it in every browser, and the click that follows would then be
  // asked to act on nothing.
  tools.addEventListener('mousedown', (event) => event.preventDefault());

  /**
   * The highlighter, and the same button as the way to take one off (ADR-0152).
   *
   * One control rather than two, because the marks are `pointer-events: none`
   * so that the text above them stays selectable — there is nothing to click on
   * a mark, and adding a click target would mean a passage could be marked
   * exactly once. So un-marking is asked the way marking is: select the passage
   * again. The button says which of the two it would do.
   */
  const paint = document.createElement('button');
  paint.type = 'button';
  paint.className = 'pdf-selection-tool';

  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'pdf-selection-tool';
  ask.textContent = labels.comment;

  // Marking first: it is the lighter of the two acts, and the one a reader
  // reaches for more often.
  if (mayMark) tools.append(paint);
  tools.append(ask);

  let pending: { place: PdfPlace; quote: string; touching: string[] } | null = null;

  const forget = (): void => {
    tools.remove();
    pending = null;
  };

  /**
   * Read the selection, and offer to comment on it.
   *
   * A place is a place **on one page**. A selection dragged past the foot of a
   * page carries on into the next one, and the honest answer to that is the
   * part on the page it began on — mark and quotation both, rather than a
   * quotation from page four drawn on page three.
   */
  const offer = (): void => {
    forget();
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const from = range.startContainer;
    const element = from instanceof Element ? from : from.parentElement;
    const slot = element?.closest('.pdf-page') as HTMLElement | null;
    if (!slot || !pages.contains(slot)) return;

    const number = Number(slot.dataset['page'] ?? '0');
    const shape = shapes.get(number);
    const scale = Number(slot.style.getPropertyValue('--scale-factor'));
    if (!shape || !(scale > 0)) return;

    const onPage = range.cloneRange();
    if (!slot.contains(range.endContainer)) {
      const layer = slot.querySelector('.textLayer');
      if (!layer) return;
      onPage.setEnd(layer, layer.childNodes.length);
    }

    const quote = onPage.toString().trim();
    if (quote === '') return;

    const box = slot.getBoundingClientRect();
    const lines = linesOf(
      [...onPage.getClientRects()].map((rect) => ({
        left: rect.left - box.left,
        top: rect.top - box.top,
        right: rect.right - box.left,
        bottom: rect.bottom - box.top,
      })),
    );
    if (lines.length === 0) return;

    const rects: PlaceRect[] = lines.map((line) => {
      const [x1, y1] = shape.convertToPdfPoint(line.left / scale, line.top / scale);
      const [x2, y2] = shape.convertToPdfPoint(line.right / scale, line.bottom / scale);
      return [
        Math.min(x1!, x2!),
        Math.min(y1!, y2!),
        Math.abs(x2! - x1!),
        Math.abs(y2! - y1!),
      ];
    });

    const place = { file: fileId, page: number, rects };
    // The core's rule, asked here rather than restated: if this is not a place
    // the button must not offer to make one, because the route would refuse it
    // and the refusal would arrive as a comment that silently did not happen.
    if (!isPlace(place)) return;

    /*
     * Which marks this selection is sitting on (ADR-0152).
     *
     * **All of them, not the nearest one.** Nobody re-selects the same run of
     * glyphs twice, so the gesture is "roughly that bit" — and if it lands
     * across two marks, taking off one and leaving the other would be a result
     * nobody could predict from the drag they made.
     */
    const touching = everyMark()
      .filter((mark) => touches(mark.place, place))
      .map((mark) => mark.id);
    pending = { place, quote, touching };

    paint.textContent = touching.length > 0 ? labels.unmark : labels.mark;
    paint.dataset['act'] = touching.length > 0 ? 'unmark' : 'mark';

    const last = lines[lines.length - 1]!;
    tools.style.left = `${(last.right / box.width) * 100}%`;
    tools.style.top = `${(last.bottom / box.height) * 100}%`;
    slot.append(tools);
  };

  ask.addEventListener('click', () => {
    if (!pending) return;
    /*
     * A window event, for the reason `sone:reveal-comment` is one (ADR-0151).
     *
     * This is a node view mounted by ProseMirror from a map of constructors;
     * handing it a callback would mean threading one through `createEditor`,
     * the node views map, the file block and a viewer handle. The editor
     * surface listens, checks the shape, and hands it to the page as an anchor
     * like any other.
     */
    window.dispatchEvent(
      new CustomEvent('sone:pdf-comment', {
        detail: { place: pending.place, quote: pending.quote },
      }),
    );
    forget();
    document.getSelection()?.removeAllRanges();
  });

  paint.addEventListener('click', () => {
    if (!pending) return;
    // Two events rather than one with a flag, so a listener reads as two
    // sentences: put a mark here, take these marks off.
    window.dispatchEvent(
      pending.touching.length > 0
        ? new CustomEvent('sone:pdf-unmark', { detail: { marks: pending.touching } })
        : new CustomEvent('sone:pdf-mark', {
            detail: { place: pending.place, quote: pending.quote },
          }),
    );
    forget();
    document.getSelection()?.removeAllRanges();
  });

  /*
   * ---- A copy with the marks in it (ADR-0154) --------------------------------
   */

  download.addEventListener('click', () => {
    if (!burnable) return;
    void (async () => {
      download.disabled = true;
      try {
        /*
         * The accent as the reader is seeing it.
         *
         * Not a fixed colour: somebody who has been looking at green marks all
         * afternoon should not open the copy and find yellow ones. Not the
         * stored theme either — a treated surface redefines the same name
         * (ADR-0122), so the only honest answer is what the browser resolved
         * *inside this viewer*.
         */
        const accent = resolvedColor(container, '--accent') ?? { r: 47, g: 125, b: 111 };
        const { bytes, keys } = await burnMarks(burnable!, whatToWrite(), {
          color: [accent.r, accent.g, accent.b],
          previous: written,
        });
        written = keys;

        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        // Named beside the original rather than over it: two files in a
        // downloads folder with one name is a pair nobody can tell apart.
        link.download = filename.replace(/(\.pdf)?$/i, ` ${labels.markedSuffix}.pdf`);
        link.click();
        // Freed on the next turn: revoking it in the same one has cancelled the
        // download in more than one browser.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) {
        // Said out loud, for ADR-0150's reason: a button that does nothing and
        // explains nothing is an afternoon somebody else loses.
        console.warn(
          'SONE: this PDF could not be copied with its marks',
          error instanceof Error ? error.message : error,
        );
      } finally {
        download.disabled = false;
      }
    })();
  });

  /*
   * Shown when a selection is finished, hidden the moment it changes.
   *
   * `selectionchange` alone would put the button under the pointer on every
   * frame of a drag; `pointerup` alone would leave it behind when the selection
   * is cleared by a click elsewhere or by the keyboard. Each does the half it
   * is good at.
   */
  const settled = (): void => {
    window.setTimeout(offer, 0);
  };
  document.addEventListener('selectionchange', forget);
  pages.addEventListener('pointerup', settled);
  pages.addEventListener('keyup', settled);
  cleanups.push(() => {
    document.removeEventListener('selectionchange', forget);
    pages.removeEventListener('pointerup', settled);
    pages.removeEventListener('keyup', settled);
  });

  void (async () => {
    try {
      /*
       * Dynamic, and this is the whole reason the dependency is acceptable
       * (ADR-0048). The worker's URL comes from the build so it is served from
       * our own origin: a CDN here would be a third party learning who reads
       * which document.
       */
      const [pdfjs, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((module) => module.default),
        /*
         * The engine's own stylesheet for its own layer (ADR-0150), on the same
         * terms as the engine: loaded here so that nothing lands on somebody
         * who never opens a PDF.
         */
        import('../pdfTextLayer.css'),
      ]);
      if (cancelled) return;

      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      /*
       * The loading task is what has to be kept, not the document.
       *
       * `destroy()` is on the task — it aborts the request and takes the worker
       * down with it. Calling it on the document proxy does not exist, which the
       * compiler said before a leak could.
       */
      const task = pdfjs.getDocument({ url, withCredentials: true });
      cleanups.push(() => void task.destroy());

      const doc = await task.promise;
      if (cancelled) return;
      burnable = doc as unknown as Burnable;
      offerTheCopy();

      status.remove();
      container.append(bar, pages);

      /** Which page is being looked at, for the indicator. */
      let current = 1;
      const say = (): void => {
        indicator.textContent = labels.pageOf(current, doc.numPages);
        back.disabled = current <= 1;
        forward.disabled = current >= doc.numPages;
      };
      say();

      /** Scroll a page's slot to the top of the column. */
      const goTo = (number: number): void => {
        const target = pages.querySelector<HTMLElement>(`[data-page="${number}"]`);
        if (!target) return;
        // `scrollTop` rather than `scrollIntoView`: the latter scrolls every
        // ancestor, so paging a PDF would move the page around it as well.
        pages.scrollTop = target.offsetTop - pages.offsetTop;
      };
      // Reachable from outside now: the panel asks for a page long before this
      // closure would otherwise be visible to anything (ADR-0156).
      showPage = goTo;
      back.addEventListener('click', () => goTo(Math.max(1, current - 1)));
      forward.addEventListener('click', () => goTo(Math.min(doc.numPages, current + 1)));

      /*
       * One render at a time.
       *
       * Ten pages rendering at once make the first one slower, and the first one
       * is the only one anybody is waiting for.
       */
      let queue: Promise<void> = Promise.resolve();

      const draw = (slot: HTMLElement, number: number): void => {
        if (slot.dataset['drawn'] === 'true') return;
        slot.dataset['drawn'] = 'true';

        queue = queue.then(async () => {
          if (cancelled || slot.dataset['drawn'] !== 'true') return;
          try {
            const page = await doc.getPage(number);
            const unscaled = page.getViewport({ scale: 1 });
            /*
             * The slot's width, not the column's (ADR-0150).
             *
             * They differ by a scrollbar, and that is not a detail: the canvas
             * is `width: 100%` of the slot, so the column's width made the
             * canvas 688px wide and the text layer 700px — the invisible text
             * running twelve pixels past the drawn glyphs by the right margin.
             * Measured; the arithmetic is in the record.
             */
            const width = slot.clientWidth || pages.clientWidth || container.clientWidth || 800;
            /*
             * Bounded on purpose. A canvas at a phone's full pixel ratio times a
             * fitting scale is tens of megabytes for one page, and a document is
             * read a page at a time either way.
             */
            const fit = width / unscaled.width;
            const ratio = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
            const viewport = page.getViewport({ scale: fit * ratio });

            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.width = '100%';
            canvas.style.aspectRatio = `${unscaled.width} / ${unscaled.height}`;
            const context = canvas.getContext('2d');
            if (!context) return;

            await page.render({ canvas, canvasContext: context, viewport }).promise;
            if (cancelled || slot.dataset['drawn'] !== 'true') return;
            slot.textContent = '';
            slot.append(canvas);

            /*
             * And the words, over the picture of them (ADR-0150).
             *
             * A second viewport, at the scale the *reader* sees: the canvas is
             * rasterised at `fit * devicePixelRatio` and displayed at 100% of
             * the column, so its buffer is two or three times its box. This
             * layer is DOM, and its numbers are CSS pixels — handed the
             * rasterising viewport, every span would sit two or three times too
             * far along.
             *
             * The scale goes on the slot as a custom property because that is
             * the engine's contract: everything it positions is written against
             * `--total-scale-factor`, which is what lets a resize be a variable
             * change instead of a re-render.
             */
            const cssViewport = page.getViewport({ scale: fit });
            slot.style.setProperty('--scale-factor', String(fit));

            /*
             * And the page's own shape, kept for the places (ADR-0151).
             *
             * At scale one, so it is the page as the PDF describes it and not
             * as this column happens to be showing it — a mark is stored in
             * points, and the column's width is a fact about a window.
             */
            shapes.set(number, page.getViewport({ scale: 1 }) as PageShape);
            drawMarks(slot, number);

            const text = document.createElement('div');
            text.className = 'textLayer';
            slot.append(text);
            await new pdfjs.TextLayer({
              textContentSource: await page.getTextContent(),
              container: text,
              viewport: cssViewport,
            }).render();
          } catch (error) {
            /*
             * One page that will not draw is one blank page, not a failed
             * document: a PDF with a damaged object should still show the pages
             * either side of it.
             *
             * **Said out loud, though** (ADR-0150). It was swallowed whole, and
             * a blank page with no trace anywhere is a page nobody can explain —
             * it cost an afternoon here, where the cause turned out to be a
             * browser older than the engine's own requirements. The reader still
             * sees a gap and not an error; whoever is asked about the gap gets
             * a line to go on.
             */
            console.warn(`SONE: page ${number} of this PDF could not be drawn`, error);
            slot.dataset['drawn'] = 'failed';
          }
        });
      };

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const slot = entry.target as HTMLElement;
            const number = Number(slot.dataset['page'] ?? '1');
            if (entry.isIntersecting) {
              draw(slot, number);
              current = number;
              say();
            } else if (Math.abs(number - current) > 4) {
              /*
               * Released when it is well out of the way.
               *
               * Otherwise a hundred-page document read to the end holds a
               * hundred canvases, which is hundreds of megabytes. The slot keeps
               * its height, so releasing a page does not move the scroll
               * position under somebody's thumb.
               */
              slot.textContent = '';
              delete slot.dataset['drawn'];
            }
          }
        },
        { root: null, rootMargin: NEAR },
      );

      /*
       * The slot's width is the zoom (ADR-0150).
       *
       * A canvas is `width: 100%` and follows a resize for nothing; the text
       * layer is positioned in pixels derived from `--scale-factor`, so without
       * this the words stay where they were drawn while the picture under them
       * grows — a sidebar opening is enough. Re-setting one custom property per
       * drawn slot is cheaper than redrawing, which is exactly what the engine
       * designed the property for.
       *
       * **The slots are watched, not the column.** A scrollbar appearing
       * changes the column's *content* box and leaves its border box alone, so
       * an observer on the column sleeps through the one resize that is certain
       * to happen: the moment the document turns out to be longer than the
       * window.
       */
      const resize = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const slot = entry.target as HTMLElement;
          if (slot.dataset['drawn'] !== 'true') continue;
          const pageWidth = Number(slot.dataset['pageWidth'] ?? '0');
          const width = slot.clientWidth;
          if (pageWidth > 0 && width > 0) {
            slot.style.setProperty('--scale-factor', String(width / pageWidth));
          }
        }
      });
      cleanups.push(() => resize.disconnect());

      // A slot per page, sized before it is drawn: a column that grows as pages
      // arrive is a column that jumps while somebody reads it.
      const first = await doc.getPage(1);
      const shape = first.getViewport({ scale: 1 });
      for (let number = 1; number <= doc.numPages; number += 1) {
        const slot = document.createElement('div');
        slot.className = 'pdf-page';
        slot.dataset['page'] = String(number);
        // What the scale is measured against on a resize, kept beside the slot
        // rather than recomputed from a page the engine would have to fetch.
        slot.dataset['pageWidth'] = String(shape.width);
        slot.style.aspectRatio = `${shape.width} / ${shape.height}`;
        pages.append(slot);
        observer.observe(slot);
        resize.observe(slot);
      }
    } catch {
      if (cancelled) return;
      status.textContent = labels.failed;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = labels.openOriginal;
      link.className = 'pdf-fallback';
      // A file we cannot draw is still a file somebody can open. Refusing to
      // show anything would be worse than the embed this replaced.
      container.append(link);
    }
  })();

  return {
    destroy: () => {
      cancelled = true;
      observer?.disconnect();
      for (const cleanup of cleanups) cleanup();
      container.textContent = '';
    },
  };
}
