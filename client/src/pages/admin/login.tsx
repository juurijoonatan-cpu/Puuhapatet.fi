/**
 * Admin Login
 *
 * Pick your profile → enter password → server verifies and issues a signed
 * token. Real security boundary: the API rejects every request without a valid
 * token, so hiding the screen is no longer the only thing protecting data.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, ShieldCheck, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { USERS, setAdminProfile, type AdminProfile } from "@/lib/admin-profile";
import { api, getAdminToken, setAdminToken, clearAdminToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const LAST_USER_KEY = "puuhapatet_last_user";

/** Small round avatar — photo if set, otherwise the initial. */
function Avatar({ user, size = 36 }: { user: AdminProfile; size?: number }) {
  return user.photoUrl ? (
    <img src={user.photoUrl} alt="" className="rounded-full object-cover object-top shrink-0" style={{ width: size, height: size }} />
  ) : (
    <div
      className="rounded-full bg-muted flex items-center justify-center font-semibold text-muted-foreground shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {user.name[0]}
    </div>
  );
}

// Reads the (unverified) expiry from our token payload — purely for the UX-level
// "am I still logged in?" check. The server is the real authority on validity.
function tokenExpiry(token: string): number {
  try {
    const body = token.split(".")[0];
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(body.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64));
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

export function isAdminAuthenticated(): boolean {
  const token = getAdminToken();
  if (!token) return false;
  return tokenExpiry(token) > Date.now();
}

export function clearAdminSession(): void {
  clearAdminToken();
}

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [selected, setSelected] = useState<AdminProfile | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Forced password change for a worker who logged in with a starter password.
  const [mode, setMode] = useState<"login" | "setpw">("login");
  const [starterPw, setStarterPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  // Resolve a dashboard-only user's personal worker link and go there.
  const goToDashboard = async () => {
    const r = await api.getMyDashboard();
    if (r.ok && r.data?.token) {
      navigate(`/tyo/${r.data.token}`);
    } else {
      toast({ variant: "destructive", title: "Työpöytää ei löytynyt", description: "Pyydä Joonatania linkittämään tilisi keikkaan." });
      setIsLoading(false);
    }
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (newPw.length < 4) { toast({ variant: "destructive", title: "Liian lyhyt", description: "Salasanan on oltava vähintään 4 merkkiä." }); return; }
    if (newPw !== newPw2) { toast({ variant: "destructive", title: "Salasanat eivät täsmää" }); return; }
    setIsLoading(true);
    const r = await api.setUserPasswordRemote(selected.id, newPw, starterPw);
    if (r.ok) { toast({ title: "Salasana tallennettu" }); await goToDashboard(); }
    else { toast({ variant: "destructive", title: "Salasanan vaihto epäonnistui", description: r.error || "" }); setIsLoading(false); }
  };

  useEffect(() => {
    try {
      const lastId = localStorage.getItem(LAST_USER_KEY);
      if (lastId) {
        const u = USERS.find((x) => x.id === lastId);
        if (u) setSelected(u);
      }
    } catch {}
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setIsLoading(true);

    // Server verifies the password and issues a signed token. Your existing
    // password keeps working — if you changed it earlier, that new one is what
    // you type, and it's migrated to secure storage automatically on this login.
    const res = await api.adminLogin(selected.id, password);

    if (res.ok && res.data?.token) {
      setAdminToken(res.data.token);
      setAdminProfile(selected);
      try { localStorage.setItem(LAST_USER_KEY, selected.id); } catch {}

      // Dashboard-only worker (e.g. Jani): never enters the admin. If they used a
      // starter password, force a change first; then go straight to their dashboard.
      if (selected.dashboardOnly) {
        if (res.data.mustChangePassword) {
          setStarterPw(password);
          setMode("setpw");
          setIsLoading(false);
          return;
        }
        await goToDashboard();
        return;
      }

      toast({
        title: `Hei, ${selected.name.split(" ")[0]}!`,
        description: "Tervetuloa hallintapaneeliin.",
      });
      navigate("/admin/dashboard");
    } else {
      toast({
        variant: "destructive",
        title: "Kirjautuminen epäonnistui",
        description: res.error || "Tarkista salasana ja yritä uudelleen.",
      });
    }

    setIsLoading(false);
  };

  return (
    <div
      className="bg-background flex justify-center overflow-y-auto"
      style={{
        minHeight: "100dvh",
        padding:
          "calc(env(safe-area-inset-top) + 1.5rem) calc(env(safe-area-inset-right) + 1rem) calc(env(safe-area-inset-bottom) + 1.5rem) calc(env(safe-area-inset-left) + 1rem)",
      }}
    >
      <div className="w-full max-w-sm my-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Puuhapatet.</h1>
          <p className="text-muted-foreground">{mode === "setpw" ? "Aseta oma salasanasi" : "Kuka kirjautuu?"}</p>
        </div>

        {/* Set-your-own-password step (worker who logged in with a starter password) */}
        {mode === "setpw" && selected && (
          <Card className="p-5 bg-card border-0 premium-shadow">
            <p className="text-sm text-muted-foreground mb-3 text-center">
              Hei <strong>{selected.name.split(" ")[0]}</strong> — valitse oma salasana, jolla kirjaudut jatkossa. <strong>Älä unohda sitä.</strong>
            </p>
            <form onSubmit={submitNewPassword} className="space-y-3">
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Uusi salasana (väh. 4 merkkiä)" autoComplete="new-password" autoFocus />
              <Input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Uusi salasana uudelleen" autoComplete="new-password" />
              <Button type="submit" className="w-full" disabled={isLoading || !newPw || !newPw2}>
                {isLoading ? "Tallennetaan…" : "Tallenna ja jatka →"}
              </Button>
            </form>
          </Card>
        )}

        {mode === "login" && (<>
        {/* Intro: explain the security upgrade so the team isn't surprised */}
        <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm leading-relaxed text-foreground/80">
              <p className="font-medium text-foreground mb-1">Kirjautuminen päivitetty turvallisemmaksi</p>
              <p>
                Asiakastiedot on nyt suojattu palvelimella. <strong>Kirjaudu samalla salasanalla kuin ennen</strong> —
                jos olet jo vaihtanut oman salasanasi, käytä sitä uutta. Järjestelmä siirtää salasanasi
                suojattuun muotoon automaattisesti, joten mitään ei tarvitse tehdä erikseen.
              </p>
              <p className="mt-1 text-muted-foreground">
                Jos kirjautuminen ei onnistu, ole yhteydessä Joonataniin.
              </p>
            </div>
          </div>
        </div>

        {/* User selector — a clean dropdown that scales as more workers join */}
        <div className="relative mb-6">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors",
              pickerOpen ? "border-primary" : "border-border hover:border-muted-foreground/40",
            )}
            data-testid="btn-open-user-picker"
          >
            {selected ? (
              <>
                <Avatar user={selected} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{selected.name}</span>
                  <span className="block text-xs text-muted-foreground">{selected.role === "HOST" ? "Johtaja" : "Tekijä"}</span>
                </span>
              </>
            ) : (
              <>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
                  <ChevronDown className="h-4 w-4" />
                </div>
                <span className="flex-1 text-sm text-muted-foreground">Valitse profiili…</span>
              </>
            )}
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", pickerOpen && "rotate-180")} />
          </button>

          {pickerOpen && (
            <>
              {/* Click-away backdrop */}
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div
                role="listbox"
                className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-72 overflow-y-auto rounded-2xl border border-border bg-card p-1.5 premium-shadow"
              >
                {(["HOST", "STAFF"] as const).map((role) => {
                  const group = USERS.filter((u) => (role === "HOST" ? u.role === "HOST" : u.role !== "HOST"));
                  if (!group.length) return null;
                  return (
                    <div key={role} className="mb-1 last:mb-0">
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {role === "HOST" ? "Johtajat" : "Tekijät"}
                      </p>
                      {group.map((user) => {
                        const active = selected?.id === user.id;
                        return (
                          <button
                            key={user.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => { setSelected(user); setPassword(""); setPickerOpen(false); }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                              active ? "bg-primary/10" : "hover:bg-muted",
                            )}
                            data-testid={`btn-select-user-${user.id}`}
                          >
                            <Avatar user={user} size={32} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{user.name}</span>
                            {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Password form — shown after selecting a user */}
        {selected && (
          <Card className="p-5 bg-card border-0 premium-shadow">
            <p className="text-sm text-muted-foreground mb-3 text-center">
              Hei <strong>{selected.name.split(" ")[0]}</strong> — syötä salasana
            </p>
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Salasana"
                  className="pr-10"
                  autoFocus
                  data-testid="input-admin-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Piilota" : "Näytä"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !password}
                data-testid="btn-admin-login"
              >
                {isLoading ? "Kirjaudutaan…" : "Kirjaudu"}
              </Button>
            </form>
          </Card>
        )}
        </>)}
      </div>
    </div>
  );
}
