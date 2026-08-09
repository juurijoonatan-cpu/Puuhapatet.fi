import { describe, expect, it } from "vitest";
import { p2WorkerSplit, type P2Offer, type P2State } from "./p2";
import type { ProjectData, WindowStatus } from "./project";

/**
 * VARTIJA. Tekijän kortilla luki "€ / ikkuna", ja se oli ansio jaettuna
 * KAIKILLA pestyillä ikkunoilla — myös niillä keltaisilla joista asiakas ei ole
 * hyväksynyt hintaa ja joista ei siis makseta vielä mitään. Kaksi tekijää
 * samalla taksalla näyttivät ansaitsevan eri verran ikkunaa kohti, ja enemmän
 * pessyt näytti tienaavan vähemmän.
 *
 * Nyt kortti näyttää osat, ja ne tulevat tästä funktiosta. Nämä testit
 * lukitsevat sen mikä on rahaa ja mikä ei: SOVITTU maksetaan, ODOTTAVA ei.
 */

function project(
  pts: { p: 1 | 2; status?: WindowStatus; by?: string; by2?: string; offer?: P2Offer }[],
  opts: { enabled?: boolean } = {},
): ProjectData {
  const marks = { "1": { marks: pts.map((_, i) => ({ p: pts[i].p, x: i, y: i })) } };
  const statuses: Record<string, WindowStatus> = {};
  const washedBy: Record<string, string> = {};
  const washedBy2: Record<string, string> = {};
  const offers: Record<string, P2Offer> = {};
  pts.forEach((pt, i) => {
    const key = `1#${i}`;
    if (pt.status) statuses[key] = pt.status;
    if (pt.by) washedBy[key] = pt.by;
    if (pt.by2) washedBy2[key] = pt.by2;
    if (pt.offer) offers[key] = pt.offer;
  });
  const p2: P2State = {
    enabled: opts.enabled !== false, workerSharePct: 50, offers, events: [],
    // 34 € → 18 €, 37,50 € → 20 € (samat kuin FR8:n palkkiotaulukossa).
    payoutSchedule: [{ priceCents: 3400, payoutCents: 1800 }, { priceCents: 3750, payoutCents: 2000 }],
  };
  return {
    building: { name: null, address: null, floors: ["1"], planBase: "/x/" },
    marks, statuses, washedBy, washedBy2, customMarks: {}, posOverrides: {}, deleted: {},
    log: [], hours: {}, hourLog: [], workers: [], p2,
  } as unknown as ProjectData;
}

const locked = (c: number): P2Offer => ({ status: "locked", priceCents: c, lockedCents: c, version: 2, updatedAt: 0 });
const proposed = (c: number): P2Offer => ({ status: "proposed", priceCents: c, version: 1, updatedAt: 0 });

describe("p2WorkerSplit", () => {
  it("sovittu keltainen maksaa palkkiotaulukon mukaan", () => {
    const s = p2WorkerSplit(project([
      { p: 2, status: "pesty", by: "petrus", offer: locked(3400) },
      { p: 2, status: "pesty", by: "petrus", offer: locked(3750) },
    ]));
    expect(s.earnedCents.petrus).toBe(3800);   // 18 € + 20 €
    expect(s.pendingCents.petrus).toBeUndefined();
  });

  it("HYVÄKSYMÄTÖN keltainen ei ole ansiota — se on omassa laskurissaan", () => {
    // Juuri tämä sai enemmän pesseen näyttämään pienempituottoiselta.
    const s = p2WorkerSplit(project([
      { p: 2, status: "pesty", by: "petrus", offer: proposed(3400) },
      { p: 2, status: "pesty", by: "petrus", offer: proposed(3400) },
    ]));
    expect(s.earnedCents.petrus).toBeUndefined();
    expect(s.pendingCents.petrus).toBe(3600);
    expect(s.pendingCount.petrus).toBe(2);
  });

  it("kaksi tekijää samalla taksalla: enemmän pessyt ei voi ansaita vähemmän samasta työstä", () => {
    // Petrus pesi 4 keltaista, Oona 2 — mutta Petruksen kahta ei ole hyväksytty.
    const p = project([
      { p: 2, status: "pesty", by: "petrus", offer: locked(3400) },
      { p: 2, status: "pesty", by: "petrus", offer: locked(3400) },
      { p: 2, status: "pesty", by: "petrus", offer: proposed(3400) },
      { p: 2, status: "pesty", by: "petrus", offer: proposed(3400) },
      { p: 2, status: "pesty", by: "oona", offer: locked(3400) },
      { p: 2, status: "pesty", by: "oona", offer: locked(3400) },
    ]);
    const s = p2WorkerSplit(p);
    // Maksussa sama summa samasta määrästä hyväksyttyä työtä.
    expect(s.earnedCents.petrus).toBe(s.earnedCents.oona);
    // Ero on odottavassa rahassa, ei taksassa — ja se näkyy nyt omana lukunaan.
    expect(s.pendingCents.petrus).toBe(3600);
    expect(s.pendingCents.oona).toBeUndefined();
  });

  it("kahdestaan pesty ikkuna jakautuu tasan", () => {
    const s = p2WorkerSplit(project([
      { p: 2, status: "pesty", by: "petrus", by2: "oona", offer: locked(3400) },
      { p: 2, status: "pesty", by: "petrus", by2: "oona", offer: proposed(3750) },
    ]));
    expect(s.earnedCents.petrus).toBe(900);
    expect(s.earnedCents.oona).toBe(900);
    expect(s.pendingCents.petrus).toBe(1000);
    expect(s.pendingCents.oona).toBe(1000);
    expect(s.pendingCount.petrus).toBe(0.5);
    expect(s.pendingCount.oona).toBe(0.5);
  });

  it("pesemätön tai punainen ei tuo mitään", () => {
    const s = p2WorkerSplit(project([
      { p: 2, by: "petrus", offer: locked(3400) },              // sovittu, pesemätön
      { p: 1, status: "pesty", by: "petrus" },                   // punainen
      { p: 2, status: "pesty", by: "petrus" },                   // pesty, ei hintaa
    ]));
    expect(s.earnedCents).toEqual({});
    expect(s.pendingCents).toEqual({});
  });

  it("hylätty keltainen ei ole odottavaa rahaa", () => {
    const declined: P2Offer = { status: "declined", priceCents: 3400, version: 2, updatedAt: 0 };
    const s = p2WorkerSplit(project([{ p: 2, status: "pesty", by: "petrus", offer: declined }]));
    expect(s.pendingCents).toEqual({});
    expect(s.pendingCount).toEqual({});
  });

  it("ilman vaihetta 2 kaikki on tyhjää", () => {
    const p = project([{ p: 2, status: "pesty", by: "petrus", offer: locked(3400) }]);
    (p.p2 as { enabled: boolean }).enabled = false;
    expect(p2WorkerSplit(p)).toEqual({ earnedCents: {}, pendingCents: {}, pendingCount: {} });
  });
});
