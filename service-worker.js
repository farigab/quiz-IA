const CACHE_NAME = 'showdo-miau-v3';
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
  globalThis.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  // Delete old caches, take control of clients, and notify them that a new
  // service worker is active so the page can reload and pick up fresh files.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => globalThis.clients.claim())
      .then(() => globalThis.clients.matchAll({ includeUncontrolled: true }))
      .then(clients => {
        for (const client of clients) {
          try { client.postMessage({ type: 'SW_UPDATED' }); } catch (e) { /* best-effort */ }
        }
      })
  );
});

// Allow pages to tell the worker to skipWaiting (useful during manual update flows)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    globalThis.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Treat `config.js` as network-first so configuration changes propagate
  // immediately (avoids needing Ctrl+F5 when deploying config changes).
  if (url.pathname === '/config.js') {
    event.respondWith(
      fetch(req).then(res => {
        caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(resp => resp || new Response('', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
    );
    return;
  }

  // Do not intercept API requests — let them go to network.
  // If offline, return a JSON fallback so callers always get a Response.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok: false, error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Offline-first for app shell and json files
  if (ASSETS.includes(url.pathname) || url.pathname.endsWith('.json')) {
    event.respondWith(
      caches.match(req).then(resp => {
        if (resp) return resp;
        return fetch(req).then(r => {
          caches.open(CACHE_NAME).then(cache => cache.put(req, r.clone()));
          return r;
        }).catch(() => caches.match('/index.html').then(indexResp => indexResp || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
      })
    );
    return;
  }

  // Network-first for everything else, fallback to cache or simple offline Response
  event.respondWith(
    fetch(req).then(res => res).catch(() =>
      caches.match(req).then(resp => resp || caches.match('/index.html').then(indexResp => indexResp || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
    )
  );
});
