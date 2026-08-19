import { describe, expect, it } from "vitest";
import { contentDispositionFor } from "./http-headers";

/**
 * Tämä testi on olemassa yhden konkreettisen kaatumisen takia: sopimus-PDF:n
 * lataus rakentaa `Content-Disposition`in tiedoston omasta nimestä, ja
 * suomalaisessa nimessä on ä. Node ei salli ei-ASCII-merkkiä otsikon arvossa —
 * se heittää `ERR_INVALID_CHAR`in, ja asiakas näkee 500:n sopimuksensa
 * latauksesta.
 */
describe("contentDispositionFor", () => {
  /** Sama tarkistus jonka Node tekee otsikon arvolle. */
  const asciiOnly = (v: string) => /^[\x20-\x7E]*$/.test(v);

  it("ääkkösellinen tiedostonimi ei riko otsikkoa", () => {
    const h = contentDispositionFor("attachment", "Sopimus_yhdistykselle_äö.pdf");
    expect(asciiOnly(h)).toBe(true);
    // ASCII-varamuoto säilyttää päätteen, jotta tiedosto avautuu oikeaan ohjelmaan.
    expect(h).toContain('filename="Sopimus_yhdistykselle___.pdf"');
    // Ja oikea nimi kulkee RFC 5987 -muodossa.
    expect(h).toContain("filename*=UTF-8''Sopimus_yhdistykselle_%C3%A4%C3%B6.pdf");
  });

  it("tavallinen nimi menee läpi sellaisenaan", () => {
    const h = contentDispositionFor("inline", "STUHI_Ikkunanpesu_PT202604.pdf");
    expect(h).toBe(
      'inline; filename="STUHI_Ikkunanpesu_PT202604.pdf"'
      + "; filename*=UTF-8''STUHI_Ikkunanpesu_PT202604.pdf",
    );
  });

  it("otsikkoa ei voi katkaista nimellä", () => {
    // Rivinvaihto otsikon arvossa olisi otsikoiden injektio; lainausmerkki
    // katkaisisi `filename=""`-arvon.
    const h = contentDispositionFor("attachment", 'sopi"mus\r\nX-Injected: 1.pdf');
    expect(h).not.toContain("\r");
    expect(h).not.toContain("\n");
    expect(h).toContain('filename="sopimusX-Injected: 1.pdf"');
    expect(asciiOnly(h)).toBe(true);
  });

  it("tyhjä nimi saa varanimen eikä tuota tyhjää arvoa", () => {
    expect(contentDispositionFor("inline", "   ")).toContain('filename="tiedosto"');
  });
});
