/**
 * Everything this page links to (ADR-0158).
 *
 * Asked for as the answer to a different question — *„Linkleiste in der rechten
 * leiste würde mir reichen"* — and the panel already existed. What it did not do
 * was ask whether an address may be followed, which ADR-0157 had just closed at
 * the two doors a *new* link comes through. A CRDT keeps whatever ever reached
 * it, so a page written earlier can still carry one, and this panel was a second
 * way to click it.
 *
 * Mounted against real documents: the question is what somebody is offered, and
 * whether a row is an anchor or not is exactly the thing a source test would
 * assert wrongly.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';
import * as Y from 'yjs';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'KeyboardEvent', 'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

/** A page whose one paragraph links to each of these addresses. */
function pageLinkingTo(...hrefs: string[]): Y.Doc {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.setAttribute('id', 'b1');
  paragraph.insert(
    0,
    hrefs.map((href) => {
      const text = new Y.XmlText();
      text.insert(0, 'zur Satzung', { link: { href, title: null } });
      return text;
    }),
  );
  doc.getXmlFragment('content').insert(0, [paragraph]);
  return doc;
}

describe('the links panel', () => {
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

  async function panelOn(doc: Y.Doc): Promise<void> {
    const react = await import('react');
    const { LinksPanel } = await import('../src/components/LinksPanel.tsx');
    const { LocaleProvider } = await import('../src/i18n/useT.tsx');
    // `initial`, not `locale` — the name that made another test in this suite
    // pass twice and fail twice (ADR-0159).
    await render(null);
    await render(
      react.createElement(
        LocaleProvider,
        { initial: 'en' },
        react.createElement(LinksPanel as never, { handle: { doc } as never }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const anchors = (): string[] =>
    [...container.querySelectorAll('a.asset-row')].map((a) => a.getAttribute('href') ?? '');
  const rows = (): number => container.querySelectorAll('.asset-row').length;

  test('an ordinary link is a link', async () => {
    await panelOn(pageLinkingTo('https://example.org/satzung'));
    assert.deepEqual(anchors(), ['https://example.org/satzung']);
  });

  test('and it cannot reach back into this window', async () => {
    // `noreferrer` implies it everywhere that matters, and the schema writes
    // the pair on every anchor it renders. A rule written one way here and
    // another way there is a rule nobody can check.
    await panelOn(pageLinkingTo('https://example.org/x'));
    const anchor = container.querySelector('a.asset-row');
    assert.equal(anchor?.getAttribute('rel'), 'noopener noreferrer');
  });

  test('an address that executes is shown and is not a link', async () => {
    /*
     * **The hole this round closes.** ADR-0157 shut `javascript:` at typing and
     * at pasting; it could not shut the documents that already have one, which
     * is why the editor asks again at the moment of following. This panel is a
     * second way to follow one and it was not asking.
     */
    await panelOn(pageLinkingTo('javascript:alert(1)'));
    assert.deepEqual(anchors(), [], 'nothing to click');
    assert.equal(rows(), 1, 'and still listed');
    assert.match(container.textContent ?? '', /cannot be opened/);
  });

  test('the words stay, because the list is of what the page holds', async () => {
    // Omitting it would read as the list being wrong, which is the same
    // argument the file rows make for a file whose upload has not finished.
    await panelOn(pageLinkingTo('javascript:alert(1)'));
    assert.match(container.textContent ?? '', /zur Satzung/);
  });

  test('one bad address does not take the good one with it', async () => {
    await panelOn(pageLinkingTo('javascript:alert(1)', 'https://example.org/gut'));
    assert.deepEqual(anchors(), ['https://example.org/gut']);
    assert.equal(rows(), 2);
  });

  test('every row can be copied, including the refused one', async () => {
    /*
     * Asked for in the same breath as opening: *„zu kopieren usw"*. Offered for
     * a refused address too — copying a string is not following it, and
     * somebody looking at a link they did not expect wants to be able to paste
     * it somewhere and look at it.
     */
    await panelOn(pageLinkingTo('javascript:alert(1)', 'https://example.org/gut'));
    const copies = container.querySelectorAll('button[aria-label="Copy address"]');
    assert.equal(copies.length, 2);
  });
});
