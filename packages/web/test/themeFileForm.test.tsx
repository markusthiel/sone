/**
 * A theme in and out of a file (ADR-0125).
 *
 * Asked for as *„Themes die man importieren und exportieren kann, die dann
 * wirklich alles verändern."* The file format is `@sone/core`'s and has its own
 * tests; what is asserted here is the part a person actually meets — that
 * loading a file **fills in the form and stores nothing**, and that what is
 * exported is what they are looking at.
 *
 * Mounted rather than read. The two claims are about what is on the screen and
 * what did not reach the server, and a source test could show neither.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { writeThemeFile } from '@sone/core';

let dom: JSDOM;
let container: HTMLElement;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

/** What the form was told to save, if anything. */
let saved: unknown[] = [];
/** What a download was handed, if any. */
let downloaded: { name: string; blob: { text: () => Promise<string> } } | null = null;

const owner = {
  key: 'test',
  name: 'Haus Thiel',
  load: () => Promise.resolve({ theme: { accent: '#336699' as const } }),
  save: (theme: unknown) => {
    saved.push(theme);
    return Promise.resolve({ theme: theme as Record<string, never> });
  },
};

/** Choose a file, the way the browser reports it. */
async function choose(text: string): Promise<void> {
  const input = container.querySelector('input[type="file"]');
  assert.ok(input, 'there is somewhere to put a file');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ text: () => Promise.resolve(text) }],
  });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  // The read is a promise; let it settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

const select = (label: string): HTMLSelectElement | null => {
  for (const one of container.querySelectorAll('label')) {
    if (one.textContent?.startsWith(label)) return one.querySelector('select');
  }
  return null;
};

describe('a theme as a file', () => {
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

    /*
     * jsdom has no object URLs and does not download anything, so the two
     * halves of an export are recorded instead: what the blob held, and what
     * the link was told to call it.
     */
    const blobs = new Map<string, { text: () => Promise<string> }>();
    (dom.window.URL as unknown as Record<string, unknown>)['createObjectURL'] = (
      blob: { text: () => Promise<string> },
    ): string => {
      const url = `blob:${blobs.size}`;
      blobs.set(url, blob);
      return url;
    };
    (dom.window.URL as unknown as Record<string, unknown>)['revokeObjectURL'] = (): void => {};
    // Exposed only after patching, and deliberately not in the list above:
    // Node has a `URL` and a `Blob` of its own, so without this the component
    // would build a real `blob:nodedata:` URL and the stub would never see it.
    for (const key of ['URL', 'Blob'] as const) {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
    const click = dom.window.HTMLAnchorElement.prototype.click;
    dom.window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (this.download && blob) downloaded = { name: this.download, blob };
      else click.call(this);
    };

    const { createRoot } = await import('react-dom/client');
    const react = await import('react');
    act = react.act as never;
    container = dom.window.document.getElementById('root') as unknown as HTMLElement;
    const root = createRoot(container);
    render = async (element) => {
      await act(async () => {
        root.render(element as never);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };
    cleanup = () => root.unmount();
  });

  after(() => {
    cleanup();
    dom.window.close();
  });

  beforeEach(async () => {
    saved = [];
    downloaded = null;
    // Unmounted between tests, so one test's imported theme is not the next
    // one's starting state: the element is the same type in the same position,
    // so React would otherwise keep the state and never refetch.
    await render(null);
  });

  test('loading one fills in the form and stores nothing', async () => {
    /*
     * The decision worth holding. An import that wrote straight to the server
     * would be a second path to saving a theme — and one somebody could not
     * walk away from. It ends in the same Save button as every other change.
     */
    const { ThemeSettings } = await import('../src/components/ThemeSettings.tsx');
    const react = await import('react');
    await render(react.createElement(ThemeSettings, { owner, canEdit: true, show: 'colour' }));

    await choose(writeThemeFile('Dunkle Schiene', { surfaces: { rail: 'inverted' } }));

    assert.equal(select('Narrow rail')?.value, 'inverted', 'the form shows what was in the file');
    assert.deepEqual(saved, [], 'and nothing was written');
    assert.match(container.textContent ?? '', /Dunkle Schiene/, 'and it says where that came from');
  });

  test('and it replaces the half this screen is not showing too', async () => {
    /*
     * It is one theme. A file that changed only the visible half would mean
     * something different depending on which tab was open — so the whole theme
     * is replaced, and the accent the form arrived with is gone.
     */
    const { ThemeSettings } = await import('../src/components/ThemeSettings.tsx');
    const react = await import('react');
    await render(react.createElement(ThemeSettings, { owner, canEdit: true, show: 'colour' }));

    await choose(writeThemeFile('Nur Ecken', { corners: 'round' }));

    assert.equal(select('Corners')?.value, 'round');
    const accent = container.querySelector('input[aria-label="Accent"]');
    assert.equal(accent?.getAttribute('value'), '#4f7d6f', 'back to the design’s own');
  });

  test('a file that is not a theme changes nothing and says so', async () => {
    // Picking the wrong file is the ordinary mistake, and sanitising a holiday
    // photo's metadata into an empty theme would silently reset a workspace.
    const { ThemeSettings } = await import('../src/components/ThemeSettings.tsx');
    const react = await import('react');
    await render(react.createElement(ThemeSettings, { owner, canEdit: true, show: 'colour' }));

    await choose('{"some":"other file"}');

    const accent = container.querySelector('input[aria-label="Accent"]');
    assert.equal(accent?.getAttribute('value'), '#336699', 'the loaded theme is untouched');
    assert.match(container.textContent ?? '', /not a SONE theme file/i);
  });

  test('what is exported is what is on the form, not what was stored', async () => {
    // Otherwise it is a button that quietly ignores what somebody is looking
    // at — and the file they send on is the wrong one.
    const { ThemeSettings } = await import('../src/components/ThemeSettings.tsx');
    const react = await import('react');
    await render(react.createElement(ThemeSettings, { owner, canEdit: true, show: 'colour' }));

    await choose(writeThemeFile('Zwischenstand', { corners: 'sharp' }));

    for (const button of container.querySelectorAll('button')) {
      if (button.textContent === 'Export') {
        await act(async () => {
          button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        });
      }
    }

    assert.ok(downloaded, 'something was handed over');
    assert.match(downloaded.name, /\.sone-theme\.json$/);
    assert.match(downloaded.name, /haus-thiel/, 'named after whose theme it is');
    assert.match(await downloaded.blob.text(), /"corners": "sharp"/, 'the unsaved change is in it');
  });
});
