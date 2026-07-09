/**
 * Manual "Varmuuskopioi Google Driveen" — snapshots the current tilikartta,
 * päiväkirja, pääkirja, tuloslaskelma and tase (plus the ennustelaskelma) as
 * Google Sheets, one call per report so a partial failure (e.g. Drive quota)
 * doesn't lose the others. Triggered by a button in kirjanpito-section.tsx —
 * see docs/google-drive-backup.md for why this is a manual click rather than
 * an on-every-read auto-upload (reports change on every request; invoices,
 * which are discrete events, DO upload automatically — server/drive/upload.ts
 * call sites in server/routes.ts).
 */
import { getChartOfAccounts, getJournal, getGeneralLedger, getIncomeStatement, getBalanceSheet } from "./reports";
import { uploadAsSheet } from "../drive/upload";
import { LEDGER_DEFS } from "./accounts";
import { db } from "../db";
import { forecastEntries } from "@shared/schema";
import { eq } from "drizzle-orm";
import { monthRange, projectMonths } from "./forecast";

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(";")).join("\n");
}
const eur = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const founderName = (ledgerId: string) => LEDGER_DEFS.find((l) => l.id === ledgerId)?.name.split(/\s+/)[0] ?? ledgerId;

export interface BackupResult {
  ledgerId: string;
  year: number;
  uploaded: { report: string; ok: boolean }[];
}

/** Backs up one ledger's tilikartta/päiväkirja/pääkirja/tuloslaskelma/tase for one year. */
export async function backupLedgerReports(ledgerId: string, year: number): Promise<BackupResult> {
  const folder = ["Kirjanpito", founderName(ledgerId), String(year)];
  const uploaded: BackupResult["uploaded"] = [];

  const chart = await getChartOfAccounts(ledgerId);
  uploaded.push({
    report: "tilikartta",
    ok: !!(await uploadAsSheet(
      { kind: "chart_of_accounts", sourceKey: ledgerId, folderPath: ["Kirjanpito", founderName(ledgerId)], filename: `Tilikartta - ${founderName(ledgerId)}` },
      toCsv([["Tili", "Nimi", "Tyyppi"], ...chart.map((a) => [a.code, a.name, a.accountType])]),
    )),
  });

  const journal = await getJournal(ledgerId, year);
  const journalRows: (string | number)[][] = [["Nro", "Päivämäärä", "Kuvaus", "Tili", "Tilin nimi", "Debet", "Kredit"]];
  for (const e of journal) {
    for (const l of e.lines) {
      journalRows.push([e.entryNumber, new Date(e.date).toLocaleDateString("fi-FI"), e.description, l.accountCode, l.accountName, l.debitCents ? eur(l.debitCents) : "", l.creditCents ? eur(l.creditCents) : ""]);
    }
  }
  uploaded.push({
    report: "päiväkirja",
    ok: !!(await uploadAsSheet(
      { kind: "journal", sourceKey: `${ledgerId}:${year}`, folderPath: folder, filename: `Päiväkirja ${year} - ${founderName(ledgerId)}` },
      toCsv(journalRows),
    )),
  });

  const ledger = await getGeneralLedger(ledgerId, year);
  const ledgerRows: (string | number)[][] = [["Tili", "Nimi", "Päivämäärä", "Kuvaus", "Debet", "Kredit", "Saldo"]];
  for (const a of ledger) {
    ledgerRows.push([a.account.code, a.account.name, "", "", "", "", eur(a.endBalanceCents)]);
    for (const r of a.rows) {
      ledgerRows.push(["", "", new Date(r.date).toLocaleDateString("fi-FI"), r.description, r.debitCents ? eur(r.debitCents) : "", r.creditCents ? eur(r.creditCents) : "", eur(r.balanceCents)]);
    }
  }
  uploaded.push({
    report: "pääkirja",
    ok: !!(await uploadAsSheet(
      { kind: "general_ledger", sourceKey: `${ledgerId}:${year}`, folderPath: folder, filename: `Pääkirja ${year} - ${founderName(ledgerId)}` },
      toCsv(ledgerRows),
    )),
  });

  const income = await getIncomeStatement(ledgerId, year);
  const incomeRows: (string | number)[][] = [["Erä", "Summa (€)"]];
  for (const l of income.revenue) incomeRows.push([`${l.code} ${l.name}`, eur(l.cents)]);
  incomeRows.push(["Liikevaihto yhteensä", eur(income.revenueTotal)]);
  for (const l of income.expenses) incomeRows.push([`${l.code} ${l.name}`, "-" + eur(l.cents)]);
  incomeRows.push(["Kulut yhteensä", "-" + eur(income.expensesTotal)]);
  incomeRows.push([`Tilikauden tulos ${year}`, eur(income.result)]);
  uploaded.push({
    report: "tuloslaskelma",
    ok: !!(await uploadAsSheet(
      { kind: "income_statement", sourceKey: `${ledgerId}:${year}`, folderPath: folder, filename: `Tuloslaskelma ${year} - ${founderName(ledgerId)}` },
      toCsv(incomeRows),
    )),
  });

  const balance = await getBalanceSheet(ledgerId, new Date());
  const balanceRows: (string | number)[][] = [["Vastaavaa", "Summa (€)", "", "Vastattavaa", "Summa (€)"]];
  const maxRows = Math.max(balance.assets.length, balance.liabilities.length + balance.equity.length + 1);
  const liabEquity = [
    ...balance.liabilities.map((l) => [`${l.code} ${l.name}`, eur(l.cents)]),
    ...balance.equity.map((l) => [`${l.code} ${l.name}`, eur(l.cents)]),
    ["Kumulatiivinen tulos", eur(balance.cumulativeResultCents)],
  ];
  for (let i = 0; i < maxRows; i++) {
    const a = balance.assets[i];
    const b = liabEquity[i];
    balanceRows.push([a ? `${a.code} ${a.name}` : "", a ? eur(a.cents) : "", "", b?.[0] ?? "", b?.[1] ?? ""]);
  }
  balanceRows.push(["Vastaavaa yhteensä", eur(balance.assetsTotal), "", "Vastattavaa yhteensä", eur(balance.liabilitiesAndEquityTotal)]);
  uploaded.push({
    report: "tase",
    ok: !!(await uploadAsSheet(
      { kind: "balance_sheet", sourceKey: ledgerId, folderPath: ["Kirjanpito", founderName(ledgerId)], filename: `Tase - ${founderName(ledgerId)} (${new Date().toLocaleDateString("fi-FI")})` },
      toCsv(balanceRows),
    )),
  });

  return { ledgerId, year, uploaded };
}

