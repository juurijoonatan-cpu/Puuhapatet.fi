import { describe, expect, it } from "vitest";
import { computeP2Billing, p2WorkerSplit, type P2Offer, type P2State } from "./p2";
import type { ProjectData, WindowStatus } from "./project";

/**
 * VARTIJA. PERUSTAJA SAA OMASTA IKKUNASTAAN KOKO HINNAN.
 *
 * Palkkiotaulukko (34 € → 18 €) on TYÖNTEKIJÄN palkka: erotus jää yritykselle
 * katteeksi, joka jaetaan perustajien kesken. Kun perustaja pesee ikkunan itse,
 * palkattavaa ei ole — koko hinta on hänen.
 *
 * Punaisissa näin on aina ollut (perustaja saa 37,50 €/ikkuna, ei työntekijän
 * taksaa). Keltaisissa ei ollut, ja siksi 16,5 itse pestyä keltaista näytti
 * tuottavan 300,50 € kun sen olisi pitänyt olla yli 560 €.
 *
 * Raha ei varsinaisesti kadonnut — puuttuva osa palasi "osuutena katteesta",
 * MUTTA puoliksi jaettuna toisen perustajan kanssa. Itse tehty työ valui siis
 * puoliksi kumppanille.
 *
 * Tärkein testi tässä tiedostossa on VIIMEINEN: euroja ei saa syntyä eikä
 * kadota. Kaikki mitä asiakas maksaa menee jollekin.
 */

const FOUNDERS = new Set(["joonatan", "matias"]);
const isFounder = (id: string) => FOUNDERS.has(id);

function project(
  pts: { status?: WindowStatus; by?: string; by2?: string; cents?: number; locked?: boolean }[],
): ProjectData {
  const marks = { "1": { marks: pts.map((_, i) => ({ p: 2 as const, x: i, y: i })) } };
  const statuses: Record<string, WindowStatus> = {};
  const washedBy: Record<string, string> = {};
  const washedBy2: Record<string, string> = {};
  const offers: Record<string, P2Offer> = {};
  pts.forEach((pt, i) => {
    const key = `1#${i}`;
    if (pt.status) statuses[key] = pt.status;
    if (pt.by) washedBy[key] = pt.by;
    if (pt.by2) washedBy2[key] = pt.by2;
    if (pt.cents) {
      offers[key] = pt.locked === false
        ? { status: "proposed", priceCents: pt.cents, version: 1, updatedAt: 0 }
        : { status: "locked", priceCents: pt.cents, lockedCents: pt.cents, version: 2, updatedAt: 0 };
    }
  });
  const p2: P2State = {
    enabled: true, workerSharePct: 50, offers, events: [],
    payoutSchedule: [{ priceCents: 3400, payoutCents: 1800 }],
  };
  return {
    building: { name: null, address: null, floors: ["1"], planBase: "/x/" },
    marks, statuses, washedBy, washedBy2, customMarks: {}, posOverrides: {}, deleted: {},
    log: [], hours: {}, hourLog: [], workers: [], p2,
  } as unknown as ProjectData;
}

const W = (over = {}) => ({ status: "pesty" as WindowStatus, cents: 3400, ...over });

