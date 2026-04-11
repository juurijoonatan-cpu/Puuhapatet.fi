/**
 * Admin Settings Page
 */

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, LogOut, User, Sun, Moon, Banknote, CheckCircle, BookOpen, FileSpreadsheet } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clearAdminSession } from "./login";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import { getAdminProfile, clearAdminProfile, USERS } from "@/lib/admin-profile";
import { api, WorkerStatsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";

  const [workerStats, setWorkerStats] = useState<WorkerStatsResponse | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const loadStats = () => {
    if (isHost) {
      api.workersStats().then((res) => {
        if (res.ok && res.data) setWorkerStats(res.data);
      });
    }
  };

  useEffect(() => { loadStats(); }, []);

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  const handleMarkPaid = async (workerId: string) => {
    const owed = workerStats?.workerFees[workerId] ?? 0;
    if (owed <= 0) return;
    setMarkingPaid(workerId);
    const res = await api.markWorkerPaid(workerId, owed);
    if (res.ok) {
      toast({ title: "Merkitty maksetuksi", description: `${fmt(owed)} kirjattu brändin kassaan` });
      loadStats();
    } else {
      toast({ variant: "destructive", title: "Virhe", description: res.error });
    }
    setMarkingPaid(null);
  };

  const handleLogout = () => {
    clearAdminSession();
    clearAdminProfile();
    toast({ title: "Uloskirjautuminen onnistui" });
    navigate("/admin/login");
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Asetukset</h1>
            <p className="text-muted-foreground">Profiili ja hallinta</p>
          </div>
        </div>

        {/* Profile */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Profiili</h2>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {profile?.photoUrl ? (
                <img src={profile.photoUrl} alt={profile.name} className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                  <User className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <div>
                <p className="text-foreground font-medium">{profile?.name || "Ylläpitäjä"}</p>
                <p className="text-sm text-muted-foreground">
                  {profile?.role === "HOST" ? "Perustaja / Host" : "Työntekijä"}
                  {profile?.phone && ` · ${profile.phone}`}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} data-testid="btn-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Ulos
            </Button>
          </div>
        </Card>

        {/* Theme */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Sun className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Näyttö</h2>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground font-medium">Teema</p>
              <p className="text-sm text-muted-foreground">{theme === "light" ? "Vaalea" : "Tumma"}</p>
            </div>
            <Button variant="outline" size="icon" onClick={toggleTheme} data-testid="btn-toggle-theme">
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </Button>
          </div>
        </Card>

        {/* Tax export link */}
        <Link href="/admin/tax-export">
          <Card className="p-5 bg-card border-0 premium-shadow mb-4 cursor-pointer hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Verotuloste</p>
                  <p className="text-sm text-muted-foreground">Keikat verotusta varten · CSV / tulosta</p>
                </div>
              </div>
              <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </div>
          </Card>
        </Link>

        {/* Opas link */}
        <Link href="/admin/guide">
          <Card className="p-5 bg-card border-0 premium-shadow mb-6 cursor-pointer hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Työntekijän opas</p>
                  <p className="text-sm text-muted-foreground">Ohjeet, ehdot ja yhteystiedot</p>
                </div>
              </div>
              <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
            </div>
          </Card>
        </Link>

        {/* HOST only: brand cash + debt reset */}
        {isHost && (
          <>
            {/* Brand cash */}
            {workerStats && (
              <Card className="p-6 bg-card border-0 premium-shadow mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Banknote className="w-5 h-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold text-foreground">Puuhapatet — brändin kassa</h2>
                </div>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
                  {fmt(workerStats.brandCash)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Kertynyt palvelumaksuista — tekijöiden maksamat osuudet yhteensä
                </p>
              </Card>
            )}

            {/* Worker debt reset */}
            <Card className="p-6 bg-card border-0 premium-shadow mb-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold text-foreground">Palvelumaksuvelat</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-5">
                Kun tekijä on maksanut palvelumaksunsa, nollaa velka alla.
                Maksu kirjataan historiaan eikä poistu.
              </p>
              <div className="space-y-4">
                {USERS.map((u) => {
                  const owed = workerStats?.workerFees[u.id] ?? 0;
                  const jobCount = workerStats?.workerJobCount[u.id] ?? 0;
                  const isPaying = markingPaid === u.id;
                  return (
                    <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                      <div className="flex items-center gap-3">
                        {u.photoUrl ? (
                          <img src={u.photoUrl} alt={u.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                            <span className="text-xs font-bold">{u.name[0]}</span>
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-foreground">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{jobCount} valmista keikkaa</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className={cn(
                          "text-base font-bold",
                          owed > 0 ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"
                        )}>
                          {fmt(owed)}
                        </p>
                        <Button
                          size="sm"
                          variant={owed > 0 ? "default" : "outline"}
                          disabled={owed <= 0 || isPaying}
                          onClick={() => handleMarkPaid(u.id)}
                          className="text-xs"
                        >
                          {isPaying ? "…" : "Maksettu"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
