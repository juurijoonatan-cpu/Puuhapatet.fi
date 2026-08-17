/**
 * FAS-minimal chart of accounts (tilikartta) + ledger bootstrapping.
 *
 * One identical template is seeded for every ledger (kirjanpitovelvollinen).
 * The codes follow the customary Finnish tilikartta numbering (1000s = assets,
 * 2000s = liabilities/equity, 3000s = revenue, 4000s+ = expenses) so a future
 * accountant/tilitoimisto recognizes the structure immediately, and so a
 * future Oy ledger can reuse the exact same accounts (equity account NAMES
 * change at Oy conversion — "Yksityissijoitukset" → "Osakepääoma" — but the
 * schema/codes don't need to).
 *
 * Accounts marked `isSystemAccount` are the auto-poster's fixed targets
 * (server/finance/post.ts) — never rename/delete their `code` without
 * updating the poster. A few accounts are seeded but not yet posted to by
 * anything (e.g. 1700 Myyntisaamiset, 5000 Henkilöstökulut, 6000 Poistot) —
 * they exist so the tilikartta already has the right shape for accrual-basis
 * bookkeeping and payroll once this becomes an Oy; see docs/talous-kirjanpito.md.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { ledgers, accounts, fiscalYears, type Account } from "@shared/schema";
// Tilikartan puhdas data asuu erillään, jotta vientisäännöt voivat lukea
// tilinumerot ilman että tietokantayhteys tulee mukana. Re-exportataan tästä,
// jotta olemassa olevat importit (`from "./accounts"`) toimivat ennallaan.
import { STANDARD_ACCOUNTS, ACCOUNT, LEDGER_DEFS, type AccountDef } from "./account-codes";
export { STANDARD_ACCOUNTS, ACCOUNT, LEDGER_DEFS, type AccountDef };

/** Create the ledger row + standard chart of accounts if they don't exist yet. Idempotent. */
export async function ensureLedger(ledgerId: string): Promise<void> {
  const def = LEDGER_DEFS.find((l) => l.id === ledgerId);
  if (!def) throw new Error(`Tuntematon kirjanpitovelvollinen: ${ledgerId}`);

  const [existing] = await db.select().from(ledgers).where(eq(ledgers.id, ledgerId));
  if (!existing) {
    await db.insert(ledgers).values({ id: def.id, name: def.name, yTunnus: def.yTunnus, entityType: def.entityType });
  }

  const existingAccounts = await db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId));
  const existingCodes = new Set(existingAccounts.map((a) => a.code));
  const missing = STANDARD_ACCOUNTS.filter((a) => !existingCodes.has(a.code));
  if (missing.length > 0) {
    await db.insert(accounts).values(
      missing.map((a) => ({ ledgerId, code: a.code, name: a.name, accountType: a.accountType, isSystemAccount: true })),
    );
  }
}

export async function ensureAllLedgers(): Promise<void> {
  for (const def of LEDGER_DEFS) await ensureLedger(def.id);
}

/** Map of account code → account row, for one ledger. Assumes ensureLedger() already ran. */
export async function accountsByCode(ledgerId: string): Promise<Record<string, Account>> {
  const rows = await db.select().from(accounts).where(eq(accounts.ledgerId, ledgerId));
  const map: Record<string, Account> = {};
  for (const r of rows) map[r.code] = r;
  return map;
}

/**
 * Fiscal year (tilikausi) for a given accounting date, calendar-year by
 * default (Jan 1 – Dec 31) — matches how the rest of the app already groups
 * money "by year" (tax-export.tsx, ALV-tracking). Creates the row on first
 * use so fiscal years never need manual setup.
 */
export async function ensureFiscalYear(ledgerId: string, date: Date): Promise<{ id: number; isClosed: boolean }> {
  const year = date.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const [existing] = await db.select().from(fiscalYears)
    .where(and(eq(fiscalYears.ledgerId, ledgerId), eq(fiscalYears.startDate, start)));
  if (existing) return { id: existing.id, isClosed: existing.isClosed };
  const [row] = await db.insert(fiscalYears)
    .values({ ledgerId, startDate: start, endDate: end, isClosed: false })
    .returning();
  return { id: row.id, isClosed: row.isClosed };
}
