import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. Asiakkaan seurantalinkki ja tekijän oma näkymä eivät kirjaudu
 * mihinkään: ne tunnistautuvat polussa olevalla tokenilla, ja jokainen reitti
 * tarkistaa sen itse. Siksi jokaisen `/api/gig/:token/…`- ja
 * `/api/crew/:token/…`-reitin PITÄÄ olla `PUBLIC_API`-listalla.
 *
 * MITÄ TAPAHTUI KUN YKSI PUUTTUI: `GET /api/gig/:token/observation-image` oli
 * unohtunut listalta. Portti (routes.ts, `isPublicApi`) vastasi siihen 401.
 * Selaimen puolella 401 tarkoittaa "admin-sessio vanhentui", joten
 * `handleUnauthorized` heitti käyttäjän `/admin/login`-sivulle. Lopputulos:
 * asiakas lisäsi ikkunan kartalleen ja päätyi meidän kirjautumisruudullemme.
 * Piste tallentui, mutta asiakas luuli koko toiminnon hajonneen.
 *
 * Tämä testi lukee reittirekisteröinnit suoraan lähdekoodista ja vaatii, että
 * jokaiselle löytyy listalta osuma. Se ei siis luota siihen että joku muistaa
 * — se lukee saman totuuden josta palvelin ajaa.
 *
 * Jos tämä kaatuu: älä poista reittiä testistä. Joko lisää se `PUBLIC_API`hin
 * (jos se tunnistaa käyttäjän omalla tokenillaan, kuten kaikki muutkin), tai
 * jos reitti on oikeasti admin-suojattu, se ei kuulu `/gig/:token/`- eikä
 * `/crew/:token/`-polkuun lainkaan.
 */

const SRC = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");

/** `app.get("/api/…"` / `app.post(…)` → { method, path }. */
function registeredRoutes(prefix: RegExp): { method: string; path: string }[] {
  const re = /app\.(get|post|put|patch|delete)\(\s*"(\/api\/[^"]+)"/g;
  const out: { method: string; path: string }[] = [];
  for (const m of SRC.matchAll(re)) {
    const path = m[2];
    if (prefix.test(path)) out.push({ method: m[1].toUpperCase(), path });
  }
  return out;
}

/**
 * `PUBLIC_API`-taulukon rivit lähdekoodista. Regexpit rakennetaan uudelleen
 * samasta tekstistä, jotta testi vertaa juuri sitä listaa jota palvelin ajaa.
 */
function publicApi(): { method: string; re: RegExp }[] {
  const start = SRC.indexOf("const PUBLIC_API");
  const end = SRC.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("PUBLIC_API-taulukkoa ei löytynyt routes.ts:stä");
  const body = SRC.slice(start, end);
  const re = /\{\s*method:\s*"([A-Z]+)",\s*re:\s*\/(.+?)\/\s*\}/g;
  const out: { method: string; re: RegExp }[] = [];
  for (const m of body.matchAll(re)) out.push({ method: m[1], re: new RegExp(m[2]) });
  if (out.length === 0) throw new Error("PUBLIC_API-taulukosta ei saatu yhtään riviä");
  return out;
}

/**
 * Sama vertailu kuin palvelimen `isPublicApi`, mutta parametrit
 * konkretisoituna. Numeeriset id:t korvataan numerolla, koska listalla on
 * `\d+`-rajattuja rivejä — kirjainmuotoinen paikkamerkki antaisi väärän
 * hälytyksen reitistä joka on oikeasti julkinen.
 */
function isPublic(method: string, expressPath: string, list: { method: string; re: RegExp }[]): boolean {
  const concrete = expressPath.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) =>
    /id$/i.test(name) ? "42" : "abc123");
  return list.some((r) => r.method === method && r.re.test(concrete));
}

describe("julkiset token-reitit ovat PUBLIC_API-listalla", () => {
  const list = publicApi();

  it("listasta saadaan rivejä (muuten koko testi olisi tyhjä lupaus)", () => {
    expect(list.length).toBeGreaterThan(15);
  });

  it("jokainen /api/gig/:token/… -reitti on julkinen", () => {
    const routes = registeredRoutes(/^\/api\/gig\/:token(\/|$)/);
    expect(routes.length).toBeGreaterThan(3);
    const missing = routes.filter((r) => !isPublic(r.method, r.path, list));
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("jokainen /api/crew/:token/… -reitti on julkinen", () => {
    const routes = registeredRoutes(/^\/api\/crew\/:token(\/|$)/);
    expect(routes.length).toBeGreaterThan(3);
    const missing = routes.filter((r) => !isPublic(r.method, r.path, list));
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it("juuri se reitti joka puuttui on nyt mukana", () => {
    expect(isPublic("GET", "/api/gig/:token/observation-image", list)).toBe(true);
    expect(isPublic("GET", "/api/crew/:token/observation-image", list)).toBe(true);
  });

  it("VARTIJA VARTIJALLE: admin-reitti ei mene listasta läpi", () => {
    // Jos `isPublic` alkaisi vahingossa hyväksyä kaiken, testit yllä menisivät
    // läpi eivätkä enää vartioisi mitään. Tämä pitää sen rehellisenä.
    expect(isPublic("POST", "/api/jobs/:id/p2/propose", list)).toBe(false);
    expect(isPublic("GET", "/api/admin/customers", list)).toBe(false);
  });
});
