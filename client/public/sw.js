const CACHE = "puuhapatet-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  // Skip non-GET, API calls, and cross-origin
  if (request.method !== "GET") return;
  if (request.url.includes("/api/")) return;
  if (!request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
        }
        return res;
      });
      // Return cached immediately if available, otherwise wait for network
      return cached || network;
    })
  );
});
