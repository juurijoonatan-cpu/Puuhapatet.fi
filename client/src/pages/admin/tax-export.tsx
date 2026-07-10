/**
 * Talous & verotus — yksi talousnäkymä kahdelle kevytyrittäjälle.
 *
 * Rakenne (2026-07 uudistus, ks. docs/talous-kirjanpito.md § Osa 3):
 *  · Yhteenveto  — Oma tulos (henkilökohtainen OmaVero-arvio), Bossien velka,
 *    ALV-raja, ja Kirjanpidon yhteenveto samalla ruudulla.
 *  · Laskut      — molempien bossien laskuttamat keikat ja urakkaerät samalla
 *    listalla (kumpikin näkee toisensa selkeästi).
 *  · Tuloslaskelma / Tase / Tilit & pääkirja / Ennuste — FAS-mukainen
 *    kahdenkertainen kirjanpito (server/finance/*.ts), muodostuu automaattisesti
 *    laskuista/kuluista. Ei hand-typed lukuja.
 *  · Lisäasetukset (piilossa oletuksena) — urakkaerien korjaustyökalu ja
 *    bossien tilityksen käsin kirjaaminen/historiaerittely.
 *
 * "Oma tulos" ja Kirjanpidon oma tulosluku eivät ole tarkoituksella sama
 * numero (kate-osuus heti vs. koko erä + myöhempi tilitys) — päätetty pitää
 * molemmat, ks. docs/talous-kirjanpito.md. Tällä sivulla molemmat näkyvät
 * kerran, vierekkäin, lyhyellä selityksellä miksi ne voivat poiketa.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Printer, Percent, Info, Wallet, FileText, Loader2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api, type FounderCrossSettlement, type WorkerDetail } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { BRAND_BILLERS } from "@shared/billers";
import { feeRateForWorker, STAFF_SERVICE_FEE_RATE, effectiveJobTotal } from "@shared/team";
import { SummaryTab, IncomeStatementTab, BalanceSheetTab, LedgerTab, ForecastTab, DriveBackupBar } from "./talous/kirjanpito-section";

interface JobRow {
  job: {
    id: number;
    status: string;
    description: string;
    agreedPrice: number;
    assignedTo: string | null;
    scheduledAt: string | null;
    createdAt: string;
    waiveFee?: boolean;
    quoteStatus?: string | null;
    unitCount?: number | null;
    isTaloyhtiio?: boolean | null;
    isCustomGig?: boolean | null;
    billedBy?: string | null;
  };
  customer: { id: number; name: string; address: string } | null;
}

/** Normalize assignedTo value to array of user IDs */
function parseWorkerIds(assignedTo: string | null): string[] {
  if (!assignedTo) return [];
  return assignedTo
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const byName = USERS.find(u => u.name === s);
      return byName ? byName.id : s;
    });
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fi-FI") : "—";
const firstName = (n: string) => n.trim().split(/\s+/)[0];

/** Mirror of the server's inferBillerId: explicit billedBy wins; otherwise a
 *  job whose workers contain EXACTLY ONE founder was billed by that founder. */
function inferredBiller(job: JobRow["job"]): { id: string; name: string } | null {
  if (job.billedBy) return null; // explicit — nothing to infer
  const ids = parseWorkerIds(job.assignedTo);
  const matches = BRAND_BILLERS.filter(b => ids.includes(b.id));
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name } : null;
}

interface LaskuRow {
  jobId: number; dateMs: number; name: string; ref?: string; amountCents: number;
  source: "keikka" | "era"; billerId: string; billerName: string;
}

