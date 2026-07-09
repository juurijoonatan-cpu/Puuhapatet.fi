/**
 * Read-side queries over the ledger: chart of accounts, journal (päiväkirja),
 * general ledger (pääkirja), income statement (tuloslaskelma), balance sheet
 * (tase) and the one-screen summary. All of these call `rebuildLedgers()`
 * first so the numbers are always current — see server/finance/post.ts.
 */
import { eq, inArray, asc } from "drizzle-orm";
import { db } from "../db";
import { accounts, journalEntries, journalLines, type Account } from "@shared/schema";
import { rebuildLedgers } from "./post";
import { LEDGER_DEFS } from "./accounts";

export function ledgerList() {
  return LEDGER_DEFS;
}

async function entriesWithLines(ledgerId: string, year?: number) {
  const rows = await db.select().from(journalEntries)
    .where(eq(journalEntries.ledgerId, ledgerId))
    .orderBy(asc(journalEntries.entryNumber));
  const scoped = year ? rows.filter((e) => e.date.getUTCFullYear() === year) : rows;
  const entryIds = scoped.map((e) => e.id);
  const lines = entryIds.length
    ? await db.select().from(journalLines).where(inArray(journalLines.entryId, entryIds))
    : [];
  const linesByEntry = new Map<number, typeof lines>();
  for (const l of lines) {
    const arr = linesByEntry.get(l.entryId) ?? [];
    arr.push(l);
    linesByEntry.set(l.entryId, arr);
  }
  return scoped.map((e) => ({ entry: e, lines: (linesByEntry.get(e.id) ?? []).sort((a, b) => a.lineNo - b.lineNo) }));
}

/** Tilikartta. */
export async function getChartOfAccounts(ledgerId: string): Promise<Account[]> {
  await rebuildLedgers();
  return db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId)).orderBy(asc(accounts.code));
}

/** Päiväkirja — chronological, one row per tapahtuma with its debit/credit lines. */
export async function getJournal(ledgerId: string, year?: number) {
  await rebuildLedgers();
  const accByld = await accountMapById(ledgerId);
  const data = await entriesWithLines(ledgerId, year);
  return data.map(({ entry, lines }) => ({
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date,
    description: entry.description,
    sourceType: entry.sourceType,
    lines: lines.map((l) => ({
      accountCode: accByld[l.accountId]?.code ?? "?",
      accountName: accByld[l.accountId]?.name ?? "?",
      debitCents: l.debitCents,
      creditCents: l.creditCents,
    })),
  }));
}

/** Pääkirja — the same entries grouped by account, each with a running balance. */
export async function getGeneralLedger(ledgerId: string, year?: number) {
  await rebuildLedgers();
  const accts = await db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId)).orderBy(asc(accounts.code));
  const data = await entriesWithLines(ledgerId, year);

  return accts.map((acc) => {
    const rows: { date: Date; entryNumber: number; description: string; debitCents: number; creditCents: number; balanceCents: number }[] = [];
    let balance = 0;
    // Normal-balance sign: asset/expense accounts read debit-positive;
    // liability/equity/revenue accounts read credit-positive.
    const sign = acc.accountType === "asset" || acc.accountType === "expense" ? 1 : -1;
    for (const { entry, lines } of data) {
      for (const l of lines) {
        if (l.accountId !== acc.id) continue;
        balance += sign * (l.debitCents - l.creditCents);
        rows.push({
          date: entry.date, entryNumber: entry.entryNumber, description: entry.description,
          debitCents: l.debitCents, creditCents: l.creditCents, balanceCents: balance,
        });
      }
    }
    return { account: acc, rows, endBalanceCents: balance };
  }).filter((a) => a.rows.length > 0 || a.account.isSystemAccount);
}

async function accountMapById(ledgerId: string): Promise<Record<number, Account>> {
  const rows = await db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId));
  const map: Record<number, Account> = {};
  for (const r of rows) map[r.id] = r;
  return map;
}

async function accountTotals(ledgerId: string, year?: number): Promise<Map<number, { account: Account; debit: number; credit: number }>> {
  const accts = await db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId));
  const byId = new Map(accts.map((a) => [a.id, { account: a, debit: 0, credit: 0 }]));
  const data = await entriesWithLines(ledgerId, year);
  for (const { lines } of data) {
    for (const l of lines) {
      const t = byId.get(l.accountId);
      if (!t) continue;
      t.debit += l.debitCents;
      t.credit += l.creditCents;
    }
  }
  return byId;
}

export interface IncomeStatementLine { code: string; name: string; cents: number }
export interface IncomeStatement {
  year: number;
  revenue: IncomeStatementLine[];
  revenueTotal: number;
  expenses: IncomeStatementLine[];
  expensesTotal: number;
  result: number; // tilikauden tulos
}

