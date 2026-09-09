/**
 * SIIRTORAPORTIN yksikkötestit.
 *
 * Raportti vastaa yhteen kysymykseen — "kenelle siirrän ja paljonko" — ja
 * kolme asiaa pitää olla varmasti oikein, koska niiden mukaan liikkuu rahaa:
 *
 *   1. jokaisen tekijän osuus on ERITELTY (ikkunat, keltaiset, tunnit),
 *   2. siirtoa EI esitetä tehtynä ennen kuin tekijä on hyväksynyt laskunsa,
 *   3. johtajien keskinäinen siirto on mukana samalla listalla.
 */
import { describe, it, expect } from "vitest";
import { buildTransferReport, type ReportEraInvoice } from "./transfer-report";
import { HOURS_ERA_NUMBERS } from "./era-billing";
import { emptyProjectData, type ProjectData, type ProjShift } from "./project";
import { DEFAULT_WORKER_PER_WINDOW_CENTS, type CrewMember } from "./crew";
import type { TasausPayment } from "./fr8-tasaus";

function member(id: string, over: Partial<CrewMember> = {}): CrewMember {
  return {
    id, name: id, token: `t-${id}`, role: "worker",
    perWindowCents: DEFAULT_WORKER_PER_WINDOW_CENTS,
    active: true, agreements: [], payouts: [], ...over,
  } as CrewMember;
}

function gig(opts: { red?: number; workerId?: string; shifts?: ProjShift[]; crew?: CrewMember[] } = {}): ProjectData {
  const p = emptyProjectData();
  const workerId = opts.workerId ?? "jani";
  p.building.floors = ["1"];
  const marks: any = { "1": { marks: [] } };
  const statuses: any = {};
  const washedBy: Record<string, string> = {};
  for (let i = 0; i < (opts.red ?? 0); i++) {
    marks["1"].marks.push({ x: i, y: 0, p: 1 });
    statuses[`1#${i}`] = "pesty";
    washedBy[`1#${i}`] = workerId;
  }
  p.marks = marks;
  p.statuses = statuses;
  p.washedBy = washedBy;
  p.crew = opts.crew ?? [member(workerId)];
  p.shifts = opts.shifts ?? [];
  p.billingMode = "hourly";   // tuntipalkka lasketaan vain tuntitilassa
  return p;
}

const payment = (amountCents: number, billerId: string): TasausPayment =>
  ({ t: Date.now(), amountCents, biller: { id: billerId } });

