/**
 * Pressing *Kommentieren* brings the comments forward (ADR-0169).
 *
 * > Ja, das mit dem Reiterwechsel solltest du auch gleich machen, danke fürs
 * > finden!
 *
 * The gap ADR-0168 named and did not fix. The anchor is held, the panel opens
 * — and on a remembered tab of `outline` the panel draws the outline, because
 * `CommentsPanel` is rendered only while its own tab is chosen. So the
 * selection somebody just pressed Comment on waits in state with nothing on
 * screen to put words into.
 *
 * The same event answers it, with nothing named: *bring the comments forward*
 * is what all three listeners already do, and only the third one — the thread
 * that lights up — needs an id.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

import { codeOf } from './helpers/source.ts';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent',
  'TouchEvent', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

const thread = {
  id: 't1',
  from: new Uint8Array(),
  to: new Uint8Array(),
  item: null,
  place: null,
  quote: 'Überblick Räumlichkeiten',
  resolved: false,
  createdAt: 0,
  range: null,
  messages: [{ id: 'm-t1', author: 'u1', text: 'Stimmt die Zahl?', at: 0 }],
};

const actions = {
  threads: [thread],
  open: [thread],
  detached: [],
  resolved: [],
  start: () => undefined,
  reply: () => undefined,
  setResolved: () => undefined,
  removeOne: () => undefined,
  removeReply: () => undefined,
};

describe('asking for the comments without naming a thread', () => {
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
    cleanup();
    dom.window.close();
  });

  async function panel(): Promise<void> {
    const react = await import('react');
    const { CommentsPanel } = await import('../src/components/CommentsPanel.tsx');
    const { LocaleProvider } = await import('../src/i18n/useT.tsx');
    await render(null);
    await render(
      react.createElement(
        LocaleProvider,
        { initial: 'en' },
        react.createElement(CommentsPanel as never, {
          comments: actions as never,
          internal: null,
          members: [{ userId: 'u1', displayName: 'Markus Thiel' }] as never,
          canEdit: true,
          canComment: true,
          onReveal: () => undefined,
          pending: null,
          onCancelPending: () => undefined,
          marks: { style: 'highlight', setStyle: () => undefined } as never,
          pageId: 'p1',
          doc: new Y.Doc(),
        } as never),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  test('it is the same channel, and it names nobody', async () => {
    const { OPEN_THREAD_EVENT, showComments } = await import('../src/lib/found.ts');
    const seen: unknown[] = [];
    const heard = (event: Event): void => {
      seen.push((event as CustomEvent<unknown>).detail);
    };
    dom.window.addEventListener(OPEN_THREAD_EVENT, heard);
    showComments();
    dom.window.removeEventListener(OPEN_THREAD_EVENT, heard);
    assert.equal(seen.length, 1, 'one announcement');
    assert.notEqual(typeof seen[0], 'string', 'and no thread named');
  });

  test('so the panel lights nothing', async () => {
    /*
     * The guard was already there — `typeof id !== 'string'` — and this is what
     * it is for now that something dispatches without an id. A card lit for a
     * comment nobody has written yet would be pointing at the wrong thing.
     */
    await panel();
    const { showComments } = await import('../src/lib/found.ts');
    await act(async () => {
      showComments();
    });
    assert.deepEqual([...container.querySelectorAll('.comment-thread[data-found]')], []);
  });

  test('both shells announce it instead of opening the panel themselves', () => {
    /*
     * `setRightOpen(true)` beside a dispatch that also opens the panel would be
     * two paths to one piece of state. The shells already listen — a comment
     * mark opens the panel through exactly that listener (ADR-0168) — so
     * pressing *Kommentieren* goes down the same wire.
     */
    const app = codeOf(new URL('../src/App.tsx', import.meta.url));
    const handlers = app.match(/setPendingComment\(anchor\);\n\s*showComments\(\);/g) ?? [];
    assert.equal(handlers.length, 2, 'the workspace and the shared link');
    assert.doesNotMatch(
      app,
      /setPendingComment\(anchor\);\n\s*setRightOpen\(true\);/,
      'and neither one still opens it by hand',
    );
  });

  test('the strip switches on an event that names nothing', () => {
    /*
     * The listener takes no argument, which is the whole reason one event can
     * serve both directions: a mark click names a thread, pressing Comment
     * names none, and *which tab* does not depend on the difference.
     */
    const sidebar = codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url));
    assert.match(sidebar, /const show = \(\): void => setTab\('comments'\);/);
  });
});
