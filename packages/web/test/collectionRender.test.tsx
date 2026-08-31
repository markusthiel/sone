/**
 * The collection table, rendered.
 *
 * Every other test of this component reads its source. That is cheap and it
 * misses the class of mistake that took the table off the page: hooks declared
 * after the early return for "not loaded yet". React counts hooks per render, so
 * they ran on the renders that got past the guard and not on the ones that did
 * not — the component threw the moment the data arrived, the block disappeared,
 * and a new one could not be added either.
 *
 * A source assertion cannot see that. Mounting it can, and the sequence that
 * matters is the real one: first render with nothing, then the data.
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
  'Event', 'MouseEvent', 'PointerEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

/** A collection payload, as the route sends one. */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pageId: 'p1',
    collectionId: 'c1',
    titleFieldId: 't1',
    canEdit: true,
    views: [{ id: 'v1', name: 'Table', viewType: 'table', definition: {} }],
    fields: [
      { id: 't1', name: 'Name', fieldType: 'text', config: {} },
      { id: 'f2', name: 'Vorname', fieldType: 'text', config: {} },
    ],
    rows: [{ id: 'r1', title: 'Barthel', values: {} }],
    files: [],
    ...over,
  };
}

/** Answer every request with one body, without a real Response. */
function answerWith(body: unknown): void {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
    status: 200,
    ok: true,
    text: async () => JSON.stringify(body),
  });
}

describe('the collection table, mounted', () => {
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

  /**
   * Mount the table and let the first request settle.
   *
   * A fresh collection id each time. The same one would reuse the mounted
   * component, whose fetch is keyed on the id — so the second test would assert
   * against the first test's data and pass or fail for the wrong reason.
   */
  let mounted = 0;
  async function mount(body: unknown): Promise<void> {
    answerWith(body);
    const { createElement } = await import('react');
    const { CollectionTable } = await import('../src/components/CollectionTable.tsx');
    mounted += 1;
    await render(createElement(CollectionTable, { collectionId: `c${mounted}` }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  test('it survives the render before its data arrives', async () => {
    // The regression, exactly: on the first render there is no data, the guard
    // returns early, and any hook after it is skipped — so when the data lands
    // there are more hooks than last time and the component throws.
    await mount(payload());
    assert.match(container.innerHTML, /Vorname/, 'the columns are drawn');
    assert.match(container.innerHTML, /Barthel/, 'and the entry');
    assert.doesNotMatch(container.innerHTML, /class="error"/);
  });

  test('the name is an editable field and the page is a link beside it', async () => {
    await mount(payload());
    const input = container.querySelector<HTMLInputElement>('.collection-title-input');
    assert.ok(input, 'the name is a field');
    assert.equal(input.value, 'Barthel');
    const open = container.querySelector<HTMLAnchorElement>('.collection-open-row');
    assert.ok(open, 'and the page is one control away');
    assert.match(open.getAttribute('href') ?? '', /^\/p\/r1/);
  });

  test('an image in a files cell is a thumbnail, and a document is a name', async () => {
    await mount(
      payload({
        fields: [
          { id: 't1', name: 'Name', fieldType: 'text', config: {} },
          { id: 'f3', name: 'Attachments', fieldType: 'files', config: {} },
        ],
        rows: [
          { id: 'r1', title: 'One', values: { f3: { kind: 'files', fileIds: ['a', 'b'] } } },
        ],
        files: [
          { id: 'a', filename: 'photo.png', mimeType: 'image/png', sizeBytes: 1, category: 'image' },
          { id: 'b', filename: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 2, category: 'pdf' },
        ],
      }),
    );

    const image = container.querySelector<HTMLImageElement>('.cell-file img');
    assert.ok(image, 'the picture is the name, for a picture');
    assert.equal(image.getAttribute('src'), '/api/files/a');
    assert.match(container.innerHTML, /plan\.pdf/, 'and the name is the name for a document');
  });

  test('a table nobody may edit offers no controls', async () => {
    await mount(payload({ canEdit: false }));
    assert.equal(container.querySelector('.collection-add-row'), null, 'no new entry');
    assert.equal(container.querySelector('.collection-clear'), null, 'no empty');
    const input = container.querySelector<HTMLInputElement>('.collection-title-input');
    assert.equal(input?.readOnly, true, 'the name is readable, not writable');
  });
});
