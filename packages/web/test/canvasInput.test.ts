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
  assert.equal(acts({ pointerType: 'pen', penSeen: false, handDraws: false, touches: 1 }), true);
  assert.equal(acts({ pointerType: 'pen', penSeen: true, handDraws: false, touches: 1 }), true);
});

test('and is never part of a two-finger gesture', () => {
  // It cannot be: a pen and a finger down together is a hand resting while
  // somebody writes, which is the case this exists for.
  assert.equal(gestures({ pointerType: 'pen', penSeen: true, handDraws: false, touches: 2 }), false);
});

test('a mouse is unaffected by any of this', () => {
  // A desktop has no palm. Everything a mouse did, it goes on doing.
  assert.equal(acts({ pointerType: 'mouse', penSeen: true, handDraws: false, touches: 1 }), true);
  assert.equal(gestures({ pointerType: 'mouse', penSeen: true, handDraws: false, touches: 1 }), false);
});

test('with no pen ever seen, one finger works the tools', () => {
  /*
   * A tablet without a pencil, and a phone. Making touch pan-only everywhere
   * would take drawing away from everybody who has no pen — the rule has to
   * earn its way in by a pen actually appearing.
   */
  assert.equal(acts({ pointerType: 'touch', penSeen: false, handDraws: false, touches: 1 }), true);
});

test('once a pen has been seen, one finger only moves the view', () => {
  // The rule, in one line. A palm is a touch, so a palm moves the view by zero
  // pixels and draws nothing.
  assert.equal(acts({ pointerType: 'touch', penSeen: true, handDraws: false, touches: 1 }), false);
  assert.equal(gestures({ pointerType: 'touch', penSeen: true, handDraws: false, touches: 1 }), true);
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

test('and the rule can be switched off on this device (ADR-0181)', () => {
  /*
   * Asked for after ADR-0179 shipped without it: the switch was recorded as
   * *worth having* and then not built, which is a different thing from a
   * decision not to build it.
   *
   * The pencil is at the office, or the board is being pushed around with a
   * thumb — and once a pen has been seen here, none of that works any more.
   */
  assert.equal(acts({ pointerType: 'touch', penSeen: true, handDraws: true, touches: 1 }), true);
  assert.equal(gestures({ pointerType: 'touch', penSeen: true, handDraws: true, touches: 1 }), false);
});

test('switching it off does not make two fingers a tool', () => {
  // The override is about the *palm* rule, not about the pinch. Two contacts
  // are never a tool, and a board that stopped zooming because somebody let
  // their finger draw would be a worse trade than the one they made.
  assert.equal(gestures({ pointerType: 'touch', penSeen: true, handDraws: true, touches: 2 }), true);
  assert.equal(acts({ pointerType: 'touch', penSeen: true, handDraws: true, touches: 2 }), false);
});

test('and the pen goes on working either way', () => {
  assert.equal(acts({ pointerType: 'pen', penSeen: true, handDraws: true, touches: 1 }), true);
});

test('the switch is only there once a pen has been seen', async () => {
  /*
   * Guarded by `penSeen` in the markup: before a pen, the rule is not in force
   * and a control that changes nothing is one somebody presses twice looking
   * for what it did.
   *
   * A source assertion, because the thing being claimed is that the guard is
   * around the control — mounting shows a board with no pen and proves the
   * absence, not the reason for it.
   */
  const { codeOf } = await import('./helpers/source.ts');
  const surface = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(surface, /\{penSeen && \(\s*<label className="canvas-pen-only"/);
  assert.match(surface, /rememberHandDraws\(next\)/);
});

test('and what it is set to reaches the rule', async () => {
  /*
   * The one that would have caught ADR-0178's mistake in this shape: a piece of
   * remembered state that nothing ever reads is a switch that does nothing.
   */
  const { codeOf } = await import('./helpers/source.ts');
  const surface = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(surface, /const \[handDraws, setHandDraws\] = useState\(readHandDraws\)/);
  // Handed to the contact the rules are asked about, not merely held.
  assert.match(surface, /penSeen: seen,\s*\n\s*handDraws,/);
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
