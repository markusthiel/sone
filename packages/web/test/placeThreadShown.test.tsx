/**
 * A comment about a place whose document is no longer on the page (ADR-0155).
 *
 * The gap ADR-0151 named and left open: *„ein Datei-Anker verrutscht nicht,
 * aber der Block kann verschwinden — dafür braucht der Faden einen eigenen
 * Satz."*
 *
 * A place cannot drift. It names a file whose bytes are fixed and a rectangle in
 * that file's own coordinates, so unlike a comment on text there is no such
 * thing as its subject being rewritten. But the *block* can go — deleted, moved
 * to another page, or switched back to a card — and then the thread sat in the
 * panel quoting a passage with no way to reach it and nothing at all to say why.
 *
 * **Mounted rather than read.** A source test would assert that a prop is
 * passed; the thing worth holding is the sentence a reader gets, which is only
 * true once the panel has the page's own list of what it holds.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

import { en } from '../src/i18n/messages.en.ts';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent',
  'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

/** A page holding one file block, drawn however the caller says. */
function pageWith(file: { id: string; display: string } | null): Y.Doc {
  const doc = new Y.Doc();
  if (file) {
    const block = new Y.XmlElement('file');
    block.setAttribute('id', 'b1');
    block.setAttribute(
      'props',
      JSON.stringify({
        fileId: file.id,
        filename: 'Satzung.pdf',
        category: 'pdf',
        display: file.display,
      }),
    );
    doc.getXmlFragment('content').insert(0, [block]);
  }
  return doc;
}

/** A thread about page three of that file. */
const placeThread = {
  id: 't1',
  from: new Uint8Array(),
  to: new Uint8Array(),
  item: null,
  place: { file: 'f1', page: 3, rects: [[72, 695, 119, 22]] },
  quote: 'Hallo Welt',
  resolved: false,
  createdAt: 0,
  range: null,
  messages: [{ id: 'm1', author: 'u1', text: 'Stimmt die Zahl?', at: 0 }],
};

const actions = {
  threads: [placeThread],
  open: [placeThread],
  detached: [],
  resolved: [],
  start: () => undefined,
  reply: () => undefined,
  setResolved: () => undefined,
  removeOne: () => undefined,
  removeReply: () => undefined,
};

describe('a thread whose document has gone from the page', () => {
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

  /** The panel, drawn against a page that holds whatever the caller says. */
  async function panelOn(doc: Y.Doc): Promise<void> {
    const react = await import('react');
    const { CommentsPanel } = await import('../src/components/CommentsPanel.tsx');
    const { LocaleProvider } = await import('../src/i18n/useT.tsx');

    await render(
      react.createElement(
        LocaleProvider,
        /*
         * `initial`, and the name matters: passing `locale` leaves it
         * undefined, the provider then decides this is not English and fetches
         * the German catalogue — so the first assertion sees English and every
         * later one sees German. Which is how this test lied twice before it
         * told the truth.
         */
        { initial: 'en' },
        react.createElement(CommentsPanel, {
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
          doc,
        } as never),
      ),
    );
    // The assets are read once on mount; a turn of the loop lets that land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const said = (): string => container.textContent ?? '';

  test('says so, instead of quoting a passage nobody can reach', async () => {
    await panelOn(pageWith(null));
    assert.ok(said().includes(en['comment.placeGone']), 'the sentence is there');
    // And the quotation stays. It is the whole of what the thread is about, and
    // losing it would make the conversation unreadable — the same reason a
    // detached text thread keeps its own (ADR-0046).
    assert.ok(said().includes('Hallo Welt'));
  });

  test('and does not say so while the document is being shown', async () => {
    await panelOn(pageWith({ id: 'f1', display: 'full' }));
    assert.ok(!said().includes(en['comment.placeGone']));
  });

  test('a file that is on the page as a card is not a document being shown', async () => {
    /*
     * The third state, and the reason the sentence is about *showing* rather
     * than about the file being gone. Switching a PDF back to a card leaves the
     * file on the page and takes the pages away with it — the marks are not
     * drawn, the passage is not visible, and a reader looking for it is in
     * exactly the position the deleted case puts them in.
     */
    await panelOn(pageWith({ id: 'f1', display: 'card' }));
    assert.ok(said().includes(en['comment.placeGone']));
  });

  test('and another file being shown is not this one', async () => {
    // The set is asked for *this* thread's file, not for whether the page has
    // any document at all.
    await panelOn(pageWith({ id: 'f2', display: 'full' }));
    assert.ok(said().includes(en['comment.placeGone']));
  });

  test('the quotation stops offering to show something it cannot', async () => {
    /*
     * A place thread's quotation button already led nowhere — the page only
     * reveals a thread that has a *range* — so this is half a fix for a
     * long-standing dead control and half a new one. It is disabled where there
     * is provably nothing to reach, and left alone where a later round will
     * make it scroll to the mark.
     */
    await panelOn(pageWith(null));
    const quote = container.querySelector('.comment-quote') as HTMLButtonElement;
    assert.equal(quote.disabled, true);

    await panelOn(pageWith({ id: 'f1', display: 'full' }));
    const shown = container.querySelector('.comment-quote') as HTMLButtonElement;
    assert.equal(shown.disabled, false);
  });
});
