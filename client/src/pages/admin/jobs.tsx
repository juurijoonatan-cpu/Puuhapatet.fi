import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, ClipboardList, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { type Job, type WorkflowStatus } from "@shared/schema";
import { cn } from "@/lib/utils";

const statusLabels: Record<WorkflowStatus, string> = {
  DRAFT: "Luonnos",
  NEW: "Uusi",
  SCHEDULED: "Ajoitettu",
  IN_PROGRESS: "Käynnissä",
  DONE: "Valmis",
  CANCELLED: "Peruutettu",
};

const statusColors: Record<WorkflowStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  NEW: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  SCHEDULED: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  IN_PROGRESS: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

export default function AdminJobsPage() {
  const [searchJobId, setSearchJobId] = useState("");
  const [foundJob, setFoundJob] = useState<Job | null>(null);
  const { toast } = useToast();

  const searchMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const result = await api.getJob(jobId);
      if (!result.ok) {
        throw new Error(result.error || "Haku epäonnistui");
      }
      if (!result.data?.ok || !result.data?.job) {
        throw new Error(result.data?.error || "Tilausta ei löytynyt");
      }
      return result.data.job as Job;
    },
    onSuccess: (job) => {
      setFoundJob(job);
    },
    onError: (error) => {
      setFoundJob(null);
      toast({
        variant: "destructive",
        title: "Hakuvirhe",
        description: error instanceof Error ? error.message : "Tilausta ei löytynyt",
      });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchJobId.trim()) {
      searchMutation.mutate(searchJobId.trim());
    }
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
              Tilaukset
            </h1>
            <p className="text-muted-foreground">
              Hae tilauksia tilausnumerolla
            </p>
          </div>
        </div>

        <Card className="p-6 bg-card border-0 premium-shadow mb-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <Label htmlFor="jobId">Tilausnumero</Label>
              <div className="flex gap-3 mt-2">
                <Input
                  id="jobId"
                  type="text"
                  value={searchJobId}
                  onChange={(e) => setSearchJobId(e.target.value)}
                  placeholder="PP-XXXXXXXX-XXXX"
                  className="flex-1 font-mono"
                  data-testid="input-search-job-id"
                />
                <Button 
                  type="submit" 
                  disabled={searchMutation.isPending || !searchJobId.trim()}
                  data-testid="btn-search-job"
                >
                  {searchMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  <span className="ml-2 hidden sm:inline">Hae</span>
                </Button>
              </div>
            </div>
          </form>
        </Card>

        {!foundJob && !searchMutation.isPending && (
          <EmptyState
            icon={ClipboardList}
            title="Hae tilaus"
            description="Syötä tilausnumero (esim. PP-XXXXXXXX-XXXX) hakeaksesi tilauksen tiedot."
          />
        )}

        {foundJob && (
          <Card className="p-6 bg-card border-0 premium-shadow" data-testid="job-details-card">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Tilausnumero</p>
                <p className="text-xl font-semibold text-primary font-mono">
                  {foundJob.JobID}
                </p>
              </div>
              <Badge className={cn("text-xs", statusColors[foundJob.WorkflowStatus])}>
                {statusLabels[foundJob.WorkflowStatus]}
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Asiakas</p>
                  <p className="text-foreground font-medium">{foundJob.CustomerName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Puhelin</p>
                  <p className="text-foreground">{foundJob.CustomerPhone}</p>
                </div>
                {foundJob.CustomerEmail && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Sähköposti</p>
                    <p className="text-foreground">{foundJob.CustomerEmail}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Palvelu</p>
                  <p className="text-foreground">{foundJob.ServicePackage}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-1">Osoite</p>
                <p className="text-foreground">{foundJob.Address}</p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-1">Toivottu ajankohta</p>
                <p className="text-foreground">{foundJob.PreferredTime}</p>
              </div>

              {foundJob.Notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Lisätiedot</p>
                  <p className="text-foreground">{foundJob.Notes}</p>
                </div>
              )}

              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Lähde: {foundJob.Source} | 
                  Vastuuhenkilö: {foundJob.AssignedTo || "Ei määritetty"}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
