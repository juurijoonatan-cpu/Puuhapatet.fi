/**
 * The automatic posting engine — turns invoicing (jobs), receipts (expenses),
 * tool purchases (investments), inter-founder settlements and subcontractor
 * (tekijä) era-invoices into real double-entry journal entries, one ledger per
 * founder. Nothing here is hand-typed; see docs/talous-kirjanpito.md for the
 * exact posting rules and the (small, deliberate) list of things NOT yet posted.
 *
 * Design: `rebuildLedgers()` derives the FULL set of entries that SHOULD
 * exist right now from the current source rows, deletes the old auto-posted
 * entries (never touching closed fiscal years or any future manual entry),
 * and re-inserts the fresh set. The ledger is therefore always a pure,
 * current function of jobs/expenses/investments/founderSettlements/eraInvoices
 * — it can never drift, because it is rebuilt from scratch every time it's read.
 *
 * The posting RULES live in ./draft-entries.ts (no I/O, so the whole rulebook is
 * unit-testable without a database); this file is the database side of them.
 */
import { eq, and, ne, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  jobs, expenses, investments, founderSettlements, eraInvoices, fiscalYears,
  journalEntries, journalLines, type Job,
} from "@shared/schema";
import { ensureAllLedgers, ensureFiscalYear, accountsByCode, LEDGER_DEFS } from "./accounts";
// Vientisäännöt asuvat omassa, kannasta riippumattomassa moduulissaan, jotta ne
// ovat testattavissa ilman tietokantaa. Ks. ./draft-entries.ts.
import { buildDraftEntries, type WorkerInvoiceRow } from "./draft-entries";
export { buildDraftEntries, type WorkerInvoiceRow, type DraftEntry } from "./draft-entries";

/**
 * Tekijöiden (alihankkijoiden) erälaskut kirjanpitoa varten.
 *
 * Vain ne sarakkeet joita `buildDraftEntries` lukee, ja `eraNumbers`/`rivit`
 * parsitaan JSONista samalla tavalla kuin tasauksessa (`loadTasaus`,
 * server/routes.ts). Rivit ovat kevyitä: ei liitteitä, ei karttablobia — tämä
 * ajetaan joka `/api/finance/*`-pyynnöllä siinä missä muut kyselyt.
 */
async function loadWorkerInvoices(): Promise<WorkerInvoiceRow[]> {
  try {
    const rows = await db.select({
      id: eraInvoices.id, jobId: eraInvoices.jobId, kind: eraInvoices.kind,
      tila: eraInvoices.tila, senderId: eraInvoices.senderId,
      recipientId: eraInvoices.recipientId, eraNumbers: eraInvoices.eraNumbers,
      rivit: eraInvoices.rivit, totalCents: eraInvoices.totalCents,
      sentAt: eraInvoices.sentAt, createdAt: eraInvoices.createdAt,
    }).from(eraInvoices);
    return rows.map((r) => {
      let eraNumbers: number[] = [];
      let rivit: WorkerInvoiceRow["rivit"] = null;
      try { const parsed = JSON.parse(r.eraNumbers); if (Array.isArray(parsed)) eraNumbers = parsed; } catch { /* tyhjä */ }
      try { rivit = JSON.parse(r.rivit); } catch { /* null */ }
      return { ...r, eraNumbers, rivit };
    });
  } catch (e: any) {
    // Taulua ei ole vielä kannassa (db:push ajamatta) → kirjanpito rakentuu
    // ilman alihankkijakuluja eikä kaadu. Sama suoja kuin erälaskureiteillä
    // (server/routes.ts `isMissingTableError`), joka ei ole exportattu sieltä
    // (routes.ts importtaa tämän moduulin — kehäriippuvuus).
    if (e?.code !== "42P01") throw e;
    return [];
  }
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

  const [jobRows, expenseRows, investmentRows, settlementRows, workerInvoiceRows] = await Promise.all([
    // Kirjanpidon uudelleenrakennus lukee vain rahakentät ja gigData:n
    // laskutuserät. `db.select().from(jobs)` veti mukanaan allekirjoitus-PNG:t
    // ja koko karttablobin — ja tämä ajetaan JOKAISELLA /api/finance-haulla,
    // joita Talous-sivu tekee viisi kerralla.
    db.select({
      id: jobs.id, customerId: jobs.customerId, description: jobs.description,
      agreedPrice: jobs.agreedPrice, status: jobs.status, assignedTo: jobs.assignedTo,
      scheduledAt: jobs.scheduledAt, waiveFee: jobs.waiveFee, quoteStatus: jobs.quoteStatus,
      isTaloyhtiio: jobs.isTaloyhtiio, unitCount: jobs.unitCount, isCustomGig: jobs.isCustomGig,
      billedBy: jobs.billedBy, createdAt: jobs.createdAt, updatedAt: jobs.updatedAt,
      // EI `projectData`ta: `buildDraftEntries` ei lue sitä kertaakaan, mutta se
      // on koko karttablobi (havaintokuvat, kuitit, dokumentit — kymmeniä
      // megatavuja per FR8-keikka). Tämä kysely ajetaan JOKAISELLA
      // /api/finance-haulla ja Talous-sivu tekee viisi kerralla.
      gigData: jobs.gigData,
    }).from(jobs) as unknown as Promise<Job[]>,
    db.select().from(expenses),
    db.select().from(investments),
    db.select().from(founderSettlements),
    loadWorkerInvoices(),
  ]);
  const drafts = buildDraftEntries(jobRows, expenseRows, investmentRows, settlementRows, workerInvoiceRows);

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