describe("buildTransferReport", () => {
  it("erittelee kunkin tekijän osuuden ja kertoo kuka siirtää", () => {
    // 20 punaista × 20 € = 400 € + 6 h × 15 € = 90 € → 490 € Janille.
    const p = gig({ red: 20, shifts: [{ id: "s1", worker: "jani", day: "2026-01-02", hours: 6, at: 1 }] });
    const r = buildTransferReport({
      title: "Testikeikka",
      project: p,
      payments: [payment(1575_00, "joonatan")],
      invoices: [],
    });
    const jani = r.workers.find((w) => w.workerId === "jani")!;
    expect(jani.openP1Cents).toBe(400_00);
    expect(jani.openHoursCents).toBe(90_00);
    expect(jani.openTotalCents).toBe(490_00);
    expect(r.workerOpenTotalCents).toBe(490_00);

    const toJani = r.instructions.find((i) => i.toId === "jani")!;
    expect(toJani.kind).toBe("worker");
    expect(toJani.cents).toBe(490_00);
    // Maksaja luetaan viimeisimmän asiakaserän saajasta kun laskua ei vielä ole.
    expect(toJani.fromId).toBe("joonatan");
    expect(toJani.why).toContain("ikkunaa");
    expect(toJani.why).toContain("h ×");
  });

  it("estää siirron kunnes tekijä on hyväksynyt laskunsa", () => {
    const p = gig({ red: 10 });
    const draft: ReportEraInvoice = {
      id: 1, kind: "tekija", tila: "luonnos", senderId: "jani", recipientId: "matias",
      totalCents: 100_00, eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 5 }, computed: { ansaittuCents: 100_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [draft] });
    const jani = r.workers.find((w) => w.workerId === "jani")!;
    expect(jani.approval).toBe("odottaa_tekijaa");
    // Luonnos varaa puolet velasta, loput 100 € on yhä siirrettävää.
    expect(jani.openTotalCents).toBe(100_00);
    const line = r.instructions.find((i) => i.toId === "jani")!;
    expect(line.blocked).toBe(true);
    expect(line.fromId).toBe("matias");        // laskun ostaja voittaa erän saajan
    expect(r.blockedCents).toBe(100_00);
  });

  it("merkitsee tekijän hyväksytyksi kun velka on kokonaan katettu", () => {
    const p = gig({ red: 10 });
    const sent: ReportEraInvoice = {
      id: 2, kind: "tekija", tila: "hyväksytty", senderId: "jani", recipientId: "joonatan",
      totalCents: 200_00, eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [sent] });
    const jani = r.workers.find((w) => w.workerId === "jani")!;
    expect(jani.openTotalCents).toBe(0);
    expect(jani.approval).toBe("hyvaksytty");
    expect(r.instructions.filter((i) => i.kind === "worker")).toEqual([]);
    expect(r.blockedCents).toBe(0);
  });

  it("laskee tuntipotin maksun tekijän tuntivelkaa vastaan", () => {
    const p = gig({ shifts: [{ id: "s1", worker: "jani", day: "2026-01-02", hours: 10, at: 1 }] });
    const paid: ReportEraInvoice = {
      id: 3, kind: "tekija", tila: "lähetetty", senderId: "jani", recipientId: "joonatan",
      totalCents: 150_00, eraNumbers: [...HOURS_ERA_NUMBERS],
      rivit: { input: { tunnit: 10 }, computed: { ansaittuCents: 150_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [paid] });
    const jani = r.workers.find((w) => w.workerId === "jani")!;
    expect(jani.openHoursCents).toBe(0);
    expect(jani.settledCents).toBe(150_00);
    expect(r.workerOpenTotalCents).toBe(0);
  });

  it("ottaa johtajien tasauksen samalle siirtolistalle", () => {
    // Joonatan laskutti ja sai koko 1575 €, kummallakaan ei ole omaa pesutyötä
    // → puolet kuuluu Matiakselle, ja se näkyy siirtona.
    const p = gig({ red: 10 });
    const r = buildTransferReport({
      title: "T", project: p, payments: [payment(1575_00, "joonatan")], invoices: [],
    });
    expect(r.founderTransfer).not.toBeNull();
    expect(r.founderTransfer!.fromId).toBe("joonatan");
    expect(r.founderTransfer!.toId).toBe("matias");
    const founderLine = r.instructions.find((i) => i.kind === "founder")!;
    expect(founderLine.cents).toBe(r.founderTransfer!.cents);
    expect(founderLine.blocked).toBe(false);
    expect(r.founders.map((f) => f.id).sort()).toEqual(["joonatan", "matias"]);
  });

  it("kertoo viimeisimmän asiakaslaskun ja laskutuksen yhteensä", () => {
    const p = gig({ red: 10 });
    const r = buildTransferReport({
      title: "Kiinteistö Oy",
      project: p,
      payments: [payment(1575_00, "joonatan"), payment(1575_00, "matias")],
      invoices: [],
    });
    expect(r.title).toBe("Kiinteistö Oy");
    expect(r.invoicedTotalCents).toBe(3150_00);
    expect(r.latestInvoice?.amountCents).toBe(1575_00);
  });

  it("tyhjä keikka ei tuota yhtään siirtoa eikä kaadu", () => {
    const r = buildTransferReport({ title: "Tyhjä", project: gig(), payments: [], invoices: [] });
    expect(r.instructions).toEqual([]);
    expect(r.workerOpenTotalCents).toBe(0);
    expect(r.invoicedTotalCents).toBe(0);
    expect(r.latestInvoice).toBeNull();
  });
});
