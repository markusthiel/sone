/**
 * SONE web — looking at one picture or one video, large (ADR-0193).
 *
 * A card and a line say *that* there is an image or a video; they do not show
 * it. Until now the only way to see the thing itself was the file's own address
 * in a new tab — which leaves the page, loses the scroll position, and hands the
 * reader the browser's bare viewer with no name, no size and no way back except
 * closing a tab. This is the same click without leaving.
 *
 * ## Vanilla, and on the body
 *
 * A node view is not a React component (ADR-0041), so this builds elements. It
 * appends to `document.body` rather than into the block: the block sits inside
 * the editable region of a ProseMirror document, and a subtree with focus, a
 * player and a close button has no business living there — `stopEvent` keeps the
 * editor out of it, but an overlay clipped by a block's `overflow` or stacked
 * under the topbar would still be the result.
 *
 * ## `<dialog>` rather than a scrim of our own
 *
 * The React dialogs here draw `.dialog-scrim` themselves because they are React.
 * Nothing is gained by repeating that by hand: `showModal()` gives the backdrop,
 * the focus trap, Escape, and inertness of everything behind it — four things
 * that were each a bug waiting in a hand-built overlay.
 *
 * ## One modal at a time
 *
 * Opening a second closes the first. Two stacked dialogs would put Escape on the
 * wrong one, and nothing here wants two pictures at once.
 */

/** The words this needs in the reader's language (ADR-0041). */
export interface MediaModalLabels {
  close: string;
  download: string;
}

export interface MediaModalOptions {
  /** What to draw: a picture, or a player. */
  kind: 'image' | 'video';
  /** Where the bytes are — `/api/files/<id>`. */
  url: string;
  /** The file's name, shown in the bar and used for the download. */
  name: string;
  labels: MediaModalLabels;
}

/** The one that is open, so a second open replaces rather than stacks. */
let current: HTMLDialogElement | null = null;

export function closeMediaModal(): void {
  const open = current;
  if (!open) return;
  // See the bottom of `openMediaModal` on why there is a path without `close`.
  if (typeof open.close === 'function') open.close();
  else open.dispatchEvent(new Event('close'));
}

/**
 * Show one picture or one video over the page.
 *
 * Returns the dialog so a caller can test it; nothing in the application needs
 * the handle, because Escape, the backdrop and the close button all end it.
 */
export function openMediaModal(options: MediaModalOptions): HTMLDialogElement {
  closeMediaModal();

  const dialog = document.createElement('dialog');
  dialog.className = 'media-modal';
  dialog.dataset['kind'] = options.kind;
  dialog.setAttribute('aria-label', options.name);

  // One way out, used by the close button and by the backdrop, so neither has
  // to know about the environment without `close()` (see the bottom of this
  // function).
  const dismiss = (): void => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.dispatchEvent(new Event('close'));
  };

  const head = document.createElement('div');
  head.className = 'media-modal-head';

  const title = document.createElement('span');
  title.className = 'media-modal-name';
  title.textContent = options.name;

  // A download is offered for both, and this is the point of the bar.
  //
  // A picture in a browser can be saved from its context menu; a video played
  // inline often cannot, because the player's own menu is the provider's idea of
  // one. An explicit link is the same gesture for both and needs no menu.
  const download = document.createElement('a');
  download.className = 'btn media-modal-download';
  download.href = options.url;
  download.setAttribute('download', options.name);
  download.textContent = options.labels.download;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn media-modal-close';
  close.setAttribute('aria-label', options.labels.close);
  close.textContent = '✕';
  close.addEventListener('click', dismiss);

  head.append(title, download, close);

  const body = document.createElement('div');
  body.className = 'media-modal-body';

  if (options.kind === 'image') {
    const picture = document.createElement('img');
    picture.src = options.url;
    // Empty rather than the filename: the name is already in the bar above, and
    // a screen reader reading "DSC_0421.jpg" twice describes nothing.
    picture.alt = '';
    body.append(picture);
  } else {
    const player = document.createElement('video');
    player.controls = true;
    // Not `metadata` as the block does: somebody who opened this came to watch
    // it, so the browser may as well start. Not `autoplay` either — sound
    // starting on its own is the one thing nobody asks for.
    player.preload = 'auto';
    player.src = options.url;
    body.append(player);
  }

  dialog.append(head, body);

  // A click on the backdrop closes. The backdrop is the dialog element itself —
  // its box is the whole viewport and the visible panel is a child — so the test
  // is whether the click landed on the dialog rather than inside it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });

  // Taken off the document when it closes, whichever of the four ways closed it.
  // A dialog left in the body is invisible and inert, but a page that opens
  // twenty pictures would keep twenty players with their buffers.
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (current === dialog) current = null;
  });

  document.body.append(dialog);
  /*
   * `showModal` where there is one.
   *
   * Every browser this application supports has had `<dialog>` for years; the
   * environment without it is jsdom, where these tests run. The fallback opens
   * the element without the backdrop or the focus trap rather than throwing —
   * a test that has to stub a DOM method to exercise a component is testing the
   * stub, and a `TypeError` inside a node view's click handler is exactly the
   * kind of failure that takes the editor's React boundary with it.
   */
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  current = dialog;
  return dialog;
}
