/**
 * SONE web — an attached file in the text.
 *
 * Three ways to draw the same block, chosen per file rather than globally:
 *
 *   card — a tile with the name, type and size. For anything nothing here can
 *          render, and for a document somebody refers to rather than reads.
 *   line — one row, the least it can be. For an attachment mentioned in
 *          passing, where a card would be louder than the sentence around it.
 *   full — a viewer with its own scrollbar. Only for what a browser can
 *          actually draw: a PDF or text.
 *
 * ## What is not offered
 *
 * A Word or Excel file has no viewer here, and the menu says so rather than
 * offering one that would show an error. Rendering them needs a converter —
 * LibreOffice in a container, or a third-party service — which is a deployment
 * decision for a self-hosted tool, not a checkbox. Until that is decided, a
 * card that names the file and opens it is the honest answer.
 */

import { NodeSelection } from 'prosemirror-state';

import { mountPdfViewer, type PdfViewerHandle } from './pdfViewer.ts';

/**
 * The words this view needs in the reader's language (ADR-0041).
 *
 * Handed in, because a node view is not a React component and this package has
 * no translator outside a hook. The rest of this file's words — "PDF", "Image",
 * "Word document" — are still English, which is a real gap rather than one to
 * pretend away.
 */
export interface FileViewLabels {
  pdf: {
    pageOf: (page: number, total: number) => string;
    loading: string;
    failed: string;
    openOriginal: string;
    document: string;
    previous: string;
    next: string;
    /** The button over a selection in the document (ADR-0151). */
    comment: string;
    /** What a mark on a commented place says it is. */
    commented: string;
    /** The highlighter, beside it (ADR-0152). */
    mark: string;
    /** And what it says when the selection is already on one. */
    unmark: string;
    /** What a plain mark says it is, having nothing else to say. */
    marked: string;
  };
}

/**
 * What the reader may do in a document (ADR-0152).
 *
 * Not a label. Marking is offered to somebody with an account and not to a
 * share-link visitor, because taking a mark off again would have to be offered
 * too and a link can only tell two visitors apart by the name they typed
 * (ADR-0046) — a mark that can be made and never un-made is worse than one that
 * is not offered.
 */
export interface FileViewAbilities {
  mayMark: boolean;
}

import { applyBlockAttrs } from './blockAttrs.ts';
import type { EditorView, NodeView } from 'prosemirror-view';

/** The little of a ProseMirror node this needs; see CollectionNodeView. */
interface PMNodeLike {
  type: { name: string };
  attrs: Record<string, unknown>;
}

