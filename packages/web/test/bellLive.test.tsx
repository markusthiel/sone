/**
 * The bell, while somebody is looking at it (ADR-0093).
 *
 * ADR-0092 gave the badge one source — the list the inbox already holds — and
 * refreshed it on `focus`. That covers coming back to a tab and misses the case
 * somebody actually watches: sitting on a page while a colleague names you.
 *
 * The server half is proven end to end in `bellPush.db.test.ts` and
 * `sync.e2e.test.ts`. What is decided *here* is what the hook does with a
 * nudge, and the two decisions worth holding down are both about doing less
 * than seems natural: it refetches rather than believing a number, and it does
 * so whether or not the tab is visible.
 *
 * The waits are past the coalescing window: since ADR-0097 the three listeners
 * share one hook, so a nudge here opens a window and the refetch happens at the
 * end of it rather than on the frame. One projection can send this listener two
 * nudges within milliseconds — its inserts and its sweep of deleted threads —
 * which is the burst that made sharing the hook worth the change.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

/** How many times the inbox was asked for its list. */
let fetches = 0;
/** Listeners the fake client is holding, by scope. */
let listeners: Map<string, Set<() => void>>;

/**
 * A client with nothing but the subscription.
 *
 * The hook takes a `SoneClient` and uses exactly one method of it, which is the
 * argument for passing the client rather than a callback: there is one object
 * that knows whether the connection is up, and threading a second one through
 * the shell would be a second answer to "are we connected".
 */
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

function nudge(scope = 'inbox'): void {
  for (const handler of listeners.get(scope) ?? []) handler();
}

describe('the bell hears the server', () => {
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

    // The inbox route, counted rather than answered with anything interesting:
    // what is under test is when it is asked, not what it says.
    (globalThis as Record<string, unknown>)['fetch'] = () => {
      fetches++;
      return Promise.resolve(
        new dom.window.Response(JSON.stringify({ notifications: [] }), {
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

  async function mount(client: unknown): Promise<void> {
    fetches = 0;
    const { createElement } = await import('react');
    const { useInbox } = await import('../src/hooks/useInbox.ts');
    const Probe = (): null => {
      useInbox(client as never);
      return null;
    };
    await render(createElement(Probe));
  }

  async function settle(): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  test('a nudge fetches the list again', async () => {
    await mount(fakeClient());
    await settle();
    const afterMount = fetches;

    await (await import('react')).act(async () => {
      nudge();
      // Past the coalescing window the nudge opens (ADR-0097): the refetch is
      // at the end of it, not on the frame.
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    assert.equal(fetches, afterMount + 1, 'the list, once more');
  });

  test('the nudge is not believed, it is checked', async () => {
    /*
     * The frame carries no count on purpose (ADR-0093), and this is the half of
     * that decision the browser keeps: the hook's answer to "how many" comes
     * from the list it just fetched, so there is one source. A count on the
     * wire would be a second, and two answers to one question is exactly how
     * the badge and the list came to disagree in the release before this one
     * (ADR-0092).
     *
     * Asserted as behaviour rather than as a shape: a nudge with no fetch after
     * it would mean the hook had learned something from the frame itself.
     */
    await mount(fakeClient());
    await settle();
    const afterMount = fetches;

    await (await import('react')).act(async () => {
      nudge();
      nudge();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    assert.equal(fetches, afterMount + 1, 'it went and looked, once for the pair');
  });

  test('a hidden tab is refreshed too', async () => {
    /*
     * The deliberate difference from the `focus` pair beside it.
     *
     * Skipping a hidden tab would look like a saving and would put the badge
     * back where it was: stale at the moment somebody switches to the tab —
     * which is the moment they look at it. The `focus` handler does check
     * visibility, and should: it fires for reasons that are not a change.
     */
    Object.defineProperty(dom.window.document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    try {
      await mount(fakeClient());
      await settle();
      const afterMount = fetches;

      await (await import('react')).act(async () => {
        nudge();
        await new Promise((resolve) => setTimeout(resolve, 400));
      });

      assert.equal(fetches, afterMount + 1);
    } finally {
      Object.defineProperty(dom.window.document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
    }
  });

  test('without a connection it still works, on focus alone', async () => {
    /*
     * Not a hypothetical: the hook is mounted while the client is still being
     * constructed, so `null` is the value it sees on the first render of every
     * single session. A hook that required one would fail exactly there.
     */
    await mount(null);
    await settle();
    assert.ok(fetches > 0, 'the list was still fetched');
  });

  test('unmounting stops listening', async () => {
    // Otherwise a shell that remounts — every navigation that changes
    // workspace — leaves a listener behind, and one notification becomes as
    // many refetches as the session has had shells.
    await mount(fakeClient());
    await settle();
    assert.equal(listeners.get('inbox')?.size, 1);

    const { act } = await import('react');
    await act(async () => {
      cleanup();
    });

    assert.equal(listeners.get('inbox')?.size ?? 0, 0);
  });
});
