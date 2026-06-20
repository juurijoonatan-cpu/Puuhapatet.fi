/**
 * Admin Login
 *
 * Pick your profile → enter password → server verifies and issues a signed
 * token. Real security boundary: the API rejects every request without a valid
 * token, so hiding the screen is no longer the only thing protecting data.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { USERS, setAdminProfile, type AdminProfile } from "@/lib/admin-profile";
import { api, getAdminToken, setAdminToken, clearAdminToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const LAST_USER_KEY = "puuhapatet_last_user";

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
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Puuhapatet.</h1>
          <p className="text-muted-foreground">Kuka kirjautuu?</p>
        </div>

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

        {/* User selector */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {USERS.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => { setSelected(user); setPassword(""); }}
              className={cn(
                "flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all",
                selected?.id === user.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-muted-foreground/40",
              )}
              data-testid={`btn-select-user-${user.id}`}
            >
              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.name}
                  className="w-16 h-16 rounded-xl object-cover object-top"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center text-2xl font-semibold text-muted-foreground">
                  {user.name[0]}
                </div>
              )}
              <span className="text-sm font-medium text-foreground leading-tight text-center">
                {user.name.split(" ")[0]}
              </span>
            </button>
          ))}
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
      </div>
    </div>
  );
}
