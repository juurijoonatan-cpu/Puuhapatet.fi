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

  it("erottaa hyväksyntää odottavan laskun ja laskuttamattoman velan", () => {
    // 10 punaista = 200 €. Luonnos kattaa puolet: 100 € odottaa tekijän
    // hyväksyntää, 100 € odottaa että johtaja tekee laskun. Ne odottavat eri
    // asiaa, joten ne ovat omina riveinään omilla selitteillään.
    const p = gig({ red: 10 });
    const draft: ReportEraInvoice = {
      id: 1, kind: "tekija", tila: "luonnos", senderId: "jani", recipientId: "matias",
      totalCents: 100_00, eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 5 }, computed: { ansaittuCents: 100_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [draft] });
    const jani = r.workers.find((w) => w.workerId === "jani")!;
    expect(jani.pendingCents).toBe(100_00);
    expect(jani.openTotalCents).toBe(100_00);
    // Avointa velkaa on → tekijä ei ole "hyväksytty" vaan laskua puuttuu.
    expect(jani.approval).toBe("ei_laskua");

    const lines = r.instructions.filter((i) => i.toId === "jani");
    expect(lines.map((l) => l.status).sort()).toEqual(["lasku_tekematta", "odottaa_hyvaksyntaa"]);
    expect(lines.every((l) => l.fromId === "matias")).toBe(true);  // laskun ostaja
    expect(r.awaitingApprovalCents).toBe(100_00);
    expect(r.missingInvoiceCents).toBe(100_00);
    expect(r.blockedCents).toBe(200_00);
    // Otsikkoluku ei tipu siitä että lasku on tehty — raha ei ole vielä liikkunut.
    expect(r.workerOpenTotalCents).toBe(200_00);
  });

  it("luonnos yhdessä virrassa ei leimaa toisen virran velkaa hyväksyntää odottavaksi", () => {
    // Punaisten luonnos kattaa punaiset kokonaan; tuntityö on yhä laskuttamatta.
    // Ennen tämä rivi luki "Tekijä ei ole vielä hyväksynyt laskuaan" tunneista,
    // joista ei ollut olemassa yhtään laskua.
    const p = gig({ red: 10, shifts: [{ id: "s1", worker: "jani", day: "2026-01-02", hours: 4, at: 1 }] });
    const draft: ReportEraInvoice = {
      id: 1, kind: "tekija", tila: "luonnos", senderId: "jani", recipientId: "joonatan",
      totalCents: 200_00, eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [draft] });
    const jani = r.workers.find((w) => w.workerId === "jani")!;
    expect(jani.openP1Cents).toBe(0);
    expect(jani.openHoursCents).toBe(60_00);
    const hoursLine = r.instructions.find((i) => i.toId === "jani" && i.status === "lasku_tekematta")!;
    expect(hoursLine.cents).toBe(60_00);
    expect(hoursLine.why).toContain("4 h ×");
  });

  it("selite laskee jäljellä olevista ikkunoista, ei koko pestystä määrästä", () => {
    // 20 pestyä = 400 €. Puolet maksettu → jäljellä 200 € = 10 ikkunaa.
    // "20 ikkunaa 200,00 €" väittäisi 10 €/ikkuna työstä joka on 20 €/ikkuna.
    const p = gig({ red: 20 });
    const paid: ReportEraInvoice = {
      id: 7, kind: "tekija", tila: "hyväksytty", senderId: "jani", recipientId: "joonatan",
      totalCents: 200_00, eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [paid] });
    const line = r.instructions.find((i) => i.toId === "jani")!;
    expect(line.cents).toBe(200_00);
    expect(line.why).toContain("10 ikkunaa");
    expect(line.why).not.toContain("20 ikkunaa");
  });

  it("selite laskee jäljellä olevista tunneista, ei koko keikan tunneista", () => {
    const p = gig({ shifts: [{ id: "s1", worker: "jani", day: "2026-01-02", hours: 20, at: 1 }] });
    const part: ReportEraInvoice = {
      id: 4, kind: "tekija", tila: "hyväksytty", senderId: "jani", recipientId: "joonatan",
      totalCents: 225_00, eraNumbers: [...HOURS_ERA_NUMBERS],
      rivit: { input: { tunnit: 15 }, computed: { ansaittuCents: 225_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [part] });
    const line = r.instructions.find((i) => i.toId === "jani")!;
    expect(line.cents).toBe(75_00);              // 5 h × 15 €
    expect(line.why).toContain("5 h ×");
    expect(line.why).not.toContain("20 h");
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

  it("pitää keltaisten luonnoksen näkyvissä — siirrettävä ei tipu ennen rahaa", () => {
    // Keltaisten luonnos varaa velan, joten avoin summa on nolla. Ilman
    // `p2InvoicePendingCents`iä koko tekijä katosi raportilta ja otsikko sanoi
    // "kaikki maksettu ✓" ennen kuin senttiäkään oli liikkunut.
    const p = gig({ red: 0 });
    p.marks = { "1": { marks: [{ x: 0, y: 0, p: 2 }] } } as any;
    p.statuses = { "1#0": "pesty" } as any;
    p.washedBy = { "1#0": "jani" };
    p.p2 = {
      enabled: true, workerSharePct: 53, events: [],
      offers: { "1#0": { status: "locked", priceCents: 3750, version: 1, lockedCents: 3750 } },
    } as any;
    const draft: ReportEraInvoice = {
      id: 6, kind: "tekija", tila: "luonnos", senderId: "jani", recipientId: "joonatan",
      totalCents: 20_00, eraNumbers: [0],
      rivit: { input: { pestytIkkunat: 1 }, computed: { ansaittuCents: 20_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [draft] });
    const jani = r.workers.find((w) => w.workerId === "jani");
    expect(jani).toBeDefined();
    expect(jani!.openP2Cents).toBe(0);            // luonnos varasi velan
    expect(jani!.pendingCents).toBe(20_00);       // …ja se näkyy tässä
    expect(jani!.approval).toBe("odottaa_tekijaa");
    expect(r.awaitingApprovalCents).toBe(20_00);
    expect(r.workerOpenTotalCents).toBe(20_00);
  });

  it("pitää pelkän tuntiluonnoksen tekijän raportilla", () => {
    // Aiemmin suodatin katsoi vain punaisten luonnoksia, joten tekijä jonka
    // ainoa tapahtuma oli tuntityön luonnos katosi raportilta kokonaan.
    const p = gig({ shifts: [{ id: "s1", worker: "jani", day: "2026-01-02", hours: 10, at: 1 }] });
    const draft: ReportEraInvoice = {
      id: 5, kind: "tekija", tila: "luonnos", senderId: "jani", recipientId: "joonatan",
      totalCents: 150_00, eraNumbers: [...HOURS_ERA_NUMBERS],
      rivit: { input: { tunnit: 10 }, computed: { ansaittuCents: 150_00 } },
    };
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [draft] });
    const jani = r.workers.find((w) => w.workerId === "jani");
    expect(jani).toBeDefined();
    expect(jani!.pendingCents).toBe(150_00);
    expect(jani!.approval).toBe("odottaa_tekijaa");
    expect(r.awaitingApprovalCents).toBe(150_00);
    expect(r.workerOpenTotalCents).toBe(150_00);
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

  it("varoittaa että johtajasiirto on väliaikainen kun tekijöille on velkaa", () => {
    // Joonatan sai 1575 €, Janille on maksamatta 200 €. Tasaus jakaa
    // maksamattoman velan tasan, joten siirto on liian iso siihen asti kun
    // tekijät on maksettu — juuri näin siirretään vahingossa liikaa.
    const p = gig({ red: 10 });
    const r = buildTransferReport({
      title: "T", project: p, payments: [payment(1575_00, "joonatan")], invoices: [],
    });
    const founderLine = r.instructions.find((i) => i.kind === "founder")!;
    expect(r.reserveCents).toBeGreaterThan(0);
    expect(founderLine.status).toBe("maksa_tekijat_ensin");
    expect(founderLine.blocked).toBe(true);
    expect(founderLine.why).toContain("maksa tekijät ensin");
    // Tekijät maksettu → varoitus poistuu ja siirto on valmis tehtäväksi.
    const paid: ReportEraInvoice = {
      id: 9, kind: "tekija", tila: "hyväksytty", senderId: "jani", recipientId: "joonatan",
      totalCents: 200_00, eraNumbers: [1, 2, 3],
      rivit: { input: { pestytIkkunat: 10 }, computed: { ansaittuCents: 200_00 } },
    };
    const after = buildTransferReport({
      title: "T", project: p, payments: [payment(1575_00, "joonatan")], invoices: [paid],
    });
    const afterLine = after.instructions.find((i) => i.kind === "founder")!;
    expect(afterLine.status).toBe("valmis");
    expect(afterLine.blocked).toBe(false);
    // …ja siirto on PIENEMPI kuin ennen tekijöiden maksua.
    expect(afterLine.cents).toBeLessThan(founderLine.cents);
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
    expect(r.founders.map((f) => f.id).sort()).toEqual(["joonatan", "matias"]);
  });

  it("erittelee asiakaslaskutuksen virroittain eikä lue tuntilaskua urakaksi", () => {
    const p = gig({ red: 10 });
    const r = buildTransferReport({
      title: "T",
      project: p,
      payments: [
        { t: 1, amountCents: 1575_00, scope: "p1", biller: { id: "joonatan" } },
        { t: 2, amountCents: 950_00, scope: "hours", biller: { id: "joonatan" } },
        { t: 3, amountCents: 300_00, scope: "all", parts: { hours: 120_00, p2: 80_00 }, biller: { id: "matias" } },
      ],
      invoices: [],
    });
    expect(r.p1InvoicedCents).toBe(1675_00);     // 1575 + (300 − 120 − 80)
    expect(r.hoursInvoicedCents).toBe(1070_00);  // 950 + 120
    expect(r.p2InvoicedCents).toBe(80_00);
    expect(r.invoicedTotalCents).toBe(2825_00);  // jokainen euro kerran
  });

  it("ei listaa harjoittelijaa siirtona — hänelle ei voi tehdä laskua", () => {
    // Harjoittelija ei laskuta meitä; hänen palkkansa tilittää vastuujohtaja.
    // Jos hän olisi listalla, siirtoa ei saisi tehtyä mistään.
    const p = gig({
      red: 10, workerId: "milja",
      crew: [member("milja", { name: "Milja" })],
    });
    const r = buildTransferReport({ title: "T", project: p, payments: [], invoices: [] });
    expect(r.workers.some((w) => w.workerId === "milja")).toBe(false);
    expect(r.instructions.filter((i) => i.kind === "worker")).toEqual([]);
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
