import { useState, useEffect } from "react";
import { Loader2, Users, ArrowLeft, ArrowRight, Phone, Mail, MapPin, Search } from "lucide-react";
import { Link } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface CustomerJob {
  id: number;
  description: string;
  agreedPrice: number;
  status: DbStatus;
  createdAt: string;
}

interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  notes: string | null;
  createdAt: string;
  jobs?: CustomerJob[];
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.getCustomers().then((res) => {
      if (res.ok && res.data) setCustomers(res.data as Customer[]);
      setLoading(false);
    });
  }, []);

  const openCustomer = async (c: Customer) => {
    setSelected({ ...c, jobs: undefined });
    setDetailLoading(true);
    const res = await api.getCustomer(c.id);
    if (res.ok && res.data) {
      const data = res.data as Customer & { jobs: CustomerJob[] };
      setSelected(data);
    }
    setDetailLoading(false);
  };

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q) ||
      c.phone.includes(q)
    );
  });

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="min-h-screen bg-background pt-8 md:pt-24 pb-28">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="ghost" size="icon" onClick={() => setSelected(null)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{selected.name}</h1>
              <p className="text-muted-foreground text-sm">{selected.address}</p>
            </div>
          </div>

          <Card className="p-6 bg-card border-0 premium-shadow mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Yhteystiedot
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                <a href={`tel:${selected.phone}`} className="text-foreground hover:text-primary">
                  {selected.phone}
                </a>
              </div>
              {selected.email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`mailto:${selected.email}`} className="text-foreground hover:text-primary">
                    {selected.email}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-foreground">{selected.address}</span>
              </div>
            </div>
            {selected.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Muistiinpanot</p>
                <p className="text-sm text-foreground">{selected.notes}</p>
              </div>
            )}
          </Card>

          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Keikkahistoria
            </h2>
            {detailLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !selected.jobs || selected.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ei keikatietoja.</p>
            ) : (
              <div className="space-y-3">
                {selected.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {job.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(job.createdAt).toLocaleDateString("fi-FI")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <Badge className={cn("text-xs", statusColors[job.status])}>
                        {statusLabels[job.status]}
                      </Badge>
                      <span className="text-sm font-semibold text-foreground">
                        {(job.agreedPrice / 100).toLocaleString("fi-FI", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pt-8 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Asiakkaat</h1>
            <p className="text-muted-foreground">
              {loading ? "Ladataan…" : `${customers.length} asiakasta`}
            </p>
          </div>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Hae nimellä, osoitteella tai puhelimella…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <EmptyState
            icon={Users}
            title={search ? "Ei hakutuloksia" : "Ei asiakkaita"}
            description={
              search
                ? `Ei löytynyt hakusanalla "${search}".`
                : "Asiakkaita ei vielä ole. Luo ensimmäinen keikka."
            }
          />
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((c) => (
              <Card
                key={c.id}
                className="p-4 bg-card border-0 premium-shadow cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => openCustomer(c)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{c.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{c.address}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.phone}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground ml-4 shrink-0" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
