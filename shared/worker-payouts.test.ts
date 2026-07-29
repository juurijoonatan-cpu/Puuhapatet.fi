/**
 * FR8 — tekijöiden maksettavan (worker-payouts.ts) yksikkötestit.
 *
 * Kriittisin invariantti: KELTAISET (P2) eivät koskaan vuoda punaisten
 * erämaksuun. Nämä testit lukitsevat sen — sekä eurot että ikkunamäärän, koska
 * maksudialogin esitäyttö käyttää ikkunamäärää.
 */
import { describe, it, expect } from "vitest";
import {
  computeWorkerSettlements, sumWorkerSettlements, eraSettlementByWorker,
  eraInvoiceGrossCents, isEraInvoiceSettled, isEraInvoicePending,
  p2InvoiceState, settleWorker, eraMapsFor,
} from "./worker-payouts";
import { emptyProjectData, type ProjectData } from "./project";
import { DEFAULT_WORKER_PER_WINDOW_CENTS, type CrewMember } from "./crew";
import type { P2State } from "./p2";

function member(over: Partial<CrewMember> & { id: string }): CrewMember {
  return {
    id: over.id,
    name: over.name ?? over.id,
    token: `t-${over.id}`,
    role: "worker",
    perWindowCents: DEFAULT_WORKER_PER_WINDOW_CENTS,
    active: true,
    agreements: [],
    payouts: [],
    ...over,
  } as CrewMember;
}

/**
 * Rakentaa projektin jossa on `red` punaista ja `yellow` keltaista ikkunaa
 * kerroksessa "1", kaikki pestyjä ja attribuoitu annetulle tekijälle.
 * Keltaisille lukitaan hinta `lockedCents`, jotta ne tuottavat P2-palkkion.
 */
function projectWith(opts: {
  workerId: string;
  red: number;
  yellow: number;
  lockedCents?: number;
  p2Enabled?: boolean;
  crew?: CrewMember[];
}): ProjectData {
  const p = emptyProjectData();
  p.building.floors = ["1"];
  const marks: Record<string, { marks: { x: number; y: number; p: 1 | 2 }[] }> = { "1": { marks: [] } };
  const statuses: Record<string, "pesty"> = {};
  const washedBy: Record<string, string> = {};
  const offers: P2State["offers"] = {};
  for (let i = 0; i < opts.red + opts.yellow; i++) {
    const isYellow = i >= opts.red;
    marks["1"].marks.push({ x: i, y: 0, p: isYellow ? 2 : 1 });
    const key = `1#${i}`;
    statuses[key] = "pesty";
    washedBy[key] = opts.workerId;
    if (isYellow) {
      offers[key] = {
        status: "locked", priceCents: opts.lockedCents ?? 3750, version: 1,
        lockedCents: opts.lockedCents ?? 3750,
      };
    }
  }
  p.marks = marks as any;
  p.statuses = statuses as any;
  p.washedBy = washedBy;
  p.crew = opts.crew ?? [member({ id: opts.workerId })];
  if (opts.p2Enabled !== false) {
    p.p2 = { enabled: true, workerSharePct: 53, offers, events: [] } as P2State;
  }
  return p;
}

