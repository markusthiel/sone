/**
 * Noticing that the text moved (ADR-0083).
 *
 * The gutter controls, the slash menu and the formatting toolbar are all
 * `position: fixed` at coordinates measured from the document, and
 * `useViewportChanges` is what tells them to measure again. It had a blind spot
 * that is invisible from the watched element's own point of view:
 *
 * The reading column is `max-width: 46rem; margin-inline: auto`. On any window
 * wider than that, collapsing the sidebar changes how much room there is — so
 * the column **re-centres without changing width at all**. A ResizeObserver
 * reports size, so it had nothing to report; the text moved sideways and
 * nothing re-measured, which is why the handle sat where the text used to be
 * until the next edit happened to recompute it.
 *
 * jsdom implements no ResizeObserver and lays nothing out, so what is checked
 * here is the decision rather than the browser's behaviour: *what does this
 * hook ask to be told about*. That is the part that was wrong.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;
/** Every element the component's observer asked to be told about. */
let observed: HTMLElement[] = [];

describe('viewport changes', () => {
  before(async () => {
    dom = new JSDOM(
      `<!doctype html><html><body>
         <div id="root"></div>
         <div id="pane"><div id="column"><div id="editor"></div></div></div>
       </body></html>`,
      { pretendToBeVisual: true, url: 'http://localhost/' },
    );

    for (const key of [
      'window',
      'document',
      'navigator',
      'Node',
      'Element',
      'HTMLElement',
      'Event',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ] as const) {
      const value = (dom.window as unknown as Record<string, unknown>)[key];
      if (value === undefined) continue;
      try {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      } catch {
        // Some globals are getter-only on the Node global object.
      }
    }

    // The stand-in. jsdom has none, and the hook is written to do without one
    // rather than throw — so this is also the only way to see what it wanted.
    (globalThis as Record<string, unknown>)['ResizeObserver'] = class {
      observe(target: HTMLElement): void {
        observed.push(target);
      }
      disconnect(): void {}
    };
    (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(dom.window.document.getElementById('root') as unknown as HTMLElement);
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
    delete (globalThis as Record<string, unknown>)['ResizeObserver'];
  });

  async function mount(watch: HTMLElement | null): Promise<void> {
    observed = [];
    const { createElement } = await import('react');
    const { useViewportChanges } = await import('../src/hooks/useViewportChanges.ts');
    const Probe = (): null => {
      useViewportChanges(true, watch);
      return null;
    };
    await render(createElement(Probe));
  }

  test('the pane that re-centres the column is watched, not only the column', async () => {
    /*
     * The bug, in one assertion.
     *
     * Watching the editor alone catches a change to the editor's own size and
     * nothing else. What actually changed when the sidebar closed is the pane:
     * it got wider, the column re-centred inside it, and the editor's box was
     * the same size in a different place.
     */
    const document = dom.window.document;
    const editor = document.getElementById('editor') as unknown as HTMLElement;
    await mount(editor);

    assert.ok(observed.includes(editor), 'the element itself');
    assert.ok(
      observed.includes(document.getElementById('column') as unknown as HTMLElement),
      'the column it sits in',
    );
    assert.ok(
      observed.includes(document.getElementById('pane') as unknown as HTMLElement),
      'and the pane that is what actually changes when the sidebar moves',
    );
  });

  test('nothing is watched when no element is given', async () => {
    // Three of the four overlays used to pass none at all, which is how they
    // came to share this bug; they all pass the editor now. The hook still has
    // to survive being called without one.
    await mount(null);
    assert.deepEqual(observed, []);
  });
});
