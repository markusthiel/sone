/**
 * The switch for notifications on this device (ADR-0180).
 *
 * Four states, and what the interface draws follows from which one it is. Two
 * of them cannot be told apart by asking the browser alone, which is the part
 * worth tests:
 *
 *   - a subscription this browser has and the **server does not** is off, not
 *     on. It would never arrive, and a switch that says on while nothing comes
 *     is worse than one that says off.
 *   - a server that cannot be reached is off for the same reason: the honest
 *     answer is "we do not know that this works".
 *
 * Everything here runs against a browser made of objects. The real ones are a
 * push service and a permission prompt, neither of which a test can have — but
 * every rule in `push.ts` is a rule about *order* and about *which answer wins*,
 * and those are statable without one.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { api } from '../src/api/client.ts';
import { pushState, switchOn, switchOff } from '../src/lib/push.ts';

/** A key with both characters base64url has and base64 does not, unpadded. */
const KEY = 'BFx-abc_123';

interface FakeSubscription {
  endpoint: string;
  unsubscribe: () => Promise<boolean>;
}

interface Browser {
  /** What `pushManager.getSubscription()` answers. */
  subscription?: FakeSubscription | null;
  /** Left out to be a browser without push at all — an iPad Safari tab. */
  push?: boolean;
  permission?: NotificationPermission;
  /** What the prompt answers, if it is reached. */
  asked?: NotificationPermission;
  /** Registering the worker throws, which some browsers do in private mode. */
  noWorker?: boolean;
}

const events: string[] = [];
let made: { userVisibleOnly?: boolean; applicationServerKey?: ArrayBuffer } | null = null;

function browser(shape: Browser): void {
  const subscription = shape.subscription ?? null;
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async (options: { userVisibleOnly?: boolean; applicationServerKey?: ArrayBuffer }) => {
      events.push('subscribe');
      made = options;
      return { endpoint: 'https://push.example/new', unsubscribe: async () => true };
    },
  };

  const navigatorLike = {
    serviceWorker: {
      register: async () => {
        if (shape.noWorker) throw new Error('no');
        return { pushManager };
      },
    },
  };

  const windowLike: Record<string, unknown> = { Notification: true };
  if (shape.push !== false) windowLike.PushManager = true;

  Object.defineProperty(globalThis, 'navigator', { value: navigatorLike, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: windowLike, configurable: true });
  Object.defineProperty(globalThis, 'Notification', {
    value: {
      permission: shape.permission ?? 'default',
      requestPermission: async () => {
        events.push('ask');
        return shape.asked ?? 'granted';
      },
    },
    configurable: true,
  });
}

/** What the server answers, and what it is told. */
function server(options: { endpoints?: string[]; broken?: boolean }): void {
  api.pushKey = async () => {
    events.push('key');
    return { key: KEY };
  };
  api.pushSubscriptions = async () => {
    if (options.broken) throw new Error('offline');
    return { endpoints: options.endpoints ?? [] };
  };
  api.pushSubscribe = async (endpoint: string) => {
    events.push(`told ${endpoint}`);
    return { ok: true as const };
  };
  api.pushUnsubscribe = async (endpoint: string) => {
    events.push(`untold ${endpoint}`);
    return { ok: true as const };
  };
}

const here = (endpoint: string): FakeSubscription => ({
  endpoint,
  unsubscribe: async () => {
    events.push('unsubscribe');
    return true;
  },
});

afterEach(() => {
  events.length = 0;
  made = null;
});

