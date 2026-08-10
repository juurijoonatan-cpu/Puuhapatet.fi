import { describe, expect, it } from "vitest";
import { computeP2Billing, p2NumbersByFloor, p2WashedYellows, type P2Offer, type P2State } from "./p2";
import type { ProjectData, WindowStatus } from "./project";

/**
 * VARTIJA. "79 pestyä · 2 587,50 €" ei ole tarkistettavissa: kun rakennuksesta
 * lasketaan 77, loppuluku ei kerro kumpi on oikeassa. Rivilista kertoo — mutta
 * vain jos se on sama totuus kuin ruudun luku.
 *
 * Nämä testit lukitsevat sen: rivien MÄÄRÄ on sama kuin `washedTotal` ja rivien
 * SUMMA sama kuin earned + pending. Jos ne eroavat, `matchesBilling` on epätosi
 * ja paneeli sanoo sen ääneen ennen laskutusta.
 */

function project(
  perFloor: Record<string, { p: 1 | 2; status?: WindowStatus; offer?: P2Offer }[]>,
): ProjectData {
  const marks: Record<string, { marks: { p: 1 | 2; x: number; y: number }[] }> = {};
  const statuses: Record<string, WindowStatus> = {};
  const offers: Record<string, P2Offer> = {};
  for (const [f, pts] of Object.entries(perFloor)) {
    marks[f] = { marks: pts.map((pt, i) => ({ p: pt.p, x: i, y: i })) };
    pts.forEach((pt, i) => {
      const key = `${f}#${i}`;
      if (pt.status) statuses[key] = pt.status;
      if (pt.offer) offers[key] = pt.offer;
    });
  }
  const p2: P2State = { enabled: true, workerSharePct: 50, offers, events: [] };
  return {
    building: { name: null, address: null, floors: Object.keys(perFloor), planBase: "/x/" },
    marks, statuses, washedBy: {}, customMarks: {}, posOverrides: {}, deleted: {},
    log: [], hours: {}, hourLog: [], workers: [], p2,
  } as unknown as ProjectData;
}

const locked = (c: number): P2Offer => ({ status: "locked", priceCents: c, lockedCents: c, version: 2, updatedAt: 0 });
const proposed = (c: number): P2Offer => ({ status: "proposed", priceCents: c, version: 1, updatedAt: 0 });
const countered = (p: number, c: number): P2Offer => ({ status: "countered", priceCents: p, counterCents: c, version: 2, updatedAt: 0 });
const declined = (c: number): P2Offer => ({ status: "declined", priceCents: c, version: 2, updatedAt: 0 });

