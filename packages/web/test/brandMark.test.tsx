/**
 * The mark an instance draws (ADR-0123).
 *
 * Asked for as *„dass man ein Logo festlegen kann, quadratisch"*, and the whole
 * of the interface's side of it is one component: the mark is drawn in the
 * rail, in the mode bar on a phone, on the sign-in screen and beside a
 * workspace in the switcher, and the point of putting the logo *inside*
 * `SoneMark` rather than beside its four call sites is that none of them can
 * disagree about which mark this instance has.
 *
 * Mounted rather than read. A source test here would assert that the component
 * calls `useContext`, which is the wire — and a wire that exists is not a mark
 * on the screen.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

describe('the mark', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    const win = dom.window as unknown as Record<string, unknown>;
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
    const act = react.act as unknown as <T>(fn: () => T | Promise<T>) => Promise<void>;
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
    cleanup();
    dom.window.close();
  });

  test('is ours when the instance has none of its own', async () => {
    // The ordinary state, and the one an instance whose `/api/instance` has not
    // arrived yet is also in. Both are correct, which is why nothing waits.
    const { SoneMark } = await import('../src/components/Logo.tsx');
    const react = await import('react');

    await render(react.createElement(SoneMark, { size: 26, title: 'SONE' }));

    assert.ok(container.querySelector('svg'), 'the drawing');
    assert.equal(container.querySelector('img'), null);
  });

  test('and is the instance’s picture when it has one', async () => {
    const { SoneMark, BrandLogo } = await import('../src/components/Logo.tsx');
    const react = await import('react');

    await render(
      react.createElement(
        BrandLogo,
        { value: '/api/instance/logo?v=abc123' },
        react.createElement(SoneMark, { size: 26, title: 'Haus Thiel' }),
      ),
    );

    const img = container.querySelector('img');
    assert.ok(img, 'the instance’s own mark');
    assert.equal(img.getAttribute('src'), '/api/instance/logo?v=abc123');
    // The drawing is replaced rather than joined: two marks on one screen is
    // the thing a fallback drawn underneath would produce.
    assert.equal(container.querySelector('svg'), null);
    // Whatever the drawing would have said, since the mark is often the only
    // content of a link.
    assert.equal(img.getAttribute('alt'), 'Haus Thiel');
  });

  test('and says nothing when it is decoration', async () => {
    // `title` is given only where the mark is the sole content of a link or a
    // button; everywhere else it sits beside a label, and a screen reader
    // announcing the instance's name twice is worse than not at all.
    const { SoneMark, BrandLogo } = await import('../src/components/Logo.tsx');
    const react = await import('react');

    await render(
      react.createElement(
        BrandLogo,
        { value: '/api/instance/logo?v=abc123' },
        react.createElement(SoneMark, { size: 17 }),
      ),
    );

    const img = container.querySelector('img');
    assert.ok(img);
    assert.equal(img.getAttribute('alt'), '');
    assert.equal(img.getAttribute('aria-hidden'), 'true');
  });
});
