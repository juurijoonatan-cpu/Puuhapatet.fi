/**
 * Admin Settings Page
 *
 * Sections:
 * 1. Profile
 * 2. Theme (light/dark)
 * 3. Users & Invites (Host/Board only)
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, LogOut, User, Sun, Moon, Users,
  Copy, Plus, Trash2,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clearAdminSession } from "./login";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import {
  getAdminProfile,
  clearAdminProfile,
  getAllProfiles,
  getInviteCodes,
  createInviteCode,
  canManageUsers,
  UserRole,
} from "@/lib/admin-profile";

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const profile = getAdminProfile();
  const allProfiles = getAllProfiles();
  const inviteCodes = getInviteCodes();
  const canManage = profile?.role ? canManageUsers(profile.role) : false;

  const [newInviteRole, setNewInviteRole] = useState<UserRole>("STAFF");

  const handleLogout = () => {
    clearAdminSession();
    clearAdminProfile();
    toast({
      title: "Uloskirjautuminen onnistui",
      description: "Olet kirjautunut ulos.",
    });
    navigate("/admin/login");
  };

  const handleCreateInvite = () => {
    if (!profile) return;
    const invite = createInviteCode(newInviteRole, profile.id);
    toast({
      title: "Kutsukoodi luotu",
      description: `Koodi: ${invite.code}`,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Kopioitu!",
      description: "Koodi kopioitu leikepöydälle.",
    });
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

        {/* Users & Invites */}
        {canManage && (
          <Card className="p-6 bg-card border-0 premium-shadow mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Käyttäjät & Kutsut</h2>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-medium text-foreground mb-3">Luo kutsukoodi</h3>
              <div className="flex gap-2">
                <Select value={newInviteRole} onValueChange={(v) => setNewInviteRole(v as UserRole)}>
                  <SelectTrigger className="w-40" data-testid="select-invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STAFF">Staff</SelectItem>
                    <SelectItem value="BOARD_MEMBER">Board Member</SelectItem>
                    {profile?.role === "HOST" && (
                      <SelectItem value="HOST">Host</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button onClick={handleCreateInvite} data-testid="btn-create-invite">
                  <Plus className="w-4 h-4 mr-2" />
                  Luo koodi
                </Button>
              </div>
            </div>

            {inviteCodes.filter((i) => !i.used).length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-foreground mb-3">Aktiiviset kutsukoodit</h3>
                <div className="space-y-2">
                  {inviteCodes.filter((i) => !i.used).map((invite) => (
                    <div
                      key={invite.code}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <div>
                        <code className="text-sm font-mono">{invite.code}</code>
                        <p className="text-xs text-muted-foreground">{invite.intendedRole}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(invite.code)}
                        data-testid={`btn-copy-${invite.code}`}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {allProfiles.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Käyttäjät</h3>
                <div className="space-y-2">
                  {allProfiles.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        {user.photoUrl && (
                          <img
                            src={user.photoUrl}
                            alt={user.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        )}
                        <div>
                          <p className="text-sm font-medium text-foreground">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.role}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
