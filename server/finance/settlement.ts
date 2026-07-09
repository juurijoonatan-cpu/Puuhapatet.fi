/**
 * Pure money-math for the founder-facing "Verotus" views — lifted out of
 * server/routes.ts so the same computation feeds BOTH the existing HTTP
 * endpoints (/api/admin/biller-turnover, /api/admin/founder-settlement) AND
 * the double-entry ledger auto-poster (server/finance/post.ts). One
 * computation, never two copies that can drift apart.
 *
 * No behavior change from the original inline route handlers — this is a
 * straight lift (DB fetch stays in routes.ts; only the pure computation
 * moved here).
 */
import { sanitizeGigData, type GigData } from "@shared/gig";
import { sanitizeProjectData, fixedDealFor, computeEraDebts, type ProjectData } from "@shared/project";
import { BRAND_BILLERS, inferBillerId } from "@shared/billers";
import { effectiveJobTotal } from "@shared/team";
import { VAT_SMALL_BUSINESS_LIMIT_EUR } from "@shared/tax";
import type { Job, Customer, Expense, FounderSettlement } from "@shared/schema";

function parseGig(raw: string | null): GigData | null {
  if (!raw) return null;
  try { return sanitizeGigData(JSON.parse(raw)); } catch { return null; }
}

function parseProject(raw: string | null): ProjectData | null {
  if (!raw) return null;
  try { return sanitizeProjectData(JSON.parse(raw)); } catch { return null; }
}

export interface BillerTurnover {
  ok: true;
  limitEur: number;
  billers: { id: string; name: string; yTunnus?: string }[];
  turnoverByYear: Record<string, Record<string, number>>;
  unassignedByYear: Record<string, { count: number; cents: number }>;
  unassignedEras: { jobId: number; index: number; name: string; dateMs: number | null; cents: number }[];
}

/**
 * Per-founder (biller) customer-invoice turnover by calendar year. Each
 * founder invoices customers under their own Y-tunnus, and the ALV vähäinen-
 * toiminta exemption (AVL 3 §) depends on each staying under the limit. We
 * sum every gig instalment (GigPayment) tagged to a biller, by the year it
 * was invoiced. NOTE: this counts ONLY Puuhapatet customer invoices — the
 * legal threshold counts ALL of a person's business activity, so this is a
 * floor, surfaced with that caveat in the UI.
 */
export function computeBillerTurnover(rows: Job[]): BillerTurnover {
  const byYear: Record<string, Record<string, number>> = {};
  const unassignedByYear: Record<string, { count: number; cents: number }> = {};
  const unassignedEras: BillerTurnover["unassignedEras"] = [];
  for (const row of rows) {
    if (row.gigData) {
      const gig = parseGig(row.gigData);
      const gigName = gig?.company?.name || row.description || `Keikka #${row.id}`;
      (gig?.payments || []).forEach((p, i) => {
        if (!p?.amountCents || p.amountCents <= 0) return;
        const billerId = p.biller?.id;
        if (!billerId) {
          unassignedEras.push({
            jobId: row.id, index: i, name: `${gigName} — erä ${i + 1}`,
            dateMs: p.t || null, cents: p.amountCents,
          });
          return;
        }
        const year = String(new Date(p.t || 0).getFullYear());
        (byYear[year] ||= {});
        byYear[year][billerId] = (byYear[year][billerId] ?? 0) + p.amountCents;
      });
    }
    if (!row.isCustomGig && !row.gigData && row.status === "done" && row.quoteStatus !== "declined") {
      const total = effectiveJobTotal(row);
      if (total <= 0) continue;
      const year = String(new Date(row.scheduledAt ?? row.createdAt).getFullYear());
      const eff = inferBillerId(row);
      if (eff && BRAND_BILLERS.some((b) => b.id === eff)) {
        (byYear[year] ||= {});
        byYear[year][eff] = (byYear[year][eff] ?? 0) + total;
      } else if (!row.billedBy) {
        (unassignedByYear[year] ||= { count: 0, cents: 0 });
        unassignedByYear[year].count += 1;
        unassignedByYear[year].cents += total;
      }
    }
  }
  return {
    ok: true,
    limitEur: VAT_SMALL_BUSINESS_LIMIT_EUR,
    billers: BRAND_BILLERS.map((b) => ({ id: b.id, name: b.name, yTunnus: b.yTunnus })),
    turnoverByYear: byYear,
    unassignedByYear,
    unassignedEras,
  };
}

