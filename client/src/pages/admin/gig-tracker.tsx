/**
 * Custom gig team tracker (protected)
 *
 * Live counter for the crew: +1 washed / +1 kuntovaraus per sector with undo,
 * running accrual vs cap, activity log, contract view, shareable customer
 * link, and partial-invoice sending (the "every ~100 units" invoice button).
 */

import { useEffect, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Share2, Copy, Check, FileText,
  Send, AlertCircle, ChevronDown, Receipt, ExternalLink, ChevronRight,
} from "lucide-react";
import { GIG_TOOLS, type GigToolId } from "@/lib/gig-tools";
import GigToolsOverlay from "@/components/gig-tools/GigToolsOverlay";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
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
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const { toast } = useToast();
  const profile = getAdminProfile();

  // Which panel tool the full-screen tools overlay is showing (null = closed).
  const [toolsOpen, setToolsOpen] = useState<GigToolId | null>(null);

  const [gig, setGig] = useState<GigData | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
            </p>
          </div>
        </div>

        {/* Gig tools — opens each tool as its own full-screen view so the admin
            UI underneath is never disturbed. Route tools navigate; panel tools
            open the overlay. */}
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Työkalut</p>
          <span className="text-xs text-muted-foreground">{GIG_TOOLS.length} työkalua</span>
        </div>
        <div className="space-y-2.5 mb-6">
          {GIG_TOOLS.map((t, i) => {
            const Icon = t.icon;
            const onOpen = () => {
              if (t.kind === "route" && t.route) navigate(t.route(jobId));
              else setToolsOpen(t.id);
            };
            const primary = i === 0;
            return (
              <button
                key={t.id}
                onClick={onOpen}
                className={`w-full group flex items-center gap-4 rounded-2xl p-4 text-left transition-all active:scale-[0.99] premium-shadow ${
                  primary
                    ? "bg-gradient-to-br from-zinc-900 to-zinc-800 dark:from-zinc-900 dark:to-black text-white hover:brightness-110"
                    : "bg-card text-foreground hover:bg-accent"
                }`}
              >
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: primary ? "rgba(255,255,255,0.1)" : `rgba(${t.accent},0.12)`,
                    color: primary ? "#fff" : `rgb(${t.accent})`,
                  }}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t.title}</p>
                  <p className={`text-sm truncate ${primary ? "text-white/60" : "text-muted-foreground"}`}>{t.subtitle}</p>
                </div>
                <ChevronRight className={`h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 ${primary ? "text-white/50" : "text-muted-foreground"}`} />
              </button>
            );
          })}
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
            <Input readOnly value={shareUrl} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" size="icon" onClick={copyLink} aria-label="Kopioi linkki">
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
            {shareUrl && (
              <a href={shareUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="icon" aria-label="Avaa asiakkaan näkymä">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Jaa tämä linkki asiakkaalle — näkymä päivittyy itsestään.</p>
        </Card>

        {/* Per-floor progress — read-only; window marking happens in the toolkit */}
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Edistyminen kerroksittain</p>
          <span className="text-xs text-muted-foreground">Merkinnät projektinäkymässä</span>
        </div>
        <div className="space-y-3 mb-4">
          {gig.sectors.length === 0 && (
            <Card className="p-4 bg-card border-0 premium-shadow">
              <p className="text-sm text-muted-foreground">
                Ei vielä ikkunatietoja. Avaa projektinäkymä ja merkitse ikkunat — edistyminen ja laskutus päivittyvät tänne automaattisesti.
              </p>
            </Card>
          )}
          {gig.sectors.map((s) => {
            const accrued = s.washed * s.unitPriceCents;
            const cap = s.total * s.unitPriceCents;
            const credit = s.skipped * s.unitPriceCents;
            const pct = s.total > 0 ? Math.round((s.washed / s.total) * 100) : 0;
            const remaining = Math.max(0, s.total - s.washed - s.skipped);
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
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">Pesty <strong className="tabular-nums text-base">{s.washed}</strong> <span className="text-muted-foreground">/ {s.total}</span></span>
                  <span className="text-xs text-muted-foreground tabular-nums">{pct} % · {remaining} jäljellä</span>
                </div>
                {s.skipped > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">Kuntovaraus {s.skipped} · hyvitys −{eur(credit)}</p>
                )}
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
          {totals.invoicedCents > 0 && (
            <p className="text-xs text-muted-foreground mb-3">Jo laskutettu: {eur(totals.invoicedCents)} ({gig.payments.length} laskua)</p>
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

      {/* Full-screen gig tools overlay (panel tools) */}
      {toolsOpen && (
        <GigToolsOverlay
          jobId={jobId}
          title={gig.company?.name || "Sopimuskeikka"}
          initialToolId={toolsOpen}
          onClose={() => setToolsOpen(null)}
        />
      )}
    </div>
  );
}
