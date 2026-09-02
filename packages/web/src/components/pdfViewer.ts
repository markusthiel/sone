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
): PdfViewerHandle {
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
  bar.append(indicator, back, forward);

  let cancelled = false;
  let observer: IntersectionObserver | null = null;
  const cleanups: Array<() => void> = [];

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
            const width = pages.clientWidth || container.clientWidth || 800;
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
          } catch {
            // One page that will not draw is one blank page, not a failed
            // document: a PDF with a damaged object should still show the
            // pages either side of it.
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

      // A slot per page, sized before it is drawn: a column that grows as pages
      // arrive is a column that jumps while somebody reads it.
      const first = await doc.getPage(1);
      const shape = first.getViewport({ scale: 1 });
      for (let number = 1; number <= doc.numPages; number += 1) {
        const slot = document.createElement('div');
        slot.className = 'pdf-page';
        slot.dataset['page'] = String(number);
        slot.style.aspectRatio = `${shape.width} / ${shape.height}`;
        pages.append(slot);
        observer.observe(slot);
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
