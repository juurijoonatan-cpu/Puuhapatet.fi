import { describe, expect, it } from "vitest";
import {
  normalizeManualInvoices, reconcileManualInvoices, parseEuroInput, manualInvoiceTime, buildManualHoursPayments,
} from "./manual-hours-invoice";
import { computeHoursPeriod, buildHoursCover, isHoursStreamPayment } from "./hours-period";
import { emptyProjectData, type ProjectData, type ProjShift } from "./project";
import { livePayments } from "./gig";

/**
 * KÄSIN KIRJATUT TUNTILASKUT.
 *
 * Tilanne: kaksi laskua on lähetetty järjestelmän ulkopuolella yhteensä n. 9 000 €.
 * Ne kirjataan järjestelmään omilla summillaan, ja sen jälkeen (1) avoimet tunnit
 * ja seuraavan laskun summa nollautuvat, (2) laskutettu-luku on kirjattujen
 * summien summa, ei järjestelmän arvio, ja (3) uusi työ kertyy taas seuraavalle.
 */

const T0 = 1_800_000_000_000;
let n = 0;
function shift(worker: string, hours: number, day = "2026-10-01"): ProjShift {
  n += 1;
  return { id: `s${n}`, worker, day, hours, at: T0 };
}
function gig(shifts: ProjShift[]): ProjectData {
  return { ...emptyProjectData(), billingMode: "hourly", shifts, expenses: [] } as ProjectData;
}

/** Kirjaus kuten palvelin sen tekee. */
function record(project: ProjectData, existing: any[], amounts: number[], t: number) {
  const period = computeHoursPeriod(project, existing, { uninvoicedWindows: 0 });
  const cover = buildHoursCover(project, { windowsCents: 0 });
  const made = buildManualHoursPayments({
    invoices: amounts.map((a) => ({ amountCents: a, billerId: "joonatan" })),
    t, countThrough: 0, cover: { hours: cover.hours, expenseIds: cover.expenseIds },
    windowsCents: period.lifetime.windowsCents,
  });
  return { period, made };
}

describe("normalizeManualInvoices", () => {
  it("hyväksyy kaksi laskua ja summaa ne", () => {
    const r = normalizeManualInvoices([
      { amountCents: 462_000, billerId: "joonatan", ref: " 1001 " },
      { amountCents: 468_550, billerId: "matias" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalCents).toBe(930_550);
      expect(r.invoices[0].ref).toBe("1001");
      expect(r.invoices[1].ref).toBeUndefined();
    }
  });
  it("hylkää tyhjän, nollasumman ja tuntemattoman laskuttajan", () => {
    expect(normalizeManualInvoices([]).ok).toBe(false);
    expect(normalizeManualInvoices(undefined).ok).toBe(false);
    expect(normalizeManualInvoices([{ amountCents: 0, billerId: "joonatan" }]).ok).toBe(false);
    expect(normalizeManualInvoices([{ amountCents: -5, billerId: "joonatan" }]).ok).toBe(false);
    expect(normalizeManualInvoices([{ amountCents: 1000, billerId: "" }]).ok).toBe(false);
    expect(normalizeManualInvoices([{ amountCents: 1000, billerId: "joku-muu" }]).ok).toBe(false);
    expect(normalizeManualInvoices([{ amountCents: 1e12, billerId: "joonatan" }]).ok).toBe(false);
  });
  it("rajoittaa laskujen määrän", () => {
    const rows = Array.from({ length: 7 }, () => ({ amountCents: 100, billerId: "joonatan" }));
    expect(normalizeManualInvoices(rows).ok).toBe(false);
  });
});

describe("reconcileManualInvoices", () => {
  it("täsmää → ei eroa, seuraava lasku nolla", () => {
    expect(reconcileManualInvoices(930_550, 930_550)).toEqual({
      expectedCents: 930_550, enteredCents: 930_550, diffCents: 0, nextRemainingCents: 0,
    });
  });
  it("alilaskutus jää seuraavalle laskulle, ylilaskutus ei mene miinukselle", () => {
    expect(reconcileManualInvoices(100_000, 90_000)).toMatchObject({ diffCents: -10_000, nextRemainingCents: 10_000 });
    expect(reconcileManualInvoices(100_000, 105_000)).toMatchObject({ diffCents: 5_000, nextRemainingCents: 0 });
  });
});

describe("manualInvoiceTime", () => {
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);
  it("tyhjä ja tämä päivä = nyt", () => {
    expect(manualInvoiceTime(undefined, now)).toEqual({ ok: true, t: now });
    expect(manualInvoiceTime("2026-11-01", now)).toEqual({ ok: true, t: now });
  });
  it("aiempi päivä kirjataan sen päivän keskelle", () => {
    const r = manualInvoiceTime("2026-10-28", now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new Date(r.t).toISOString().slice(0, 10)).toBe("2026-10-28");
  });
  it("tulevaisuus, huono muoto ja olematon päivä hylätään", () => {
    expect(manualInvoiceTime("2026-11-05", now).ok).toBe(false);
    expect(manualInvoiceTime("1.11.2026", now).ok).toBe(false);
    expect(manualInvoiceTime("2026-02-31", now).ok).toBe(false);
  });
});

