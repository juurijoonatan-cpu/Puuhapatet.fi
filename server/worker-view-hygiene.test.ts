import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA. `workerView` on vastaus jonka tekijän puhelin hakee joka kerta kun
 * työpöytä avataan JA jokaisen ikkunamerkinnän jälkeen — käytännössä satoja
 * kertoja työpäivässä, kahdelta tekijältä yhtä aikaa.
 *
 * Siihen ei siis saa koskaan päätyä allekirjoituskuvaa. Yksi
 * `signatureDataUrl` on PNG data URL, enintään 300 000 merkkiä
 * (MAX_SIGNATURE_DATAURL_LEN, shared/crew.ts), ja nelossopimuspaketissa niitä
 * on neljä. Se olisi yli megatavu JOKAISEEN vastaukseen — sama vika joka söi
 * kerran koko kuukauden siirtokiintiön puolessatoista vuorokaudessa, mutta
 * pahempana, koska tämä data ei muutu koskaan ensimmäisen allekirjoituksen
 * jälkeen.
 *
 * Tekijä pääsee omaan sopimukseensa reitillä GET /api/crew/:token/contract,
 * joka ajetaan vasta napin painalluksesta. Se on oikea paikka isolle datalle:
 * kerran, silloin kun sitä oikeasti katsotaan.
 *
 * Jos tämä testi kaatuu: älä lisää allekirjoitusta workerView'hyn. Lisää
 * tarvitsemasi kenttä contract-reittiin ja hae se laiskasti.
 */

const SRC = join(process.cwd(), "server/routes.ts");

/** `workerView`n runko: määrittelystä sen sulkevaan `  }`-riviin. */
function workerViewBody(src: string): string {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /function workerView\s*\(/.test(l));
  if (start < 0) throw new Error("workerView-funktiota ei löytynyt routes.ts:stä");
  const indent = (lines[start].match(/^\s*/) as RegExpMatchArray)[0];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === `${indent}}`) return lines.slice(start, i + 1).join("\n");
  }
  throw new Error("workerView-funktion loppua ei löytynyt");
}

/** Kentät joiden koko on rajaamaton tai satoja kilotavuja. */
const HEAVY = [
  "signatureDataUrl",
  "photoDataUrl",
  "fileDataUrl",
  "receiptDataUrl",
];

/**
 * PALJAS NIMI EI OLE VUOTO — PÄINVASTOIN.
 *
 * Naiivi tekstihaku kaatui koodiin joka tekee täsmälleen oikein:
 *
 *   ({ receiptDataUrl, ...e }) => ({ ...e, hasReceipt: !!receiptDataUrl })
 *
 * Tässä kenttä mainitaan kahdesti, ja molemmilla kerroilla siksi että se
 * POISTETAAN: ensin puretaan se erilleen, sitten siitä jää jäljelle pelkkä
 * tieto onko kuittia. Juuri sitä halutaan.
 *
 * Vuoto näyttää erilaiselta. Kenttä lähtee ulos vain kahdessa muodossa:
 *
 *   `kentta:`   avainpaikka — objektiin kirjoitetaan tämänniminen kenttä
 *   `.kentta`   ominaisuuden luku — arvo poimitaan ja sijoitetaan johonkin
 *
 * Paljas tunniste (`receiptDataUrl` ilman pistettä tai kaksoispistettä) on
 * purettu paikallismuuttuja, ei ulos menevä arvo. Sitä ei lasketa.
 */
function emitsHeavyField(body: string, field: string): boolean {
  const asKey = new RegExp(`\\b${field}\\s*:`);      // { signatureDataUrl: … }
  const asRead = new RegExp(`\\.${field}\\b`);        // … = m.agreements[0].signatureDataUrl
  return asKey.test(body) || asRead.test(body);
}

describe("workerView-hygienia — raskaat kentät eivät kulje joka kyselyssä", () => {
  const src = readFileSync(SRC, "utf8");

  it("löytää workerView-funktion (testi itse ei saa olla tyhjä)", () => {
    const body = workerViewBody(src);
    expect(body.length).toBeGreaterThan(500);
    // Varmistus että luetaan oikeaa funktiota eikä sattumanvaraista palaa.
    expect(body).toContain("signedAgreementIds");
  });

  it("ei palauta yhtään data-URL-kenttää", () => {
    const body = workerViewBody(src);
    const found = HEAVY.filter((f) => emitsHeavyField(body, f));
    expect(
      found,
      `workerView palauttaa raskaan kentän: ${found.join(", ")}. `
        + "Hae se laiskasti omalla reitillään (vrt. GET /api/crew/:token/contract).",
    ).toEqual([]);
  });

  it("ei palauta koko agreements-listaa, vain id:t", () => {
    const body = workerViewBody(src);
    // Sallittu: `signedAgreementIds: member.agreements.filter(...).map(a => a.agreementId)`.
    // Kielletty: `agreements: member.agreements` tai `...member.agreements`.
    expect(/agreements:\s*member\.agreements\b/.test(body)).toBe(false);
    expect(/\.\.\.member\.agreements\b/.test(body)).toBe(false);
  });

  it("tekijän sopimusreitti on olemassa (muuten napilla ei ole mitään haettavaa)", () => {
    expect(src).toContain('app.get("/api/crew/:token/contract"');
  });

  it("tunnistaa rikkomuksen jos sellainen kirjoitetaan (vartija toimii)", () => {
    const broken = [
      "  async function workerView(job, project, member) {",
      "    return {",
      "      worker: {",
      "        signedAgreementIds: [],",
      "        agreements: member.agreements,",
      "        sig: member.agreements[0].signatureDataUrl,",
      "      },",
      "    };",
      "  }",
    ].join("\n");
    const body = workerViewBody(broken);
    expect(HEAVY.filter((f) => emitsHeavyField(body, f))).toEqual(["signatureDataUrl"]);
    expect(/agreements:\s*member\.agreements\b/.test(body)).toBe(true);
  });

  it("ei valita pois-purusta, joka nimenomaan poistaa kentän", () => {
    const good = [
      "  async function workerView(job, project, member) {",
      "    return {",
      "      worker: { signedAgreementIds: [] },",
      "      payouts: (member.payouts || []).map((p) => ({",
      "        ...p,",
      "        expenses: (p.expenses || []).map(({ receiptDataUrl, ...e }) => ({",
      "          ...e, hasReceipt: !!receiptDataUrl,",
      "        })),",
      "      })),",
      "    };",
      "  }",
    ].join("\n");
    const body = workerViewBody(good);
    // Kenttä esiintyy kahdesti mutta kummallakaan kerralla ei avaimena eikä
    // ominaisuuden lukuna — se puretaan pois ja siitä jää vain boolean.
    expect(body).toContain("receiptDataUrl");
    expect(HEAVY.filter((f) => emitsHeavyField(body, f))).toEqual([]);
  });
});
