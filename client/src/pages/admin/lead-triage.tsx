/**
 * Liidien tarkistus — founder triage of marketer-collected leads.
 *
 * Lists leads with submissionStatus "pending_review" and lets a founder:
 *  • Hyväksy → työntekijöille (approve; invite workers via the normal flow)
 *  • Ota itselle (approve + assign to self + schedule)
 *  • Hylkää (reject)
 * Approval snapshots the marketer's flat commission server-side.
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, MapPin, Phone, Check, X, UserCheck, Users } from "lucide-react";
import { getAdminProfile, canApproveLeads, USERS } from "@/lib/admin-profile";
import { API_BASE, withAuth } from "@/lib/api";

interface LeadRow {
  id: number;
  status: string;
  submissionStatus: string | null;
  description: string;
  agreedPrice: number;
  marketerId: string | null;
  submittedBy: string | null;
  customer: { name: string; address: string; phone: string } | null;
}

const eur = (cents: number) =>
  (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";

const nameOf = (id: string | null) => {
  if (!id) return "?";
  const u = USERS.find(u => u.id === id);
  return u ? u.name.split(" ")[0] : id;
};

export default function LeadTriagePage() {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const allowed = !!profile && canApproveLeads(profile.role);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/marketer/leads`, { headers: withAuth() });
      const data = await res.json();
      setLeads(Array.isArray(data) ? data.filter((l: LeadRow) => l.submissionStatus === "pending_review") : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { if (allowed) load(); else setLoading(false); }, [allowed]);

  async function triage(id: number, action: "accept_workers" | "take_self" | "decline") {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}/triage`, {
        method: "POST",
        headers: withAuth({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action }),
      });
      if (res.ok) setLeads(prev => prev.filter(l => l.id !== id));
    } catch { /* ignore */ }
    finally { setBusyId(null); }
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-background admin-shell-pad flex items-center justify-center px-6">
        <p className="text-muted-foreground text-center">Vain perustajat voivat käsitellä liidejä.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background admin-shell-pad">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight">Liidien tarkistus</h1>
          <p className="text-sm text-muted-foreground">Myyjien keräämät liidit — hyväksy, ota itselle tai hylkää.</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Check className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Ei tarkistettavia liidejä juuri nyt.</p>
            <Link href="/admin/jobs"><button className="mt-3 text-sm text-primary underline">Avaa keikat</button></Link>
          </div>
        ) : (
          <div className="space-y-3">
            {leads.map(l => {
              const busy = busyId === l.id;
              return (
                <div key={l.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{l.customer?.name ?? `Keikka #${l.id}`}</p>
                      {l.customer?.address && <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" /> {l.customer.address}</p>}
                      {l.customer?.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" /> {l.customer.phone}</p>}
                    </div>
                    <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground shrink-0">Keräsi {nameOf(l.marketerId || l.submittedBy)}</span>
                  </div>
                  {l.description && <p className="text-sm text-foreground/80 mt-2">{l.description}</p>}
                  <p className="text-sm text-muted-foreground mt-1">{l.agreedPrice > 0 ? `Hinta-arvio ${eur(l.agreedPrice)}` : "Ei hinta-arviota"}</p>

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <button onClick={() => triage(l.id, "accept_workers")} disabled={busy}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />} Työntekijöille
                    </button>
                    <button onClick={() => triage(l.id, "take_self")} disabled={busy}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50 border border-border">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />} Ota itselle
                    </button>
                    <button onClick={() => triage(l.id, "decline")} disabled={busy}
                      className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-destructive/10 text-destructive text-xs font-semibold hover:bg-destructive/20 disabled:opacity-50">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Hylkää
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
