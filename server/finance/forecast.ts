/**
 * Ennustelaskelma — a planning tool, kept deliberately separate from the real
 * ledger (it never posts a journal entry). One ForecastEntry row is either a
 * one-off or a monthly-recurring projected income/expense line; this module
 * just expands those rows into a month-by-month projection table.
 */
import type { ForecastEntry } from "@shared/schema";

export interface ForecastMonth {
  month: string; // "YYYY-MM"
  incomeCents: number;
  expenseCents: number;
  profitCents: number;
}

/** True when a forecast entry is "active" (applies) in the given month. */
function activeIn(entry: ForecastEntry, month: string): boolean {
  if (!entry.recurring) return entry.startMonth === month;
  if (month < entry.startMonth) return false;
  if (entry.endMonth && month > entry.endMonth) return false;
  return true;
}

/** List of "YYYY-MM" strings from `start` through `end`, inclusive. */
export function monthRange(start: string, end: string): string[] {
  const months: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [endY, endM] = end.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

export function projectMonths(entries: ForecastEntry[], months: string[]): ForecastMonth[] {
  return months.map((month) => {
    let incomeCents = 0, expenseCents = 0;
    for (const e of entries) {
      if (!activeIn(e, month)) continue;
      if (e.kind === "income") incomeCents += e.amountCents;
      else expenseCents += e.amountCents;
    }
    return { month, incomeCents, expenseCents, profitCents: incomeCents - expenseCents };
  });
}