export default function TaxExportPage() {
  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";
  const otherFounder = BRAND_BILLERS.find(b => b.id !== profile?.id) ?? BRAND_BILLERS[1];

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [turnover, setTurnover] = useState<Awaited<ReturnType<typeof api.getBillerTurnover>>["data"] | null>(null);
  const [settlement, setSettlement] = useState<FounderCrossSettlement | null>(null);
  // Serializes the one-tap era-biller assignments: the endpoint rewrites the
  // whole gigData blob, so two in-flight assignments on the same job would
  // race and one would silently vanish.
  const [eraBusy, setEraBusy] = useState(false);
  // Enterprise instalment manager (all gig erät, editable/deletable) — lives
  // in Lisäasetukset now, not the main flow.
  const [instalments, setInstalments] = useState<Awaited<ReturnType<typeof api.getGigInstalments>>["data"] | null>(null);
  // Both founders' own money trail (sent customer invoices etc.) — merged
  // into the Laskut tab so each sees the other's invoiced work too.
  const [myDetail, setMyDetail] = useState<WorkerDetail | null>(null);
  const [otherDetail, setOtherDetail] = useState<WorkerDetail | null>(null);
  // Which founder's books (Kirjanpito: Tuloslaskelma/Tase/Pääkirja/Ennuste) are
  // shown — ONE selector for the whole page instead of a separate one nested
  // inside the ledger card.
  const [ledgerId, setLedgerId] = useState(
    profile?.id && BRAND_BILLERS.some(b => b.id === profile.id) ? profile.id : BRAND_BILLERS[0].id
  );
  const [laskutFilter, setLaskutFilter] = useState<string>("kaikki");

  const loadMoney = useCallback(() => {
    api.getJobs().then((res) => {
      if (res.ok && res.data) {
        // Completed jobs only, and never a declined/cancelled quote — a declined
        // offer produced no income so it must stay out of the tax figures.
        setJobs((res.data as JobRow[]).filter(
          r => r.job.status === "done" && r.job.quoteStatus !== "declined"
        ));
      }
      setLoading(false);
    });
    if (isHost) {
      api.getBillerTurnover().then((res) => { if (res.ok && res.data) setTurnover(res.data); });
      api.getFounderSettlement().then((res) => { if (res.ok && res.data) setSettlement(res.data); });
      api.getGigInstalments().then((res) => { if (res.ok && res.data) setInstalments(res.data); });
      if (profile?.id) api.getWorker(profile.id).then((res) => { if (res.ok) setMyDetail(res.data ?? null); });
      if (otherFounder?.id) api.getWorker(otherFounder.id).then((res) => { if (res.ok) setOtherDetail(res.data ?? null); });
    }
  }, [isHost, profile?.id, otherFounder?.id]);

  useEffect(() => { loadMoney(); }, []);

  // HOST sets who billed a past job — the ALV turnover + founder cross-invoicing
  // reload so the money lands on the right person immediately.
  const setBilledBy = async (jobId: number, billedBy: string) => {
    setJobs(prev => prev.map(r => r.job.id === jobId ? { ...r, job: { ...r.job, billedBy: billedBy || null } } : r));
    await api.updateJob(jobId, { billedBy: billedBy || null } as any);
    loadMoney();
  };

  // Filter to the current user's jobs, then the selected year.
  const myJobs = jobs.filter(r => {
    if (!profile) return true;
    const workers = parseWorkerIds(r.job.assignedTo);
    return workers.length === 0 || workers.includes(profile.id);
  });
  const yearJobs = myJobs.filter(r => {
    const d = r.job.scheduledAt || r.job.createdAt;
    return new Date(d).getFullYear() === year;
  });

  const myFeeRate = profile ? feeRateForWorker(profile.id) : STAFF_SERVICE_FEE_RATE;
  const myFeePct = Math.round(myFeeRate * 100);

  // Per-job rows with the user's proportional share — this is "Keikkani",
  // the row-level detail behind the Oma tulos figure.
  const rows = yearJobs.map(r => {
    const workers = parseWorkerIds(r.job.assignedTo);
    const numWorkers = Math.max(workers.length, 1);
    const share = 1 / numWorkers;
    const myRevenue = Math.round(effectiveJobTotal(r.job) * share);
    const serviceFee = r.job.waiveFee ? 0 : Math.round(myRevenue * myFeeRate);
    const net = myRevenue - serviceFee;
    return { ...r, myRevenue, serviceFee, net, numWorkers };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.myRevenue,
      serviceFee: acc.serviceFee + r.serviceFee,
      net: acc.net + r.net,
    }),
    { revenue: 0, serviceFee: 0, net: 0 },
  );

  // The founder's FR8 kate share for the selected year — urakkatulot belong in
  // the yearly result too, not only keikkaosuudet. Eras without a recorded
  // billing date count into the selected year so they are never hidden.
  const fr8KateYear = (isHost && settlement && profile)
    ? settlement.perGig.reduce((sum, g) => sum + g.eras.reduce((s2, e) => {
        const y = e.dateMs ? new Date(e.dateMs).getFullYear() : year;
        if (y !== year) return s2;
        return s2 + (e.shares?.find(sh => sh.id === profile.id)?.cents ?? 0);
      }, 0), 0)
    : 0;
  const heroTotal = totals.net + fr8KateYear;

  // Year options: hosts see every year across BOTH founders' jobs (the Laskut
  // tab and Kirjanpito need this), everyone else sees just their own.
  const availableYears = Array.from(
    new Set((isHost ? jobs : myJobs).map(r => new Date(r.job.scheduledAt || r.job.createdAt).getFullYear()))
  ).sort((a, b) => b - a);
  const years = availableYears.length > 0 ? availableYears : [new Date().getFullYear()];

  // ── Laskut: combined invoice register for both founders ──────────────────
  const laskutAll: LaskuRow[] = isHost
    ? [
        ...(myDetail?.customerInvoices ?? []).map(inv => ({ ...inv, billerId: profile!.id, billerName: profile!.name })),
        ...(otherDetail?.customerInvoices ?? []).map(inv => ({ ...inv, billerId: otherFounder.id, billerName: otherFounder.name })),
      ]
    : [];
  const laskutYear = laskutAll.filter(r => new Date(r.dateMs).getFullYear() === year);
  const laskutFiltered = (laskutFilter === "kaikki" ? laskutYear : laskutYear.filter(r => r.billerId === laskutFilter))
    .slice()
    .sort((a, b) => b.dateMs - a.dateMs);
  const laskutSum = laskutFiltered.reduce((s, r) => s + r.amountCents, 0);

  const handlePrint = () => window.print();
  const handleCsv = () => {
    const header = "Päivämäärä;Asiakas;Osoite;Palvelu;Brutto-osuus (€);Palvelumaksu (€);Netto (€)";
    const lines = rows.map(r =>
      [
        fmtDate(r.job.scheduledAt || r.job.createdAt),
        r.customer?.name ?? "",
        r.customer?.address ?? "",
        `"${r.job.description}"`,
        (r.myRevenue / 100).toFixed(2).replace(".", ","),
        (r.serviceFee / 100).toFixed(2).replace(".", ","),
        (r.net / 100).toFixed(2).replace(".", ","),
      ].join(";")
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `puuhapatet_keikat_${year}_${profile?.id ?? "oma"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleLaskutCsv = () => {
    const header = "Pvm;Asiakas;Laskuttaja;Tyyppi;Viite;Summa (EUR)";
    const lines = laskutFiltered.map(r => [
      new Date(r.dateMs).toLocaleDateString("fi-FI"),
      `"${r.name.replace(/"/g, "'")}"`,
      r.billerName,
      r.source === "era" ? "urakkaerä" : "keikka",
      r.ref ?? "",
      (r.amountCents / 100).toFixed(2).replace(".", ","),
    ].join(";"));
    const csv = [header, ...lines, `Yhteensä;;;;;${(laskutSum / 100).toFixed(2).replace(".", ",")}`].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `puuhapatet_laskut_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const multiWorkerRows = rows.filter(r => r.numWorkers > 1);
  const ledgerName = BRAND_BILLERS.find(b => b.id === ledgerId)?.name ?? ledgerId;

  // ── "Oma tulos" + "Keikkani": shown to EVERYONE (host or not) — this is
  // the personal OmaVero filing figure and its row-level backup detail. ──
  const omaTulosBlock = (
    <Card className="p-5 bg-green-50 dark:bg-green-900/20 border-0 premium-shadow print:hidden">
      <p className="text-xs font-bold uppercase tracking-wide text-green-800 dark:text-green-300 mb-1">
        {profile?.hasYTunnus ? `Oma tulos (lomake 5) — ${year}` : `Oma tulos — ${year}`}
      </p>
      <p className="text-4xl font-bold text-green-700 dark:text-green-400 mb-1">{fmt(heroTotal)}</p>
      <p className="text-xs text-green-700 dark:text-green-400">
        Keikkaosuudet {fmt(totals.net)}{fr8KateYear > 0 ? <> + urakkakate {fmt(fr8KateYear)}</> : null}
        {" · ilmoita "}
        {profile?.hasYTunnus ? <strong>lomakkeella 5</strong> : <>kohtaan <strong>Muut ansiotulot</strong></>}
      </p>
      {isHost && (
        <p className="text-[11px] text-green-800/70 dark:text-green-400/70 mt-2 pt-2 border-t border-green-600/20">
          Tämä on henkilökohtainen arviosi — kate luetaan tuloksi heti kun keikka laskutetaan. Kirjanpito-
          välilehden "Jää itselle" -luku voi näyttää tästä eri summan: se kirjaa koko laskutetun erän
          laskuttaneen bossin kirjanpitoon, ja toisen osuuden vasta kun se oikeasti tilitetään.
        </p>
      )}

      <Disclosure
        variant="inline"
        className="mt-3"
        title={`Keikkani ${year} (${rows.length} kpl)`}
        right={<span className="text-xs text-green-800 dark:text-green-400 tabular-nums">{fmt(totals.revenue)}</span>}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Ei valmistuneita keikkoja vuodelle {year}.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Pvm</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Asiakas</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase text-right">Brutto</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase text-right hidden sm:table-cell">Maksu</th>
                    <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase text-right">Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.job.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{fmtDate(r.job.scheduledAt || r.job.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-foreground">{r.customer?.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.customer?.address ?? ""}</p>
                        {r.numWorkers > 1 && <p className="text-xs text-blue-600 dark:text-blue-400">1/{r.numWorkers} osuus</p>}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium">{fmt(r.myRevenue)}</td>
                      <td className="py-2 pr-3 text-right text-purple-600 dark:text-purple-400 hidden sm:table-cell">−{fmt(r.serviceFee)}</td>
                      <td className="py-2 text-right font-semibold text-green-600 dark:text-green-400">{fmt(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td colSpan={2} className="pt-3 text-foreground">Yhteensä</td>
                    <td className="pt-3 text-right">{fmt(totals.revenue)}</td>
                    <td className="pt-3 text-right text-purple-600 hidden sm:table-cell">−{fmt(totals.serviceFee)}</td>
                    <td className="pt-3 text-right text-green-600 font-bold">{fmt(totals.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground mt-3">
              Palvelumaksu {myFeePct} % bruttosta (yläraja — kulut kirjataan erikseen kuiteilla, eikä
              niitä ole vähennetty tähän). Kirjanpito kuitteineen säilytetään 6 vuotta.
            </p>

            {multiWorkerRows.length > 0 && (
              <Disclosure variant="inline" className="mt-4" title={`Tilityserittely — usean tekijän keikat (${multiWorkerRows.length})`}>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Näillä keikoilla yksi tekijä laskutti asiakasta koko summalla ja tilitti muille heidän
                  osuutensa. Yllä näkyvä oma osuutesi on verotettava tulosi.
                </p>
                <div className="space-y-2">
                  {multiWorkerRows.map(r => {
                    const names = parseWorkerIds(r.job.assignedTo)
                      .map(id => USERS.find(u => u.id === id)?.name ?? id).join(", ");
                    return (
                      <div key={r.job.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs border-b border-border/50 pb-2 last:border-0">
                        <div>
                          <span className="text-muted-foreground">{fmtDate(r.job.scheduledAt || r.job.createdAt)}</span>{" · "}
                          <span className="font-medium text-foreground">{r.customer?.name ?? "—"}</span>
                          <p className="text-muted-foreground">Tekijät: {names}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-foreground">Kokonaishinta {fmt(effectiveJobTotal(r.job))}</p>
                          <p className="text-muted-foreground">Oma osuus 1/{r.numWorkers} = {fmt(r.myRevenue)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Disclosure>
            )}

            <Button
              variant="outline" size="sm" className="mt-3 gap-1.5 text-xs"
              onClick={handleCsv}
            >
              <Download className="w-3.5 h-3.5" /> Lataa keikkalistani (CSV)
            </Button>
          </>
        )}
      </Disclosure>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background admin-shell-pad print:pt-4 print:pb-4">
      <div className="container mx-auto px-4 max-w-3xl">

        {/* ── Header (screen only) ───────────────────────────────────────── */}
        <div className="flex items-center gap-4 mb-6 print:hidden">
          <Link href="/admin/settings">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">Talous &amp; verotus</h1>
            <p className="text-sm text-muted-foreground truncate">
              {profile?.name ?? "Omat"} · tulos, laskut ja kirjanpito
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={handleCsv} className="gap-2"><Download className="w-4 h-4" /> CSV</Button>
            <Button onClick={handlePrint} className="gap-2"><Printer className="w-4 h-4" /> Tulosta</Button>
          </div>
        </div>

        {/* Year selector (screen only) — ONE selector for the whole page. */}
        <div className="flex flex-wrap items-center gap-2 mb-4 print:hidden">
          {years.map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border-2 transition-all ${
                year === y ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {/* Ledger selector (screen only, host only) — which founder's books
            (Kirjanpito: Tuloslaskelma/Tase/Pääkirja/Ennuste) are shown. */}
        {isHost && (
          <div className="flex items-center gap-2 mb-4 flex-wrap print:hidden">
            <span className="text-xs text-muted-foreground">Kirjanpito:</span>
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
            <DriveBackupBar ledgerId={ledgerId} year={year} />
          </div>
        )}

        {loading ? (
          <p className="text-muted-foreground text-center py-12">Ladataan…</p>
        ) : !isHost ? (
          <>
            {omaTulosBlock}
            {omaVeroNote(profile, totals)}
          </>
        ) : (
          <>
            <Tabs defaultValue="yhteenveto">
              <TabsList className="h-auto flex-wrap justify-start gap-1 print:hidden">
                <TabsTrigger value="yhteenveto">Yhteenveto</TabsTrigger>
                <TabsTrigger value="laskut">Laskut</TabsTrigger>
                <TabsTrigger value="tuloslaskelma">Tuloslaskelma</TabsTrigger>
                <TabsTrigger value="tase">Tase</TabsTrigger>
                <TabsTrigger value="paakirja">Tilit &amp; pääkirja</TabsTrigger>
                <TabsTrigger value="ennuste">Ennuste</TabsTrigger>
              </TabsList>

              <TabsContent value="yhteenveto" className="space-y-4 pt-4">
                {omaTulosBlock}

                {settlement && <FounderDebtCard settlement={settlement} onChanged={loadMoney} />}

                {turnover && (() => {
                  const limitCents = turnover.limitEur * 100;
                  const yearMap = turnover.turnoverByYear[String(year)] || {};
                  const un = turnover.unassignedByYear?.[String(year)];
                  const unassignedJobs = jobs.filter(r => {
                    const d = r.job.scheduledAt || r.job.createdAt;
                    return !r.job.billedBy && !r.job.isCustomGig && !inferredBiller(r.job) && new Date(d).getFullYear() === year;
                  });
                  // Gig instalments with no biller are shown for EVERY year — they
                  // are in nobody's figures at all until someone attributes them.
                  const unEras = turnover.unassignedEras ?? [];
                  const unTotal = (un?.cents ?? 0) + unEras.reduce((s2, e) => s2 + e.cents, 0);
                  const unCount = (un?.count ?? 0) + unEras.length;
                  return (
                    <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Percent className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <h2 className="text-sm font-bold">ALV-raja {year}</h2>
                        </div>
                        <span className="text-[11px] text-muted-foreground">ALV-vapaa alle {turnover.limitEur.toLocaleString("fi-FI")} €/hlö</span>
                      </div>
                      <div className="space-y-2">
                        {turnover.billers.map((b) => {
                          const cents = yearMap[b.id] ?? 0;
                          const pct = limitCents > 0 ? (cents / limitCents) * 100 : 0;
                          const level = pct >= 100 ? "over" : pct >= 70 ? "near" : "ok";
                          return (
                            <div key={b.id}>
                              <div className="flex items-center justify-between gap-2">
                                <Link href={`/admin/tiimi/${b.id}`} className="text-sm font-medium text-foreground hover:underline">{firstName(b.name)}</Link>
                                <span className={`text-sm font-semibold tabular-nums ${level === "over" ? "text-red-600" : level === "near" ? "text-amber-600" : "text-foreground"}`}>
                                  {fmt(cents)} <span className="text-[11px] font-normal text-muted-foreground">/ {turnover.limitEur.toLocaleString("fi-FI")} €</span> {level === "ok" ? "✓" : level === "near" ? "⚠️" : "❗"}
                                </span>
                              </div>
                              {level !== "ok" && (
                                <>
                                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-1">
                                    <div className={`h-full rounded-full ${level === "over" ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                  </div>
                                  <p className={`text-[11px] mt-0.5 ${level === "over" ? "text-red-600" : "text-amber-600"}`}>
                                    {level === "over"
                                      ? "Raja ylittynyt — rekisteröidy ALV-velvolliseksi (vero.fi)"
                                      : `Jäljellä ${fmt(Math.max(0, limitCents - cents))} — kannattaa suosia toisen laskutusta jatkossa`}
                                  </p>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {unCount > 0 && (
                        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                          <p className="text-[11px] text-amber-600 mb-1.5">
                            {unCount} laskua ({fmt(unTotal)}) ilman laskuttajaa. Merkitse kuka laskutti — siirtyy
                            heti ALV-seurantaan, Laskut-välilehdelle ja bossien velkaan.
                          </p>
                          <div className="space-y-1">
                            {unEras.map(e2 => (
                              <div key={`era-${e2.jobId}-${e2.index}`} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate text-foreground">
                                  {e2.dateMs ? new Date(e2.dateMs).toLocaleDateString("fi-FI") : "—"} · {e2.name}
                                  <span className="text-muted-foreground"> · {fmt(e2.cents)}</span>
                                </span>
                                <select
                                  value=""
                                  disabled={eraBusy}
                                  onChange={async (ev) => {
                                    if (!ev.target.value || eraBusy) return;
                                    setEraBusy(true);
                                    const r = await api.setGigPaymentBiller(e2.jobId, e2.index, ev.target.value);
                                    setEraBusy(false);
                                    if (!r.ok) alert(r.error || "Kohdistus epäonnistui — päivitä sivu ja yritä uudelleen.");
                                    loadMoney();
                                  }}
                                  className="shrink-0 rounded-md border border-amber-400 bg-background px-1.5 py-0.5 text-[11px] text-amber-600 disabled:opacity-50"
                                >
                                  <option value="">Laskutti: ?</option>
                                  {BRAND_BILLERS.map(b => <option key={b.id} value={b.id}>{firstName(b.name)}</option>)}
                                </select>
                              </div>
                            ))}
                            {unassignedJobs.map(r => (
                              <div key={r.job.id} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate text-foreground">
                                  {fmtDate(r.job.scheduledAt || r.job.createdAt)} · {r.customer?.name ?? r.job.description}
                                  <span className="text-muted-foreground"> · {fmt(effectiveJobTotal(r.job))}</span>
                                </span>
                                <select
                                  value=""
                                  onChange={(e) => e.target.value && setBilledBy(r.job.id, e.target.value)}
                                  className="shrink-0 rounded-md border border-amber-400 bg-background px-1.5 py-0.5 text-[11px] text-amber-600"
                                >
                                  <option value="">Laskutti: ?</option>
                                  {BRAND_BILLERS.map(b => <option key={b.id} value={b.id}>{firstName(b.name)}</option>)}
                                  {USERS.filter(u => u.yTunnus && !BRAND_BILLERS.some(b => b.id === u.id)).map(u => (
                                    <option key={u.id} value={u.id}>{firstName(u.name)}</option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-3 pt-2 border-t border-border">
                        Raja koskee henkilön <b>kaikkea</b> liiketoimintaa — muista myös Puuhapatetin ulkopuoliset tulot.
                      </p>
                    </Card>
                  );
                })()}

                <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                  <div className="mb-3">
                    <h2 className="text-sm font-bold">Kirjanpito — {firstName(ledgerName)}</h2>
                    <p className="text-[11px] text-muted-foreground">
                      Muodostuu automaattisesti laskuista, kuluista ja yrittäjien välisistä laskuista.
                    </p>
                  </div>
                  <SummaryTab ledgerId={ledgerId} year={year} />
                </Card>
              </TabsContent>

              <TabsContent value="laskut" className="pt-4">
                <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <div>
                      <h2 className="text-sm font-bold">Laskut {year}</h2>
                      <p className="text-[11px] text-muted-foreground">
                        Molempien bossien asiakkailta laskuttamat keikat ja urakkaerät, yhdellä listalla.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex rounded-full border overflow-hidden text-xs">
                        <button
                          onClick={() => setLaskutFilter("kaikki")}
                          className={`px-3 py-1.5 font-medium transition-colors ${laskutFilter === "kaikki" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                        >
                          Kaikki
                        </button>
                        {BRAND_BILLERS.map(b => (
                          <button
                            key={b.id}
                            onClick={() => setLaskutFilter(b.id)}
                            className={`px-3 py-1.5 font-medium transition-colors ${laskutFilter === b.id ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                          >
                            {firstName(b.name)}
                          </button>
                        ))}
                      </div>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleLaskutCsv}>
                        <Download className="w-3.5 h-3.5" /> CSV
                      </Button>
                    </div>
                  </div>

                  {laskutFiltered.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">Ei laskuja vuodelle {year}.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-border text-left">
                            <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Pvm</th>
                            <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Asiakas</th>
                            <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Laskuttaja</th>
                            <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase hidden sm:table-cell">Tyyppi</th>
                            <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase text-right">Summa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {laskutFiltered.map((r, i) => (
                            <tr key={`${r.jobId}-${i}`} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{new Date(r.dateMs).toLocaleDateString("fi-FI")}</td>
                              <td className="py-2 pr-3">
                                <p className="font-medium text-foreground">{r.name}</p>
                                {r.ref && <p className="text-xs text-muted-foreground">viite {r.ref}</p>}
                              </td>
                              <td className="py-2 pr-3 text-foreground">{firstName(r.billerName)}</td>
                              <td className="py-2 pr-3 text-muted-foreground hidden sm:table-cell">{r.source === "era" ? "urakkaerä" : "keikka"}</td>
                              <td className="py-2 text-right font-semibold">{fmt(r.amountCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border font-semibold">
                            <td colSpan={4} className="pt-3 text-foreground">Yhteensä</td>
                            <td className="pt-3 text-right">{fmt(laskutSum)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="tuloslaskelma" className="pt-4">
                <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                  <IncomeStatementTab ledgerId={ledgerId} year={year} />
                </Card>
              </TabsContent>

              <TabsContent value="tase" className="pt-4">
                <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                  <BalanceSheetTab ledgerId={ledgerId} />
                </Card>
              </TabsContent>

              <TabsContent value="paakirja" className="pt-4">
                <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                  <LedgerTab ledgerId={ledgerId} year={year} />
                </Card>
              </TabsContent>

              <TabsContent value="ennuste" className="pt-4">
                <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
                  <ForecastTab ledgerId={ledgerId} />
                </Card>
              </TabsContent>
            </Tabs>

            {/* ── Lisäasetukset: korjaustyökalut, piilossa oletuksena ───────── */}
            {((instalments && instalments.instalments.length > 0) || (settlement && (settlement.perGig.length > 0 || settlement.smallJobs.length > 0 || (settlement.settled ?? []).length > 0))) && (
              <Disclosure
                className="mt-2 print:hidden"
                icon={<SlidersHorizontal className="w-4 h-4 text-muted-foreground" />}
                title="Lisäasetukset"
                right={<span className="text-xs text-muted-foreground">korjaustyökalut</span>}
              >
                <div className="space-y-5">
                  {instalments && instalments.instalments.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2">
                        Urakkaerien hallinta <span className="text-muted-foreground font-normal">({instalments.instalments.length} erää)</span>
                      </p>
                      <GigInstalmentManager data={instalments} onChanged={loadMoney} />
                    </div>
                  )}
                  {settlement && (settlement.perGig.length > 0 || settlement.smallJobs.length > 0 || (settlement.settled ?? []).length > 0) && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2">Bossien maksuhistoria &amp; erittely</p>
                      <FounderDetails settlement={settlement} onChanged={loadMoney} />
                    </div>
                  )}
                </div>
              </Disclosure>
            )}

            {omaVeroNote(profile, totals)}
          </>
        )}

        {/* ── Print-only document ──────────────────────────────────────── */}
        {!loading && (
          <div className="hidden print:block">
            <div className="mb-6">
              <h1 className="text-xl font-bold">Puuhapatet — Kirjanpitovuosi {year}</h1>
              <p className="text-sm text-gray-600">
                Tekijä: {profile?.name ?? "—"}{profile?.yTunnus && ` · Y-tunnus: ${profile.yTunnus}`} · Tulostettu: {new Date().toLocaleDateString("fi-FI")}
              </p>
            </div>

            <div className="mb-4 p-3 border border-gray-300 rounded">
              <p className="text-xs font-bold uppercase text-gray-600">Oma tulos — {year}</p>
              <p className="text-3xl font-bold">{fmt(heroTotal)}</p>
              <p className="text-xs text-gray-600">Keikkaosuudet {fmt(totals.net)} (brutto {fmt(totals.revenue)} − palvelumaksu {fmt(totals.serviceFee)}){fr8KateYear > 0 ? ` + urakkakate ${fmt(fr8KateYear)}` : ""}</p>
            </div>

            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-400 text-left">
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase">Pvm</th>
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase">Asiakas</th>
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase">Palvelu</th>
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase text-right">Brutto</th>
                  <th className="pb-2 pr-3 text-xs font-semibold uppercase text-right">Maksu</th>
                  <th className="pb-2 text-xs font-semibold uppercase text-right">Netto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.job.id} className="border-b border-gray-200">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.job.scheduledAt || r.job.createdAt)}</td>
                    <td className="py-1.5 pr-3">{r.customer?.name ?? "—"}{r.numWorkers > 1 ? ` (1/${r.numWorkers})` : ""}</td>
                    <td className="py-1.5 pr-3 max-w-xs"><span className="line-clamp-2">{r.job.description}</span></td>
                    <td className="py-1.5 pr-3 text-right">{fmt(r.myRevenue)}</td>
                    <td className="py-1.5 pr-3 text-right">−{fmt(r.serviceFee)}</td>
                    <td className="py-1.5 text-right font-semibold">{fmt(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-semibold">
                  <td colSpan={3} className="pt-2">Yhteensä</td>
                  <td className="pt-2 text-right">{fmt(totals.revenue)}</td>
                  <td className="pt-2 text-right">−{fmt(totals.serviceFee)}</td>
                  <td className="pt-2 text-right">{fmt(totals.net)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="mt-8 text-xs text-gray-500 border-t pt-4">
              <p className="font-medium text-gray-700">{profile?.name ?? "Puuhapatet"}{profile?.yTunnus ? ` · Y-tunnus ${profile.yTunnus}` : ""}</p>
              <p className="mt-1">
                Oma tulos {year}: {fmt(heroTotal)}{profile?.hasYTunnus ? " — ilmoita lomakkeella 5 (OmaVero)." : ' — ilmoita kohdassa "Muut ansiotulot" (OmaVero).'} Palvelumaksu {fmt(totals.serviceFee)} vähennetty{fr8KateYear > 0 ? `, urakkakate ${fmt(fr8KateYear)} mukana` : ""}.
              </p>
              <p className="mt-1">Puuhapatet · info@puuhapatet.fi · puuhapatet.fi</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact OmaVero pointer — replaces the old wall-of-text "OmaVero-ohjeet"
 *  disclosure. The exact filing figure lives once in "Oma tulos" above; this
 *  is just where-to-put-it plus a pointer to the AI assistant for anything
 *  more specific (matkakulut, alle 18v, ALV — see Vaihe D). */
function omaVeroNote(
  profile: ReturnType<typeof getAdminProfile>,
  totals: { net: number },
) {
  return (
    <Disclosure
      className="mt-2 print:hidden"
      icon={<Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
      title="OmaVero — mihin ilmoitan?"
    >
      <p className="text-xs text-foreground">
        {profile?.hasYTunnus ? (
          <>Ilmoita <strong>{fmt(totals.net)}</strong> OmaVerossa kohdassa <strong>Elinkeinotoiminnan veroilmoitus (lomake 5)</strong>. Määräpäivä vaihtelee vuosittain — tarkista tarkka päivä OmaVerosta.</>
        ) : (
          <>Ilmoita <strong>{fmt(totals.net)}</strong> OmaVerossa kohdassa <strong>Muut ansiotulot</strong>.</>
        )}
      </p>
      {profile?.isUnder18 && (
        <p className="text-xs text-muted-foreground mt-1.5">
          Alle 18-vuotiaana huoltajasi asioi puolestasi OmaVerossa (Valtuudet-palvelu).
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1.5">
        Kirjanpito kuitteineen säilytetään 6 vuotta — kuitteja ei liitetä ilmoitukseen. Tarkempia
        kysymyksiä (esim. matkakulut, ALV) voit kysyä suoraan tekoälyavustajalta (oikea alakulma).
      </p>
    </Disclosure>
  );
}

/** Enterprise instalment manager: every recorded gig instalment (urakkaerä)
 *  in one editable list. A host can re-attribute the biller, fix the amount or
 *  date, or delete a bogus erä — all recompute the tracker + tax figures. */
function GigInstalmentManager({
  data, onChanged,
}: {
  data: NonNullable<Awaited<ReturnType<typeof api.getGigInstalments>>["data"]>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { alert(r.error || "Toiminto epäonnistui — yritä uudelleen."); return; }
    setEditKey(null);
    onChanged();
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Kaikki kirjatut urakan laskutuserät. Vaihda laskuttaja, korjaa summa tai päivämäärä,
        tai poista virheellinen erä. Muutos päivittää heti ALV-seurannan, laskuluettelon ja bossien velan.
      </p>
      {data.instalments.map((it) => {
        const key = `${it.jobId}-${it.index}`;
        const editing = editKey === key;
        return (
          <div key={key} className="rounded-xl border bg-muted/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {it.gigName} — erä {it.index + 1}
                  {it.jobDescription && it.jobDescription !== it.gigName && (
                    <span className="font-normal text-muted-foreground"> ({it.jobDescription})</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {it.dateMs ? new Date(it.dateMs).toLocaleDateString("fi-FI") : "ei pvm"}
                  {" · "}
                  {it.biller ? `laskutti ${firstName(it.biller.name)}` : <span className="text-amber-600">ei laskuttajaa</span>}
                </p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums">{fmt(it.amountCents)}</span>
            </div>

            {/* What the amount consists of (fixed-deal gigs only). The kate is
                derived from the deal's per-erä basis + washed windows, so the
                breakdown reconciles on its own regardless of the recorded amount. */}
            {it.kateCents != null && (
              <div className="mt-1.5 rounded-lg bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground tabular-nums space-y-0.5">
                <div className="flex justify-between gap-2"><span>Erän laskutusperuste</span><span>{fmt(it.instalmentBasisCents ?? it.amountCents)}</span></div>
                <div className="flex justify-between gap-2"><span>− työntekijöiden palkat</span><span>−{fmt(it.palkatCents ?? 0)}</span></div>
                <div className="flex justify-between gap-2 font-semibold text-foreground"><span>= kate (bossien kesken)</span><span>{fmt(it.kateCents)}</span></div>
                {it.shares?.map((s) => (
                  <div key={s.id} className="flex justify-between gap-2"><span>→ {firstName(s.name)}n osuus</span><span>{fmt(s.cents)}</span></div>
                ))}
                {it.instalmentBasisCents != null && it.instalmentBasisCents !== it.amountCents && (
                  <div className="flex justify-between gap-2 pt-0.5 text-amber-600"><span>Kirjattu summa poikkeaa perusteesta</span><span>{fmt(it.amountCents)}</span></div>
                )}
              </div>
            )}

            {!editing ? (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <select
                  value={it.biller?.id ?? ""}
                  disabled={busy}
                  onChange={(e) => run(() => api.editGigPayment(it.jobId, it.index, { billerId: e.target.value || null }))}
                  className="h-7 rounded-md border bg-background px-1.5 text-[11px] text-foreground disabled:opacity-50"
                >
                  <option value="">Laskutti: ? (ei kenenkään)</option>
                  {data.billers.map((b) => <option key={b.id} value={b.id}>Laskutti: {firstName(b.name)}</option>)}
                </select>
                <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setEditKey(key)}>
                  {it.isFixedDeal ? "Muokkaa pvm" : "Muokkaa summaa/pvm"}
                </button>
                <button
                  type="button"
                  className="ml-auto text-[11px] text-red-500 hover:text-red-600"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Poistetaanko erä "${it.gigName} — erä ${it.index + 1}" (${fmt(it.amountCents)})?\n\nTämä poistaa erän seurannasta ja päivittää kaikki luvut. Ei voi peruuttaa.`)) return;
                    run(() => api.deleteGigPayment(it.jobId, it.index));
                  }}
                >
                  Poista
                </button>
              </div>
            ) : (
              <EraEditForm it={it} busy={busy} onCancel={() => setEditKey(null)} onSave={(patch) => run(() => api.editGigPayment(it.jobId, it.index, patch))} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Inline editor for one instalment. Amount is editable only for non-fixed
 *  gigs (a fixed deal's per-erä amount is contract-derived); date always. */
function EraEditForm({
  it, busy, onCancel, onSave,
}: {
  it: { amountCents: number; dateMs: number | null; isFixedDeal: boolean };
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { amountCents?: number; dateMs: number }) => void;
}) {
  const [amount, setAmount] = useState((it.amountCents / 100).toFixed(2).replace(".", ","));
  // Local-date yyyy-mm-dd (not toISOString, which is UTC and can shift the day).
  const [date, setDate] = useState(() => {
    const d = new Date(it.dateMs ?? Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {it.isFixedDeal ? (
        <p className="text-[10px] text-muted-foreground w-full">
          Summa määräytyy sopimuksesta — muuta sopimushintaa keikan Laskutus-kortista. Tästä voit korjata päivämäärän.
        </p>
      ) : (
        <label className="text-[11px] text-muted-foreground">Summa €
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-0.5 h-8 w-24 text-xs tabular-nums" />
        </label>
      )}
      <label className="text-[11px] text-muted-foreground">Päivämäärä
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 h-8 w-36 text-xs" />
      </label>
      <Button
        size="sm" className="h-8 text-xs self-end" disabled={busy}
        onClick={() => {
          const dateMs = new Date(date + "T12:00:00").getTime();
          if (it.isFixedDeal) { onSave({ dateMs }); return; }
          const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
          if (!Number.isFinite(cents) || cents < 0) { alert("Virheellinen summa."); return; }
          onSave({ amountCents: cents, dateMs });
        }}
      >Tallenna</Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs self-end" onClick={onCancel}>Peruuta</Button>
    </div>
  );
}

/** Status card: the ONE number between the founders + the two actions
 *  (kirjaa maksu / vastalasku). Every detail lives in Lisäasetukset's
 *  "Bossien maksuhistoria & erittely" instead. */
function FounderDebtCard({ settlement, onChanged }: { settlement: FounderCrossSettlement; onChanged: () => void }) {
  const { crossInvoices, settled, founders, smallJobs } = settlement;
  const [invoiceFor, setInvoiceFor] = useState<FounderCrossSettlement["crossInvoices"][number] | null>(null);

  // One-time helper: the founders have ALREADY paid each other the small-gig
  // shares via MobilePay (everything except FR8). One tap books that history,
  // so the open balance shows only what is genuinely unpaid (the FR8 shares).
  const MARKER = "MobilePay — pikkukeikat kuitattu";
  const alreadyMarked = (settled ?? []).some(x => (x.invoiceNo ?? "").startsWith(MARKER));
  const [a, b] = founders;
  let smallNet = 0; // + => a owes b
  if (a && b) {
    for (const j of smallJobs) {
      if (j.billerId === a.id) smallNet += j.owes.find(o => o.id === b.id)?.cents ?? 0;
      else if (j.billerId === b.id) smallNet -= j.owes.find(o => o.id === a.id)?.cents ?? 0;
    }
  }
  const smallFrom = smallNet > 0 ? a : b;
  const smallTo = smallNet > 0 ? b : a;
  const smallAbs = Math.abs(smallNet);

  return (
    <Card className="p-5 bg-card border-0 premium-shadow print:hidden">
      <div className="flex items-center gap-2 mb-1.5">
        <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-sm font-bold">Bossien velka</h2>
      </div>
      {crossInvoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tasan ✓ — kenenkään ei tarvitse maksaa toiselle.
          {(settled ?? []).length > 0 ? " Kirjatut maksut on huomioitu." : ""}
        </p>
      ) : (
        crossInvoices.map((c, i) => (
          <div key={i} className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-3xl font-bold tabular-nums text-emerald-600">{fmt(c.cents)}</p>
              <p className="text-[11px] text-muted-foreground">
                {firstName(c.fromName)} maksaa {firstName(c.toName)}lle — esim. MobilePay, kuittaa maksu tästä
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <RecordPaymentInline inv={c} onChanged={onChanged} />
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setInvoiceFor(c)}>
                <FileText className="h-3.5 w-3.5" /> Vastalasku
              </Button>
            </div>
          </div>
        ))
      )}
      {(settlement.unassignedEraCount ?? 0) > 0 && (
        <p className="mt-2 text-[11px] text-amber-600">
          ⚠ {settlement.unassignedEraCount} urakkaerää ilman laskuttajaa — velka ei ole täydellinen
          ennen kuin kohdistat ne ALV-kortin listasta.
        </p>
      )}
      {!alreadyMarked && smallAbs > 0 && a && b && (
        <button
          type="button"
          className="mt-2 block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={async () => {
            // Retroactive full settlement for the already-MobilePaid small
            // gigs: an itemized settlement invoice (stamped PAID) + the
            // ledger booking + tositteet for both — the missing paperwork
            // for the old gigs in one tap. Spell out exactly which gigs the
            // sum consists of; the founders must see what they mark paid.
            const parts: string[] = [];
            const items: InvoiceItem[] = [];
            for (const j of smallJobs) {
              const d = new Date(j.dateMs).toLocaleDateString("fi-FI");
              if (j.billerId === smallFrom.id) {
                const o = j.owes.find(x => x.id === smallTo.id);
                if (o?.cents) {
                  parts.push(`• ${j.name} ${d}: ${firstName(smallFrom.name)} → ${firstName(smallTo.name)}lle ${fmt(o.cents)}`);
                  items.push({ label: `${j.name} ${d} — osuus 1/${j.numWorkers}`, cents: o.cents });
                }
              } else if (j.billerId === smallTo.id) {
                const o = j.owes.find(x => x.id === smallFrom.id);
                if (o?.cents) {
                  parts.push(`• ${j.name} ${d}: ${firstName(smallTo.name)} → ${firstName(smallFrom.name)}lle ${fmt(o.cents)}`);
                  items.push({ label: `Hyvitys: ${j.name} ${d} — osuus 1/${j.numWorkers}`, cents: -o.cents });
                }
              }
            }
            const shown = parts.slice(0, 12);
            if (parts.length > shown.length) shown.push(`…ja ${parts.length - shown.length} muuta`);
            const priorBookings = (settled ?? []).length > 0
              ? `\nHuom: Maksuhistoriassa on jo kirjauksia — tarkista ettei samoja euroja kuitata kahdesti (kirjauksen voi perua ✕:llä).\n`
              : "";
            if (!confirm(
              `Kuitataanko pikkukeikkojen osuudet maksetuiksi?\n\n` +
              `Summa koostuu näistä keikoista (suunnat vastakkain, netto ${fmt(smallAbs)}):\n` +
              `${shown.join("\n")}\n${priorBookings}\n` +
              `Tehdään kerralla: avataan tulostettava erittelylasku (merkitty MAKSETUKSI, MobilePay), ` +
              `kirjataan maksu ${firstName(smallFrom.name)} → ${firstName(smallTo.name)} ${fmt(smallAbs)} ja ` +
              `arkistoidaan lasku + kuitit molempien Dokumentteihin. Urakkaerien (esim. FR8) osuudet jäävät avoimeksi.`
            )) return;
            const today = new Date();
            const invoiceNo = `MP-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
            const creditor = BRAND_BILLERS.find(x => x.id === smallTo.id);
            const debtor = BRAND_BILLERS.find(x => x.id === smallFrom.id);
            if (creditor && debtor) {
              openSettlementInvoicePrint({
                invoiceNo, dateStr: today.toLocaleDateString("fi-FI"), dueDateStr: "",
                creditor, debtor, items, totalCents: smallAbs,
                iban: creditor.iban ?? "", bic: creditor.bic ?? "",
                paidNote: `MAKSETTU — MobilePay (kuitattu ${today.toLocaleDateString("fi-FI")})`,
              });
            }
            // Vastalasku into both founders' Dokumentit + the payment booking
            // (which files the payment kuitit for both). Ledger row carries the
            // MARKER so this one-tap can never run twice.
            await api.issueFounderInvoice({
              fromId: smallFrom.id, toId: smallTo.id, cents: smallAbs, invoiceNo, items,
              iban: creditor?.iban ?? undefined, bic: creditor?.bic ?? undefined,
              paidNote: `MAKSETTU — MobilePay (kuitattu ${today.toLocaleDateString("fi-FI")})`,
            });
            const res = await api.recordFounderSettlement({ fromId: smallFrom.id, toId: smallTo.id, cents: smallAbs, invoiceNo: MARKER });
            if (res.ok) onChanged();
            else alert(res.error || "Kirjaus epäonnistui — yritä uudelleen.");
          }}
        >
          ✓ Kuittaa pikkukeikat jo maksetuiksi (MobilePay) + luo tosite — {fmt(smallAbs)}
        </button>
      )}
      {invoiceFor && (
        <SettlementInvoiceDialog
          inv={invoiceFor}
          settlement={settlement}
          onClose={() => setInvoiceFor(null)}
        />
      )}
    </Card>
  );
}

/** Reference material in Lisäasetukset: how the open balance is formed, the
 *  payment history (MobilePay + vastalaskut), manual booking for old
 *  payments, and the per-gig breakdown. */
function FounderDetails({ settlement, onChanged }: { settlement: FounderCrossSettlement; onChanged: () => void }) {
  const { founders, crossInvoices, perGig, smallJobs, settled } = settlement;

  return (
    <div className="space-y-4">
      {/* How each open balance is formed — keikoista kertynyt − maksettu. */}
      {crossInvoices.map((c, i) => {
        const grossFromTo = pairGrossOwed(settlement, c.fromId, c.toId);
        const grossToFrom = pairGrossOwed(settlement, c.toId, c.fromId);
        const paidFromTo = (settled ?? []).filter(x => x.fromId === c.fromId && x.toId === c.toId).reduce((s2, x) => s2 + x.cents, 0);
        const paidToFrom = (settled ?? []).filter(x => x.fromId === c.toId && x.toId === c.fromId).reduce((s2, x) => s2 + x.cents, 0);
        return (
          <div key={i} className="rounded-xl border bg-muted/20 px-3 py-2.5 space-y-0.5 text-[11px] tabular-nums">
            <p className="text-xs font-semibold text-foreground mb-1">Näin avoin velka muodostuu</p>
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
              <span>Keikoista kertynyt ({firstName(c.fromName)} keräsi {firstName(c.toName)}n osuuksia)</span>
              <span>{fmt(grossFromTo - grossToFrom)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
              <span>Jo maksettu / kuitattu</span>
              <span>−{fmt(paidFromTo - paidToFrom)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 font-semibold text-foreground">
              <span>Avoinna</span>
              <span className="text-emerald-600">{fmt(c.cents)}</span>
            </div>
          </div>
        );
      })}

      {/* Manual booking — for MobilePay payments made before this ledger existed. */}
      <ManualRecordForm founders={founders} onChanged={onChanged} />
      <p className="text-[11px] text-muted-foreground">
        Vastalasku = virallinen lasku kirjanpitoon — arkistoituu molempien Dokumentteihin,
        mutta velka pysyy avoimena kunnes maksu kirjataan. Arjessa pelkkä maksukirjaus
        (MobilePay) riittää; vain kirjattu maksu pienentää avointa velkaa.
      </p>

      {/* Payment history — MobilePay payments + issued vastalaskut. */}
      {(settled ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-1.5">Maksuhistoria</h3>
          <div className="space-y-1.5">
            {settled.map(x => (
              <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[11px]">
                <span className="min-w-0 truncate text-muted-foreground">
                  {new Date(x.createdAtMs).toLocaleDateString("fi-FI")} · {firstName(founders.find(f => f.id === x.fromId)?.name ?? x.fromId)} maksoi {firstName(founders.find(f => f.id === x.toId)?.name ?? x.toId)}lle
                  {x.invoiceNo ? ` · ${x.invoiceNo}` : ""}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold tabular-nums">{fmt(x.cents)}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-red-500"
                    title="Peru kirjaus (summa palaa avoimeen velkaan)"
                    onClick={async () => {
                      if (!confirm("Perutaanko tämä kirjaus? Summa palaa avoimeen velkaan.")) return;
                      await api.deleteFounderSettlement(x.id);
                      onChanged();
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-gig breakdown. */}
      {(perGig.length > 0 || smallJobs.length > 0) && (
        <Disclosure variant="inline" title={`Erittely keikoittain (${perGig.length + smallJobs.length})`}>
          <div className="space-y-3">
            {perGig.map(g => (
              <div key={g.jobId} className="rounded-xl border bg-muted/20 p-3">
                <p className="text-xs font-semibold mb-1.5 truncate">{g.gigName}</p>
                <div className="space-y-1.5">
                  {g.eras.map(e => (
                    <div key={e.era} className="text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Erä {e.era}{e.dateMs ? ` · ${new Date(e.dateMs).toLocaleDateString("fi-FI")}` : ""} · {firstName(e.billerName)} laskutti</span>
                        <span className="tabular-nums text-muted-foreground">{fmt(e.instalmentCents)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 tabular-nums">
                        <span className="text-muted-foreground">lasku − palkat {fmt(e.palkatCents)}</span>
                        <span className="font-semibold text-emerald-600">kate {fmt(e.kateCents)}</span>
                      </div>
                      {e.paysOut.map((pp, j) => (
                        <div key={j} className="flex items-center justify-between gap-2 text-muted-foreground">
                          <span>→ {firstName(pp.name)}lle</span>
                          <span className="tabular-nums">{fmt(pp.cents)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {smallJobs.map(j => (
              <div key={j.jobId} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold truncate">{j.name}</p>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{new Date(j.dateMs).toLocaleDateString("fi-FI")}</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{firstName(j.billerName)} laskutti asiakasta</span>
                    <span className="tabular-nums text-muted-foreground">{fmt(j.totalCents)}</span>
                  </div>
                  {j.expensesCents > 0 && (
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span>Kulut (laskuttaja pitää — maksoi tarvikkeet)</span>
                      <span className="tabular-nums">−{fmt(j.expensesCents)}</span>
                    </div>
                  )}
                  {j.owes.map((o, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span>→ {firstName(o.name)}lle (osuus 1/{j.numWorkers})</span>
                      <span className="tabular-nums">{fmt(o.cents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

// ─── Vastalasku (founder-to-founder settlement invoice) ─────────────────────────

interface InvoiceItem { label: string; cents: number }

/** Itemize everything between one founder pair: rows where the payer (from)
 *  billed and owes the creditor (to), credit rows for the opposite direction,
 *  and credits for already-recorded settlements. Mirrors the server's netting
 *  exactly (entries ≤ 0 are skipped on both sides), so the sum equals the
 *  netted crossInvoice amount. */
function pairItems(s: FounderCrossSettlement, fromId: string, toId: string): InvoiceItem[] {
  const items: InvoiceItem[] = [];
  for (const g of s.perGig) {
    for (const e of g.eras) {
      if (e.billerId === fromId) {
        const p = e.paysOut.find(x => x.id === toId);
        if (p && p.cents > 0) items.push({ label: `${g.gigName} — erä ${e.era}, kate-osuus`, cents: p.cents });
      } else if (e.billerId === toId) {
        const p = e.paysOut.find(x => x.id === fromId);
        if (p && p.cents > 0) items.push({ label: `Hyvitys: ${g.gigName} — erä ${e.era}, kate-osuus`, cents: -p.cents });
      }
    }
  }
  for (const j of s.smallJobs) {
    const date = new Date(j.dateMs).toLocaleDateString("fi-FI");
    if (j.billerId === fromId) {
      const o = j.owes.find(x => x.id === toId);
      if (o && o.cents > 0) items.push({ label: `${j.name} ${date} — osuus 1/${j.numWorkers}`, cents: o.cents });
    } else if (j.billerId === toId) {
      const o = j.owes.find(x => x.id === fromId);
      if (o && o.cents > 0) items.push({ label: `Hyvitys: ${j.name} ${date} — osuus 1/${j.numWorkers}`, cents: -o.cents });
    }
  }
  for (const st of s.settled ?? []) {
    const date = new Date(st.createdAtMs).toLocaleDateString("fi-FI");
    if (st.fromId === fromId && st.toId === toId) {
      items.push({ label: `Hyvitys: tilitetty aiemmin ${date}${st.invoiceNo ? ` (lasku ${st.invoiceNo})` : ""}`, cents: -st.cents });
    } else if (st.fromId === toId && st.toId === fromId) {
      items.push({ label: `Aiempi vastakkainen tilitys ${date}${st.invoiceNo ? ` (lasku ${st.invoiceNo})` : ""}`, cents: st.cents });
    }
  }
  return items;
}

/** Total a founder has collected of ANOTHER founder's shares across all gigs
 *  (gross, before settlements) — the "keikoista kertynyt" figure. */
function pairGrossOwed(s: FounderCrossSettlement, fromId: string, toId: string): number {
  let sum = 0;
  for (const g of s.perGig) {
    for (const e of g.eras) {
      if (e.billerId !== fromId) continue;
      const p = e.paysOut.find(x => x.id === toId);
      if (p && p.cents > 0) sum += p.cents;
    }
  }
  for (const j of s.smallJobs) {
    if (j.billerId !== fromId) continue;
    const o = j.owes.find(x => x.id === toId);
    if (o && o.cents > 0) sum += o.cents;
  }
  return sum;
}

/** One-tap payment booking on an open debt: "maksettu MobilePaylla X €".
 *  No invoice ceremony — just reduces the open balance via the ledger. */
function RecordPaymentInline({
  inv, onChanged,
}: {
  inv: FounderCrossSettlement["crossInvoices"][number];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => (inv.cents / 100).toFixed(2).replace(".", ","));
  const [note, setNote] = useState("MobilePay");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    setBusy(true);
    const res = await api.recordFounderSettlement({
      fromId: inv.fromId, toId: inv.toId, cents, invoiceNo: note.trim() || "MobilePay",
    });
    setBusy(false);
    if (res.ok) { setOpen(false); onChanged(); }
  };

  if (!open) {
    return (
      <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setAmount((inv.cents / 100).toFixed(2).replace(".", ",")); setOpen(true); }}>
        <Wallet className="h-3.5 w-3.5" /> Kirjaa maksu
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="h-7 w-20 text-xs tabular-nums" aria-label="Summa (€)" />
      <Input value={note} onChange={e => setNote(e.target.value)} className="h-7 w-24 text-xs" placeholder="MobilePay" aria-label="Tapa/viesti" />
      <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={save}>{busy ? "…" : "OK"}</Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>×</Button>
    </div>
  );
}

/** Manual booking with a direction picker — for MobilePay payments made before
 *  this ledger existed (or when the balance already shows even). */
function ManualRecordForm({
  founders, onChanged,
}: {
  founders: FounderCrossSettlement["founders"];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(founders[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("MobilePay");
  const [busy, setBusy] = useState(false);
  const toId = founders.find(f => f.id !== fromId)?.id ?? "";

  if (founders.length < 2) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-[11px] text-muted-foreground underline underline-offset-2">
        + Kirjaa vanha maksu käsin (esim. aiemmat MobilePay-tasaukset)
      </button>
    );
  }

  const save = async () => {
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || !toId) return;
    setBusy(true);
    const res = await api.recordFounderSettlement({ fromId, toId, cents, invoiceNo: note.trim() || "MobilePay" });
    setBusy(false);
    if (res.ok) { setOpen(false); setAmount(""); onChanged(); }
  };

  return (
    <div className="mt-2 rounded-xl border bg-muted/20 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-foreground">Kirjaa maksu käsin</p>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <select value={fromId} onChange={e => setFromId(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground">
          {founders.map(f => <option key={f.id} value={f.id}>{firstName(f.name)} maksoi</option>)}
        </select>
        <span className="text-muted-foreground">→ {firstName(founders.find(f => f.id === toId)?.name ?? "")}lle</span>
        <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Summa €" className="h-8 w-24 text-xs tabular-nums" />
        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="MobilePay" className="h-8 w-28 text-xs" />
        <Button size="sm" className="h-8 text-xs" disabled={busy || !amount.trim()} onClick={save}>{busy ? "…" : "Kirjaa"}</Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>Peruuta</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Kirjaus pienentää maksajan avointa velkaa. Jos maksoitte jo kaiken puoliksi, kirjaa summat
        niin avoin velka menee nollaan.
      </p>
    </div>
  );
}

/** Dialog that builds the legally-marked settlement invoice (creditor →
 *  debtor), opens it as a printable page, and files it into BOTH founders'
 *  Dokumentit (myyntilasku/ostolasku, 6-year retention). Issuing does NOT
 *  clear the debt — that happens when the payment is recorded. */
function SettlementInvoiceDialog({
  inv, settlement, onClose,
}: {
  inv: FounderCrossSettlement["crossInvoices"][number];
  settlement: FounderCrossSettlement;
  onClose: () => void;
}) {
  // Creditor (laskuttaja) = the founder who is OWED money; debtor pays.
  const creditor = BRAND_BILLERS.find(b => b.id === inv.toId);
  const debtor = BRAND_BILLERS.find(b => b.id === inv.fromId);
  const today = new Date();
  const defaultDue = new Date(today.getTime() + 14 * 86400_000);
  const [invoiceNo, setInvoiceNo] = useState(() =>
    `T${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}-${inv.toId.slice(0, 2).toUpperCase()}`);
  const [iban, setIban] = useState(creditor?.iban ?? "");
  const [bic, setBic] = useState(creditor?.bic ?? "");
  const [dueDate, setDueDate] = useState(defaultDue.toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [recordedOnce, setRecordedOnce] = useState(false);

  const items = pairItems(settlement, inv.fromId, inv.toId);
  const itemSum = items.reduce((s, i) => s + i.cents, 0);

  const generate = async () => {
    if (!creditor || !debtor) return;
    setBusy(true); setMsg(null);
    const opened = openSettlementInvoicePrint({
      invoiceNo, dateStr: today.toLocaleDateString("fi-FI"),
      dueDateStr: dueDate ? new Date(dueDate + "T12:00:00").toLocaleDateString("fi-FI") : "",
      creditor, debtor, items, totalCents: inv.cents, iban, bic,
    });
    if (!opened) { setBusy(false); setMsg("Selain esti ponnahdusikkunan — salli ponnahdusikkunat ja yritä uudelleen."); return; }
    // Issuing an invoice is NOT getting paid: the server files the invoice
    // (myyntilasku + ostolasku) into BOTH founders' Dokumentit, but the open
    // debt stays open until the payment itself is recorded ("Kirjaa maksu").
    // File once per dialog; the server also dedupes on re-issue.
    if (!recordedOnce) {
      const rec = await api.issueFounderInvoice({
        fromId: inv.fromId, toId: inv.toId, cents: inv.cents, invoiceNo, items,
        dueDateStr: dueDate ? new Date(dueDate + "T12:00:00").toLocaleDateString("fi-FI") : undefined,
        iban: iban || undefined, bic: bic || undefined,
      });
      // Marked issued only on SUCCESS — a failed filing must stay retryable.
      if (rec.ok) setRecordedOnce(true);
      setBusy(false);
      setMsg(rec.ok
        ? `Lasku avattu ✓ Arkistoitu molempien Dokumentteihin. Velka pysyy avoimena — kun ${firstName(inv.fromName)} maksaa, paina "Kirjaa maksu" ja laita viestiksi ${invoiceNo}.`
        : "Lasku avattu — arkistointi epäonnistui, yritä uudelleen.");
    } else {
      setBusy(false);
      setMsg("Lasku avattu uudelleen (oli jo arkistoitu).");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> Vastalasku</DialogTitle>
          <DialogDescription>
            {firstName(inv.toName)} laskuttaa {firstName(inv.fromName)}lta {fmt(inv.cents)} — osuus yhteisistä keikoista.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="flex gap-2">
            <label className="flex-1 text-[11px] text-muted-foreground">
              Laskun numero
              <Input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} className="mt-1 h-9" />
            </label>
            <label className="w-36 text-[11px] text-muted-foreground">
              Eräpäivä
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 h-9" />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex-1 text-[11px] text-muted-foreground">
              Tilinumero (IBAN) — {firstName(inv.toName)}n tili, jolle maksetaan
              <Input value={iban} onChange={e => setIban(e.target.value)} className="mt-1 h-9 font-mono" placeholder="FI00 0000 0000 0000 00" />
            </label>
            <label className="w-28 text-[11px] text-muted-foreground">
              BIC
              <Input value={bic} onChange={e => setBic(e.target.value)} className="mt-1 h-9 font-mono" placeholder="XXXXFIHH" />
            </label>
          </div>

          {/* Itemization preview */}
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Erittely ({items.length} riviä)</p>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {items.map((it, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className={`truncate ${it.cents < 0 ? "text-muted-foreground italic" : ""}`}>{it.label}</span>
                  <span className="shrink-0 tabular-nums">{fmt(it.cents)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border text-sm font-bold">
              <span>Yhteensä</span>
              <span className="tabular-nums text-emerald-600">{fmt(inv.cents)}</span>
            </div>
            {itemSum !== inv.cents && (
              <p className="text-[10px] text-amber-600 mt-1">Huom: erittelyn summa {fmt(itemSum)} poikkeaa netosta (pyöristys).</p>
            )}
          </div>

          {msg && <p className="text-[11px] text-muted-foreground">{msg}</p>}

          <div className="flex gap-2">
            <Button onClick={generate} disabled={busy || !invoiceNo.trim()} className="flex-1 gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Printer className="h-4 w-4" /> Avaa tulostettava lasku</>}
            </Button>
            <Button variant="outline" onClick={onClose}>Sulje</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Laskussa on lakisääteiset merkinnät (laskun numero, päivämäärä, molempien Y-tunnukset,
            ALV-merkintä "ei arvonlisäveroa — vähäinen toiminta"). Kopio arkistoituu automaattisesti
            molempien Dokumentteihin (säilytys 6 v). Kun maksu saapuu, kuittaa se "Kirjaa maksu" -napilla.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Open the settlement invoice as a clean printable page (no new libraries —
 *  same pattern as the worker-contract print view). Returns false if the
 *  browser blocked the popup. */
function openSettlementInvoicePrint(p: {
  invoiceNo: string; dateStr: string; dueDateStr: string;
  creditor: { name: string; address?: string; yTunnus?: string };
  debtor: { name: string; address?: string; yTunnus?: string };
  items: InvoiceItem[]; totalCents: number; iban: string; bic: string;
  /** When set, the invoice renders a PAID stamp (retroactive settlement doc
   *  for money that already moved, e.g. MobilePay) instead of a due date. */
  paidNote?: string;
}): boolean {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = p.items.map(it => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:${it.cents < 0 ? "#6b7280" : "#111"};font-style:${it.cents < 0 ? "italic" : "normal"}">${esc(it.label)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${fmt(it.cents)}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html>
<html lang="fi"><head><meta charset="utf-8"><title>Lasku ${esc(p.invoiceNo)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color:#111; max-width: 640px; margin: 40px auto; padding: 0 24px; font-size: 14px; }
  @media print { body { margin: 0 auto; } .noprint { display:none } }
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #14532d;padding-bottom:16px;margin-bottom:20px">
    <div>
      <h1 style="margin:0;font-size:26px;letter-spacing:1px">LASKU</h1>
      <p style="margin:4px 0 0;color:#6b7280;font-size:12px">Nro ${esc(p.invoiceNo)} · ${p.dateStr}</p>
    </div>
    <div style="text-align:right;color:#14532d;font-weight:700">Puuhapatet<br><span style="color:#6b7280;font-weight:400;font-size:11px">sisäinen tilitys — bossien keskinäinen laskutus</span></div>
  </div>

  <table style="width:100%;margin-bottom:20px;font-size:13px">
    <tr>
      <td style="vertical-align:top;width:50%;padding-right:16px">
        <p style="margin:0 0 4px;font-size:10px;letter-spacing:1px;color:#9ca3af;text-transform:uppercase">Laskuttaja (myyjä)</p>
        <strong>${esc(p.creditor.name)}</strong><br>
        ${p.creditor.address ? esc(p.creditor.address) + "<br>" : ""}
        ${p.creditor.yTunnus ? "Y-tunnus: " + esc(p.creditor.yTunnus) : ""}
      </td>
      <td style="vertical-align:top;width:50%">
        <p style="margin:0 0 4px;font-size:10px;letter-spacing:1px;color:#9ca3af;text-transform:uppercase">Laskutetaan (ostaja)</p>
        <strong>${esc(p.debtor.name)}</strong><br>
        ${p.debtor.address ? esc(p.debtor.address) + "<br>" : ""}
        ${p.debtor.yTunnus ? "Y-tunnus: " + esc(p.debtor.yTunnus) : ""}
      </td>
    </tr>
  </table>

  <p style="font-size:13px;color:#374151;margin:0 0 12px">
    Tilitys yhteisistä keikoista: ostaja on laskuttanut asiakkaita koko summalla ja tilittää
    tällä laskulla myyjälle hänen osuutensa (keikat vedetty puoliksi).
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr>
      <th style="text-align:left;padding:6px 0;border-bottom:2px solid #111;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280">Erittely</th>
      <th style="text-align:right;padding:6px 0;border-bottom:2px solid #111;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#6b7280">Summa</th>
    </tr>
    ${rows}
    <tr>
      <td style="padding:12px 0;font-weight:800;font-size:15px">Yhteensä (maksettava)</td>
      <td style="padding:12px 0;text-align:right;font-weight:800;font-size:18px;white-space:nowrap">${fmt(p.totalCents)}</td>
    </tr>
  </table>

  <p style="font-size:11px;color:#6b7280;margin:6px 0 20px">
    Ei arvonlisäveroa — myyjä ei ole arvonlisäverovelvollinen (vähäinen toiminta, AVL 3 §).
  </p>

  ${p.paidNote ? `
  <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;padding:12px 16px;font-size:14px;font-weight:800;color:#166534;text-align:center;letter-spacing:1px">
    ✓ ${esc(p.paidNote)}
  </div>` : `
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;font-size:13px">
    <p style="margin:0 0 4px;font-size:10px;letter-spacing:1px;color:#9ca3af;text-transform:uppercase">Maksutiedot</p>
    ${p.iban ? `Tilinumero (IBAN): <strong style="font-family:monospace">${esc(p.iban)}</strong><br>` : ""}
    ${p.bic ? `BIC: <strong style="font-family:monospace">${esc(p.bic)}</strong><br>` : ""}
    Viite / viesti: ${esc(p.invoiceNo)}<br>
    ${p.dueDateStr ? `Eräpäivä: <strong>${p.dueDateStr}</strong>` : ""}
  </div>`}

  <p style="font-size:10px;color:#9ca3af;margin-top:24px">
    Molemmat osapuolet säilyttävät laskun kirjanpidossaan 6 vuotta. Puuhapatet on brändi —
    myyjä ja ostaja toimivat omilla Y-tunnuksillaan.
  </p>

  <button class="noprint" onclick="window.print()" style="margin-top:16px;padding:10px 20px;border-radius:8px;border:0;background:#14532d;color:#fff;font-weight:700;cursor:pointer">Tulosta / tallenna PDF</button>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  return true;
}
