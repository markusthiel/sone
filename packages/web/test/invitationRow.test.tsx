/**
 * What an invitation says about itself (ADR-0147).
 *
 * Reported, from the same screenshot as ADR-0146:
 *
 * > Bei Einladungen stehen auch die verbrauchten drin, macht das Sinn? Auch die
 * > Anzahl macht momentan keinen Sinn glaube ich, aber das kann man eventuell
 * > noch gebrauchen wenn man zb beim erstellen der Einladung auch eine maximale
 * > Anzahl an Nutzungen vergibt? Wenn ich nur einen Link anlege mit Einladung
 * > kommt übrigens 25 als zahl. Das lässt sich noch nicht einstellen.
 *
 * Three things, and the number is the one that explains the other two. Nobody
 * chose twenty-five: it was `?? 25` inside the function that makes an
 * invitation, and the row printed it as though somebody had. So the count was
 * a fact about a decision that was never made, and „0 von 25" on a link meant
 * for one person is not a small cosmetic wrong.
 *
 * The server half — what „offen" means, what the default is, and the accept
 * path the twenty-five was hiding — is in `invitations.db.test.ts` and
 * `auth.db.test.ts`. This file is the screen: the form asks, and the row says.
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

type Invitation = Record<string, unknown>;

const invitation = (over: Invitation = {}): Invitation => ({
  id: 'i-1',
  email: 'newcomer@example.org',
  role: 'member',
  uses: 0,
  maxUses: 1,
  expiresAt: '2026-12-01T00:00:00.000Z',
  ...over,
});

describe('an invitation on the screen', () => {
  let listed: Invitation[] = [];
  /** What the last POST carried, so the form's question can be read off it. */
  let posted: Record<string, unknown> | null = null;
  let mailed = false;

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
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      _path: string,
      init?: { method?: string; body?: string },
    ) => {
      if (init?.method === 'POST') {
        posted = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
        return {
          status: 201,
          ok: true,
          text: async () =>
            JSON.stringify({
              token: 'tok',
              invitationId: 'i-new',
              expiresAt: '2026-12-01T00:00:00.000Z',
              mailed,
            }),
        };
      }
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ invitations: listed }),
      };
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

  async function mount(
    element: 'panel' | 'list',
    invitations: Invitation[] = [],
    locale: 'en' | 'de' = 'en',
  ): Promise<void> {
    listed = invitations;
    const { createElement } = await import('react');
    const { InvitePanel } = await import('../src/components/InvitePanel.tsx');
    const { PendingInvitations } = await import('../src/components/PendingInvitations.tsx');
    const { LocaleProvider } = await import('../src/i18n/useT.tsx');
    await render(null);
    await render(
      createElement(
        LocaleProvider as never,
        { initial: locale } as never,
        element === 'panel'
          ? createElement(InvitePanel as never)
          : createElement(PendingInvitations as never, { workspaceId: null } as never),
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

  const textOf = (element: Element | null): string =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const field = (label: string): HTMLInputElement | null =>
    container.querySelector(`input[aria-label="${label}"]`);

  /** The cell that says how the invitation has been used. */
  const useCell = (row = 0): string =>
    textOf(container.querySelectorAll('tbody tr')[row]?.querySelector('.invite-uses') ?? null);

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    const { Event } = dom.window;
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(button: Element): Promise<void> {
    const { MouseEvent } = dom.window;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }

  test('the form asks how often a link may be used', async () => {
    // The number exists in the database and nothing offered it, so every link
    // was made for twenty-five people by a `??` nobody had read.
    await mount('panel');
    const uses = field('How many people may use it');
    assert.ok(uses, 'the field is offered');
    assert.equal(uses.value, '1', 'and one is what it starts at');

    await type(uses, '5');
    await click(container.querySelector('.settings-actions button') as Element);
    assert.deepEqual(posted, { email: null, maxUses: 5 });
  });

  test('and does not ask it about an addressed invitation', async () => {
    /*
     * With an address the invitation is for that person and is used once — the
     * server says so whatever the form sends. A control that cannot change
     * anything is one somebody sets and then wonders about, which is the same
     * argument ADR-0027 made about the administrator checkbox.
     */
    await mount('panel');
    await type(field('Email address') as HTMLInputElement, 'someone@example.org');
    assert.equal(field('How many people may use it'), null);

    await click(container.querySelector('.settings-actions button') as Element);
    assert.deepEqual(posted, { email: 'someone@example.org' });
  });

  test('the count is shown where a count is a fact, and not where it is noise', async () => {
    /*
     * A used-up invitation is not listed any more, so an addressed one on this
     * screen is by definition unused: „0 von 1" says nothing that the row does
     * not already say by being there.
     */
    await mount('list', [
      invitation(),
      invitation({ id: 'i-2', email: null, uses: 2, maxUses: 5 }),
    ]);
    assert.equal(useCell(0), '');
    assert.equal(useCell(1), '2 of 5');
  });

  test('the row is read in the language of the interface', async () => {
    // The column heading and the withdraw button were English on a file that
    // has been on the migrated list since ADR-0041.
    await mount('list', [invitation({ email: null, uses: 1, maxUses: 3 })], 'de');
    const headings = [...container.querySelectorAll('thead th')].map((th) => textOf(th));
    assert.deepEqual(headings, ['Für', 'Benutzt', 'Läuft ab', '']);
    assert.equal(useCell(0), '1 von 3');
    assert.equal(textOf(container.querySelector('tbody td')), 'Jeder mit dem Link');
  });

  test('the panel says whether the invitation was sent, instead of claiming it never is', async () => {
    /*
     * **ADR-0139 again, in a second place.** The panel said, unconditionally:
     *
     * > Send it to the person yourself; this instance does not send mail.
     *
     * The route has been sending that invitation since ADR-0121 and reports
     * `mailed` for exactly this, and the client's type dropped the field. So on
     * every instance with a relay the screen denied a letter that had just gone
     * out — the same shape as the sentence in the empty inbox, found the same
     * way, one round after the rule was written down.
     */
    mailed = true;
    await mount('panel');
    await type(field('Email address') as HTMLInputElement, 'someone@example.org');
    await click(container.querySelector('.settings-actions button') as Element);
    assert.match(textOf(container.querySelector('.invite-created')), /someone@example\.org/);

    mailed = false;
    await mount('panel');
    await click(container.querySelector('.settings-actions button') as Element);
    const said = textOf(container.querySelector('.invite-created'));
    assert.match(said, /not stored anywhere it can be read again/);
    assert.doesNotMatch(said, /does not send mail/);
  });
});
