/**
 * Who holds a role, on the card that decides what it means (ADR-0145).
 *
 * The card said *„Eine Person"*. That is an answer to a question nobody asked:
 * what somebody wants before changing what a role means is **whom it affects**,
 * and a number sends them to another screen to turn it into people.
 *
 * The names come with the list now, and only for a caller who may decide who
 * holds a role — the line ADR-0087 drew and this screen had never been asked:
 *
 * > Was eine Rolle bedeutet, festzulegen ist `roles.manage`; wer sie hält, zu
 * > entscheiden ist `people.manage`.
 *
 * So `heldBy` is **absent** for the first and present for the second, and this
 * file is about the difference: absent means "not for you" and empty means
 * "nobody", and one card has to draw both without lying.
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

type Role = Record<string, unknown>;

const role = (over: Role = {}): Role => ({
  id: 'r-red',
  key: null,
  name: 'Redaktion',
  pageLevel: 'editor',
  rights: [],
  members: 0,
  groups: 0,
  ...over,
});

describe('the card says who holds the role', () => {
  let listed: Role[] = [];

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
      text: async () => JSON.stringify({ roles: listed, rights: [] }),
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

  async function mount(roles: Role[]): Promise<void> {
    listed = roles;
    const { createElement } = await import('react');
    const { RolesPanel } = await import('../src/components/RolesPanel.tsx');
    await render(null);
    await render(createElement(RolesPanel as never, { workspaceId: 'w1', canManage: true }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  /** The line under a card that says who holds it. */
  const foot = (): string =>
    (container.querySelector('.role-card-foot .muted')?.textContent ?? '').trim();

  test('by name, where the server was willing to say', async () => {
    await mount([role({ members: 2, groups: 0, heldBy: { people: ['Anna Weber', 'Bert Loos'], groups: [] } })]);
    assert.equal(foot(), 'Anna Weber, Bert Loos');
  });

  test('and a group is one of the holders, not a second kind of answer', async () => {
    // A role is carried by people and by groups, and the question "whom does
    // this affect" does not care which — ADR-0087 put both in one count for the
    // same reason.
    await mount([
      role({ members: 1, groups: 1, heldBy: { people: ['Anna Weber'], groups: ['Redaktion'] } }),
    ]);
    assert.equal(foot(), 'Anna Weber, Redaktion');
  });

  test('the ones that did not fit are counted, not dropped', async () => {
    /*
     * Five names travel; the count is all of them. Subtracting rather than
     * being told again: the card already has the totals, and a second number
     * for the same fact is a second thing that can disagree.
     */
    await mount([
      role({
        members: 8,
        groups: 0,
        heldBy: { people: ['A', 'B', 'C', 'D', 'E'], groups: [] },
      }),
    ]);
    assert.equal(foot(), 'A, B, C, D, E and 3 more');
  });

  test('nobody is still said in words', async () => {
    // Empty is an answer. The sentence for it is older than this round and
    // stays: "0 Personen, 0 Gruppen" is three numbers to read before learning
    // that there is nothing to read.
    await mount([role({ members: 0, groups: 0, heldBy: { people: [], groups: [] } })]);
    assert.equal(foot(), 'Nobody has it yet');
  });

  test('and not knowing is not the same as nobody', async () => {
    /*
     * **The half that matters.** With `roles.manage` and not `people.manage`
     * the names are absent — and a card that read absent as empty would tell
     * somebody a role is unheld when what happened is that they were not told.
     * The count is what they get, which is what they always got.
     */
    await mount([role({ members: 4, groups: 1 })]);
    assert.equal(foot(), '4 people, one group');
  });
});
