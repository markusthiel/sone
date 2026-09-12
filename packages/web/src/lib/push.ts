/**
 * SONE web — switching notifications on for this device (ADR-0180).
 *
 * Four states, and the interface has to be able to tell them apart because the
 * way out of each is different:
 *
 *   `unsupported`  no service worker or no push — an iPad Safari tab that has
 *                  not been added to the home screen is the ordinary case.
 *   `denied`       the browser was told no, and only its own settings can undo
 *                  that. Asking again does nothing, silently.
 *   `off`          available, not switched on.
 *   `on`           switched on here, and the server agrees.
 *
 * ## Why the server is asked as well
 *
 * A browser knows its own subscription and could answer alone. But a
 * subscription the *server* has forgotten — a database restored from before it,
 * an endpoint it deleted as gone — would then read as on and never arrive. The
 * server is the one that would be sending, so it is the one asked.
 */

import { api } from '../api/client.ts';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

/**
 * Base64url to the bytes `pushManager.subscribe` wants.
 *
 * An `ArrayBuffer` rather than a view of one: `applicationServerKey` is typed
 * against a buffer that cannot be shared, and a `Uint8Array` is a view over one
 * that might be.
 */
function keyBytes(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes.buffer;
}

const possible = (): boolean =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * The worker, registered once.
 *
 * At the root, because that is the scope it needs — and from `/sw.js`, which is
 * copied there verbatim rather than built, so its address does not change with
 * every release. A worker whose address changed would be a second worker.
 */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!possible()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (!possible()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';

  const registration = await worker();
  if (!registration) return 'unsupported';

  const here = await registration.pushManager.getSubscription();
  if (!here) return 'off';

  try {
    const known = await api.pushSubscriptions();
    return known.endpoints.includes(here.endpoint) ? 'on' : 'off';
  } catch {
    // The server could not be asked. Reported as off rather than on: the
    // honest failure is "we do not know that this works", and a switch that
    // says on while nothing arrives is the one thing worse than one that says
    // off.
    return 'off';
  }
}

/**
 * Ask, subscribe, and tell the server.
 *
 * The permission prompt comes first and only from here — a browser refuses one
 * that did not follow a click, and asking on load is how a person says no
 * forever by reflex.
 */
export async function switchOn(): Promise<PushState> {
  if (!possible()) return 'unsupported';

  const allowed = await Notification.requestPermission();
  if (allowed !== 'granted') return allowed === 'denied' ? 'denied' : 'off';

  const registration = await worker();
  if (!registration) return 'unsupported';

  const { key } = await api.pushKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      /*
       * Required by Chrome, and honest here: every push this application sends
       * results in something being shown. A push that showed nothing would be
       * a way to run code on somebody's phone without them knowing, which is
       * why browsers refuse it.
       */
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }));

  await api.pushSubscribe(subscription.endpoint);
  return 'on';
}

/**
 * Stop, on this device.
 *
 * The server first. If the browser's own unsubscribe fails, a row the server no
 * longer has is a push nobody sends; the other order leaves a row that sends to
 * a subscription that is gone, which is a notification somebody switched off
 * still arriving.
 */
export async function switchOff(): Promise<PushState> {
  const registration = await worker();
  const here = await registration?.pushManager.getSubscription();
  if (here) {
    await api.pushUnsubscribe(here.endpoint).catch(() => undefined);
    await here.unsubscribe().catch(() => undefined);
  }
  return 'off';
}
