/**
 * Choosing from a list that belongs to a field, with the keyboard (ADR-0142).
 *
 * Seven places in this application put a list under a text field: the person
 * picker on the members screen, the two fields in the search panel, the tag
 * field in the properties panel, the `@` menu in a comment, the `@` menu in
 * the editor, and the `[[` page picker beside it (ADR-0173).
 *
 * **Two of them had the keys and none of the words; one had all the words and
 * none of the keys.** The mention menus move a highlight with the arrows and
 * take it with Enter, and tell a screen reader nothing about it. The person
 * picker says `role="combobox"`, `aria-expanded`, `aria-controls`,
 * `role="listbox"`, `role="option"`, `aria-selected` — the whole contract — and
 * then has no arrow keys, no active option, and an Enter that submits whatever
 * raw text is in the field.
 *
 * So this file holds the rule in two shapes: the source rules that say a
 * declared list is a real one, and the behaviour at the two call sites where
 * getting it wrong costs something concrete.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

const componentsDir = new URL('../src/components/', import.meta.url);
const components = readdirSync(componentsDir).filter((name) => /\.tsx$/.test(name));
const sourceOf = (name: string): string =>
  readFileSync(new URL(name, componentsDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('a list that says what it is, is what it says', () => {
  /*
   * Read off the roles rather than off the prose, and stated as implications:
   * each one is a promise the markup makes to a screen reader, and a promise
   * nothing was computing is the failure this codebase keeps finding
   * (ADR-0135's comment about contrast, ADR-0137's about the focus ring).
   */

  test('a listbox has options in it', () => {
    /*
     * `role="listbox"` says "the children of this are choices". Buttons are not
     * choices; a screen reader reads them as buttons and the count as wrong.
     *
     * Written or spread: `optionProps` is where the role comes from now, and a
     * test that demanded the literal would be asking every list to say it twice.
     */
    for (const name of components) {
      const source = sourceOf(name);
      if (!source.includes('role="listbox"')) continue;
      assert.match(
        source,
        /role="option"|optionProps/,
        `${name} declares a listbox whose items are not options`,
      );
    }
  });

  test('a combobox names the option that is current', () => {
    /*
     * `aria-activedescendant` is the whole of the combobox pattern that is not
     * decoration: focus stays in the field, and this is the only way the field
     * can say *which* option Enter would take. Without it the pattern announces
     * a list and then refuses to say where you are in it.
     */
    for (const name of components) {
      const source = sourceOf(name);
      if (!source.includes('role="combobox"')) continue;
      assert.match(
        source,
        /aria-activedescendant/,
        `${name} declares a combobox that never says which option is current`,
      );
    }
  });

  test('and an active option can be moved', () => {
    /*
     * The other direction, so this cannot be satisfied by writing the attribute
     * and hard-coding it: something has to move the highlight.
     *
     * `setSlashIndex` counts, and is the reason this rule is a list of three
     * names rather than one. The slash menu keeps its index in plugin state
     * because `@sone/editor` must work without React (ADR-0016) — so its keys
     * are in the plugin and the renderer holds the name of who moves them. It
     * is not an exception to this rule; it is where the rule came from.
     */
    for (const name of components) {
      const source = sourceOf(name);
      if (!source.includes('aria-activedescendant')) continue;
      assert.match(
        source,
        /ArrowDown|useChoiceList|setSlashIndex/,
        `${name} has an active option and no way to move it`,
      );
    }
  });

  test('every list under a field goes through the one hook', () => {
    /*
     * The antidote to what was here before: two implementations of the same
     * eleven lines, and four lists with none. A second copy is how the mention
     * menus came to be the only two that worked.
     */
    const usesTheHook = components.filter((name) => sourceOf(name).includes('useChoiceList'));
    assert.deepEqual(
      usesTheHook.sort(),
      [
        'MentionDraftInput.tsx',
        'MentionMenu.tsx',
        // The `[[` page picker (ADR-0173). The seventh list, and the reason
        // this assertion is a census rather than a pattern: a new one has to
        // be added here on purpose, which is the moment to notice whether it
        // went through the hook or grew its own eleven lines.
        'PageLinkMenu.tsx',
        'SearchPanel.tsx',
        'TagEditor.tsx',
        'WorkspaceMembers.tsx',
      ],
      'the seven lists, in six files — the search panel has two',
    );
  });
});

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

const ROLES = [
  { id: 'r-owner', key: 'owner', name: 'Owner', pageLevel: 'admin', rights: [], members: 1, groups: 0 },
  { id: 'r-member', key: 'member', name: 'Member', pageLevel: 'editor', rights: [], members: 0, groups: 0 },
];

const PEOPLE = [
  { id: 'p-anna', displayName: 'Anna Weber', email: 'anna.weber@example.test', member: false },
  { id: 'p-ansgar', displayName: 'Ansgar Roth', email: 'ansgar@example.test', member: false },
];

