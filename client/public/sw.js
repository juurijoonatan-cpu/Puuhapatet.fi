const CACHE = "puuhapatet-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
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
  if (request.method !== "GET") return;
  if (request.url.includes("/api/")) return;
  if (!request.url.startsWith(self.location.origin)) return;

  const url = new URL(request.url);

  // HTML documents: always network-first so the page is never stale
  if (request.headers.get("accept") && request.headers.get("accept").includes("text/html")) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // JS/CSS assets with hash in filename: cache-first (they never change)
  if (url.pathname.match(/\.(js|css)$/) && url.pathname.includes("-")) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        });
      })
    );
    return;
  }

  // Everything else: network with cache fallback
  e.respondWith(
    fetch(request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
      return res;
    }).catch(() => caches.match(request))
  );
});
