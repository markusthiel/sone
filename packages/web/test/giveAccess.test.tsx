/**
 * Letting somebody in as the role you mean (ADR-0103).
 *
 * The form offered a hardcoded `member | admin | guest`, ten lines above a
 * table that lists **every** role this workspace has, by id, because "a role
 * somebody defined is no less a role" (ADR-0087). Same component, same fetched
 * list, two different answers to what a role is.
 *
 * So the way to let a colleague in as "Redaktion" was to add them as a member —
 * `editor` on every page here — and change it afterwards. An intermediate grant
 * nobody asked for, as a required step, on the screen whose job is to avoid
 * exactly that.
 *
 * Mounted rather than read, for the reason `workspaceReorder` gives: what
 * matters is which request the form produces, and a source assertion cannot see
 * that the id sent is the one that was selected. The server half is in
 * `accessWithARole.db.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

/** Every request the component made, in order. */
let calls: Array<{ path: string; body: unknown }> = [];

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

/** The four system roles and one this workspace made. */
const ROLES = [
  { id: 'r-owner', key: 'owner', name: 'Owner', pageLevel: 'admin', rights: [], members: 1, groups: 0 },
  { id: 'r-admin', key: 'admin', name: 'Admin', pageLevel: 'admin', rights: [], members: 0, groups: 0 },
  { id: 'r-member', key: 'member', name: 'Member', pageLevel: 'editor', rights: [], members: 0, groups: 0 },
  { id: 'r-guest', key: 'guest', name: 'Guest', pageLevel: null, rights: [], members: 0, groups: 0 },
  { id: 'r-red', key: null, name: 'Redaktion', pageLevel: 'editor', rights: [], members: 0, groups: 0 },
];

describe('giving access as any role this workspace has', () => {
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

  /**
   * Mount the members table with a roles list, or without one.
   *
   * `rolesFail` is the case where the fetch genuinely failed. It is not the
   * case where somebody lacks a right: reading the roles takes `roles.manage`
   * **or** `people.manage` (ADR-0087), and `people.manage` is what puts anybody
   * on this screen at all.
   */
  async function mount({ rolesFail = false } = {}): Promise<void> {
    calls = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      path: string,
      init?: { body?: unknown },
    ) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path.endsWith('/roles')) {
        if (rolesFail) return { status: 500, ok: false, text: async () => '{"error":"boom"}' };
        return { status: 200, ok: true, text: async () => JSON.stringify({ roles: ROLES, rights: [] }) };
      }
      if (path.endsWith('/members')) {
        return { status: 200, ok: true, text: async () => JSON.stringify({ members: [] }) };
      }
      return { status: 200, ok: true, text: async () => JSON.stringify({ invitations: [] }) };
    };

    const { createElement } = await import('react');
    const { WorkspaceMembers } = await import('../src/components/WorkspaceMembers.tsx');
    // Unmounted first: the form's selection lives in the component, so a second
    // mount over a live one would inherit the previous test's choice.
    await render(null);
    await render(
      createElement(WorkspaceMembers as never, { workspaceId: 'w1', canAdminister: true }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  /** The picker in the "give access" form — the first select on the screen. */
  const picker = (): HTMLSelectElement => {
    const found = container.querySelector<HTMLSelectElement>('select');
    assert.ok(found, 'the form has a role picker');
    return found;
  };

  const labels = (): string[] =>
    [...picker().querySelectorAll('option')].map((one) => one.textContent ?? '');

  async function submit(address: string): Promise<void> {
    const field = container.querySelector<HTMLInputElement>('input[type="email"]');
    assert.ok(field);
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(field, address);
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const button = [...container.querySelectorAll('button')].find(
      (one) => !(one as HTMLButtonElement).disabled && one.classList.contains('primary'),
    );
    assert.ok(button, 'the give-access button is enabled once there is an address');
    await act(async () => {
      (button as HTMLButtonElement).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  test('the form offers the roles this workspace has', async () => {
    await mount();
    assert.ok(labels().includes('Redaktion'), 'including the one somebody defined');
    assert.ok(labels().includes('Member'), 'and the system ones');
  });

  test('and still does not offer owner', async () => {
    /*
     * ADR-0073: "A second owner is a decision about who may delete the
     * workspace. It stays a separate act on the row."
     *
     * It used to be absent because the list was three words long. Now the list
     * comes from the server and contains owner, so the absence is a decision
     * this screen makes rather than one it inherits — which is exactly when it
     * needs a test.
     */
    await mount();
    assert.ok(!labels().includes('Owner'));
  });

  test('choosing one sends its id, not a word', async () => {
    await mount();
    await act(async () => {
      picker().value = 'r-red';
      picker().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await submit('anna@example.org');

    const post = calls.find((one) => one.body !== null);
    assert.deepEqual(post?.body, { email: 'anna@example.org', roleId: 'r-red' });
  });

  test('and the default is still member', async () => {
    // The word-shaped default meant `member`, and most access given is given as
    // one. What changed is the spelling, and nothing else may.
    await mount();
    await submit('bert@example.org');

    const post = calls.find((one) => one.body !== null);
    assert.deepEqual(post?.body, { email: 'bert@example.org', roleId: 'r-member' });
  });

  test('a failed roles fetch leaves three words rather than an empty picker', async () => {
    /*
     * The fallback, and the reason it is not dead code: a fetch can fail for
     * ordinary reasons, and a form whose job is to add somebody must still be
     * able to add somebody.
     */
    await mount({ rolesFail: true });
    assert.deepEqual(labels(), ['Member', 'Admin', 'Guest']);

    await submit('cara@example.org');
    const post = calls.find((one) => one.body !== null);
    assert.deepEqual(
      post?.body,
      { email: 'cara@example.org', role: 'member' },
      'by word, because there is no id to send',
    );
  });
});