describe('choosing with the keyboard', () => {
  let calls: Array<{ path: string; body: unknown }> = [];

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

  const setValue = async (field: HTMLInputElement, value: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(field, value);
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };

  const press = async (element: Element, key: string): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    });
  };

  const settle = async (ms = 260): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  async function mountMembers(): Promise<void> {
    calls = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      path: string,
      init?: { body?: unknown },
    ) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const body = path.endsWith('/roles')
        ? { roles: ROLES, rights: [] }
        : path.endsWith('/members')
          ? { members: [] }
          : path.includes('/people?')
            ? // Matched, the way the route matches. A fixture that answers with
              // two people whatever was typed cannot tell "Enter took the
              // highlight" from "Enter submitted the form".
              {
                people: PEOPLE.filter((one) =>
                  one.displayName
                    .toLowerCase()
                    .includes(decodeURIComponent(path.split('q=')[1] ?? '').toLowerCase()),
                ),
              }
            : { invitations: [] };
      return { status: 200, ok: true, text: async () => JSON.stringify(body) };
    };

    const { createElement } = await import('react');
    const { WorkspaceMembers } = await import('../src/components/WorkspaceMembers.tsx');
    await render(null);
    await render(
      createElement(WorkspaceMembers as never, { workspaceId: 'w1', canAdminister: true }),
    );
    await settle(20);
  }

  const personField = (): HTMLInputElement => {
    const field = container.querySelector<HTMLInputElement>('.person-picker input');
    assert.ok(field, 'the person field is there');
    return field;
  };

  test('the person picker takes the highlighted person, not the typed text', async () => {
    /*
     * **The live fault.** The field's own markup invites this: it says
     * `role="combobox"` with a listbox of options, which is a contract in which
     * Enter takes the current option. It had no current option, and Enter ran
     * `add()` — which sends whatever is in the address box, and what is in the
     * address box while somebody is searching by name is *the name*.
     *
     * So typing "an", seeing Anna Weber, and pressing Enter tried to add a
     * member with the address `an`, and the answer came back as an error about
     * an invalid address — about a person who was right there on the screen.
     *
     * **Enter takes the person; the next Enter adds them.** Two keystrokes on
     * purpose: this form exists to confirm *who* before granting anything
     * (ADR-0119), and the sentence naming them appears between the two.
     */
    await mountMembers();
    const field = personField();
    await setValue(field, 'an');
    await settle();

    assert.equal(
      container.querySelectorAll('.person-suggestion').length,
      2,
      'both are offered before any key is pressed',
    );

    await press(field, 'ArrowDown');
    await press(field, 'Enter');
    await settle();

    assert.equal(field.value, 'Ansgar Roth', 'the second, because the highlight was moved');
    assert.match(
      container.querySelector('.person-picked')?.textContent ?? '',
      /Ansgar Roth/,
      'and the screen says who is about to be added',
    );
    assert.equal(
      calls.some((one) => one.path.endsWith('/members') && one.body !== null),
      false,
      'nobody has been added yet',
    );

    await press(field, 'Enter');
    await settle();

    const add = calls.find((one) => one.path.endsWith('/members') && one.body !== null);
    assert.ok(add, 'and now they have');
    assert.equal(
      (add.body as { email: string }).email,
      'ansgar@example.test',
      'by their address, which nobody typed',
    );
  });

  test('and the field says which person that is', async () => {
    // The half a screen reader gets. Without it the pattern announces a list of
    // two and then cannot say which one Enter would take.
    await mountMembers();
    const field = personField();
    await setValue(field, 'an');
    await settle();

    await press(field, 'ArrowDown');
    const active = field.getAttribute('aria-activedescendant');
    assert.ok(active, 'the field names an option');
    const option = container.querySelector(`#${active}`);
    assert.ok(option, 'and the option it names exists');
    assert.equal(option.getAttribute('aria-selected'), 'true');
    assert.match(option.textContent ?? '', /Ansgar Roth/);
  });

  test('with nothing highlighted, Enter still adds a typed address', async () => {
    /*
     * The field takes an address as well as a name, deliberately (ADR-0119):
     * somebody handed an address by mail should not have to search for a name
     * they do not know. Nothing here may take that away — which is why the
     * hook says whether it used the key, and the caller decides the rest.
     */
    await mountMembers();
    const field = personField();
    await setValue(field, 'neu@example.test');
    await settle();

    await press(field, 'Enter');
    await settle();

    const add = calls.find((one) => one.path.endsWith('/members') && one.body !== null);
    assert.ok(add, 'added');
    assert.equal((add.body as { email: string }).email, 'neu@example.test');
  });

  async function mountTags(
    onChange: (tags: string[]) => void,
  ): Promise<HTMLInputElement> {
    const { createElement } = await import('react');
    const { TagEditor } = await import('../src/components/TagEditor.tsx');
    await render(null);
    await render(
      createElement(TagEditor as never, {
        tags: [],
        known: [
          { key: 'meeting', label: 'Meeting', count: 3, color: 'blue', colorChosen: false },
          { key: 'meeting notes', label: 'Meeting notes', count: 1, color: 'blue', colorChosen: false },
        ],
        canEdit: true,
        onChange,
      }),
    );
    const field = container.querySelector<HTMLInputElement>('.tag-input');
    assert.ok(field, 'the tag field is there');
    return field;
  }

  test('the tag field takes the highlighted suggestion on Tab', async () => {
    /*
     * Tab was the only key that reached this list, because the suggestions are
     * buttons and buttons are tabbable — and it was the wrong one. The field
     * adds whatever is in it when it loses focus (deliberately: a field left
     * holding a word looks like the tag failed), so tabbing to a suggestion
     * added the half-typed word **and then** the suggestion.
     *
     * Now Tab means what it means in every other list here: take the highlight.
     * The suggestions are out of the tab order, so the field is one stop and
     * the list is under it.
     */
    const added: string[][] = [];
    const field = await mountTags((tags) => added.push(tags));
    await setValue(field, 'meet');

    await press(field, 'Tab');

    assert.deepEqual(added, [['Meeting']], 'one tag, and it is the suggested spelling');
  });

  test('and Tab out of an empty list still leaves the field', async () => {
    // Nothing highlighted, nothing to take: the key is not the list's, so the
    // field keeps its own meaning for it.
    const added: string[][] = [];
    const field = await mountTags((tags) => added.push(tags));
    await setValue(field, 'zzz');

    await press(field, 'Tab');

    assert.deepEqual(added, [], 'no suggestion was taken');
  });
});
