import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * VARTIJA — LASKUN NIMIKKEET EIVÄT SAA OLLA TYHJÄT.
 *
 * MITÄ TAPAHTUI. `invoiceLines` kerättiin vain tunneille (`hours`),
 * yhdistetylle (`all`) ja keltaisille (`p2`). Urakan erälaskulla
 * (`scope: "p1"`) lista oli siis TYHJÄ — ja juuri se lista kopioidaan
 * napista laskun viestikenttään.
 *
 * Verkkolaskutilassa Puuhapatet lähettää asiakkaalle vain vahvistuksen ja
 * perustaja kirjoittaa varsinaisen laskun omaan laskutusohjelmaansa. Se
 * kopio oli "Erittely" ja "Yhteensä: 0,00 €", vaikka lasku peri erän täyden
 * summan. Nimikkeetön lasku on asiakkaalle lukukelvoton, ja 0,00 €
 * viestikentässä näyttää siltä kuin laskulla ei olisi mitään.
 *
 * Jos tämä kaatuu: älä poista haaraa. Jokaisella laskulajilla on nimikkeet.
 */

const SRC = readFileSync(join(process.cwd(), "client/src/pages/admin/gig-tracker.tsx"), "utf8");

/** `invoiceLines`-määrittelyn runko. */
function itemisationBody(src: string): string {
  const start = src.indexOf("const invoiceLines:");
  if (start < 0) throw new Error("invoiceLines-määrittelyä ei löytynyt gig-tracker.tsx:stä");
  const end = src.indexOf("const invoiceLinesTotal", start);
  if (end < 0) throw new Error("invoiceLines-määrittelyn loppua ei löytynyt");
  return src.slice(start, end);
}

describe("laskun nimikkeet kattavat jokaisen laskulajin", () => {
  const body = itemisationBody(SRC);

  it("löytää määrittelyn (testi itse ei saa olla tyhjä lupaus)", () => {
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("out.push");
  });

  it.each([
    ["hours", '"hours"'],
    ["all", '"all"'],
    ["p2", '"p2"'],
    ["p1", '"p1"'],
  ])("laskulaji %s on käsitelty", (_name, needle) => {
    expect(body).toContain(needle);
  });

  /** Urakan erä on yksi nimike, ei tyhjä lista. */
  it("kiinteän urakan erä saa oman rivinsä", () => {
    expect(body).toContain("fixedInstallmentCents");
    expect(/Maksuerä/.test(body)).toBe(true);
  });

  /** Sektorikeikalla nimikkeet ovat sektorit laskuttamattomalta osaltaan. */
  it("sektorilasku erittelee sektorit laskuttamattomalta osaltaan", () => {
    expect(body).toContain("gig.sectors");
    expect(body).toContain("invoicedWashed");
  });

  /**
   * Erän summa on yksi nimikkeistä, joten se on laskettava ENNEN listaa.
   * Käänteinen järjestys on TS2454 eikä pelkkä tyylikysymys.
   */
  it("erän summa lasketaan ennen nimikkeitä", () => {
    expect(SRC.indexOf("const fixedInstallmentCents"))
      .toBeLessThan(SRC.indexOf("const invoiceLines:"));
  });
});
