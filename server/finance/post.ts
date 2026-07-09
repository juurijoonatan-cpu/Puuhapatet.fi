/**
 * The automatic posting engine — turns invoicing (jobs), receipts (expenses),
 * tool purchases (investments) and inter-founder settlements into real
 * double-entry journal entries, one ledger per founder. Nothing here is
 * hand-typed; see docs/talous-kirjanpito.md for the exact posting rules and
 * the (small, deliberate) list of things NOT yet posted.
 *
 * Design: `rebuildLedgers()` derives the FULL set of entries that SHOULD
 * exist right now from the current source rows, deletes the old auto-posted
 * entries (never touching closed fiscal years or any future manual entry),
 * and re-inserts the fresh set. The ledger is therefore always a pure,
 * current function of jobs/expenses/investments/founderSettlements — it can
 * never drift, because it is rebuilt from scratch every time it's read.
 */
import { eq, and, ne, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  jobs, expenses, investments, founderSettlements, fiscalYears,
  journalEntries, journalLines,
  type Job, type Expense, type Investment, type FounderSettlement,
} from "@shared/schema";
import { ensureAllLedgers, ensureFiscalYear, accountsByCode, ACCOUNT, LEDGER_DEFS } from "./accounts";
import { BRAND_BILLERS, inferBillerId } from "@shared/billers";
import { effectiveJobTotal } from "@shared/team";
import { sanitizeGigData, type GigData } from "@shared/gig";

function parseGig(raw: string | null): GigData | null {
  if (!raw) return null;
  try { return sanitizeGigData(JSON.parse(raw)); } catch { return null; }
}

const isFounder = (id?: string | null): id is string => !!id && BRAND_BILLERS.some((b) => b.id === id);

interface DraftLine { accountCode: string; debitCents?: number; creditCents?: number }
interface DraftEntry {
  ledgerId: string;
  date: Date;
  description: string;
  sourceType: "customer_invoice" | "internal_invoice" | "expense" | "investment" | "manual";
  sourceKey: string;
  lines: DraftLine[];
}

function assertBalanced(entry: DraftEntry) {
  const debit = entry.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const credit = entry.lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  if (debit !== credit) {
    throw new Error(`Kirjanpitovirhe: vienti ei täsmää (debet ${debit} ≠ kredit ${credit}) — ${entry.sourceKey}`);
  }
}

/**
 * Derive every journal entry that should exist today, from the source rows.
 *
 * Posted automatically (see docs/talous-kirjanpito.md §"Mitä kirjataan"):
 *   1. Asiakaslaskut — every job / FR8-erä with exactly one known founder
 *      biller → Pankkitili (debet) / Myynnit (kredit), full invoiced amount.
 *   2. Kulut — the `expenses` table, attributed via the same biller rule as
 *      revenue → Muut kulut (debet) / Pankkitili (kredit).
 *   3. Hankinnat — `investments`, attributed via boughtBy (+ 50/50 splitWith)
 *      → Kalusto ja välineet (debet) / Pankkitili (kredit). Expensed in full
 *      at purchase (pienhankinnan kertapoisto) rather than depreciated.
 *   4. Yrittäjien väliset laskut — `founderSettlements` rows (a confirmed,
 *      amount-settled vastalasku): payer's real expense + payee's real
 *      revenue, both ledgers, same amount.
 *
 * Deliberately NOT posted yet (see docs for why): worker/alihankkija payouts
 * (already netted out of the founders' revenue via "kate"), palvelumaksu
 * (service-fee) revenue, startup-bonus usage.
 */