describe("kirjaus nollaa seuraavan laskun ja päivittää laskutetun", () => {
  const d = gig([shift("joonatan", 100), shift("jani", 60)]);

  it("kaksi laskua täsmälleen kertymän summalla → seuraava lasku 0, avoimet tunnit 0", () => {
    const before = computeHoursPeriod(d, [], { uninvoicedWindows: 0 });
    expect(before.remainingCents).toBeGreaterThan(0);
    const half = Math.floor(before.remainingCents / 2);
    const { made } = record(d, [], [half, before.remainingCents - half], T0 + 5_000);

    expect(made).toHaveLength(2);
    expect(made.every((p) => isHoursStreamPayment(p))).toBe(true);

    const after = computeHoursPeriod(d, made, { uninvoicedWindows: 0 });
    expect(after.invoicedCents).toBe(before.remainingCents);
    expect(after.invoiceCount).toBe(2);
    expect(after.openHours).toBe(0);
    expect(after.remainingCents).toBe(0);
    expect(after.adjustmentCents).toBe(0);
  });

  it("laskutettu = kirjatut summat, ei järjestelmän arvio; ero näkyy seuraavalla laskulla", () => {
    const before = computeHoursPeriod(d, [], { uninvoicedWindows: 0 });
    const under = [before.remainingCents - 12_300];
    const { made } = record(d, [], under, T0 + 5_000);
    const after = computeHoursPeriod(d, made, { uninvoicedWindows: 0 });
    expect(after.invoicedCents).toBe(under[0]);
    expect(after.openHours).toBe(0);
    expect(after.remainingCents).toBe(12_300);
  });

  it("uusi työ kirjauksen jälkeen kertyy seuraavalle laskulle", () => {
    const before = computeHoursPeriod(d, [], { uninvoicedWindows: 0 });
    const { made } = record(d, [], [before.remainingCents], T0 + 5_000);
    const more = gig([...d.shifts!, shift("jani", 5, "2026-10-20")]);
    const after = computeHoursPeriod(more, made, { uninvoicedWindows: 0 });
    expect(after.openHours).toBe(5);
    expect(after.remainingCents).toBeGreaterThan(0);
    expect(after.remainingCents).toBe(after.money.customerTotalCents);
  });

  it("peräkkäinen kirjaus ei laske samaa tuntia kahdesti", () => {
    const first = computeHoursPeriod(d, [], { uninvoicedWindows: 0 });
    const { made: m1 } = record(d, [], [first.remainingCents], T0 + 5_000);
    const more = gig([...d.shifts!, shift("jani", 5, "2026-10-20")]);
    const second = computeHoursPeriod(more, m1, { uninvoicedWindows: 0 });
    const { made: m2 } = record(more, m1, [second.remainingCents], T0 + 9_000);
    const all = [...m1, ...m2];
    const after = computeHoursPeriod(more, all, { uninvoicedWindows: 0 });
    expect(after.invoicedCents).toBe(first.remainingCents + second.remainingCents);
    expect(after.remainingCents).toBe(0);
    expect(after.openHours).toBe(0);
  });

  it("laskuttaja tallentuu riville ja rivi on elävä (ei mitätöity)", () => {
    const { made } = record(d, [], [100_000, 50_000], T0);
    expect(made[0].biller).toMatchObject({ id: "joonatan", yTunnus: expect.any(String) });
    expect(livePayments(made)).toHaveLength(2);
    expect(made[0].scope).toBe("hours");
    expect(made[0].note).toContain("1/2");
  });
});

describe("ikkunaraha kirjataan vain yhdelle riville", () => {
  it("windowsCents ei kahdennu usealla laskulla", () => {
    const made = buildManualHoursPayments({
      invoices: [
        { amountCents: 100_000, billerId: "joonatan" },
        { amountCents: 300_000, billerId: "matias" },
      ],
      t: T0, countThrough: 7, cover: { hours: {}, expenseIds: [] }, windowsCents: 50_000,
    });
    const sum = made.reduce((s, p) => s + (p.cover?.windowsCents ?? 0), 0);
    expect(sum).toBe(50_000);
    expect(made[1].cover?.windowsCents).toBe(50_000); // suurin lasku
    expect(made[0].cover?.windowsCents).toBe(0);
  });
});

describe("parseEuroInput", () => {
  it("lukee suomalaiset ja pisteelliset muodot", () => {
    expect(parseEuroInput("4620")).toBe(462_000);
    expect(parseEuroInput("4 620,50")).toBe(462_050);
    expect(parseEuroInput("4620.5")).toBe(462_050);
    expect(parseEuroInput("4.620,50 €")).toBe(462_050);
    expect(parseEuroInput("4.620")).toBe(462_000);
    expect(parseEuroInput("0,99")).toBe(99);
    expect(parseEuroInput("  12 ")).toBe(1200);
  });
  it("hylkää epäselvän", () => {
    for (const bad of ["", "abc", "-5", "1,234", "12,5,1", "1e3", "4620 e"]) expect(parseEuroInput(bad)).toBeNull();
  });
});
