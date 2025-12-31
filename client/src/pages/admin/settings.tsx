/**
 * Admin Settings Page
 * 
 * Sections:
 * 1. Profile
 * 2. Theme (light/dark)
 * 3. Language FI/EN
 * 4. Users & Invites (Host/Board only)
 * 5. API Diagnostics
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  ArrowLeft, LogOut, Wifi, User, Sun, Moon, Globe, Users,
  Check, X, Loader2, ChevronDown, ChevronUp, Copy, Plus, Trash2
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clearAdminSession } from "./login";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import { api, API_BASE } from "@/lib/api";
import {
  getAdminProfile,
  clearAdminProfile,
  getAllProfiles,
  getInviteCodes,
  createInviteCode,
  canManageUsers,
  UserRole,
  AdminProfile,
  InviteCode,
} from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

interface TestResult {
  name: string;
  status: "idle" | "loading" | "success" | "error";
  response?: unknown;
  error?: string;
}

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  
  const profile = getAdminProfile();
  const allProfiles = getAllProfiles();
  const inviteCodes = getInviteCodes();
  const canManage = profile?.role ? canManageUsers(profile.role) : false;

  const [testJobId, setTestJobId] = useState("");
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [newInviteRole, setNewInviteRole] = useState<UserRole>("STAFF");
  const [tests, setTests] = useState<Record<string, TestResult>>({
    health: { name: "Health Check", status: "idle" },
    packages: { name: "Packages", status: "idle" },
    upsertJob: { name: "Upsert Job (Test)", status: "idle" },
    getJob: { name: "Get Job", status: "idle" },
    listJobs: { name: "List Jobs", status: "idle" },
  });

  const handleLogout = () => {
    clearAdminSession();
    clearAdminProfile();
    toast({
      title: "Uloskirjautuminen onnistui",
      description: "Olet kirjautunut ulos.",
    });
    navigate("/admin/login");
  };

  const updateTest = (key: string, update: Partial<TestResult>) => {
    setTests((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...update },
    }));
  };

  const runHealthTest = async () => {
    updateTest("health", { status: "loading" });
    try {
      const result = await api.health();
      updateTest("health", { 
        status: result.ok ? "success" : "error", 
        response: result.data,
        error: result.error,
      });
    } catch (error) {
      updateTest("health", { 
        status: "error", 
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const runPackagesTest = async () => {
    updateTest("packages", { status: "loading" });
    try {
      const result = await api.packages();
      updateTest("packages", { 
        status: result.ok ? "success" : "error", 
        response: result.data,
        error: result.error,
      });
    } catch (error) {
      updateTest("packages", { 
        status: "error", 
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const runUpsertJobTest = async () => {
    updateTest("upsertJob", { status: "loading" });
    try {
      const testId = `PP-TEST-${Date.now().toString(36).toUpperCase()}`;
      const testJob = {
        JobID: testId,
        WorkflowStatus: "DRAFT" as const,
        AssignedTo: "",
        Source: "WEBAPP" as const,
        CustomerName: "Test User",
        CustomerPhone: "000-000-0000",
        CustomerEmail: "test@test.com",
        Address: "Test Address 123",
        PreferredTime: "flexible",
        ServicePackage: "Test Package",
        AdditionalServices: [],
        Notes: "API diagnostics test - can be deleted",
      };
      const result = await api.upsertJob(testJob);
      updateTest("upsertJob", { 
        status: result.ok && result.data?.ok ? "success" : "error", 
        response: { sentJobId: testId, apiResponse: result.data },
        error: result.error || result.data?.error,
      });
    } catch (error) {
      updateTest("upsertJob", { 
        status: "error", 
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const runGetJobTest = async () => {
    if (!testJobId.trim()) {
      toast({
        variant: "destructive",
        title: "Anna tilausnumero",
        description: "Syötä tilausnumero testausta varten.",
      });
      return;
    }
    updateTest("getJob", { status: "loading" });
    try {
      const result = await api.getJob(testJobId.trim());
      updateTest("getJob", { 
        status: result.ok && result.data?.ok ? "success" : "error", 
        response: result.data,
        error: result.error || result.data?.error,
      });
    } catch (error) {
      updateTest("getJob", { 
        status: "error", 
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const runListJobsTest = async () => {
    updateTest("listJobs", { status: "loading" });
    try {
      const result = await api.listJobs();
      updateTest("listJobs", { 
        status: result.ok && result.data?.ok ? "success" : "error", 
        response: result.data,
        error: result.error || result.data?.error || "Endpoint not available",
      });
    } catch (error) {
      updateTest("listJobs", { 
        status: "error", 
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
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

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "loading":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case "success":
        return <Check className="w-4 h-4 text-green-500" />;
      case "error":
        return <X className="w-4 h-4 text-red-500" />;
      default:
        return <div className="w-4 h-4 rounded-full bg-muted" />;
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedTest(expandedTest === key ? null : key);
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
            <p className="text-muted-foreground">
              Profiili, teema ja diagnostiikka
            </p>
          </div>
        </div>

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

            {inviteCodes.filter(i => !i.used).length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-foreground mb-3">Aktiiviset kutsukoodit</h3>
                <div className="space-y-2">
                  {inviteCodes.filter(i => !i.used).map((invite) => (
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

        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">API-diagnostiikka</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Testaa yhteys Google Apps Script -rajapintaan.
          </p>
          
          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg mb-6 font-mono break-all">
            {API_BASE}
          </div>

          <div className="space-y-3">
            {Object.entries(tests).map(([key, test]) => (
              <div key={key} className="border border-border rounded-xl overflow-hidden">
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => test.status !== "idle" && toggleExpand(key)}
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(test.status)}
                    <span className="font-medium text-foreground">{test.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {key === "getJob" && (
                      <Input
                        type="text"
                        value={testJobId}
                        onChange={(e) => setTestJobId(e.target.value)}
                        placeholder="PP-XXXX"
                        className="w-32 text-xs font-mono"
                        onClick={(e) => e.stopPropagation()}
                        data-testid="input-test-job-id"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (key === "health") runHealthTest();
                        if (key === "packages") runPackagesTest();
                        if (key === "upsertJob") runUpsertJobTest();
                        if (key === "getJob") runGetJobTest();
                        if (key === "listJobs") runListJobsTest();
                      }}
                      disabled={test.status === "loading"}
                      data-testid={`btn-test-${key}`}
                    >
                      {test.status === "loading" ? "..." : "Testaa"}
                    </Button>
                    {test.status !== "idle" && (
                      expandedTest === key ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )
                    )}
                  </div>
                </div>
                
                {expandedTest === key && test.status !== "idle" && (
                  <div className="p-4 pt-0 border-t border-border bg-muted/20">
                    {test.error && (
                      <p className="text-sm text-red-500 mb-2">{test.error}</p>
                    )}
                    {test.response && (
                      <pre className="text-xs bg-background p-3 rounded-lg overflow-x-auto font-mono max-h-60 overflow-y-auto">
                        {JSON.stringify(test.response, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 bg-muted/30 border-0">
          <p className="text-xs text-muted-foreground text-center">
            <strong>Huomio:</strong> Admin-kirjautuminen on vain käyttöliittymäportti (client-side). 
            Tuotantokäyttöön suositellaan palvelinpuolen autentikointia.
          </p>
        </Card>
      </div>
    </div>
  );
}
