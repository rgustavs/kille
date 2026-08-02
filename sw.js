const CACHE_NAME = 'kille-cache-v23';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './css/style.css',
        './js/app.js',
        './js/analytics.js',
        './js/cards.js',
        './js/config.js',
        './js/dom.js',
        './js/game.js',
        './js/importexport.js',
        './js/remote.js',
        './js/router.js',
        './js/session.js',
        './js/stats.js',
        './js/store.js',
        './js/supabase.js',
        './js/util.js',
        './manifest.json',
        './assets/icons/history.png',
        './assets/icons/import_export.jpg',
        './assets/icons/new_game.png',
        './assets/icons/players.png',
        './assets/icons/stats.png',
        './assets/cards/harlekin.png?v=2',
        './assets/cards/kuku.png?v=2',
        './assets/cards/husar.png?v=2',
        './assets/cards/kavall.png?v=2',
        './assets/cards/husu.png?v=2',
        './assets/cards/vardshus.png?v=2',
        './assets/cards/kransen.png?v=2',
        './assets/cards/blompotten.png?v=2',
        './assets/cards/blaren.png?v=2'
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // We use Stale-while-revalidate strategy for the most robust PWA experience
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Cache the newly fetched response
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            // Only cache http/https requests, avoid chrome-extension etc.
            if (event.request.url.startsWith('http')) {
              cache.put(event.request, responseClone);
            }
          });
        }
        return networkResponse;
      }).catch(async () => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return cachedResponse || new Response('', { status: 503, statusText: 'Offline' });
      });

      return cachedResponse || fetchPromise;
    })
  );
});