describe("computeWorkerSettlements — punaiset ja keltaiset erillään", () => {
  it("laskee punaisten palkan omaan pottiinsa ja keltaiset omaansa", () => {
    // 10 punaista × 20 € = 200 €. 4 keltaista à 37,50 € → palkkiotaulukko 20 €/kpl = 80 €.
    const p = projectWith({ workerId: "jani", red: 10, yellow: 4, lockedCents: 3750 });
    const [row] = computeWorkerSettlements(p);
    expect(row.p1Washed).toBe(10);
    expect(row.p2Washed).toBe(4);
    expect(row.p1EarnedCents).toBe(200_00);
    expect(row.p2EarnedCents).toBe(80_00);
    // Maksettavaksi tarjotaan VAIN punaiset.
    expect(row.openP1Cents).toBe(200_00);
    expect(row.openP2Cents).toBe(80_00);
    expect(row.openP1Windows).toBe(10);
  });

  it("ei koskaan laske keltaisia ikkunoita punaisten erämaksun esitäyttöön", () => {
    const p = projectWith({ workerId: "jani", red: 3, yellow: 97, lockedCents: 3400 });
    const [row] = computeWorkerSettlements(p);
    expect(row.openP1Windows).toBe(3);       // EI 100
    expect(row.washed).toBe(100);            // kokonaismäärä säilyy raportointiin
  });

  it("kun vaihe 2 ei ole päällä, keltaiset maksetaan normaalilla taksalla (legacy)", () => {
    const p = projectWith({ workerId: "jani", red: 5, yellow: 5, p2Enabled: false });
    const [row] = computeWorkerSettlements(p);
    expect(row.p2EarnedCents).toBe(0);
    expect(row.p1EarnedCents).toBe(200_00);  // kaikki 10 ikkunaa × 20 €
    expect(row.openP1Windows).toBe(10);      // sama potti → kaikki maksettavana
  });

  it("erälaskulla hoidettu punainen velka ei näy enää siirrettävänä", () => {
    const p = projectWith({ workerId: "jani", red: 10, yellow: 4 });
    const invoices = [{
      kind: "tekija", tila: "hyväksytty", senderId: "jani", totalCents: 200_00,
      eraNumbers: [1, 2, 3], rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    }];
    const [row] = computeWorkerSettlements(p, { era: eraSettlementByWorker(invoices) });
    expect(row.eraSentCents).toBe(200_00);
    expect(row.openP1Cents).toBe(0);
    expect(row.openP1Windows).toBe(0);
    expect(row.settledEras).toEqual([1, 2, 3]);
    // Keltainen jää edelleen odottamaan omaa laskuaan — sitä ei kuitattu.
    expect(row.openP2Cents).toBe(80_00);
  });

  it("luonnos (tekijä ei ole vielä kuitannut) varaa velan, jottei maksua luoda kahdesti", () => {
    const p = projectWith({ workerId: "jani", red: 10, yellow: 0 });
    const invoices = [{
      kind: "tekija", tila: "luonnos", senderId: "jani", totalCents: 200_00,
      eraNumbers: [4], rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    }];
    const [row] = computeWorkerSettlements(p, { era: eraSettlementByWorker(invoices) });
    expect(row.eraPendingCents).toBe(200_00);
    expect(row.settledCents).toBe(0);        // ei vielä maksettu…
    expect(row.openP1Cents).toBe(0);         // …mutta ei myöskään uudelleen luotava
    expect(row.openP1Windows).toBe(0);
    expect(row.settledEras).toEqual([]);     // luonnos ei ole laskutettu erä
  });

  it("käsin kirjattu maksu kuittaa punaista velkaa ennen keltaista", () => {
    const p = projectWith({
      workerId: "jani", red: 10, yellow: 4,
      crew: [member({ id: "jani", payouts: [{ id: "p1", amountCents: 250_00, status: "maksettu", createdAt: 1 } as any] })],
    });
    const [row] = computeWorkerSettlements(p);
    expect(row.paidCents).toBe(250_00);
    expect(row.openP1Cents).toBe(0);         // 200 € punaista kuitattu
    expect(row.openP2Cents).toBe(30_00);     // ylivuoto 50 € meni keltaiseen (80 − 50)
  });

  it("hylätty erälasku ei kuittaa mitään", () => {
    const p = projectWith({ workerId: "jani", red: 10, yellow: 0 });
    const invoices = [{
      kind: "tekija", tila: "hylätty", senderId: "jani", totalCents: 200_00,
      eraNumbers: [4], rivit: { input: { pestytIkkunat: 10 } },
    }];
    const [row] = computeWorkerSettlements(p, { era: eraSettlementByWorker(invoices) });
    expect(row.openP1Cents).toBe(200_00);
    expect(row.openP1Windows).toBe(10);
  });

  it("perustajat jätetään tekijöiden maksulistalta pois oletuksena", () => {
    const p = projectWith({
      workerId: "joonatan", red: 10, yellow: 0,
      crew: [member({ id: "joonatan", role: "host" }), member({ id: "jani" })],
    });
    const rows = computeWorkerSettlements(p);
    expect(rows.map((r) => r.workerId)).toEqual(["jani"]);
    const withFounders = computeWorkerSettlements(p, { includeFounders: true });
    expect(withFounders.map((r) => r.workerId).sort()).toEqual(["jani", "joonatan"]);
  });

  it("jaettu ikkuna (washedBy2) puolittuu molemmille", () => {
    const p = projectWith({ workerId: "jani", red: 2, yellow: 0, crew: [member({ id: "jani" }), member({ id: "oona" })] });
    p.washedBy2 = { "1#0": "oona" };
    const rows = computeWorkerSettlements(p);
    const jani = rows.find((r) => r.workerId === "jani")!;
    const oona = rows.find((r) => r.workerId === "oona")!;
    expect(jani.p1Washed).toBe(1.5);
    expect(oona.p1Washed).toBe(0.5);
    expect(jani.p1EarnedCents + oona.p1EarnedCents).toBe(40_00);
  });

  it("sumWorkerSettlements summaa punaiset ja keltaiset erikseen", () => {
    const p = projectWith({
      workerId: "jani", red: 10, yellow: 4,
      crew: [member({ id: "jani" }), member({ id: "oona" })],
    });
    const t = sumWorkerSettlements(computeWorkerSettlements(p));
    expect(t.workers).toBe(2);
    expect(t.openP1Cents).toBe(200_00);
    expect(t.openP2Cents).toBe(80_00);
    expect(t.openP1Windows).toBe(10);
  });
});

