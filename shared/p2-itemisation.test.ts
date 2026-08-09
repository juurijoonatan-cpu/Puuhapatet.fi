import { describe, expect, it } from "vitest";
import { computeP2Billing, p2Itemisation, type P2Offer, type P2State } from "./p2";
import type { ProjectData, WindowStatus } from "./project";

/**
 * VARTIJA. Tämä on laskun perusta.
 *
 * Erittely ja laskutettava summa lasketaan eri funktioissa. Jos ne eroavat
 * sentinkin, lasku on väärä eikä kukaan huomaa — asiakas saa laskun rivistä
 * jota ei ole tai jää saamatta laskua tehdystä työstä. Nämä testit pitävät ne
 * yhdessä ja lukitsevat säännön: mukaan PESTY + SOVITTU, ei muuta.
 */

function project(
  perFloor: Record<string, { p: 1 | 2; status?: WindowStatus }[]>,
  offers: Record<string, P2Offer>,
): ProjectData {
  const marks: ProjectData["marks"] = {};
  const statuses: Record<string, WindowStatus> = {};
  for (const [f, pts] of Object.entries(perFloor)) {
    marks[f] = { marks: pts.map((pt, i) => ({ p: pt.p, x: i, y: i })) };
    pts.forEach((pt, i) => { if (pt.status) statuses[`${f}#${i}`] = pt.status; });
  }
  const p2: P2State = { enabled: true, workerSharePct: 50, offers, events: [] };
  return {
    building: { name: null, address: null, floors: Object.keys(perFloor), planBase: "/x/" },
    marks, statuses, washedBy: {}, customMarks: {}, posOverrides: {}, deleted: {},
    log: [], hours: {}, hourLog: [], workers: [], p2,
  } as unknown as ProjectData;
}

function locked(cents: number, by: "customer" | "admin" = "customer", at = 1_700_000_000_000): P2Offer {
  return { status: "locked", priceCents: cents, lockedCents: cents, lockedBy: by, lockedAt: at, version: 2, updatedAt: at };
}
function proposed(cents: number): P2Offer {
  return { status: "proposed", priceCents: cents, version: 1, updatedAt: 0 };
}

describe("p2Itemisation", () => {
  it("erittely täsmää laskutusperustaan sentilleen", () => {
    const data = project(
      { "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }], "2": [{ p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3750), "2#0": locked(3400) },
    );
    const it2 = p2Itemisation(data);
    expect(it2.totalCents).toBe(10550);
    expect(it2.earnedCents).toBe(computeP2Billing(data).earnedCents);
    expect(it2.matchesBilling).toBe(true);
  });

  it("sovittu mutta PESEMÄTÖN ei ole laskussa — työtä ei ole tehty", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }, { p: 2 }] }, { "1#0": locked(3400), "1#1": locked(3400) });
    const it2 = p2Itemisation(data);
    expect(it2.lines).toHaveLength(1);
    expect(it2.totalCents).toBe(3400);
    // Sovittu kokonaissumma on suurempi — juuri siksi laskuperusta on eri luku.
    expect(computeP2Billing(data).lockedSumCents).toBe(6800);
    expect(it2.matchesBilling).toBe(true);
  });

  it("pesty mutta HYVÄKSYMÄTÖN ei ole laskussa — hinnasta ei ole sovittu", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": proposed(3400) });
    const it2 = p2Itemisation(data);
    expect(it2.lines.map((l) => l.key)).toEqual(["1#0"]);
    expect(it2.matchesBilling).toBe(true);
  });

  it("punaiset eivät ole mukana", () => {
    const data = project({ "1": [{ p: 1, status: "pesty" }, { p: 2, status: "pesty" }] }, { "1#1": locked(3400) });
    expect(p2Itemisation(data).lines).toHaveLength(1);
  });

  it("numero on kerroksen KAIKKIEN keltaisten juokseva numero, ei laskurivien", () => {
    // Kerroksen 1. keltainen on hyväksymätön, 2. on laskussa → numeron on
    // oltava 2, koska asiakkaan kartalla se on ikkuna 2.
    const data = project({ "1": [{ p: 1 }, { p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#1": proposed(3400), "1#2": locked(3750) });
    const [line] = p2Itemisation(data).lines;
    expect(line.number).toBe(2);
    expect(line.floor).toBe("1");
  });

  it("ryhmittelee kerroksittain ja kerrossummat summautuvat kokonaissummaan", () => {
    const data = project(
      { "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }], "4": [{ p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3400), "4#0": locked(3750) },
    );
    const it2 = p2Itemisation(data);
    expect(it2.byFloor.map((g) => [g.floor, g.count, g.sumCents])).toEqual([["1", 2, 6800], ["4", 1, 3750]]);
    expect(it2.byFloor.reduce((n, g) => n + g.sumCents, 0)).toBe(it2.totalCents);
  });

  it("kertoo kuka hinnan hyväksyi ja milloin", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }] }, { "1#0": locked(3400, "admin", 123) });
    expect(p2Itemisation(data).lines[0]).toMatchObject({ lockedBy: "admin", lockedAt: 123 });
  });

  it("poistettu piste katoaa erittelystä ja laskutusperustasta yhdessä", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }, { p: 2, status: "pesty" }] },
      { "1#0": locked(3400), "1#1": locked(3400) });
    (data as { deleted: Record<string, boolean> }).deleted["1#1"] = true;
    const it2 = p2Itemisation(data);
    expect(it2.lines).toHaveLength(1);
    expect(it2.matchesBilling).toBe(true);
  });

  it("ilman vaihetta 2 erittely on tyhjä eikä kaadu", () => {
    const data = project({ "1": [{ p: 2, status: "pesty" }] }, {});
    (data as { p2?: P2State }).p2 = undefined;
    expect(p2Itemisation(data)).toMatchObject({ lines: [], totalCents: 0, earnedCents: 0, matchesBilling: true });
  });
});
