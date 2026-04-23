/**
 * Admin Settings Page
 */

import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, LogOut, User, Sun, Moon, Banknote, CheckCircle, BookOpen, FileSpreadsheet, ShoppingCart, KeyRound, Eye, EyeOff, Sparkles, Plus, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearAdminSession, getEffectivePassword, setUserPassword } from "./login";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import { getAdminProfile, clearAdminProfile, USERS } from "@/lib/admin-profile";
import { api, WorkerStatsResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

interface BonusUsage {
  id: number;
  userId: string;
  amount: number;
  description: string;
  category: string;
  usedAt: string;
  investmentId: number | null;
}

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";

  const [workerStats, setWorkerStats] = useState<WorkerStatsResponse | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  // Password change state
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwds, setShowPwds] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  // Startup bonus state
  const [bonusUsages, setBonusUsages] = useState<BonusUsage[]>([]);
  const [bonusDesc, setBonusDesc] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusCategory, setBonusCategory] = useState("muu");
  const [addingBonus, setAddingBonus] = useState(false);
  const [showBonusForm, setShowBonusForm] = useState(false);

  const loadStats = () => {
    if (isHost) {
      api.workersStats().then((res) => {
        if (res.ok && res.data) setWorkerStats(res.data);
      });
    }
  };

  const loadBonusUsages = () => {
    if (profile?.startupBonus && profile.startupBonus > 0) {
      api.getStartupBonusUsages(profile.id).then((res) => {
        if (res.ok && res.data) setBonusUsages(res.data as BonusUsage[]);
      });
    }
  };

  useEffect(() => { loadStats(); loadBonusUsages(); }, []);

  const fmt = (cents: number) =>
    Math.round(cents / 100).toLocaleString("fi-FI") + " €";

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

  const handleChangePassword = async () => {
    if (!profile) return;
    if (!currentPwd || !newPwd || !confirmPwd) {
      toast({ variant: "destructive", title: "Täytä kaikki kentät" });
      return;
    }
    // Check current password: backend first, then localStorage/default
    const pwRes = await api.getUserPassword(profile.id);
    const activePwd = (pwRes.ok && pwRes.data?.password) ? pwRes.data.password : getEffectivePassword(profile.id);
    if (currentPwd !== activePwd) {
      toast({ variant: "destructive", title: "Nykyinen salasana on väärin" });
      return;
    }
    if (newPwd.length < 4) {
      toast({ variant: "destructive", title: "Uusi salasana on liian lyhyt (min 4 merkkiä)" });
      return;
    }
    if (newPwd !== confirmPwd) {
      toast({ variant: "destructive", title: "Salasanat eivät täsmää" });
      return;
    }
    setSavingPwd(true);
    // Save to backend (cross-device) and localStorage (offline fallback)
    const saveRes = await api.setUserPasswordRemote(profile.id, newPwd);
    setUserPassword(profile.id, newPwd);
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
    setSavingPwd(false);
    if (saveRes.ok) {
      toast({ title: "Salasana vaihdettu", description: "Toimii nyt kaikilla laitteilla." });
    } else {
      toast({ title: "Salasana vaihdettu", description: "Tallennettu tälle laitteelle (verkkovirhe)." });
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    clearAdminProfile();
    toast({ title: "Uloskirjautuminen onnistui" });
    navigate("/admin/login");
  };

  const bonusUsed = bonusUsages.reduce((s, u) => s + u.amount, 0);
  const bonusTotal = profile?.startupBonus ?? 0;
  const bonusRemaining = Math.max(0, bonusTotal - bonusUsed);
  const bonusFullyUsed = bonusUsed >= bonusTotal && bonusTotal > 0;

  const handleAddBonusUsage = async () => {
    if (!bonusDesc.trim() || !bonusAmount || !profile) return;
    const amountCents = Math.round(parseFloat(bonusAmount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) return;
    setAddingBonus(true);
    const res = await api.addStartupBonusUsage({
      userId: profile.id,
      amount: amountCents,
      description: bonusDesc.trim(),
      category: bonusCategory,
    });
    if (res.ok) {
      toast({ title: "Käyttö kirjattu" });
      setBonusDesc(""); setBonusAmount(""); setShowBonusForm(false);
      loadBonusUsages();
    } else {
      toast({ variant: "destructive", title: "Virhe", description: res.error });
    }
    setAddingBonus(false);
  };

  const handleDeleteBonusUsage = async (id: number) => {
    const res = await api.deleteStartupBonusUsage(id);
    if (res.ok) {
      setBonusUsages(prev => prev.filter(u => u.id !== id));
      toast({ title: "Poistettu" });
    } else {
      toast({ variant: "destructive", title: res.error ?? "Virhe" });
    }
  };

  const fmtFull = (cents: number) =>
    (cents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });

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
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {profile?.hasYTunnus && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium">
                      Y-tunnus
                    </span>
                  )}
                  {profile?.isUnder18 !== undefined && (
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      profile.isUnder18
                        ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                        : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    )}>
                      {profile.isUnder18 ? "Alle 18v" : "Yli 18v"}
                    </span>
                  )}
                  {profile?.startupBonus != null && profile.startupBonus > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 font-medium">
                      Aloitusbonus {(profile.startupBonus / 100).toFixed(0)} €
                    </span>
                  )}
                </div>
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

        {/* Password change */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Vaihda salasana</h2>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Input
                type={showPwds ? "text" : "password"}
                placeholder="Nykyinen salasana"
                value={currentPwd}
                onChange={e => setCurrentPwd(e.target.value)}
                className="pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPwds(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPwds ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Input
              type={showPwds ? "text" : "password"}
              placeholder="Uusi salasana (min 4 merkkiä)"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              className="text-sm"
            />
            <Input
              type={showPwds ? "text" : "password"}
              placeholder="Uusi salasana uudelleen"
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              className="text-sm"
              onKeyDown={e => e.key === "Enter" && handleChangePassword()}
            />
            <Button
              onClick={handleChangePassword}
              disabled={savingPwd || !currentPwd || !newPwd || !confirmPwd}
              className="w-full"
              variant="outline"
            >
              Tallenna uusi salasana
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Salasana tallennetaan pysyvästi — toimii kaikilla laitteilla.
          </p>
        </Card>

        {/* Startup bonus tracker — only shown when profile has a bonus and it's not fully used */}
        {bonusTotal > 0 && !bonusFullyUsed && (
          <Card className="p-6 bg-card border-0 premium-shadow mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-yellow-500" />
              <h2 className="text-lg font-semibold text-foreground">Aloitustuki — {fmtFull(bonusTotal)}</h2>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>Käytetty: {fmtFull(bonusUsed)}</span>
                <span>Jäljellä: <strong className="text-yellow-600 dark:text-yellow-400">{fmtFull(bonusRemaining)}</strong></span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-400 dark:bg-yellow-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (bonusUsed / bonusTotal) * 100)}%` }}
                />
              </div>
            </div>

            {/* Usage list */}
            {bonusUsages.length > 0 && (
              <div className="space-y-2 mb-4">
                {bonusUsages.map(u => (
                  <div key={u.id} className="flex items-center justify-between text-sm p-2.5 rounded-lg bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{u.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(u.usedAt).toLocaleDateString("fi-FI")}
                        {u.investmentId && " · investoinnin kautta"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="font-semibold text-yellow-700 dark:text-yellow-300">{fmtFull(u.amount)}</span>
                      {!u.investmentId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBonusUsage(u.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add manual usage */}
            {!showBonusForm ? (
              <Button variant="outline" size="sm" onClick={() => setShowBonusForm(true)} className="w-full">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Kirjaa manuaalinen käyttö
              </Button>
            ) : (
              <div className="space-y-2 border-t pt-4">
                <Input
                  placeholder="Kuvaus (mihin käytit)"
                  value={bonusDesc}
                  onChange={e => setBonusDesc(e.target.value)}
                  className="text-sm"
                />
                <Input
                  type="number"
                  placeholder="Summa (€)"
                  value={bonusAmount}
                  onChange={e => setBonusAmount(e.target.value)}
                  className="text-sm"
                  min="0"
                  step="0.01"
                />
                <div className="flex gap-2">
                  {["välineet", "kuljetukset", "muu"].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setBonusCategory(cat)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all capitalize",
                        bonusCategory === cat
                          ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowBonusForm(false)} className="flex-1">
                    Peruuta
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddBonusUsage}
                    disabled={addingBonus || !bonusDesc.trim() || !bonusAmount}
                    className="flex-1"
                  >
                    Tallenna
                  </Button>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-3">
              Investoinnin kautta lisätyt käytöt merkitään automaattisesti. Kun 300 € on kokonaan käytetty, tämä osio häviää — käyttöhistoria näkyy silti verotustulosteessa.
            </p>
          </Card>
        )}

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

        {/* Investoinnit link */}
        <Link href="/admin/investments">
          <Card className="p-5 bg-card border-0 premium-shadow mb-4 cursor-pointer hover:opacity-95 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Investoinnit & Välineet</p>
                  <p className="text-sm text-muted-foreground">Hankinnat ja jaetut kulut</p>
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
                  <p className="font-semibold text-foreground">Opas & ohjeet</p>
                  <p className="text-sm text-muted-foreground">Paneeli, verot, ehdot, yhteystiedot</p>
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
