/**
 * SONE web — a video in the text (ADR-0037).
 *
 * Three sources, drawn three ways:
 *
 *   file   — an upload, played by the browser's own player. Seeking works
 *            because file serving answers byte ranges; before that it could not.
 *   embed  — a provider on the allowlist. **The frame is not created until
 *            somebody presses play.** This is self-hosted software: opening a
 *            page should not be how YouTube learns you read it, and every reader
 *            of every page carrying such a block would otherwise have told them.
 *   stream — an HLS or DASH manifest, played in place. No ingest: publishing a
 *            stream is a service, not a block.
 *
 * And three shapes: a player, a card, or a line. A stream has only the player,
 * because a card for something that is interesting only while it is live is a
 * dead link tomorrow.
 *
 * The address that goes into a frame is derived here, from the allowlist, and is
 * not read from the document — so tightening the list reaches documents already
 * written.
 */

import { readStreamLink, readVideoLink } from '@sone/core';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';

/** The little of a ProseMirror node this needs; see CollectionNodeView. */
interface PMNodeLike {
  type: { name: string };
  attrs: Record<string, unknown>;
}

/** Whether this browser can play an HLS manifest without help. */
function playsHlsNatively(): boolean {
  const probe = document.createElement('video');
  return (
    probe.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    probe.canPlayType('application/x-mpegURL') !== ''
  );
}

function textOf(node: PMNodeLike, key: string): string {
  const value = node.attrs[key];
  return typeof value === 'string' ? value : '';
}

/** A provider's name, for a card that has nothing else to say. */
function providerName(provider: string): string {
  switch (provider) {
    case 'youtube':
      return 'YouTube';
    case 'vimeo':
      return 'Vimeo';
    case 'peertube':
      return 'PeerTube';
    default:
      return 'Video';
  }
}

class VideoNodeView implements NodeView {
  readonly dom: HTMLElement;

