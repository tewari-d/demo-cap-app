// Keeps Daymark working offline: answer from the cache at once, refresh the cache in the background.
// A new version therefore shows up on the second launch after it is published.
const CACHE = 'daymark';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const fresh = fetch(event.request)
      .then(response => {
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
      .catch(() => cached || Response.error());
    return cached || fresh;
  }));
});
