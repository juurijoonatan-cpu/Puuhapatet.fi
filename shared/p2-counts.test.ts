import { describe, expect, it } from "vitest";
import { computeP2Billing } from "./p2";
import type { ProjectData } from "./project";
import type { P2Offer, P2OfferStatus } from "./p2";

/**
 * KELTAISTEN LUVUT EIVÄT SAA OLLA KESKENÄÄN RISTIRIIDASSA.
 *
 * Perustajan paneeli näytti "136 keltaista" ja sen vieressä "PESTY 2 kpl",
 * vaikka pestyjä keltaisia oli oikeasti 7. Syy: "PESTY" oli
 * `lockedWashedCount`, eli vain ne joilla hinta oli jo lukittu. Loput pestyt
 * jakautuivat kahteen muuhun laskuriin, joita näytettiin vain jos ne olivat
 * nollaa suurempia. Tekijän sovellus laski pestyt keltaiset suoraan kartalta
 * ilman tarjousliitosta, joten se näytti oikean luvun — kaksi näkymää, kaksi
 * eri totuutta.
 *
 * Nämä testit lukitsevat kaksi invarianttia:
 *   1. washedTotal === lockedWashed + pendingWashed + unpricedWashed
 *   2. yellowTotal === lockitut + ehdotetut + vastatarjotut + hylätyt + hinnattomat
 *
 * Kumpikaan ei ole määritelmä: `washedTotal` lasketaan suoraan kartan tilasta,
 * ja kokonaismäärä pisteiden lukumäärästä. Jos haarat eriytyvät, testi kaatuu.
 */

function project(points: { p: 1 | 2; status?: "pesty" | "kesken"; offer?: P2OfferStatus; cents?: number }[]): ProjectData {
  const marks: Record<string, { marks: { p: 1 | 2; x: number; y: number }[] }> = { "1": { marks: [] } };
  const statuses: Record<string, any> = {};
  const offers: Record<string, P2Offer> = {};
  points.forEach((pt, i) => {
    marks["1"].marks.push({ p: pt.p, x: 10, y: 10 });
    const key = `1#${i}`;
    if (pt.status) statuses[key] = pt.status;
    if (pt.offer) {
      const cents = pt.cents ?? 3750;
      offers[key] = {
        status: pt.offer,
        priceCents: cents,
        version: 1,
        updatedAt: 0,
        ...(pt.offer === "locked" ? { lockedCents: cents } : {}),
        ...(pt.offer === "countered" ? { counterCents: cents } : {}),
      };
    }
  });
  return {
    version: 1,
    building: { floors: ["1"] },
    marks, statuses, washedBy: {}, washedBy2: {},
    customMarks: [], deleted: {}, posOverrides: {},
    p2: { enabled: true, workerSharePct: 53, offers, events: [], terms: null },
  } as unknown as ProjectData;
}

/** Sama kymmenen keltaisen tilanne jolla vika alun perin todennettiin. */
const MIXED = project([
  { p: 2, offer: "locked", status: "pesty" },
  { p: 2, offer: "locked", status: "pesty" },
  { p: 2, offer: "locked" },
  { p: 2, offer: "locked" },
  { p: 2, offer: "proposed", status: "pesty" },
  { p: 2, offer: "proposed", status: "pesty" },
  { p: 2, offer: "proposed", status: "pesty" },
  { p: 2, offer: "countered", status: "pesty" },
  { p: 2, offer: "declined" },
  { p: 2, status: "pesty" },
  { p: 1, status: "pesty" },   // punainen ei saa vuotaa keltaisten lukuihin
]);

describe("keltaisten luvut täsmäävät", () => {
  it("washedTotal on KAIKKI pestyt keltaiset, ei lukittu osajoukko", () => {
    const b = computeP2Billing(MIXED);
    // 2 locked + 3 proposed + 1 countered + 1 hinnaton = 7 pestyä keltaista.
    expect(b.washedTotal).toBe(7);
    // Juuri tämä oli se luku joka näkyi käyttäjälle "PESTY"-tiilessä.
    expect(b.lockedWashedCount).toBe(2);
  });

  it("osalaskurit summautuvat pestyjen kokonaismäärään", () => {
    const b = computeP2Billing(MIXED);
    expect(b.lockedWashedCount + b.pendingWashedCount + b.unpricedWashedCount + b.declinedWashedCount)
      .toBe(b.washedTotal);
  });

  it("pesty ja HYLÄTTY ei ole 'ilman hintaa'", () => {
    // Sama ikkuna näkyi ennen yhtä aikaa 'hylätty' ja 'ilman hintaa', ja
    // perustajaa kehotettiin hinnoittelemaan ikkuna jonka asiakas oli juuri
    // torjunut. Nyt sillä on oma laskurinsa eikä se ole tehtävälistalla.
    const b = computeP2Billing(project([{ p: 2, offer: "declined", status: "pesty" }]));
    expect(b.declinedWashedCount).toBe(1);
    expect(b.unpricedWashedCount).toBe(0);
    expect(b.washedUnlockedKeys).toEqual([]);
    expect(b.pendingWashedCount).toBe(0);
    expect(b.pendingEarnedCents).toBe(0);
  });

  it("tarjoustilat summautuvat keltaisten kokonaismäärään", () => {
    const b = computeP2Billing(MIXED);
    const unpriced = b.yellowTotal - b.pricedCount;
    expect(b.lockedCount + b.proposedCount + b.counteredCount + b.declinedCount + unpriced)
      .toBe(b.yellowTotal);
  });

  it("punaiset eivät vuoda keltaisten lukuihin", () => {
    const b = computeP2Billing(MIXED);
    expect(b.yellowTotal).toBe(10);
  });

  it("hyväksymätön raha on omana lukunaan mutta olemassa", () => {
    const b = computeP2Billing(MIXED);
    expect(b.pendingWashedCount).toBe(4);      // 3 proposed + 1 countered
    expect(b.pendingEarnedCents).toBeGreaterThan(0);
    expect(b.earnedCents).toBeGreaterThan(0);
  });

  it("tyhjä projekti ei kaadu eikä keksi lukuja", () => {
    const b = computeP2Billing(project([]));
    expect(b.yellowTotal).toBe(0);
    expect(b.washedTotal).toBe(0);
    expect(b.declinedCount).toBe(0);
  });

  it("ilman p2-tilaa kaikki keltaiset ovat yhä laskennassa mukana", () => {
    const p = project([{ p: 2, status: "pesty" }, { p: 2 }]);
    delete (p as any).p2;
    const b = computeP2Billing(p);
    expect(b.yellowTotal).toBe(2);
    // Ilman p2:ta funktio palaa aikaisin — washedTotal on silloin 0, ja se on
    // rehellinen: hinnoittelua ei ole olemassa, joten pestyjä ei lasketa rahaksi.
    expect(b.washedTotal).toBe(0);
  });
});
