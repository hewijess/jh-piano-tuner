// sw.js - simple cache-first service worker for JH Piano Tuner

const CACHE_NAME = "jh-piano-tuner-v1";
const URLS_TO_CACHE = [
  "/jh-piano-tuner/",
  "/jh-piano-tuner/index.html",
  "/jh-piano-tuner/style.css",
  "/jh-piano-tuner/tuner.js",
  "/jh-piano-tuner/manifest.webmanifest"
  // You can add icon files here too when you have them, e.g.:
  // "/jh-piano-tuner/icons/icon-192.png",
  // "/jh-piano-tuner/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

// Activate: clean up old caches if you bump CACHE_NAME
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
});

// Fetch: cache-first strategy for our static assets
self.addEventListener("fetch", event => {
  const request = event.request;

  // Only handle GET
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then(response => {
      if (response) {
        return response; // Cached version
      }

      // Fallback to network and cache it
      return fetch(request).then(networkResponse => {
        // Ignore non-OK or cross-origin that can't be cached
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type !== "basic"
        ) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
