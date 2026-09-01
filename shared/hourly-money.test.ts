import { describe, expect, it } from "vitest";
import { computeHourlyMoney } from "./hourly-money";
import { DEFAULT_HOUR_RATE_CENTS, DEFAULT_WORKER_HOUR_CENTS, type ProjShift } from "./project";

/**
 * TUNTITILAN RAHA.
 *
 * Nämä testit ovat olemassa yhden säännön takia, joka on helppo saada väärin
 * päin: PERUSTAJAN omasta tunnista EI oteta katetta. Jos se unohtuu, virhe
 * näkyy kahdesti väärin — perustajan palkka on liian pieni ja "kate" liian
 * suuri, eli hänen oma palkkansa näyttää yhteiseltä rahalta.
 */

let n = 0;
function shift(worker: string, hours: number, day = "2026-09-01"): ProjShift {
  n += 1;
  return { id: `s${n}`, worker, day, hours, at: 1_700_000_000_000 + n };
}

const RATE = DEFAULT_HOUR_RATE_CENTS;   // 2600
const WAGE = DEFAULT_WORKER_HOUR_CENTS; // 1500

describe("computeHourlyMoney — oletushinnat", () => {
  it("oletukset ovat 26,00 € ja 15,00 €", () => {
    expect(RATE).toBe(2600);
    expect(WAGE).toBe(1500);
    const m = computeHourlyMoney({ shifts: [] });
    expect(m.hourRateCents).toBe(2600);
    expect(m.workerHourCents).toBe(1500);
  });

  it("työntekijän tunti: asiakas 26 €, tekijä 15 €, kate 11 €", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 1)] });
    expect(m.billableCents).toBe(2600);
    expect(m.workerCostCents).toBe(1500);
    expect(m.marginCents).toBe(1100);
    expect(m.founderWageCents).toBe(0);
    expect(m.workerHours).toBe(1);
    expect(m.founderHours).toBe(0);
  });

  it("PERUSTAJAN tunti: koko 26 € hänelle, EI katetta", () => {
    const m = computeHourlyMoney({ shifts: [shift("joonatan", 1)] });
    expect(m.billableCents).toBe(2600);
    expect(m.founderWageCents).toBe(2600);
    // Tämä on se rivi joka pitää säännön paikallaan.
    expect(m.marginCents).toBe(0);
    expect(m.workerCostCents).toBe(0);
    expect(m.founderHours).toBe(1);
    const joonatan = m.byFounder.find((f) => f.id === "joonatan")!;
    expect(joonatan.wageCents).toBe(2600);
    expect(joonatan.marginCents).toBe(0);
    expect(joonatan.totalCents).toBe(2600);
    // Matias ei saa senttiäkään Joonatanin omasta työstä.
    expect(m.byFounder.find((f) => f.id === "matias")!.totalCents).toBe(0);
  });

  it("kate jaetaan perustajien kesken tasan", () => {
    // 2 h työntekijää → kate 2 × 11 € = 22 € → 11 € kummallekin.
    const m = computeHourlyMoney({ shifts: [shift("petrus", 2)] });
    expect(m.marginCents).toBe(2200);
    expect(m.byFounder.find((f) => f.id === "joonatan")!.marginCents).toBe(1100);
    expect(m.byFounder.find((f) => f.id === "matias")!.marginCents).toBe(1100);
  });

  it("pariton kate jaetaan sentilleen, ei katoa eikä synny", () => {
    // 0,5 h → laskutus 1300, palkka 750, kate 550 → 275 + 275.
    const m = computeHourlyMoney({ shifts: [shift("petrus", 0.5)] });
    expect(m.billableCents).toBe(1300);
    expect(m.workerCostCents).toBe(750);
    expect(m.marginCents).toBe(550);
    const sum = m.byFounder.reduce((s, f) => s + f.marginCents, 0);
    expect(sum).toBe(m.marginCents);
  });

  it("osat summautuvat aina laskutettavaan senttiin", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 3.5), shift("joonatan", 1.5), shift("mikko", 0.5)],
    });
    expect(m.workerCostCents + m.marginCents + m.founderWageCents).toBe(m.billableCents);
    const founderTotal = m.byFounder.reduce((s, f) => s + f.totalCents, 0);
    expect(founderTotal).toBe(m.founderWageCents + m.marginCents);
  });
});

describe("computeHourlyMoney — puolikkaat tunnit", () => {
  it("puolikas tunti on oikea raha, ei pyöristetty tunti", () => {
    const m = computeHourlyMoney({ shifts: [shift("petrus", 0.5)] });
    expect(m.totalHours).toBe(0.5);
    expect(m.billableCents).toBe(1300);
  });

  it("saman päivän puolikkaat summautuvat tekijäkohtaisesti", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 0.5), shift("petrus", 1.5)],
    });
    expect(m.totalHours).toBe(2);
    expect(m.byWorker).toHaveLength(1);
    expect(m.byWorker[0].hours).toBe(2);
    expect(m.byWorker[0].earnedCents).toBe(3000);
  });
});

describe("computeHourlyMoney — keikkakohtaiset hinnat", () => {
  it("keikan omat hinnat voittavat oletukset", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 1)],
      hourRateCents: 3000, workerHourCents: 1800,
    });
    expect(m.billableCents).toBe(3000);
    expect(m.workerCostCents).toBe(1800);
    expect(m.marginCents).toBe(1200);
  });

  it("kelvoton hinta putoaa oletukseen — nolla ei ole hinta", () => {
    for (const bad of [0, -5, NaN, undefined, "kaksikymmentä" as any]) {
      const m = computeHourlyMoney({ shifts: [shift("petrus", 1)], hourRateCents: bad });
      expect(m.hourRateCents).toBe(2600);
    }
  });

  it("perustajan tunti seuraa keikan hintaa, ei oletusta", () => {
    const m = computeHourlyMoney({
      shifts: [shift("matias", 2)], hourRateCents: 3000, workerHourCents: 1800,
    });
    expect(m.founderWageCents).toBe(6000);
    expect(m.marginCents).toBe(0);
  });
});

describe("computeHourlyMoney — virhetilanteet", () => {
  it("tuntipalkka yli asiakashinnan ei tuota miinuskatetta", () => {
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 1)], hourRateCents: 2000, workerHourCents: 2500,
    });
    expect(m.rateInverted).toBe(true);
    expect(m.marginCents).toBe(0);
    // Tekijä saa enintään sen mitä asiakas maksaa — kirjausvirhe ei saa
    // muuttua velaksi jota kukaan ei ole luvannut.
    expect(m.workerCostCents).toBe(2000);
    expect(m.workerCostCents + m.marginCents).toBe(m.billableCents);
  });

  it("tyhjä keikka on nolla eikä kaadu", () => {
    const m = computeHourlyMoney({ shifts: [] });
    expect(m.totalHours).toBe(0);
    expect(m.billableCents).toBe(0);
    expect(m.byWorker).toEqual([]);
    expect(m.byFounder.every((f) => f.totalCents === 0)).toBe(true);
  });

  it("johtajan miinuskorjaus ei vie palkkaa pakkaselle", () => {
    // computeShiftStats rajaa tekijän tunnit nollaan; raha seuraa samaa lukua.
    const m = computeHourlyMoney({
      shifts: [shift("petrus", 2), shift("petrus", -5)],
    });
    expect(m.workerCostCents).toBeGreaterThanOrEqual(0);
    expect(m.billableCents).toBeGreaterThanOrEqual(0);
  });
});
