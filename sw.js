// GiadaCourses Service Worker v7.2 — fix reload loop
const CACHE_NAME = 'giadacourses-v72';

const PRE_CACHE = ['/'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRE_CACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
     .then(() => self.clients.matchAll({ type: 'window' }).then(clients => {
       clients.forEach(c => c.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME }));
     }))
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  let url;
  try { url = new URL(request.url); } catch { return; }

  // Always skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // API, uploads, socket.io → ALWAYS network, NEVER cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/socket.io/')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline: server non raggiungibile', offline: true }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        )
      )
    );
    return;
  }

  // Navigation → always network-first so fresh HTML is served
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(resp => {
          if (resp.ok) caches.open(CACHE_NAME).then(c => c.put(request, resp.clone())).catch(() => {});
          return resp;
        })
        .catch(async () => {
          const cached = await caches.match('/');
          if (cached) return cached;
          return new Response(
            '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>📵 Offline</h2><p>Riconnettiti per usare GiadaCourses.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // Static icons/fonts → cache-first
  if (url.pathname.match(/\.(png|jpg|webp|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then(cached => cached ||
        fetch(request).then(resp => {
          if (resp.ok) caches.open(CACHE_NAME).then(c => c.put(request, resp.clone())).catch(() => {});
          return resp;
        })
      ).catch(() => new Response('', { status: 404 }))
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(resp => {
        if (resp.ok) caches.open(CACHE_NAME).then(c => c.put(request, resp.clone())).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(request).then(c => c || new Response('', { status: 503 })))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