/** Backs up one ledger's ennustelaskelma (12 months from the current month). */
export async function backupForecast(ledgerId: string): Promise<{ ok: boolean }> {
  const rows = await db.select().from(forecastEntries).where(eq(forecastEntries.ledgerId, ledgerId));
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const endDate = new Date(now.getFullYear(), now.getMonth() + 11, 1);
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}`;
  const months = projectMonths(rows, monthRange(start, end));

  const csvRows: (string | number)[][] = [["Rivi", "Tyyppi", "€/kk", "Alkaa", "Päättyy", "Toistuva"]];
  for (const r of rows) csvRows.push([r.label, r.kind === "income" ? "Tulo" : "Kulu", eur(r.amountCents), r.startMonth, r.endMonth ?? "", r.recurring ? "Kyllä" : "Ei"]);
  csvRows.push([]);
  csvRows.push(["Kuukausi", "Ennustetulo (€)", "Ennustekulu (€)", "Ennustevoitto (€)"]);
  for (const m of months) csvRows.push([m.month, eur(m.incomeCents), eur(m.expenseCents), eur(m.profitCents)]);

  const ok = !!(await uploadAsSheet(
    { kind: "forecast", sourceKey: ledgerId, folderPath: ["Ennustelaskelmat", founderName(ledgerId)], filename: `Ennustelaskelma - ${founderName(ledgerId)}` },
    toCsv(csvRows),
  ));
  return { ok };
}
