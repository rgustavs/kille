const CACHE_NAME = 'kille-cache-v5';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './css/style.css',
        './js/app.js',
        './js/cards.js',
        './js/game.js',
        './js/importexport.js',
        './js/stats.js',
        './js/store.js',
        './manifest.json',
        './assets/icons/history.jpg',
        './assets/icons/new_game.jpg',
        './assets/icons/players.jpg',
        './assets/icons/stats.jpg',
        './assets/cards/harlekin.png',
        './assets/cards/kuku.png',
        './assets/cards/husar.png',
        './assets/cards/kavall.png',
        './assets/cards/husu.png',
        './assets/cards/vardshus.png',
        './assets/cards/kransen.png',
        './assets/cards/blompotten.png',
        './assets/cards/blaren.png'
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
