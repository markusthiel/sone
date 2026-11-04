import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { editorOverlayBounds, placeEditorOverlay, visibleBlockTop } from '../src/lib/editorOverlay.ts';

test('block menus stay visible at the measured iPhone and iPad positions', () => {
  for (const [width, bottom, top, height] of [[390, 609, 478.39, 464.8], [810, 1080, 968.83, 585.25]]) {
    const bounds = { left: 0, right: width!, top: 52, bottom: bottom! };
    const menu = placeEditorOverlay({ top: top!, bottom: top!, left: 58 }, { width: 220, height: height! }, bounds);
    assert.ok(menu.top >= bounds.top + 8);
    assert.ok(menu.top + Math.min(height!, menu.maxHeight) <= bounds.bottom - 8);
  }
});

test('a selection spanning the entire document still has reachable formatting', () => {
  const bar = placeEditorOverlay({ top: -500, bottom: 1712, left: 600 }, { width: 300, height: 44 },
    { top: 52, bottom: 609, left: 0, right: 390 }, true);
  assert.ok(bar.top >= 60 && bar.top + 44 <= 601);
  assert.ok(bar.left >= 8 && bar.left + 300 <= 382);
});

test('a keyboard, visual viewport pan and a narrow pane constrain oversized menus', () => {
  const bounds = { top: 180, bottom: 410, left: 40, right: 280 };
  const menu = placeEditorOverlay({ top: 390, bottom: 410, left: 270 }, { width: 288, height: 480 }, bounds);
  assert.equal(menu.maxWidth, 224);
  assert.equal(menu.maxHeight, 214);
  assert.equal(menu.left, 48);
  assert.equal(menu.top, 188);
});

test('a partly visible block keeps its actions, but a block outside the pane does not', () => {
  const bounds = { top: 52, bottom: 609, left: 0, right: 390 };
  assert.equal(visibleBlockTop({ top: -51.61, bottom: 86.91, height: 138.52 }, 90, bounds), 54);
  assert.equal(visibleBlockTop({ top: -200, bottom: 20, height: 220 }, 90, bounds), null);
  assert.equal(visibleBlockTop({ top: 700, bottom: 800, height: 100 }, 90, bounds), null);
});

test('bounds account for the editor pane, sticky header, bottom navigation and keyboard', () => {
  const dom = new JSDOM('<div class="main"><div class="topbar"></div><div id="editor"></div></div><nav class="icon-rail"></nav>');
  const doc = dom.window.document;
  const rect = (left: number, top: number, right: number, bottom: number) =>
    ({ left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect);
  doc.querySelector('.main')!.getBoundingClientRect = () => rect(0, 0, 390, 664);
  doc.querySelector('.topbar')!.getBoundingClientRect = () => rect(0, 0, 390, 52);
  doc.querySelector('.icon-rail')!.getBoundingClientRect = () => rect(0, 609, 390, 664);
  Object.defineProperty(dom.window, 'visualViewport', { configurable: true, value: { offsetTop: 0, offsetLeft: 0, width: 390, height: 664 } });
  const editor = doc.querySelector<HTMLElement>('#editor')!;
  assert.deepEqual(editorOverlayBounds(editor), { top: 52, bottom: 609, left: 0, right: 390 });
  Object.defineProperty(dom.window, 'visualViewport', { value: { offsetTop: 120, offsetLeft: 15, width: 350, height: 280 } });
  assert.deepEqual(editorOverlayBounds(editor), { top: 120, bottom: 400, left: 15, right: 365 });
  dom.window.close();
});
