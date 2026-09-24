/**
 * One picture or one video, large (ADR-0193).
 *
 * Reported twice on the same afternoon: *„Wir hatten doch schon eingebaut, dass
 * Bilder in einem Modal aufgehen. Das geht jetzt in einem neuen Fenster auf."*
 * and *„Das selbe gilt auch für das Video wenn man es als Karte oder Zeile
 * zeigt: Es sollte ein Modal aufgehen mit Player und Download."*
 *
 * Nothing had broken — there had never been a modal, and a card's link has been
 * `target="_blank"` since it was written. These tests hold what replaces it.
 *
 * jsdom has no `<dialog>`: no `showModal`, no `close`, no backdrop. So what is
 * driven here is the tree that is built and the closing, which the module does
 * through one helper for exactly this reason; the backdrop and the focus trap
 * are the browser's and are not restated.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JSDOM } from 'jsdom';

import { codeOf, stylesOf } from './helpers/source.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'Event', 'HTMLElement'] as const) {
  (globalThis as unknown as Record<string, unknown>)[name] =
    name === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[name];
}

const { openMediaModal, closeMediaModal } = await import('../src/components/mediaModal.ts');
const labels = { close: 'Schließen', download: 'Herunterladen' };

test('a picture opens over the page, named, with a download beside it', () => {
  const modal = openMediaModal({
    kind: 'image',
    url: '/api/files/f-1',
    name: 'Neckar.jpg',
    labels,
  });

  assert.equal(modal.parentElement, dom.window.document.body, 'on the body, not in the block');
  // Named for a screen reader, because the panel is the whole viewport and the
  // filename in the bar is the only thing saying what was opened.
  assert.equal(modal.getAttribute('aria-label'), 'Neckar.jpg');

  const picture = modal.querySelector('img');
  assert.ok(picture, 'the picture is drawn here rather than fetched in a tab');
  assert.equal(picture.getAttribute('src'), '/api/files/f-1');
  // Empty alt: the name is already in the bar, and reading it twice describes
  // nothing.
  assert.equal(picture.getAttribute('alt'), '');

  const download = modal.querySelector<HTMLAnchorElement>('.media-modal-download');
  assert.ok(download, 'the download is the reason the bar exists');
  assert.equal(download.getAttribute('download'), 'Neckar.jpg');

  closeMediaModal();
});

test('a video opens as a player, and does not start on its own', () => {
  const modal = openMediaModal({
    kind: 'video',
    url: '/api/files/f-2',
    name: 'clip.mp4',
    labels,
  });

  const player = modal.querySelector<HTMLVideoElement>('video');
  assert.ok(player, 'a player, not a link to one');
  assert.ok(player.hasAttribute('controls'));
  // Sound starting by itself is the one thing nobody asks for.
  assert.ok(!player.hasAttribute('autoplay'));

  closeMediaModal();
});

test('closing takes it off the page, and a second open replaces the first', () => {
  const first = openMediaModal({ kind: 'image', url: '/api/files/a', name: 'a.png', labels });
  const second = openMediaModal({ kind: 'image', url: '/api/files/b', name: 'b.png', labels });

  // Two stacked dialogs would put Escape on the wrong one.
  assert.equal(first.parentElement, null, 'the first one went');
  assert.equal(second.parentElement, dom.window.document.body);

  // A player left in the body keeps its buffer, which is why closing removes
  // rather than hides.
  second.querySelector<HTMLButtonElement>('.media-modal-close')?.click();
  assert.equal(second.parentElement, null);
});

test('the block views open it instead of leaving the page', () => {
  const file = codeOf(new URL('../src/components/FileNodeView.ts', import.meta.url));
  const video = codeOf(new URL('../src/components/VideoNodeView.ts', import.meta.url));

  // A picture shown as a card or a line: the click opens the modal.
  assert.match(file, /openMediaModal\(\{ kind: 'image'/);
  assert.match(video, /openMediaModal\(\{ kind: 'video'/);

  // But the address stays on the link and only the default is prevented, so
  // ⌘-click and middle-click still reach the file itself.
  for (const source of [file, video]) {
    assert.match(source, /event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey/);
    assert.match(source, /event\.preventDefault\(\);/);
  }

  // And only for an upload: an embed's card belongs to the provider's page, and
  // that is the one thing this must not swallow.
  assert.match(video, /this\.renderCard\(display, this\.title\(\) \|\| 'Video', 'Uploaded video', href, true\)/);
  assert.match(video, /this\.renderCard\(display, name, providerName\(read\.provider\), read\.pageUrl\)/);
});

test('the bar is a band over the picture, not three things in three corners', () => {
  /*
   * How the first version looked, reported as *„irgendwie fehlt da optisch was"*:
   * the dialog's box is the viewport, and the name, the buttons and the picture
   * were put straight into it — so the name sat in the far top-left corner, the
   * controls in the far top-right, and the picture floated in between with no
   * visible relation to either.
   *
   * `inline-size: fit-content` on a panel around them was the obvious repair and
   * does not work: a portrait photo is held back by the room under the bar, not
   * by its own width, so the panel measured 900px around a picture drawn 459px
   * wide. Measured in Chromium at 1400 × 900. Hence a band of its own width.
   */
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));

  assert.match(css, /\.media-modal-panel \{[^}]*flex-direction: column/);
  assert.match(css, /\.media-modal-head \{[^}]*inline-size: min\(1200px, 100%\)/);
  assert.match(css, /\.media-modal-head \{[^}]*margin-inline: auto/);

  // The two controls carry their own rule. `.btn` is written `button.btn`, so
  // the download — an anchor — got the cursor and nothing else, which shipped as
  // a bare blue link beside a styled button.
  assert.match(css, /\.media-modal-button \{/);
  assert.doesNotMatch(codeOf(new URL('../src/components/mediaModal.ts', import.meta.url)), /'btn /);

  // And the picture has an edge: a dark photograph on a dark field otherwise
  // has nothing saying where it stops.
  assert.match(css, /\.media-modal-body img,\s*\n\.media-modal-body video \{[^}]*outline: 1px solid/);
});

test('opening puts the focus nowhere rather than on the download', () => {
  // A modal dialog moves focus to the first focusable thing inside it, which was
  // the download link — a ring around "Herunterladen" on opening, reading as
  // though it were about to be pressed.
  const modal = openMediaModal({ kind: 'image', url: '/api/files/c', name: 'c.png', labels });
  const panel = modal.querySelector<HTMLElement>('.media-modal-panel');
  assert.ok(panel, 'there is a panel between the dialog and its contents');
  assert.equal(panel.tabIndex, -1);
  assert.ok(panel.hasAttribute('autofocus'));
  closeMediaModal();
});
