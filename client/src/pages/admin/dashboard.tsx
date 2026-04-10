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
} from "lucide-react";
import { getAdminProfile } from "@/lib/admin-profile";
import { api, StatsResponse } from "@/lib/api";

export default function AdminDashboard() {
  const profile = getAdminProfile();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.stats().then((res) => {
      if (res.ok && res.data) setStats(res.data);
      setLoading(false);
    });
  }, []);

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const cards = [
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

        <Link href="/admin/jobs">
          <Card className="p-6 bg-card border-0 premium-shadow mb-6 cursor-pointer hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                  <List className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Kaikki keikat</h3>
                  <p className="text-sm text-muted-foreground">Selaa ja hae keikkoja</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </Card>
        </Link>

        {profile?.role && (
          <div className="text-center text-xs text-muted-foreground">
            Rooli: {profile.role}
          </div>
        )}
      </div>
    </div>
  );
}
