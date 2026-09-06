/**
 * Following a notification into another workspace (ADR-0115).
 *
 * Reported as: clicking a mention only works if you are already in the right
 * workspace, otherwise the page says you have no access to it.
 *
 * The inbox spans workspaces on purpose (ADR-0052) and a page URL names no
 * workspace on purpose (ADR-0016), so the row is a correct link followed on a
 * sync connection bound to somewhere else — and the message it produced said
 * the person had lost access, which was not true and pointed nowhere useful.
 *
 * The mechanism to switch as part of navigating has existed since ADR-0070 for
 * the workspace switcher. The inbox simply never called it.
 *
 * Mounted, because the whole claim is about what a click does to an anchor: a
 * source assertion can see that a handler exists and not that the default was
 * prevented, and "the browser followed the link anyway" is the bug.
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
  'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

const HERE = 'w-here';
const AWAY = 'w-away';

/** Two notifications: one about a page here, one about a page elsewhere. */
const ITEMS = [
  {
    id: 'n-here',
    kind: 'mention' as const,
    excerpt: 'Schau mal drüber',
    createdAt: new Date().toISOString(),
    read: false,
    snoozedUntil: null,
    pageId: 'p-here',
    pageTitle: 'Die Zahlen',
    threadId: 't1',
    workspaceId: HERE,
    workspaceName: 'Hier',
  },
  {
    id: 'n-away',
    kind: 'mention' as const,
    excerpt: 'Und hier auch',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    read: false,
    snoozedUntil: null,
    pageId: 'p-away',
    pageTitle: 'Konzept',
    threadId: 't2',
    workspaceId: AWAY,
    workspaceName: 'Woanders',
  },
];

/** What the mounted screen was asked to do. */
let went: Array<{ workspaceId: string; to: string }> = [];
let removed: string[][] = [];

describe('following a notification', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/inbox',
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

  async function mount(): Promise<void> {
    went = [];
    removed = [];
    const { createElement } = await import('react');
    const { InboxScreen } = await import('../src/components/InboxScreen.tsx');
    await render(null);
    await render(
      createElement(InboxScreen as never, {
        items: ITEMS,
        view: { of: 'all' },
        error: null,
        here: HERE,
        onRead: () => {},
        onSnooze: () => {},
        onReply: async () => {},
        onRemove: (ids: string[]) => removed.push(ids),
        onGoTo: (workspaceId: string, to: string) => went.push({ workspaceId, to }),
      }),
    );
  }

  /** The anchor of the row whose excerpt says this. */
  const rowFor = (text: string): HTMLAnchorElement => {
    const found = [...container.querySelectorAll('a')].find((one) =>
      (one.textContent ?? '').includes(text),
    );
    assert.ok(found, `no row for ${text}`);
    return found as HTMLAnchorElement;
  };

  /** Click it the way a person does, and say whether the browser was stopped. */
  async function click(anchor: HTMLAnchorElement): Promise<boolean> {
    const event = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    await act(async () => {
      anchor.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  test('a row about somewhere else switches, and does not just follow the link', async () => {
    await mount();
    const anchor = rowFor('Und hier auch');
    assert.equal(anchor.getAttribute('href'), '/p/p-away/konzept', 'still a real link');

    const stopped = await click(anchor);

    assert.equal(stopped, true, 'the app’s link interception must not also run');
    assert.deepEqual(went, [{ workspaceId: AWAY, to: '/p/p-away/konzept' }]);
  });

  test('and a row about here is left to the ordinary navigation', async () => {
    /*
     * The counterweight, and it is the important one: switching to the
     * workspace you are already in tears down the sync connection and rebuilds
     * it, so a fix that switched unconditionally would make every notification
     * in the workspace you are looking at reconnect.
     */
    await mount();
    const stopped = await click(rowFor('Schau mal drüber'));

    assert.equal(stopped, false, 'the link is followed the way every other link is');
    assert.deepEqual(went, []);
  });

  test('a modified click is left alone entirely', async () => {
    // Cmd-click opens a tab, which starts its own session and lands in its own
    // workspace. Switching here would move *this* window out from under
    // somebody who asked for a second one.
    await mount();
    const anchor = rowFor('Und hier auch');
    const event = new dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    await act(async () => {
      anchor.dispatchEvent(event);
    });

    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(went, []);
  });

  test('a row can be taken off the list', async () => {
    // There was no way to: reading keeps a row and snoozing brings it back.
    await mount();
    const buttons = [...container.querySelectorAll('button')].filter(
      (one) => one.textContent === 'Remove',
    );
    assert.equal(buttons.length, 2, 'one per awake row');

    await act(async () => {
      buttons[0]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.deepEqual(removed, [['n-here']], 'the row it belongs to, and only that one');
  });
});
