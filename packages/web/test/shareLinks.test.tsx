/**
 * A link out of a shared page keeps the link (ADR-0113).
 *
 * Reported as: in a shared folder, clicking a subpage **in the sidebar** opens
 * it, and clicking the same subpage **in the folder's own listing** lands on the
 * login screen.
 *
 * The sidebar built `/s/<token>/p/<id>` by hand. `FolderView` called
 * `paths.page()`, which is `/p/<id>/<slug>` — a workspace route, which an
 * anonymous visitor cannot be on, so `App` renders the login screen. The
 * credential was dropped by the link, one click into somebody's document.
 *
 * Mounted rather than read. A source assertion can see that a component calls
 * one function or another; it cannot see what the anchor's href actually says,
 * and the href is the whole of this bug. The same argument `giveAccess` and
 * `workspaceReorder` make.
 *
 * The collection views are in here for a reason: they are page **body** content,
 * so every one of them renders inside a shared page, and every one of them had
 * the same call. They were not what was reported — they are what the report was
 * one example of.
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

const TOKEN = 'tok-abc';

/** A folder with one folder and one page in it. */
const FOLDER = {
  id: 'f1',
  title: 'Video',
  kind: 'folder' as const,
  icon: null,
  lastEditedAt: new Date().toISOString(),
  children: [
    {
      id: 'f2',
      title: 'Material',
      kind: 'folder' as const,
      icon: null,
      lastEditedAt: new Date().toISOString(),
      children: [],
    },
    {
      id: 'p1',
      title: 'Konzept',
      kind: 'page' as const,
      icon: null,
      lastEditedAt: new Date().toISOString(),
      children: [],
    },
  ],
};

const TRAIL = [
  {
    id: 'root',
    title: 'Allgemein',
    kind: 'folder' as const,
    icon: null,
    lastEditedAt: new Date().toISOString(),
    children: [],
  },
];

describe('a link out of a shared page', () => {
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

  /** Mount a folder listing, with or without a share token around it. */
  async function mountFolder({ shared }: { shared: boolean }): Promise<void> {
    const { createElement } = await import('react');
    const { FolderView } = await import('../src/components/FolderView.tsx');
    const { ShareTokenProvider } = await import('../src/routes/pageLink.tsx');

    const view = createElement(FolderView as never, { folder: FOLDER, trail: TRAIL });
    await render(null);
    await render(
      shared ? createElement(ShareTokenProvider as never, { token: TOKEN }, view) : view,
    );
  }

  /** Every href the mounted markup offers. */
  const hrefs = (): string[] =>
    [...container.querySelectorAll('a')].map((one) => one.getAttribute('href') ?? '');

  test('the folder listing links stay inside the link', async () => {
    // The bug, at the place it was reported: the "SEITEN" list under a shared
    // folder. Every anchor, not the interesting ones — a listing that gets the
    // pages right and the folders wrong is the same bug one row down.
    await mountFolder({ shared: true });

    const links = hrefs();
    assert.ok(links.length >= 3, `expected the trail and both children, got ${links.length}`);
    for (const href of links) {
      assert.ok(
        href.startsWith(`/s/${TOKEN}/p/`),
        `a shared folder offered ${href}, which asks for a session`,
      );
    }
    assert.ok(links.includes(`/s/${TOKEN}/p/p1/konzept`), 'the page, with its slug');
    assert.ok(links.includes(`/s/${TOKEN}/p/f2/material`), 'and the folder beside it');
  });

  test('and outside a link they are ordinary page links', async () => {
    // The counterweight. A fix that made every link share-shaped would pass the
    // test above and break the whole workspace.
    await mountFolder({ shared: false });

    assert.deepEqual(hrefs().sort(), ['/p/f2/material', '/p/p1/konzept', '/p/root/allgemein']);
  });

  test('a collection in a shared page links the same way', async () => {
    /*
     * Not what was reported, and the same fault: a collection is page body
     * content, so a shared page holding one renders these rows for a visitor
     * who has no session. Four components had the call; this is the one with a
     * plain row link and no editing surface around it.
     */
    const { createElement } = await import('react');
    const { RelationCell } = await import('../src/components/RelationCell.tsx');
    const { ShareTokenProvider } = await import('../src/routes/pageLink.tsx');

    await render(null);
    await render(
      createElement(
        ShareTokenProvider as never,
        { token: TOKEN },
        createElement(RelationCell as never, {
          pageIds: ['p1'],
          targetCollectionId: 'c1',
          canEdit: false,
          onChange: () => {},
        }),
      ),
    );

    for (const href of hrefs()) {
      assert.ok(href.startsWith(`/s/${TOKEN}/p/`), `a relation offered ${href}`);
    }
  });
});