  constructor(
    private node: PMNodeLike,
    private readonly select: () => void,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'video-block';
    // Not editable, and this is the line that was missing.
    //
    // Every other node view here sets it — the file, the collection, the
    // protected section — and without it the contents of an atom sit inside the
    // editor's editable region. The browser then treats a `<video>` and its
    // controls as content it may edit: Chromium removes it on its own, that
    // removal is a document change, and ProseMirror faithfully applies it. The
    // block uploaded, played, and vanished — and no test that does not run a real
    // editing engine can see it, which is why jsdom kept saying it was fine.
    this.dom.contentEditable = 'false';

    // A click selects the block, and this is what was missing: the gutter
    // appears for the *selected* block, and `stopEvent` below keeps every event
    // from reaching ProseMirror — so clicking a video selected nothing and the
    // ⋮⋮ handle never came. Which is the handle the width and the card/link
    // forms live behind, so the whole of ADR-0037's "same handle every block
    // has" was unreachable.
    //
    // Not from inside the player. Its controls are a click target of their own,
    // and selecting the block as well would fight play, pause and the scrubber —
    // so a click on the video plays it and a click anywhere around it selects.
    this.dom.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('video, iframe, a, button')) return;
      this.select();
    });

    this.render();
  }

  update(node: PMNodeLike): boolean {
    if (node.type.name !== 'video') return false;
    // Redrawn only when something it draws changed. Otherwise a keystroke
    // elsewhere in the document would restart a video that is playing, and an
    // embed somebody has already consented to would be torn down.
    const same =
      ['source', 'fileId', 'url', 'title', 'display', 'width', 'align'].every(
        (key) => this.node.attrs[key] === node.attrs[key],
      );
    this.node = node;
    if (!same) this.render();
    return true;
  }

  /** ProseMirror must not manage what is inside this. */
  ignoreMutation(): boolean {
    return true;
  }

  /**
   * Everything inside is this view's, not ProseMirror's.
   *
   * All events rather than a list of them, as the file view does. The list was a
   * guess about which ones matter, and a player's controls raise more than
   * anybody's list contains — `dragstart` from the video element, key events on
   * the scrubber, a double-click for fullscreen.
   */
  stopEvent(): boolean {
    return true;
  }

  /**
   * Draw, and never throw while doing it.
   *
   * A node view that raises during a dispatch does not fail alone: the exception
   * leaves the editor mid-transaction, React's boundary replaces the whole
   * surface, and everything unmounted with it — including any dialog that was
   * open — comes back empty. From the outside that is "the window closed and the
   * block is gone", with nothing saying why.
   *
   * So a failure here becomes a visible block that says the drawing failed, and
   * the reason goes to the console where somebody can read it. The document is
   * untouched either way, which is the property that matters: whatever is wrong
   * with drawing a video, the video must still be in the page.
   */
  private render(): void {
    try {
      this.draw();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sone] drawing a video block failed', err);
      this.dom.replaceChildren();
      this.renderBroken(
        'This video could not be drawn. The block is still here; the reason is in the browser console.',
      );
    }
  }

  private draw(): void {
    const source = textOf(this.node, 'source');
    const display = textOf(this.node, 'display') || 'player';
    this.dom.dataset['source'] = source;
    this.dom.dataset['display'] = display;
    // The attributes `parseDOM` looks for, so that anything which does re-read
    // this DOM rebuilds the same node rather than nothing. Cheap, and the
    // difference between a bad day and a lost block.
    this.dom.dataset['soneVideo'] = source;
    const fileId = textOf(this.node, 'fileId');
    if (fileId !== '') this.dom.dataset['file'] = fileId;
    this.dom.dataset['url'] = textOf(this.node, 'url');
    this.dom.dataset['title'] = textOf(this.node, 'title');
    this.dom.replaceChildren();

    if (source === 'file') this.renderFile(display);
    else if (source === 'embed') this.renderEmbed(display);
    else if (source === 'stream') this.renderStream();
    else this.renderBroken('This block does not say what kind of video it is.');
  }

  // --- an upload -----------------------------------------------------------

  private renderFile(display: string): void {
    const fileId = textOf(this.node, 'fileId');
    if (fileId === '') {
      // An upload in flight, or one that failed. Said rather than drawn as
      // nothing: a blank looks like content that vanished.
      this.renderBroken('This video has not finished uploading.');
      return;
    }

    const href = `/api/files/${fileId}`;
    if (display === 'link' || display === 'card') {
      this.renderCard(display, this.title() || 'Video', 'Uploaded video', href);
      return;
    }

    const player = document.createElement('video');
    player.className = 'video-player';
    player.controls = true;
    // Metadata only: a page with six videos must not fetch six videos. The
    // browser reads enough for the duration and the first frame, which is what
    // makes the block look like something before it is played.
    player.preload = 'metadata';
    player.src = href;
    this.dom.append(player);
  }

  // --- a provider ----------------------------------------------------------

  private renderEmbed(display: string): void {
    const read = readVideoLink(textOf(this.node, 'url'));
    if (!read) {
      // Either it was never on the allowlist or it no longer is. The second is
      // why the frame's address is not stored: this is the intended outcome of
      // dropping a provider, and it has to read as a refusal rather than a bug.
      this.renderBroken('This link is not one this instance embeds.', textOf(this.node, 'url'));
      return;
    }

    const name = this.title() || providerName(read.provider);
    if (display === 'link' || display === 'card') {
      this.renderCard(display, name, providerName(read.provider), read.pageUrl);
      return;
    }

    // The consent step. Nothing has been requested from the provider at this
    // point — no frame, no image, no beacon — and pressing this is what asks.
    const gate = document.createElement('button');
    gate.type = 'button';
    gate.className = 'video-consent';
    gate.setAttribute(
      'aria-label',
      `Play ${name} — this loads content from ${providerName(read.provider)}`,
    );

    const mark = document.createElement('span');
    mark.className = 'video-consent-play';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '▶';

    const label = document.createElement('span');
    label.className = 'video-consent-label';
    const strong = document.createElement('strong');
    strong.textContent = name;
    const note = document.createElement('span');
    note.textContent = `Plays from ${providerName(read.provider)}. Nothing is loaded from them until you press this.`;
    label.append(strong, note);

    gate.append(mark, label);
    gate.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.className = 'video-frame';
      frame.src = read.embedUrl;
      frame.title = name;
      frame.allow = 'fullscreen; picture-in-picture; encrypted-media';
      // The frame runs the provider's player, so it needs script and its own
      // origin — which is *their* origin, not ours; `allow-same-origin` here does
      // not give it anything of this application's. Everything else stays shut:
      // no forms, no downloads, no top-level navigation away from the page.
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
      );
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.loading = 'lazy';
      this.dom.replaceChildren(frame);
    });

    this.dom.append(gate);
  }

  // --- a live stream -------------------------------------------------------

  private renderStream(): void {
    const read = readStreamLink(textOf(this.node, 'url'));
    if (!read) {
      this.renderBroken('This is not an HLS or DASH address.', textOf(this.node, 'url'));
      return;
    }

    const player = document.createElement('video');
    player.className = 'video-player';
    player.controls = true;
    player.preload = 'none';
    player.src = read.url;
    this.dom.append(player);

    // Said, not hidden.
    //
    // A browser plays HLS natively or it does not: Safari and iOS do, Chromium
    // and Firefox need a player library this application does not ship
    // (ADR-0037). Somebody watching in the wrong browser gets a black rectangle
    // and no reason, so the reason is written under it with a way to watch
    // anyway.
    if (read.kind === 'dash' || (read.kind === 'hls' && !playsHlsNatively())) {
      const note = document.createElement('p');
      note.className = 'video-note';
      const text = document.createElement('span');
      text.textContent =
        read.kind === 'dash'
          ? 'DASH streams play only in browsers with their own support. '
          : 'This browser cannot play HLS by itself. Safari and iOS can. ';
      const open = document.createElement('a');
      open.href = read.url;
      open.target = '_blank';
      open.rel = 'noreferrer';
      open.textContent = 'Open the stream';
      note.append(text, open);
      this.dom.append(note);
    }
  }

  // --- the smaller shapes --------------------------------------------------

  private renderCard(display: string, name: string, kind: string, href: string): void {
    const link = document.createElement('a');
    link.className = display === 'card' ? 'video-card' : 'video-line';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';

    const mark = document.createElement('span');
    mark.className = 'video-card-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '▶';

    const text = document.createElement('span');
    text.className = 'video-card-text';
    const strong = document.createElement('strong');
    strong.textContent = name;
    text.append(strong);
    if (display === 'card') {
      const sub = document.createElement('span');
      sub.textContent = kind;
      text.append(sub);
    }

    link.append(mark, text);
    this.dom.append(link);
  }

  private renderBroken(message: string, detail?: string): void {
    const box = document.createElement('p');
    box.className = 'video-broken';
    box.textContent = message;
    if (detail) {
      const shown = document.createElement('span');
      // Shown as text and never as a link: an address this refused to embed is
      // not one to offer a click on either.
      shown.className = 'video-broken-detail';
      shown.textContent = detail;
      box.append(shown);
    }
    this.dom.append(box);
  }

  private title(): string {
    return textOf(this.node, 'title').trim();
  }
}

export const videoNodeView =
  () =>
  (node: unknown, view: EditorView, getPos: () => number | undefined): NodeView =>
    new VideoNodeView(node as PMNodeLike, () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    });
