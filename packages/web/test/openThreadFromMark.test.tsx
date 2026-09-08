/**
 * Clicking a comment in the writing opens it in the panel (ADR-0168).
 *
 * > Kann man es so bauen dass wenn ich drauf klicke, dass dann die Seitenleiste
 * > rechts sich öffnet und automatisch auf die Kommentare springt und den
 * > gewählten kommentar hervorhebt? Also gerade umgekehrt auch, was wir schon
 * > für Links und co gebaut hatten.
 *
 * Three components answer that, and none of them can reach the others: the
 * shell owns whether the panel is open, the strip owns which tab it shows, the
 * panel owns which thread is lit. So one named event and three listeners, the
 * arrangement `sone:reveal-comment` has used since ADR-0046.
 *
 * The panel's half is mounted, because what is worth holding is the card
 * somebody ends up looking at. The other two are read, because what is worth
 * holding there is that the listener exists at all — and each is one line of
 * state that a mounted App would take a hundred lines of scaffolding to reach.
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

const threadNamed = (id: string, text: string) => ({
  id,
  from: new Uint8Array(),
  to: new Uint8Array(),
  item: null,
  place: null,
  quote: text,
  resolved: false,
  createdAt: 0,
  range: null,
  messages: [{ id: `m-${id}`, author: 'u1', text: 'Stimmt die Zahl?', at: 0 }],
});

const FIRST = threadNamed('t1', 'Überblick Räumlichkeiten');
const SECOND = threadNamed('t2', 'Anmeldungen');

const actions = {
  threads: [FIRST, SECOND],
  open: [FIRST, SECOND],
  detached: [],
  resolved: [],
  start: () => undefined,
  reply: () => undefined,
  setResolved: () => undefined,
  removeOne: () => undefined,
  removeReply: () => undefined,
};

describe('the thread the panel lights up', () => {
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
        // `initial`, not `locale` — the name that made another test in this
        // suite pass twice and fail twice (ADR-0159).
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

  const ask = async (id: string): Promise<void> => {
    await act(async () => {
      dom.window.dispatchEvent(
        new dom.window.CustomEvent('sone:open-thread', { detail: id }),
      );
    });
  };

  const foundIds = (): string[] =>
    [...container.querySelectorAll('.comment-thread[data-found]')].map(
      (card) => card.getAttribute('data-thread') ?? '?',
    );

  test('the one that was clicked, and only that one', async () => {
    await panel();
    await ask('t2');
    assert.deepEqual(foundIds(), ['t2']);
  });

  test('asking for another moves the light rather than adding one', async () => {
    // A card that stayed lit would make the second click look like nothing
    // happened, which is the sentence this mechanism was built around
    // (ADR-0156).
    await panel();
    await ask('t1');
    await ask('t2');
    assert.deepEqual(foundIds(), ['t2']);
  });

  test('every card says which thread it is, so the light can be aimed', async () => {
    // The panel and the writing already agree on thread ids — the mark carries
    // `data-thread` because ADR-0046 put it there. This is the same name on the
    // other side of the page.
    await panel();
    assert.deepEqual(
      [...container.querySelectorAll('.comment-thread')].map((card) =>
        card.getAttribute('data-thread'),
      ),
      ['t1', 't2'],
    );
  });

  test('an id no thread carries lights nothing', async () => {
    // A thread resolved or deleted between the click and the render is an
    // ordinary race, not a fault.
    await panel();
    await ask('nobody');
    assert.deepEqual(foundIds(), []);
  });
});

describe('the two components that only open the door', () => {
  test('the shell opens the panel, and both shells do', () => {
    // Both: a shared link has its own shell with its own panel state, and a
    // comment mark is drawn there too whenever the link carries comments.
    const app = codeOf(new URL('../src/App.tsx', import.meta.url));
    const listeners = app.match(/window\.addEventListener\(OPEN_THREAD_EVENT, open\)/g) ?? [];
    assert.equal(listeners.length, 2, 'the workspace and the shared link');
  });

  test('the strip brings the comments forward, when it has them', () => {
    /*
     * `PAGE_TABS` deliberately withholds `comments` from a shared link
     * (ADR-0114). Switching to a tab the strip does not draw is a heading with
     * nothing under it — which is the fault the stored-tab clamp already exists
     * to prevent, arriving from the other side.
     */
    const sidebar = codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url));
    assert.match(sidebar, /if \(!tabs\.includes\('comments'\)\) return undefined;/);
    assert.match(sidebar, /const show = \(\): void => setTab\('comments'\);/);
  });

  test('and the editor is what noticed the click', () => {
    // The mark is drawn by the editor, so only the editor can tell a click on
    // marked words from a click on the words beside them.
    const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
    assert.match(surface, /commentMarks\(\s*\n\s*\(\) => threadsRef\.current,\s*\n\s*\(\) => markStyleRef\.current,\s*\n\s*askForThread,/);
  });
});
