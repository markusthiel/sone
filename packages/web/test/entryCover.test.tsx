/**
 * A cover above the heading (ADR-0117).
 *
 * Asked for as a header picture on a page and on a folder, *„nur eigene Bilder,
 * kein Unsplash"*, with a colour or a gradient as the alternative and the
 * control appearing *„beim Drüberfahren"*.
 *
 * Mounted, because the three things that could quietly go wrong are all about
 * what is on the screen: that somebody who may not edit is offered nothing,
 * that the control is reachable without a pointer, and that a picture is an
 * `<img>` rather than a CSS background built out of a document value. A source
 * assertion can see each of those written down and none of them happening.
 *
 * What a cover may *be* is decided in `@sone/core`'s `cover.test.ts`, and the
 * route half is in `api.db.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

const FILE = '/api/files/6f1c9e2a-0000-4000-8000-00000000abcd';

/** Every cover the picker asked for. */
let chosen: Array<unknown> = [];

describe('the cover above a heading', () => {
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

  async function mount(cover: unknown, { mayEdit = true } = {}): Promise<void> {
    chosen = [];
    const { createElement } = await import('react');
    const { EntryCoverHead } = await import('../src/components/EntryCover.tsx');
    // Unmounted first: the picker's open state lives in the component, so a
    // second mount over a live one would inherit the previous test's.
    await render(null);
    await render(
      createElement(
        EntryCoverHead as never,
        {
          cover,
          pageId: 'p1',
          ...(mayEdit ? { onChange: (next: unknown) => chosen.push(next) } : {}),
        },
        createElement('h1', { className: 'page-title' }, 'Konzept'),
      ),
    );
  }

  const buttonSaying = (text: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find(
      (one) => (one.textContent ?? '').trim() === text,
    ) as HTMLButtonElement | undefined;

  const click = async (element: Element): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };

  test('a page with no cover keeps its heading, and offers one', async () => {
    // „Standard bleibt wie bisher, wenn nichts gesetzt ist." Nothing is drawn
    // above the heading until somebody chooses something.
    await mount(null);

    assert.equal(container.querySelector('.entry-cover'), null, 'no band');
    assert.ok(container.querySelector('.page-title'), 'and the heading is still there');
    assert.ok(buttonSaying('Cover'), 'with a way to add one');
  });

  test('somebody who may only read is offered nothing at all', async () => {
    /*
     * The rule the folder view already states about its rename field and its
     * three create buttons: a caller with nothing to offer passes no handler,
     * so there is nothing on screen to press. A share-link visitor is the case
     * this protects — and the one that produced „der Ordner wird als Seite
     * dargestellt auf die man schreiben kann" the last time it was missed.
     */
    await mount({ kind: 'color', color: 'blue' }, { mayEdit: false });

    assert.ok(container.querySelector('.entry-cover'), 'the cover is still drawn');
    assert.equal(container.querySelectorAll('button').length, 0);
  });

  test('the controls are in the document rather than summoned by a pointer', async () => {
    /*
     * They are revealed by opacity, not by mounting on hover. jsdom has no
     * hover and no stylesheet, so what is asserted is the half that matters
     * for a keyboard: the buttons exist and can be reached by Tab. A control
     * that is mounted on `onMouseEnter` cannot be, and removing a cover would
     * then be impossible without a mouse.
     */
    await mount({ kind: 'color', color: 'blue' });

    const buttons = [...container.querySelectorAll('.entry-cover-actions button')];
    assert.equal(buttons.length, 2, 'change and remove');
    for (const button of buttons) {
      assert.notEqual(
        (button as HTMLElement).tabIndex,
        -1,
        'reachable by Tab, not skipped',
      );
    }
  });

  test('a picture is an img, not a background built from the document', async () => {
    // `background-image: url(…)` means assembling CSS out of a value a client
    // wrote. An `<img src>` is escaped by React and can carry alternative text.
    await mount({ kind: 'image', url: FILE });

    const image = container.querySelector('img.entry-cover-image') as HTMLImageElement | null;
    assert.ok(image, 'drawn as an image');
    assert.equal(image.getAttribute('src'), FILE);
    const band = container.querySelector('.entry-cover') as HTMLElement;
    assert.doesNotMatch(band.getAttribute('style') ?? '', /url\(/);
  });

  test('a colour and a gradient are painted, and say which they are', async () => {
    await mount({ kind: 'color', color: '#112233' });
    let band = container.querySelector('.entry-cover') as HTMLElement;
    assert.equal(band.dataset['kind'], 'color');
    assert.match(band.getAttribute('style') ?? '', /#112233|rgb\(17, 34, 51\)/);

    await mount({ kind: 'gradient', from: 'blue', to: 'purple' });
    band = container.querySelector('.entry-cover') as HTMLElement;
    assert.equal(band.dataset['kind'], 'gradient');
    assert.match(band.getAttribute('style') ?? '', /linear-gradient/);
  });

  test('choosing a colour reports the cover, not a class name', async () => {
    await mount(null);
    await click(buttonSaying('Cover')!);

    const swatches = container.querySelectorAll('.entry-cover-swatch');
    assert.ok(swatches.length >= 8, 'the workspace palette, and gradients under it');
    await click(swatches[0]!);

    assert.deepEqual(chosen, [{ kind: 'color', color: 'grey' }]);
    assert.equal(container.querySelector('.entry-cover-picker'), null, 'and it closes');
  });

  test('and there is a way back to no cover at all', async () => {
    // There was none for a long time in the inbox, for the same shape of
    // reason: every state was reachable except the one somebody starts in.
    await mount({ kind: 'color', color: 'blue' });
    await click(buttonSaying('Remove')!);

    assert.deepEqual(chosen, [null]);
  });

  test('Escape closes the picker without choosing anything', async () => {
    // A panel that only closes by choosing something is a panel somebody has to
    // choose their way out of.
    await mount(null);
    await click(buttonSaying('Cover')!);
    assert.ok(container.querySelector('.entry-cover-picker'));

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    assert.equal(container.querySelector('.entry-cover-picker'), null);
    assert.deepEqual(chosen, []);
  });
});
