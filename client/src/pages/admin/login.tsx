/**
 * Admin Login
 *
 * Pick your profile → enter shared password → logged in.
 * Client-side gate only — not a security boundary.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { USERS, setAdminProfile, type AdminProfile } from "@/lib/admin-profile";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "admin123";
const SESSION_KEY = "puuhapatet_admin_session";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const CUSTOM_PASSWORDS_KEY = "puuhapatet_custom_passwords";
const LAST_USER_KEY = "puuhapatet_last_user";

/** Returns the effective password for a user (custom or default) */
export function getEffectivePassword(userId: string): string {
  try {
    const stored = localStorage.getItem(CUSTOM_PASSWORDS_KEY);
    if (stored) {
      const passwords = JSON.parse(stored) as Record<string, string>;
      if (passwords[userId]) return passwords[userId];
    }
  } catch {}
  return ADMIN_PASSWORD;
}

/** Saves a new custom password for a user */
export function setUserPassword(userId: string, newPassword: string): void {
  try {
    const stored = localStorage.getItem(CUSTOM_PASSWORDS_KEY);
    const passwords = stored ? (JSON.parse(stored) as Record<string, string>) : {};
    passwords[userId] = newPassword;
    localStorage.setItem(CUSTOM_PASSWORDS_KEY, JSON.stringify(passwords));
  } catch {}
}

export function isAdminAuthenticated(): boolean {
  try {
    const session = localStorage.getItem(SESSION_KEY);
    if (!session) return false;
    const { expiry } = JSON.parse(session);
    return Date.now() < expiry;
  } catch {
    return false;
  }
}

export function setAdminSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ authenticated: true, expiry: Date.now() + SESSION_DURATION_MS }),
  );
}

export function clearAdminSession(): void {
  localStorage.removeItem(SESSION_KEY);
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

    // Fetch password from backend (cross-device), fall back to localStorage/default
    const pwRes = await api.getUserPassword(selected.id);
    const effectivePwd = (pwRes.ok && pwRes.data?.password) ? pwRes.data.password : getEffectivePassword(selected.id);

    if (password === effectivePwd) {
      setAdminSession();
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
        title: "Virheellinen salasana",
        description: "Yritä uudelleen.",
      });
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Puuhapatet</h1>
          <p className="text-muted-foreground">Kuka kirjautuu?</p>
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
