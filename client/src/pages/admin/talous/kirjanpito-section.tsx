/**
 * "Kirjanpito" — the NEW double-entry ledger views (Yhteenveto, Tuloslaskelma,
 * Tase, Tilit & pääkirja, Ennuste). Everything here is generated automatically
 * from jobs/expenses/investments/founderSettlements (server/finance/*.ts) —
 * nothing on this screen is hand-typed.
 *
 * This is intentionally a SEPARATE lens from the "Oma tulos" card above it on
 * the Talous-page: "Oma tulos" is the quick personal OmaVero filing figure
 * (unchanged, still the number to actually file), while this section is the
 * formal kahdenkertainen kirjanpito, built ahead of time for a future Oy. The
 * two numbers do not have to match today — see docs/talous-kirjanpito.md.
 */
import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Disclosure } from "@/components/ui/disclosure";
import { Trash2 } from "lucide-react";
import {
  api,
  type FinanceAccount, type FinanceJournalEntry, type FinanceLedgerAccount,
  type FinanceIncomeStatement, type FinanceBalanceSheet, type FinanceSummary, type FinanceForecastEntry,
} from "@/lib/api";
import { BRAND_BILLERS } from "@shared/billers";

const fmt = (cents: number) => (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("fi-FI");
const firstName = (n: string) => n.trim().split(/\s+/)[0];

export function KirjanpitoSection({ defaultLedgerId }: { defaultLedgerId: string }) {
  const [ledgerId, setLedgerId] = useState(defaultLedgerId);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  return (
    <Card className="p-5 bg-card border-0 premium-shadow mb-4 print:hidden">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold">Kirjanpito</h2>
          <p className="text-[11px] text-muted-foreground max-w-md">
            Kahdenkertainen kirjanpito — muodostuu automaattisesti laskuista, kuluista ja
            yrittäjien välisistä laskuista. Oma tilikartta, päiväkirja ja pääkirja per Y-tunnus.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-full border overflow-hidden text-xs">
            {BRAND_BILLERS.map((b) => (
              <button
                key={b.id}
                onClick={() => setLedgerId(b.id)}
                className={`px-3 py-1.5 font-medium transition-colors ${ledgerId === b.id ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
              >
                {firstName(b.name)}
              </button>
            ))}
          </div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs defaultValue="yhteenveto">
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="yhteenveto">Yhteenveto</TabsTrigger>
          <TabsTrigger value="tuloslaskelma">Tuloslaskelma</TabsTrigger>
          <TabsTrigger value="tase">Tase</TabsTrigger>
          <TabsTrigger value="paakirja">Tilit &amp; pääkirja</TabsTrigger>
          <TabsTrigger value="ennuste">Ennuste</TabsTrigger>
        </TabsList>
        <TabsContent value="yhteenveto"><SummaryTab ledgerId={ledgerId} year={year} /></TabsContent>
        <TabsContent value="tuloslaskelma"><IncomeStatementTab ledgerId={ledgerId} year={year} /></TabsContent>
        <TabsContent value="tase"><BalanceSheetTab ledgerId={ledgerId} /></TabsContent>
        <TabsContent value="paakirja"><LedgerTab ledgerId={ledgerId} year={year} /></TabsContent>
        <TabsContent value="ennuste"><ForecastTab ledgerId={ledgerId} /></TabsContent>
      </Tabs>
    </Card>
  );
}

// ─── Yhteenveto ────────────────────────────────────────────────────────────────

function SummaryTab({ ledgerId, year }: { ledgerId: string; year: number }) {
  const [data, setData] = useState<FinanceSummary | null>(null);
  useEffect(() => {
    setData(null);
    api.financeSummary(ledgerId, year).then((r) => { if (r.ok && r.data) setData(r.data); });
  }, [ledgerId, year]);

  if (!data) return <p className="text-sm text-muted-foreground py-4">Ladataan…</p>;
  const cards = [
    { label: `Laskutettu ${year}`, cents: data.totalInvoicedCents, hint: "Asiakkailta laskutettu yhteensä" },
    { label: "Rahaa sisään", cents: data.totalIncomeCents, hint: "Pankkitilille tullut (asiakkaat + toinen yrittäjä)" },
    { label: "Kulut", cents: data.totalExpensesCents, hint: "Kaikki kirjatut kulut ja hankinnat" },
    { label: "Jää itselle (voitto)", cents: data.profitCents, hint: "Tuotot − kulut", highlight: true },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl border p-3 ${c.highlight ? "bg-green-50 dark:bg-green-900/20 border-green-500/30" : "bg-muted/20"}`}>
          <p className="text-[11px] text-muted-foreground mb-1">{c.label}</p>
          <p className={`text-xl font-bold tabular-nums ${c.highlight ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>{fmt(c.cents)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{c.hint}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Tuloslaskelma ──────────────────────────────────────────────────────────────

function IncomeStatementTab({ ledgerId, year }: { ledgerId: string; year: number }) {
  const [data, setData] = useState<FinanceIncomeStatement | null>(null);
  useEffect(() => {
    setData(null);
    api.financeIncomeStatement(ledgerId, year).then((r) => { if (r.ok && r.data) setData(r.data); });
  }, [ledgerId, year]);

  if (!data) return <p className="text-sm text-muted-foreground py-4">Ladataan…</p>;
  return (
    <div className="pt-3 text-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Liikevaihto</p>
      {data.revenue.length === 0 ? <p className="text-muted-foreground text-xs mb-2">Ei kirjauksia.</p> : (
        <div className="divide-y divide-border/50 mb-2">
          {data.revenue.map((l) => (
            <div key={l.code} className="flex justify-between py-1.5"><span>{l.code} {l.name}</span><span className="tabular-nums">{fmt(l.cents)}</span></div>
          ))}
        </div>
      )}
      <div className="flex justify-between py-1.5 font-semibold border-t border-border"><span>Liikevaihto yhteensä</span><span className="tabular-nums">{fmt(data.revenueTotal)}</span></div>

      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mt-4 mb-1">Kulut</p>
      {data.expenses.length === 0 ? <p className="text-muted-foreground text-xs mb-2">Ei kirjauksia.</p> : (
        <div className="divide-y divide-border/50 mb-2">
          {data.expenses.map((l) => (
            <div key={l.code} className="flex justify-between py-1.5"><span>{l.code} {l.name}</span><span className="tabular-nums">−{fmt(l.cents)}</span></div>
          ))}
        </div>
      )}
      <div className="flex justify-between py-1.5 font-semibold border-t border-border"><span>Kulut yhteensä</span><span className="tabular-nums">−{fmt(data.expensesTotal)}</span></div>

      <div className="flex justify-between py-3 mt-3 border-t-2 border-border font-bold text-base">
        <span>Tilikauden tulos ({year})</span>
        <span className={`tabular-nums ${data.result >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(data.result)}</span>
      </div>
    </div>
  );
}

// ─── Tase ────────────────────────────────────────────────────────────────────────

function BalanceSheetTab({ ledgerId }: { ledgerId: string }) {
  const [data, setData] = useState<FinanceBalanceSheet | null>(null);
  useEffect(() => {
    setData(null);
    api.financeBalanceSheet(ledgerId).then((r) => { if (r.ok && r.data) setData(r.data); });
  }, [ledgerId]);

  if (!data) return <p className="text-sm text-muted-foreground py-4">Ladataan…</p>;
  const balanced = data.assetsTotal === data.liabilitiesAndEquityTotal;
  return (
    <div className="pt-3 text-sm">
      <p className="text-[11px] text-muted-foreground mb-3">Tilanne {fmtDate(data.asOf)}</p>
      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Vastaavaa</p>
          {data.assets.length === 0 && <p className="text-muted-foreground text-xs">Ei kirjauksia.</p>}
          <div className="divide-y divide-border/50">
            {data.assets.map((l) => (
              <div key={l.code} className="flex justify-between py-1.5"><span>{l.code} {l.name}</span><span className="tabular-nums">{fmt(l.cents)}</span></div>
            ))}
          </div>
          <div className="flex justify-between py-1.5 mt-1 font-semibold border-t border-border"><span>Vastaavaa yhteensä</span><span className="tabular-nums">{fmt(data.assetsTotal)}</span></div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Vastattavaa</p>
          {data.liabilities.map((l) => (
            <div key={l.code} className="flex justify-between py-1.5"><span>{l.code} {l.name}</span><span className="tabular-nums">{fmt(l.cents)}</span></div>
          ))}
          {data.equity.map((l) => (
            <div key={l.code} className="flex justify-between py-1.5"><span>{l.code} {l.name}</span><span className="tabular-nums">{fmt(l.cents)}</span></div>
          ))}
          <div className="flex justify-between py-1.5"><span>Kumulatiivinen tulos</span><span className="tabular-nums">{fmt(data.cumulativeResultCents)}</span></div>
          <div className="flex justify-between py-1.5 mt-1 font-semibold border-t border-border"><span>Vastattavaa yhteensä</span><span className="tabular-nums">{fmt(data.liabilitiesAndEquityTotal)}</span></div>
        </div>
      </div>
      <p className={`text-[11px] mt-4 ${balanced ? "text-green-600" : "text-red-600"}`}>
        {balanced ? "✓ Tase täsmää — vastaavaa = vastattavaa." : "⚠ Tase ei täsmää — tarkista kirjaukset."}
      </p>
    </div>
  );
}

// ─── Tilit & pääkirja ───────────────────────────────────────────────────────────

function LedgerTab({ ledgerId, year }: { ledgerId: string; year: number }) {
  const [accounts, setAccounts] = useState<FinanceLedgerAccount[] | null>(null);
  const [journal, setJournal] = useState<FinanceJournalEntry[] | null>(null);
  useEffect(() => {
    setAccounts(null); setJournal(null);
    api.financeGeneralLedger(ledgerId, year).then((r) => { if (r.ok && r.data) setAccounts(r.data.accounts); });
    api.financeJournal(ledgerId, year).then((r) => { if (r.ok && r.data) setJournal(r.data.entries); });
  }, [ledgerId, year]);

  return (
    <div className="pt-3 space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Pääkirja (tileittäin, {year})</p>
        {!accounts ? <p className="text-sm text-muted-foreground py-2">Ladataan…</p> : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Ei kirjauksia vuodelle {year}.</p>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <Disclosure
                key={a.account.id}
                variant="inline"
                title={`${a.account.code} ${a.account.name}`}
                right={<span className="text-xs tabular-nums text-muted-foreground">{fmt(a.endBalanceCents)}</span>}
              >
                {a.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">Ei vientejä tällä tilillä {year}.</p>
                ) : (
                  <div className="divide-y divide-border/40 text-xs">
                    {a.rows.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="text-muted-foreground">{fmtDate(r.date)} · {r.description}</span>
                        <span className="tabular-nums shrink-0">
                          {r.debitCents > 0 ? `+${fmt(r.debitCents)}` : `−${fmt(r.creditCents)}`}
                          <span className="text-muted-foreground"> · saldo {fmt(r.balanceCents)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Disclosure>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Päiväkirja (aikajärjestyksessä, {year})</p>
        {!journal ? <p className="text-sm text-muted-foreground py-2">Ladataan…</p> : journal.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Ei kirjauksia vuodelle {year}.</p>
        ) : (
          <div className="divide-y divide-border/40 text-xs max-h-96 overflow-y-auto">
            {journal.map((e) => (
              <div key={e.id} className="py-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-foreground">#{e.entryNumber} · {fmtDate(e.date)} · {e.description}</span>
                </div>
                {e.lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-muted-foreground pl-3">
                    <span>{l.accountCode} {l.accountName}</span>
                    <span className="tabular-nums">{l.debitCents > 0 ? `Debet ${fmt(l.debitCents)}` : `Kredit ${fmt(l.creditCents)}`}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ennuste ────────────────────────────────────────────────────────────────────

function ForecastTab({ ledgerId }: { ledgerId: string }) {
  const [entries, setEntries] = useState<FinanceForecastEntry[] | null>(null);
  const [months, setMonths] = useState<{ month: string; incomeCents: number; expenseCents: number; profitCents: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState("");
  const [startMonth, setStartMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [recurring, setRecurring] = useState(true);

  const load = useCallback(() => {
    api.financeForecast(ledgerId).then((r) => { if (r.ok && r.data) setEntries(r.data.entries); });
    api.financeForecastProjection(ledgerId).then((r) => { if (r.ok && r.data) setMonths(r.data.months); });
  }, [ledgerId]);
  useEffect(() => { setEntries(null); setMonths(null); load(); }, [ledgerId, load]);

  const add = async () => {
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!label.trim() || !Number.isFinite(cents) || cents <= 0) return;
    setBusy(true);
    const res = await api.addFinanceForecastEntry({
      ledgerId, label: label.trim(), kind, amountCents: cents, startMonth,
      endMonth: null, recurring, category: "muu",
    });
    setBusy(false);
    if (res.ok) { setLabel(""); setAmount(""); load(); }
  };

  const remove = async (id: number) => {
    setBusy(true);
    await api.deleteFinanceForecastEntry(id);
    setBusy(false);
    load();
  };

  return (
    <div className="pt-3 space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Suunnittelutyökalu — ei vaikuta kirjanpitoon. Arvioi tulevia tuloja/kuluja kuukausitasolla.
      </p>

      <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted-foreground flex-1 min-w-[140px]">
            Nimi
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-0.5 h-8 text-xs" placeholder="esim. Kesän isot keikat" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Tyyppi
            <select value={kind} onChange={(e) => setKind(e.target.value as "income" | "expense")} className="mt-0.5 h-8 w-full rounded-md border bg-background px-2 text-xs block">
              <option value="income">Tulo</option>
              <option value="expense">Kulu</option>
            </select>
          </label>
          <label className="text-[11px] text-muted-foreground w-24">
            €/kk
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-0.5 h-8 text-xs tabular-nums" />
          </label>
          <label className="text-[11px] text-muted-foreground w-32">
            Alkaa
            <Input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className="mt-0.5 h-8 text-xs" />
          </label>
          <label className="text-[11px] text-muted-foreground flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Toistuva
          </label>
          <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={add}>Lisää</Button>
        </div>
      </div>

      {entries && entries.length > 0 && (
        <div className="divide-y divide-border/50 text-xs">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>{e.label} · {e.kind === "income" ? "tulo" : "kulu"} · {fmt(e.amountCents)}/kk · alkaen {e.startMonth}{e.recurring ? "" : " (kertaluonteinen)"}</span>
              <button onClick={() => remove(e.id)} className="text-muted-foreground hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {months && months.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-1.5 pr-3 text-[10px] font-semibold text-muted-foreground uppercase">Kuukausi</th>
                <th className="pb-1.5 pr-3 text-[10px] font-semibold text-muted-foreground uppercase text-right">Ennustetulo</th>
                <th className="pb-1.5 pr-3 text-[10px] font-semibold text-muted-foreground uppercase text-right">Ennustekulu</th>
                <th className="pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase text-right">Ennustevoitto</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b border-border/40">
                  <td className="py-1.5 pr-3">{m.month}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(m.incomeCents)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">−{fmt(m.expenseCents)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${m.profitCents >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(m.profitCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
