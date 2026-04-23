// SELF-DESTRUCT GUARD
// If this file is being served as the plain `service-worker.js` (legacy name),
// it means an old client registered it before the versioned SW system was in
// place. Unregister immediately and notify all clients so they reload and pick
// up the new versioned SW registered by the updated app.js.

const IS_VERSIONED = self.location.href.match(/service-worker\.\d+\.js/);

// Workbox injects the versioned precache manifest here at build time.
const WB_PRECACHE = self.__WB_MANIFEST || [];

const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = `showdo-miau-${BUILD_ID}`;

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/questions.json',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  if (!IS_VERSIONED) {
    // Legacy unversioned SW — skip waiting so activate fires immediately.
    self.skipWaiting();
    return;
  }
  self.skipWaiting();
  const precacheUrls = WB_PRECACHE.map(e => (typeof e === 'string' ? e : e.url));
  const allAssets = [...new Set([...ASSETS, ...precacheUrls])];
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(allAssets))
  );
});

self.addEventListener('activate', (event) => {
  if (!IS_VERSIONED) {
    // Self-destruct: unregister and tell all clients to reload.
    event.waitUntil(
      self.registration.unregister()
        .then(() => self.clients.matchAll({ includeUncontrolled: true }))
        .then(clients => clients.forEach(c => {
          try { c.postMessage({ type: 'SW_UNREGISTERED' }); } catch (e) { }
        }))
    );
    return;
  }
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ includeUncontrolled: true }))
      .then(clients => clients.forEach(c => {
        try { c.postMessage({ type: 'SW_UPDATED' }); } catch (e) { }
      }))
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (!IS_VERSIONED) return; // legacy SW — pass all requests through

  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname === '/config.js' || url.pathname === '/config.json') {
    event.respondWith(
      fetch(req).then(res => {
        caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(r => r || new Response('', { status: 503 })))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok: false, error: 'offline' }), {
        status: 503, headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  if (ASSETS.includes(url.pathname) || url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.match(req).then(resp => {
        if (resp) return resp;
        return fetch(req).then(r => {
          caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
          return r;
        }).catch(() => caches.match('/index.html').then(r => r || new Response('Offline', { status: 503 })));
      })
    );
    return;
  }

  event.respondWith(
    fetch(req).catch(() =>
      caches.match(req).then(r => r || caches.match('/index.html').then(r => r || new Response('Offline', { status: 503 })))
    )
  );
});