/** Tuloslaskelma (kululajikohtainen, pienyritys-muotoinen) for one calendar year. */
export async function getIncomeStatement(ledgerId: string, year: number): Promise<IncomeStatement> {
  await rebuildLedgers();
  const totals = await accountTotals(ledgerId, year);
  const revenue: IncomeStatementLine[] = [];
  const expensesArr: IncomeStatementLine[] = [];
  for (const { account, debit, credit } of Array.from(totals.values())) {
    if (account.accountType === "revenue" && credit - debit !== 0) {
      revenue.push({ code: account.code, name: account.name, cents: credit - debit });
    } else if (account.accountType === "expense" && debit - credit !== 0) {
      expensesArr.push({ code: account.code, name: account.name, cents: debit - credit });
    }
  }
  revenue.sort((a, b) => a.code.localeCompare(b.code));
  expensesArr.sort((a, b) => a.code.localeCompare(b.code));
  const revenueTotal = revenue.reduce((s, l) => s + l.cents, 0);
  const expensesTotal = expensesArr.reduce((s, l) => s + l.cents, 0);
  return { year, revenue, revenueTotal, expenses: expensesArr, expensesTotal, result: revenueTotal - expensesTotal };
}

export interface BalanceSheetLine { code: string; name: string; cents: number }
export interface BalanceSheet {
  asOf: Date;
  assets: BalanceSheetLine[];
  assetsTotal: number;
  liabilities: BalanceSheetLine[];
  liabilitiesTotal: number;
  equity: BalanceSheetLine[];
  /** Kaikkien tilikausien kumulatiivinen tulos (ei vielä erillistä täsmäytys-/
   *  päätösvientiä — toiminimellä koko voitto kuuluu suoraan omaan pääomaan). */
  cumulativeResultCents: number;
  equityTotal: number; // equity + cumulativeResultCents
  liabilitiesAndEquityTotal: number;
}

/**
 * Tase as of a given date — cumulative across ALL history (balance-sheet
 * accounts are not period-scoped like the tuloslaskelma). Assets always equal
 * liabilities + equity by construction: every journal entry balances, so
 * summing every account by its normal-balance sign nets to zero.
 */
export async function getBalanceSheet(ledgerId: string, asOf: Date): Promise<BalanceSheet> {
  await rebuildLedgers();
  const accts = await db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId));
  const allEntries = await entriesWithLines(ledgerId);
  const cutoff = allEntries.filter(({ entry }) => entry.date <= asOf);

  const totals = new Map(accts.map((a) => [a.id, { account: a, debit: 0, credit: 0 }]));
  for (const { lines } of cutoff) {
    for (const l of lines) {
      const t = totals.get(l.accountId);
      if (!t) continue;
      t.debit += l.debitCents;
      t.credit += l.creditCents;
    }
  }

  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  const equity: BalanceSheetLine[] = [];
  let revenueTotal = 0, expenseTotal = 0;
  for (const { account, debit, credit } of Array.from(totals.values())) {
    const net = debit - credit;
    if (account.accountType === "asset" && net !== 0) assets.push({ code: account.code, name: account.name, cents: net });
    else if (account.accountType === "liability" && -net !== 0) liabilities.push({ code: account.code, name: account.name, cents: -net });
    else if (account.accountType === "equity" && -net !== 0) equity.push({ code: account.code, name: account.name, cents: -net });
    else if (account.accountType === "revenue") revenueTotal += -net;
    else if (account.accountType === "expense") expenseTotal += net;
  }
  assets.sort((a, b) => a.code.localeCompare(b.code));
  liabilities.sort((a, b) => a.code.localeCompare(b.code));
  equity.sort((a, b) => a.code.localeCompare(b.code));
  const cumulativeResultCents = revenueTotal - expenseTotal;
  const equityContributed = equity.reduce((s, l) => s + l.cents, 0);
  const equityTotal = equityContributed + cumulativeResultCents;
  const liabilitiesTotal = liabilities.reduce((s, l) => s + l.cents, 0);

  return {
    asOf,
    assets, assetsTotal: assets.reduce((s, l) => s + l.cents, 0),
    liabilities, liabilitiesTotal,
    equity, cumulativeResultCents, equityTotal,
    liabilitiesAndEquityTotal: liabilitiesTotal + equityTotal,
  };
}

export interface FinanceSummary {
  year: number;
  totalInvoicedCents: number;   // asiakkailta laskutettu (ei sisäiset laskut)
  totalIncomeCents: number;     // rahaa sisään pankkitilille (asiakkaat + toiselta yrittäjältä)
  totalExpensesCents: number;   // kaikki kulut
  profitCents: number;          // jää itselle
}

/** The one clean "Talousnäkymä" screen — section 3 of the spec, on purpose nothing more. */
export async function getFinanceSummary(ledgerId: string, year: number): Promise<FinanceSummary> {
  await rebuildLedgers();
  const totals = await accountTotals(ledgerId, year);
  let totalInvoicedCents = 0, totalIncomeCents = 0, totalExpensesCents = 0, revenueTotal = 0;
  for (const { account, debit, credit } of Array.from(totals.values())) {
    if (account.code === "3000") totalInvoicedCents += credit - debit;      // asiakasmyynti
    if (account.code === "1910") totalIncomeCents += debit;                 // kaikki pankkitilille tullut raha
    if (account.accountType === "expense") totalExpensesCents += debit - credit;
    if (account.accountType === "revenue") revenueTotal += credit - debit;  // sisältää sisäisen myynnin
  }
  return { year, totalInvoicedCents, totalIncomeCents, totalExpensesCents, profitCents: revenueTotal - totalExpensesCents };
}
