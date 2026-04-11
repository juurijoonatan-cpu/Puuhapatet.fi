import { useState, useEffect } from "react";
import { Loader2, ClipboardList, ArrowLeft, ArrowRight, Phone, Mail, MapPin, Check, CalendarClock, Save, Plus, Trash2, Receipt } from "lucide-react";
import { Link } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type DbStatus = "lead" | "scheduled" | "in_progress" | "done" | "cancelled";

const STATUS_FLOW: { key: DbStatus; label: string; color: string; bg: string }[] = [
  { key: "lead",        label: "Liidi",      color: "text-blue-700 dark:text-blue-300",   bg: "bg-blue-100 dark:bg-blue-900/50" },
  { key: "scheduled",   label: "Ajoitettu",  color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-900/50" },
  { key: "in_progress", label: "Käynnissä",  color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-900/50" },
  { key: "done",        label: "Valmis",     color: "text-green-700 dark:text-green-300",  bg: "bg-green-100 dark:bg-green-900/50" },
  { key: "cancelled",   label: "Peruutettu", color: "text-red-700 dark:text-red-300",     bg: "bg-red-100 dark:bg-red-900/50" },
];

function statusMeta(s: DbStatus) {
  return STATUS_FLOW.find((x) => x.key === s) ?? STATUS_FLOW[0];
}

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
  const { toast } = useToast();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobRow | null>(null);
  const [updating, setUpdating] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingFields, setSavingFields] = useState(false);

  interface Expense { id: number; description: string; amount: number; }
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [newExpenseDesc, setNewExpenseDesc] = useState("");
  const [newExpenseAmount, setNewExpenseAmount] = useState("");
  const [addingExpense, setAddingExpense] = useState(false);

  const loadJobs = () => {
    setLoading(true);
    api.getJobs().then((res) => {
      if (res.ok && res.data) setJobs(res.data as JobRow[]);
      setLoading(false);
    });
  };

  useEffect(() => { loadJobs(); }, []);

  // Populate edit fields + load expenses whenever a job is selected
  useEffect(() => {
    if (selected) {
      setEditPrice(String(selected.job.agreedPrice / 100));
      setEditDescription(selected.job.description);
      setEditNotes(selected.job.notes ?? "");
      setExpenses([]);
      setNewExpenseDesc("");
      setNewExpenseAmount("");
      setExpensesLoading(true);
      api.getExpenses(selected.job.id).then((res) => {
        if (res.ok && res.data) setExpenses(res.data as Expense[]);
        setExpensesLoading(false);
      });
    }
  }, [selected?.job.id]);

  const updateStatus = async (newStatus: DbStatus) => {
    if (!selected || selected.job.status === newStatus) return;
    setUpdating(true);
    const res = await api.updateJob(selected.job.id, { status: newStatus });
    if (res.ok) {
      const updated: JobRow = {
        ...selected,
        job: { ...selected.job, status: newStatus },
      };
      setSelected(updated);
      setJobs((prev) =>
        prev.map((r) => (r.job.id === selected.job.id ? updated : r)),
      );
      toast({ title: "Status päivitetty", description: STATUS_FLOW.find(s => s.key === newStatus)?.label });
    } else {
      toast({ variant: "destructive", title: "Päivitys epäonnistui", description: res.error });
    }
    setUpdating(false);
  };

  const updateScheduledAt = async (value: string) => {
    if (!selected) return;
    setSavingDate(true);
    const scheduledAt = value ? new Date(value).toISOString() : null;
    const res = await api.updateJob(selected.job.id, { scheduledAt: scheduledAt ?? undefined });
    if (res.ok) {
      const updated: JobRow = {
        ...selected,
        job: { ...selected.job, scheduledAt },
      };
      setSelected(updated);
      setJobs((prev) => prev.map((r) => (r.job.id === selected.job.id ? updated : r)));
      toast({ title: "Ajankohta tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    setSavingDate(false);
  };

  const saveFields = async () => {
    if (!selected) return;
    setSavingFields(true);
    const agreedPrice = Math.round(parseFloat(editPrice) * 100);
    if (isNaN(agreedPrice) || agreedPrice < 0) {
      toast({ variant: "destructive", title: "Virheellinen hinta" });
      setSavingFields(false);
      return;
    }
    const res = await api.updateJob(selected.job.id, {
      agreedPrice,
      description: editDescription.trim() || selected.job.description,
      notes: editNotes.trim() || undefined,
    });
    if (res.ok) {
      const updated: JobRow = {
        ...selected,
        job: {
          ...selected.job,
          agreedPrice,
          description: editDescription.trim() || selected.job.description,
          notes: editNotes.trim() || null,
        },
      };
      setSelected(updated);
      setJobs((prev) => prev.map((r) => (r.job.id === selected.job.id ? updated : r)));
      toast({ title: "Tiedot tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    setSavingFields(false);
  };

  const addExpense = async () => {
    if (!selected || !newExpenseDesc.trim() || !newExpenseAmount) return;
    const amount = Math.round(parseFloat(newExpenseAmount) * 100);
    if (isNaN(amount) || amount <= 0) return;
    setAddingExpense(true);
    const res = await api.addExpense(selected.job.id, {
      description: newExpenseDesc.trim(),
      amount,
    });
    if (res.ok && res.data) {
      setExpenses((prev) => [...prev, res.data as Expense]);
      setNewExpenseDesc("");
      setNewExpenseAmount("");
    } else {
      toast({ variant: "destructive", title: "Kulun lisäys epäonnistui" });
    }
    setAddingExpense(false);
  };

  const removeExpense = async (expenseId: number) => {
    const res = await api.deleteExpense(expenseId);
    if (res.ok) {
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
    } else {
      toast({ variant: "destructive", title: "Poisto epäonnistui" });
    }
  };

  const hasFieldChanges = selected
    ? editPrice !== String(selected.job.agreedPrice / 100) ||
      editDescription !== selected.job.description ||
      editNotes !== (selected.job.notes ?? "")
    : false;

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selected) {
    const { job, customer } = selected;
    const meta = statusMeta(job.status);

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

          {/* Status stepper */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Status
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUS_FLOW.map((s) => {
                const isCurrent = job.status === s.key;
                return (
                  <button
                    key={s.key}
                    disabled={updating}
                    onClick={() => updateStatus(s.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border-2",
                      isCurrent
                        ? `${s.bg} ${s.color} border-current`
                        : "bg-muted/40 text-muted-foreground border-transparent hover:border-muted-foreground/30",
                      updating && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {isCurrent && <Check className="w-3.5 h-3.5" />}
                    {s.label}
                  </button>
                );
              })}
            </div>
            {updating && (
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Tallennetaan…
              </div>
            )}
          </Card>

          {/* Schedule card */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Ajankohta
              </p>
              {savingDate && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
            </div>
            <input
              type="datetime-local"
              defaultValue={
                job.scheduledAt
                  ? new Date(job.scheduledAt).toISOString().slice(0, 16)
                  : ""
              }
              onChange={(e) => updateScheduledAt(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Card>

          {/* Info card */}
          <Card className="p-6 bg-card border-0 premium-shadow mb-4">
            {/* Customer info — read-only */}
            {customer && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Asiakas</p>
                  <p className="text-foreground font-medium">{customer.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`tel:${customer.phone}`} className="text-foreground hover:text-primary">
                    {customer.phone}
                  </a>
                </div>
                {customer.email && (
                  <div className="flex items-center gap-2 col-span-full">
                    <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                    <a href={`mailto:${customer.email}`} className="text-foreground hover:text-primary text-sm">
                      {customer.email}
                    </a>
                  </div>
                )}
                <div className="flex items-center gap-2 col-span-full">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground text-sm">{customer.address}</span>
                </div>
              </div>
            )}

            <div className="border-t border-border mb-5" />

            {/* Editable fields */}
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Sovittu hinta (€)</p>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className="text-lg font-semibold text-primary"
                />
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Kuvaus</p>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                  className="text-sm resize-none"
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

              {hasFieldChanges && (
                <Button
                  onClick={saveFields}
                  disabled={savingFields}
                  className="w-full"
                >
                  {savingFields ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Tallenna muutokset
                </Button>
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Vastuuhenkilö: {job.assignedTo || "Ei määritetty"} ·
                Luotu: {new Date(job.createdAt).toLocaleDateString("fi-FI")}
              </p>
            </div>
          </Card>
          {/* Expenses card */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Receipt className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Kulut
              </p>
              {expenses.length > 0 && (
                <span className="ml-auto text-xs font-semibold text-foreground">
                  {(expenses.reduce((s, e) => s + e.amount, 0) / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                </span>
              )}
            </div>

            {expensesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {expenses.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {expenses.map((e) => (
                      <div key={e.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                        <span className="text-sm text-foreground">{e.description}</span>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-sm font-medium">
                            {(e.amount / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                          </span>
                          <button
                            onClick={() => removeExpense(e.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label="Poista"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    placeholder="Kuvaus"
                    value={newExpenseDesc}
                    onChange={(e) => setNewExpenseDesc(e.target.value)}
                    className="text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addExpense()}
                  />
                  <Input
                    type="number"
                    placeholder="€"
                    value={newExpenseAmount}
                    onChange={(e) => setNewExpenseAmount(e.target.value)}
                    className="text-sm w-20"
                    onKeyDown={(e) => e.key === "Enter" && addExpense()}
                  />
                  <Button
                    size="icon"
                    onClick={addExpense}
                    disabled={addingExpense || !newExpenseDesc.trim() || !newExpenseAmount}
                  >
                    {addingExpense ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </Button>
                </div>
              </>
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
            <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Keikat</h1>
            <p className="text-muted-foreground">
              {loading ? "Ladataan…" : `${jobs.length} keikkaa`}
            </p>
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
            {jobs.map((row) => {
              const meta = statusMeta(row.job.status);
              return (
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
                        <Badge className={cn("text-xs shrink-0", meta.bg, meta.color)}>
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{row.job.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.customer?.address} · {new Date(row.job.createdAt).toLocaleDateString("fi-FI")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4 shrink-0">
                      <p className="text-sm font-semibold text-foreground">
                        {(row.job.agreedPrice / 100).toLocaleString("fi-FI", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </p>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
