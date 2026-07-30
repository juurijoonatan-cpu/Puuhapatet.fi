/**
 * Vanhentuneen buildin itsekorjaus.
 *
 * MIKSI TÄMÄ ON OLEMASSA
 * Frontend julkaistaan GitHub Pagesiin joka main-pushilla
 * (.github/workflows/deploy.yml). Julkaisu KORVAA `dist/public`in, eli edellisen
 * buildin hashatut palaset (`/assets/crew-AbC123.js`) katoavat samalla hetkellä.
 *
 * Sovellus on koodijaettu: `App.tsx` lataa lähes joka reitin `React.lazy`illa.
 * Kun puhelimessa on auki VANHA välilehti (tai asennettu PWA, joka ei sulkeudu),
 * sen `index.html` osoittaa vanhoihin hasheihin. Seuraava reitinvaihto yrittää
 * importata palasen jota ei enää ole:
 *
 *   1. selain pyytää /assets/crew-VANHA.js
 *   2. GitHub Pages vastaa 404:llä (404.html-runko, väärä sisältötyyppi)
 *   3. selain: "Importing a module script failed."
 *   4. ErrorBoundary nappaa sen ja näyttää virhesivun
 *
 * Käyttäjälle tämä näyttää rikkinäiseltä sovellukselta vaikka vika on vain siinä
 * että hänellä on käsissään eilisen versio. Jokainen lazy-reitti on oma
 * palasensa, joten virhe toistuu joka näkymässä — "nyt on paljon virheitä".
 *
 * Korjaus: tunnista NIMENOMAAN tämä virhe, siivoa vanha välimuisti ja lataa
 * sivu kertaalleen uudelleen. Käyttäjä ei näe virhettä lainkaan, vain hetken
 * latauksen. Muut virheet menevät edelleen ErrorBoundarylle sellaisenaan.
 *
 * EI QUERY-PARAMETRIA. Kiertoparametri (`?ppv=…`) olisi houkutteleva tapa
 * varmistaa tuore index.html, mutta se rikkoisi juuri ne näkymät joissa tätä
 * tarvitaan: GitHub Pagesin SPA-kierrätys (public/404.html → `/?p=<polku>`)
 * ajetaan jokaiselle syvälle osoitteelle, joten ylimääräinen parametri palaisi
 * osaksi polkua. Sen sijaan pakotetaan tuore dokumentti `fetch(..., {cache:
 * "reload"})`illa ennen `location.reload()`ia — osoite pysyy koskemattomana.
 */

/** Milloin viimeksi ladattiin uudelleen (ms). Estää luupin, ei toipumista. */
const RELOAD_STAMP = "pp-stale-build-reloaded-at";
/** Kahden itsekorjauksen minimiväli. Näin SAMA välilehti selviää myös toisesta
 *  julkaisusta myöhemmin päivällä — pelkkä kertalukko jätti toisen julkaisun
 *  jälkeen aina raa'an virhesivun. Peräkkäiset yritykset (= oikea luuppi)
 *  torjutaan silti. */
const RELOAD_COOLDOWN_MS = 30_000;

/** Muistivaralukko jos sessionStorage on estetty (privaattitila, ITP). Ilman
 *  tätä lukko puuttuisi kokonaan ja sivu olisi voinut latautua ikuisessa
 *  silmukassa. */
let lastReloadAt = 0;

function readStamp(): number {
  try {
    const v = Number(sessionStorage.getItem(RELOAD_STAMP));
    return Number.isFinite(v) ? Math.max(v, lastReloadAt) : lastReloadAt;
  } catch {
    return lastReloadAt;
  }
}

function writeStamp(now: number): void {
  lastReloadAt = now;
  try { sessionStorage.setItem(RELOAD_STAMP, String(now)); } catch { /* muistilukko riittää */ }
}

/**
 * Onko virhe "moduulia ei voitu ladata" -tyyppinen? Selainten sanamuodot
 * eroavat: Safari sanoo "Importing a module script failed", Chrome "Failed to
 * fetch dynamically imported module", Firefox "error loading dynamically
 * imported module". Vite lisää vielä oman CSS-esilatausvirheensä.
 */
export function isStaleBuildError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null | undefined;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`.trim() || String(err ?? "");
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|dynamically imported module|chunkloaderror|loading chunk \d|unable to preload css|failed to load module script/i.test(text);
}

/**
 * Siivoaa vanhan buildin jäljet ja lataa sivun uudelleen.
 *
 * Palauttaa `false` jos lataus tehtiin juuri (jäähdytysaika kesken) — kutsuja
 * voi silloin näyttää virheen sen sijaan että jäisi ikuiseen latausruutuun.
 *
 * `force` ohittaa jäähdytyksen. Käytä sitä kun KÄYTTÄJÄ painoi nappia: se ei ole
 * luuppi vaan tahallinen valinta, ja silloin välimuisti pitää aina siivota.
 */
export function recoverFromStaleBuild(force = false): boolean {
  const now = Date.now();
  if (!force && now - readStamp() < RELOAD_COOLDOWN_MS) return false;
  writeStamp(now);

  // Poista service worker ja KAIKKI välimuistit ennen latausta. Vanha sw.js
  // tallensi hashatut palaset cache-first ikuisesti, joten pelkkä reload olisi
  // voinut tarjoilla saman vanhan palasen uudelleen.
  const cleanup: Promise<unknown>[] = [];
  try {
    if ("caches" in window) {
      cleanup.push(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
    }
    if ("serviceWorker" in navigator) {
      cleanup.push(navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))));
    }
    // Pakota tuore index.html selaimen HTTP-välimuistiin ennen latausta:
    // GitHub Pages tarjoaa HTML:n max-age=600, ja iOS:n standalone-PWA voi
    // muuten palvella vanhan dokumentin vielä reloadissakin.
    cleanup.push(fetch(window.location.href, { cache: "reload", credentials: "same-origin" }).catch(() => undefined));
  } catch { /* best effort */ }

  const go = () => window.location.reload();
  // Älä jää roikkumaan jos siivous jumittaa — lataa silti.
  const timeout = new Promise<void>((r) => setTimeout(r, 1500));
  void Promise.race([Promise.all(cleanup).then(() => undefined), timeout]).then(go, go);
  return true;
}

/**
 * `React.lazy` joka selviää julkaisusta. Kaksi tasoa:
 *   1. yksi uudelleenyritys pienen viiveen jälkeen — hetkellinen verkkokatko
 *      (nostimessa, hissikuilussa) on paljon yleisempi kuin julkaisu, ja
 *      välitön uusinta osuisi samaan katkoon
 *   2. jos sekään ei onnistu → siivoa välimuisti ja lataa sivu uudelleen
 *
 * Uudelleenlatauksen ajan palautetaan lupaus joka ei ratkea, jolloin Suspense
 * pitää latausanimaation näkyvissä eikä virhesivu välähdä. Jos lataus ei ole
 * mahdollinen (jäähdytys kesken), virhe heitetään eteenpäin ErrorBoundarylle.
 */
export function lazyRetry<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await load();
    } catch (err) {
      if (!isStaleBuildError(err)) throw err;
      await new Promise((r) => setTimeout(r, 600));
      try {
        return await load();
      } catch (again) {
        if (recoverFromStaleBuild()) return new Promise<T>(() => {});
        throw again;
      }
    }
  };
}