describe("erälaskujen tila-apurit", () => {
  const base = { kind: "tekija", senderId: "jani", totalCents: 100_00, eraNumbers: [4] };

  it("vain lähetetty/hyväksytty on hoidettu, luonnos on odottava", () => {
    expect(isEraInvoiceSettled({ ...base, tila: "lähetetty" })).toBe(true);
    expect(isEraInvoiceSettled({ ...base, tila: "hyväksytty" })).toBe(true);
    expect(isEraInvoiceSettled({ ...base, tila: "luonnos" })).toBe(false);
    expect(isEraInvoiceSettled({ ...base, tila: "hylätty" })).toBe(false);
    expect(isEraInvoicePending({ ...base, tila: "luonnos" })).toBe(true);
    // Johtaja-välinen lasku ei ole tekijän maksu.
    expect(isEraInvoiceSettled({ ...base, kind: "johtaja_valinen", tila: "lähetetty" })).toBe(false);
  });

  it("velan kuittaus käyttää BRUTTO ansiota, ei ennakolla vähennettyä maksettavaa", () => {
    // Ansaittu 200 €, ennakko 50 € → totalCents (maksettava) 150 €. Velkaa
    // kuittautuu silti 200 €, koska ennakko oli osa samaa ansiota.
    const inv = { ...base, tila: "hyväksytty", totalCents: 150_00, rivit: { computed: { ansaittuCents: 200_00 } } };
    expect(eraInvoiceGrossCents(inv)).toBe(200_00);
    // Ilman computed-tietoa palataan totalCentsiin.
    expect(eraInvoiceGrossCents({ ...base, tila: "hyväksytty" })).toBe(100_00);
  });

  it("eraMapsFor kokoaa settleWorkerin tarvitsemat mapit", () => {
    const maps = eraMapsFor([
      { ...base, tila: "hyväksytty", eraNumbers: [1, 2, 3], rivit: { input: { pestytIkkunat: 5 }, computed: { ansaittuCents: 100_00 } } },
      { ...base, tila: "luonnos", eraNumbers: [4], rivit: { input: { pestytIkkunat: 3 }, computed: { ansaittuCents: 60_00 } } },
    ]);
    expect(maps.eraSent.jani).toBe(100_00);
    expect(maps.eraWindows.jani).toBe(5);
    expect(maps.eraNums.jani).toEqual([1, 2, 3]);
    expect(maps.eraPending.jani).toBe(60_00);
    expect(maps.eraPendingWindows.jani).toBe(3);
  });

  it("settleWorker antaa saman tuloksen valmiista statseista", () => {
    const row = settleWorker({
      id: "jani", name: "Jani", active: true, founder: false,
      stats: { washed: 14, earnedCents: 280_00, p1EarnedCents: 200_00, p2EarnedCents: 80_00, p1Washed: 10, p2Washed: 4 },
      payouts: [], p2Enabled: true, era: eraMapsFor([]),
    });
    expect(row.openP1Cents).toBe(200_00);
    expect(row.openP2Cents).toBe(80_00);
    expect(row.openP1Windows).toBe(10);
  });
});

describe("p2InvoiceState — asiakaslaskutuksen P1/P2-erottelu", () => {
  it("erottelee p2-maksut punaisten eristä eikä laske niitä 4 erän rajaan", () => {
    const payments = [
      { amountCents: 1575_00 },                       // erä 1 (ei scopea = p1)
      { amountCents: 1575_00, scope: "p1" as const },  // erä 2
      { amountCents: 170_00, scope: "p2" as const },   // keltaisten lasku
    ];
    const s = p2InvoiceState(500_00, payments);
    expect(s.p1Payments).toBe(2);
    expect(s.p1InvoicedCents).toBe(3150_00);
    expect(s.payments).toBe(1);
    expect(s.invoicedCents).toBe(170_00);
    expect(s.remainingCents).toBe(330_00);
  });

  it("ei koskaan palauta negatiivista laskuttamatonta", () => {
    const s = p2InvoiceState(100_00, [{ amountCents: 150_00, scope: "p2" }]);
    expect(s.remainingCents).toBe(0);
  });

  it("ilman maksuja koko kertymä on laskuttamatta", () => {
    const s = p2InvoiceState(170_00, []);
    expect(s.invoicedCents).toBe(0);
    expect(s.remainingCents).toBe(170_00);
    expect(s.p1Payments).toBe(0);
  });
});
