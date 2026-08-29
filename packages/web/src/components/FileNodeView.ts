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
  /** Set while a menu is open, so it can be closed from elsewhere. */
  private closeMenu: (() => void) | null = null;

  constructor(
    node: PMNodeLike,
    private readonly onSetDisplay: (display: string) => void,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'file-block';
    this.dom.contentEditable = 'false';
    this.attrs = node.attrs;
    this.render();
  }

  private render(): void {
    const { fileId, filename, mimeType, category, sizeBytes } = this.attrs;
    const display = String(this.attrs['display'] ?? 'card');
    this.dom.dataset['display'] = display;
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
      if (category !== 'pdf') frame.setAttribute('sandbox', '');
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

    const title = this.link(url, name, category);

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = size ? `${kind} · ${size}` : kind;

    card.append(title, meta);
    this.dom.append(card, this.controls(display, category));
  }

  /** One row: the name, what it is, and a way to open it. */
  private bar(name: string, kind: string, size: string, url: string): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'file-line';

    const link = this.link(url, name, this.attrs['category']);

    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = size ? `${kind} · ${size}` : kind;

    bar.append(link, meta, this.controls(String(this.attrs['display'] ?? 'card'), this.attrs['category']));
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

  /**
   * One menu, holding everything this block can do.
   *
   * A row of buttons for the display and a separate download link beside it was
   * two kinds of thing in one place: "what should this look like" and "what
   * should happen now". They read as one row and are not, and the row grew
   * every time something was added.
   *
   * So: what to do at the top, how to show it below, in a menu that is closed
   * until asked for.
   */
  private controls(current: string, category: unknown): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'file-menu';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'file-menu-trigger';
    trigger.textContent = '···';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'What to do with this file');

    const menu = document.createElement('div');
    menu.className = 'file-menu-items';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    // Closing when a click lands anywhere else.
    //
    // `focusout` alone was not enough and left the menu open for good: Safari
    // does not focus a button when it is clicked, so focus never entered the
    // menu and never left it. A document listener is what actually observes
    // "somebody is doing something else now".
    //
    // In the capture phase, so it runs before a handler inside the page can
    // stop the event and leave the menu behind.
    const onOutside = (event: Event): void => {
      if (!wrap.contains(event.target as Node | null)) close();
    };

    const close = (): void => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onOutside, true);
      this.closeMenu = null;
    };

    // click, not pointerdown — the rule everywhere here, and the cause of every
    // touch bug this project has had.
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      // Only one menu at a time, including the menu of another file block.
      if (this.closeMenu && this.closeMenu !== close) this.closeMenu();

      const open = menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');

      if (open) {
        document.addEventListener('click', onOutside, true);
        this.closeMenu = close;
      } else {
        close();
      }
    });

    // Closed when the attention moves elsewhere. Without this the menu of a
    // file scrolled off screen stays open behind the page.
    wrap.addEventListener('focusout', (event) => {
      if (!wrap.contains(event.relatedTarget as Node | null)) close();
    });

    const url = `/api/files/${String(this.attrs['fileId'] ?? '')}`;
    const name = String(this.attrs['filename'] ?? 'file');

    const heading = (text: string): void => {
      const label = document.createElement('p');
      label.className = 'file-menu-label';
      label.textContent = text;
      menu.append(label);
    };

    heading('Do');

    if (viewable(category)) {
      // Only offered for something a browser can draw. "Open" on a spreadsheet
      // opens a download, which is what the item below already says plainly.
      const open = document.createElement('a');
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.className = 'file-menu-item';
      open.setAttribute('role', 'menuitem');
      open.textContent = 'Open in a new tab';
      open.addEventListener('click', close);
      menu.append(open);
    }

    const download = document.createElement('a');
    download.href = url;
    download.className = 'file-menu-item';
    download.setAttribute('role', 'menuitem');
    download.setAttribute('download', name);
    download.textContent = 'Download';
    download.addEventListener('click', close);
    menu.append(download);

    heading('Show as');

    const options: Array<{ id: string; label: string }> = [
      { id: 'card', label: 'Card' },
      { id: 'line', label: 'One line' },
    ];
    // Offered only when it would work. A viewer on a spreadsheet is a promise
    // nothing here can keep.
    if (viewable(category)) options.push({ id: 'full', label: 'Viewer' });

    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-menu-item';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', option.id === current ? 'true' : 'false');
      button.textContent = option.label;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        close();
        this.onSetDisplay(option.id);
      });
      menu.append(button);
    }

    wrap.append(trigger, menu);
    return wrap;
  }

  update(node: PMNodeLike): boolean {
    if (node.type.name !== 'file') return false;
    this.attrs = node.attrs;
    // The old menu is about to be discarded by render(), and its document
    // listener would otherwise outlive the element it belongs to.
    this.closeMenu?.();
    this.render();
    return true;
  }

  /** ProseMirror discards this view; the listener must not survive it. */
  destroy(): void {
    this.closeMenu?.();
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
 * `setDisplay` is passed in rather than imported: the command needs the node's
 * position, which only the view knows, and reaching into the editor from here
 * would be a second way to dispatch.
 */
export function fileNodeView(
  setDisplay: (getPos: () => number | undefined, display: string) => void,
): NonNullable<EditorView['props']['nodeViews']>[string] {
  return (node, _view, getPos) =>
    new FileNodeView(node as unknown as PMNodeLike, (display) =>
      setDisplay(getPos as () => number | undefined, display),
    );
}
