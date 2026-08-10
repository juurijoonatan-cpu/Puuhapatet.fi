import { describe, expect, it } from "vitest";
import { isTokenPage } from "./api";

/**
 * VARTIJA. 401 tarkoittaa selaimen puolella "admin-sessio vanhentui", ja
 * `handleUnauthorized` heittää käyttäjän `/admin/login`iin. Asiakkaan
 * seurantalinkillä ja tekijän omalla sivulla EI OLE admin-sessiota — ne
 * tunnistautuvat polussa olevalla tokenilla — joten uloskirjautuminen ei ole
 * niissä koskaan oikea vastaus.
 *
 * MITÄ TAPAHTUI: yksi reitti puuttui palvelimen julkisten listalta, portti
 * vastasi 401, ja asiakas päätyi ikkunaa lisätessään meidän
 * kirjautumisruudullemme. Palvelinaukko on korjattu (`PUBLIC_API` +
 * `server/public-api-coverage.test.ts`), mutta seuraava vastaava aukko ei saa
 * enää heittää ketään ulos — sen kuuluu näkyä virheilmoituksena.
 *
 * Tämä testi pitää molemmat puolet paikallaan: token-sivu ei ohjaa, ja
 * admin-sivu ohjaa yhä.
 */

describe("isTokenPage", () => {
  it("asiakkaan ja tekijän token-sivut eivät ole admin-sivuja", () => {
    expect(isTokenPage("/seuranta/abc123")).toBe(true);
    expect(isTokenPage("/tarjous/abc123")).toBe(true);
    expect(isTokenPage("/tyo/abc123")).toBe(true);
  });

  it("admin-sivut ohjautuvat yhä kirjautumiseen", () => {
    // Jos tämä alkaisi palauttaa true, oikeasti vanhentunut admin-sessio jäisi
    // roikkumaan rikkinäiselle sivulle ilman mitään keinoa kirjautua uudelleen.
    for (const p of ["/admin/dashboard", "/admin/gig/7/projekti", "/admin/login", "/", "/palvelut"]) {
      expect(isTokenPage(p)).toBe(false);
    }
  });

  it("ei osu samannimiseen alkuun ilman tokenia", () => {
    // "/seuranta" ilman tokenia ei ole seurantalinkki.
    expect(isTokenPage("/seuranta")).toBe(false);
    expect(isTokenPage("/tyontekijat")).toBe(false);
    expect(isTokenPage("/admin/seuranta/abc")).toBe(false);
  });
});
