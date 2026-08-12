// 8 Seconds Ride Management — Service Worker v1.9.32.34
// Network-first: always fetch fresh. Cache is offline-only fallback.
// Bump CACHE_VERSION on every release to force all clients to update instantly.
const CACHE_VERSION = 'rides-0.1.0';

self.addEventListener('install', () => {
  self.skipWaiting(); // activate new SW immediately
});

self.addEventListener('activate', e => {
  // Wipe ALL old caches on every deploy
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch (_) {}

  const title   = data.title || '8 Seconds Ride Management';
  const options = {
    body:    data.body  || '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data:    { url: data.url || '/' },
    actions: [{ action: 'open', title: 'Open App' }],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';

  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept API calls — always hit the network
  if (url.pathname.startsWith('/api/')) return;

  // Never intercept cross-origin (fonts, CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // config.js and sw.js must NEVER be served stale — force a fresh,
  // cache-bypassing network fetch so version updates always propagate.
  const alwaysFresh = url.pathname === '/js/config.js' || url.pathname === '/sw.js';
  const request = alwaysFresh ? new Request(e.request, { cache: 'no-store' }) : e.request;

  e.respondWith(
    fetch(request)
      .then(res => {
        if (!alwaysFresh && e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
