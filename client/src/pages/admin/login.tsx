/**
 * Admin Login Page
 * 
 * IMPORTANT SECURITY NOTICE:
 * This is a CLIENT-SIDE UI gate only, NOT a security boundary.
 * The password is stored in VITE_ADMIN_PASSWORD which is bundled into the client JS.
 * Anyone can view the password in browser dev tools.
 * 
 * This is intentional for MVP - it prevents accidental access, not malicious access.
 * For production security, implement proper server-side authentication.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "admin123";
const SESSION_KEY = "puuhapatet_admin_session";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

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
  const session = {
    authenticated: true,
    expiry: Date.now() + SESSION_DURATION_MS,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearAdminSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    await new Promise((r) => setTimeout(r, 300));

    if (password === ADMIN_PASSWORD) {
      setAdminSession();
      toast({
        title: "Kirjautuminen onnistui",
        description: "Tervetuloa hallintapaneeliin.",
      });
      navigate("/admin/dashboard");
    } else {
      toast({
        variant: "destructive",
        title: "Virheellinen salasana",
        description: "Tarkista salasana ja yritä uudelleen.",
      });
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">
            Ylläpito
          </h1>
          <p className="text-muted-foreground">
            Kirjaudu hallintapaneeliin
          </p>
        </div>

        <Card className="p-6 bg-card border-0 premium-shadow">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="password">Salasana</Label>
              <div className="relative mt-2">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Syötä salasana"
                  className="pr-10"
                  data-testid="input-admin-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Piilota salasana" : "Näytä salasana"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading || !password}
              data-testid="btn-admin-login"
            >
              {isLoading ? "Kirjaudutaan..." : "Kirjaudu"}
            </Button>
          </form>
        </Card>

        <div className="mt-6 p-4 bg-muted/50 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>Huomio:</strong> Tämä on kevyt käyttöliittymäportti, ei turvallisuusrajapinta. 
              Tuotantokäyttöön suositellaan palvelinpuolen autentikointia.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