describe("perustajan keltaiset", () => {
  it("PERUSTAJA SAA KOKO HINNAN, työntekijä palkkiotaulukon mukaan", () => {
    const s = p2WorkerSplit(project([W({ by: "joonatan" }), W({ by: "petrus" })]), { isFounder });
    expect(s.earnedCents.joonatan).toBe(3400);   // koko 34 €
    expect(s.earnedCents.petrus).toBe(1800);     // taulukon 18 €
  });

  it("perustajan omasta ikkunasta EI jää katetta jaettavaksi", () => {
    // Koko hinta on jo hänen; kate olisi saman rahan laskemista kahdesti.
    const b = computeP2Billing(project([W({ by: "joonatan" })]), { isFounder });
    expect(b.earnedCents).toBe(3400);
    expect(b.workerCostCents).toBe(3400);
    expect(b.marginCents).toBe(0);
  });

  it("työntekijän ikkunasta kate on erotus — se on yhä olemassa", () => {
    const b = computeP2Billing(project([W({ by: "petrus" })]), { isFounder });
    expect(b.workerCostCents).toBe(1800);
    expect(b.marginCents).toBe(1600);
  });

  it("puoliksi tehty ikkuna arvotetaan kummankin OMALLA säännöllään", () => {
    // Perustaja + työntekijä samassa ikkunassa ei ole sama kuin kaksi samaa:
    // perustajan puolikas on 17,00 €, työntekijän 9,00 €.
    const p = project([W({ by: "joonatan", by2: "petrus" })]);
    const s = p2WorkerSplit(p, { isFounder });
    expect(s.earnedCents.joonatan).toBe(1700);
    expect(s.earnedCents.petrus).toBe(900);
    const b = computeP2Billing(p, { isFounder });
    expect(b.workerCostCents).toBe(2600);
    expect(b.marginCents).toBe(800);            // 34,00 − 26,00
  });

  it("sama sääntö koskee hyväksyntää odottavaa rahaa", () => {
    const p = project([W({ by: "joonatan", locked: false }), W({ by: "petrus", locked: false })]);
    const s = p2WorkerSplit(p, { isFounder });
    expect(s.pendingCents.joonatan).toBe(3400);
    expect(s.pendingCents.petrus).toBe(1800);
    const b = computeP2Billing(p, { isFounder });
    expect(b.pendingWorkerCostCents).toBe(5200);
  });

  it("ILMAN isFounderia käytös on entinen — kutsuja joka ei tunne perustajia", () => {
    // Tekijän oma näkymä ei tiedä kuka on perustaja eikä sen tarvitse. Se ei
    // saa vahingossa alkaa näyttää eri lukua kuin ennen.
    const s = p2WorkerSplit(project([W({ by: "joonatan" })]));
    expect(s.earnedCents.joonatan).toBe(1800);
    expect(computeP2Billing(project([W({ by: "joonatan" })])).marginCents).toBe(1600);
  });

  it("pesemätön ei maksa kenellekään mitään, vaikka hinta olisi sovittu", () => {
    const p = project([{ by: "joonatan", cents: 3400 }]);
    expect(p2WorkerSplit(p, { isFounder }).earnedCents).toEqual({});
    expect(computeP2Billing(p, { isFounder }).workerCostCents).toBe(0);
  });

  it("EUROJA EI SYNNY EIKÄ KADOTA — kaikki mitä asiakas maksaa menee jollekin", () => {
    // Tämä on koko muutoksen turvaverkko. Sekalainen joukko: perustajia,
    // työntekijöitä, jaettuja ikkunoita ja eri hintoja.
    const p = project([
      W({ by: "joonatan" }),
      W({ by: "matias", cents: 5000 }),
      W({ by: "petrus" }),
      W({ by: "oona", cents: 3750 }),
      W({ by: "joonatan", by2: "petrus", cents: 4200 }),
      W({ by: "matias", by2: "joonatan" }),
    ]);
    const b = computeP2Billing(p, { isFounder });
    const s = p2WorkerSplit(p, { isFounder });
    const paidOut = Object.values(s.earnedCents).reduce((a, v) => a + v, 0);
    // Jokainen sentti on joko jonkun palkkaa tai perustajien katetta.
    expect(Math.round(paidOut) + b.marginCents).toBe(b.earnedCents);
    // …ja kate ei voi olla negatiivinen: kukaan ei saa enempää kuin ikkuna maksoi.
    expect(b.marginCents).toBeGreaterThanOrEqual(0);
  });

  it("perustaja ei häviä sillä että kumppani pesi enemmän", () => {
    // Vanhalla säännöllä Joonatanin 16,5 omaa ikkunaa tuottivat hänelle vain
    // työntekijän taksan, ja loput valuivat puoliksi Matiakselle. Nyt oma työ
    // on omaa: kaksi yhtä paljon pessyttä saa saman, eikä kumpikaan enempää
    // toisen työstä.
    const p = project([W({ by: "joonatan" }), W({ by: "matias" })]);
    const s = p2WorkerSplit(p, { isFounder });
    expect(s.earnedCents.joonatan).toBe(s.earnedCents.matias);
    expect(computeP2Billing(p, { isFounder }).marginCents).toBe(0);
  });
});
