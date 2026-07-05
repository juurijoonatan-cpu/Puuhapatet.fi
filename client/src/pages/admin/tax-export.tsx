/**
 * Verotus & tiimi — yhdistetty talousnäkymä
 *
 * Yksi selkeä sivu, jossa kaikki on piilotettu sujuviin dropdowneihin:
 *  · OmaVeroon ilmoitettava tulos (aina näkyvissä)
 *  · Bossien rahat — avoin velka, MobilePay-maksukirjaukset, vastalaskut (auki oletuksena)
 *  · Omat asiakaslaskut (lähetetyt laskut per vuosi — pikkukeikat + urakkaerät)
 *  · Verotuloste — omat keikat (CSV / tulosta)
 *  · ALV-seuranta (vähäinen toiminta, per johtaja)
 *  · Tiimi & työntekijät (linkit jokaisen tekijän omaan näkymään)
 *  · Aloitustuki / yritysseteli
 *  · OmaVero-ohjeet
 *
 * Tulostettaessa näytetään pelkkä puhdas dokumentti (avainluku + taulukko);
 * dropdownit ovat vain ruudulla.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Printer, FileSpreadsheet, Percent, Users, Sparkles, Info, ArrowRight, Wallet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { api, type FounderCrossSettlement, type WorkerStatsResponse } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { BRAND_BILLERS } from "@shared/billers";
import { feeRateForWorker, STAFF_SERVICE_FEE_RATE, effectiveJobTotal } from "@shared/team";

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

interface BonusUsage {
  id: number;
  userId: string;
  amount: number;
  description: string;
  category: string;
  usedAt: string;
  investmentId: number | null;
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

export default function TaxExportPage() {
  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [allBonusUsages, setAllBonusUsages] = useState<BonusUsage[]>([]);
  const [turnover, setTurnover] = useState<Awaited<ReturnType<typeof api.getBillerTurnover>>["data"] | null>(null);
  const [settlement, setSettlement] = useState<FounderCrossSettlement | null>(null);
  const [workerStats, setWorkerStats] = useState<WorkerStatsResponse | null>(null);
  // Serializes the one-tap era-biller assignments: the endpoint rewrites the
  // whole gigData blob, so two in-flight assignments on the same job would
  // race and one would silently vanish.
  const [eraBusy, setEraBusy] = useState(false);
  // Enterprise instalment manager (all gig erät, editable/deletable).
  const [instalments, setInstalments] = useState<Awaited<ReturnType<typeof api.getGigInstalments>>["data"] | null>(null);
  // The logged-in founder's own money trail (sent customer invoices etc.).
  const [myDetail, setMyDetail] = useState<Awaited<ReturnType<typeof api.getWorker>>["data"] | null>(null);

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
      api.workersStats().then((res) => { if (res.ok && res.data) setWorkerStats(res.data); });
      api.getGigInstalments().then((res) => { if (res.ok && res.data) setInstalments(res.data); });
      if (profile?.id) api.getWorker(profile.id).then((res) => { if (res.ok && res.data) setMyDetail(res.data); });
    }
  }, [isHost, profile?.id]);

  useEffect(() => {
    loadMoney();
    if (profile?.startupBonus && profile.startupBonus > 0) {
      api.getStartupBonusUsages(profile.id).then((res) => {
        if (res.ok && res.data) setAllBonusUsages(res.data as BonusUsage[]);
      });
    }
  }, []);

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

  // Per-job rows with the user's proportional share.
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

  const yearBonusUsages = allBonusUsages.filter(u => new Date(u.usedAt).getFullYear() === year);
  const yearBonusTotal = yearBonusUsages.reduce((s, u) => s + u.amount, 0);

  const availableYears = Array.from(
    new Set(myJobs.map(r => new Date(r.job.scheduledAt || r.job.createdAt).getFullYear()))
  ).sort((a, b) => b - a);
  const years = availableYears.length > 0 ? availableYears : [new Date().getFullYear()];

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

  const multiWorkerRows = rows.filter(r => r.numWorkers > 1);

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
              {profile?.name ?? "Omat"} · tulos, velat ja dokumentit
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={handleCsv} className="gap-2"><Download className="w-4 h-4" /> CSV</Button>
            <Button onClick={handlePrint} className="gap-2"><Printer className="w-4 h-4" /> Tulosta</Button>
          </div>
        </div>

        {/* Year selector (screen only) */}
        <div className="flex flex-wrap gap-2 mb-6 print:hidden">
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

        {loading ? (
          <p className="text-muted-foreground text-center py-12">Ladataan…</p>
        ) : (
          <>
            {/* ── Status 1/3: the one number for OmaVero (always visible) ──── */}
            <Card className="p-5 bg-green-50 dark:bg-green-900/20 border-0 premium-shadow mb-4 print:hidden">
              <p className="text-xs font-bold uppercase tracking-wide text-green-800 dark:text-green-300 mb-1">
                {profile?.hasYTunnus
                  ? `Elinkeinotoiminnan tulos (lomake 5) — ${year}`
                  : `OmaVeroon ilmoitettava tulos — ${year}`}
              </p>
              <p className="text-4xl font-bold text-green-700 dark:text-green-400 mb-1">{fmt(heroTotal)}</p>
              <p className="text-xs text-green-700 dark:text-green-400">
                Keikkaosuudet {fmt(totals.net)}{fr8KateYear > 0 ? <> + urakkakate (FR8) {fmt(fr8KateYear)}</> : null}
                {" · ilmoita "}
                {profile?.hasYTunnus ? <strong>lomakkeella 5</strong> : <>kohtaan <strong>Muut ansiotulot</strong></>}
              </p>
            </Card>

            {/* ── Status 2/3: bossien velka — one number, two actions ──────── */}
            {isHost && settlement && (
              <FounderDebtCard settlement={settlement} onChanged={loadMoney} />
            )}

            {/* ── Status 3/3: ALV-raja — a green check until it matters ────── */}
            {isHost && turnover && (() => {
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
                <Card className="p-5 bg-card border-0 premium-shadow mb-4 print:hidden">
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
                                  : `Jäljellä ${fmt(Math.max(0, limitCents - cents))} — suosikaa toisen laskutusta`}
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
                        {unCount} laskua ({fmt(unTotal)}) ilman laskuttajaa — nämä eivät ole vielä kenenkään
                        luvuissa. Merkitse kuka laskutti, niin summa siirtyy oikean henkilön ALV-seurantaan
                        ja laskuluetteloon (FR8-urakan erissä myös bossien velkaan).
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

            {/* ── Yksityiskohdat: everything below is reference material ───── */}
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mt-6 mb-2 print:hidden">
              Yksityiskohdat &amp; dokumentit
            </p>

            {/* ── Omat asiakaslaskut: mitä MINÄ olen laskuttanut asiakkailta ── */}
            {isHost && myDetail && (() => {
              const yearInvoices = (myDetail.customerInvoices ?? []).filter(
                inv => new Date(inv.dateMs).getFullYear() === year
              );
              const sum = yearInvoices.reduce((s2, i) => s2 + i.amountCents, 0);
              return (
                <Disclosure
                  className="print:hidden"
                  icon={<FileText className="w-4 h-4 text-green-600 dark:text-green-400" />}
                  title="Omat asiakaslaskut"
                  right={<span className="text-xs text-muted-foreground tabular-nums">{yearInvoices.length} kpl · {fmt(sum)}</span>}
                >
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Kaikki {year} sinun Y-tunnuksellasi laskutetut asiakasmaksut — pikkukeikat ja urakkaerät (esim. FR8).
                    Sama summa ohjaa ALV-seurantaasi. Koko historia: <Link href={`/admin/tiimi/${profile?.id}`} className="text-primary underline underline-offset-2">oma sivusi</Link>.
                    {" "}Toisen bossin laskuttamat keikat eivät kuulu tähän — sinun osuutesi niistä näkyy
                    Omassa tuloksessa (urakkakate/keikkaosuus) ja Bossien velassa.
                  </p>
                  {yearInvoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-1">
                      Ei laskuja vuodelle {year}. Jos keikka puuttuu, merkitse sen "Laskutti" alla olevasta
                      Verotuloste-osiosta — tai kirjaa urakan erämaksu keikan Laskutus-kortista.
                    </p>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {yearInvoices.map((inv, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{inv.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(inv.dateMs).toLocaleDateString("fi-FI")}{inv.ref ? ` · viite ${inv.ref}` : ""} · {inv.source === "era" ? "urakkaerä" : "keikka"}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-bold tabular-nums">{fmt(inv.amountCents)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 pt-2 text-sm font-bold">
                        <span>Yhteensä {year}</span>
                        <span className="tabular-nums">{fmt(sum)}</span>
                      </div>
                    </div>
                  )}
                  {yearInvoices.length > 0 && (
                    <Button
                      variant="outline" size="sm" className="mt-3 gap-1.5 text-xs"
                      onClick={() => {
                        // Laskuluettelo kirjanpitoon — CSV per year.
                        const header = "Pvm;Kuvaus;Viite;Tyyppi;Summa (EUR)";
                        const lines = yearInvoices.map(inv => [
                          new Date(inv.dateMs).toLocaleDateString("fi-FI"),
                          `"${inv.name.replace(/"/g, "'")}"`,
                          inv.ref ?? "",
                          inv.source === "era" ? "urakkaerä" : "keikka",
                          (inv.amountCents / 100).toFixed(2).replace(".", ","),
                        ].join(";"));
                        const csv = [header, ...lines, `Yhteensä;;;;${(sum / 100).toFixed(2).replace(".", ",")}`].join("\n");
                        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `puuhapatet_laskuluettelo_${year}_${profile?.id}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="w-3.5 h-3.5" /> Lataa laskuluettelo (CSV)
                    </Button>
                  )}
                </Disclosure>
              );
            })()}

            {/* ── Dropdown: Urakkaerien hallinta (kaikki laskutuserät) ──────── */}
            {isHost && instalments && instalments.instalments.length > 0 && (
              <Disclosure
                className="print:hidden"
                icon={<FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                title="Urakkaerien hallinta"
                right={<span className="text-xs text-muted-foreground tabular-nums">{instalments.instalments.length} erää</span>}
              >
                <GigInstalmentManager data={instalments} onChanged={loadMoney} />
              </Disclosure>
            )}

            {/* ── Dropdown: Bossien maksuhistoria & erittely ────────────────── */}
            {isHost && settlement && (settlement.perGig.length > 0 || settlement.smallJobs.length > 0 || (settlement.settled ?? []).length > 0) && (
              <Disclosure
                className="print:hidden"
                icon={<Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                title="Bossien maksuhistoria & erittely"
                right={<span className="text-xs text-muted-foreground tabular-nums">{(settlement.settled ?? []).length} kirjausta</span>}
              >
                <FounderDetails settlement={settlement} onChanged={loadMoney} />
              </Disclosure>
            )}

            {/* ── Dropdown: Dokumentit & keikat ─────────────────────────────── */}
            <Disclosure
              defaultOpen
              className="print:hidden"
              icon={<FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />}
              title="Verotuloste — omat keikat"
              right={<span className="text-xs text-muted-foreground tabular-nums">{rows.length} keikkaa · {fmt(totals.revenue)}</span>}
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
                              {/* Kuka laskutti asiakasta (kenen Y-tunnukselle raha meni) — ohjaa
                                  ALV-seurannan ja bossien tilityksen oikealle henkilölle. FR8-
                                  tyyppiset urakat kirjaavat laskuttajan per erä, ei tässä. */}
                              {isHost && !r.job.isCustomGig && (() => { const inf = inferredBiller(r.job); return (
                                <select
                                  value={r.job.billedBy ?? ""}
                                  onChange={(e) => setBilledBy(r.job.id, e.target.value)}
                                  className={`mt-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] ${r.job.billedBy || inf ? "text-foreground" : "border-amber-400 text-amber-600"}`}
                                >
                                  <option value="">{inf ? `Laskutti: ${firstName(inf.name)} (päätelty)` : "Laskutti: ?"}</option>
                                  {BRAND_BILLERS.map(b => (
                                    <option key={b.id} value={b.id}>Laskutti: {firstName(b.name)}</option>
                                  ))}
                                  {/* Staff with own Y-tunnus (e.g. Petrus) can be the biller too —
                                      then the job just isn't founders' turnover. */}
                                  {USERS.filter(u => u.yTunnus && !BRAND_BILLERS.some(b => b.id === u.id)).map(u => (
                                    <option key={u.id} value={u.id}>Laskutti: {firstName(u.name)}</option>
                                  ))}
                                </select>
                              ); })()}
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
                    Palvelumaksu {myFeePct} % bruttosta (yläraja — kulut kirjataan erikseen kuiteilla,
                    eikä niitä ole vähennetty tähän). Kirjanpito kuitteineen säilytetään 6 vuotta.
                  </p>

                  {/* Multi-worker gigs: document the income split for the tax authority. */}
                  {multiWorkerRows.length > 0 && (
                    <Disclosure variant="inline" className="mt-4" title={`Tilityserittely — usean tekijän keikat (${multiWorkerRows.length})`}>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        Näillä keikoilla yksi tekijä laskutti asiakasta koko summalla ja tilitti muille
                        heidän osuutensa. Yllä näkyvä oma osuutesi on verotettava tulosi.
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
                </>
              )}
            </Disclosure>

            {/* ── Dropdown: Tiimi & työntekijät (HOST) ──────────────────────── */}
            {isHost && (
              <Disclosure
                className="print:hidden"
                icon={<Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                title="Tiimi & työntekijät"
                right={<span className="text-xs text-muted-foreground">avaa tekijän tiedot ›</span>}
              >
                <p className="text-[11px] text-muted-foreground mb-3">
                  Klikkaa tekijää nähdäksesi hänen rahaliikenteensä, dokumenttinsa ja verotietonsa kaikilta keikoilta.
                </p>
                <div className="space-y-1.5">
                  {USERS.filter(u => u.role !== "MARKETER").map((u) => {
                    const owed = workerStats?.workerFees[u.id] ?? 0;
                    const initials = (u.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <Link key={u.id} href={`/admin/tiimi/${u.id}`} className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors">
                        <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-bold text-muted-foreground">
                          {initials}
                          <img src={u.photoUrl || `/fr8/${u.id}.jpg`} alt={u.name} className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {u.role === "HOST" ? "Perustaja" : "Tekijä"}{u.yTunnus ? ` · ${u.yTunnus}` : ""}
                          </p>
                        </div>
                        {owed > 0 && (
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-bold tabular-nums text-purple-600 dark:text-purple-400">{fmt(owed)}</span>
                            <span className="text-[10px] text-muted-foreground">palveluvelka</span>
                          </span>
                        )}
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </Link>
                    );
                  })}
                </div>
              </Disclosure>
            )}

            {/* ── Dropdown: Aloitustuki / yritysseteli ──────────────────────── */}
            {profile?.startupBonus != null && profile.startupBonus > 0 && (
              <Disclosure
                className="print:hidden"
                icon={<Sparkles className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />}
                title="Aloitustuki / yritysseteli"
                right={<span className="text-xs text-muted-foreground tabular-nums">{fmt(profile.startupBonus)}</span>}
              >
                <p className="text-xs text-muted-foreground mb-3">
                  4H-yhdistys on ilmoittanut tuen tulorekisteriin — tarkista esitäytetty veroilmoitus.
                  {profile.hasYTunnus
                    ? " Y-tunnus: siirrä tuki elinkeinotoiminnan lomakkeeseen (lomake 5)."
                    : " Tarkista että tuki näkyy oikein esitäytetyssä veroilmoituksessa."}
                </p>
                {yearBonusUsages.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Käytetty {year}: {fmt(yearBonusTotal)}</p>
                    {yearBonusUsages.map(u => (
                      <div key={u.id} className="flex justify-between text-xs text-foreground bg-muted/30 rounded-lg px-3 py-2">
                        <span>{u.description}{u.investmentId ? " (investointi)" : ""}</span>
                        <span className="font-semibold shrink-0 ml-2">{fmt(u.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Ei kirjattuja käyttöjä vuodelle {year}. Kirjaa käyttö Asetuksista tai Investoinneista.
                  </p>
                )}
              </Disclosure>
            )}

            {/* ── Dropdown: OmaVero-ohjeet ─────────────────────────────────── */}
            <Disclosure
              className="print:hidden"
              icon={<Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
              title={profile?.hasYTunnus ? "OmaVero-ohjeet · Lomake 5 (Y-tunnus)" : "OmaVero-ohjeet (ei Y-tunnusta)"}
            >
              <div className="space-y-4 text-sm">
                <div className="p-3 rounded-xl bg-muted/40 text-xs text-muted-foreground space-y-1">
                  <p>• 4H-yrittäjänä maksat veroa henkilökohtaisen veroprosentin mukaan</p>
                  <p>• <strong>Ei arvonlisäverovelvollisuutta</strong> (myynti jää rajan alle)</p>
                  <p>• Kirjanpito kuitteineen säilytetään <strong>6 vuotta</strong></p>
                  <p>• Et liitä kuitteja veroilmoitukseen — verottaja pyytää tarvittaessa</p>
                </div>

                {profile?.hasYTunnus ? (
                  <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                    <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 mb-1.5">Sinulla on Y-tunnus → Elinkeinotoiminnan veroilmoitus (lomake 5)</p>
                    <ul className="text-xs text-indigo-700 dark:text-indigo-400 space-y-1">
                      <li>• OmaVero → <strong>Elinkeinotoiminnan veroilmoitus</strong> (lomake 5)</li>
                      <li>• Ilmoita tulos <strong>{fmt(totals.net)}</strong> siellä — ei henkilökohtaisessa</li>
                      <li>• Palvelumaksu {fmt(totals.serviceFee)} + kulut menoina</li>
                      <li>• Deadline <strong>1.4.</strong> · pakollinen vaikka ei toimintaa olisi</li>
                    </ul>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20">
                    <p className="text-xs font-bold text-green-800 dark:text-green-300 mb-1.5">Ilmoitettava summa: <strong>{fmt(totals.net)}</strong></p>
                    <ol className="text-xs text-green-700 dark:text-green-400 space-y-1 list-decimal list-inside">
                      <li>OmaVero → Esitäytetty veroilmoitus → Tuotot</li>
                      <li><strong>Muut tulot → Muut ansiotulot</strong></li>
                      <li>Kuvaus: <em>"4H-toiminnan tulot"</em> · määrä <strong>{fmt(totals.net)}</strong></li>
                    </ol>
                  </div>
                )}

                {profile?.isUnder18 && (
                  <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                    <p className="text-xs font-bold text-orange-800 dark:text-orange-300 mb-1.5">Alle 18-vuotias — huoltajan kautta OmaVeroon</p>
                    <ul className="text-xs text-orange-700 dark:text-orange-400 space-y-1">
                      <li>• Huoltaja: <strong>Asioi toisen puolesta → Valtuudet-palvelu</strong></li>
                      <li>• Alle 16v: tilaa verokortti OmaVerosta heti</li>
                    </ul>
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Matkakulut (lisävähennys)</p>
                  <ol className="space-y-1 list-decimal list-inside text-xs text-foreground">
                    <li>Muut vähennykset → Matkakulut → <em>Muu kuin asunnon ja työpaikan välinen matka</em></li>
                    <li>Säännöllinen sama matka: <strong>Ei</strong> · Osoite: <em>"useita kohteita"</em></li>
                  </ol>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Muut tulonhankkimismenot</p>
                  <p className="text-xs text-muted-foreground">
                    Muut vähennykset → Tulonhankkimismenot. Vähennyskelpoisia: 4H-jäsenmaksu, 4H-yrittäjän vakuutus, pesuaineet, välineet. Tarkemmat ohjeet: Opas → Verotus.
                  </p>
                </div>
              </div>
            </Disclosure>

            {/* ── Print-only document ──────────────────────────────────────── */}
            <div className="hidden print:block">
              <div className="mb-6">
                <h1 className="text-xl font-bold">Puuhapatet — Kirjanpitovuosi {year}</h1>
                <p className="text-sm text-gray-600">
                  Tekijä: {profile?.name ?? "—"}{profile?.yTunnus && ` · Y-tunnus: ${profile.yTunnus}`} · Tulostettu: {new Date().toLocaleDateString("fi-FI")}
                </p>
              </div>

              <div className="mb-4 p-3 border border-gray-300 rounded">
                <p className="text-xs font-bold uppercase text-gray-600">{profile?.hasYTunnus ? "Elinkeinotoiminnan tulos (lomake 5)" : "OmaVeroon ilmoitettava tulos"} — {year}</p>
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
                  {profile?.hasYTunnus
                    ? `Elinkeinotoiminnan tulos ${year}: ${fmt(heroTotal)} — ilmoita lomakkeella 5 (OmaVero). Palvelumaksu ${fmt(totals.serviceFee)} vähennetty${fr8KateYear > 0 ? `, urakkakate ${fmt(fr8KateYear)} mukana` : ""}.`
                    : `4H-yrityksen tulos ${year}: ${fmt(heroTotal)} — ilmoita kohdassa "Muut ansiotulot" (OmaVero). Palvelumaksu ${fmt(totals.serviceFee)} vähennetty${fr8KateYear > 0 ? `, urakkakate ${fmt(fr8KateYear)} mukana` : ""}.`}
                </p>
                <p className="mt-1">Puuhapatet · info@puuhapatet.fi · puuhapatet.fi</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Enterprise instalment manager: every recorded gig instalment (urakkaerä)
 *  in one editable list. A host can re-attribute the biller, fix the amount or
 *  date, or delete a bogus erä — all recompute the tracker + tax figures. This
 *  is the answer to "what is FAFO Capital erä 1 and why is it in my view":
 *  it's the FR8 gig (customer = FAFO Capital Oy), fully editable here. */
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
                {/* Fixed-deal erät are positional — only the last one may be
                    removed (server enforces this too). Non-fixed: any erä. */}
                {(!it.isFixedDeal || it.isLast) && (
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
                )}
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
 *  (kirjaa maksu / vastalasku). Every detail lives in the
 *  "Bossien maksuhistoria & erittely" disclosure instead. */
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
    <Card className="p-5 bg-card border-0 premium-shadow mb-4 print:hidden">
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
            await api.issueFounderInvoice({ fromId: smallFrom.id, toId: smallTo.id, cents: smallAbs, invoiceNo });
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

/** Reference material behind a dropdown: how the open balance is formed,
 *  the payment history (MobilePay + vastalaskut), manual booking for old
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
        fromId: inv.fromId, toId: inv.toId, cents: inv.cents, invoiceNo,
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