describe('the switch for this device', () => {
  test('a browser without push cannot be switched on', async () => {
    // The ordinary case on an iPad: Safari in a tab, not added to the home
    // screen. There is no control to draw, only a sentence saying so.
    browser({ push: false });
    server({});
    assert.equal(await pushState(), 'unsupported');
    assert.equal(await switchOn(), 'unsupported');
    assert.deepEqual(events, []);
  });

  test('and neither can one where registering the worker fails', async () => {
    browser({ noWorker: true });
    server({});
    assert.equal(await pushState(), 'unsupported');
  });

  test('a refusal already given is reported without asking again', async () => {
    /*
     * Asking again does nothing at all, silently — the browser answers denied
     * without showing anybody anything. So the state is read from
     * `Notification.permission`, and the interface says where the way back is.
     */
    browser({ permission: 'denied' });
    server({});
    assert.equal(await pushState(), 'denied');
    assert.deepEqual(events, []);
  });

  test('no subscription in this browser is off', async () => {
    browser({});
    server({ endpoints: ['https://push.example/somebody-else'] });
    assert.equal(await pushState(), 'off');
  });

  test('on means this browser and the server agree', async () => {
    browser({ subscription: here('https://push.example/mine') });
    server({ endpoints: ['https://push.example/mine'] });
    assert.equal(await pushState(), 'on');
  });

  test('a subscription the server has never heard of is off', async () => {
    /*
     * A database restored from before it, or an endpoint the sender deleted as
     * gone. The browser would answer on, and nothing would ever arrive.
     */
    browser({ subscription: here('https://push.example/forgotten') });
    server({ endpoints: [] });
    assert.equal(await pushState(), 'off');
  });

  test('and so is one the server could not be asked about', async () => {
    browser({ subscription: here('https://push.example/mine') });
    server({ broken: true });
    assert.equal(await pushState(), 'off');
  });

  test('switching on asks first, and only then subscribes', async () => {
    /*
     * The order is the rule. A browser refuses a prompt that did not follow a
     * click, and a subscription made before the answer is one somebody did not
     * agree to.
     */
    browser({});
    server({});
    assert.equal(await switchOn(), 'on');
    assert.deepEqual(events, ['ask', 'key', 'subscribe', 'told https://push.example/new']);
  });

  test('a refused prompt subscribes nothing and tells the server nothing', async () => {
    browser({ asked: 'denied' });
    server({});
    assert.equal(await switchOn(), 'denied');
    assert.deepEqual(events, ['ask']);
  });

  test('a prompt dismissed rather than answered leaves it off', async () => {
    // Neither granted nor denied: the person closed it. Off, and the button is
    // still there to press again — which is the one case where asking again
    // does show a prompt.
    browser({ asked: 'default' });
    server({});
    assert.equal(await switchOn(), 'off');
  });

  test('a subscription this browser already has is reused', async () => {
    /*
     * `subscribe` twice is one subscription in every browser that behaves, and
     * a second endpoint in one that does not. The server is told either way,
     * because the row may be what is missing.
     */
    browser({ subscription: here('https://push.example/already') });
    server({});
    assert.equal(await switchOn(), 'on');
    assert.deepEqual(events, ['ask', 'key', 'told https://push.example/already']);
  });

  test('the key reaches the browser as the bytes it wants', async () => {
    /*
     * Base64url, unpadded, with the two characters base64 spells differently —
     * handed over as an `ArrayBuffer` rather than a view of one, because that
     * is what `applicationServerKey` is typed against.
     */
    browser({});
    server({});
    await switchOn();
    assert.ok(made?.applicationServerKey instanceof ArrayBuffer);
    assert.equal(made?.userVisibleOnly, true);
    const bytes = new Uint8Array(made?.applicationServerKey as ArrayBuffer);
    assert.equal(bytes.length, 8);
    assert.equal(bytes[0], 0x04);
  });

  test('switching off tells the server before the browser', async () => {
    /*
     * This order and not the other. A row the server no longer has is a push
     * nobody sends; a subscription cancelled while the row survives is a push
     * to an address that is gone — and the person switched it off.
     */
    browser({ subscription: here('https://push.example/mine') });
    server({});
    assert.equal(await switchOff(), 'off');
    assert.deepEqual(events, ['untold https://push.example/mine', 'unsubscribe']);
  });

  test('and reports off even when the browser will not let go', async () => {
    browser({
      subscription: {
        endpoint: 'https://push.example/stuck',
        unsubscribe: async () => {
          throw new Error('no');
        },
      },
    });
    server({});
    assert.equal(await switchOff(), 'off');
    assert.deepEqual(events, ['untold https://push.example/stuck']);
  });

  test('switching off with nothing subscribed is quiet', async () => {
    browser({});
    server({});
    assert.equal(await switchOff(), 'off');
    assert.deepEqual(events, []);
  });
});
