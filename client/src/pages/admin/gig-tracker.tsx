/**
 * Custom gig team tracker (protected)
 *
 * Live counter for the crew: +1 washed / +1 kuntovaraus per sector with undo,
 * running accrual vs cap, activity log, contract view, shareable customer
 * link, and partial-invoice sending (the "every ~100 units" invoice button).
 */

import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft, Plus, Minus, RotateCcw, Share2, Copy, Check, FileText,
  Send, AlertCircle, ChevronDown, Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import {
  emptyGigData, computeTotals, nextInvoiceThreshold, invoiceDue, eur, eur2,
  sanitizeGigData, type GigData,
} from "@shared/gig";

const PUBLIC_BASE = "https://puuhapatet.fi";

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function AdminGigTrackerPage() {
  const [, params] = useRoute("/admin/gig/:id");
  const jobId = Number(params?.id);
  const { toast } = useToast();
  const profile = getAdminProfile();

  const [gig, setGig] = useState<GigData | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showContract, setShowContract] = useState(false);

  // Invoice dialog state
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [invForm, setInvForm] = useState({
    to: "", iban: "", bic: "", viitenumero: "", dueDate: isoPlusDays(14),
    message: "", isFinal: false,
  });

  useEffect(() => {
    if (!jobId) return;
    api.getJobById(jobId).then((res) => {
      if (res.ok && res.data) {
        const data = res.data as any;
        const job = data.job ?? data;
        setToken(job.quoteToken ?? null);
        let parsed: GigData;
        try { parsed = job.gigData ? sanitizeGigData(JSON.parse(job.gigData)) : emptyGigData(); }
        catch { parsed = emptyGigData(); }
        setGig(parsed);
        setInvForm((f) => ({
          ...f,
          to: parsed.company?.email ?? "",
          iban: profile?.iban ?? "",
          bic: profile?.bic ?? "",
          viitenumero: String(jobId),
        }));
      } else {
        toast({ variant: "destructive", title: "Virhe", description: res.error || "Keikkaa ei löytynyt" });
      }
      setLoading(false);
    });
  }, [jobId]);

  // Persist a new gig state (optimistic — local first, then server).
  const persist = async (next: GigData) => {
    setGig(next);
    setSaving(true);
    const res = await api.updateGig(jobId, next);
    setSaving(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
  };

  const adjust = (sectorId: string, field: "washed" | "skipped", delta: number) => {
    if (!gig) return;
    const next = JSON.parse(JSON.stringify(gig)) as GigData;
    const s = next.sectors.find((x) => x.id === sectorId);
    if (!s) return;
    const newVal = (s[field] || 0) + delta;
    if (newVal < 0) return;
    if (delta > 0 && s.washed + s.skipped >= s.total) {
      toast({ variant: "destructive", title: "Sektori täynnä", description: `${s.name}: kaikki ${s.total} yksikköä kirjattu.` });
      return;
    }
    s[field] = newVal;
    const label = field === "washed" ? "pesty" : "kuntovaraus";
    next.log.push({
      t: Date.now(),
      text: `${s.name}: ${delta > 0 ? "+" : ""}${delta} ${label}`,
      by: profile?.name,
    });
    next.updatedAt = Date.now();
    persist(next);
  };

  const resetCounters = () => {
    if (!gig) return;
    const next = JSON.parse(JSON.stringify(gig)) as GigData;
    next.sectors.forEach((s) => { s.washed = 0; s.skipped = 0; });
    next.invoicedThrough = 0;
    next.invoicedCents = 0;
    next.log.push({ t: Date.now(), text: "Laskurit nollattu", by: profile?.name });
    next.updatedAt = Date.now();
    persist(next);
  };

  const shareUrl = token ? `${PUBLIC_BASE}/seuranta/${token}` : "";
  const copyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const sendInvoice = async () => {
    setSending(true);
    const res = await api.sendGigInvoice(jobId, {
      to: invForm.to || undefined,
      iban: invForm.iban || undefined,
      bic: invForm.bic || undefined,
      viitenumero: invForm.viitenumero || undefined,
      dueDate: invForm.dueDate || undefined,
      senderName: profile?.name,
      senderYTunnus: profile?.yTunnus,
      senderAddress: profile?.address,
      workerPhone: profile?.phone,
      message: invForm.message || undefined,
      isFinal: invForm.isFinal,
    });
    setSending(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      setInvoiceOpen(false);
      toast({ title: "Lasku lähetetty", description: `${eur(res.data.amountCents)} → ${invForm.to}` });
    } else {
      toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error });
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background pt-24 text-center text-muted-foreground">Ladataan…</div>;
  }
  if (!gig) {
    return (
      <div className="min-h-screen bg-background pt-24 text-center">
        <p className="text-muted-foreground mb-4">Keikkaa ei löytynyt.</p>
        <Link href="/admin/jobs"><Button variant="outline">Takaisin keikkoihin</Button></Link>
      </div>
    );
  }

  const totals = computeTotals(gig);
  const due = invoiceDue(gig);
  const nextThr = nextInvoiceThreshold(gig);

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/jobs">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground truncate">
              {gig.company?.name || "Sopimuskeikka"}
            </h1>
            <p className="text-sm text-muted-foreground truncate">
              {gig.contractId ? `${gig.contractId} · ` : ""}{gig.company?.contact || ""}
              {saving && <span className="ml-2 text-xs">tallennetaan…</span>}
            </p>
          </div>
        </div>

        {/* Accrual headline */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Kertynyt summa</p>
              <p className="text-4xl font-bold text-foreground tabular-nums leading-tight">{eur(totals.accruedCents)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Hintakatto</p>
              <p className="text-lg font-semibold text-muted-foreground tabular-nums">{eur(totals.capCents)}</p>
            </div>
          </div>
          {/* Segmented bar */}
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden flex">
            {gig.sectors.map((s) => {
              const pct = totals.capCents > 0 ? (s.washed * s.unitPriceCents) / totals.capCents * 100 : 0;
              return <div key={s.id} style={{ width: `${pct}%`, background: s.color }} className="h-full" />;
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-muted-foreground">{totals.washedTotal} / {totals.unitTotal} pesty</span>
            <span className="text-foreground font-medium">{Math.round(totals.percentByCap * 100)} %</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground">Arvioitu loppusumma</p>
              <p className="text-base font-semibold text-foreground tabular-nums">{eur(totals.estimatedFinalCents)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Hyvitykset (kuntovaraus)</p>
              <p className="text-base font-semibold text-foreground tabular-nums">−{eur(totals.creditCents)}</p>
            </div>
          </div>
        </Card>

        {/* Share link */}
        <Card className="p-4 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Share2 className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Asiakkaan live-linkki</p>
          </div>
          <div className="flex items-center gap-2">
            <Input readOnly value={shareUrl} className="text-xs" />
            <Button variant="outline" size="icon" onClick={copyLink}>
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </Card>

        {/* Sector counters */}
        <div className="space-y-3 mb-4">
          {gig.sectors.map((s) => {
            const accrued = s.washed * s.unitPriceCents;
            const cap = s.total * s.unitPriceCents;
            const credit = s.skipped * s.unitPriceCents;
            const pct = s.total > 0 ? Math.round((s.washed / s.total) * 100) : 0;
            const full = s.washed + s.skipped >= s.total;
            return (
              <Card key={s.id} className="p-4 bg-card border-0 premium-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                    <p className="font-medium text-foreground truncate">{s.name}</p>
                  </div>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {eur(accrued)} <span className="opacity-60">/ {eur(cap)}</span>
                  </p>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden mb-3">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                </div>

                {/* Washed control */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground">Pesty <strong className="tabular-nums">{s.washed}</strong> / {s.total}</span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => adjust(s.id, "washed", -1)} disabled={s.washed <= 0}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Button size="icon" className="h-9 w-9" style={{ background: s.color }} onClick={() => adjust(s.id, "washed", 1)} disabled={full}>
                      <Plus className="w-4 h-4 text-white" />
                    </Button>
                  </div>
                </div>
                {/* Kuntovaraus control */}
                <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">
                    Kuntovaraus <strong className="tabular-nums">{s.skipped}</strong>
                    {credit > 0 && <span className="text-xs"> · hyvitys −{eur(credit)}</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => adjust(s.id, "skipped", -1)} disabled={s.skipped <= 0}>
                      <Minus className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => adjust(s.id, "skipped", 1)} disabled={full}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Invoicing */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-foreground">Laskutus</h2>
          </div>
          {due && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Laskutusraja ylittynyt ({totals.washedTotal} ≥ {nextThr}). Muodosta osalasku kertyneestä summasta.
              </p>
            </div>
          )}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Laskuttamatta</span>
            <span className="text-lg font-bold text-foreground tabular-nums">{eur(totals.uninvoicedCents)}</span>
          </div>
          {gig.invoicedCents > 0 && (
            <p className="text-xs text-muted-foreground mb-3">Jo laskutettu: {eur(gig.invoicedCents)} ({gig.payments.length} laskua)</p>
          )}
          <Button className="w-full" disabled={totals.uninvoicedCents <= 0} onClick={() => setInvoiceOpen(true)}>
            <Send className="w-4 h-4 mr-2" /> Lähetä lasku sähköpostilla
          </Button>
        </Card>

        {/* Contract */}
        {gig.contractText && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-4">
            <button className="flex items-center justify-between w-full" onClick={() => setShowContract((v) => !v)}>
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FileText className="w-4 h-4 text-muted-foreground" /> Sopimusteksti
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showContract ? "rotate-180" : ""}`} />
            </button>
            {showContract && (
              <pre className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed max-h-96 overflow-y-auto">{gig.contractText}</pre>
            )}
          </Card>
        )}

        {/* Activity log */}
        <Card className="p-4 bg-card border-0 premium-shadow mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Loki</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {[...gig.log].reverse().slice(0, 60).map((l, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-foreground">{l.text}{l.by ? ` · ${l.by.split(" ")[0]}` : ""}</span>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {new Date(l.t).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
            {gig.log.length === 0 && <p className="text-xs text-muted-foreground">Ei merkintöjä vielä.</p>}
          </div>
        </Card>

        {/* Reset */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="w-full text-muted-foreground">
              <RotateCcw className="w-4 h-4 mr-2" /> Nollaa laskurit
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Nollaa laskurit?</AlertDialogTitle>
              <AlertDialogDescription>
                Tämä nollaa kaikkien sektoreiden pesty- ja kuntovaraus­laskurit sekä laskutustilanteen. Sopimustietoja ei poisteta.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Peruuta</AlertDialogCancel>
              <AlertDialogAction onClick={resetCounters}>Nollaa</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Invoice dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lähetä lasku</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted p-3 text-center">
              <p className="text-xs text-muted-foreground">Laskutettava summa</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">{eur2(totals.uninvoicedCents)}</p>
            </div>
            <div>
              <Label className="text-xs">Vastaanottaja *</Label>
              <Input type="email" value={invForm.to} onChange={(e) => setInvForm({ ...invForm, to: e.target.value })} placeholder="laskut@yritys.fi" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">IBAN</Label>
                <Input value={invForm.iban} onChange={(e) => setInvForm({ ...invForm, iban: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">BIC</Label>
                <Input value={invForm.bic} onChange={(e) => setInvForm({ ...invForm, bic: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Viitenumero</Label>
                <Input value={invForm.viitenumero} onChange={(e) => setInvForm({ ...invForm, viitenumero: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Eräpäivä</Label>
                <Input type="date" value={invForm.dueDate} onChange={(e) => setInvForm({ ...invForm, dueDate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Viesti (valinnainen)</Label>
              <Textarea rows={2} value={invForm.message} onChange={(e) => setInvForm({ ...invForm, message: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={invForm.isFinal} onChange={(e) => setInvForm({ ...invForm, isFinal: e.target.checked })} />
              Loppulasku (työ valmis)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Peruuta</Button>
            <Button disabled={sending || !invForm.to} onClick={sendInvoice}>
              {sending ? "Lähetetään…" : "Lähetä lasku"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
