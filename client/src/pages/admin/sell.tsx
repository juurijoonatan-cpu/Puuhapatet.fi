/**
 * Myyntipaneeli — door-to-door marketer panel.
 *
 * A stripped-down, mobile-first tool for marketers in the field: capture a lead
 * (customer + rough offer), submit it for founder triage, and track your own
 * leads + commission. Marketers are locked to this route (see protected-route);
 * founders can also open it to capture a lead themselves.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Check, MapPin, Phone, Plus, ChevronLeft, Sparkles } from "lucide-react";
import { getAdminProfile } from "@/lib/admin-profile";
import { API_BASE, withAuth } from "@/lib/api";
import { PitchDeck } from "@/components/pitch-deck";

interface LeadRow {
  id: number;
  status: string;
  submissionStatus: string | null;
  description: string;
  agreedPrice: number;
  marketerId: string | null;
  marketerCommissionCents: number | null;
  submittedBy: string | null;
  createdAt: string;
  customer: { name: string; address: string; phone: string } | null;
}

const eur = (cents: number) =>
  (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";

function statusChip(l: LeadRow): { label: string; cls: string } {
  if (l.submissionStatus === "pending_review") return { label: "Odottaa tarkistusta", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" };
  if (l.submissionStatus === "rejected") return { label: "Hylätty", cls: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" };
  if (l.submissionStatus === "approved") return { label: "Hyväksytty ✓", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" };
  return { label: l.status, cls: "bg-muted text-muted-foreground" };
}

export default function SellPage() {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const isFounder = profile?.role === "HOST";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const [pitch, setPitch] = useState(false);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const formTopRef = useRef<HTMLDivElement>(null);

  async function loadLeads() {
    try {
      const res = await fetch(`${API_BASE}/api/marketer/leads`, { headers: withAuth() });
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoadingLeads(false); }
  }

  useEffect(() => { loadLeads(); }, []);

  function resetForm() {
    setName(""); setPhone(""); setAddress(""); setEmail(""); setDescription(""); setPrice(""); setNotes("");
  }

  async function submit() {
    if (sending) return;
    setError(null);
    if (!name.trim() || !phone.trim()) { setError("Asiakkaan nimi ja puhelin vaaditaan."); return; }
    setSending(true);
    try {
      const priceCents = price.trim() ? Math.round(parseFloat(price.replace(",", ".")) * 100) : 0;
      const res = await fetch(`${API_BASE}/api/marketer/leads`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: name.trim(), phone: phone.trim(), address: address.trim(),
          email: email.trim() || undefined, description: description.trim(),
          priceCents: Number.isFinite(priceCents) ? priceCents : 0, notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error || "Tallennus epäonnistui."); return; }
      resetForm();
      setJustSent(true);
      setTimeout(() => setJustSent(false), 2500);
      loadLeads();
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError("Yhteysvirhe. Yritä uudelleen.");
    } finally {
      setSending(false);
    }
  }

  const fieldCls = "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40";

  if (pitch) return <PitchDeck onClose={() => setPitch(false)} />;

  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
      <div ref={formTopRef} />
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between" style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2">
          {isFounder && (
            <Link href="/admin/dashboard">
              <button className="p-1.5 -ml-1 rounded-lg text-muted-foreground hover:text-foreground" aria-label="Takaisin adminiin">
                <ChevronLeft className="w-5 h-5" />
              </button>
            </Link>
          )}
          <div>
            <p className="font-semibold leading-tight">Myynti</p>
            <p className="text-xs text-muted-foreground leading-tight">Kerää liidi · {profile?.name}</p>
          </div>
        </div>
        <button
          onClick={() => setPitch(true)}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
        >
          <Sparkles className="w-4 h-4" /> Näytä esittely
        </button>
      </div>

      <div className="max-w-md mx-auto px-4 pt-5 space-y-5">
        {/* Capture form */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-base font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Uusi liidi</h2>
          <input className={fieldCls} placeholder="Asiakkaan nimi *" value={name} onChange={e => setName(e.target.value)} />
          <input className={fieldCls} placeholder="Puhelin *" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          <input className={fieldCls} placeholder="Osoite" value={address} onChange={e => setAddress(e.target.value)} />
          <input className={fieldCls} placeholder="Sähköposti (valinnainen)" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} />
          <textarea className={fieldCls} rows={2} placeholder="Mitä pestään / työn kuvaus" value={description} onChange={e => setDescription(e.target.value)} />
          <div className="flex items-center gap-2">
            <input className={fieldCls + " flex-1"} placeholder="Arvioitu hinta €" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
            <span className="text-sm text-muted-foreground shrink-0">€ (arvio)</span>
          </div>
          <textarea className={fieldCls} rows={2} placeholder="Muistiinpano (esim. paras soittoaika)" value={notes} onChange={e => setNotes(e.target.value)} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={submit}
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 text-base font-semibold px-4 py-3.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {sending ? <><Loader2 className="w-5 h-5 animate-spin" /> Lähetetään…</>
              : justSent ? <><Check className="w-5 h-5" /> Lähetetty!</>
              : "Lähetä tarkistettavaksi"}
          </button>
          <p className="text-xs text-muted-foreground text-center">Liidi menee Joonatanille ja Matiakselle hyväksyttäväksi.</p>
        </div>

        {/* My leads */}
        <div className="space-y-2">
          <h2 className="text-base font-semibold px-1">{isFounder ? "Kaikki kerätyt liidit" : "Omat liidit"}</h2>
          {loadingLeads ? (
            <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : leads.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1 py-4">Ei vielä liidejä. Kerää ensimmäinen yllä!</p>
          ) : (
            leads.map(l => {
              const chip = statusChip(l);
              return (
                <div key={l.id} className="rounded-xl border border-border bg-card p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{l.customer?.name ?? `Keikka #${l.id}`}</p>
                      {l.customer?.address && <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" /> {l.customer.address}</p>}
                      {l.customer?.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" /> {l.customer.phone}</p>}
                    </div>
                    <span className={`text-[11px] font-medium px-2 py-1 rounded-full shrink-0 ${chip.cls}`}>{chip.label}</span>
                  </div>
                  {l.description && <p className="text-sm text-foreground/80 mt-1.5 line-clamp-2">{l.description}</p>}
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-muted-foreground">{l.agreedPrice > 0 ? `Arvio ${eur(l.agreedPrice)}` : "Ei hinta-arviota"}</span>
                    {l.submissionStatus === "approved" && l.marketerCommissionCents != null && (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Palkkio +{eur(l.marketerCommissionCents)}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