export interface FounderCrossSettlement {
  ok: true;
  founders: { id: string; name: string; yTunnus?: string; billedCents: number; kateShareCents: number; palkatPaidCents: number }[];
  crossInvoices: { fromId: string; fromName: string; toId: string; toName: string; cents: number }[];
  perGig: {
    jobId: number; gigName: string;
    eras: {
      era: number; dateMs: number | null; billerId: string; billerName: string;
      instalmentCents: number; palkatCents: number; kateCents: number;
      shares: { id: string; cents: number }[]; paysOut: { id: string; name: string; cents: number }[];
    }[];
  }[];
  smallJobs: {
    jobId: number; name: string; dateMs: number; totalCents: number; expensesCents: number;
    billerId: string; billerName: string; numWorkers: number;
    owes: { id: string; name: string; cents: number }[];
  }[];
  unassignedEraCount: number;
  settled: { id: number; fromId: string; toId: string; cents: number; invoiceNo?: string; createdAtMs: number }[];
}

/**
 * Founder cross-invoicing across ALL gigs. The two founders split every gig
 * 50/50 but only ONE of them bills the customer (they alternate whose
 * Y-tunnus collects each erä). So the biller ends up holding the other
 * founder's half — this nets, across every billed erä of every FR8 gig AND
 * every done small job (billedBy), who owes whom, so they can settle up with
 * a founder-to-founder invoice (vastalasku).
 */