function buildDraftEntries(
  jobRows: Job[],
  expenseRows: Expense[],
  investmentRows: Investment[],
  settlementRows: FounderSettlement[],
): DraftEntry[] {
  const drafts: DraftEntry[] = [];
  const jobsById = new Map(jobRows.map((j) => [j.id, j]));

  for (const job of jobRows) {
    if (job.gigData) {
      const gig = parseGig(job.gigData);
      const gigName = gig?.company?.name || job.description || `Keikka #${job.id}`;
      (gig?.payments ?? []).forEach((p, i) => {
        if (!p?.amountCents || p.amountCents <= 0 || !isFounder(p.biller?.id)) return;
        const date = new Date(p.t || job.scheduledAt || job.createdAt);
        drafts.push({
          ledgerId: p.biller!.id, date,
          description: `Asiakaslasku — ${gigName}, erä ${i + 1}`,
          sourceType: "customer_invoice", sourceKey: `job:${job.id}:era:${i}`,
          lines: [
            { accountCode: ACCOUNT.BANK, debitCents: p.amountCents },
            { accountCode: ACCOUNT.SALES, creditCents: p.amountCents },
          ],
        });
      });
      continue; // FR8/custom-gig jobs are fully handled via their eras above.
    }
    if (job.isCustomGig) continue; // set up but no eras recorded yet — nothing to post.
    if (job.status !== "done" || job.quoteStatus === "declined") continue;
    const total = effectiveJobTotal(job);
    if (total <= 0) continue;
    const billerId = inferBillerId(job);
    if (!isFounder(billerId)) continue; // unattributed — surfaced in the ALV card, never guessed here.
    drafts.push({
      ledgerId: billerId, date: new Date(job.scheduledAt ?? job.createdAt),
      description: `Asiakaslasku — keikka #${job.id}`,
      sourceType: "customer_invoice", sourceKey: `job:${job.id}`,
      lines: [
        { accountCode: ACCOUNT.BANK, debitCents: total },
        { accountCode: ACCOUNT.SALES, creditCents: total },
      ],
    });
  }

  for (const exp of expenseRows) {
    const job = jobsById.get(exp.jobId);
    if (!job || exp.amount <= 0) continue;
    const billerId = inferBillerId(job);
    if (!isFounder(billerId)) continue;
    drafts.push({
      ledgerId: billerId, date: new Date(exp.createdAt),
      description: `Kulu — ${exp.description}`,
      sourceType: "expense", sourceKey: `expense:${exp.id}`,
      lines: [
        { accountCode: ACCOUNT.OTHER_EXPENSE, debitCents: exp.amount },
        { accountCode: ACCOUNT.BANK, creditCents: exp.amount },
      ],
    });
  }

  for (const inv of investmentRows) {
    if (inv.amount <= 0) continue;
    const buyers = (inv.splitWith ? [inv.boughtBy, inv.splitWith] : [inv.boughtBy]).filter(isFounder);
    if (buyers.length === 0) continue;
    const base = Math.floor(inv.amount / buyers.length);
    buyers.forEach((ledgerId, i) => {
      const cents = i === 0 ? inv.amount - base * (buyers.length - 1) : base;
      if (cents <= 0) return;
      drafts.push({
        ledgerId, date: new Date(inv.purchasedAt),
        description: `Hankinta — ${inv.description}`,
        sourceType: "investment", sourceKey: `investment:${inv.id}:${ledgerId}`,
        lines: [
          { accountCode: ACCOUNT.EQUIPMENT, debitCents: cents },
          { accountCode: ACCOUNT.BANK, creditCents: cents },
        ],
      });
    });
  }

  for (const s of settlementRows) {
    if (s.cents <= 0 || !isFounder(s.fromId) || !isFounder(s.toId)) continue;
    const date = new Date(s.createdAt);
    const label = s.invoiceNo ? ` (${s.invoiceNo})` : "";
    drafts.push({
      ledgerId: s.fromId, date,
      description: `Yrittäjien välinen lasku, maksettu${label}`,
      sourceType: "internal_invoice", sourceKey: `settlement:${s.id}:payer`,
      lines: [
        { accountCode: ACCOUNT.PURCHASES_INTERNAL, debitCents: s.cents },
        { accountCode: ACCOUNT.BANK, creditCents: s.cents },
      ],
    });
    drafts.push({
      ledgerId: s.toId, date,
      description: `Yrittäjien välinen lasku, saatu${label}`,
      sourceType: "internal_invoice", sourceKey: `settlement:${s.id}:payee`,
      lines: [
        { accountCode: ACCOUNT.BANK, debitCents: s.cents },
        { accountCode: ACCOUNT.SALES_INTERNAL, creditCents: s.cents },
      ],
    });
  }

  drafts.forEach(assertBalanced);
  return drafts;
}

