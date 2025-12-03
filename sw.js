// sw.js - simple cache-first service worker for JH Piano Tuner

const CACHE_NAME = "jh-piano-tuner-v1";
const URLS_TO_CACHE = [
  "/jh-piano-tuner/",
  "/jh-piano-tuner/index.html",
  "/jh-piano-tuner/style.css",
  "/jh-piano-tuner/tuner.js",
  "/jh-piano-tuner/manifest.webmanifest"
  // Add icons when you have them:
  // "/jh-piano-tuner/icons/icon-192.png",
  // "/jh-piano-tuner/icons/icon-512.png"
];

// Install: pre-cache core assets
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

// Handle "update now" message from the page
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Activate: clean old caches and take control
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

  // Take control of all open clients immediately
  return self.clients.claim();
});

// Fetch: cache-first strategy
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then(response => {
      if (response) {
        return response;
      }

      return fetch(request).then(networkResponse => {
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
