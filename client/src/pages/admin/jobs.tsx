import { useState, useEffect, useRef } from "react";
import { Loader2, ClipboardList, ArrowLeft, ArrowRight, Phone, Mail, MapPin, Check, CalendarClock, Save, Plus, Trash2, Receipt, Users, TrendingUp, Clock } from "lucide-react";
import { Link } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { USERS, getAdminProfile } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

type DbStatus = "lead" | "scheduled" | "in_progress" | "done" | "cancelled";

const ADDONS = [
  { key: "balcony",  label: "Parveke-/terassilasitus", price: 39 },
  { key: "railing",  label: "Lasikaide",               price: 39 },
  { key: "mirror",   label: "Peilien pesu",            price: 19 },
  { key: "canopy",   label: "Terassin lasikate",       price: 89 },
  { key: "gutter",   label: "Rännien puhdistus",       price: 69 },
] as const;
type AddonKey = (typeof ADDONS)[number]["key"];

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
    customerSignature: string | null;
    staffSignature: string | null;
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
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [savingFields, setSavingFields] = useState(false);
  const [localAddons, setLocalAddons] = useState<Set<AddonKey>>(new Set());

  interface Expense { id: number; description: string; amount: number; }
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [newExpenseDesc, setNewExpenseDesc] = useState("");
  const [newExpenseAmount, setNewExpenseAmount] = useState("");
  const [addingExpense, setAddingExpense] = useState(false);

  // Workers selection
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [savingWorkers, setSavingWorkers] = useState(false);

  // Payment method + language for receipt
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [receiptLang, setReceiptLang] = useState<"fi" | "en">("fi");
  const [sendingEmail, setSendingEmail] = useState(false);

  // "Jatka myöhemmin" pause form
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [progressNotes, setProgressNotes] = useState("");
  const [continuationPlan, setContinuationPlan] = useState("");
  const [continuationDate, setContinuationDate] = useState("");
  const [pauseLang, setPauseLang] = useState<"fi" | "en">("fi");
  const [sendingPauseEmail, setSendingPauseEmail] = useState(false);

  // Signatures
  const customerSigRef = useRef<HTMLCanvasElement>(null);
  const staffSigRef    = useRef<HTMLCanvasElement>(null);
  const [isDrawingCustomer, setIsDrawingCustomer] = useState(false);
  const [isDrawingStaff,    setIsDrawingStaff]    = useState(false);
  const [editingCustomerSig, setEditingCustomerSig] = useState(false);
  const [editingStaffSig,    setEditingStaffSig]    = useState(false);
  const [savingCustomerSig,  setSavingCustomerSig]  = useState(false);
  const [savingStaffSig,     setSavingStaffSig]     = useState(false);

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
      setEditingCustomerSig(false);
      setEditingStaffSig(false);
      setLocalAddons(new Set());
      setShowPauseForm(false);
      setProgressNotes("");
      setContinuationPlan("");
      setContinuationDate("");
      // Parse workers from assignedTo (comma-separated IDs or single name)
      setSelectedWorkers(parseWorkerIds(selected.job.assignedTo));
      setExpensesLoading(true);
      api.getExpenses(selected.job.id).then((res) => {
        if (res.ok && res.data) setExpenses(res.data as Expense[]);
        setExpensesLoading(false);
      });
    }
  }, [selected?.job.id]);

  // Parse assignedTo string into array of user IDs
  // Handles both old format ("Joonatan Juuri") and new ("joonatan,matias")
  function parseWorkerIds(assignedTo: string | null): string[] {
    if (!assignedTo) return [];
    const parts = assignedTo.split(",").map(s => s.trim()).filter(Boolean);
    return parts.map(part => {
      // If it's already a known user ID, keep it
      if (USERS.find(u => u.id === part)) return part;
      // Try to match by full name (old format)
      const byName = USERS.find(u => u.name === part);
      return byName ? byName.id : part;
    });
  }

  function workerIdsToString(ids: string[]): string {
    return ids.join(",");
  }

  const saveWorkers = async (newWorkers: string[]) => {
    if (!selected) return;
    setSavingWorkers(true);
    const res = await api.updateJob(selected.job.id, {
      assignedTo: newWorkers.length > 0 ? workerIdsToString(newWorkers) : undefined,
    });
    if (res.ok) {
      const updated: JobRow = {
        ...selected,
        job: { ...selected.job, assignedTo: newWorkers.length > 0 ? workerIdsToString(newWorkers) : null },
      };
      setSelected(updated);
      setJobs((prev) => prev.map((r) => (r.job.id === selected.job.id ? updated : r)));
    } else {
      toast({ variant: "destructive", title: "Tekijöiden tallennus epäonnistui", description: res.error });
    }
    setSavingWorkers(false);
  };

  const toggleWorker = (userId: string) => {
    const next = selectedWorkers.includes(userId)
      ? selectedWorkers.filter(id => id !== userId)
      : [...selectedWorkers, userId];
    setSelectedWorkers(next);
    saveWorkers(next);
  };

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

  const handleSendPauseUpdate = async () => {
    if (!selected || !progressNotes.trim()) return;
    setSendingPauseEmail(true);

    // Append progress notes to the job's internal notes
    const stamp = new Date().toLocaleDateString("fi-FI");
    const appendedNotes = selected.job.notes
      ? `${selected.job.notes}\n\n--- ${stamp} ---\n${progressNotes.trim()}`
      : `--- ${stamp} ---\n${progressNotes.trim()}`;
    await api.updateJob(selected.job.id, { notes: appendedNotes });
    setEditNotes(appendedNotes);
    const updatedRow: JobRow = { ...selected, job: { ...selected.job, notes: appendedNotes } };
    setSelected(updatedRow);
    setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updatedRow : r));

    if (selected.customer?.email) {
      const senderProfile = getAdminProfile();
      const res = await api.sendProgressUpdate({
        to: selected.customer.email,
        customerName: selected.customer.name,
        description: selected.job.description,
        progressNotes: progressNotes.trim(),
        continuationPlan: continuationPlan.trim() || undefined,
        continuationDate: continuationDate || undefined,
        workerName: senderProfile?.name,
        workerPhone: senderProfile?.phone,
        lang: pauseLang,
      });
      if (res.ok) {
        toast({ title: "Päivitys lähetetty!", description: `Sähköposti: ${selected.customer.email}` });
      } else {
        toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error });
      }
    } else {
      toast({ title: "Muistiinpanot tallennettu", description: "Asiakkaalla ei ole sähköpostia." });
    }

    setShowPauseForm(false);
    setSendingPauseEmail(false);
  };

  const toggleAddon = (key: AddonKey, price: number) => {
    setLocalAddons(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setEditPrice(p => String(Math.max(0, parseFloat(p || "0") - price)));
      } else {
        next.add(key);
        setEditPrice(p => String(parseFloat(p || "0") + price));
      }
      return next;
    });
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

  const handleDeleteJob = async () => {
    if (!selected) return;
    setDeleting(true);
    const res = await api.deleteJob(selected.job.id);
    if (res.ok) {
      setJobs(prev => prev.filter(r => r.job.id !== selected.job.id));
      setSelected(null);
      setConfirmDelete(false);
      toast({ title: "Keikka poistettu", description: "Keikka on poistettu tietokannasta." });
    } else {
      toast({ variant: "destructive", title: "Poisto epäonnistui", description: res.error });
    }
    setDeleting(false);
  };

  // ── Canvas signatures ────────────────────────────────────────────────────────

  const initCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const startSigDraw = (e: React.MouseEvent | React.TouchEvent, isCustomer: boolean) => {
    if ("touches" in e) e.preventDefault();
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    if (isCustomer) setIsDrawingCustomer(true); else setIsDrawingStaff(true);
  };

  const sigDraw = (e: React.MouseEvent | React.TouchEvent, isCustomer: boolean) => {
    if (!(isCustomer ? isDrawingCustomer : isDrawingStaff)) return;
    if ("touches" in e) e.preventDefault();
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopSigDraw = (isCustomer: boolean) => {
    if (isCustomer) setIsDrawingCustomer(false); else setIsDrawingStaff(false);
  };

  const clearSigCanvas = (isCustomer: boolean) => {
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveSignature = async (isCustomer: boolean) => {
    if (!selected) return;
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL();
    if (isCustomer) setSavingCustomerSig(true); else setSavingStaffSig(true);
    const patch = isCustomer ? { customerSignature: dataUrl } : { staffSignature: dataUrl };
    const res = await api.updateJob(selected.job.id, patch as any);
    if (res.ok) {
      const updated: JobRow = { ...selected, job: { ...selected.job, ...patch } };
      setSelected(updated);
      setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updated : r));
      if (isCustomer) setEditingCustomerSig(false); else setEditingStaffSig(false);
      toast({ title: "Allekirjoitus tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    if (isCustomer) setSavingCustomerSig(false); else setSavingStaffSig(false);
  };

  const clearSignatureField = async (isCustomer: boolean) => {
    if (!selected) return;
    const patch = isCustomer ? { customerSignature: null } : { staffSignature: null };
    const res = await api.updateJob(selected.job.id, patch as any);
    if (res.ok) {
      const updated: JobRow = { ...selected, job: { ...selected.job, ...patch } };
      setSelected(updated);
      setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updated : r));
      clearSigCanvas(isCustomer);
      if (isCustomer) setEditingCustomerSig(true); else setEditingStaffSig(true);
    }
  };

  const hasFieldChanges = selected
    ? editPrice !== String(selected.job.agreedPrice / 100) ||
      editDescription !== selected.job.description ||
      editNotes !== (selected.job.notes ?? "")
    : false;

  // ── Service fee calculation ───────────────────────────────────────────────
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const numWorkers = selectedWorkers.length || 1;
  const netRevenue = (selected?.job.agreedPrice ?? 0) - expensesTotal;
  const totalServiceFee = Math.round(Math.max(0, netRevenue) * 0.10);
  const feePerWorker = Math.round(totalServiceFee / numWorkers);
  const netPerWorker = Math.round(Math.max(0, netRevenue - totalServiceFee) / numWorkers);
  const expensesPerWorker = Math.round(expensesTotal / numWorkers);

  // ── Mailto receipt ────────────────────────────────────────────────────────
  const PAYMENT_METHODS = [
    { key: "käteinen",   label: "Käteinen" },
    { key: "mobilepay",  label: "MobilePay" },
    { key: "tilisiirto", label: "Tilisiirto" },
    { key: "kortti",     label: "Kortti" },
  ];

  const buildMailtoReceipt = () => {
    if (!selected) return "#";
    const { job, customer } = selected;
    const senderProfile = getAdminProfile();
    const senderName = senderProfile?.name ?? "Puuhapatet";
    const date = job.scheduledAt
      ? new Date(job.scheduledAt).toLocaleDateString("fi-FI")
      : new Date(job.createdAt).toLocaleDateString("fi-FI");
    const priceEur = (job.agreedPrice / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
    const paymentLine = paymentMethod ? `Maksutapa: ${PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label ?? paymentMethod}\n` : "";
    const phoneLine = senderProfile?.phone ? `→ Tai suoraan: ${senderProfile.phone}\n` : "";
    const yTunnusLine = senderProfile?.yTunnus ? `Y-tunnus:    ${senderProfile.yTunnus}\n` : "";
    const subject = encodeURIComponent(`Kuitti — Puuhapatet ${date}`);
    const body = encodeURIComponent(
      `Hei ${customer?.name ?? ""}!\n\n` +
      `Kiitos tilauksestanne — hienoa yhteistyötä! ✨\n\n` +
      `══════════════════════════\n` +
      `           KUITTI\n` +
      `══════════════════════════\n` +
      `Asiakas:     ${customer?.name ?? ""}\n` +
      `Osoite:      ${customer?.address ?? ""}\n` +
      `Päivämäärä:  ${date}\n` +
      `──────────────────────────\n` +
      `Palvelu:     ${job.description}\n` +
      `Hinta:       ${priceEur}\n` +
      (paymentLine ? paymentLine : "") +
      `══════════════════════════\n\n` +
      `KOTITALOUSVÄHENNYS\n` +
      `Tämä palvelu on kotitalousvähennyskelpoinen!\n` +
      `Voit vähentää 40 % työn osuudesta verotuksessa\n` +
      `(enintään 2 250 € / henkilö / vuosi).\n` +
      `Lisätietoa: vero.fi/kotitalousvahennys\n\n` +
      `Haluatko varata seuraavan palvelun?\n` +
      `→ puuhapatet.fi/tilaus\n` +
      phoneLine +
      `\nMeiltä löytyy ikkunapesu, piha- ja puutarhapalvelut,\n` +
      `roskakatos- ja terassihuollot — kysy lisää!\n\n` +
      `Terveisin,\n` +
      `${senderName}\n` +
      `Puuhapatet\n` +
      yTunnusLine +
      `info@puuhapatet.fi\n`
    );
    const to = customer?.email ? encodeURIComponent(customer.email) : "";
    return `mailto:${to}?subject=${subject}&body=${body}`;
  };

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selected) {
    const { job, customer } = selected;
    const meta = statusMeta(job.status);

    return (
      <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="ghost" size="icon" onClick={() => { setSelected(null); setConfirmDelete(false); }}>
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
            {job.status === "in_progress" && !showPauseForm && (
              <div className="mt-3 pt-3 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  onClick={() => setShowPauseForm(true)}
                >
                  <Clock className="w-4 h-4" />
                  Jatka myöhemmin — lähetä päivitys
                </Button>
              </div>
            )}
          </Card>

          {/* Pause / progress update form */}
          {showPauseForm && (
            <Card className="p-5 bg-card border-0 premium-shadow mb-4 border-l-4 border-orange-400">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-500" />
                  <p className="text-sm font-semibold text-foreground">Keikkapäivitys asiakkaalle</p>
                </div>
                <button
                  onClick={() => setShowPauseForm(false)}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none"
                  aria-label="Sulje"
                >
                  ×
                </button>
              </div>

              {/* Language toggle */}
              <div className="flex items-center gap-1.5 mb-4">
                <span className="text-xs text-muted-foreground mr-1">Kieli:</span>
                {(["fi", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setPauseLang(l)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all",
                      pauseLang === l
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40",
                    )}
                  >
                    {l === "fi" ? "🇫🇮 Suomi" : "🇬🇧 English"}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Mitä on tehty *</p>
                  <Textarea
                    value={progressNotes}
                    onChange={(e) => setProgressNotes(e.target.value)}
                    placeholder="Esim: Pestiin ikkunat ensimmäisessä kerroksessa ja parvekelasinpuhdistus tehty…"
                    rows={3}
                    className="text-sm resize-none"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Jatkosuunnitelma</p>
                  <Textarea
                    value={continuationPlan}
                    onChange={(e) => setContinuationPlan(e.target.value)}
                    placeholder="Esim: Seuraavalla käynnillä pestään yläkerran ikkunat ja terassi…"
                    rows={2}
                    className="text-sm resize-none"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Suunniteltu jatkopäivä</p>
                  <input
                    type="datetime-local"
                    value={continuationDate}
                    onChange={(e) => setContinuationDate(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  className="flex-1 gap-2"
                  disabled={sendingPauseEmail || !progressNotes.trim()}
                  onClick={handleSendPauseUpdate}
                >
                  {sendingPauseEmail
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Mail className="w-4 h-4" />}
                  {customer?.email ? "Lähetä asiakkaalle & tallenna" : "Tallenna muistiinpanot"}
                </Button>
                <Button
                  variant="outline"
                  disabled={sendingPauseEmail}
                  onClick={() => setShowPauseForm(false)}
                >
                  Peruuta
                </Button>
              </div>
              {!customer?.email && (
                <p className="text-xs text-muted-foreground mt-2">
                  Asiakkaalla ei ole sähköpostia — tallennetaan vain keikalle.
                </p>
              )}
            </Card>
          )}

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
                Luotu: {new Date(job.createdAt).toLocaleDateString("fi-FI")}
              </p>
            </div>
          </Card>

          {/* Add-ons card */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Lisäpalvelut
            </p>
            <div className="grid grid-cols-1 gap-2">
              {ADDONS.map(({ key, label, price }) => {
                const active = localAddons.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleAddon(key, price)}
                    className={cn(
                      "p-3 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0",
                        active ? "border-primary bg-primary" : "border-muted-foreground/40",
                      )}>
                        {active && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-xs font-medium text-foreground">{label}</span>
                    </div>
                    <span className="text-xs font-semibold text-primary">+{price} €</span>
                  </button>
                );
              })}
            </div>
            {localAddons.size > 0 && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Lisätty sovittuun hintaan — tallenna muutokset Keikan tiedot -kortissa.
              </p>
            )}
          </Card>

          {/* Workers card */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Tekijät
              </p>
              {savingWorkers && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
            </div>
            <div className="flex gap-2">
              {USERS.map((u) => {
                const isOn = selectedWorkers.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={savingWorkers}
                    onClick={() => toggleWorker(u.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium transition-all",
                      isOn
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      savingWorkers && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {u.photoUrl && (
                      <img src={u.photoUrl} alt={u.name} className="w-5 h-5 rounded-full object-cover" />
                    )}
                    {u.name.split(" ")[0]}
                    {isOn && <Check className="w-3.5 h-3.5 text-primary" />}
                  </button>
                );
              })}
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

          {/* Service fee breakdown */}
          {!expensesLoading && (
            <Card className="p-5 bg-card border-0 premium-shadow mb-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Tilitys
                </p>
                <span className="ml-auto text-xs text-muted-foreground">
                  {numWorkers} tekijä{numWorkers > 1 ? "ä" : ""}
                </span>
              </div>

              <div className="space-y-2 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sovittu hinta</span>
                  <span className="font-medium">{(job.agreedPrice / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}</span>
                </div>
                {expensesTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kulut yhteensä</span>
                    <span className="font-medium text-orange-600 dark:text-orange-400">
                      −{(expensesTotal / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground">Palvelumaksu 10 %</span>
                  <span className="font-medium text-purple-600 dark:text-purple-400">
                    −{(totalServiceFee / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                  </span>
                </div>
              </div>

              {numWorkers > 1 ? (
                <div className="space-y-2">
                  {selectedWorkers.map((wid) => {
                    const user = USERS.find(u => u.id === wid);
                    return (
                      <div key={wid} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
                        <div className="flex items-center gap-2">
                          {user?.photoUrl && <img src={user.photoUrl} alt={user.name} className="w-5 h-5 rounded-full object-cover" />}
                          <span className="text-sm font-medium">{user?.name.split(" ")[0] ?? wid}</span>
                          <span className="text-xs text-muted-foreground">kulut −{(expensesPerWorker / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })} · maksu −{(feePerWorker / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}</span>
                        </div>
                        <span className="text-sm font-bold text-green-600 dark:text-green-400">
                          {(netPerWorker / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-semibold text-sm text-foreground">
                    {selectedWorkers[0] ? (USERS.find(u => u.id === selectedWorkers[0])?.name.split(" ")[0] ?? selectedWorkers[0]) : "Tekijä"} saa
                  </span>
                  <span className="text-lg font-bold text-green-600 dark:text-green-400">
                    {(netPerWorker / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                  </span>
                </div>
              )}
            </Card>
          )}

          {/* Receipt — payment method + send */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Kuitti asiakkaalle
              </p>
            </div>
            {/* Language toggle */}
            <div className="flex items-center gap-1.5 mb-4">
              <span className="text-xs text-muted-foreground mr-1">Kieli:</span>
              {(["fi", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setReceiptLang(l)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all",
                    receiptLang === l
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40",
                  )}
                >
                  {l === "fi" ? "🇫🇮 Suomi" : "🇬🇧 English"}
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mb-3">Maksutapa (valinnainen)</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setPaymentMethod(prev => prev === m.key ? "" : m.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all",
                    paymentMethod === m.key
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {customer?.email && (
                <Button
                  className="w-full gap-2"
                  disabled={sendingEmail}
                  onClick={async () => {
                    if (!customer?.email) return;
                    setSendingEmail(true);
                    const senderProfile = getAdminProfile();
                    const date = job.scheduledAt
                      ? new Date(job.scheduledAt).toLocaleDateString("fi-FI")
                      : new Date(job.createdAt).toLocaleDateString("fi-FI");
                    const priceEur = (job.agreedPrice / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
                    const res = await api.sendReceipt({
                      to: customer.email,
                      customerName: customer.name,
                      customerAddress: customer.address,
                      date,
                      description: job.description,
                      price: priceEur,
                      paymentMethod: paymentMethod ? PAYMENT_METHODS.find(m => m.key === paymentMethod)?.label : undefined,
                      workerName: senderProfile?.name,
                      workerPhone: senderProfile?.phone,
                      workerYTunnus: senderProfile?.yTunnus,
                      isReturning: false,
                      lang: receiptLang,
                    });
                    if (res.ok) {
                      toast({ title: "Kuitti lähetetty!", description: `Sähköposti lähetetty: ${customer.email}` });
                    } else {
                      toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error || "Yritä uudelleen" });
                    }
                    setSendingEmail(false);
                  }}
                >
                  {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Lähetä kuitti sähköpostilla
                </Button>
              )}
              <a href={buildMailtoReceipt()}>
                <Button variant="outline" className="w-full gap-2">
                  <Mail className="w-4 h-4" />
                  Avaa sähköpostiohjelmassa
                </Button>
              </a>
              {!customer?.email && (
                <p className="text-xs text-muted-foreground">
                  Lisää asiakkaalle sähköpostiosoite lähettääksesi kuitin suoraan.
                </p>
              )}
            </div>
          </Card>

          {/* Signatures */}
          {/* Danger zone */}
          <Card className="p-5 border border-destructive/20 bg-destructive/5 mb-4">
            <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-3">Vaaravyöhyke</p>
            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-4 h-4" />
                Poista keikka kokonaan
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-destructive font-medium">
                  Poistetaanko keikka #{job.id} ({customer?.name}) pysyvästi? Tätä ei voi perua.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleting}
                    onClick={handleDeleteJob}
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

          {/* Signatures — always editable */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
              Allekirjoitukset
            </p>
            <div className="grid grid-cols-2 gap-4">
              {/* Customer signature */}
              {(() => {
                const showCanvas = !job.customerSignature || editingCustomerSig;
                return (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Asiakas</p>
                    {!showCanvas ? (
                      <>
                        <img src={job.customerSignature!} alt="Asiakkaan allekirjoitus" className="w-full h-20 object-contain bg-white rounded-lg border p-1 mb-2" />
                        <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" onClick={() => clearSignatureField(true)}>
                          Muuta
                        </Button>
                      </>
                    ) : (
                      <>
                        <canvas
                          ref={canvas => { (customerSigRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas; initCanvas(canvas); }}
                          className="w-full h-20 border rounded-lg bg-white touch-none cursor-crosshair mb-2"
                          onMouseDown={e => startSigDraw(e, true)}
                          onMouseMove={e => sigDraw(e, true)}
                          onMouseUp={() => stopSigDraw(true)}
                          onMouseLeave={() => stopSigDraw(true)}
                          onTouchStart={e => startSigDraw(e, true)}
                          onTouchMove={e => sigDraw(e, true)}
                          onTouchEnd={() => stopSigDraw(true)}
                        />
                        <div className="flex gap-1.5">
                          <Button size="sm" className="flex-1 text-xs" disabled={savingCustomerSig} onClick={() => saveSignature(true)}>
                            {savingCustomerSig ? <Loader2 className="w-3 h-3 animate-spin" /> : "Tallenna"}
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => clearSigCanvas(true)}>
                            Tyhjennä
                          </Button>
                          {job.customerSignature && (
                            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditingCustomerSig(false)}>
                              Peru
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Staff signature */}
              {(() => {
                const showCanvas = !job.staffSignature || editingStaffSig;
                return (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Työntekijä</p>
                    {!showCanvas ? (
                      <>
                        <img src={job.staffSignature!} alt="Työntekijän allekirjoitus" className="w-full h-20 object-contain bg-white rounded-lg border p-1 mb-2" />
                        <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" onClick={() => clearSignatureField(false)}>
                          Muuta
                        </Button>
                      </>
                    ) : (
                      <>
                        <canvas
                          ref={canvas => { (staffSigRef as React.MutableRefObject<HTMLCanvasElement | null>).current = canvas; initCanvas(canvas); }}
                          className="w-full h-20 border rounded-lg bg-white touch-none cursor-crosshair mb-2"
                          onMouseDown={e => startSigDraw(e, false)}
                          onMouseMove={e => sigDraw(e, false)}
                          onMouseUp={() => stopSigDraw(false)}
                          onMouseLeave={() => stopSigDraw(false)}
                          onTouchStart={e => startSigDraw(e, false)}
                          onTouchMove={e => sigDraw(e, false)}
                          onTouchEnd={() => stopSigDraw(false)}
                        />
                        <div className="flex gap-1.5">
                          <Button size="sm" className="flex-1 text-xs" disabled={savingStaffSig} onClick={() => saveSignature(false)}>
                            {savingStaffSig ? <Loader2 className="w-3 h-3 animate-spin" /> : "Tallenna"}
                          </Button>
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => clearSigCanvas(false)}>
                            Tyhjennä
                          </Button>
                          {job.staffSignature && (
                            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEditingStaffSig(false)}>
                              Peru
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
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
