/**
 * Telling a drag from a scroll.
 *
 * The one hard problem in touch dragging, and the reason I avoided it for too
 * long. A sidebar has to scroll, and both gestures begin identically: a finger
 * touches a row and moves.
 *
 * These drive the hook with synthetic pointer events, which is the only part of
 * this that jsdom can model — it has no gesture engine, but it does deliver
 * events and run timers.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

describe('telling a drag from a scroll', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });

    // jsdom has no PointerEvent; MouseEvent carries everything used here.
    const win = dom.window as unknown as Record<string, unknown>;
    if (!win['PointerEvent']) win['PointerEvent'] = win['MouseEvent'];

    for (const key of GLOBALS) {
      const value = win[key];
      if (value === undefined) continue;
      try {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      } catch {
        // Some globals are getter-only on the Node global.
      }
    }
    (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

    // Neither exists in jsdom, and the hook calls both.
    Object.assign(dom.window.HTMLElement.prototype, {
      setPointerCapture() {},
      releasePointerCapture() {},
    });

    const { createRoot } = await import('react-dom/client');
    const react = await import('react');
    act = react.act as never;

    container = dom.window.document.getElementById('root') as unknown as HTMLElement;
    const root = createRoot(container);
    render = async (element) => {
      await act(async () => {
        root.render(element as never);
      });
    };
    cleanup = () => root.unmount();
  });

  after(() => {
    cleanup?.();
    dom?.window.close();
  });

  /** A tree of three rows, wired to the hook, recording what it decides. */
  async function mount(): Promise<{ drops: Array<{ id: string; intent: string }> }> {
    const { createElement } = await import('react');
    const { useTreeDrag } = await import('../src/hooks/useTreeDrag.ts');

    // The target row is recorded too. Without it these assertions could not
    // tell "after b" from "after c" — the dragged id is the same either way.
    const drops: Array<{ id: string; rowId: string; intent: string }> = [];

    function Tree(): unknown {
      const drag = useTreeDrag({
        canDrop: () => true,
        onDrop: (id, position) =>
          drops.push({ id, rowId: position.rowId, intent: position.intent }),
      });
      return createElement(
        'div',
        null,
        ['a', 'b', 'c'].map((id) =>
          createElement(
            'div',
            {
              key: id,
              'data-tree-row': id,
              'data-tree-kind': 'page',
              'data-tree-parent': 'root',
              'data-dragging': drag.dragging === id ? 'true' : undefined,
              'data-drop':
                drag.target?.rowId === id && drag.dragging
                  ? drag.target.intent
                  : undefined,
              onPointerDown: drag.onPointerDown,
            },
            // The label is a link, as in the real tree — which is what made
            // the browser take the gesture over.
            createElement('a', { href: `/p/${id}`, className: 'tree-link' }, id),
          ),
        ),
      );
    }

    await render(createElement(Tree));
    return { drops };
  }

  const row = (id: string): HTMLElement =>
    container.querySelector(`[data-tree-row="${id}"]`) as HTMLElement;

  /** jsdom lays nothing out, so the row under a point has to be supplied. */
  function pointAt(target: HTMLElement, fraction: number): { x: number; y: number } {
    Object.defineProperty(target, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, height: 40, left: 0, width: 200, bottom: 40, right: 200 }),
    });
    dom.window.document.elementFromPoint = () => target;
    return { x: 10, y: 40 * fraction };
  }

  const send = async (
    element: HTMLElement,
    type: string,
    init: Record<string, unknown>,
  ): Promise<void> => {
    const { pointerType, pointerId, ...rest } = init;
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...rest,
    });
    // jsdom's MouseEvent ignores pointer fields in its init, so they are
    // defined on the instance. Without this every event looks like it has no
    // pointer type, which is exactly the ambiguity the hook must not depend on.
    Object.defineProperty(event, 'pointerType', { value: pointerType ?? 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: pointerId ?? 1 });

    await act(async () => {
      element.dispatchEvent(event);
    });
  };

  test('a finger that moves immediately is a scroll, not a drag', async () => {
    // The case that makes this hard: without the hold, every attempt to scroll
    // the sidebar would pick up a row instead.
    const { drops } = await mount();
    const source = row('a');

    await send(source, 'pointerdown', {
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    });
    await send(source, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 60,
    });

    assert.equal(source.getAttribute('data-dragging'), null, 'no drag started');
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'touch' });
    assert.deepEqual(drops, [], 'and nothing was moved');
  });

  test('a finger that stays still becomes a drag', async () => {
    const { drops } = await mount();
    const source = row('a');

    await send(source, 'pointerdown', {
      button: 0,
      pointerId: 1,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    });

    // The hold, without moving.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    assert.equal(source.getAttribute('data-dragging'), 'true', 'the drag began');

    const point = pointAt(row('b'), 0.8);
    await send(source, 'pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'touch' });

    assert.deepEqual(drops, [{ id: 'a', rowId: 'b', intent: 'after' }]);
  });

  test('a mouse does not have to wait', async () => {
    // There is no competing gesture to protect, so a hold would only feel slow.
    const { drops } = await mount();
    const source = row('a');

    // Started well away from the destination, so the movement is clearly past
    // the slop. A first version moved six pixels and correctly did not start a
    // drag — which is the threshold doing its job, not a bug.
    await send(source, 'pointerdown', {
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 200,
      clientY: 200,
    });
    // The bottom of the third row. Aiming at the gap directly below the dragged
    // entry would be its own position, which is deliberately not offered.
    const point = pointAt(row('c'), 0.9);
    await send(source, 'pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: point.x,
      clientY: point.y,
    });

    assert.equal(source.getAttribute('data-dragging'), 'true');
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(drops, [{ id: 'a', rowId: 'c', intent: 'after' }]);
  });

  test('a cancelled pointer drops nothing', async () => {
    // A phone call, a system gesture, the browser taking over. Committing a
    // move on a gesture the person did not finish would be the worst outcome.
    const { drops } = await mount();
    const source = row('a');

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });
    const point = pointAt(row('b'), 0.5);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });
    await send(source, 'pointercancel', { pointerId: 1, pointerType: 'mouse' });

    assert.deepEqual(drops, []);
    assert.equal(source.getAttribute('data-dragging'), null);
  });

  test('a drag can start from the row label', async () => {
    // The label is a link and covers most of the row, so it is where anybody
    // presses. Excluding it meant the drag never started from the obvious
    // place, and the browser's own link drag took over — a floating row with a
    // green plus, and this gesture cancelled underneath it.
    const { drops } = await mount();
    const source = row('a');
    const label = source.querySelector('a') as HTMLElement;

    await send(label, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });
    const point = pointAt(row('b'), 0.8);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });

    assert.equal(source.getAttribute('data-dragging'), 'true');
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(drops, [{ id: 'a', rowId: 'b', intent: 'after' }]);
  });

  test('the indicator only appears where the drop would be accepted', async () => {
    // Marking a row that will refuse the drop promises something that then does
    // not happen, which reads as the drop being lost rather than declined.
    const { createElement } = await import('react');
    const { useTreeDrag } = await import('../src/hooks/useTreeDrag.ts');

    function Tree(): unknown {
      const drag = useTreeDrag({ canDrop: () => false, onDrop: () => {} });
      return createElement(
        'div',
        null,
        ['a', 'b'].map((id) =>
          createElement('div', {
            key: id,
            'data-tree-row': id,
            'data-tree-kind': 'page',
            'data-drop':
              drag.target?.rowId === id && drag.dragging ? drag.target.intent : undefined,
            onPointerDown: drag.onPointerDown,
          }),
        ),
      );
    }
    await render(createElement(Tree));

    const source = row('a');
    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });
    const point = pointAt(row('b'), 0.8);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });

    assert.equal(
      row('b').getAttribute('data-drop'),
      null,
      'a refusing row must not be marked as a destination',
    );
  });

  test('the indicator says which of the two things will happen', async () => {
    // "Between" and "inside" are different outcomes, so they must look
    // different before the finger lifts.
    const { drops } = await mount();
    const source = row('a');

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });

    // The gap above the second row is the one the dragged entry already
    // occupies, so nothing is marked.
    let point = pointAt(row('b'), 0.1);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });
    assert.equal(
      container.querySelectorAll('[data-drop]').length,
      0,
      'a move that changes nothing is not offered',
    );

    // Below it: a real destination.
    point = pointAt(row('b'), 0.9);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });
    assert.equal(row('b').getAttribute('data-drop'), 'after');

    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.equal(drops.length, 1);
  });

  test('the gap an entry already occupies is not offered', async () => {
    // Above and below a row is where it already is. Offering those is a move
    // that changes nothing — and the gap below normalises to "after itself",
    // which is not a position at all.
    const { drops } = await mount();
    const source = row('a');

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });
    const point = pointAt(row('b'), 0.1);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });

    assert.equal(container.querySelectorAll('[data-drop]').length, 0);
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(drops, [], 'and nothing happens on release');
  });

  test('a gap between siblings has one owner, not two', async () => {
    // "Before this row" and "after the one above" are the same place. Two bands
    // owning it drew two lines a few pixels apart, which looked like two places
    // to drop between two folders.
    const { drops } = await mount();
    // Three rows, so there is a gap that is not the dragged entry's own.
    const source = row('a');

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });

    // The top of the third row: normalised to "after the second". With only two
    // rows this gap would be the dragged entry's own, which is a different
    // case and covered separately.
    const point = pointAt(row('c'), 0.1);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });

    const marked = [...container.querySelectorAll('[data-drop]')];
    assert.equal(marked.length, 1, 'exactly one row is marked');
    assert.equal(
      marked[0]!.getAttribute('data-tree-row'),
      'b',
      'and it is the row above, which owns the gap below itself',
    );

    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    // "after b", not "before c": one gap, one owner, and it is the row above.
    assert.deepEqual(drops, [{ id: 'a', rowId: 'b', intent: 'after' }]);
  });

  test('the first row keeps a before band, since nothing above owns that gap', async () => {
    const { drops } = await mount();
    const source = row('b');

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200,
    });
    const point = pointAt(row('a'), 0.1);
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });

    assert.deepEqual(drops, [{ id: 'b', rowId: 'a', intent: 'before' }]);
  });

  test('pressing a control inside a row does not start a drag', async () => {
    // The menu button and the disclosure triangle have their own jobs.
    const { drops } = await mount();
    const source = row('a');
    const button = dom.window.document.createElement('button');
    source.appendChild(button);

    await act(async () => {
      button.dispatchEvent(
        new dom.window.MouseEvent('pointerdown', {
          bubbles: true, cancelable: true, button: 0,
        } as never),
      );
    });

    assert.equal(source.getAttribute('data-dragging'), null);
    assert.deepEqual(drops, []);
  });
});
