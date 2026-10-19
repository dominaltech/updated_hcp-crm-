// Service Worker for Hotel City Park - Waiter Order Panel PWA
const CACHE_NAME = 'hcp-waiter-cache-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  '/favicon.svg',
  '/pwa-192.png',
  '/pwa-512.png'
];

// Install: Pre-cache core app shell and immediately activate
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate: Delete all previous caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-First strategy ensures fresh code while online, cache while offline
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-http schemes and non-GET requests
  if (!url.protocol.startsWith('http')) return;
  if (req.method !== 'GET') return;

  // 1. Navigation requests (HTML pages) -> Network-First with fallback to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Static assets (JS, CSS, fonts, images) -> Network-First so updates take effect immediately
  const isStatic = url.pathname.endsWith('.js') ||
                   url.pathname.endsWith('.css') ||
                   url.pathname.endsWith('.png') ||
                   url.pathname.endsWith('.svg') ||
                   url.pathname.endsWith('.woff2') ||
                   url.pathname.endsWith('.ttf');

  if (isStatic) {
    event.respondWith(
      fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 3. API GET calls -> Network-First with cache fallback
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Default: Network with Cache fallback
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
