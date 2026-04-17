/**
 * Admin Dashboard
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
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
import { api, StatsResponse, WorkerStatsResponse } from "@/lib/api";
import { isMyJob } from "@/lib/visibility";

export default function AdminDashboard() {
  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [workerStats, setWorkerStats] = useState<WorkerStatsResponse | null>(null);
  const [myJobTotal, setMyJobTotal] = useState<number | null>(null);
  const [myJobUpcoming, setMyJobUpcoming] = useState<number | null>(null);

  useEffect(() => {
    api.stats().then((res) => {
      if (res.ok && res.data) setStats(res.data);
      setLoading(false);
    });
    // HOST: team overview. STAFF: own debt/job count.
    api.workersStats().then((res) => {
      if (res.ok && res.data) setWorkerStats(res.data);
    });
    // STAFF: compute own total and upcoming from jobs list
    if (!isHost && profile) {
      api.getJobs().then((res) => {
        if (res.ok && res.data) {
          const rows = res.data as { job: { assignedTo: string | null; status: string } }[];
          const mine = rows.filter(r => isMyJob(r.job.assignedTo, profile.id));
          setMyJobTotal(mine.length);
          setMyJobUpcoming(mine.filter(r => r.job.status === "scheduled").length);
        }
      });
    }
  }, []);

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const myDebt = workerStats && profile ? (workerStats.workerFees[profile.id] ?? 0) : null;
  const myJobCount = workerStats && profile ? (workerStats.workerJobCount[profile.id] ?? 0) : null;

  const cards = isHost
    ? [
        {
          title: "Keikat yhteensä",
          value: loading ? "…" : String(stats?.totalJobs ?? "-"),
          icon: Briefcase,
          description: "Kaikki kirjatut keikat",
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/30",
        },
        {
          title: "Tulevat keikat",
          value: loading ? "…" : String(stats?.upcoming ?? "-"),
          icon: Clock,
          description: "Aikataulutettu",
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-100 dark:bg-orange-900/30",
        },
        {
          title: "Nettotulo",
          value: loading ? "…" : stats ? fmt(stats.netIncome) : "-",
          icon: TrendingUp,
          description: "Tulot − kulut − palvelumaksu",
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30",
        },
        {
          title: "Palveluvelka",
          value: loading ? "…" : stats ? fmt(stats.serviceFeeTotal) : "-",
          icon: Banknote,
          description: "10 % maksamatta brändille",
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
          title: "Valmistuneet",
          value: myJobCount === null ? "…" : String(myJobCount),
          icon: TrendingUp,
          description: "Valmistuneet omat keikat",
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/30",
        },
        {
          title: "Oma palveluvelka",
          value: myDebt === null ? "…" : fmt(myDebt),
          icon: Banknote,
          description: "10 % brändille maksamatta",
          color: "text-purple-600 dark:text-purple-400",
          bgColor: "bg-purple-100 dark:bg-purple-900/30",
        },
      ];

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
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
          <Link href="/admin/tax-export">
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
          <Card className="p-4 bg-card border-0 premium-shadow mb-8">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Tekijöiden palvelumaksut — maksamatta
            </p>
            <div className="space-y-3">
              {USERS.map((u) => {
                const owed = workerStats.workerFees[u.id] ?? 0;
                const jobCount = workerStats.workerJobCount[u.id] ?? 0;
                return (
                  <div key={u.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
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
              Laskettu valmistuneista keikoista: (hinta − kulut) × 10 % per tekijä
            </p>
          </Card>
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
