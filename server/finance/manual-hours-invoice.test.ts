/**
 * VARTIJA: käsin kirjatut tuntilaskut näkyvät KAIKESSA mikä lukee tuloja.
 *
 * Kirjaus tallentaa vain maksurivit (`gig.payments`, scope "hours"). Tulot,
 * johtajien tasaus ja kirjanpito johdetaan niistä — tämä testi lukitsee ettei
 * kukaan niistä pudota riviä: ei tallennuksen (sanitize) läpi, ei tasauksessa
 * eikä kirjanpidon luonnosvienneissä.
 */
import { describe, expect, it } from "vitest";
import { buildDraftEntries } from "./draft-entries";
import { buildTasaus } from "@shared/fr8-tasaus";
import { emptyGigData, sanitizeGigData } from "@shared/gig";
import { buildManualHoursPayments } from "@shared/manual-hours-invoice";
import { computeHoursPeriod } from "@shared/hours-period";
import { emptyProjectData, type ProjectData } from "@shared/project";
import type { Job } from "@shared/schema";

const T = Date.UTC(2026, 9, 28, 10);
const project = {
  ...emptyProjectData(), billingMode: "hourly",
  shifts: [{ id: "s1", worker: "joonatan", day: "2026-10-20", hours: 100, at: T - 1000 }],
  expenses: [],
} as ProjectData;

function savedGig() {
  const gig = emptyGigData();
  gig.payments.push(...buildManualHoursPayments({
    invoices: [
      { amountCents: 462_000, billerId: "joonatan", ref: "1001" },
      { amountCents: 468_550, billerId: "matias" },
    ],
    t: T, countThrough: 0, cover: { hours: { joonatan: { "2026-10-20": 100 } }, expenseIds: [] }, windowsCents: 0,
  }));
  // Palvelin tallentaa JSONina ja lukee sanitizen kautta.
  return sanitizeGigData(JSON.parse(JSON.stringify(gig)));
}

describe("käsin kirjatut tuntilaskut tulovirrassa", () => {
  it("rivit säilyvät tallennuksen läpi kokonaan (scope, laskuttaja, kattavuus)", () => {
    const gig = savedGig();
    expect(gig.payments).toHaveLength(2);
    expect(gig.payments.map((p) => p.scope)).toEqual(["hours", "hours"]);
    expect(gig.payments.map((p) => p.biller?.id)).toEqual(["joonatan", "matias"]);
    expect(gig.payments[0].cover?.hours.joonatan?.["2026-10-20"]).toBe(100);
    // Mitätöitävissä, ei poistettavissa: laskuttaja tekee rivistä "lähetetyn".
    expect(gig.payments.every((p) => !!p.biller?.id && p.amountCents > 0)).toBe(true);
  });

  it("tasaus: tuntipotti = kirjattu summa, kumpikin johtaja saa omansa, ei kohdentamatonta", () => {
    const gig = savedGig();
    const t = buildTasaus(project, gig.payments as any, [], null);
    expect(t.input.hoursPotCents).toBe(930_550);
    const got = Object.fromEntries(t.input.founders.map((f) => [f.id, f.receivedCents]));
    expect(got).toMatchObject({ joonatan: 462_000, matias: 468_550 });
    expect(t.unassignedEraCount).toBe(0);
  });

  it("kirjanpito: jokainen lasku on oma myyntivienti laskuttajan kirjanpitoon", () => {
    const gig = savedGig();
    const job = { id: 7, description: "FR8 tunnit", isCustomGig: true, status: "in_progress", gigData: JSON.stringify(gig) } as unknown as Job;
    const drafts = buildDraftEntries([job], [], [], []);
    const sales = drafts.filter((d) => d.sourceType === "customer_invoice");
    expect(sales).toHaveLength(2);
    expect(sales.map((d) => d.ledgerId).sort()).toEqual(["joonatan", "matias"]);
    expect(sales.map((d) => d.lines.find((l) => l.creditCents)?.creditCents).sort((a, b) => a! - b!)).toEqual([462_000, 468_550]);
  });

  it("seuraava lasku nollautuu tallennetun kopion pohjalta", () => {
    const gig = savedGig();
    const p = computeHoursPeriod(project, gig.payments, { uninvoicedWindows: 0 });
    expect(p.invoicedCents).toBe(930_550);
    expect(p.openHours).toBe(0);
  });
});