/** Human-readable, and deliberately coarse: nobody needs the byte count. */
function formatSize(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** What to call the kind of thing this is, in a word. */
function describe(category: unknown, mime: unknown): string {
  switch (category) {
    case 'pdf':
      return 'PDF';
    case 'text':
      return 'Text';
    case 'image':
      return 'Image';
    case 'archive':
      return 'Archive';
    default: {
      const type = String(mime ?? '');
      if (type.includes('wordprocessingml') || type.includes('opendocument.text')) {
        return 'Word document';
      }
      if (type.includes('spreadsheetml') || type.includes('opendocument.spreadsheet')) {
        return 'Spreadsheet';
      }
      if (type.includes('presentationml')) return 'Presentation';
      return 'Document';
    }
  }
}

/** Can a browser draw this in place? Mirrors the server's own answer. */
const viewable = (category: unknown): boolean =>
  category === 'pdf' || category === 'text' || category === 'image';

class FileNodeView implements NodeView {
  readonly dom: HTMLElement;
  private attrs: Record<string, unknown>;
  /** The PDF viewer, when this block is showing one. */
  private pdf: PdfViewerHandle | null = null;

  constructor(
    node: PMNodeLike,
    private readonly labels: FileViewLabels,
    private readonly abilities: FileViewAbilities,
    private readonly select: () => void,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'file-block';
    this.dom.contentEditable = 'false';

    // A tap selects the block.
    //
    // Without this the gutter is unreachable on a touch device: it appears for
    // the selected block, there is no hover to fall back on, and `stopEvent`
    // below keeps every event from reaching ProseMirror — so tapping a file did
    // nothing at all and the ⋮⋮ handle never came.
    //
    // Not on a link or a control inside: those have their own job, and
    // selecting the block as well would fight them.
    this.dom.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('a, button, iframe')) return;
      this.select();
    });
    this.attrs = node.attrs;
    this.render();
  }

  private render(): void {
    // See blockAttrs.ts. A file block was drawing its own width for the viewer
    // form only; the shared attributes now reach it like every other block.
    applyBlockAttrs(this.dom, this.attrs);

    const { fileId, filename, mimeType, category, sizeBytes } = this.attrs;
    const display = String(this.attrs['display'] ?? 'card');
    this.dom.dataset['display'] = display;
    // Whatever was drawn before is going. The viewer has to be told, or its
    // worker and observer outlive the elements they were drawing into.
    this.pdf?.destroy();
    this.pdf = null;
    this.dom.textContent = '';

    if (typeof fileId !== 'string' || fileId === '') {
      // An upload in flight or one that failed. Drawn rather than left blank,
      // for the same reason an image is: a block that renders as nothing looks
      // like content somebody lost.
      this.dom.dataset['state'] = 'pending';
      this.dom.append(document.createTextNode(`Uploading ${String(filename || 'file')}…`));
      return;
    }
    delete this.dom.dataset['state'];

    const url = `/api/files/${fileId}`;
    const name = String(filename || 'File');
    const kind = describe(category, mimeType);
    const size = formatSize(sizeBytes);

    if (display === 'full' && category === 'pdf') {
      /*
       * Our own viewer (ADR-0048), not the browser's embed.
       *
       * The embed was a real viewer on Chromium and Firefox and a picture of
       * page one on iOS, so the same document was readable at a desk and not on
       * a phone. This draws every page itself, which makes the behaviour the
       * same everywhere — and puts the surrounding interface in our hands
       * rather than pdf.js's.
       */
      const host = document.createElement('div');
      this.dom.append(host, this.bar(name, kind, size, url));
      // `render()` has already torn down whatever was here, which is why there
      // is no destroy call in front of this one — the compiler pointed out that
      // the field is provably null by now.
      this.pdf = mountPdfViewer(host, url, this.labels.pdf, {
        fileId,
        mayMark: this.abilities.mayMark,
      });
      return;
    }

    if (display === 'full' && viewable(category)) {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.title = name;
      frame.className = 'file-viewer';
      // No sandbox on a PDF frame, and that is not an oversight.
      //
      // Chromium's built-in viewer is a browser component rather than page
      // script, and it does not run inside a sandboxed frame whatever tokens
      // are set: with `sandbox` only the first page rendered, and with
      // `sandbox allow-scripts` Brave refused to render anything. There is no
      // combination that works, so the safety has to come from the response
      // instead — and it does: the type is decided from the bytes, `nosniff`
      // stops the browser reconsidering, and the file's own policy lets it load
      // nothing. See the header comment in the server's file routes.
      //
      // Everything else is still sandboxed to nothing.
      // Everything here is sandboxed to nothing. The PDF case, which could not
      // be — Chromium's own viewer refuses to run inside a sandboxed frame — is
      // no longer drawn by the browser at all (ADR-0048), so the exception this
      // needed is gone with it.
      frame.setAttribute('sandbox', '');
      frame.setAttribute('loading', 'lazy');
      this.dom.append(frame, this.bar(name, kind, size, url));

      return;
    }

    if (display === 'line') {
      this.dom.append(this.bar(name, kind, size, url));
      return;
    }

    // A card, which is also where anything unrenderable ends up regardless of
    // what `display` says — a stored 'full' on a spreadsheet would otherwise
    // draw an empty frame for ever.
    const card = document.createElement('div');
    card.className = 'file-card';

    // The menu sits in the card's own first line, beside the name.
    //
    // Appended after the card before, which put it underneath — a loose button
    // below a tile, belonging to nothing visible. The line display had it in
    // the row all along; this is the same arrangement.
    const head = document.createElement('div');
    head.className = 'file-card-head';
    head.append(this.link(url, name, category));

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = size ? `${kind} · ${size}` : kind;

    card.append(head, meta);
    this.dom.append(card);
  }

  /** One row: the name, what it is, and a way to open it. */
  private bar(name: string, kind: string, size: string, url: string): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'file-line';

    const link = this.link(url, name, this.attrs['category']);

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = size ? `${kind} · ${size}` : kind;

    bar.append(link, meta);
    return bar;
  }

  /**
   * The file's name, as a link that does the useful thing.
   *
   * Opening for anything a browser can draw, downloading for anything it
   * cannot. It used to always download, which is nearly always wrong for a PDF
   * sitting in the page as a viewer: somebody clicking its name has it open
   * already and wants it bigger, not a copy in their downloads folder.
   *
   * Downloading is still one click away, in the controls beside it — it is a
   * choice now rather than the only outcome.
   *
   * A new tab rather than the same one: this is a page somebody is writing in,
   * and navigating away from it to look at an attachment is a way to lose your
   * place. `noopener` because a tab opened this way can otherwise reach back
   * into the page that opened it.
   */
  private link(url: string, name: string, category: unknown): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = name;
    link.className = 'file-name';

    if (viewable(category)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.setAttribute('download', name);
    }
    return link;
  }

  update(node: PMNodeLike): boolean {
    if (node.type.name !== 'file') return false;
    this.attrs = node.attrs;
    this.render();
    return true;
  }

  /**
   * ProseMirror is done with this block.
   *
   * The viewer holds a worker, an open document and an observer, and a node view
   * is destroyed and recreated as somebody edits around it — so without this,
   * scrolling past a PDF while typing would leave a worker per recreation.
   */
  destroy(): void {
    this.pdf?.destroy();
    this.pdf = null;
  }

  /** Everything inside is this view's, not ProseMirror's. */
  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/**
 * Build the file node view.
 *
 * It draws and nothing else now. Changing how a file is shown lives in the
 * gutter menu with every other block's settings — the `···` button here was a
 * second place to ask the same kind of question, and the gutter is where
 * somebody already looks.
 */
export function fileNodeView(
  /**
   * The one sentence this view needs in the reader's language.
   *
   * Handed in rather than looked up, because a node view is not a React
   * component and this package has no translator outside a hook — the same
   * arrangement `localiseSlashItem` uses for the `/` menu (ADR-0041). The rest
   * of this file's words are still English, which is a gap worth naming here
   * rather than pretending the file is translated.
   */
  labels: FileViewLabels,
  /** And what they may do with it — see `FileViewAbilities`. */
  abilities: FileViewAbilities,
): NonNullable<EditorView['props']['nodeViews']>[string] {
  return (node, view, getPos) =>
    new FileNodeView(node as unknown as PMNodeLike, labels, abilities, () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    });
}