export function computeFounderSettlement(
  rows: Job[],
  customerRows: Customer[],
  expenseRows: Expense[],
  settledRows: FounderSettlement[],
): FounderCrossSettlement {
  const customerName = new Map(customerRows.map((c) => [c.id, c.name]));
  // Job expenses: the biller fronted materials and keeps the reimbursement,
  // so shares are computed on (total − kulut) — same maths as the
  // tilitystosite the workers receive.
  const expByJob = new Map<number, number>();
  for (const e of expenseRows) expByJob.set(e.jobId, (expByJob.get(e.jobId) ?? 0) + e.amount);

  const founderList = BRAND_BILLERS.map((b) => ({ id: b.id, name: b.name, yTunnus: b.yTunnus }));
  const n = Math.max(1, founderList.length);
  const founders = founderList.map((f) => ({
    id: f.id, name: f.name, yTunnus: f.yTunnus,
    billedCents: 0, kateShareCents: 0, palkatPaidCents: 0,
  }));
  const idxOf = (id?: string) => founders.findIndex((f) => f.id === id);
  const owes: Record<string, Record<string, number>> = {};
  const bump = (from: string, to: string, cents: number) => {
    if (!from || !to || from === to || cents <= 0) return;
    (owes[from] ||= {})[to] = (owes[from][to] ?? 0) + cents;
  };
  const perGig: FounderCrossSettlement["perGig"] = [];

  let unassignedEraCount = 0;
  for (const job of rows) {
    if (!job.gigData) continue;
    const g = parseGig(job.gigData);
    for (const p of g?.payments || []) {
      if (p?.amountCents > 0 && !p.biller?.id) unassignedEraCount += 1;
    }
  }

  for (const job of rows) {
    const project = parseProject(job.projectData ?? null);
    if (!project) continue;
    const deal = fixedDealFor(project);
    if (!deal) continue;
    const eraBreakdown = computeEraDebts(project, deal, project.crew || [], project.eraWindows ?? null);
    const gig = parseGig(job.gigData);
    const payments = gig?.payments ?? [];
    eraBreakdown.forEach((e, i) => {
      const p = payments[i];
      const b = p?.biller;
      (e as any).biller = b?.id ? { id: b.id, name: b.name } : null;
    });
    const gigName = gig?.company?.name || job.description || `Keikka #${job.id}`;
    const eras: (typeof perGig)[number]["eras"] = [];
    for (const e of eraBreakdown) {
      const biller = (e as any).biller as { id: string; name: string } | null;
      if (!biller?.id) continue;
      const kate = e.marginCents;
      const base = Math.floor(kate / n);
      const shares = founders.map((f, i) => ({ id: f.id, name: f.name, cents: i === 0 ? kate - base * (n - 1) : base }));
      shares.forEach((s) => { const j = idxOf(s.id); if (j >= 0) founders[j].kateShareCents += s.cents; });
      const bj = idxOf(biller.id);
      if (bj >= 0) { founders[bj].billedCents += e.instalmentCents; founders[bj].palkatPaidCents += e.earnedCents; }
      const paysOut = shares.filter((s) => s.id !== biller.id);
      paysOut.forEach((s) => bump(biller.id, s.id, s.cents));
      eras.push({
        era: e.era,
        dateMs: payments[e.era - 1]?.t || null,
        billerId: biller.id,
        billerName: biller.name || (bj >= 0 ? founders[bj].name : ""),
        instalmentCents: e.instalmentCents,
        palkatCents: e.earnedCents,
        kateCents: kate,
        shares: shares.map((s) => ({ id: s.id, cents: s.cents })),
        paysOut: paysOut.map((s) => ({ id: s.id, name: s.name, cents: s.cents })),
      });
    }
    if (eras.length > 0) perGig.push({ jobId: job.id, gigName, eras });
  }

  const founderByName = new Map(founderList.map((f) => [f.name.trim().toLowerCase(), f.id]));
  const resolveWorkerId = (s: string) => {
    const t = s.trim().toLowerCase();
    return founderByName.get(t) ?? t;
  };
  const smallJobs: FounderCrossSettlement["smallJobs"] = [];
  for (const job of rows) {
    if (job.isCustomGig || job.gigData || job.status !== "done" || job.quoteStatus === "declined") continue;
    const billerId = inferBillerId(job);
    if (!billerId || idxOf(billerId) < 0) continue;
    const total = effectiveJobTotal(job);
    if (total <= 0) continue;
    const expensesCents = expByJob.get(job.id) ?? 0;
    const baseCents = Math.max(0, total - expensesCents);
    const workerIds = (job.assignedTo || "").split(",").map(resolveWorkerId).filter(Boolean);
    const numWorkers = Math.max(workerIds.length, 1);
    const share = Math.round(baseCents / numWorkers);
    const owesList = founderList
      .filter((f) => f.id !== billerId && workerIds.includes(f.id))
      .map((f) => ({ id: f.id, name: f.name, cents: share }))
      .filter((o) => o.cents > 0);
    if (owesList.length === 0) continue;
    owesList.forEach((o) => bump(billerId, o.id, o.cents));
    const bj = idxOf(billerId);
    smallJobs.push({
      jobId: job.id,
      name: customerName.get(job.customerId) || job.description || `Keikka #${job.id}`,
      dateMs: new Date(job.scheduledAt ?? job.createdAt).getTime(),
      totalCents: total,
      expensesCents,
      billerId,
      billerName: founderList[bj]?.name ?? billerId,
      numWorkers,
      owes: owesList,
    });
  }
  smallJobs.sort((a, b) => b.dateMs - a.dateMs);

  for (const s of settledRows) bump(s.toId, s.fromId, s.cents);

  const crossInvoices: FounderCrossSettlement["crossInvoices"] = [];
  for (let i = 0; i < founders.length; i++) {
    for (let j = i + 1; j < founders.length; j++) {
      const a = founders[i], b = founders[j];
      const ab = owes[a.id]?.[b.id] ?? 0;
      const ba = owes[b.id]?.[a.id] ?? 0;
      const net = ab - ba;
      if (net > 0) crossInvoices.push({ fromId: a.id, fromName: a.name, toId: b.id, toName: b.name, cents: net });
      else if (net < 0) crossInvoices.push({ fromId: b.id, fromName: b.name, toId: a.id, toName: a.name, cents: -net });
    }
  }

  return {
    ok: true, founders, crossInvoices, perGig, smallJobs, unassignedEraCount,
    settled: settledRows.map((s) => ({
      id: s.id, fromId: s.fromId, toId: s.toId, cents: s.cents,
      invoiceNo: s.invoiceNo ?? undefined,
      createdAtMs: new Date(s.createdAt).getTime(),
    })),
  };
}
