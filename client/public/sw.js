// Puuhapatet PWA service worker.
//
// v5 korjaa kaksi vikaa jotka rikkoivat sovelluksen JOKA julkaisussa:
//
// 1. VÄÄRÄN SISÄLLÖN TALLENNUS. Vanha versio tallensi minkä tahansa `res.ok`
//    -vastauksen `.js`/`.css`-osoitteen alle, cache-first, ikuisesti.
//    GitHub Pages vastaa poistettuun palaseen 404:llä (ei siis `res.ok`), mutta
//    Expressin SPA-fallback (server/static.ts) vastasi index.html:llä tilalla
//    200 — ja juuri se HTML jäi välimuistiin JS:n paikalle pysyvästi. Selain:
//    "Importing a module script failed." Nyt sisältötyyppi tarkistetaan ennen
//    tallennusta, ja palvelin on korjattu vastaamaan 404:llä.
//
// 2. IKUINEN VÄLIMUISTINIMI. Nimi ei muuttunut julkaisuissa, joten kertaalleen
//    myrkytetty merkintä säilyi kaikkien tulevien julkaisujen yli. Nimen
//    nostaminen v5:een tyhjentää vanhat, ja `activate` siivoaa muut nimet.
//
// Asiakaspuolen itsekorjaus on client/src/lib/stale-build.ts.

const CACHE = "puuhapatet-v5";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Vastaa vain jos sisältötyyppi täsmää pyydettyyn tiedostopäätteeseen.
 *  HTML-vastaus .js-osoitteeseen tarkoittaa AINA että palaset ovat vanhentuneet
 *  — sitä ei tallenneta eikä tarjoilla uudelleen. */
function bodyMatchesAsset(pathname, res) {
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (pathname.endsWith(".js")) return type.includes("javascript") || type.includes("ecmascript");
  if (pathname.endsWith(".css")) return type.includes("css");
  return true;
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  if (request.url.includes("/api/")) return;
  if (!request.url.startsWith(self.location.origin)) return;

  const url = new URL(request.url);
  const accept = request.headers.get("accept") || "";

  // HTML-dokumentit: aina verkosta, jottei sivu ole koskaan vanhentunut.
  // `cache: "reload"` ohittaa myös selaimen HTTP-välimuistin — GitHub Pages
  // tarjoaa HTML:n max-age=600, joten ilman tätä vanha index.html (ja sen
  // vanhat palasviittaukset) saattoi elää vielä kymmenen minuuttia julkaisun
  // jälkeen.
  if (request.mode === "navigate" || accept.includes("text/html")) {
    e.respondWith(
      fetch(new Request(request, { cache: "reload" }))
        .catch(() => fetch(request))
        .catch(() => caches.match(request))
        // `respondWith` EI saa ratkaista undefinediin: se muuttuisi kovaksi
        // verkkovirheeksi ("ei yhteyttä" -sivu ilman mitään ohjetta). Jos
        // välimuistissakaan ei ole mitään, annetaan oma offline-viesti.
        .then((res) => res || new Response(
          "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
          "<body style=\"font-family:-apple-system,sans-serif;background:#2d5016;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center\">" +
          "<div style=padding:24px><p style=\"font-size:17px;font-weight:700\">Ei verkkoyhteyttä</p>" +
          "<p style=\"opacity:.7;font-size:14px\">Puuhapatet avautuu kun yhteys palaa.</p></div>",
          { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
        ))
    );
    return;
  }

  // Hashatut JS/CSS-palaset: cache-first (sisältö ei koskaan muutu saman nimen
  // alla). Verkosta tullut vastaus tallennetaan VAIN jos se on oikeaa tyyppiä.
  if (url.pathname.match(/\.(js|css)$/) && url.pathname.includes("-")) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok && bodyMatchesAsset(url.pathname, res)) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
          }
          return res;
        });
      })
    );
    return;
  }

  // Muu (kuvat, videot, fontit): verkko ensin, välimuisti varalla.
  e.respondWith(
    fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
      }
      return res;
    }).catch(() => caches.match(request).then((c) => c || Response.error()))
  );
});
