import { useState, useEffect } from "react";
import { Loader2, Users, ArrowLeft, ArrowRight, Phone, Mail, MapPin, Search, Save, Trash2, FileText } from "lucide-react";
import { Link, useLocation } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Customer edit state
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.getCustomers().then((res) => {
      if (res.ok && res.data) setCustomers(res.data as Customer[]);
      setLoading(false);
    });
  }, []);

  const handleDeleteCustomer = async () => {
    if (!selected) return;
    setDeleting(true);
    const res = await api.deleteCustomer(selected.id);
    if (res.ok) {
      setCustomers(prev => prev.filter(c => c.id !== selected.id));
      setSelected(null);
      setConfirmDelete(false);
      toast({ title: "Asiakas poistettu", description: "Asiakas ja kaikki keikkatiedot on poistettu." });
    } else {
      toast({ variant: "destructive", title: "Poisto epäonnistui", description: res.error });
    }
    setDeleting(false);
  };

  const openCustomer = async (c: Customer) => {
    setConfirmDelete(false);
    setSelected({ ...c, jobs: undefined });
    setEditName(c.name);
    setEditPhone(c.phone);
    setEditEmail(c.email ?? "");
    setEditAddress(c.address);
    setEditNotes(c.notes ?? "");
    setDetailLoading(true);
    const res = await api.getCustomer(c.id);
    if (res.ok && res.data) {
      const data = res.data as Customer & { jobs: CustomerJob[] };
      setSelected(data);
      setEditName(data.name);
      setEditPhone(data.phone);
      setEditEmail(data.email ?? "");
      setEditAddress(data.address);
      setEditNotes(data.notes ?? "");
    }
    setDetailLoading(false);
  };

  const saveCustomer = async () => {
    if (!selected) return;
    setSavingCustomer(true);
    const res = await api.updateCustomer(selected.id, {
      name: editName.trim() || selected.name,
      phone: editPhone.trim() || selected.phone,
      email: editEmail.trim() || undefined,
      address: editAddress.trim() || selected.address,
      notes: editNotes.trim() || undefined,
    });
    if (res.ok) {
      const updated: Customer = {
        ...selected,
        name: editName.trim() || selected.name,
        phone: editPhone.trim() || selected.phone,
        email: editEmail.trim() || null,
        address: editAddress.trim() || selected.address,
        notes: editNotes.trim() || null,
      };
      setSelected(updated);
      setCustomers((prev) => prev.map((c) => (c.id === selected.id ? updated : c)));
      toast({ title: "Asiakastiedot tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    setSavingCustomer(false);
  };

  const hasCustomerChanges = selected
    ? editName !== selected.name ||
      editPhone !== selected.phone ||
      editEmail !== (selected.email ?? "") ||
      editAddress !== selected.address ||
      editNotes !== (selected.notes ?? "")
    : false;

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
      <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
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
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Nimi</p>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" /> Puhelin
                </p>
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  type="tel"
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> Sähköposti
                </p>
                <Input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  type="email"
                  placeholder="(ei pakollinen)"
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Osoite
                </p>
                <Input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Muistiinpanot</p>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Sisäiset muistiinpanot…"
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>

              {hasCustomerChanges && (
                <Button onClick={saveCustomer} disabled={savingCustomer} className="w-full">
                  {savingCustomer ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Tallenna muutokset
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-6 bg-card border-0 premium-shadow mb-4">
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
          <Card className="p-6 bg-card border-0 premium-shadow mb-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Tarjoukset
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Luo ja lähetä asiakkaalle visuaalinen, ammattimainen tarjous sähköpostilla.
            </p>
            <Button
              className="gap-2 w-full sm:w-auto"
              variant="outline"
              onClick={() => navigate(`/admin/quotes?customerId=${selected.id}`)}
            >
              <FileText className="w-4 h-4" />
              Luo tarjous
            </Button>
          </Card>

          <Card className="p-5 border border-destructive/20 bg-destructive/5">
            <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-3">Vaaravyöhyke</p>
            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-4 h-4" />
                Poista asiakas kokonaan
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-destructive font-medium">
                  Poistetaanko {selected.name} pysyvästi? Kaikki keikkatiedot poistetaan myös. Tätä ei voi perua.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={handleDeleteCustomer}
                    className="gap-2"
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Kyllä, poista pysyvästi
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Peruuta
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
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
