const CACHE_VERSION = 'crm-static-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/main.css',
  '/css/login.css',
  '/css/tables.css',
  '/js/api.js',
  '/js/utils.js',
  '/js/sidebar.js',
  '/admin/dashboard.html',
  '/admin/candidates.html',
  '/superadmin/dashboard.html',
  '/superadmin/candidates.html',
  '/superadmin/admins.html',
  '/superadmin/domains.html',
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker with cache version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[SW] Caching', STATIC_ASSETS.length, 'static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Cache pre-population complete');
        self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Install failed:', err);
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    caches.keys()
      .then(keys => {
        console.log('[SW] Cleaning old caches:', keys.filter(k => k !== CACHE_VERSION));
        return Promise.all(
          keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        self.clients.claim();
      })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip API calls
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: try network first, fallback to cached HTML
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Static assets: cache-first strategy with network fallback
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      // Network attempt with fallbacks
      return fetch(req, { signal: AbortSignal.timeout(5000) })
        .then((res) => {
          // Validate response
          if (!res || res.status !== 200 || res.type === 'error') {
            return res;
          }

          // Clone and cache successful responses
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
          return res;
        })
        .catch((err) => {
          console.warn('[SW] Fetch failed for', req.url, '- trying stale cache');
          // Network failed - try any stale version in other caches
          return caches.keys().then(cacheNames => {
            for (const cacheName of cacheNames) {
              if (cacheName === CACHE_VERSION) continue;
              const staleCache = caches.open(cacheName);
              const match = staleCache.then(c => c.match(req));
              if (match) return match;
            }
            
            // Last resort: return blank/minimal response instead of error
            if (req.destination === 'style') {
              console.log('[SW] Returning blank CSS for', req.url);
              return new Response('/* offline */', { headers: { 'Content-Type': 'text/css' } });
            }
            if (req.destination === 'script') {
              console.log('[SW] Returning blank JS for', req.url);
              return new Response('console.log("offline");', { headers: { 'Content-Type': 'text/javascript' } });
            }
            if (req.destination === 'document') {
              console.log('[SW] Returning cached index.html for', req.url);
              return caches.match('/index.html');
            }
            
            console.error('[SW] No fallback available for', req.url);
            return Response.error();
          });
        });
    })
  );
});
