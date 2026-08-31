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

  /**
   * A page handle backed by a real Y.Doc, without a server.
   *
   * `status` and whether the body is seeded are parameters, because the bug this
   * component had was entirely about the moment between mounting and the
   * server's content arriving.
   */
  async function makeHandle(
    options: { status?: string; seed?: boolean } = {},
  ): Promise<unknown> {
    const Y = await import('yjs');
    const { pageContent } = await import('@sone/core');
    const { seedEmptyPage } = await import('@sone/editor');
    // y-protocols is a dependency of @sone/client rather than of the web
    // package, so it is not resolvable from here. The awareness object only
    // needs the shape the cursor plugin touches.
    const doc = new Y.Doc();
    if (options.seed !== false) seedEmptyPage(pageContent(doc));

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
      status: options.status ?? 'synced',
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

  test('menu items do not act on pointerdown', async () => {
    // Three complaints came from one mistake: items fired the moment a finger
    // landed, the same preventDefault cancelled the scroll gesture, and the
    // rest of the tap was delivered to the editor underneath — which put the
    // caret where the finger had been.
    //
    // Asserted on the source rather than by simulating a touch, because jsdom
    // has no gesture model: what can be checked is that no interactive item
    // binds the event that caused it.
    const { readFileSync } = await import('node:fs');
    const files = [
      'src/components/SlashMenu.tsx',
      'src/components/BlockMenu.tsx',
      'src/components/TagEditor.tsx',
      'src/components/SelectionToolbar.tsx',
    ];

    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const offenders = [...source.matchAll(/onPointerDown=\{/g)];
      assert.equal(
        offenders.length,
        0,
        `${file} still activates on pointerdown, which fires before a finger lifts`,
      );
    }
  });

  test('the table toolbar acts on click, like the other overlays', async () => {
    // Same rule as the menus: acting on pointerdown fires before a finger
    // lifts and cancels the scroll gesture with it.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../src/components/TableToolbar.tsx', import.meta.url),
      'utf8',
    );
    assert.equal(
      [...source.matchAll(/onPointerDown=\{/g)].length,
      0,
      'the table toolbar must not activate on pointerdown',
    );
    // And it must re-place itself when the page moves, or it detaches from the
    // table on the first scroll.
    assert.match(source, /useViewportChanges/);
  });

  test('scrollable popups declare their touch behaviour', async () => {
    // Without touch-action the browser waits to see whether the gesture will be
    // cancelled before it scrolls, which reads as a list that ignores a drag.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.slash-menu[\s\S]{0,400}touch-action:\s*pan-y/);
    assert.match(css, /overscroll-behavior:\s*contain/);
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

    // A click, which is what a completed tap produces — and what a scroll
    // gesture does not.
    await act(async () => {
      plus.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
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

  test('an unsynced document is not seeded, and not mounted', async () => {
    // The bug: a document is empty locally until the server's state arrives, and
    // the editor seeded an empty paragraph into that emptiness on every mount. The
    // seed is a real CRDT insert, so when the content merged in the page had its
    // blocks *and* a stray paragraph — one per visit, landing wherever the two
    // inserts happened to order, which is why they turned up in the middle as
    // often as at the end.
    const Y = await import('yjs');
    const { pageContent } = await import('@sone/core');
    const { createElement } = await import('react');
    const { EditorSurface } = await import('../src/components/EditorSurface.tsx');

    const handle = (await makeHandle({ status: 'syncing', seed: false })) as {
      doc: import('yjs').Doc;
    };
    const fragment = pageContent(handle.doc);
    assert.equal(fragment.length, 0, 'nothing there yet, as on a real open');

    await render(
      createElement(EditorSurface as never, {
        handle,
        pageId: '00000000-0000-4000-8000-000000000001',
      }),
    );

    assert.equal(fragment.length, 0, 'and still nothing: no paragraph was written');
    assert.equal(
      container.querySelector('.ProseMirror'),
      null,
      'nothing is mounted before the content is known, because mounting is what seeds',
    );
    void Y;
  });

  test('a page that really is empty gets its one paragraph once synced', async () => {
    // The case the seeding exists for, which must keep working: a page created by
    // the API has no body, and the schema requires at least one block.
    const { pageContent } = await import('@sone/core');
    const { createElement } = await import('react');
    const { EditorSurface } = await import('../src/components/EditorSurface.tsx');

    const handle = (await makeHandle({ status: 'synced', seed: false })) as {
      doc: import('yjs').Doc;
    };
    const fragment = pageContent(handle.doc);

    await render(
      createElement(EditorSurface as never, {
        handle,
        pageId: '00000000-0000-4000-8000-000000000002',
      }),
    );

    assert.equal(fragment.length, 1, 'exactly one, and only now that it is believable');
  });

  test('an offline document with content is still shown', async () => {
    // Waiting for `synced` alone would leave somebody offline unable to read a
    // page they have a local copy of.
    const { pageContent } = await import('@sone/core');
    const { createElement } = await import('react');
    const { EditorSurface } = await import('../src/components/EditorSurface.tsx');

    const handle = (await makeHandle({ status: 'offline' })) as { doc: import('yjs').Doc };
    assert.equal(pageContent(handle.doc).length, 1, 'a local copy');

    await render(
      createElement(EditorSurface as never, {
        handle,
        pageId: '00000000-0000-4000-8000-000000000003',
      }),
    );

    assert.ok(container.querySelector('.ProseMirror'), 'mounted from what is there');
  });
});
