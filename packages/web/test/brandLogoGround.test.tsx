/**
 * Which of two marks the ground gets (ADR-0149).
 *
 * Reported: *„Ich habe jetzt mehrere Workspaces mit Farben in der schmalen
 * Leiste. bei einigen macht das Helle Logo mehr Sinn bei anderen das dunkle."*
 *
 * An instance may upload two marks — one drawn for a light ground, one for a
 * dark one — and **nothing is chosen by hand**: the mark measures the surface it
 * is drawn on and takes the one that reads there.
 *
 * Measured rather than read off `data-theme`, and that is the whole design. A
 * workspace may paint the rail with its accent (ADR-0122), so the rail of a
 * light instance can be the darkest surface on the screen; and a treatment is
 * compiled to `var(--accent)`, which is only a colour once the browser has
 * resolved it. The one place that knows is the element itself.
 *
 * Mounted, because a source test here would assert that a hook is called, and a
 * hook that is called is not a mark on a screen (ADR-0116).
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
  'Event', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

const ON_LIGHT = '/api/instance/logo?v=light01';
const ON_DARK = '/api/instance/logo/dark?v=dark01';

describe('the mark on a coloured ground', () => {
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
    cleanup();
    dom.window.close();
  });

  /** The mark, drawn on a surface of a given colour. */
  async function onGround(
    background: string,
    logos: { logo?: string | null; logoOnDark?: string | null },
  ): Promise<void> {
    const react = await import('react');
    const { SoneMark } = await import('../src/components/Logo.tsx');
    const { Instance } = await import('../src/components/Instance.tsx');

    await render(
      react.createElement(
        Instance,
        { value: { logo: null, logoOnDark: null, canSendMail: false, ...logos } },
        react.createElement(
          'div',
          { className: 'icon-rail', style: { background } },
          react.createElement(SoneMark, { size: 26, title: 'Haus Thiel' }),
        ),
      ),
    );
    // The measurement happens after layout; a paint is one turn away.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const drawn = (): string | null => container.querySelector('img')?.getAttribute('src') ?? null;

  test('the colours a browser actually computes are read on the right scale', async () => {
    /*
     * **Measured in Chrome, and it caught a bug jsdom could not.**
     *
     * A background that comes out of a `color-mix` — which is every surface in
     * this interface (ADR-0135) — is computed as `color(srgb 0.98 …)`, not as
     * `rgb(250, …)`. Read as though those were channels out of 255, the
     * near-white rail every instance has by default is near-black, and the
     * ordinary case picks the mark drawn for the other ground.
     *
     * The strings below are what Chrome returned for the rail in this
     * stylesheet: untreated in the light theme, and painted with a workspace's
     * accent in each.
     */
    const { parseComputed } = await import('../src/hooks/useGroundTone.ts');
    const { groundTone } = await import('@sone/core');

    const tone = (value: string): string => {
      const parsed = parseComputed(value);
      assert.ok(parsed, `${value} is a colour`);
      return groundTone(parsed);
    };

    assert.equal(tone('color(srgb 0.980392 0.972549 0.956863)'), 'light', 'the default rail');
    assert.equal(tone('color(srgb 0.0862745 0.0862745 0.0823529)'), 'dark', 'and in dark');
    assert.equal(tone('rgb(47, 125, 111)'), 'dark', 'an accent rail, light theme');
    assert.equal(tone('rgb(111, 192, 176)'), 'light', 'and the dark theme’s accent');

    // The scale is the function's, never the size of the numbers: `rgb(1,1,1)`
    // is nearly black and reads that way.
    assert.equal(tone('rgb(1, 1, 1)'), 'dark');
    assert.equal(tone('color(srgb 1 1 1)'), 'light');

    // A form nobody has seen is not a colour to invent one for.
    assert.equal(parseComputed('rgba(0, 0, 0, 0)')?.alpha, 0, 'transparent is still parsed');
    assert.equal(parseComputed('none'), null);
    assert.equal(parseComputed('oklch(0.7 0.1 200)'), null);
  });

  test('a light rail gets the mark drawn for a light ground', async () => {
    await onGround('#f7f6f3', { logo: ON_LIGHT, logoOnDark: ON_DARK });
    assert.equal(drawn(), ON_LIGHT);
  });

  test('and a dark one gets the other', async () => {
    // The case that was reported: the same instance, a workspace that paints
    // the rail dark, and a mark inked for white paper sitting on it.
    await onGround('#101010', { logo: ON_LIGHT, logoOnDark: ON_DARK });
    assert.equal(drawn(), ON_DARK);
  });

  test('an accent-coloured rail is judged by its own colour', async () => {
    // Not by the theme: a light instance can have a deep blue rail, and
    // `data-theme` says "light" while the mark sits on navy.
    await onGround('#1d4ed8', { logo: ON_LIGHT, logoOnDark: ON_DARK });
    assert.equal(drawn(), ON_DARK);
  });

  test('one mark uploaded is the mark everywhere', async () => {
    /*
     * The state every instance is in today, and the one it stays in if nobody
     * wants two. A dark ground with only the light-ground mark uploaded draws
     * that mark — the alternative is an instance that loses its logo by adding
     * a workspace colour.
     */
    await onGround('#101010', { logo: ON_LIGHT });
    assert.equal(drawn(), ON_LIGHT);

    // And the other way round, which is the same rule and not a special case.
    await onGround('#f7f6f3', { logoOnDark: ON_DARK });
    assert.equal(drawn(), ON_DARK);
  });

  test('no mark at all is still our drawing', async () => {
    await onGround('#101010', {});
    assert.equal(container.querySelector('img'), null);
    assert.ok(container.querySelector('svg'), 'the drawing');
  });

  test('and it measures again when the theme changes under it', async () => {
    /*
     * The ground is a computed colour, so nothing tells React it moved: a
     * workspace switch writes custom properties onto `<html>` and the rail's
     * background becomes a different colour without a single prop changing.
     *
     * Watched at the one element every theme writer touches — ADR-0124 made
     * sure there is only one.
     */
    await onGround('#f7f6f3', { logo: ON_LIGHT, logoOnDark: ON_DARK });
    assert.equal(drawn(), ON_LIGHT);

    const rail = container.querySelector('.icon-rail') as HTMLElement;
    await act(async () => {
      rail.style.background = '#101010';
      dom.window.document.documentElement.dataset['theme'] = 'dark';
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(drawn(), ON_DARK);
    delete dom.window.document.documentElement.dataset['theme'];
  });
});
