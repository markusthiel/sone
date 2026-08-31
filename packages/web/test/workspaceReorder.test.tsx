/**
 * Arranging the switcher without a pointer (ADR-0031).
 *
 * The ADR named this as an accepted gap and said `⌥↑`/`⌥↓` was the shape to
 * reach for. This is that, and it is tested by mounting rather than by reading
 * the source: what matters is which request the keypress produces, and a source
 * assertion cannot see that the row that moved is the one that had focus.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

/** Every request the component made, in order. */
let calls: Array<{ path: string; body: unknown }> = [];

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

const WORKSPACES = [
  { id: 'w1', name: 'Alpha', role: 'owner', defaultLocale: 'en', pageCount: 0, memberCount: 1, icon: null },
  { id: 'w2', name: 'Beta', role: 'owner', defaultLocale: 'en', pageCount: 0, memberCount: 1, icon: null },
  { id: 'w3', name: 'Gamma', role: 'owner', defaultLocale: 'en', pageCount: 0, memberCount: 1, icon: null },
];

describe('reordering the switcher from the keyboard', () => {
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

  /** Open the switcher and let it load its list. */
  async function openMenu(): Promise<void> {
    calls = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      path: string,
      init?: { body?: unknown },
    ) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return {
        status: 200,
        ok: true,
        text: async () =>
          path === '/api/workspaces'
            ? JSON.stringify({ workspaces: WORKSPACES })
            : JSON.stringify({ ok: true }),
      };
    };

    const { createElement } = await import('react');
    const { WorkspaceMenu } = await import('../src/components/WorkspaceMenu.tsx');
    // Unmounted first. The panel's open/closed state lives in the component, so
    // rendering over a mounted one and clicking the button would *close* the
    // menu the previous test left open — which passes and fails alternately, for
    // no reason to do with the code.
    await render(null);
    await render(
      createElement(WorkspaceMenu as never, {
        currentId: 'w1',
        currentName: 'Alpha',
        currentIcon: null,
        canManageWorkspaces: false,
        onSwitch: () => {},
        onCreated: () => {},
      }),
    );

    const button = container.querySelector<HTMLButtonElement>('.workspace-button');
    assert.ok(button);
    await act(async () => {
      button.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  const rows = (): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>('[data-list-row]'),
  ];

  async function press(row: HTMLElement, key: string, altKey = true): Promise<void> {
    const event = new dom.window.KeyboardEvent('keydown', { key, altKey, bubbles: true });
    await act(async () => {
      row.dispatchEvent(event);
    });
  }

  const reorders = (): Array<{ workspaceId: string; afterWorkspaceId: string | null }> =>
    calls
      .filter((call) => call.path === '/api/workspaces/reorder')
      .map((call) => call.body as { workspaceId: string; afterWorkspaceId: string | null });

  test('the list is drawn in the order the server sent', async () => {
    await openMenu();
    assert.deepEqual(
      rows().map((row) => row.dataset['listRow']),
      ['w1', 'w2', 'w3'],
    );
  });

  test('⌥↓ moves a row after the one below it', async () => {
    await openMenu();
    await press(rows()[0]!, 'ArrowDown');

    assert.deepEqual(reorders(), [{ workspaceId: 'w1', afterWorkspaceId: 'w2' }]);
    // And locally, so the row moves under the finger rather than after a round
    // trip.
    assert.deepEqual(
      rows().map((row) => row.dataset['listRow']),
      ['w2', 'w1', 'w3'],
    );
  });

  test('⌥↑ moves a row after whatever precedes the one above it', async () => {
    // Expressed as "after which one", like every other placement here: moving up
    // is the same operation as a drop into the gap above, and two ways of saying
    // it is how they come to disagree.
    await openMenu();
    await press(rows()[2]!, 'ArrowUp');
    assert.deepEqual(reorders(), [{ workspaceId: 'w3', afterWorkspaceId: 'w1' }]);

    await press(rows()[1]!, 'ArrowUp');
    assert.deepEqual(reorders()[1], { workspaceId: 'w3', afterWorkspaceId: null });
  });

  test('at either end it does nothing, rather than wrapping around', async () => {
    // A shortcut that wraps would move a workspace from the top to the bottom on
    // a keypress somebody meant as "no further".
    await openMenu();
    await press(rows()[0]!, 'ArrowUp');
    await press(rows()[2]!, 'ArrowDown');
    assert.deepEqual(reorders(), []);
  });

  test('the plain arrows are left alone', async () => {
    // They move between entries in every menu, and taking them would be taking
    // the way out of the one being reordered.
    await openMenu();
    await press(rows()[0]!, 'ArrowDown', false);
    assert.deepEqual(reorders(), []);
  });

  test('the shortcut is announced rather than printed', async () => {
    // A hint beside every row would be five lines of instruction in a five-line
    // menu.
    await openMenu();
    assert.equal(
      rows()[0]?.getAttribute('aria-keyshortcuts'),
      'Alt+ArrowUp Alt+ArrowDown',
    );
  });
});
