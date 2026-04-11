/**
 * Verotuloste — yhteenveto keikoista verotusta varten
 * Tulostettava sivu joka sopii 4H-kirjanpitoon ja OmaVero-ilmoitukseen
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";

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

interface Expense {
  id: number;
  jobId: number;
  description: string;
  amount: number;
}

export default function TaxExportPage() {
  const { toast } = useToast();
  const profile = getAdminProfile();

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    Promise.all([api.getJobs(), api.getExpenses(0)]).then(([jobsRes]) => {
      if (jobsRes.ok && jobsRes.data) {
        setJobs((jobsRes.data as JobRow[]).filter(r => r.job.status === "done"));
      }
      setLoading(false);
    });
    // Fetch all expenses via a workaround: get them per-job lazily
    // For now we use the stats endpoint that aggregates them
  }, []);

  // Filter jobs by selected year
  const yearJobs = jobs.filter(r => {
    const d = r.job.scheduledAt || r.job.createdAt;
    return new Date(d).getFullYear() === year;
  });

  // Build per-job rows (expenses loaded lazily per job on demand — for now use 0)
  const rows = yearJobs.map(r => {
    const jobExpenses = allExpenses.filter(e => e.jobId === r.job.id);
    const expenses = jobExpenses.reduce((s, e) => s + e.amount, 0);
    const netRevenue = Math.max(0, r.job.agreedPrice - expenses);
    const serviceFee = Math.round(netRevenue * 0.10);
    const net = netRevenue - serviceFee;
    return { ...r, expenses, netRevenue, serviceFee, net };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.job.agreedPrice,
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
    new Set(jobs.map(r => new Date(r.job.scheduledAt || r.job.createdAt).getFullYear()))
  ).sort((a, b) => b - a);

  const handlePrint = () => window.print();

  const handleCsv = () => {
    const header = "Päivämäärä;Asiakas;Osoite;Palvelu;Bruttokorvaus (€);Kulut (€);Palvelumaksu (€);Nettoansio (€)";
    const lines = rows.map(r =>
      [
        fmtDate(r.job.scheduledAt || r.job.createdAt),
        r.customer?.name ?? "",
        r.customer?.address ?? "",
        `"${r.job.description}"`,
        (r.job.agreedPrice / 100).toFixed(2).replace(".", ","),
        (r.expenses / 100).toFixed(2).replace(".", ","),
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

  const years = availableYears.length > 0 ? availableYears : [new Date().getFullYear()];

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
              Valmistuneet keikat · käytä OmaVero-ilmoitukseen
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
            Tämä tuloste on tarkoitettu OmaVero-ilmoituksen tueksi. Bruttokorvaus = veronalainen tulo.
            Kulut ja palvelumaksu ovat vähennyskelpoisia menoja.
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
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 print:grid-cols-4">
              {[
                { label: "Bruttokorvaus",  value: fmt(totals.revenue),    note: "Veronalainen tulo",        color: "text-blue-600" },
                { label: "Kulut",          value: fmt(totals.expenses),   note: "Vähennyskelpoiset menot",  color: "text-orange-600" },
                { label: "Palvelumaksu",   value: fmt(totals.serviceFee), note: "10 % nettotuloista",       color: "text-purple-600" },
                { label: "Nettoansio",     value: fmt(totals.net),        note: "Ilmoitettava tulo",        color: "text-green-600" },
              ].map((c, i) => (
                <Card key={i} className="p-4 bg-card border-0 premium-shadow print:shadow-none print:border print:border-gray-200">
                  <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
                  <p className="text-sm font-medium text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.note}</p>
                </Card>
              ))}
            </div>

            {/* OmaVero hint */}
            <Card className="p-4 bg-blue-50 dark:bg-blue-900/20 border-0 mb-6 print:hidden">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
                OmaVero-ilmoitukseen (elinkeinotoiminta / freelancer):
              </p>
              <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-0.5">
                <li>• <strong>Tulot:</strong> {fmt(totals.revenue)} (bruttokorvaus)</li>
                <li>• <strong>Menot:</strong> {fmt(totals.expenses + totals.serviceFee)} (kulut + palvelumaksu)</li>
                <li>• <strong>Verotettava tulo:</strong> {fmt(totals.net)}</li>
              </ul>
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
                    <th className="pb-2 pr-3 text-xs font-semibold text-muted-foreground uppercase text-right hidden md:table-cell print:table-cell">Kulut</th>
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
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground hidden md:table-cell print:table-cell max-w-xs">
                        <span className="line-clamp-2">{r.job.description}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-medium">{fmt(r.job.agreedPrice)}</td>
                      <td className="py-2 pr-3 text-right text-orange-600 dark:text-orange-400 hidden md:table-cell print:table-cell">
                        {r.expenses > 0 ? `−${fmt(r.expenses)}` : "—"}
                      </td>
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
                    <td className="pt-3 text-right text-orange-600 hidden md:table-cell print:table-cell">
                      {totals.expenses > 0 ? `−${fmt(totals.expenses)}` : "—"}
                    </td>
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
                Kulut ja palvelumaksu ({fmt(totals.expenses + totals.serviceFee)}) ovat vähennyskelpoisia.
                Nettoansio ({fmt(totals.net)}) on ilmoitettava verotettavana tulona.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
