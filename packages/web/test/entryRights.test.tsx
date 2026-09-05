/**
 * What an entry offers, and what it does not (ADR-0095).
 *
 * ADR-0092 named this and left it: *"a **member** with viewer rights on a
 * folder gets the same input and the same three buttons in the workspace,
 * because the page tree carries no per-entry role for the shell to ask."* The
 * route now sends the role it was already computing, and these are the two
 * places the shell asks it — the rule itself, and the menu that hangs off every
 * row.
 *
 * The folder view needed no change and gets no test here: ADR-0092 made its
 * handlers optional so that a caller with nothing to offer cannot pass one, and
 * `components.test.ts` already holds that shape. What was missing was a caller
 * that knew.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { mayEdit, mayManage } from '../src/entryRights.ts';

// --- the rule ---------------------------------------------------------------

describe('what a role allows', () => {
  const entry = (role: string | null, pathOnly = false) =>
    ({ role, pathOnly }) as never;

  test('editing needs editor, and admin has it too', () => {
    assert.equal(mayEdit(entry('viewer')), false);
    assert.equal(mayEdit(entry('commenter')), false, 'commenting is not writing (ADR-0090)');
    assert.equal(mayEdit(entry('editor')), true);
    assert.equal(mayEdit(entry('admin')), true);
  });

  test('handing it to somebody else needs admin', () => {
    /*
     * The one place "can change it" and "can pass it on" genuinely differ: the
     * sharing routes are guarded by `requirePageAdmin`, so an editor may write
     * a page and may not give it away.
     */
    assert.equal(mayManage(entry('editor')), false);
    assert.equal(mayManage(entry('admin')), true);
  });

  test('a page kept only as a path offers nothing at all', () => {
    // It exists so a granted child is reachable (ADR-0026). Both questions have
    // to say no, and the role is null there anyway — the flag is checked as
    // well because a row that is a rung must not depend on one of the two
    // being right.
    assert.equal(mayEdit(entry(null, true)), false);
    assert.equal(mayManage(entry(null, true)), false);
    assert.equal(mayEdit(entry('admin', true)), false, 'even if a role got through');
  });

  test('nothing at all is not something', () => {
    // The tree is empty on the first render of every session.
    assert.equal(mayEdit(null), false);
    assert.equal(mayEdit(undefined), false);
    assert.equal(mayManage(null), false);
  });
});

// --- the menu that hangs off every row --------------------------------------

let dom: JSDOM;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;
let container: HTMLElement;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

