/**
 * Admin Settings Page
 *
 * Sections:
 * 1. Profile
 * 2. Theme (light/dark)
 * 3. Users & Invites (Host/Board only)
 */

import { Link, useLocation } from "wouter";
import { ArrowLeft, LogOut, User, Sun, Moon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clearAdminSession } from "./login";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import { getAdminProfile, clearAdminProfile } from "@/lib/admin-profile";

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const profile = getAdminProfile();

  const handleLogout = () => {
    clearAdminSession();
    clearAdminProfile();
    toast({
      title: "Uloskirjautuminen onnistui",
      description: "Olet kirjautunut ulos.",
    });
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
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
              Asetukset
            </h1>
            <p className="text-muted-foreground">Profiili ja teema</p>
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
              {profile?.photoUrl && (
                <img
                  src={profile.photoUrl}
                  alt={profile.name}
                  className="w-12 h-12 rounded-xl object-cover"
                />
              )}
              <div>
                <p className="text-foreground font-medium">{profile?.name || "Ylläpitäjä"}</p>
                <p className="text-sm text-muted-foreground">
                  {profile?.role || "Kirjautunut"}
                  {profile?.phone && ` • ${profile.phone}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/profile-setup">
                <Button variant="outline" size="sm" data-testid="btn-edit-profile">
                  Muokkaa
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={handleLogout} data-testid="btn-logout">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
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
              <p className="text-sm text-muted-foreground">
                {theme === "light" ? "Vaalea" : "Tumma"}
              </p>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              data-testid="btn-toggle-theme"
            >
              {theme === "light" ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </Button>
          </div>
        </Card>

      </div>
    </div>
  );
}