describe("p2WashedYellows", () => {
  it("rivien määrä ja summa ovat samat kuin ruudun luvut", () => {
    const data = project({
      "1": [
        { p: 2, status: "pesty", offer: locked(3400) },
        { p: 2, status: "pesty", offer: proposed(3750) },
        { p: 2, status: "pesty", offer: declined(3400) },
        { p: 2, status: "pesty" },
      ],
    });
    const l = p2WashedYellows(data);
    const b = computeP2Billing(data);
    expect(l.count).toBe(b.washedTotal);
    expect(l.sumCents).toBe(b.earnedCents + b.pendingEarnedCents);
    expect(l.matchesBilling).toBe(true);
  });

  it("hylätty ja hinnoittelematon ovat mukana MÄÄRÄSSÄ mutta tuovat nollan", () => {
    // Juuri tämä selittää miksi kpl ja € eivät liiku samassa tahdissa.
    const data = project({ "1": [
      { p: 2, status: "pesty", offer: declined(3400) },
      { p: 2, status: "pesty" },
    ] });
    const l = p2WashedYellows(data);
    expect(l.count).toBe(2);
    expect(l.sumCents).toBe(0);
    expect(l.byState.declined).toEqual({ count: 1, sumCents: 0 });
    expect(l.byState.unpriced).toEqual({ count: 1, sumCents: 0 });
  });

  it("vastatarjous lasketaan asiakkaan tarjoamalla hinnalla", () => {
    const data = project({ "1": [{ p: 2, status: "pesty", offer: countered(3750, 3000) }] });
    const l = p2WashedYellows(data);
    expect(l.byState.pending).toEqual({ count: 1, sumCents: 3000 });
    expect(l.matchesBilling).toBe(true);
  });

  it("pesemätön ja punainen eivät ole listalla", () => {
    const data = project({ "1": [
      { p: 2, offer: locked(3400) },              // sovittu mutta pesemätön
      { p: 1, status: "pesty" },                   // punainen
      { p: 2, status: "kesken", offer: locked(3400) },
    ] });
    expect(p2WashedYellows(data).count).toBe(0);
  });

  it("numero vastaa asiakkaan karttaa — juoksee kerroksen kaikista keltaisista", () => {
    const data = project({ "1": [
      { p: 1, status: "pesty" },
      { p: 2 },                                     // keltainen 1, pesemätön
      { p: 2, status: "pesty", offer: locked(3400) }, // keltainen 2
    ] });
    expect(p2WashedYellows(data).byFloor[0].lines[0].number).toBe(2);
  });

  it("kerrossummat ja -määrät summautuvat kokonaislukuihin", () => {
    const data = project({
      "K": [{ p: 2, status: "pesty", offer: locked(3400) }],
      "4": [{ p: 2, status: "pesty", offer: proposed(2700) }, { p: 2, status: "pesty", offer: declined(3400) }],
    });
    const l = p2WashedYellows(data);
    // Ryhmien järjestys seuraa rakennuksen kerrosjärjestystä; tässä tarkistetaan
    // sisältö, ei järjestys (fixture rakentaa kerrokset objektin avaimista).
    expect(l.byFloor.find((g) => g.floor === "K")).toMatchObject({ count: 1, sumCents: 3400 });
    expect(l.byFloor.find((g) => g.floor === "4")).toMatchObject({ count: 2, sumCents: 2700 });
    expect(l.byFloor.reduce((n, g) => n + g.count, 0)).toBe(l.count);
    expect(l.byFloor.reduce((n, g) => n + g.sumCents, 0)).toBe(l.sumCents);
  });

  it("poistettu ikkuna ei ole listalla vaikka status jäisi roikkumaan", () => {
    const data = project({ "1": [
      { p: 2, status: "pesty", offer: locked(3400) },
      { p: 2, status: "pesty", offer: locked(3400) },
    ] });
    (data as { deleted: Record<string, boolean> }).deleted["1#1"] = true;
    const l = p2WashedYellows(data);
    expect(l.count).toBe(1);
    expect(l.matchesBilling).toBe(true);
  });

  it("tyhjä ja vaiheeton projekti eivät kaadu", () => {
    expect(p2WashedYellows(project({ "1": [] }))).toMatchObject({ count: 0, sumCents: 0, matchesBilling: true });
    const noP2 = project({ "1": [{ p: 2, status: "pesty" }] });
    (noP2 as { p2?: P2State }).p2 = undefined;
    expect(p2WashedYellows(noP2).count).toBe(0);
  });
});

describe("p2NumbersByFloor", () => {
  it("numero juoksee kerroksen keltaisista, ei kaikista pisteistä", () => {
    // Tämä oli vika: kartta laski kaikki pisteet (punainen mukaan lukien),
    // lista vain keltaiset — sama ikkuna sai kaksi eri numeroa.
    const data = project({ "1": [
      { p: 1 }, { p: 1 }, { p: 2 }, { p: 1 }, { p: 2 },
    ] });
    const n = p2NumbersByFloor(data);
    expect(n["1#2"]).toBe(1);
    expect(n["1#4"]).toBe(2);
    expect(n["1#0"]).toBeUndefined();   // punaisella ei ole keltaisen numeroa
  });

  it("numerointi alkaa alusta joka kerroksessa", () => {
    const data = project({ "1": [{ p: 2 }, { p: 2 }], "2": [{ p: 2 }] });
    const n = p2NumbersByFloor(data);
    expect([n["1#0"], n["1#1"], n["2#0"]]).toEqual([1, 2, 1]);
  });

  it("poistettu keltainen ei kuluta numeroa", () => {
    const data = project({ "1": [{ p: 2 }, { p: 2 }, { p: 2 }] });
    (data as { deleted: Record<string, boolean> }).deleted["1#0"] = true;
    const n = p2NumbersByFloor(data);
    expect(n["1#1"]).toBe(1);
    expect(n["1#2"]).toBe(2);
  });

  it("sama numerointi kuin pestyjen listassa", () => {
    const data = project({ "1": [
      { p: 1, status: "pesty" },
      { p: 2, status: "pesty", offer: locked(3400) },
      { p: 2, status: "pesty", offer: proposed(3400) },
    ] });
    const n = p2NumbersByFloor(data);
    for (const line of p2WashedYellows(data).byFloor[0].lines) {
      expect(line.number).toBe(n[line.key]);
    }
  });
});
