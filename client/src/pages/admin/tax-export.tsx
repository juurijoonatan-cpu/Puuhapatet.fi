/**
 * Verotuloste — yhteenveto keikoista verotusta varten
 * Tulostettava sivu joka sopii 4H-kirjanpitoon ja OmaVero-ilmoitukseen
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Printer, ChevronDown, ChevronUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

interface JobRow {
  job: {
    id: number;
    status: string;
    description: string;
    agreedPrice: number;
    assignedTo: string | null;
    scheduledAt: string | null;
    createdAt: string;
  };
  customer: {
    id: number;
    name: string;
    address: string;
  } | null;
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

export default function TaxExportPage() {
  const profile = getAdminProfile();

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    api.getJobs().then((res) => {
      if (res.ok && res.data) {
        setJobs((res.data as JobRow[]).filter(r => r.job.status === "done"));
      }
      setLoading(false);
    });
  }, []);

  // Filter to current user's jobs only
  const myJobs = jobs.filter(r => {
    if (!profile) return true;
    const workers = parseWorkerIds(r.job.assignedTo);
    return workers.length === 0 || workers.includes(profile.id);
  });

  // Filter by selected year
  const yearJobs = myJobs.filter(r => {
    const d = r.job.scheduledAt || r.job.createdAt;
    return new Date(d).getFullYear() === year;
  });

  // Build per-job rows with user's proportional share
  const rows = yearJobs.map(r => {
    const workers = parseWorkerIds(r.job.assignedTo);
    const numWorkers = Math.max(workers.length, 1);
    const share = 1 / numWorkers;

    const myRevenue = Math.round(r.job.agreedPrice * share);
    // expenses not tracked per-job here (would require per-job fetch); use 0 for now
    const expenses = 0;
    const netRevenue = Math.max(0, myRevenue - expenses);
    const serviceFee = Math.round(netRevenue * 0.10);
    const net = netRevenue - serviceFee;
    return { ...r, myRevenue, expenses, netRevenue, serviceFee, net, numWorkers };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.myRevenue,
      expenses: acc.expenses + r.expenses,
      serviceFee: acc.serviceFee + r.serviceFee,
      net: acc.net + r.net,
    }),
    { revenue: 0, expenses: 0, serviceFee: 0, net: 0 },
  );

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("fi-FI") : "—";

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
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `puuhapatet_keikat_${year}_${profile?.id ?? "oma"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28 print:pt-4 print:pb-4">
      <div className="container mx-auto px-4 max-w-4xl">

        {/* Header — hidden in print */}
        <div className="flex items-center gap-4 mb-6 print:hidden">
          <Link href="/admin/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-foreground">Verotuloste</h1>
            <p className="text-sm text-muted-foreground">
              {profile?.name ?? "Omat"} keikat · OmaVero-ilmoitukseen
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCsv} className="gap-2">
              <Download className="w-4 h-4" />
              CSV
            </Button>
            <Button onClick={handlePrint} className="gap-2">
              <Printer className="w-4 h-4" />
              Tulosta
            </Button>
          </div>
        </div>

        {/* Year selector */}
        <div className="flex gap-2 mb-6 print:hidden">
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

        {/* Print header */}
        <div className="hidden print:block mb-6">
          <h1 className="text-xl font-bold">Puuhapatet — Kirjanpitovuosi {year}</h1>
          <p className="text-sm text-gray-600">
            Tekijä: {profile?.name ?? "—"} · Tulostettu: {new Date().toLocaleDateString("fi-FI")}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            4H-yrityksen tulos = nettoansio. Ilmoita kohdassa "Muut ansiotulot" OmaVerossa.
          </p>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-center py-12">Ladataan…</p>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center bg-card border-0 premium-shadow">
            <p className="text-muted-foreground">Ei valmistuneita keikkoja vuodelle {year}</p>
          </Card>
        ) : (
          <>
            {/* Key figure — what to enter in OmaVero */}
            <Card className="p-5 bg-green-50 dark:bg-green-900/20 border-0 premium-shadow mb-6">
              <p className="text-xs font-bold uppercase tracking-wide text-green-800 dark:text-green-300 mb-1">
                OmaVeroon ilmoitettava tulos ({year})
              </p>
              <p className="text-4xl font-bold text-green-700 dark:text-green-400 mb-1">
                {fmt(totals.net)}
              </p>
              <p className="text-xs text-green-700 dark:text-green-400">
                4H-yrityksen tulos · kirjaa kohtaan <strong>Muut ansiotulot</strong> → "4H-toiminnan tulot"
              </p>
            </Card>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 print:grid-cols-4">
              {[
                { label: "Bruttokorvaus",  value: fmt(totals.revenue),    note: "Asiakkailta laskutettu",   color: "text-blue-600" },
                { label: "Kulut",          value: fmt(totals.expenses),   note: "Materiaalit ym.",           color: "text-orange-600" },
                { label: "Palvelumaksu",   value: fmt(totals.serviceFee), note: "10 % nettotuloista",        color: "text-purple-600" },
                { label: "4H-tulos",       value: fmt(totals.net),        note: "Ilmoita OmaVeroon",         color: "text-green-600" },
              ].map((c, i) => (
                <Card key={i} className="p-4 bg-card border-0 premium-shadow print:shadow-none print:border print:border-gray-200">
                  <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.note}</p>
                </Card>
              ))}
            </div>

            {/* OmaVero step-by-step guide (collapsible) */}
            <Card className="bg-card border-0 premium-shadow mb-6 print:hidden overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 text-left"
                onClick={() => setShowGuide(g => !g)}
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-semibold text-foreground">
                    Näin teet veroilmoituksen OmaVerossa (4H-yrittäjä)
                  </span>
                </div>
                {showGuide
                  ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                }
              </button>
              {showGuide && (
                <div className="px-5 pb-5 border-t border-border pt-4 space-y-4 text-sm">

                  {/* Key facts */}
                  <div className="p-3 rounded-xl bg-muted/40 text-xs text-muted-foreground space-y-1">
                    <p>• 4H-yrittäjänä maksat veroa henkilökohtaisen veroprosentin mukaan</p>
                    <p>• <strong>Ei arvonlisäverovelvollisuutta</strong> (myynti jää rajan alle)</p>
                    <p>• Kirjanpito kuitteineen säilytetään <strong>6 vuotta</strong></p>
                    <p>• Et liitä kuitteja veroilmoitukseen — verottaja pyytää tarvittaessa</p>
                  </div>

                  {/* Two paths */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                      <p className="text-xs font-bold text-purple-800 dark:text-purple-300 mb-1">Ei Y-tunnusta</p>
                      <p className="text-xs text-purple-700 dark:text-purple-400">
                        Henkilökohtainen veroilmoitus → Muut ansiotulot → "4H-toiminnan tulot"
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                      <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 mb-1">Y-tunnus on</p>
                      <p className="text-xs text-indigo-700 dark:text-indigo-400">
                        Elinkeinotoiminnan veroilmoitus (lomake 5) · deadline 1.4. · pakollinen vaikka ei toimintaa
                      </p>
                    </div>
                  </div>

                  {/* Guardian / under-16 */}
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20">
                    <p className="text-xs font-bold text-blue-800 dark:text-blue-300 mb-1.5">
                      Alle 16-vuotias tai huoltaja asioi OmaVerossa
                    </p>
                    <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                      <li>• Alle 16-vuotiaille verokorttia ei lähetetä automaattisesti — tilaa OmaVerosta heti toiminnan alkaessa</li>
                      <li>• Huoltaja: kirjaudu omilla tunnuksilla → <strong>Asioi toisen puolesta → Valtuudet-palvelu</strong> → valitse lapsi</li>
                      <li>• Jos nuori tekee ilmoituksen itse OmaVerossa, huoltajan allekirjoitusta ei tarvita</li>
                    </ul>
                  </div>

                  {/* Steps */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                      Vaihe vaiheelta (ei Y-tunnusta)
                    </p>
                    <ol className="space-y-1.5 list-decimal list-inside text-sm text-foreground">
                      <li>Avaa OmaVerossa <strong>Esitäytetty veroilmoitus</strong></li>
                      <li>Korjaa esitäytetyn veroilmoituksen tietoja</li>
                      <li>Tarvittaessa valitse alhaalta <strong>Tulojen ja vähennysten ilmoittaminen</strong></li>
                      <li>Tarkista taustatiedot</li>
                    </ol>
                  </div>

                  {/* Key figure */}
                  <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20">
                    <p className="text-xs font-bold text-green-800 dark:text-green-300 mb-1.5">
                      Kirjaa tämä summa: <strong>{fmt(totals.net)}</strong>
                    </p>
                    <ol className="text-xs text-green-700 dark:text-green-400 space-y-1 list-decimal list-inside">
                      <li>Tuotot-sivu → <strong>Muut tulot → Muut ansiotulot</strong></li>
                      <li>Kuvaus: <em>"4H-toiminnan tulot"</em></li>
                      <li>Tulon määrä: <strong>{fmt(totals.net)}</strong></li>
                    </ol>
                  </div>

                  {/* Travel */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                      Matkakulut (lisävähennys)
                    </p>
                    <ol className="space-y-1 list-decimal list-inside text-xs text-foreground">
                      <li>Muut vähennykset → Matkakulut → <em>Muu kuin asunnon ja työpaikan välinen matka</em></li>
                      <li>→ Tilapäiset työmatkat → valitse kulkuneuvo</li>
                      <li>Säännöllinen sama matka: <strong>Ei</strong> · Osoite: <em>"useita kohteita"</em></li>
                      <li>Matkan keskipituus/päivä: km ÷ työpäivät · Matkapäivien lkm: sama jakaja</li>
                    </ol>
                  </div>

                  {/* Other deductions */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                      Muut tulonhankkimismenot
                    </p>
                    <p className="text-xs text-foreground mb-1">
                      Muut vähennykset → <strong>Tulonhankkimismenot → Muiden kuin palkkatulojen tulonhankkimismenot</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Vähennyskelpoisia: 4H-jäsenmaksu, 4H-yrittäjän vakuutus, pesuaineet, välineet
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                    <p className="text-xs font-bold text-yellow-800 dark:text-yellow-300 mb-1">Muista</p>
                    <ul className="text-xs text-yellow-700 dark:text-yellow-400 space-y-0.5">
                      <li>• Veroilmoitus on yrittäjän vastuulla — tee vaikka lomake ei tulisi automaattisesti</li>
                      <li>• Lisäaikaa voi hakea OmaVeron kautta</li>
                      <li>• Tarkemmat ohjeet: Opas → Verotus-osio</li>
                    </ul>
                  </div>
                </div>
              )}
            </Card>

            {/* Jobs table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Pvm</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase">Asiakas</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase hidden md:table-cell print:table-cell">Palvelu</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase text-right">Brutto</th>
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase text-right hidden md:table-cell print:table-cell">Maksu</th>
                    <th className="pb-2 text-xs font-semibold text-muted-foreground uppercase text-right">Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.job.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {fmtDate(r.job.scheduledAt || r.job.createdAt)}
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-foreground">{r.customer?.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.customer?.address ?? ""}</p>
                        {r.numWorkers > 1 && (
                          <p className="text-xs text-blue-600 dark:text-blue-400">1/{r.numWorkers} osuus</p>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground hidden md:table-cell print:table-cell max-w-xs">
                        <span className="line-clamp-2">{r.job.description}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-medium">{fmt(r.myRevenue)}</td>
                      <td className="py-2 pr-3 text-right text-purple-600 dark:text-purple-400 hidden md:table-cell print:table-cell">
                        −{fmt(r.serviceFee)}
                      </td>
                      <td className="py-2 text-right font-semibold text-green-600 dark:text-green-400">
                        {fmt(r.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td colSpan={3} className="pt-3 text-foreground hidden md:table-cell print:table-cell">Yhteensä</td>
                    <td colSpan={3} className="pt-3 text-foreground md:hidden print:hidden">Yhteensä</td>
                    <td className="pt-3 text-right">{fmt(totals.revenue)}</td>
                    <td className="pt-3 text-right text-purple-600 hidden md:table-cell print:table-cell">
                      −{fmt(totals.serviceFee)}
                    </td>
                    <td className="pt-3 text-right text-green-600 font-bold text-base">{fmt(totals.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Print footer */}
            <div className="hidden print:block mt-8 text-xs text-gray-500 border-t pt-4">
              <p>Puuhapatet · info@puuhapatet.fi · puuhapatet.fi</p>
              <p className="mt-1">
                4H-yrityksen tulos ({fmt(totals.net)}) ilmoitetaan OmaVerossa kohdassa
                Muut ansiotulot → "4H-toiminnan tulot".
                Palvelumaksu ({fmt(totals.serviceFee)}) on vähennyskelpoisena kirjattu netosta.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
