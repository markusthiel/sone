/**
 * The People panel, listing who wrote rather than who looked (ADR-0116).
 *
 * Reported as inconsistent — empty on some pages, one name on others, two on
 * others again. It was perfectly consistent; it was answering a different
 * question than its heading. The mapping it read is written when a document
 * *opens*, so it holds everybody who has had the page open.
 *
 * Mounted rather than read, and this is the round where that matters most: the
 * old source test asserted that the component called `attributionUsers`, which
 * is exactly the wire that was wrong. A test that asserts a wire exists is not
 * a test. What this asserts is which names are on the screen.
 *
 * The document half is in `@sone/core`'s `writers.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

import { DOC_KEYS, USERS_KEY } from '@sone/core';

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

const ANNA = 'u-anna';
const BO = 'u-bo';

const MEMBERS = [
  { userId: ANNA, displayName: 'Anna Weber', email: 'anna@example.test', role: 'member' },
  { userId: BO, displayName: 'Bo Lindqvist', email: 'bo@example.test', role: 'member' },
];

/** Put a client id in the mapping the way opening a page does. */
function record(doc: Y.Doc, userKey: string, clientId = doc.clientID): void {
  const users = doc.getMap(USERS_KEY);
  const existing = users.get(userKey);
  const entry = existing instanceof Y.Map ? existing : new Y.Map();
  if (!(existing instanceof Y.Map)) users.set(userKey, entry);
  const ids = entry.get('ids');
  const list = ids instanceof Y.Array ? ids : new Y.Array<number>();
  if (!(ids instanceof Y.Array)) entry.set('ids', list);
  list.push([clientId]);
}

/** A session that opens the page, and may then write. */
function session(userKey: string): Y.Doc {
  const doc = new Y.Doc();
  record(doc, userKey);
  return doc;
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
}

/** What the panel asked the editor to mark. */
let highlighted: Array<number[] | null> = [];

describe('the People panel', () => {
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
    (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ members: MEMBERS }),
    });

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

  async function mount(doc: Y.Doc): Promise<void> {
    highlighted = [];
    const { createElement } = await import('react');
    const { Contributors } = await import('../src/components/Contributors.tsx');
    // Unmounted first: the chosen person lives in the component, so a second
    // mount over a live one would inherit the previous test's selection.
    await render(null);
    await render(
      createElement(Contributors as never, {
        handle: { doc },
        workspaceId: 'w1',
        onHighlight: (clients: number[] | null) => highlighted.push(clients),
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  /** Every name the panel has drawn. */
  const names = (): string[] =>
    [...container.querySelectorAll('.contributor-name')].map((one) =>
      (one.textContent ?? '').replace('guest', '').trim(),
    );

  const prose = (): string =>
    [...container.querySelectorAll('p')].map((one) => one.textContent ?? '').join(' ');

  test('somebody who only opened the page is not listed', async () => {
    // The report, on screen. Anna types; Bo opens the page and reads it.
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);
    const bo = session(BO);
    sync(anna, bo);

    await mount(anna);

    assert.deepEqual(names(), ['Anna Weber']);
  });

  test('and a rename over HTTP does not add a note about strangers', async () => {
    /*
     * The second half of the report, and the one nobody thought to mention: the
     * note said part of the page was written before it began keeping track, or
     * by somebody who gave no name. A route setting a title writes under its own
     * client id, so one rename made that note appear — on very nearly every
     * page, above a list it was contradicting.
     */
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(anna));
    server.getMap(DOC_KEYS.page).set('title', 'Umbenannt');
    Y.applyUpdate(anna, Y.encodeStateAsUpdate(server, Y.encodeStateVector(anna)));

    await mount(anna);

    assert.deepEqual(names(), ['Anna Weber']);
    assert.doesNotMatch(prose(), /gave no name/);
  });

  test('but somebody the document cannot name is still announced', async () => {
    // The counterweight, and the reason the note exists at all (ADR-0022): a
    // page a share-link visitor had visibly written on looked like a page
    // nobody had written on. Body text, not a title — that is the difference.
    const anna = session(ANNA);
    const stranger = new Y.Doc();
    Y.applyUpdate(stranger, Y.encodeStateAsUpdate(anna));
    stranger.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('von wem?')]);
    sync(anna, stranger);

    await mount(anna);

    assert.match(prose(), /gave no name/);
  });

  test('somebody whose writing has all gone leaves the list', async () => {
    // The same rule pruning has used since ADR-0022, asked when somebody looks
    // rather than whenever a server-side mutation last happened to run — which
    // is why two pages with the same history could list different people.
    const anna = session(ANNA);
    const body = anna.getXmlFragment(DOC_KEYS.content);
    body.insert(0, [new Y.XmlText('etwas')]);
    body.delete(0, 1);

    await mount(anna);

    assert.deepEqual(names(), []);
    assert.match(prose(), /Nobody is recorded yet/);
  });

  test('choosing a writer marks the ids their writing is under', async () => {
    // A filtered list that dropped the ids would be a name nobody can click.
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);
    await mount(anna);

    const button = container.querySelector('button.contributor');
    assert.ok(button, 'a writer is listed');
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.deepEqual(highlighted, [[anna.clientID]]);
  });

  test('every sentence on it is in the catalogue', async () => {
    // ADR-0041. The two below the list were written in English in the source,
    // so the German interface said them in English.
    const anna = session(ANNA);
    anna.getXmlFragment(DOC_KEYS.content).insert(0, [new Y.XmlText('etwas')]);
    await mount(anna);

    const { de } = await import('../src/i18n/messages.de.ts');
    const note = container.querySelector('.panel-note');
    assert.ok(note);
    assert.match(note.textContent ?? '', /who has written here/);
    assert.ok(de['panel.people.choose'], 'and it is translated');
    assert.ok(de['panel.people.marked']);
    assert.ok(de['panel.people.departed']);
  });
});
