/**
 * Narrowing a search with controls instead of syntax (ADR-0118).
 *
 * The panel edits **filters**; the field edits a **string**; they are the same
 * search. So every control here parses what is in the field, changes one thing,
 * and writes it back through `buildSearchQuery` — never composing `tag:` on its
 * own, which would be a second writer of a syntax core already owns.
 *
 * Mounted, because that round trip is the whole component: a source assertion
 * can see `buildSearchQuery` imported and not that pressing a tag kept the
 * words beside it. The syntax itself is decided in `@sone/core`'s
 * `searchQuery.test.ts`.
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

const ME = 'u-me';

const TAGS = [
  { key: 'budget', label: 'Budget', count: 4, color: 'blue', colorChosen: false },
  { key: 'rechnung 2026', label: 'Rechnung 2026', count: 2, color: 'green', colorChosen: false },
];

const MEMBERS = [
  { userId: ME, displayName: 'Markus', email: 'm@example.test', role: 'admin' },
  { userId: 'u-anna', displayName: 'Anna Weber', email: 'a@example.test', role: 'member' },
];

const SAVED = [{ id: 's1', name: 'Offene Rechnungen', query: 'tag:budget offen' }];

const FOLDERS = [
  {
    id: 'f1',
    title: 'Finanzen',
    kind: 'folder' as const,
    children: [],
    depth: 0,
    idx: 'a0',
    parentPageId: null,
    icon: null,
    role: 'admin',
    archived: false,
    lastEditedAt: new Date().toISOString(),
  },
];

/** Every query the panel asked for, in order. */
let asked: string[] = [];

describe('the search panel', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/search',
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
    (globalThis as unknown as { fetch: unknown }).fetch = async (path: string) => {
      const body = path.endsWith('/tags')
        ? { tags: TAGS }
        : path.endsWith('/members')
          ? { members: MEMBERS, viewerRole: 'admin' }
          : { searches: SAVED };
      return { status: 200, ok: true, text: async () => JSON.stringify(body) };
    };

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

  async function mount(query: string): Promise<void> {
    asked = [];
    const { createElement } = await import('react');
    const { SearchPanel } = await import('../src/components/SearchPanel.tsx');
    await render(null);
    await render(
      createElement(SearchPanel as never, {
        workspaceId: 'w1',
        query,
        onQuery: (next: string) => asked.push(next),
        folders: FOLDERS,
        userId: ME,
      }),
    );
    // The three lists arrive over fetch.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  const tagButton = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('.search-facet-tag')].find((one) =>
      (one.textContent ?? '').startsWith(label),
    );
    assert.ok(found, `no tag ${label}`);
    return found as HTMLButtonElement;
  };

  /** The people row saying this, or undefined — it may not be offered yet. */
  const rowFor = (text: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('.search-facet-row')].find(
      (one) => (one.textContent ?? '').trim() === text,
    ) as HTMLButtonElement | undefined;

  /** Type into the people field. */
  const type = async (value: string): Promise<void> => {
    const field = container.querySelector<HTMLInputElement>('.search-facet-input');
    assert.ok(field, 'the people field is there');
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(field, value);
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };

  const rowSaying = (text: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll('.search-facet-row')].find(
      (one) => (one.textContent ?? '').trim() === text,
    );
    assert.ok(found, `no row ${text}`);
    return found as HTMLButtonElement;
  };

  const click = async (element: Element): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };

  test('pressing a tag narrows the search and keeps the words', async () => {
    // The whole point of the panel: somebody who does not know that `tag:`
    // exists can still narrow a search, and what they typed survives it.
    await mount('quartal prüfen');
    await click(tagButton('Budget'));

    assert.deepEqual(asked, ['tag:budget quartal prüfen']);
  });

  test('and pressing it again widens it back', async () => {
    // A filter with no way off is a mode somebody gets stuck in — the same
    // rule the contributor highlight follows.
    await mount('tag:budget quartal');
    assert.equal(tagButton('Budget').getAttribute('aria-pressed'), 'true', 'and it shows as on');

    await click(tagButton('Budget'));

    assert.deepEqual(asked, ['quartal']);
  });

  test('a tag whose name has a space comes back quoted', async () => {
    // Written through `buildSearchQuery` rather than assembled here, which is
    // the one case a template string at this call site would get wrong.
    await mount('');
    await click(tagButton('Rechnung 2026'));

    assert.deepEqual(asked, ['tag:"rechnung 2026"']);
  });

  test('a person is found by typing, not picked from a list', async () => {
    /*
     * The list was every member, one row each — fine at four and unusable at
     * forty (ADR-0120). A field that filters as you type has the same first
     * keystroke either way and does not grow.
     *
     * Two characters before anything is offered, like the picker on the members
     * screen: one letter matching half a workspace is a list again.
     */
    await mount('');
    assert.equal(rowFor('By Anna Weber'), undefined, 'nothing is offered unasked');

    await type('a');
    assert.equal(rowFor('By Anna Weber'), undefined, 'nor after one letter');

    await type('an');
    const found = rowFor('By Anna Weber');
    assert.ok(found, 'and then she is there');
    await click(found);

    assert.deepEqual(asked, ['author:"anna weber"']);
  });

  test('somebody already chosen stays visible, and can be taken off', async () => {
    // A filter you cannot see is a filter you cannot remove — and the field
    // that chose them is empty again by then.
    await mount('author:"anna weber"');
    const chosen = rowFor('By Anna Weber');
    assert.ok(chosen, 'shown above the field');

    await click(chosen);
    assert.deepEqual(asked, ['']);
  });

  test('and being assigned something is still one press', async () => {
    // Two different questions about the same person, and the syntax already
    // told them apart (ADR-0050, ADR-0052) with no way to ask either but typing.
    await mount('');
    await click(rowSaying('Assigned to you'));
    assert.deepEqual(asked, [`assigned:${ME}`]);
  });

  test('clearing the filters keeps what was typed', async () => {
    /*
     * Two intentions on one button otherwise. Somebody pressing "clear filters"
     * over a narrowed search means "widen this", not "start again" — and losing
     * the words would be the second reading, silently.
     */
    await mount('tag:budget author:markus after:2026-01-01 quartal prüfen');
    const clear = container.querySelector('.search-facet-clear');
    assert.ok(clear, 'offered, because something is set');

    await click(clear);

    assert.deepEqual(asked, ['quartal prüfen']);
  });

  test('with nothing set there is nothing to clear', async () => {
    await mount('quartal');
    assert.equal(container.querySelector('.search-facet-clear'), null);
  });

  test('a kept search is run whole, filters and words together', async () => {
    // It moved here from inside the screen, where it sat under an empty field
    // and vanished the moment anybody typed (ADR-0118).
    await mount('etwas anderes');
    const saved = container.querySelector('.saved-search');
    assert.ok(saved, 'the kept searches are in the panel now');

    await click(saved);

    assert.deepEqual(asked, ['tag:budget offen']);
  });
});
