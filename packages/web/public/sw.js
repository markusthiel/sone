/*
 * SONE — the service worker that shows a notification (ADR-0180).
 *
 * Plain JavaScript in `public/`, copied to the web root verbatim: a service
 * worker's scope is the directory it is served from, and one that arrived at a
 * hashed build path would control that path and nothing else.
 *
 * ## The push carries nothing, so this asks
 *
 * The server sends an empty push. This wakes, asks the instance what is waiting
 * — over the session cookie the browser already has — and draws the newest one.
 *
 * That is the whole reason nothing about a page or a comment passes through
 * Apple's or Google's push service. It costs one request at the moment of
 * waking, which is a moment the device is awake anyway.
 *
 * Nothing here is cached and nothing is intercepted. A service worker that
 * serves the application offline is a different feature with different
 * failures, and this one has no business deciding what a page looks like.
 */

self.addEventListener('install', () => {
  // Take over without waiting for every tab to close: there is no cached
  // application to keep consistent, so an older copy has nothing to protect.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(show());
});

async function show() {
  let waiting = [];
  try {
    const answer = await fetch('/api/inbox?unread=true', {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (answer.ok) {
      const body = await answer.json();
      waiting = Array.isArray(body.notifications) ? body.notifications : [];
    }
  } catch {
    // Offline between the push and the ask, which happens: the device woke on a
    // notification it cannot yet read. Falls through to the quiet form below
    // rather than saying nothing at all — the push is the only signal there is
    // that something happened.
  }

  const newest = waiting[0];
  if (!newest) {
    /*
     * Nothing unread, so somebody has already read it elsewhere.
     *
     * Chrome requires a notification for every push (`userVisibleOnly`) and
     * shows its own if the page shows none, which would be worse than this. So
     * the count is checked first and this is only reached when the fetch failed
     * or the inbox emptied in between.
     */
    const open = await self.clients.matchAll({ type: 'window' });
    if (open.length > 0) return;
    return self.registration.showNotification('SONE', {
      body: 'Es gibt etwas Neues.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'sone-quiet',
    });
  }

  const more = waiting.length - 1;
  return self.registration.showNotification(newest.pageTitle || 'SONE', {
    body:
      more > 0
        ? `${newest.excerpt || ''}\n+${more} weitere`.trim()
        : newest.excerpt || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    /*
     * One notification, replaced rather than stacked.
     *
     * Three mentions in a minute are one thing to look at, and a phone with
     * eleven SONE notifications on it is a phone somebody switches SONE off on.
     */
    tag: 'sone-inbox',
    renotify: true,
    data: { url: newest.pageId ? `/p/${newest.pageId}` : '/inbox' },
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/inbox';
  event.waitUntil(open(url));
});

/**
 * The page, in a window that is already there when there is one.
 *
 * Opening a second window onto an application somebody already has open is how
 * two copies of a document end up side by side — and on a phone it is how the
 * one that was scrolled somewhere gets lost.
 */
async function open(url) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if ('focus' in client) {
      await client.focus();
      if ('navigate' in client) {
        try {
          await client.navigate(url);
        } catch {
          // A window that refuses to be navigated is still a window in front of
          // somebody, which is most of what was wanted.
        }
      }
      return;
    }
  }
  await self.clients.openWindow(url);
}
