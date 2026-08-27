/**
 * The editor surface, mounted.
 *
 * This exists because I guessed twice at why the `+` button did not open the
 * slash menu and was wrong twice. The editor package's own tests drive the
 * ProseMirror side and pass; the failure is in the React layer, and nothing was
 * exercising it.
 *
 * jsdom cannot lay anything out — every getBoundingClientRect is zeros — so
 * positioning is not testable here. What is testable is everything that has
 * actually been wrong: whether a control renders, whether pressing it reaches
 * the editor, and whether the menu appears in the DOM afterwards.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let container: HTMLElement;
let cleanup: () => void;

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'DocumentFragment',
  'Range',
  'getComputedStyle',
  'MutationObserver',
  'DOMParser',
  'Event',
  'KeyboardEvent',
  'PointerEvent',
  'MouseEvent',
  'File',
  'FileList',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
] as const;

describe('editor surface', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });

    // matchMedia is not implemented by jsdom and useSidebar needs it. A stub
    // rather than a library: one method and two listeners.
    (dom.window as unknown as Record<string, unknown>)['matchMedia'] = (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    for (const key of DOM_GLOBALS) {
      const value = (dom.window as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      try {
        Object.defineProperty(globalThis, key, {
          value,
          configurable: true,
          writable: true,
        });
      } catch {
        // Some globals are getter-only on the Node global object.
      }
    }
    // React checks for this before using concurrent features.
    (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');

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

  /** A page handle backed by a real Y.Doc, without a server. */
  async function makeHandle(): Promise<unknown> {
    const Y = await import('yjs');
    const { pageContent } = await import('@sone/core');
    const { seedEmptyPage } = await import('@sone/editor');
    // y-protocols is a dependency of @sone/client rather than of the web
    // package, so it is not resolvable from here. The awareness object only
    // needs the shape the cursor plugin touches.
    const doc = new Y.Doc();
    seedEmptyPage(pageContent(doc));

    const awareness = {
      doc,
      clientID: doc.clientID,
      getStates: () => new Map(),
      getLocalState: () => null,
      setLocalState: () => {},
      setLocalStateField: () => {},
      on: () => {},
      off: () => {},
      destroy: () => {},
    };

    return {
      doc,
      awareness,
      status: 'synced',
      role: 'admin',
      canEdit: true,
      peers: () => [],
      close: () => {},
    };
  }

  test('the gutter renders a + and a block handle', async () => {
    const { createElement } = await import('react');
    const { EditorSurface } = await import('../src/components/EditorSurface.tsx');

    await render(
      createElement(EditorSurface as never, {
        handle: await makeHandle(),
        pageId: '00000000-0000-4000-8000-000000000001',
      }),
    );

    assert.ok(
      container.querySelector('.block-insert'),
      'the + must be in the DOM, or there is nothing to press',
    );
    assert.ok(container.querySelector('.block-handle'), 'and the block handle');
  });

  test('pressing + opens the slash menu', async () => {
    // Guessed at twice and wrong twice. The editor package's own tests drive
    // openSlashMenu directly and pass, so whatever is broken is here.
    const { createElement, act } = await import('react');
    const { EditorSurface } = await import('../src/components/EditorSurface.tsx');

    await render(
      createElement(EditorSurface as never, {
        handle: await makeHandle(),
        pageId: '00000000-0000-4000-8000-000000000002',
      }),
    );

    const plus = container.querySelector('.block-insert') as HTMLElement | null;
    assert.ok(plus, 'no + to press');

    await act(async () => {
      plus.dispatchEvent(
        new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
    });

    assert.match(
      container.querySelector('.ProseMirror')?.textContent ?? '',
      /\//,
      'the slash should have been inserted',
    );
    assert.ok(
      container.querySelector('.slash-menu'),
      'and the menu should be in the DOM',
    );
  });
});
