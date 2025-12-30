import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, LogOut, Wifi, Package, FileText, Search, List, Check, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearAdminSession } from "./login";
import { useToast } from "@/hooks/use-toast";
import { api, generateJobId, API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TestResult {
  name: string;
  status: "idle" | "loading" | "success" | "error";
  response?: unknown;
  error?: string;
}

export default function AdminSettingsPage() {
  const [, navigate] = useLocation();
  const [testJobId, setTestJobId] = useState("");
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({
    health: { name: "Health Check", status: "idle" },
    packages: { name: "Packages", status: "idle" },
    upsertJob: { name: "Upsert Job (Test)", status: "idle" },
    getJob: { name: "Get Job", status: "idle" },
    listJobs: { name: "List Jobs", status: "idle" },
  });
  const { toast } = useToast();

  const handleLogout = () => {
    clearAdminSession();
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
    <div className="min-h-screen bg-background pt-8 md:pt-24 pb-28">
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
              API-diagnostiikka ja kirjautuminen
            </p>
          </div>
        </div>

        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Käyttäjä</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground font-medium">Ylläpitäjä</p>
              <p className="text-sm text-muted-foreground">Kirjautunut sisään</p>
            </div>
            <Button variant="outline" onClick={handleLogout} data-testid="btn-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Kirjaudu ulos
            </Button>
          </div>
        </Card>

        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">API-diagnostiikka</h2>
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
                      <pre className="text-xs bg-background p-3 rounded-lg overflow-x-auto font-mono">
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
