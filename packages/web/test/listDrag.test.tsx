/**
 * Dragging rows in a flat list.
 *
 * The switcher's own order (ADR-0031). Three things are worth pinning down and
 * none of them are the gesture, which is tested in pointerDrag.test.tsx:
 *
 *  - a gap has exactly one name, so aiming at the bottom of one row and the top
 *    of the next lands in the same place;
 *  - a row's own two gaps are not offered, because a drop there changes nothing
 *    and reads as the drop having been lost;
 *  - rows outside the list are not destinations. The panel floats over the page
 *    tree, whose rows carry their own attribute, and a document-wide lookup
 *    would let a workspace be dropped onto a folder.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` and `elementFromPoint` are
 * supplied per test — which is fine here, because what is under a point is an
 * input to the hook rather than something it computes.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { codeOf, stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

describe('what a drag looks like', () => {
  test('the travelling label is one treatment, used by both surfaces', () => {
    // The lines say where a drop lands; the label says what is landing. The
    // switcher had the lines and no label, so a panel four rows tall gave no
    // sign that a whole workspace was moving.
    assert.match(css, /\.drag-preview \{/);
    assert.doesNotMatch(css, /\.tree-drag-preview \{/);
    for (const component of ['Sidebar', 'WorkspaceMenu']) {
      assert.match(
        codeOf(new URL(`../src/components/${component}.tsx`, import.meta.url)),
        /className="drag-preview"/,
        `${component} draws what is travelling`,
      );
    }
  });

  test('the sidebar head spends no gap on a control that is not there', () => {
    // The collapse button is hidden on a wide screen and its container is still
    // a flex item, so the row separated the workspace button from nothing — and
    // the button came out 8px narrower than the panel below it.
    assert.doesNotMatch(css, /\.sidebar-head \{[^}]*gap:/);
    assert.match(css, /\.sidebar-head-actions > \* \{[^}]*margin-inline-start: 8px/);
  });
});

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

describe('dragging rows in a flat list', () => {
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

  /**
   * Three rows in a panel, and one row outside it carrying the same attribute.
   *
   * The outsider is the point of the container check: in the running app it is
   * the page tree underneath the panel.
   *
   * The rows are `<button>`s, as the switcher's are — each one both switches
   * workspace and is the thing dragged.
   */
  async function mount(): Promise<{
    drops: Array<{ id: string; afterId: string | null }>;
    marks: () => Record<string, string | null>;
  }> {
    const { createElement, useRef } = await import('react');
    const { useListDrag } = await import('../src/hooks/useListDrag.ts');

    const drops: Array<{ id: string; afterId: string | null }> = [];

    function List(): unknown {
      const panel = useRef<HTMLDivElement | null>(null);
      const drag = useListDrag({
        container: panel,
        onDrop: (id, position) => drops.push({ id, afterId: position.afterId }),
      });

      const rows = ['a', 'b', 'c'].map((id, at) =>
        createElement(
          'button',
          {
            key: id,
            type: 'button',
            'data-list-row': id,
            'data-dragging': drag.dragging === id ? 'true' : undefined,
            'data-drop':
              drag.target === null
                ? undefined
                : drag.target.afterId === id
                  ? 'after'
                  : drag.target.afterId === null && at === 0
                    ? 'before'
                    : undefined,
            onPointerDown: drag.onPointerDown,
          },
          id,
        ),
      );

      return createElement(
        'div',
        null,
        createElement('div', { ref: panel }, ...rows),
        // Outside the panel, same attribute: a tree row under the floating menu.
        createElement('button', { type: 'button', 'data-list-row': 'outsider' }, 'outsider'),
      );
    }

    await render(createElement(List));
    return {
      drops,
      marks: () =>
        Object.fromEntries(
          ['a', 'b', 'c'].map((id) => [id, row(id).getAttribute('data-drop')]),
        ),
    };
  }

  const row = (id: string): HTMLElement =>
    container.querySelector(`[data-list-row="${id}"]`) as HTMLElement;

  /** Where in a row a point falls. 0 is its top edge, 1 its bottom. */
  function aim(target: HTMLElement, fraction: number): { x: number; y: number } {
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
    Object.defineProperty(event, 'pointerType', { value: pointerType ?? 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: pointerId ?? 1 });
    await act(async () => {
      element.dispatchEvent(event);
    });
  };

  /** Press on `from`, move to a point in `over`, release. */
  async function dragTo(
    from: HTMLElement,
    over: HTMLElement,
    fraction: number,
    release = true,
  ): Promise<void> {
    await send(from, 'pointerdown', {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 500,
    });
    const point = aim(over, fraction);
    await send(from, 'pointermove', {
      pointerId: 1, pointerType: 'mouse', clientX: point.x, clientY: point.y,
    });
    if (release) await send(from, 'pointerup', { pointerId: 1, pointerType: 'mouse' });
  }

  test('a row that is itself a button can still be dragged', async () => {
    // The regression that made this feature look impossible. The gesture hook
    // declines a press on a control inside a draggable element, so the rename
    // and menu buttons on a tree row do not start drags — but the switcher's
    // rows *are* buttons, and a blanket check declined every drag there while
    // looking like the gesture simply did not work.
    const { drops } = await mount();
    await dragTo(row('a'), row('c'), 0.9);
    assert.deepEqual(drops, [{ id: 'a', afterId: 'c' }]);
  });

  test('the bottom of a row and the top of the next are one place', async () => {
    // A gap named twice is a gap drawn twice, which is what the tree learnt the
    // hard way: two lines a few pixels apart for one destination.
    const first = await mount();
    await dragTo(row('a'), row('b'), 0.9);
    const second = await mount();
    await dragTo(row('a'), row('c'), 0.1);

    assert.deepEqual(first.drops, [{ id: 'a', afterId: 'b' }]);
    assert.deepEqual(second.drops, first.drops, 'the same gap, from either side');
  });

  test('the top of the first row means first', async () => {
    const { drops } = await mount();
    await dragTo(row('c'), row('a'), 0.2);
    assert.deepEqual(drops, [{ id: 'c', afterId: null }]);
  });

  test('a row is not offered its own two gaps', async () => {
    // Both are where it already is. Offering them promises a move and makes
    // none, which reads as the drop having been lost rather than declined.
    const above = await mount();
    // Dragging b onto the bottom of a: that gap is b's own position.
    await dragTo(row('b'), row('a'), 0.9);
    assert.deepEqual(above.drops, [], 'the gap above it');

    const below = await mount();
    await dragTo(row('b'), row('c'), 0.1);
    assert.deepEqual(below.drops, [], 'the gap below it, from the row beneath');

    const itself = await mount();
    await dragTo(row('b'), row('b'), 0.9);
    assert.deepEqual(itself.drops, [], 'its own row');
  });

  test('the first row dropped at the top of itself is nothing', async () => {
    const { drops } = await mount();
    await dragTo(row('a'), row('a'), 0.1);
    assert.deepEqual(drops, []);
  });

  test('a row outside the list is not a destination', async () => {
    // The panel floats over the page tree. Without the container check a
    // workspace could be dropped onto a folder, which has no meaning at all.
    const { drops } = await mount();
    await dragTo(row('a'), row('outsider'), 0.9);
    assert.deepEqual(drops, []);
  });

  test('the landing place is marked while the drag is in flight', async () => {
    // The line is the only thing that says where the drop goes, so it is worth
    // asserting that it is drawn on the row that owns the gap.
    const { marks } = await mount();
    await dragTo(row('a'), row('c'), 0.9, false);
    assert.deepEqual(marks(), { a: null, b: null, c: 'after' });

    await send(row('a'), 'pointerup', { pointerId: 1, pointerType: 'mouse' });
    assert.deepEqual(marks(), { a: null, b: null, c: null }, 'and cleared afterwards');
  });
});