/**
 * Rebuild every founder's ledger from current source data. Safe to call on
 * every finance-API request — this business runs at a scale (tens to low
 * hundreds of entries/year) where a full rebuild is fast, and
 * correctness-by-construction beats incremental-update bookkeeping.
 *
 * A single Express process serves this app, but one page load fires several
 * finance GETs in parallel (summary, journal, general-ledger, …) — each
 * calls this function. Without a guard, two concurrent rebuilds both try to
 * delete-then-reinsert the same rows and collide on the sourceKey unique
 * constraint. rebuildLedgers() is therefore serialized behind a single
 * in-flight promise: concurrent callers all await the SAME run.
 */
let inFlight: Promise<void> | null = null;
export function rebuildLedgers(): Promise<void> {
  if (!inFlight) inFlight = rebuildLedgersNow().finally(() => { inFlight = null; });
  return inFlight;
}

async function rebuildLedgersNow(): Promise<void> {
  await ensureAllLedgers();

  const [jobRows, expenseRows, investmentRows, settlementRows] = await Promise.all([
    db.select().from(jobs),
    db.select().from(expenses),
    db.select().from(investments),
    db.select().from(founderSettlements),
  ]);
  const drafts = buildDraftEntries(jobRows, expenseRows, investmentRows, settlementRows);

  for (const ledgerDef of LEDGER_DEFS) {
    const ledgerId = ledgerDef.id;
    const accByCode = await accountsByCode(ledgerId);

    const closedYears = await db.select().from(fiscalYears)
      .where(and(eq(fiscalYears.ledgerId, ledgerId), eq(fiscalYears.isClosed, true)));
    const isClosedDate = (d: Date) => closedYears.some((y) => d >= y.startDate && d <= y.endDate);

    // Delete every previously auto-posted entry for this ledger EXCEPT those
    // in a closed fiscal year — a closed year is frozen, matching how a real
    // tilinpäätös is never silently rewritten.
    const existingAuto = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.ledgerId, ledgerId), ne(journalEntries.sourceType, "manual")));
    const staleIds = existingAuto.filter((e) => !isClosedDate(e.date)).map((e) => e.id);
    if (staleIds.length > 0) {
      await db.delete(journalLines).where(inArray(journalLines.entryId, staleIds));
      await db.delete(journalEntries).where(inArray(journalEntries.id, staleIds));
    }

    const keptEntries = await db.select().from(journalEntries).where(eq(journalEntries.ledgerId, ledgerId));
    let nextNumber = keptEntries.reduce((max, e) => Math.max(max, e.entryNumber), 0) + 1;

    const ledgerDrafts = drafts
      .filter((d) => d.ledgerId === ledgerId && !isClosedDate(d.date))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const draft of ledgerDrafts) {
      const fy = await ensureFiscalYear(ledgerId, draft.date);
      if (fy.isClosed) continue; // belt-and-suspenders; already filtered above
      const [entry] = await db.insert(journalEntries).values({
        ledgerId, fiscalYearId: fy.id, entryNumber: nextNumber++,
        date: draft.date, description: draft.description,
        sourceType: draft.sourceType, sourceKey: draft.sourceKey,
      }).returning();
      await db.insert(journalLines).values(
        draft.lines.map((l, i) => ({
          entryId: entry.id,
          accountId: accByCode[l.accountCode].id,
          debitCents: l.debitCents ?? 0,
          creditCents: l.creditCents ?? 0,
          lineNo: i,
        })),
      );
    }
  }
}
