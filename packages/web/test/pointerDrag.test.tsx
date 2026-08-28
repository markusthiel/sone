/**
 * The shared drag gesture.
 *
 * Extracted from the tree so the board does not need its own copy. Every
 * mistake this project has made in dragging was in this half — capture taken
 * too early, the pointer type read from the wrong event, state read inside a
 * setState updater — so it is worth testing on its own rather than only through
 * the surfaces that use it.
 *
 * These drive it with synthetic pointer events, which is the part jsdom can
 * model: it has no gesture engine, but it delivers events and runs timers.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let cleanup: () => void;
const captures: number[] = [];

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

describe('the shared drag gesture', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
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

    Object.assign(dom.window.HTMLElement.prototype, {
      setPointerCapture(this: HTMLElement, id: number) {
        captures.push(id);
      },
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

  /** Two "columns" with one draggable card, as the board has. */
  async function mount(canDrop = true): Promise<{
    drops: Array<{ id: string; target: string }>;
  }> {
    const { createElement } = await import('react');
    const { usePointerDrag } = await import('../src/hooks/usePointerDrag.ts');
    const drops: Array<{ id: string; target: string }> = [];

    function Board(): unknown {
      const drag = usePointerDrag<string>({
        idFrom: (element) => element.dataset['card'] ?? null,
        targetAt: (x, y) => {
          const found = dom.window.document.elementFromPoint(x, y) as HTMLElement | null;
          return found?.dataset['column'] ?? null;
        },
        canDrop: () => canDrop,
        onDrop: (id, target) => drops.push({ id, target }),
      });

      return createElement(
        'div',
        null,
        createElement(
          'div',
          { 'data-column': 'left' },
          createElement('div', {
            'data-card': 'card-1',
            'data-dragging': drag.dragging === 'card-1' ? 'true' : undefined,
            onPointerDown: drag.onPointerDown,
          }),
        ),
        createElement('div', {
          'data-column': 'right',
          'data-drop': drag.target === 'right' ? 'into' : undefined,
        }),
      );
    }

    await render(createElement(Board));
    return { drops };
  }

  const card = (): HTMLElement =>
    container.querySelector('[data-card="card-1"]') as HTMLElement;
  const column = (name: string): HTMLElement =>
    container.querySelector(`[data-column="${name}"]`) as HTMLElement;

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
    Object.defineProperty(event, 'pointerType', { value: pointerType ?? 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: pointerId ?? 1 });
    await act(async () => {
      element.dispatchEvent(event);
    });
  };

  const aim = (at: HTMLElement): void => {
    dom.window.document.elementFromPoint = () => at;
  };

  test('a mouse drag lands on the column under the pointer', async () => {
    const { drops } = await mount();
    const source = card();

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10,
    });
    aim(column('right'));
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 300,
    });

    assert.equal(source.getAttribute('data-dragging'), 'true');
    assert.equal(column('right').getAttribute('data-drop'), 'into');

    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(drops, [{ id: 'card-1', target: 'right' }]);
  });

  test('a finger that moves immediately scrolls instead', async () => {
    // Without this a board could not be scrolled: every attempt would pick up
    // a card.
    const { drops } = await mount();
    const source = card();

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10,
    });
    aim(column('right'));
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 90,
    });

    assert.equal(source.getAttribute('data-dragging'), null);
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'touch' });
    assert.deepEqual(drops, []);
  });

  test('a finger that holds still starts a drag', async () => {
    const { drops } = await mount();
    const source = card();

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    assert.equal(source.getAttribute('data-dragging'), 'true');

    aim(column('right'));
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 300,
    });
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'touch' });
    assert.deepEqual(drops, [{ id: 'card-1', target: 'right' }]);
  });

  test('a tap takes no pointer capture', async () => {
    // Capture on the press moves the click to the container, which is how every
    // link in the sidebar stopped working once before.
    await mount();
    captures.length = 0;
    const source = card();

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10,
    });
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(captures, []);
  });

  test('a refused destination is not marked and not committed', async () => {
    const { drops } = await mount(false);
    const source = card();

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10,
    });
    aim(column('right'));
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 300,
    });

    assert.equal(column('right').getAttribute('data-drop'), null);
    await send(source, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(drops, []);
  });

  test('a cancelled pointer commits nothing', async () => {
    // A system gesture, an incoming call, the browser taking over. Committing a
    // gesture somebody did not finish would be the worst outcome.
    const { drops } = await mount();
    const source = card();

    await send(source, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10,
    });
    aim(column('right'));
    await send(source, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 300,
    });
    await send(source, 'pointercancel', { pointerId: 1, pointerType: 'mouse' });

    assert.deepEqual(drops, []);
    assert.equal(card().getAttribute('data-dragging'), null);
  });

  test('an element with no id declines the gesture', async () => {
    // How a surface says "this is not draggable" — a board card in a read-only
    // collection, for instance.
    const { drops } = await mount();
    const bare = column('right');

    await send(bare, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10,
    });
    aim(column('left'));
    await send(bare, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 300,
    });
    assert.deepEqual(drops, []);
  });
});
