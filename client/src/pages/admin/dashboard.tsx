/**
 * Admin Dashboard
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Clock,
  TrendingUp,
  Banknote,
  Plus,
  ArrowRight,
  List,
  Users,
} from "lucide-react";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { DashboardBriefing } from "@/components/dashboard-briefing";
import { api, StatsResponse, WorkerStatsResponse, type MyGigWork } from "@/lib/api";
import { isMyJob, parseWorkerIds } from "@/lib/visibility";
import { STAFF_SERVICE_FEE_RATE, STAFF_SERVICE_FEE_PCT, HOST_SERVICE_FEE_PCT, feeRateForWorker, feePctForWorker, effectiveJobTotal } from "@shared/team";

export default function AdminDashboard() {
  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workerStats, setWorkerStats] = useState<WorkerStatsResponse | null>(null);
  const [myJobTotal, setMyJobTotal] = useState<number | null>(null);
  const [myJobUpcoming, setMyJobUpcoming] = useState<number | null>(null);
  const [myRevenue, setMyRevenue] = useState<number | null>(null);
  const [myInvestmentShare, setMyInvestmentShare] = useState<number | null>(null);
  // Gigs where the logged-in admin is ALSO a worker (e.g. Petrus). Shows a small
  // earnings card + a button straight to their own worker dashboard.
  const [myGigWork, setMyGigWork] = useState<MyGigWork[]>([]);

  useEffect(() => {
    api.getMyGigWork().then((res) => {
      if (res.ok && res.data) setMyGigWork(res.data.gigs.filter((g) => g.earnedCents > 0 || g.washed > 0 || g.pendingCents > 0));
    });
  }, []);

  useEffect(() => {
    api.stats().then((res) => {
      if (res.ok && res.data) setStats(res.data);
      setLoading(false);
    });
    api.workersStats().then((res) => {
      if (res.ok && res.data) setWorkerStats(res.data);
    });
    // Always fetch personal stats for both HOST and STAFF
    if (profile) {
      api.getJobs().then((res) => {
        if (res.ok && res.data) {
          const rows = res.data as { job: { assignedTo: string | null; status: string; agreedPrice: number; waiveFee?: boolean; quoteStatus?: string | null; unitCount?: number | null; isTaloyhtiio?: boolean | null } }[];
          const mine = rows.filter(r => isMyJob(r.job.assignedTo, profile.id));
          setMyJobTotal(mine.length);
          setMyJobUpcoming(mine.filter(r => r.job.status === "scheduled").length);
          const rev = mine
            // A declined quote earned nothing — keep it out of personal income.
            .filter(r => r.job.status === "done" && r.job.quoteStatus !== "declined")
            .reduce((sum, r) => {
              const workerCount = Math.max(1, parseWorkerIds(r.job.assignedTo).length);
              // taloyhtiö gigs bill per apartment × unitCount — use the full total.
              return sum + Math.round(effectiveJobTotal(r.job) / workerCount);
            }, 0);
          setMyRevenue(rev);
        }
      });
      api.getInvestments().then((res) => {
        if (res.ok && res.data) {
          const rows = res.data as { boughtBy: string; splitWith?: string | null; amount: number }[];
          const share = rows.reduce((sum, inv) => {
            if (inv.boughtBy === profile.id) return sum + (inv.splitWith ? Math.round(inv.amount / 2) : inv.amount);
            if (inv.splitWith === profile.id) return sum + Math.round(inv.amount / 2);
            return sum;
          }, 0);
          setMyInvestmentShare(share);
        }
      });
    }
  }, []);

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  const myDebt = workerStats && profile ? (workerStats.workerFees[profile.id] ?? 0) : null;
  const myJobCount = workerStats && profile ? (workerStats.workerJobCount[profile.id] ?? 0) : null;

  const cards = isHost
    ? [
        {
          title: "Omat keikat",
          value: myJobTotal === null ? "…" : String(myJobTotal),
          icon: Briefcase,
          description: "Kaikki omat kirjatut keikat",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/30",
        },
        {
          title: "Tulevat keikat",
          value: myJobUpcoming === null ? "…" : String(myJobUpcoming),
          icon: Clock,
          description: "Aikataulutettu (omat)",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
        },
        {
          title: "Oma tulo",
          value: myRevenue === null ? "…" : fmt(Math.max(0, myRevenue - (myInvestmentShare ?? 0))),
          icon: TrendingUp,
          description: myInvestmentShare
            ? `Keikat ${myRevenue !== null ? fmt(myRevenue) : "…"} − investoinnit ${fmt(myInvestmentShare)}`
            : "Valmistuneiden omien keikkojen tulot",
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30",
        },
        {
          title: "Oma palveluvelka",
          value: myDebt === null ? "…" : fmt(myDebt),
          icon: Banknote,
          description: `${HOST_SERVICE_FEE_PCT} % brändille — maksamatta`,
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-100 dark:bg-purple-900/30",
        },
      ]
    : [
        {
          title: "Omat keikat",
          value: myJobTotal === null ? "…" : String(myJobTotal),
          icon: Briefcase,
          description: "Kaikki omat kirjatut keikat",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/30",
        },
        {
          title: "Tulevat keikat",
          value: myJobUpcoming === null ? "…" : String(myJobUpcoming),
          icon: Clock,
          description: "Aikataulutettu (omat)",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
        },
        {
          title: "Bruttotulo",
          value: myRevenue === null ? "…" : fmt(Math.max(0, myRevenue - (myInvestmentShare ?? 0))),
          icon: TrendingUp,
          description: myInvestmentShare
            ? `Keikat ${myRevenue !== null ? fmt(myRevenue) : "…"} − investoinnit ${fmt(myInvestmentShare)} (ennen palvelumaksua)`
            : `${myJobCount ?? "…"} valmistunutta keikkaa — ennen kuluja ja palvelumaksua`,
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30",
        },
        {
          title: "Palveluvelka",
          value: myDebt === null ? "…" : fmt(myDebt),
          icon: Banknote,
          description: `${STAFF_SERVICE_FEE_PCT} % brändille — maksamatta`,
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-100 dark:bg-purple-900/30",
        },
      ];

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">
            Hei, {profile?.name?.split(" ")[0] || "Ylläpitäjä"}
          </h1>
          <p className="text-muted-foreground">Tervetuloa Puuhapatet-ylläpitoon</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {cards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index} className="p-4 md:p-5 bg-card border-0 premium-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-semibold text-foreground mb-1">{stat.value}</p>
                <p className="text-sm text-foreground">{stat.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
              </Card>
            );
          })}
        </div>

        {/* Gigs where this admin also works (e.g. Petrus): own earnings + a
            button straight to the worker dashboard. Limited on purpose — no gig
            total, no other workers' euros. */}
        {myGigWork.map((g) => (
          <Card key={g.jobId} className="p-5 bg-card border-0 premium-shadow mb-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Oma keikka
                </p>
                <p className="text-base font-semibold text-foreground truncate">{g.gigName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{g.washed} pestyä ikkunaa</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl bg-muted/40 py-2 px-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ansaittu</p>
                <p className="text-base font-bold tabular-nums text-foreground">{fmt(g.earnedCents)}</p>
              </div>
              <div className="rounded-xl bg-muted/40 py-2 px-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Maksettu</p>
                <p className="text-base font-bold tabular-nums text-green-600 dark:text-green-400">{fmt(g.paidCents)}</p>
              </div>
              <div className="rounded-xl bg-muted/40 py-2 px-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avoinna</p>
                <p className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(Math.max(0, g.earnedCents - g.paidCents))}</p>
              </div>
            </div>
            <a href={`/tyo/${g.token}`} className="block">
              <Button className="w-full">
                Avaa oma työpöytä <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </Card>
        ))}

        <DashboardBriefing />

        {/* STAFF: personal earnings breakdown note */}
        {!isHost && myRevenue !== null && myRevenue > 0 && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Tilitys — erittely
            </p>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bruttotulo (keikat)</span>
                <span className="font-medium text-foreground">{fmt(Math.max(0, myRevenue - (myInvestmentShare ?? 0)))}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">− Palvelumaksu ~{profile ? feePctForWorker(profile.id) : STAFF_SERVICE_FEE_PCT} %</span>
                <span className="text-purple-600 dark:text-purple-400">−{fmt(Math.round(Math.max(0, myRevenue - (myInvestmentShare ?? 0)) * (profile ? feeRateForWorker(profile.id) : STAFF_SERVICE_FEE_RATE)))}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 mt-1">
                <span className="text-muted-foreground">≈ Nettotulo</span>
                <span className="font-bold text-green-600 dark:text-green-400">
                  {fmt(Math.round(Math.max(0, myRevenue - (myInvestmentShare ?? 0)) * (1 - (profile ? feeRateForWorker(profile.id) : STAFF_SERVICE_FEE_RATE))))}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Arvio — tarkka netto riippuu kirjatuista kuluista. Katso täsmälliset luvut Verotulosteesta.
            </p>
          </Card>
        )}

        {/* Revenue breakdown — HOST: team view, STAFF: personal earnings link */}
        {!loading && stats && isHost && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-8">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Talous — erittely (tiimi)
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Tulot</p>
                <p className="text-lg font-semibold text-foreground">{fmt(stats.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Kulut</p>
                <p className="text-lg font-semibold text-foreground">{fmt(stats.totalExpenses)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Palvelumaksu</p>
                <p className="text-lg font-semibold text-foreground">{fmt(stats.serviceFeeTotal)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Nettotulo</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">{fmt(stats.netIncome)}</p>
            </div>
          </Card>
        )}
        {!isHost && (
          <Link href="/admin/talous">
            <Card className="p-4 bg-card border-0 premium-shadow mb-8 cursor-pointer hover:opacity-95 transition-opacity">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Omat tulot
                  </p>
                  <p className="text-sm text-foreground font-medium">Katso oma verotuloste</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Omat keikat · palvelumaksu · nettotulo verotusta varten
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
              </div>
            </Card>
          </Link>
        )}

        {/* Worker service fee debts — HOST only */}
        {isHost && workerStats && (
          <Disclosure
            className="mb-8"
            title="Tekijöiden palvelumaksut — maksamatta"
            right={(() => {
              const totalOwed = USERS.reduce((s, u) => s + (workerStats.workerFees[u.id] ?? 0), 0);
              return <span className={`text-sm font-bold tabular-nums ${totalOwed > 0 ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>{fmt(totalOwed)}</span>;
            })()}
          >
            <div className="space-y-3">
              {USERS.map((u) => {
                const owed = workerStats.workerFees[u.id] ?? 0;
                const jobCount = workerStats.workerJobCount[u.id] ?? 0;
                return (
                  <div key={u.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/tiimi/${u.id}`} aria-label={`Avaa ${u.name}`} className="shrink-0 rounded-full transition-transform hover:scale-105 active:scale-95">
                        {u.photoUrl ? (
                          <img
                            src={u.photoUrl}
                            alt={u.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {u.name[0]}
                            </span>
                          </div>
                        )}
                      </Link>
                      <div>
                        <p className="text-sm font-medium text-foreground">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {jobCount} valmista keikkaa
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-base font-bold ${owed > 0 ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>
                        {fmt(owed)}
                      </p>
                      <p className="text-xs text-muted-foreground">velassa</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border">
              Laskettu valmistuneista keikoista: (hinta − kulut) × palvelumaksu-% per tekijä — perustajat {HOST_SERVICE_FEE_PCT} %, työntekijät {STAFF_SERVICE_FEE_PCT} %
            </p>
          </Disclosure>
        )}

        <Link href="/admin/new">
          <Card className="p-6 bg-primary text-primary-foreground border-0 mb-8 cursor-pointer hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Uusi keikka</h2>
                  <p className="text-primary-foreground/80 text-sm">
                    Aloita uuden asiakkaan palveluprosessi
                  </p>
                </div>
              </div>
              <ArrowRight className="w-6 h-6" />
            </div>
          </Card>
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Link href="/admin/jobs">
            <Card className="p-5 bg-card border-0 premium-shadow cursor-pointer hover:opacity-95 transition-opacity h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <List className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Keikat</h3>
                    <p className="text-sm text-muted-foreground">Selaa ja hae keikkoja</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </Card>
          </Link>
          <Link href="/admin/customers">
            <Card className="p-5 bg-card border-0 premium-shadow cursor-pointer hover:opacity-95 transition-opacity h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Users className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Asiakkaat</h3>
                    <p className="text-sm text-muted-foreground">Asiakasrekisteri</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </Card>
          </Link>
        </div>

        {profile?.role && (
          <div className="text-center text-xs text-muted-foreground">
            Rooli: {profile.role}
          </div>
        )}
      </div>
    </div>
  );
}
