import * as fs from "fs";
const L: string[] = [];
const log = (...a: any[]) => L.push(a.map(String).join(" "));
const W = () => fs.writeFileSync("/tmp/claude-0/-home-user-Puuhapatet-fi/68b11a9e-99d9-5c47-a0ba-67a13d9e1d0e/scratchpad/out2.txt", L.join("\n"));
import { describe, it, expect } from "vitest";
import { emptyProjectData, syncGigSectorsFromProject, type ProjectData } from "./project";
import { computeTotals, type GigData } from "./gig";
import { hourlyItemisation } from "./hourly-money";
import { p2BillableCents } from "./p2";
import { p2InvoiceState } from "./worker-payouts";

function base(): { proj: ProjectData; gig: GigData } {
  const p = emptyProjectData();
  p.dealKind = "none"; p.billingMode = "hourly";
  p.pricePerWindow = 30; p.hourRateCents = 2600; p.workerHourCents = 1500;
  p.building.floors = ["1"];
  p.crew = [{ id: "jani", name: "Jani", role: "worker", token: "t1", perWindowCents: 2000 } as any];
  const marks: any[] = [];
  for (let i = 0; i < 12; i++) marks.push({ x: i, y: 0, p: 1 });   // 12 RED, no p2 at all
  p.marks = { "1": { marks, w: 100, h: 100 } } as any;
  marks.forEach((_, i) => { p.statuses[`1#${i}`] = "pesty"; p.washedBy[`1#${i}`] = "jani"; });
  p.shifts = [{ id: "s1", worker: "jani", day: "2026-01-05", hours: 34, at: 1 } as any];
  let gig: GigData = { version: 1, contractId: "PT-X", sectors: [], payments: [], log: [],
    invoicedThrough: 0, invoicedCents: 0, invoiceInterval: 100, updatedAt: Date.now() } as any;
  gig = syncGigSectorsFromProject(gig, p);
  return { proj: p, gig };
}

/** Mirrors server/routes.ts scope:"hours" arithmetic exactly. */
function sendHours(proj: ProjectData, gig: GigData) {
  const t = computeTotals(gig);
  const uninvoicedWindows = Math.max(0, t.washedTotal - t.invoicedWashed);
  const hourly = hourlyItemisation(proj, { uninvoicedWindows });
  const inv = p2InvoiceState(p2BillableCents(proj), gig.payments as any);
  const hoursRemaining = Math.max(0, hourly.customerTotalCents - inv.hoursInvoicedCents);
  const amount = hoursRemaining;
  log(`  accrual(customerTotal)=${hourly.customerTotalCents} incl windows=${hourly.money.windowsCents}`,
      `| hoursInvoicedSoFar=${inv.hoursInvoicedCents} | REMAINING/CHARGED=${amount}`);
  const covers = amount >= hoursRemaining;
  if (covers) gig.sectors.forEach((s) => { s.invoicedWashed = s.washed; });
  (gig.payments as any).push({ t: Date.now(), countThrough: 0, amountCents: amount, scope: "hours" });
  return amount;
}

describe("audit: hours accrual vs cumulative invoiced", () => {
  it("window money charged once is subtracted twice", () => {
    const { proj, gig } = base();
    log("STEP 1 — 34 h + 12 washed windows uninvoiced");
    const a1 = sendHours(proj, gig);
    log("  sectors after:", JSON.stringify(gig.sectors.map((s) => ({ w: s.washed, i: s.invoicedWashed }))));
    log("STEP 2 — worker logs 100 MORE hours (= 2600,00 € of new work), no new windows");
    proj.shifts!.push({ id: "s2", worker: "jani", day: "2026-01-06", hours: 100, at: 2 } as any);
    const t = computeTotals(gig);
    const hourly = hourlyItemisation(proj, { uninvoicedWindows: Math.max(0, t.washedTotal - t.invoicedWashed) });
    const inv = p2InvoiceState(p2BillableCents(proj), gig.payments as any);
    const rem = Math.max(0, hourly.customerTotalCents - inv.hoursInvoicedCents);
    log(`  new accrual=${hourly.customerTotalCents} (windows now ${hourly.money.windowsCents})`);
    log(`  hoursInvoiced=${inv.hoursInvoicedCents} -> REMAINING OFFERED=${rem}`);
    log(`  TRUE new work = 100 h x 26,00 = 260000 ; DEFICIT = ${260000 - rem}`);
    W();
    expect(rem).toBe(224000);
  });
});
