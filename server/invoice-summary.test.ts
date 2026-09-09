import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA — LASKUN YHTEENVETO PUHUU SAMASTA RAHASTA KUIN VELOITUS.
 *
 * MITÄ TAPAHTUI. Sähköpostin yhteenvetotaulussa ("Kertymä yhteensä",
 * "Aiemmin laskutettu") oli kolme haaraa: keltaiset, kiinteä urakka, ja
 * kaikki muu. Viimeinen luki luvut `computeTotals(gig)`ista eli KEIKAN
 * SEKTOREISTA.
 *
 * Kun tuntilasku ja yhdistetty lasku lisättiin, ne putosivat siihen
 * viimeiseen haaraan — mutta niiden veloitus tulee aivan muualta (tunnit +
 * kulut + ikkunat, ja lisätyöt). Asiakas näki siis kertymän joka ei liity
 * hänen maksettavaansa:
 *
 *   Tuntityö 884,00 € · Ikkunanpesu 360,00 €
 *   Kertymä yhteensä   360,00 €     ← sektorikertymä, ei tämän laskun raha
 *   Maksettavaa nyt  1 244,00 €
 *
 * Kertymä pienempi kuin maksettava on laskulla lukukelvoton.
 *
 * Lisäksi `fixedDeal` ei sulkenut pois yhdistettyä laskua, joten urakkakeikalla
 * yhdistetyn laskun yhteenveto lupasi "Kokonaishinta (sovittu)" ja "Tähän
 * mennessä laskutettu" — urakan lukuja tunti- ja lisätyöveloituksen vieressä.
 *
 * Sama vika kuin laskun nimessä aikoinaan: haaraketju johon uusi laskulaji
 * putoaa läpi. Jos tämä kaatuu, älä lisää haaraa tekstin sekaan — lisää se
 * yhteenvedon omaan laskentaan.
 */

const SRC = readFileSync(join(process.cwd(), "server/routes.ts"), "utf8");

/** Asiakaslaskun lähetysreitin runko. */
function invoiceRouteBody(src: string): string {
  const start = src.indexOf('app.post("/api/jobs/:id/gig/invoice"');
  if (start < 0) throw new Error("laskureittiä ei löytynyt routes.ts:stä");
  const next = src.indexOf("\n  app.", start + 10);
  return src.slice(start, next > 0 ? next : src.length);
}

describe("laskun yhteenveto vastaa veloitusta", () => {
  const body = invoiceRouteBody(SRC);

  it("löytää laskureitin (testi itse ei saa olla tyhjä lupaus)", () => {
    expect(body.length).toBeGreaterThan(2000);
    expect(body).toContain("isAllScope");
  });

  it("yhdistetty lasku ei ole urakan erä", () => {
    expect(/const fixedDeal\s*=[^;]*!isAllScope/.test(body)).toBe(true);
  });

  it("tunti- ja yhdistetyllä laskulla on oma kertymärivinsä", () => {
    expect(body).toContain("summaryAccrualRows");
    expect(/isHoursScope \|\| isAllScope\s*\n?\s*\? summaryAccrualRows/.test(body)).toBe(true);
  });

  /**
   * Kertymä tulee samasta laskennasta kuin summa: tunneilla
   * `hourly.customerTotalCents`, yhdistetyllä lisäksi lisätöiden erittely.
   * Sektorikertymä (`accruedSoFar`) EI kelpaa näille laskulajeille.
   */
  it("kertymä luetaan samasta laskennasta kuin veloitus", () => {
    const decl = body.slice(body.indexOf("const summaryAccrualCents"), body.indexOf("const summaryAccrualRows"));
    expect(decl).toContain("hourly?.customerTotalCents");
    expect(decl).toContain("p2Items?.totalCents");
    expect(decl).not.toContain("accruedSoFar");
  });

  it("jo laskutettu luetaan samoista laskureista", () => {
    const decl = body.slice(body.indexOf("const summaryInvoicedCents"), body.indexOf("const summaryAccrualRows"));
    expect(decl).toContain("invState.hoursInvoicedCents");
    expect(decl).toContain("p2InvoicedCents");
    expect(decl).not.toContain("previouslyInvoiced");
  });

  /** Sektorikertymä jää yhä sektorilaskun omaksi haarakseen. */
  it("sektorilasku käyttää yhä sektorikertymää", () => {
    expect(body).toContain("accruedSoFar");
    expect(body).toContain("previouslyInvoiced");
  });
});
