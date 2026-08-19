/**
 * HTTP-otsikoiden rakentaminen — se osa jonka voi rikkoa tiedostonimellä.
 *
 * MIKSI OMA MODUULI: tämä on puhdasta merkkijonokäsittelyä, jonka voi
 * yksikkötestata ilman tietokantaa. `server/routes.ts` ei ole testattavissa
 * (se avaa yhteyspoolin importissa), joten siellä oleva otsikkologiikka
 * testattaisiin vain lukemalla sen lähdekoodia — ja lähdekoodin lukeminen ei
 * kerro mitä Node tekee ä-kirjaimelle.
 */

/**
 * `Content-Disposition` tiedoston lataukseen tai upotukseen.
 *
 * Ä JA Ö KAATAVAT OTSIKON. Node heittää `ERR_INVALID_CHAR`in jos otsikon
 * arvossa on ei-ASCII-merkki, joten suomalaisella tiedostonimellä
 * ("Sopimus_yhdistykselle_äö.pdf") koko lataus vastaisi 500 — ei väärällä
 * nimellä vaan epäonnistuen kokonaan.
 *
 * Siksi kaksi muotoa, kuten RFC 6266 neuvoo: `filename` on ASCII-muunnos
 * vanhoille selaimille, `filename*` (RFC 5987) se oikea nimi. Selain käyttää
 * jälkimmäistä kun se ymmärtää sen, eli käytännössä aina.
 *
 * Lainausmerkit ja rivinvaihdot poistetaan: niillä otsikon voi katkaista.
 */
export function contentDispositionFor(kind: "inline" | "attachment", name: string): string {
  const clean = name.replace(/[\r\n"]/g, "").trim() || "tiedosto";
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