describe('the entry menu asks before it offers', () => {
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
    const { act } = await import('react');
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

  /** Mount the menu, opened, with the given rights and kind. */
  async function open(rights: {
    canEdit: boolean;
    canManage: boolean;
    kind?: 'page' | 'folder';
  }): Promise<void> {
    const { createElement } = await import('react');
    const { act } = await import('react');
    const { EntryMenu } = await import('../src/components/EntryMenu.tsx');
    const node = {
      id: 'f1',
      parentPageId: null,
      collectionId: null,
      idx: 'a0',
      title: 'Personalakten',
      role: rights.canManage ? 'admin' : rights.canEdit ? 'editor' : 'viewer',
      icon: null,
      kind: rights.kind ?? 'folder',
      archived: false,
      lastEditedAt: '',
      children: [],
      depth: 0,
    };
    const noop = (): void => {};
    /*
     * Unmounted first, deliberately.
     *
     * The menu keeps its own open/closed state, and React reuses a component
     * instance across renders of the same type — so the second test's click
     * *closed* the menu the first test had opened, and two of four assertions
     * were about an empty panel. It read exactly like a missing menu item.
     */
    await render(null);
    await render(
      createElement(EntryMenu, {
        node: node as never,
        canEdit: rights.canEdit,
        canManage: rights.canManage,
        onChanged: noop,
        onRename: noop,
        onCreate: noop,
        onDelete: noop,
        onStartRename: noop,
        onStartMove: noop,
        onStartMoveToWorkspace: noop,
        onStartExport: noop,
        onStartImport: noop,
        onStartShare: noop,
        onReorder: noop,
        canMoveUp: true,
        canMoveDown: true,
        isFavourite: false,
        onToggleFavourite: noop,
        isWatched: false,
        onToggleWatch: noop,
      } as never),
    );
    // The ⋯ button. The menu is closed until it is pressed, which is also the
    // only way to find out what is in it.
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true }),
      );
    });
  }

  const labels = (): string[] =>
    [...container.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
    );

  const has = (needle: string): boolean =>
    labels().some((one) => one.toLowerCase().includes(needle.toLowerCase()));

  test('a viewer is offered nothing that writes', async () => {
    /*
     * The report, in the place it repeats. Every one of these answers 403, and
     * a control that is always refused is a lie rather than a safeguard.
     */
    await open({ canEdit: false, canManage: false });

    assert.equal(has('rename'), false, 'no rename');
    assert.equal(has('umbenennen'), false);
    assert.equal(has('move'), false, 'no move');
    assert.equal(has('verschieben'), false);
    assert.equal(has('delete'), false, 'no delete');
    assert.equal(has('löschen'), false);
    assert.equal(has('import'), false, 'no import');
    assert.equal(
      container.querySelector('.entry-menu-new'),
      null,
      'and nothing to put inside it',
    );
    assert.equal(
      container.querySelector('.entry-appearance'),
      null,
      'nor an icon to change',
    );
  });

  test('and everything a reader is entitled to anyway', async () => {
    /*
     * The counterweight, and the reason the gate is not simply "hide the menu".
     * Starring is personal, watching is a subscription, exporting is a read —
     * taking those away would be a second bug wearing the first one's clothes.
     */
    await open({ canEdit: false, canManage: false });

    assert.ok(has('export') || has('exportieren'), 'exporting is a read');
    assert.ok(
      container.querySelector('[role="menuitemcheckbox"]'),
      'the star and the bell are still there',
    );
  });

  test('an editor gets the verbs and not the giving away', async () => {
    await open({ canEdit: true, canManage: false });

    assert.ok(has('rename') || has('umbenennen'), 'rename is back');
    assert.ok(container.querySelector('.entry-menu-new'), 'and "new inside this"');
    assert.equal(
      has('share') || has('freigeben') || has('teilen'),
      false,
      'sharing needs admin, which is what requirePageAdmin enforces',
    );
  });

  test('an admin may hand it on', async () => {
    await open({ canEdit: true, canManage: true });
    assert.ok(has('share') || has('freigeben') || has('teilen'));
  });

  test('only a folder offers "new inside this"', async () => {
    /*
     * A page contains nothing (ADR-0019), so offering it there would produce a
     * refusal nobody could have predicted.
     *
     * Moved here from `scale.test.ts`, which asserted the source read
     * `{isFolder && (`. That is a test of where a condition is written, and it
     * broke the moment the condition gained a second term — while the rule it
     * was protecting was untouched. Asked of the rendered menu instead, which
     * is the thing anybody cares about (ADR-0091, ADR-0095).
     */
    await open({ canEdit: true, canManage: false, kind: 'page' });
    assert.equal(container.querySelector('.entry-menu-new'), null);

    await open({ canEdit: true, canManage: false, kind: 'folder' });
    assert.ok(container.querySelector('.entry-menu-new'));
  });

  test('only a page can be marked as a shape to start from', async () => {
    // A folder has no document to copy (ADR-0045). Same move as above: this
    // was `assert.match(menu, /\{!isFolder && \(/)`.
    await open({ canEdit: true, canManage: false, kind: 'folder' });
    assert.equal(has('template') || has('vorlage'), false);

    await open({ canEdit: true, canManage: false, kind: 'page' });
    assert.ok(has('template') || has('vorlage'), 'offered on a page');
  });
});
