/**
 * What a touch on the board means when a pen is in play (ADR-0179).
 *
 * > Könnte man bei den whiteboards am iPad mit Stift auch eine
 * > Handballenerkennung einbauen, damit man mit dem Stift besser arbeiten kann
 * > oder geht das im web nicht?
 *
 * It goes in the web, and it is not really recognition. The browser already
 * says **what** touched: an Apple Pencil arrives as `pointerType: 'pen'`, a
 * finger and a palm both as `'touch'`. So nothing has to guess at a contact's
 * shape — the rule is *once a pen has been seen here, only the pen draws*, and
 * fingers move the view instead.
 *
 * That is also the whole of what the web can do. The digitizer-level rejection
 * PencilKit gets is not on offer: a palm and a deliberate finger are the same
 * event, and the only thing that separates them is that one of them is not a
 * pen.
 *
 * The canvas consulted `pointerType` nowhere before this, so a resting hand was
 * a stroke, an eraser and a selection like any other.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acts, gestures } from '../src/components/canvasInput.ts';

test('a pen always draws', () => {
  assert.equal(acts({ pointerType: 'pen', penSeen: false, touches: 1 }), true);
  assert.equal(acts({ pointerType: 'pen', penSeen: true, touches: 1 }), true);
});

test('and is never part of a two-finger gesture', () => {
  // It cannot be: a pen and a finger down together is a hand resting while
  // somebody writes, which is the case this exists for.
  assert.equal(gestures({ pointerType: 'pen', penSeen: true, touches: 2 }), false);
});

test('a mouse is unaffected by any of this', () => {
  // A desktop has no palm. Everything a mouse did, it goes on doing.
  assert.equal(acts({ pointerType: 'mouse', penSeen: true, touches: 1 }), true);
  assert.equal(gestures({ pointerType: 'mouse', penSeen: true, touches: 1 }), false);
});

test('with no pen ever seen, one finger works the tools', () => {
  /*
   * A tablet without a pencil, and a phone. Making touch pan-only everywhere
   * would take drawing away from everybody who has no pen — the rule has to
   * earn its way in by a pen actually appearing.
   */
  assert.equal(acts({ pointerType: 'touch', penSeen: false, touches: 1 }), true);
});

test('once a pen has been seen, one finger only moves the view', () => {
  // The rule, in one line. A palm is a touch, so a palm moves the view by zero
  // pixels and draws nothing.
  assert.equal(acts({ pointerType: 'touch', penSeen: true, touches: 1 }), false);
  assert.equal(gestures({ pointerType: 'touch', penSeen: true, touches: 1 }), true);
});

test('two fingers are a gesture whether or not there is a pen', () => {
  /*
   * Two contacts are never a tool. Pinch and two-finger pan are what a tablet
   * expects of any canvas, and a board that cannot be zoomed with two fingers
   * is a board somebody stops using on a tablet.
   */
  for (const penSeen of [false, true]) {
    assert.equal(gestures({ pointerType: 'touch', penSeen, touches: 2 }), true, `pen ${penSeen}`);
    assert.equal(acts({ pointerType: 'touch', penSeen, touches: 2 }), false);
  }
});

test('the surface asks rather than deciding again', async () => {
  const { codeOf } = await import('./helpers/source.ts');
  const surface = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(surface, /acts\(/);
  assert.match(surface, /gestures\(/);
});

test('a cancelled pointer throws its stroke away rather than writing it', async () => {
  /*
   * `onPointerCancel` ran the same handler as `onPointerUp`, which **commits**
   * the stroke — so a touch the system reclaimed mid-gesture wrote a line.
   *
   * That is the palm case arriving by a second door, and it was there before
   * any of this: Safari cancels a pointer when it decides the contact belongs
   * to a system gesture, which is itself the strongest rejection signal the
   * browser gives.
   */
  const { codeOf } = await import('./helpers/source.ts');
  const surface = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(surface, /onPointerCancel=\{onSurfaceCancel\}/);
  assert.doesNotMatch(surface, /onPointerCancel=\{onSurfaceUp\}/);
});

test('the board keeps the browser off its gestures', async () => {
  /*
   * Without `touch-action: none` the browser claims the drag first and the
   * stroke never starts — and on iPadOS the page pinch-zooms the interface
   * rather than the board, which is not a feature anybody asked for.
   *
   * `user-select` and the callout go with it: a long press on a board is
   * somebody thinking, not somebody selecting text.
   */
  const { stylesOf } = await import('./helpers/source.ts');
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));
  const rule = /\.canvas-surface \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /touch-action: none/);
  assert.match(rule, /user-select: none/);
  assert.match(rule, /-webkit-touch-callout: none/);
});
