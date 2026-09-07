/**
 * The accounts list, as rows that line up (ADR-0146).
 *
 * Reported from an iPad, with a screenshot:
 *
 * > Bei Konten ist noch ein bisschen durcheinander, da könntest du die
 * > checkboxen und Inputs noch strukturieren und überhaupt ordentlich
 * > aufbauen. Auf den anderen Seiten sind die Felder zb rechts.
 *
 * Two faults in one picture. The row put **two switches and two buttons in one
 * wrapping strip** — so a thing that says what somebody *is* and a thing that
 * *does* something to them looked alike and sat wherever the width left room,
 * and nothing lined up from one row to the next. And the strip was written in
 * English on a screen whose file has been on the migrated list since ADR-0041,
 * because the guard there looks for text after a `>` and these labels follow a
 * `{' '}`.
 *
 * So this file asserts the two halves the picture showed: the row's parts are
 * told apart and placed, and the row speaks the interface's language.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

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

type Account = Record<string, unknown>;

const account = (over: Account = {}): Account => ({
  id: 'u-anna',
  email: 'anna@example.test',
  displayName: 'Anna Weber',
  isInstanceAdmin: false,
  canManageWorkspaces: false,
  isGuest: false,
  deactivatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  workspaceCount: 2,
  isSelf: false,
  ...over,
});

describe('the accounts list', () => {
  let listed: Account[] = [];

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
      text: async () => JSON.stringify({ users: listed }),
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

  /** The panel, in a language — German loads its catalogue on demand. */
  async function mount(users: Account[], locale: 'en' | 'de' = 'en'): Promise<void> {
    listed = users;
    const { createElement } = await import('react');
    const { UsersPanel } = await import('../src/components/Admin.tsx');
    const { LocaleProvider } = await import('../src/i18n/useT.tsx');
    await render(null);
    await render(
      createElement(
        LocaleProvider as never,
        { initial: locale } as never,
        createElement(UsersPanel as never),
      ),
    );
    await settle();
  }

  /**
   * Let the render finish, including a catalogue that arrives on demand.
   *
   * A single 20ms wait was enough on this machine and failed once in a full
   * suite run — German is a dynamic import, and a fixed wait for something
   * whose duration is not ours is a test that fails on a loaded runner and
   * nowhere else. Ten short turns instead of one long one.
   */
  async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  }

  const rows = (): HTMLElement[] => [...container.querySelectorAll('.account-row')] as HTMLElement[];
  const textOf = (element: Element | null): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  test('what somebody is and what is done to them are two groups, not one strip', async () => {
    /*
     * The switches decide what an account *is*; the buttons *do* something to
     * it, one of them irreversibly enough to be red. In one flex strip with one
     * gap they were four things of equal weight, and the wrap put them in
     * whatever order the width allowed — which is the "durcheinander".
     */
    await mount([account()]);
    const [row] = rows();
    assert.ok(row, 'the account is listed');

    const rights = row.querySelector('.account-rights');
    const actions = row.querySelector('.account-actions');
    assert.ok(rights && actions, 'the row has both groups');

    assert.equal(rights.querySelectorAll('input[type="checkbox"]').length, 2);
    assert.equal(rights.querySelectorAll('button').length, 0, 'no button among the switches');
    assert.equal(actions.querySelectorAll('input').length, 0, 'no switch among the buttons');
    assert.ok(actions.querySelectorAll('button').length >= 1);
  });

  test('a row with nothing to switch still keeps the column', async () => {
    /*
     * A guest has no rights to give — and if its row simply left the group out,
     * its buttons would slide into the column where every other row's switches
     * are, and the list would look ragged exactly where it was reported ragged.
     * Empty is drawn; it is the alignment.
     */
    await mount([account({ isGuest: true, id: 'u-guest', email: null })]);
    const [row] = rows();
    const rights = row?.querySelector('.account-rights');
    assert.ok(rights, 'the group is there');
    assert.equal(rights.querySelectorAll('input').length, 0, 'and it is empty');
  });

  test('the row speaks the language of the interface', async () => {
    // The screen is on the migrated list and half of this row was English.
    await mount(
      [account({ email: null, workspaceCount: 0, deactivatedAt: '2026-03-01T00:00:00.000Z' })],
      'de',
    );
    const [row] = rows();
    assert.ok(row);

    const labels = [...row.querySelectorAll('.account-rights label')].map((label) => textOf(label));
    assert.deepEqual(labels, ['Administrator', 'Verwaltet Workspaces']);

    const buttons = [...row.querySelectorAll('.account-actions button')].map((button) =>
      textOf(button),
    );
    assert.ok(buttons.includes('Reaktivieren'), `the button reads German: ${buttons.join(' | ')}`);

    const meta = textOf(row.querySelector('.admin-meta'));
    assert.equal(meta, 'keine Adresse · deaktiviert');
  });

  test('the person reading is named as themselves, in their own form of address', async () => {
    // „du" or „Sie" is the instance's choice, and it reaches this row through
    // the same select every other German message uses (ADR-0041).
    await mount([account({ isSelf: true })], 'de');
    assert.ok(textOf(rows()[0]?.querySelector('.admin-name') ?? null).includes('du'));
  });

  test('a workspace is counted in words, not by pasting an s on', async () => {
    await mount([account({ workspaceCount: 1 })]);
    assert.equal(textOf(rows()[0]?.querySelector('.admin-meta') ?? null), 'anna@example.test · 1 workspace');
    await mount([account({ workspaceCount: 3 })]);
    assert.equal(textOf(rows()[0]?.querySelector('.admin-meta') ?? null), 'anna@example.test · 3 workspaces');
  });

  test('the columns belong to the list, so they hold their place down it', () => {
    /*
     * The grid is the list and the rows are `display: contents`. A grid per row
     * would align nothing between rows — each sizes its own tracks, so an
     * account with one button puts its switches 300px from the switches of the
     * account below. That was measured, after a first attempt that looked right
     * in one row and was still ragged in three.
     */
    assert.match(css, /^\.account-list \{[^}]*display: grid/ms);
    assert.match(css, /^\.account-row \{ display: contents; \}/ms);

    // A definite width for the switches, so the column stays where it is when a
    // name is long or a catalogue is translated. And the outer two give in the
    // right order: a name track that may shrink to nothing beside a button
    // track that may not shrink at all is a row whose name disappears first.
    assert.match(
      css,
      /^\.account-list \{[^}]*grid-template-columns: minmax\(14rem, 1fr\) [\d.]+rem minmax\(0, max-content\)/ms,
      'a floor for the name, a track of its own for the switches',
    );

    // The row has no box now, so the rule between accounts is drawn by its
    // cells — and not under the last one.
    assert.match(css, /^\.account-row > \* \{[^}]*border-block-end: 1px solid/ms);
    assert.match(css, /^\.account-row:last-child > \* \{ border-block-end: 0; \}/ms);

    // Stacked where three columns stop fitting — at a width already in the
    // file, rather than at a breakpoint invented for this row. And after
    // the rules it overrides: a media query adds no specificity, and the
    // settings area's own 799px block is five thousand lines earlier.
    const wide = css.indexOf('.account-list {');
    const narrow = css.indexOf('.account-list { display: flex;');
    assert.ok(narrow > wide, 'the narrow rule can win: it is written after the wide one');
    assert.match(
      css.slice(0, narrow),
      /@media \(max-width: 60rem\) \{\s*$/,
      'and it is inside a media query beside what it overrides',
    );
  });

  test('the switches are a column, so a long label cannot shuffle them', () => {
    // Side by side, "Verwaltet Workspaces" wrapping puts the second box on a
    // line of its own and the first one somewhere else. Stacked, they are two
    // rows of one thing.
    assert.match(css, /^\.account-rights \{[^}]*flex-direction: column/ms);
  });
});
