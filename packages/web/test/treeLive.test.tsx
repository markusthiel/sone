/**
 * The tree, while somebody is looking at it (ADR-0096).
 *
 * The server half is proven end to end in `treePush.db.test.ts`. What is
 * decided here is what the hook does with a nudge — and the decision that could
 * quietly go wrong is the coalescing: one reload of the whole tree per nudge is
 * fine for a rename and wrong for an import, which arrives as a burst.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

/** How many times the tree was asked for. */
let fetches = 0;
let listeners: Map<string, Set<() => void>>;

function fakeClient(): unknown {
  listeners = new Map();
  return {
    onNotify(scope: string, handler: () => void) {
      let set = listeners.get(scope);
      if (!set) {
        set = new Set();
        listeners.set(scope, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
  };
}

function nudge(scope = 'pages'): void {
  for (const handler of listeners.get(scope) ?? []) handler();
}

describe('the tree hears the server', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });

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
    (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

    (globalThis as Record<string, unknown>)['fetch'] = () => {
      fetches++;
      return Promise.resolve(
        new dom.window.Response(JSON.stringify({ pages: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }) as unknown as Response,
      );
    };

    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(
      dom.window.document.getElementById('root') as unknown as HTMLElement,
    );
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
    delete (globalThis as Record<string, unknown>)['fetch'];
  });

  const WORKSPACE = '00000000-0000-4000-8000-000000000001';

  async function mount(client: unknown): Promise<void> {
    fetches = 0;
    const { createElement } = await import('react');
    const { usePages } = await import('../src/hooks/usePages.ts');
    const Probe = (): null => {
      usePages(WORKSPACE, client as never);
      return null;
    };
    await render(null);
    await render(createElement(Probe));
    await wait(20);
  }

  async function wait(ms: number): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  test('a nudge fetches the tree again', async () => {
    await mount(fakeClient());
    const afterMount = fetches;

    nudge();
    await wait(400);

    assert.equal(fetches, afterMount + 1);
  });

  test('a burst is one reload, not one each', async () => {
    /*
     * The decision worth holding down.
     *
     * An import writes a subtree as several statements, and a move touches
     * several rows; each is a nudge, and each nudge is a fetch of the **whole**
     * tree. Without a window, one action by one person costs every other person
     * in the workspace a handful of full tree fetches in a row.
     */
    await mount(fakeClient());
    const afterMount = fetches;

    for (let at = 0; at < 8; at++) nudge();
    await wait(400);

    assert.equal(fetches, afterMount + 1, 'eight nudges, one reload');
  });

  test('and the window closes, so the next change is not swallowed', async () => {
    // The failure the coalescing could hide: a latch that never reopens looks
    // exactly like a push that works, until the second change.
    await mount(fakeClient());
    const afterMount = fetches;

    nudge();
    await wait(400);
    nudge();
    await wait(400);

    assert.equal(fetches, afterMount + 2);
  });

  test('without a connection it still works, on focus alone', async () => {
    // The value on the first render of every session: the client is still being
    // constructed while this hook mounts.
    await mount(null);
    assert.ok(fetches > 0);
  });

  test('unmounting stops listening, and drops a pending reload', async () => {
    // A shell that remounts on every workspace change would otherwise leave a
    // listener per shell — and a timer that fires into a component that is gone.
    await mount(fakeClient());
    assert.equal(listeners.get('pages')?.size, 1);

    nudge();
    const { act } = await import('react');
    await act(async () => {
      cleanup();
    });
    const afterUnmount = fetches;
    await wait(400);

    assert.equal(listeners.get('pages')?.size ?? 0, 0);
    assert.equal(fetches, afterUnmount, 'the pending reload was dropped');
  });
});
