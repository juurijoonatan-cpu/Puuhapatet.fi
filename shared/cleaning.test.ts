import { describe, expect, it } from "vitest";
import {
  estimateCleaning, SEGMENTS, CLEANING_STATUS, CLEANING_LAUNCH_LABEL,
  CLEANING_PRICING_SUMMARY,
} from "./cleaning";
import { HOUSEHOLD_DEDUCTION_RATE } from "./tax";

/**
 * Siivousarvion laskenta. Testit ovat tässä kahdesta syystä:
 *   1. hinta näkyy asiakkaalle, joten hiljainen laskuvirhe on lupaus väärästä
 *      summasta;
 *   2. palvelu on vielä avaamassa, ja se tila ei saa vahingossa kadota koodista
 *      (viimeinen testi).
 */
describe("estimateCleaning", () => {
  it("laskee kotikäynnin neliöistä työtunneiksi ja euroiksi", () => {
    // 90 m² / 45 m²/h = 2 h ylläpitoa → 2 × 39 €.
    const e = estimateCleaning({ segment: "koti", sqm: 90, scope: "yllapito", frequency: "kerta" });
    expect(e.hours).toBe(2);
    expect(e.atMinimum).toBe(false);
    expect(e.perVisitEur).toBe(78);
    expect(e.perMonthEur).toBe(0); // kertakäynnillä ei kuukausihintaa
  });

  it("nostaa liian pienen kohteen käynnin minimiin ja kertoo siitä", () => {
    const e = estimateCleaning({ segment: "koti", sqm: 30, scope: "yllapito", frequency: "kerta" });
    expect(e.hours).toBe(SEGMENTS.koti.minHours);
    expect(e.atMinimum).toBe(true);
  });

  it("perusteellinen ja muuttosiivous kasvattavat AIKAA, eivät tuntihintaa", () => {
    const base = estimateCleaning({ segment: "koti", sqm: 90, scope: "yllapito", frequency: "kerta" });
    const deep = estimateCleaning({ segment: "koti", sqm: 90, scope: "perus", frequency: "kerta" });
    const move = estimateCleaning({ segment: "koti", sqm: 90, scope: "muutto", frequency: "kerta" });
    expect(deep.hours).toBeGreaterThan(base.hours);
    expect(move.hours).toBeGreaterThan(deep.hours);
    // Hinta seuraa tunteja täsmälleen: €/h pysyy vakiona.
    expect(deep.laborEur).toBe(Math.round(deep.hours * SEGMENTS.koti.eurPerHour));
  });

  it("toistuva sopimus on käynniltä halvempi ja antaa kuukausihinnan", () => {
    const once = estimateCleaning({ segment: "koti", sqm: 90, scope: "yllapito", frequency: "kerta" });
    const weekly = estimateCleaning({ segment: "koti", sqm: 90, scope: "yllapito", frequency: "viikko" });
    expect(weekly.perVisitEur).toBeLessThan(once.perVisitEur);
    expect(weekly.discountEur).toBe(Math.round(once.perVisitEur * 0.15));
    expect(weekly.perMonthEur).toBeGreaterThan(weekly.perVisitEur);
  });

  it("lisätyöt tulevat käynnin hintaan ja kuuluvat alennuksen piiriin", () => {
    const plain = estimateCleaning({ segment: "koti", sqm: 90, scope: "yllapito", frequency: "kerta" });
    const withAddons = estimateCleaning({
      segment: "koti", sqm: 90, scope: "yllapito", frequency: "kerta", addons: ["ikkunat", "uuni"],
    });
    expect(withAddons.addonsEur).toBe(70);
    expect(withAddons.perVisitEur).toBe(plain.perVisitEur + 70);
  });

  it("kotitalousvähennys koskee kotia, ei yritystä", () => {
    const home = estimateCleaning({ segment: "koti", sqm: 90, scope: "yllapito", frequency: "kerta" });
    expect(home.deductionEur).toBe(Math.round(home.perVisitEur * HOUSEHOLD_DEDUCTION_RATE));
    expect(home.perVisitAfterDeductionEur).toBe(home.perVisitEur - home.deductionEur);

    const office = estimateCleaning({ segment: "yritys", sqm: 300, scope: "yllapito", frequency: "kerta" });
    expect(office.deductionEur).toBe(0);
    expect(office.perVisitAfterDeductionEur).toBe(office.perVisitEur);
  });

  it("toimisto on samasta neliömäärästä halvempi kuin koti (nopeampi työ)", () => {
    const home = estimateCleaning({ segment: "koti", sqm: 180, scope: "yllapito", frequency: "kerta" });
    const office = estimateCleaning({ segment: "yritys", sqm: 180, scope: "yllapito", frequency: "kerta" });
    expect(office.perVisitEur).toBeLessThan(home.perVisitEur);
  });

  it("kestää mielettömät syötteet ilman NaN:ia", () => {
    const e = estimateCleaning({ segment: "koti", sqm: -5, scope: "yllapito", frequency: "kerta", areaMult: 0 });
    expect(Number.isFinite(e.perVisitEur)).toBe(true);
    expect(e.hours).toBe(SEGMENTS.koti.minHours);
  });
});

/**
 * VARTIJA: palvelun tila on "tulossa" eikä avauspäivää luvata.
 *
 * Jos joku poistaa tämän tilan tai kirjoittaa `CLEANING_LAUNCH_LABEL`iin
 * päivämäärän, sivusto alkaa väittää asiakkaalle jotain mitä ei ole päätetty.
 * Tila saa muuttua — mutta tietoisesti, tämän testin kautta.
 */
describe("siivouksen tila on rehellinen", () => {
  it("palvelua ei esitetä avattuna", () => {
    expect(CLEANING_STATUS).toBe("tulossa");
    expect(CLEANING_LAUNCH_LABEL).toBe("");
  });

  it("tekoälyn konteksti kertoo tilan ennen hintoja", () => {
    const firstLine = CLEANING_PRICING_SUMMARY.split("\n")[0];
    expect(firstLine).toContain("tulossa");
    expect(firstLine).toMatch(/EI voi vielä tilata/);
  });
});
