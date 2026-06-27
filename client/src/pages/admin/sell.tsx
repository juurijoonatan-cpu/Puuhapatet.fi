/**
 * Myyntipaneeli — door-to-door marketer panel.
 *
 * A polished, mobile-first tool for marketers in the field:
 *  • a small dashboard of their performance (leads / approved / commission),
 *  • a price calculator + location assessment for building an offer,
 *  • capture → submit for founder triage, with a shareable offer link,
 *  • their own leads list with status, commission and the share link.
 * Marketers are locked to this route (see protected-route); founders can also
 * open it to capture a lead themselves.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, Check, MapPin, Phone, Plus, ChevronLeft, Sparkles, Calculator,
  ExternalLink, Share2, Copy, ClipboardList, CheckCircle2, Clock, Euro,
} from "lucide-react";
import { getAdminProfile } from "@/lib/admin-profile";
import { API_BASE, withAuth } from "@/lib/api";
import { PitchDeck } from "@/components/pitch-deck";
import {
  HOUSE_TYPES, SQM_RANGES, SERVICE_TIERS, HEIGHT_OPTS, AREA_TIERS, ADDONS,
  computeOfferCents, type HouseKey, type TierKey, type HeightKey, type AreaKey, type AddonKey,
} from "@shared/pricing";

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
  quoteToken: string | null;
  quoteStatus: string | null;
  customer: { name: string; address: string; phone: string } | null;
}

const eur = (cents: number) =>
  (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";

const offerUrl = (token: string) =>
  `${typeof window !== "undefined" ? window.location.origin : "https://puuhapatet.fi"}/tarjous/${token}`;

function statusChip(l: LeadRow): { label: string; cls: string } {
  if (l.submissionStatus === "pending_review") return { label: "Odottaa tarkistusta", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" };
  if (l.submissionStatus === "rejected") return { label: "Hylätty", cls: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" };
  if (l.submissionStatus === "approved") return { label: "Hyväksytty ✓", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" };
  return { label: l.status, cls: "bg-muted text-muted-foreground" };
}

export default function SellPage() {
  const profile = typeof window !== "undefined" ? getAdminProfile() : null;
  const isFounder = profile?.role === "HOST";

  // Capture fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");

  // Calculator
  const [calcOpen, setCalcOpen] = useState(false);
  const [house, setHouse] = useState<HouseKey>("omakoti");
  const [sqmIndex, setSqmIndex] = useState(0);
  const [tier, setTier] = useState<TierKey>("all");
  const [height, setHeight] = useState<HeightKey>("ground");
  const [area, setArea] = useState<AreaKey>("normal");
  const [addons, setAddons] = useState<AddonKey[]>([]);

  const calcCents = useMemo(
    () => computeOfferCents({ house, sqmIndex, tier, height, area, addons }),
    [house, sqmIndex, tier, height, area, addons],
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastShare, setLastShare] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pitch, setPitch] = useState(false);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const topRef = useRef<HTMLDivElement>(null);

  async function loadLeads() {
    try {
      const res = await fetch(`${API_BASE}/api/marketer/leads`, { headers: withAuth() });
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoadingLeads(false); }
  }
  useEffect(() => { loadLeads(); }, []);

  // Dashboard stats from the leads list.
  const stats = useMemo(() => {
    const approved = leads.filter(l => l.submissionStatus === "approved");
    return {
      total: leads.length,
      pending: leads.filter(l => l.submissionStatus === "pending_review").length,
      approved: approved.length,
      commission: approved.reduce((s, l) => s + (l.marketerCommissionCents || 0), 0),
    };
  }, [leads]);

  function toggleAddon(k: AddonKey) {
    setAddons(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  }

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600); } catch { /* ignore */ }
  }

  function resetForm() {
    setName(""); setPhone(""); setAddress(""); setEmail(""); setDescription(""); setPrice(""); setNotes("");
    setAddons([]); setCalcOpen(false);
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
      setLastShare(data.quoteToken ? offerUrl(data.quoteToken) : null);
      loadLeads();
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError("Yhteysvirhe. Yritä uudelleen.");
    } finally {
      setSending(false);
    }
  }

  const field = "w-full rounded-xl border border-border bg-background px-3.5 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40";
  const chip = (active: boolean) =>
    `px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground/80 hover:border-primary/40"}`;

  if (pitch) return <PitchDeck onClose={() => setPitch(false)} />;

  const ranges = SQM_RANGES[house] || [];

  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
      <div ref={topRef} />
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between" style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2">
          {isFounder && (
            <Link href="/admin/dashboard">
              <button className="p-1.5 -ml-1 rounded-lg text-muted-foreground hover:text-foreground" aria-label="Takaisin adminiin"><ChevronLeft className="w-5 h-5" /></button>
            </Link>
          )}
          <div>
            <p className="font-semibold leading-tight">Myynti</p>
            <p className="text-xs text-muted-foreground leading-tight">{profile?.name}</p>
          </div>
        </div>
        <button onClick={() => setPitch(true)} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/15 transition-colors">
          <Sparkles className="w-4 h-4" /> Näytä esittely
        </button>
      </div>

      <div className="max-w-md mx-auto px-4 pt-5 space-y-5">
        {/* Dashboard */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: ClipboardList, label: isFounder ? "Liidejä yht." : "Kerätyt", val: String(stats.total), tone: "text-foreground" },
            { icon: Clock, label: "Odottaa", val: String(stats.pending), tone: "text-amber-600 dark:text-amber-400" },
            { icon: CheckCircle2, label: "Hyväksytyt", val: String(stats.approved), tone: "text-emerald-600 dark:text-emerald-400" },
            { icon: Euro, label: isFounder ? "Palkkiot (myyjille)" : "Ansaitut palkkiot", val: eur(stats.commission), tone: "text-primary" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-4">
              <s.icon className="w-4 h-4 text-muted-foreground mb-2" />
              <div className={`text-2xl font-bold leading-none ${s.tone}`}>{s.val}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Just-shared offer link */}
        {lastShare && (
          <div className="rounded-2xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5"><Check className="w-4 h-4" /> Liidi lähetetty tarkistukseen</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">Jaa tarjous asiakkaalle linkillä:</p>
            <div className="flex items-center gap-2 mt-2">
              <input readOnly value={lastShare} className="flex-1 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-background px-2.5 py-2 text-xs truncate" />
              <button onClick={() => copy(lastShare, "last")} className="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1">
                {copied === "last" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied === "last" ? "Kopioitu" : "Kopioi"}
              </button>
            </div>
            <div className="flex gap-3 mt-2 text-xs">
              <a href={lastShare} target="_blank" rel="noreferrer" className="text-emerald-700 dark:text-emerald-300 underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Avaa tarjous</a>
              <a href={`https://wa.me/?text=${encodeURIComponent("Tässä tarjouksenne Puuhapateilta: " + lastShare)}`} target="_blank" rel="noreferrer" className="text-emerald-700 dark:text-emerald-300 underline flex items-center gap-1"><Share2 className="w-3 h-3" /> Jaa WhatsAppilla</a>
            </div>
          </div>
        )}

        {/* Capture form */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-base font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> Uusi liidi</h2>
          <input className={field} placeholder="Asiakkaan nimi *" value={name} onChange={e => setName(e.target.value)} />
          <input className={field} placeholder="Puhelin *" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          <div className="flex items-center gap-2">
            <input className={field + " flex-1"} placeholder="Osoite" value={address} onChange={e => setAddress(e.target.value)} />
            {address.trim() && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer"
                className="shrink-0 px-3 py-3 rounded-xl bg-muted text-foreground/80 text-sm flex items-center gap-1" title="Avaa kartalla">
                <MapPin className="w-4 h-4" />
              </a>
            )}
          </div>
          <input className={field} placeholder="Sähköposti (valinnainen)" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} />
          <textarea className={field} rows={2} placeholder="Mitä pestään / työn kuvaus" value={description} onChange={e => setDescription(e.target.value)} />

          {/* Calculator toggle */}
          <button onClick={() => setCalcOpen(o => !o)} className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl border border-dashed border-primary/40 text-sm font-medium text-primary">
            <span className="flex items-center gap-2"><Calculator className="w-4 h-4" /> Hintalaskuri</span>
            <span>{calcOpen ? "Piilota" : "Avaa"}</span>
          </button>

          {calcOpen && (
            <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Kohdetyyppi</p>
                <div className="flex flex-wrap gap-2">
                  {HOUSE_TYPES.map(h => (
                    <button key={h.key} className={chip(house === h.key)} onClick={() => { setHouse(h.key); setSqmIndex(0); }}>{h.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Koko</p>
                <select className={field} value={sqmIndex} onChange={e => setSqmIndex(Number(e.target.value))}>
                  {ranges.map((r, i) => <option key={r.label} value={i}>{r.label} — {r.price} €</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Pinnat</p>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_TIERS.map(t => <button key={t.key} className={chip(tier === t.key)} onClick={() => setTier(t.key)}>{t.label}</button>)}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Korkeus</p>
                <div className="flex flex-wrap gap-2">
                  {HEIGHT_OPTS.map(h => <button key={h.key} className={chip(height === h.key)} onClick={() => setHeight(h.key)}>{h.label}</button>)}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Alue (sijainnin arvio)</p>
                <div className="flex flex-wrap gap-2">
                  {AREA_TIERS.map(a => <button key={a.key} className={chip(area === a.key)} onClick={() => setArea(a.key)}>{a.label}</button>)}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Lisäpalvelut</p>
                <div className="flex flex-wrap gap-2">
                  {ADDONS.map(a => <button key={a.key} className={chip(addons.includes(a.key))} onClick={() => toggleAddon(a.key)}>{a.label} +{a.price}€</button>)}
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground">Arvio</p>
                  <p className="text-xl font-bold text-primary">{eur(calcCents)}</p>
                </div>
                <button onClick={() => setPrice(String(Math.round(calcCents / 100)))} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
                  Käytä hintana
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input className={field + " flex-1"} placeholder="Tarjottu hinta €" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
            <span className="text-sm text-muted-foreground shrink-0">€</span>
          </div>
          <textarea className={field} rows={2} placeholder="Muistiinpano (esim. paras soittoaika)" value={notes} onChange={e => setNotes(e.target.value)} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button onClick={submit} disabled={sending}
            className="w-full flex items-center justify-center gap-2 text-base font-semibold px-4 py-3.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50">
            {sending ? <><Loader2 className="w-5 h-5 animate-spin" /> Lähetetään…</> : "Lähetä tarkistukseen + luo tarjouslinkki"}
          </button>
          <p className="text-xs text-muted-foreground text-center">Liidi menee Joonatanille ja Matiakselle hyväksyttäväksi. Saat jaettavan tarjouslinkin heti.</p>
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
              const c = statusChip(l);
              const share = l.quoteToken ? offerUrl(l.quoteToken) : null;
              return (
                <div key={l.id} className="rounded-xl border border-border bg-card p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{l.customer?.name ?? `Keikka #${l.id}`}</p>
                      {l.customer?.address && <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" /> {l.customer.address}</p>}
                      {l.customer?.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" /> {l.customer.phone}</p>}
                    </div>
                    <span className={`text-[11px] font-medium px-2 py-1 rounded-full shrink-0 ${c.cls}`}>{c.label}</span>
                  </div>
                  {l.description && <p className="text-sm text-foreground/80 mt-1.5 line-clamp-2">{l.description}</p>}
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-muted-foreground">{l.agreedPrice > 0 ? `Tarjous ${eur(l.agreedPrice)}` : "Ei hintaa"}</span>
                    {l.submissionStatus === "approved" && l.marketerCommissionCents != null && (
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Palkkio +{eur(l.marketerCommissionCents)}</span>
                    )}
                  </div>
                  {share && (
                    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border text-xs">
                      <button onClick={() => copy(share, `l${l.id}`)} className="text-primary flex items-center gap-1">
                        {copied === `l${l.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === `l${l.id}` ? "Kopioitu" : "Kopioi linkki"}
                      </button>
                      <a href={share} target="_blank" rel="noreferrer" className="text-muted-foreground flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Avaa tarjous</a>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
