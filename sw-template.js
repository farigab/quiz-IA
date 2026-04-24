// Workbox injects the versioned precache manifest here at build time.
const WB_PRECACHE = self.__WB_MANIFEST || [];

const IS_VERSIONED = (typeof __IS_VERSIONED__ !== 'undefined') ? __IS_VERSIONED__ : /service-worker\.\d+\.js/.test(self.location.href);
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = `showdo-miau-${BUILD_ID}`;

const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (!IS_VERSIONED) return; // legacy SW — just skip waiting, don't cache

  const precacheUrls = WB_PRECACHE.map(e => (typeof e === 'string' ? e : e.url));
  const allAssets = [...new Set([...ASSETS, ...precacheUrls])];
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(allAssets))
  );
});

self.addEventListener('activate', (event) => {
  if (!IS_VERSIONED) {
    // SELF-DESTRUCT: unregister legacy SW and tell clients to reload
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
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (!IS_VERSIONED) return; // legacy SW — don't intercept any requests

  const url = new URL(event.request.url);

  // Never intercept API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ ok: false, error: 'offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Network-first for config so updates propagate immediately
  if (url.pathname === '/config.js' || url.pathname === '/config.json') {
    event.respondWith(
      fetch(event.request.clone()).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for questions.json so updated question sets are observed
  if (url.pathname === '/questions.json') {
    event.respondWith(
      fetch(event.request.clone()).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request.clone()).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
