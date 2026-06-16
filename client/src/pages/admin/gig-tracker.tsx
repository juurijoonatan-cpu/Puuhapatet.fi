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
  ArrowLeft, Share2, Copy, Check, FileText,
  Send, AlertCircle, ChevronDown, Receipt, ExternalLink, LayoutDashboard, ChevronRight,
  PenLine, ShieldCheck, Clock,
} from "lucide-react";
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
  sanitizeGigData, gigStatus, type GigData,
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
  const [copied, setCopied] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);

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

  const approve = async (approved: boolean) => {
    setApproving(true);
    const res = await api.approveGig(jobId, { approved, by: profile?.name });
    setApproving(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      toast({ title: approved ? "Keikka hyväksytty" : "Hyväksyntä peruttu" });
    } else {
      toast({ variant: "destructive", title: "Toiminto epäonnistui", description: res.error });
    }
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

        {/* Open project view — floor-plan mapping, dashboard & work hours */}
        <Link href={`/admin/gig/${jobId}/projekti`}>
          <button className="w-full mb-4 group flex items-center gap-4 rounded-2xl p-4 text-left transition-all active:scale-[0.99] bg-gradient-to-br from-zinc-900 to-zinc-800 dark:from-zinc-900 dark:to-black text-white premium-shadow hover:brightness-110">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Avaa projektinäkymä</p>
              <p className="text-sm text-white/60 truncate">Pohjapiirros & ikkunakartta · kojelauta · työtunnit</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-white/50 transition-transform group-hover:translate-x-0.5" />
          </button>
        </Link>

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

        {/* Signing & approval status */}
        {(() => {
          const status = gigStatus(gig);
          const sig = gig.signature;
          const appr = gig.approval;
          return (
            <Card className="p-4 bg-card border-0 premium-shadow mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <PenLine className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Sopimus & hyväksyntä</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 ${
                    status === "approved"
                      ? "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
                      : status === "signed"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {status === "approved" ? <ShieldCheck className="w-3.5 h-3.5" /> : status === "signed" ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  {status === "approved" ? "Hyväksytty" : status === "signed" ? "Allekirjoitettu" : "Odottaa allekirjoitusta"}
                </span>
              </div>

              {sig ? (
                <div className="text-sm space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-foreground font-medium truncate">{sig.customer.legalName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        Allekirjoitti {sig.signerName}
                        {sig.place ? ` · ${sig.place}` : ""} · {new Date(sig.signedAt).toLocaleString("fi-FI")}
                      </p>
                      {sig.customer.businessId && <p className="text-xs text-muted-foreground">Y-tunnus {sig.customer.businessId}</p>}
                      {sig.customer.eInvoice && <p className="text-xs text-muted-foreground truncate">Lasku: {sig.customer.eInvoice}</p>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSigOpen(true)} className="shrink-0">
                      <FileText className="w-3.5 h-3.5 mr-1.5" /> Näytä
                    </Button>
                  </div>

                  {appr ? (
                    <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-border">
                      <p className="text-xs text-sky-700 dark:text-sky-300">
                        Hyväksytty {new Date(appr.approvedAt).toLocaleDateString("fi-FI")}{appr.by ? ` · ${appr.by}` : ""}
                      </p>
                      <Button variant="ghost" size="sm" disabled={approving} onClick={() => approve(false)} className="text-muted-foreground">
                        Peru hyväksyntä
                      </Button>
                    </div>
                  ) : (
                    <Button className="w-full mt-2" disabled={approving} onClick={() => approve(true)}>
                      <ShieldCheck className="w-4 h-4 mr-2" /> {approving ? "Hyväksytään…" : "Hyväksy keikka"}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Asiakas ei ole vielä allekirjoittanut. Jaa live-linkki — asiakas lukee ja allekirjoittaa sopimuksen,
                  jonka jälkeen seurantanäkymä avautuu hänelle.
                </p>
              )}
            </Card>
          );
        })()}

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

      {/* Signature viewer */}
      <Dialog open={sigOpen} onOpenChange={setSigOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Allekirjoitettu sopimus</DialogTitle>
          </DialogHeader>
          {gig.signature && (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-border bg-white p-3">
                <img src={gig.signature.signatureDataUrl} alt="Allekirjoitus" className="max-h-32 mx-auto" />
              </div>
              <div className="space-y-1">
                <Row k="Tilaaja" v={gig.signature.customer.legalName} />
                <Row k="Allekirjoittaja" v={gig.signature.signerName} />
                {gig.signature.customer.businessId && <Row k="Y-tunnus" v={gig.signature.customer.businessId} />}
                {gig.signature.customer.contactPerson && <Row k="Yhteyshenkilö" v={gig.signature.customer.contactPerson} />}
                {gig.signature.customer.billingAddress && <Row k="Laskutusosoite" v={gig.signature.customer.billingAddress} />}
                {gig.signature.customer.eInvoice && <Row k="Verkkolasku / sähköposti" v={gig.signature.customer.eInvoice} />}
                <Row k="Paikka ja aika" v={`${gig.signature.place ? gig.signature.place + " · " : ""}${new Date(gig.signature.signedAt).toLocaleString("fi-FI")}`} />
                {gig.signature.ip && <Row k="IP" v={gig.signature.ip} />}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSigOpen(false)}>Sulje</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{k}</span>
      <span className="text-foreground text-right break-words">{v}</span>
    </div>
  );
}
