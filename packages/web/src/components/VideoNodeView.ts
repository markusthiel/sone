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

  constructor(private node: PMNodeLike) {
    this.dom = document.createElement('div');
    this.dom.className = 'video-block';
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

  stopEvent(event: Event): boolean {
    // The player's own controls, and the consent button. Without this, pressing
    // play selects the block instead.
    return (
      event.type === 'click' ||
      event.type === 'pointerdown' ||
      event.type === 'keydown' ||
      event.type.startsWith('touch')
    );
  }

  private render(): void {
    const source = textOf(this.node, 'source');
    const display = textOf(this.node, 'display') || 'player';
    this.dom.dataset['source'] = source;
    this.dom.dataset['display'] = display;
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
  (node: unknown, _view: EditorView, _getPos: () => number | undefined): NodeView =>
    new VideoNodeView(node as PMNodeLike);
