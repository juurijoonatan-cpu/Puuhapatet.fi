import { useState, useEffect } from "react";
import { Loader2, ClipboardList, ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type DbStatus = "lead" | "scheduled" | "in_progress" | "done" | "cancelled";

const statusLabels: Record<DbStatus, string> = {
  lead: "Liidi",
  scheduled: "Ajoitettu",
  in_progress: "Käynnissä",
  done: "Valmis",
  cancelled: "Peruutettu",
};

const statusColors: Record<DbStatus, string> = {
  lead: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  scheduled: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  in_progress: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

interface JobRow {
  job: {
    id: number;
    status: DbStatus;
    description: string;
    agreedPrice: number;
    assignedTo: string | null;
    notes: string | null;
    scheduledAt: string | null;
    createdAt: string;
  };
  customer: {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    address: string;
  } | null;
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobRow | null>(null);

  useEffect(() => {
    api.getJobs().then((res) => {
      if (res.ok && res.data) setJobs(res.data as JobRow[]);
      setLoading(false);
    });
  }, []);

  if (selected) {
    const { job, customer } = selected;
    return (
      <div className="min-h-screen bg-background pt-8 md:pt-24 pb-28">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Keikka #{job.id}</h1>
              <p className="text-muted-foreground">{customer?.name}</p>
            </div>
          </div>

          <Card className="p-6 bg-card border-0 premium-shadow">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Hinta</p>
                <p className="text-xl font-semibold text-primary">
                  {(job.agreedPrice / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                </p>
              </div>
              <Badge className={cn("text-xs", statusColors[job.status])}>
                {statusLabels[job.status]}
              </Badge>
            </div>

            <div className="space-y-4">
              {customer && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Asiakas</p>
                    <p className="text-foreground font-medium">{customer.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Puhelin</p>
                    <p className="text-foreground">{customer.phone}</p>
                  </div>
                  {customer.email && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Sähköposti</p>
                      <p className="text-foreground">{customer.email}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Osoite</p>
                    <p className="text-foreground">{customer.address}</p>
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm text-muted-foreground mb-1">Kuvaus</p>
                <p className="text-foreground">{job.description}</p>
              </div>

              {job.scheduledAt && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Ajankohta</p>
                  <p className="text-foreground">
                    {new Date(job.scheduledAt).toLocaleString("fi-FI")}
                  </p>
                </div>
              )}

              {job.notes && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Sisäiset muistiinpanot</p>
                  <p className="text-foreground">{job.notes}</p>
                </div>
              )}

              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Vastuuhenkilö: {job.assignedTo || "Ei määritetty"} ·
                  Luotu: {new Date(job.createdAt).toLocaleDateString("fi-FI")}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

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
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Keikat</h1>
            <p className="text-muted-foreground">Kaikki kirjatut keikat</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title="Ei keikkoja"
            description="Ei vielä yhtään kirjattua keikkaa. Luo ensimmäinen uusi keikka."
          />
        )}

        {!loading && jobs.length > 0 && (
          <div className="space-y-3">
            {jobs.map((row) => (
              <Card
                key={row.job.id}
                className="p-4 bg-card border-0 premium-shadow cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setSelected(row)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-foreground truncate">
                        {row.customer?.name || "Tuntematon asiakas"}
                      </p>
                      <Badge className={cn("text-xs shrink-0", statusColors[row.job.status])}>
                        {statusLabels[row.job.status]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{row.job.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {row.customer?.address} · {new Date(row.job.createdAt).toLocaleDateString("fi-FI")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <p className="text-sm font-semibold text-foreground">
                      {(row.job.agreedPrice / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                    </p>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
