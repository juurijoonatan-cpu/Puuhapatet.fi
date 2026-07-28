import { describe, expect, it } from "vitest";
import {
  emptyProjectData,
  fixedDealFor,
  dealBillableScope,
  dealAgreedTotalCents,
  computeDealBilling,
  computeEraDebts,
  syncGigSectorsFromProject,
  type ProjectData,
} from "./project";
import { emptyGigData, computeTotals } from "./gig";

// FR8 = signed deal: 168 red windows × 37,50 € = 6300 €, billed in 4 erät of
// 1575 €. Removing red windows below the agreed 168 must shrink the deal by
// 37,50 €/ikkuna — the reduction lands on the accrued total and the LAST erä.
const UNIT = 3750;       // 37,50 €
const CAP = 630_000;     // 6300 €
const AGREED = 168;

function fr8Project(redCount: number, washedCount = 0): ProjectData {
  const data = emptyProjectData();
  data.building.planBase = "/fr8/plans/bp-"; // triggers fixedDealFor
  const marks = Array.from({ length: redCount }, (_, i) => ({ p: 1 as const, x: i % 10, y: Math.floor(i / 10) }));
  data.marks = { K: { marks } };
  for (let i = 0; i < Math.min(washedCount, redCount); i++) data.statuses[`K#${i}`] = "pesty";
  return data;
}

describe("dealBillableScope / dealAgreedTotalCents", () => {
  it("täysi sopimus (168 punaista) = 6300 €", () => {
    const data = fr8Project(AGREED);
    const deal = fixedDealFor(data)!;
    expect(dealBillableScope(data, deal)).toBe(168);
    expect(dealAgreedTotalCents(data, deal)).toBe(CAP);
  });

  it("5 punaista poistettu (163) → −5×37,50 € = 6112,50 €", () => {
    const data = fr8Project(AGREED - 5);
    const deal = fixedDealFor(data)!;
    expect(dealBillableScope(data, deal)).toBe(163);
    expect(dealAgreedTotalCents(data, deal)).toBe(CAP - 5 * UNIT); // 611250
  });

  it("yli 168 punaista → katossa (ei nouse yli 6300 €)", () => {
    const data = fr8Project(AGREED + 4);
    const deal = fixedDealFor(data)!;
    expect(dealBillableScope(data, deal)).toBe(168);
    expect(dealAgreedTotalCents(data, deal)).toBe(CAP);
  });
});

describe("computeDealBilling — kertynyt seuraa efektiivistä sopimusta", () => {
  it("163 punaista kaikki pesty → kertynyt 6112,50 € (ei 6300 €)", () => {
    const data = fr8Project(AGREED - 5, AGREED - 5);
    const deal = fixedDealFor(data)!;
    const b = computeDealBilling(data, deal);
    expect(b.capCents).toBe(CAP - 5 * UNIT);
    expect(b.accruedCents).toBe(CAP - 5 * UNIT);
    expect(b.pct).toBe(100);
  });

  it("täysi 168 kaikki pesty → kertynyt tasan 6300 €", () => {
    const data = fr8Project(AGREED, AGREED);
    const b = computeDealBilling(data, fixedDealFor(data)!);
    expect(b.accruedCents).toBe(CAP);
    expect(b.capCents).toBe(CAP);
  });
});

describe("computeEraDebts — viimeinen erä imee vähennyksen", () => {
  it("163 punaista: erät 1-3 = 1575 €, viimeinen = 1387,50 €", () => {
    const data = fr8Project(AGREED - 5, AGREED - 5);
    const eras = computeEraDebts(data, fixedDealFor(data)!, [], null);
    expect(eras).toHaveLength(4);
    expect(eras[0].instalmentCents).toBe(157_500);
    expect(eras[1].instalmentCents).toBe(157_500);
    expect(eras[2].instalmentCents).toBe(157_500);
    expect(eras[3].instalmentCents).toBe(138_750); // 1387,50 € = 6112,50 − 3×1575
    // Ei aukkoa: erät summautuvat efektiiviseen sopimukseen sentilleen.
    const sum = eras.reduce((s, e) => s + e.instalmentCents, 0);
    expect(sum).toBe(CAP - 5 * UNIT);
  });

  it("täysi sopimus: kaikki neljä erää 1575 €, summa 6300 €", () => {
    const data = fr8Project(AGREED, AGREED);
    const eras = computeEraDebts(data, fixedDealFor(data)!, [], null);
    expect(eras.map((e) => e.instalmentCents)).toEqual([157_500, 157_500, 157_500, 157_500]);
    expect(eras.reduce((s, e) => s + e.instalmentCents, 0)).toBe(CAP);
  });
});

describe("syncGigSectorsFromProject — sopimussektori seuraa efektiivistä summaa", () => {
  it("163 punaista → sektorin kokonaishinta 6112,50 €", () => {
    const data = fr8Project(AGREED - 5, AGREED - 5);
    const gig = syncGigSectorsFromProject(emptyGigData(), data);
    const totals = computeTotals(gig);
    expect(totals.capCents).toBe(CAP - 5 * UNIT);
    expect(totals.accruedCents).toBe(CAP - 5 * UNIT); // kaikki pesty
  });
});
