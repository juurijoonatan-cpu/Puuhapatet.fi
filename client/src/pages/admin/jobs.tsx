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
import { isMyJob, parseWorkerIds } from "@/lib/visibility";
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
    waiveFee: boolean;
    pendingWorkers: string | null;
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
  const profile = getAdminProfile();
  const isHost = profile?.role === "HOST";
  const [showAll, setShowAll] = useState(false);
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

  // Tip
  const [tipAmount, setTipAmount] = useState("");
  const [savingTip, setSavingTip] = useState(false);

  // Service fee waiver (HOST only)
  const [waivingFee, setWaivingFee] = useState(false);

  // Worker invite
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteNote, setInviteNote] = useState("");

  // Summary / invoice panel
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [summaryPaymentMethod, setSummaryPaymentMethod] = useState<string>("");
  const [summaryDueDate, setSummaryDueDate] = useState<string>("");
  const [summaryIban, setSummaryIban] = useState<string>("");
  const [summaryBic, setSummaryBic] = useState<string>("");
  const [summaryViitenumero, setSummaryViitenumero] = useState<string>("");
  const [summaryMessage, setSummaryMessage] = useState<string>("");
  const [summaryNotes, setSummaryNotes] = useState<string>("");
  const [summaryLang, setSummaryLang] = useState<"fi" | "en">("fi");
  const [sendingSummary, setSendingSummary] = useState(false);
  const [summaryTimeline, setSummaryTimeline] = useState<{label: string; date: string}[]>([]);
  const [summaryPhoto, setSummaryPhoto] = useState<string | null>(null);

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
      setTipAmount("");
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

  const saveTip = async () => {
    if (!selected || !tipAmount) return;
    const tipCents = Math.round(parseFloat(tipAmount) * 100);
    if (isNaN(tipCents) || tipCents <= 0) return;
    setSavingTip(true);
    const newPrice = selected.job.agreedPrice + tipCents;
    const tipStr = (tipCents / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
    const stamp = new Date().toLocaleDateString("fi-FI");
    const appendedNotes = selected.job.notes
      ? `${selected.job.notes}\n${stamp}: Tippi +${tipStr}`
      : `${stamp}: Tippi +${tipStr}`;
    const res = await api.updateJob(selected.job.id, { agreedPrice: newPrice, notes: appendedNotes });
    if (res.ok) {
      const updated: JobRow = {
        ...selected,
        job: { ...selected.job, agreedPrice: newPrice, notes: appendedNotes },
      };
      setSelected(updated);
      setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updated : r));
      setEditPrice(String(newPrice / 100));
      setEditNotes(appendedNotes);
      setTipAmount("");
      toast({ title: `Tippi kirjattu: +${tipStr}`, description: "Lisätty kirjanpitoon." });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    setSavingTip(false);
  };

  const handleSendPauseUpdate = async () => {
    if (!selected || !progressNotes.trim()) return;
    setSendingPauseEmail(true);

    // Append progress notes to the job's internal notes
    const stamp = new Date().toLocaleDateString("fi-FI");
    const appendedNotes = selected.job.notes
      ? `${selected.job.notes}\n\n--- ${stamp} ---\n${progressNotes.trim()}`
      : `--- ${stamp} ---\n${progressNotes.trim()}`;

    // Build the patch: always update notes; if continuation date given,
    // also reschedule the job (moves the calendar entry to the new date)
    const patch: Parameters<typeof api.updateJob>[1] = {
      notes: appendedNotes,
      ...(continuationDate
        ? {
            scheduledAt: new Date(continuationDate).toISOString(),
            status: "scheduled",
          }
        : {}),
    };

    await api.updateJob(selected.job.id, patch);
    setEditNotes(appendedNotes);
    const updatedRow: JobRow = {
      ...selected,
      job: {
        ...selected.job,
        notes: appendedNotes,
        ...(continuationDate
          ? {
              scheduledAt: new Date(continuationDate).toISOString(),
              status: "scheduled" as const,
            }
          : {}),
      },
    };
    setSelected(updatedRow);
    setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updatedRow : r));

    if (selected.customer?.email) {
      const senderProfile = getAdminProfile();
      const res = await api.sendProgressUpdate({
        to: selected.customer.email,
        bcc: senderProfile?.email,
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
        const calMsg = continuationDate ? " Keikka siirretty kalenteriin." : "";
        toast({ title: "Päivitys lähetetty!", description: `Sähköposti: ${selected.customer.email}.${calMsg}` });
      } else {
        toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error });
      }
    } else {
      const calMsg = continuationDate ? " Jatkopäivä lisätty kalenteriin." : "";
      toast({ title: "Muistiinpanot tallennettu", description: `Asiakkaalla ei ole sähköpostia.${calMsg}` });
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

  const parsePendingWorkers = (pw: string | null) =>
    (pw ?? "").split(",").map(s => s.trim()).filter(Boolean);

  const handleInviteWorker = async (invitedId: string) => {
    if (!selected) return;
    setSendingInvite(true);
    const senderProfile = getAdminProfile();
    const res = await api.inviteWorker(selected.job.id, invitedId, senderProfile?.name, inviteNote || undefined);
    if (res.ok) {
      const updated: JobRow = { ...selected, job: { ...selected.job, ...(res.data as any).job } };
      setSelected(updated);
      setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updated : r));
      setInviteNote("");
      toast({ title: "Kutsu lähetetty!", description: `${USERS.find(u => u.id === invitedId)?.name ?? invitedId} kutsuttu keikalle` });
    } else {
      toast({ variant: "destructive", title: "Kutsu epäonnistui", description: res.error });
    }
    setSendingInvite(false);
  };

  const handleRespondInvite = async (accept: boolean) => {
    if (!selected || !profile) return;
    const res = await api.respondInvite(selected.job.id, profile.id, accept);
    if (res.ok) {
      const updated: JobRow = { ...selected, job: { ...selected.job, ...(res.data as any).job } };
      setSelected(updated);
      setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updated : r));
      toast({ title: accept ? "Keikka hyväksytty!" : "Keikka hylätty" });
    } else {
      toast({ variant: "destructive", title: "Virhe", description: res.error });
    }
  };

  const handleToggleWaiveFee = async () => {
    if (!selected) return;
    setWaivingFee(true);
    const newVal = !selected.job.waiveFee;
    const res = await api.updateJob(selected.job.id, { waiveFee: newVal });
    if (res.ok) {
      const updated: JobRow = { ...selected, job: { ...selected.job, waiveFee: newVal } };
      setSelected(updated);
      setJobs(prev => prev.map(r => r.job.id === selected.job.id ? updated : r));
      toast({ title: newVal ? "Palvelumaksu poistettu tältä keikalta" : "Palvelumaksu palautettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    setWaivingFee(false);
  };

  // ── Visibility filter: own vs all ─────────────────────────────────────────
  const visibleJobs = (isHost && showAll) || !profile
    ? jobs
    : jobs.filter(r => isMyJob(r.job.assignedTo, profile.id));

  const hasFieldChanges = selected
    ? editPrice !== String(selected.job.agreedPrice / 100) ||
      editDescription !== selected.job.description ||
      editNotes !== (selected.job.notes ?? "")
    : false;

  // ── Service fee calculation ───────────────────────────────────────────────
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const numWorkers = selectedWorkers.length || 1;
  const netRevenue = (selected?.job.agreedPrice ?? 0) - expensesTotal;
  const feeWaived = selected?.job.waiveFee ?? false;
  const totalServiceFee = feeWaived ? 0 : Math.round(Math.max(0, netRevenue) * 0.10);
  const feePerWorker = Math.round(totalServiceFee / numWorkers);
  const netPerWorker = Math.round(Math.max(0, netRevenue - totalServiceFee) / numWorkers);
  const expensesPerWorker = Math.round(expensesTotal / numWorkers);

  // ── Summary / invoice helpers ─────────────────────────────────────────────
  const PAYMENT_METHODS = [
    { key: "käteinen",   label: "Käteinen" },
    { key: "mobilepay",  label: "MobilePay" },
    { key: "tilisiirto", label: "Tilisiirto" },
    { key: "kortti",     label: "Kortti" },
  ];

  const compressImage = (file: File, maxWidth = 800): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const ratio = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Target < 500KB: try quality 0.75, drop to 0.55 if still too large
          let dataUrl = canvas.toDataURL("image/jpeg", 0.75);
          if (dataUrl.length > 700_000) dataUrl = canvas.toDataURL("image/jpeg", 0.55);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = ev.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const openSummaryPanel = () => {
    if (!selected) return;
    const { job } = selected;
    const profile = getAdminProfile();
    setSummaryPhoto(null);
    const jobId = (job as any).id as number;
    // +14 days default due date
    const due = new Date();
    due.setDate(due.getDate() + 14);
    setSummaryDueDate(due.toISOString().slice(0, 10));
    setSummaryIban(profile?.iban ?? "");
    setSummaryBic(profile?.bic ?? "");
    setSummaryViitenumero("PP" + String(jobId).padStart(6, "0"));
    setSummaryMessage("");
    setSummaryNotes("");
    setSummaryPaymentMethod((job as any).paymentMethod ?? "");
    setSummaryLang("fi");
    // Pre-fill timeline with ISO dates (YYYY-MM-DD) — avoids fi-FI conversion hacks
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    const todayISO = toISO(new Date());
    const createdISO = toISO(new Date(job.createdAt));
    const events: {label: string; date: string}[] = [];
    events.push({ label: "Tilaus", date: createdISO });
    if (job.scheduledAt) {
      const schISO = toISO(new Date(job.scheduledAt));
      if (schISO !== createdISO) {
        events.push({ label: "Työ aloitettu", date: schISO });
      }
    }
    events.push({ label: job.status === "in_progress" ? "Käynnissä" : "Valmis ✓", date: todayISO });
    setSummaryTimeline(events);
    setShowSummaryPanel(true);
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

          {/* Invite / pending workers */}
          {(() => {
            const pending = parsePendingWorkers(selected.job.pendingWorkers);
            const myPendingInvite = profile && pending.includes(profile.id);
            const assignedIds = parseWorkerIds(selected.job.assignedTo);
            const invitable = USERS.filter(u => !assignedIds.includes(u.id) && !pending.includes(u.id) && u.id !== profile?.id);
            return (
              <>
                {/* My pending invite — accept / decline */}
                {myPendingInvite && (
                  <Card className="p-4 bg-orange-50 dark:bg-orange-900/20 border-0 premium-shadow mb-4">
                    <p className="text-sm font-semibold text-orange-800 dark:text-orange-200 mb-1">
                      Sinulle on keikkakutsu
                    </p>
                    <p className="text-xs text-orange-700 dark:text-orange-300 mb-3">
                      {selected.customer?.name} · {selected.job.scheduledAt
                        ? new Date(selected.job.scheduledAt).toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                        : "Aika ei vahvistettu"}
                    </p>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mb-3">Vastaa 4 tunnin sisällä</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRespondInvite(true)}
                        className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold"
                      >
                        Hyväksy
                      </button>
                      <button
                        onClick={() => handleRespondInvite(false)}
                        className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold"
                      >
                        Hylkää
                      </button>
                    </div>
                  </Card>
                )}

                {/* HOST: invite others + show pending */}
                {isHost && (invitable.length > 0 || pending.filter(id => id !== profile?.id).length > 0) && (
                  <Card className="p-4 bg-card border-0 premium-shadow mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      Kutsu tekijä
                    </p>
                    {pending.filter(id => id !== profile?.id).length > 0 && (
                      <div className="mb-3 space-y-1">
                        {pending.filter(id => id !== profile?.id).map(id => (
                          <div key={id} className="flex items-center justify-between text-xs bg-orange-50 dark:bg-orange-900/20 rounded-lg px-3 py-2">
                            <span className="text-orange-700 dark:text-orange-300 font-medium">
                              ⏳ {USERS.find(u => u.id === id)?.name ?? id} — odottaa vastausta
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {invitable.length > 0 && (
                      <>
                        <input
                          type="text"
                          placeholder="Viesti (valinnainen)"
                          value={inviteNote}
                          onChange={e => setInviteNote(e.target.value)}
                          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm mb-2"
                        />
                        <div className="flex flex-wrap gap-2">
                          {invitable.map(u => (
                            <button
                              key={u.id}
                              onClick={() => handleInviteWorker(u.id)}
                              disabled={sendingInvite}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted/40 transition-all disabled:opacity-50"
                            >
                              {u.photoUrl && <img src={u.photoUrl} alt={u.name} className="w-5 h-5 rounded-full object-cover" />}
                              Kutsu {u.name.split(" ")[0]}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </Card>
                )}
              </>
            );
          })()}

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
                  <span className={cn("text-muted-foreground", feeWaived && "line-through opacity-50")}>
                    Palvelumaksu 10 %
                  </span>
                  <span className={cn("font-medium text-purple-600 dark:text-purple-400", feeWaived && "line-through opacity-50")}>
                    −{(Math.round(Math.max(0, netRevenue) * 0.10) / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" })}
                  </span>
                </div>
                {getAdminProfile()?.role === "HOST" && (
                  <button
                    onClick={handleToggleWaiveFee}
                    disabled={waivingFee}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium border transition-all mt-1",
                      feeWaived
                        ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <span>{feeWaived ? "Palvelumaksu poistettu (host-keikka)" : "Poista palvelumaksu (host)"}</span>
                    <span className={cn(
                      "w-8 h-4 rounded-full transition-all relative shrink-0",
                      feeWaived ? "bg-green-500" : "bg-muted-foreground/30"
                    )}>
                      <span className={cn(
                        "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                        feeWaived ? "left-4" : "left-0.5"
                      )} />
                    </span>
                  </button>
                )}
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

          {/* Tip */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Tippi
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  className="pr-8 text-lg font-semibold"
                  onKeyDown={(e) => e.key === "Enter" && saveTip()}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
              </div>
              <Button
                onClick={saveTip}
                disabled={savingTip || !tipAmount || parseFloat(tipAmount) <= 0}
                className="gap-2"
              >
                {savingTip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Kirjaa
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Tippi lisätään sovittuun hintaan ja kirjataan muistiinpanoihin.
            </p>
          </Card>

          {/* Summary / Invoice panel */}
          <Card className="p-5 bg-card border-0 premium-shadow mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Lähetä yhteenveto asiakkaalle
              </p>
            </div>

            {!showSummaryPanel ? (
              <div className="space-y-2">
                <Button className="w-full gap-2" onClick={openSummaryPanel}>
                  <Mail className="w-4 h-4" />
                  Avaa lähetysvalikko
                </Button>
                {!customer?.email && (
                  <p className="text-xs text-muted-foreground">Lisää asiakkaalle sähköpostiosoite lähettääksesi yhteenvedon suoraan.</p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Language */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground mr-1">Kieli:</span>
                  {(["fi", "en"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setSummaryLang(l)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all",
                        summaryLang === l
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      {l === "fi" ? "🇫🇮 Suomi" : "🇬🇧 English"}
                    </button>
                  ))}
                </div>

                {/* Timeline editor */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Aikajana sähköpostiin</p>
                  <div className="space-y-2">
                    {summaryTimeline.map((evt, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input
                          value={evt.label}
                          onChange={e => setSummaryTimeline(prev => prev.map((v, j) => j === i ? {...v, label: e.target.value} : v))}
                          className="text-xs h-8 flex-1"
                          placeholder="Vaihe"
                        />
                        <Input
                          type="date"
                          value={evt.date}
                          onChange={e => setSummaryTimeline(prev => prev.map((v, j) => j === i ? {...v, date: e.target.value} : v))}
                          className="text-xs h-8 w-36"
                        />
                        {summaryTimeline.length > 2 && (
                          <button
                            type="button"
                            onClick={() => setSummaryTimeline(prev => prev.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-destructive text-base leading-none px-1"
                          >×</button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSummaryTimeline(prev => [...prev, { label: "Vaihe", date: new Date().toISOString().slice(0, 10) }])}
                      className="text-xs text-primary hover:underline"
                    >+ Lisää vaihe</button>
                  </div>
                </div>

                {/* Photo upload */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-2">Kuva keikasta (valinnainen)</label>
                  {summaryPhoto ? (
                    <div className="relative rounded-xl overflow-hidden">
                      <img src={summaryPhoto} alt="Keikka" className="w-full object-cover max-h-48 rounded-xl" />
                      <button
                        type="button"
                        onClick={() => setSummaryPhoto(null)}
                        className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-6 h-6 text-sm leading-none flex items-center justify-center"
                      >×</button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center gap-1 cursor-pointer border-2 border-dashed border-border rounded-xl p-4 hover:border-primary/40 transition-colors text-center">
                      <span className="text-xs text-muted-foreground">Klikkaa lisätäksesi kuva tai vedä tänne</span>
                      <span className="text-[10px] text-muted-foreground/60">JPG / PNG — pakataan automaattisesti</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) setSummaryPhoto(await compressImage(file));
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Payment method */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Maksutapa *</p>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setSummaryPaymentMethod(prev => prev === m.key ? "" : m.key)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all",
                          summaryPaymentMethod === m.key
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-muted-foreground/40",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tilisiirto invoice fields */}
                {summaryPaymentMethod === "tilisiirto" && (
                  <div className="space-y-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">Laskutiedot</p>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">IBAN</label>
                      <Input
                        value={summaryIban}
                        onChange={e => setSummaryIban(e.target.value)}
                        placeholder="FI00 0000 0000 0000 00"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">BIC/SWIFT</label>
                      <Input
                        value={summaryBic}
                        onChange={e => setSummaryBic(e.target.value)}
                        placeholder="OKOYFIHH"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Viitenumero</label>
                      <Input
                        value={summaryViitenumero}
                        onChange={e => setSummaryViitenumero(e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Eräpäivä</label>
                      <Input
                        type="date"
                        value={summaryDueDate}
                        onChange={e => setSummaryDueDate(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Worker message */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Viesti asiakkaalle (valinnainen)</label>
                  <Textarea
                    value={summaryMessage}
                    onChange={e => setSummaryMessage(e.target.value)}
                    placeholder="Hei! Keikka meni hienosti..."
                    className="text-sm resize-none"
                    rows={3}
                  />
                </div>

                {/* Job notes */}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Huomioita keikasta (valinnainen)</label>
                  <Textarea
                    value={summaryNotes}
                    onChange={e => setSummaryNotes(e.target.value)}
                    placeholder="Eteläpuolen ikkunat olivat erittäin likaiset..."
                    className="text-sm resize-none"
                    rows={2}
                  />
                </div>

                {/* Send button */}
                <div className="space-y-2 pt-1">
                  {customer?.email ? (
                    <Button
                      className="w-full gap-2"
                      disabled={sendingSummary || !summaryPaymentMethod}
                      onClick={async () => {
                        if (!customer?.email || !summaryPaymentMethod) return;
                        setSendingSummary(true);
                        const priceEur = (job.agreedPrice / 100).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
                        // All assigned workers — parseWorkerIds handles both IDs and legacy full names
                        const workerIds = parseWorkerIds(job.assignedTo);
                        const allWorkersData = workerIds
                          .map(id => USERS.find(u => u.id === id))
                          .filter(Boolean)
                          .map(u => ({ name: u!.name, phone: u!.phone, email: u!.email, yTunnus: u!.yTunnus }));
                        const bccEmails = allWorkersData.map(w => w.email).filter((e): e is string => !!e);
                        const dueDateFormatted = summaryDueDate
                          ? new Date(summaryDueDate).toLocaleDateString("fi-FI")
                          : undefined;
                        // Save payment method to job
                        await api.updateJob((job as any).id, { paymentMethod: summaryPaymentMethod });
                        // Convert ISO dates to fi-FI for display in email
                        const displayEvents = summaryTimeline.map(e => ({
                          label: e.label,
                          date: e.date ? new Date(e.date + "T12:00:00").toLocaleDateString("fi-FI") : "",
                        }));
                        const res = await api.sendJobSummary({
                          to: customer.email,
                          bcc: bccEmails.length > 0 ? bccEmails : undefined,
                          customerName: customer.name,
                          customerAddress: customer.address,
                          timelineEvents: displayEvents,
                          photoDataUrl: summaryPhoto || undefined,
                          description: job.description,
                          price: priceEur,
                          paymentMethod: summaryPaymentMethod,
                          iban: summaryIban || undefined,
                          bic: summaryBic || undefined,
                          viitenumero: summaryViitenumero || undefined,
                          dueDate: dueDateFormatted,
                          workerMessage: summaryMessage || undefined,
                          jobNotes: summaryNotes || undefined,
                          allWorkers: allWorkersData.length > 0 ? allWorkersData : undefined,
                          lang: summaryLang,
                        });
                        if (res.ok) {
                          toast({ title: summaryPaymentMethod === "tilisiirto" ? "Lasku lähetetty!" : "Yhteenveto lähetetty!", description: `Sähköposti lähetetty: ${customer.email}` });
                          setShowSummaryPanel(false);
                        } else {
                          toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error || "Yritä uudelleen" });
                        }
                        setSendingSummary(false);
                      }}
                    >
                      {sendingSummary ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                      {summaryPaymentMethod === "tilisiirto" ? "Lähetä lasku" : "Lähetä yhteenveto"}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Lisää asiakkaalle sähköpostiosoite lähettääksesi yhteenvedon suoraan.</p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    onClick={() => setShowSummaryPanel(false)}
                  >
                    Peruuta
                  </Button>
                </div>
              </div>
            )}
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
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">Keikat</h1>
            <p className="text-muted-foreground">
              {loading ? "Ladataan…" : `${visibleJobs.length} keikkaa${!showAll && profile ? " (omat)" : ""}`}
            </p>
          </div>
        </div>

        {isHost && (
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setShowAll(false)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border-2 transition-all",
                !showAll
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground"
              )}
            >
              Omat
            </button>
            <button
              onClick={() => setShowAll(true)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium border-2 transition-all",
                showAll
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground"
              )}
            >
              Kaikki
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && visibleJobs.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title={showAll || !profile ? "Ei keikkoja" : "Ei omia keikkoja"}
            description={
              showAll || !profile
                ? "Ei vielä yhtään kirjattua keikkaa. Luo ensimmäinen uusi keikka."
                : isHost
                  ? "Sinulle ei ole merkitty keikkoja. Paina Kaikki nähdäksesi koko tiimin keikat."
                  : "Sinulle ei ole vielä merkitty keikkoja. Kysy HOSTilta uusia keikkoja."
            }
          />
        )}

        {!loading && visibleJobs.length > 0 && (
          <div className="space-y-3">
            {visibleJobs.map((row) => {
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
                        {profile && parsePendingWorkers(row.job.pendingWorkers).includes(profile.id) && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-500 text-white font-semibold shrink-0">
                            Kutsu
                          </span>
                        )}
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
