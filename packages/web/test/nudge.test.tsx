/**
 * The one answer to a nudge, shared by the three listeners (ADR-0097).
 *
 * Written inline in `usePages` (ADR-0096) and extracted the moment the trash
 * needed it — before there were three copies of a rule, which is where this
 * codebase has now watched a rule go to be forgotten six times.
 *
 * Two of these tests are about the burst, which is the obvious half. The other
 * two are about the failures the shape can hide, and they are the reason this
 * file exists rather than a comment: a window that never reopens looks exactly
 * like a push that works, and a subscription rebuilt on every render drops the
 * window that was already open.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

let calls = 0;
let listeners: Map<string, Set<() => void>>;
/** How many times something subscribed, so a resubscribe is visible. */
let subscriptions = 0;

function fakeClient(): unknown {
  listeners = new Map();
  subscriptions = 0;
  return {
    onNotify(scope: string, handler: () => void) {
      subscriptions += 1;
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

const nudge = (scope = 'pages'): void => {
  for (const handler of listeners.get(scope) ?? []) handler();
};

describe('a nudge is answered once', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    for (const key of [
      'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
      'Event', 'requestAnimationFrame', 'cancelAnimationFrame',
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
  });

  async function wait(ms: number): Promise<void> {
    const { act } = await import('react');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  /** A component that counts, and re-renders on demand. */
  async function mount(client: unknown): Promise<() => Promise<void>> {
    calls = 0;
    const { createElement, useState } = await import('react');
    const { useNudge } = await import('../src/hooks/useNudge.ts');
    let rerender: (() => void) | null = null;
    const Probe = (): null => {
      const [, setTick] = useState(0);
      rerender = () => setTick((n) => n + 1);
      // A fresh closure every render, which is what every real caller passes.
      useNudge(client as never, 'pages', () => {
        calls += 1;
      });
      return null;
    };
    await render(null);
    await render(createElement(Probe));
    const { act } = await import('react');
    return async () => {
      await act(async () => {
        rerender?.();
      });
    };
  }

  test('a burst is one answer', async () => {
    await mount(fakeClient());

    for (let at = 0; at < 8; at++) nudge();
    await wait(400);

    assert.equal(calls, 1);
  });

  test('and the window reopens', async () => {
    /*
     * The failure the coalescing can hide, and the one worth a test of its own:
     * a latch that never reopens is indistinguishable from a push that works
     * until the second change — by which point somebody has concluded the
     * feature is unreliable rather than absent.
     */
    await mount(fakeClient());

    nudge();
    await wait(400);
    nudge();
    await wait(400);

    assert.equal(calls, 2);
  });

  test('a re-render does not resubscribe, and does not drop a pending answer', async () => {
    /*
     * Every caller passes a closure over its own state, so the handler's
     * identity changes on most renders. Listing it as a dependency would tear
     * the subscription down and build it again — and take the open window with
     * it, so a nudge followed by a render would be a nudge that vanished.
     */
    const rerender = await mount(fakeClient());
    assert.equal(subscriptions, 1);

    nudge();
    await rerender();
    await rerender();
    await wait(400);

    assert.equal(subscriptions, 1, 'still the one subscription');
    assert.equal(calls, 1, 'and the answer survived the renders');
  });

  test('the newest handler is the one called', async () => {
    // The other half of not resubscribing: a handler held from the first render
    // would close over that render's state for ever, which is the bug people
    // reach for the dependency array to avoid.
    const seen: number[] = [];
    const { createElement, useState } = await import('react');
    const { useNudge } = await import('../src/hooks/useNudge.ts');
    const client = fakeClient();
    let bump: (() => void) | null = null;

    const Probe = (): null => {
      const [count, setCount] = useState(0);
      bump = () => setCount((n) => n + 1);
      useNudge(client as never, 'pages', () => seen.push(count));
      return null;
    };
    await render(null);
    await render(createElement(Probe));

    const { act } = await import('react');
    await act(async () => {
      bump?.();
    });
    nudge();
    await wait(400);

    assert.deepEqual(seen, [1], 'the state as of the latest render');
  });

  test('nothing happens without a connection', async () => {
    // The value on the first render of every session.
    await mount(null);
    await wait(400);
    assert.equal(calls, 0);
  });
});
