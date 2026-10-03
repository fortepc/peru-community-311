const CACHE_NAME = "peru-community-311-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./templates.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((cacheName) => cacheName.startsWith("peru-community-311-") && cacheName !== CACHE_NAME)
      .map((cacheName) => caches.delete(cacheName)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const cachedPage = await caches.match("./index.html");
        if (cachedPage) return cachedPage;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cachedResponse = await caches.match(request, { ignoreSearch: true });
    return cachedResponse || fetch(request);
  })());
});
