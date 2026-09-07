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

/**
 * What the tags request answers, for the test being run.
 *
 * A `let` rather than the constant, because the question these tests ask about
 * the facet is *how many* — and two tags cannot be asked it. Reset in `mount`,
 * so a test that does not care gets the two-tag workspace the rest assume.
 */
let tagList: Array<{
  key: string;
  label: string;
  count: number;
  color: string;
  colorChosen: boolean;
}> = TAGS;

/**
 * A workspace with `many` tags, counts descending in the order given.
 *
 * Named `tag-01`… with the counts *rising*, so the alphabetical order and the
 * order by use are opposite. That is deliberate: a fixture where the two agree
 * cannot tell a cut by use from a cut by whatever the server happened to send
 * first, and the server sends these alphabetically.
 */
const manyTags = (many: number): typeof tagList =>
  Array.from({ length: many }, (_, at) => ({
    key: `tag-${String(at + 1).padStart(2, '0')}`,
    label: `Tag ${String(at + 1).padStart(2, '0')}`,
    count: at + 1,
    color: 'blue',
    colorChosen: false,
  }));

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
        ? { tags: tagList }
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

  async function mount(query: string, tags: typeof tagList = TAGS): Promise<void> {
    asked = [];
    tagList = tags;
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

  /** Every tag button on screen, by the name it shows. */
  const shownTags = (): string[] =>
    [...container.querySelectorAll('.search-facet-tag')].map((one) =>
      (one.querySelector('.search-facet-count')
        ? (one.firstChild?.textContent ?? '')
        : (one.textContent ?? '')
      ).trim(),
    );

  const typeInto = async (selector: string, value: string): Promise<void> => {
    const field = container.querySelector<HTMLInputElement>(selector);
    assert.ok(field, `no field matching ${selector}`);
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(field, value);
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };

  /*
   * The two fields are told apart by what they say they are, not by a class:
   * they are the same control doing the same job in two sections, so a class
   * that existed only to separate them would be a hook with no rule behind it
   * — which `stylesheet.test.ts` forbids, rightly.
   */
  const PEOPLE_FIELD = 'input[aria-label="Find a person"]';
  const TAG_FIELD = 'input[aria-label="Find a tag"]';

  /** Type into the people field — not the tag one, which sits above it. */
  const type = (value: string): Promise<void> => typeInto(PEOPLE_FIELD, value);

  /** Type into the field that finds a tag. */
  const findTag = (value: string): Promise<void> => typeInto(TAG_FIELD, value);

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

  test('a handful of tags are all shown, and nothing asks to be searched', async () => {
    /*
     * The shape the panel already had, and it is right for most workspaces.
     * A field over two tags would be a control whose only purpose is to hide
     * one of them.
     */
    await mount('');
    assert.deepEqual(shownTags(), ['Budget', 'Rechnung 2026']);
    assert.equal(container.querySelector(TAG_FIELD), null, 'and no field');
  });

  test('many tags: twelve are shown, and they are the twelve most used', async () => {
    /*
     * The gap named in ADR-0127 and left open twice since. Every tag was a
     * button, which is fine at ten and a wall at two hundred — the same
     * sentence ADR-0120 wrote about the member list, arriving at the section
     * above it.
     *
     * **Which twelve is a question about use, not about the alphabet.** The
     * server sends them ordered by key (so that the spelling shown is stable),
     * and taking the first twelve of that would hide the tag on four hundred
     * pages because it starts with a W. The fixture's counts rise as its names
     * do, so a cut that got this wrong shows `Tag 01` and this test says so.
     *
     * They are *read* alphabetically, though: which tags deserve the space is
     * a question about use, and the order they are looked through in is a
     * question about names.
     */
    await mount('', manyTags(30));

    const shown = shownTags();
    assert.equal(shown.length, 12, 'twelve, not thirty');
    assert.deepEqual(
      shown,
      ['Tag 19', 'Tag 20', 'Tag 21', 'Tag 22', 'Tag 23', 'Tag 24',
       'Tag 25', 'Tag 26', 'Tag 27', 'Tag 28', 'Tag 29', 'Tag 30'],
    );
  });

  test('and any of the rest is found by typing', async () => {
    /*
     * The field, and not a "show more" that unfolds two hundred buttons: a
     * control that answers the question at ten thousand tags the same way it
     * answers it at thirty. Two characters before anything is offered, like
     * the people field one section down and for the same reason.
     */
    await mount('', manyTags(30));
    assert.equal(shownTags().includes('Tag 05'), false, 'not among the twelve');

    await findTag('t');
    assert.equal(shownTags().includes('Tag 05'), false, 'nor after one character');

    await findTag('tag-05');
    assert.equal(shownTags().includes('Tag 05'), true, 'and then it is there');

    await click(tagButton('Tag 05'));
    assert.deepEqual(asked, ['tag:tag-05']);
  });

  test('a chosen tag is shown whether or not it is one of the twelve', async () => {
    /*
     * **The rule the cut has to obey**, and the panel had already written it
     * one section down about people: *a filter you cannot see is a filter you
     * cannot take off.* A tag ranked thirteenth that somebody has switched on
     * would, under a plain cut, be a filter with no control anywhere — the
     * chip beside the results says it is on and cannot switch it off.
     */
    await mount('tag:tag-03', manyTags(30));

    const chosen = tagButton('Tag 03');
    assert.equal(chosen.getAttribute('aria-pressed'), 'true');

    await click(chosen);
    assert.deepEqual(asked, ['']);
  });

  test('and a tag the workspace list has never heard of is shown too, without a count', async () => {
    /*
     * `tag:` can be typed, a kept search outlives the tag it names — a tag
     * exists only because a page carries it (ADR-0020) — and the list is
     * counted over pages the caller can see, so the same kept search can name
     * a tag that is in one person's list and not in another's.
     *
     * In every one of those the panel showed nothing at all, so the one filter
     * whose control is a button had no button. It is shown by the name the
     * query spells, because that is the only name anyone has for it.
     *
     * **And with no count.** The count means "pages you can see carrying this",
     * which is a number this list does not have for a tag it does not hold. A
     * zero would be an answer rather than the absence of one.
     */
    await mount('tag:entwurf');

    const chosen = tagButton('entwurf');
    assert.equal(chosen.getAttribute('aria-pressed'), 'true');
    assert.equal(chosen.querySelector('.search-facet-count'), null, 'no invented count');

    await click(chosen);
    assert.deepEqual(asked, ['']);
  });

  /** What the folder chooser is showing as its answer. */
  const folderShows = (): string => {
    const select = container.querySelector('select');
    assert.ok(select, 'the folder chooser is there');
    return (select.options[select.selectedIndex]?.textContent ?? '').trim();
  };

  test('the folder chooser shows the folder that is chosen', async () => {
    /*
     * **Live, on the ordinary path.** Choosing "Finanzen" writes `in:finanzen`
     * — the filter is stored lowercased, because `in:` is a case-insensitive
     * name match (ADR-0050) — and the options were the titles as spelt. So the
     * chooser matched nothing, snapped back to "Anywhere", and said the search
     * was not in a folder while the results beside it were.
     *
     * The same failure as the tag one and worse: a tag that is on but not
     * offered shows no control, and this showed a control giving the opposite
     * answer.
     */
    await mount('in:finanzen quartal');
    assert.equal(folderShows(), 'Finanzen');
  });

  test('and a folder name that matches nothing is shown as itself', async () => {
    /*
     * Typed by hand, or kept in a search from before the folder was renamed.
     * "Anywhere" is the one answer that is certainly wrong: the results column
     * says *„in archiv · no such folder"* at the same moment, and two columns
     * about one filter disagreeing is how this codebase keeps finding its own
     * bugs (ADR-0139).
     */
    await mount('in:archiv');
    assert.equal(folderShows(), 'archiv');
  });

  test('and choosing a folder from it narrows the search', async () => {
    // The option's value is what the query stores, so what comes back is the
    // filter and not the spelling on the option.
    await mount('quartal');
    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(select, 'finanzen');
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.deepEqual(asked, ['in:finanzen quartal']);
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
