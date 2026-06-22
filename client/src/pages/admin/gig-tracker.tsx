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
  PenLine, ShieldCheck, Clock, Save, Download, Printer, LayoutDashboard, Users, Loader2,
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
import { useCrewWorkerRedirect } from "@/lib/use-crew-redirect";
import {
  emptyGigData, computeTotals, nextInvoiceThreshold, invoiceDue, eur, eur2,
  sanitizeGigData, gigStatus, signatureRequired, type GigData, type GigCompany,
} from "@shared/gig";
import { computeProjectTotals, fixedDealFor, eurFromCents, type ProjectData } from "@shared/project";
import { downloadGigContract, openGigContractForPrint } from "@/lib/gig-contract-doc";

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
  // Admin-linked workers (e.g. Petrus) get bounced to their own worker dashboard
  // so they never see the gig total or customer price.
  const { checking: crewChecking } = useCrewWorkerRedirect(jobId);


  const [gig, setGig] = useState<GigData | null>(null);
  // Floor-plan project (if any) — its single price/window + dot count drive a
  // floor-plan gig's whole price, so the price editor edits the project here.
  const [project, setProject] = useState<ProjectData | null>(null);
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyDraft, setCompanyDraft] = useState<GigCompany>({});
  const [savingCompany, setSavingCompany] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [savingContract, setSavingContract] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  const [draft, setDraft] = useState({ contractId: "", contractText: "", customerNote: "", vatNote: "", requireSignature: true });

  // Invoice dialog state
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [invForm, setInvForm] = useState({
    to: "", iban: "", bic: "", viitenumero: "", dueDate: isoPlusDays(14),
    message: "", isFinal: false,
  });

  useEffect(() => {
    if (!jobId) return;
    Promise.all([api.getJobById(jobId), api.getProject(jobId)]).then(([res, projRes]) => {
      if (res.ok && res.data) {
        const data = res.data as any;
        const job = data.job ?? data;
        setToken(job.quoteToken ?? null);
        let parsed: GigData;
        try { parsed = job.gigData ? sanitizeGigData(JSON.parse(job.gigData)) : emptyGigData(); }
        catch { parsed = emptyGigData(); }
        setGig(parsed);
        setCompanyDraft(parsed.company ?? {});
        setJobDescription(job.description ?? "");
        setDraft({
          contractId: parsed.contractId ?? "",
          contractText: parsed.contractText ?? "",
          customerNote: parsed.customerNote ?? "",
          vatNote: parsed.vatNote ?? "",
          requireSignature: signatureRequired(parsed),
        });
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
      if (projRes.ok && projRes.data?.project) setProject(projRes.data.project);
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

  const saveContract = async () => {
    if (!gig) return;
    setSavingContract(true);
    const updated: GigData = {
      ...gig,
      contractId: draft.contractId.trim() || undefined,
      contractText: draft.contractText.trim() || undefined,
      customerNote: draft.customerNote.trim() || undefined,
      vatNote: draft.vatNote.trim() || undefined,
      requireSignature: draft.requireSignature,
    };
    const res = await api.updateGig(jobId, updated);
    setSavingContract(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      toast({ title: "Sopimus tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
  };

  const saveCompany = async () => {
    if (!gig) return;
    setSavingCompany(true);
    const res = await api.updateGig(jobId, { ...gig, company: companyDraft });
    setSavingCompany(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      setEditingCompany(false);
      toast({ title: "Yhteystiedot tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
  };

  const saveDescription = async () => {
    setSavingDescription(true);
    const res = await api.updateJob(jobId, { description: jobDescription.trim() || undefined });
    setSavingDescription(false);
    if (res.ok) {
      toast({ title: "Kuvaus tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: (res as any).error });
    }
  };

  // Save just the sector prices/totals (the two price pieces). Writes to the
  // shared gigData so the project view + accrual stay in sync both ways.
  const savePrices = async (sectors: { id: string; unitPriceCents: number; total: number }[]) => {
    if (!gig) return;
    setSavingPrices(true);
    const byId = new Map(sectors.map((s) => [s.id, s]));
    const updated: GigData = {
      ...gig,
      sectors: gig.sectors.map((s) => {
        const next = byId.get(s.id);
        return next ? { ...s, unitPriceCents: next.unitPriceCents, total: next.total } : s;
      }),
    };
    const res = await api.updateGig(jobId, updated);
    setSavingPrices(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      toast({ title: "Hinnat tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
  };

  // Floor-plan gigs price every window at one rate (project.pricePerWindow) and
  // cap at (live window count × rate). Save the rate on the PROJECT so the
  // server's sync re-derives the gig sectors and it survives — editing it on the
  // gig directly would be overwritten on the next map/status change.
  const savePricePerWindow = async (euros: number) => {
    if (!project) return;
    setSavingPrices(true);
    const rate = Math.max(0, Math.round(euros * 100) / 100);
    const nextProject: ProjectData = { ...project, pricePerWindow: rate, updatedAt: Date.now() };
    const res = await api.updateProject(jobId, nextProject);
    if (res.ok && res.data) {
      setProject(res.data.project);
      // Server re-synced the gig sectors from the project; refresh the gig so the
      // cap / accrued shown here (and the customer view) match to the cent.
      const jr = await api.getJobById(jobId);
      if (jr.ok && jr.data) {
        const data = jr.data as any;
        const job = data.job ?? data;
        try { setGig(sanitizeGigData(JSON.parse(job.gigData))); } catch { /* keep current */ }
      }
      toast({ title: "Hinta tallennettu", description: "Näkyy heti projektinäkymässä ja asiakkaan linkissä." });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
    setSavingPrices(false);
  };

  const docInput = () => {
    const g = gig!;
    const t = computeTotals(g);
    return {
      contractId: g.contractId ?? null,
      companyName: g.company?.name ?? null,
      description: null,
      vatNote: g.vatNote ?? null,
      customerNote: g.customerNote ?? null,
      contractText: g.contractText ?? null,
      sectors: g.sectors.map((s) => ({ name: s.name, unitLabel: s.unitLabel, total: s.total, unitPriceCents: s.unitPriceCents })),
      capCents: t.capCents,
      signature: g.signature ? {
        signerName: g.signature.signerName,
        signerTitle: g.signature.signerTitle,
        place: g.signature.place,
        signedAt: g.signature.signedAt,
        customer: g.signature.customer,
        signatureDataUrl: g.signature.signatureDataUrl,
      } : null,
      approvedAt: g.approval?.approvedAt ?? null,
    };
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
      billerId: profile?.id, // which leader billed the customer (buyer for alihankkija invoices)
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

  if (loading || crewChecking) {
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
    <div className="min-h-screen bg-background admin-shell-pad">
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

        {/* Customer contact details — editable, sourced from gigData.company. */}
        <Card className="p-4 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Yhteystiedot</p>
            </div>
            {!editingCompany && (
              <Button variant="ghost" size="sm" onClick={() => { setCompanyDraft(gig.company ?? {}); setEditingCompany(true); }} className="text-xs gap-1.5 h-7 px-2">
                <PenLine className="w-3.5 h-3.5" /> Muokkaa
              </Button>
            )}
          </div>
          {editingCompany ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Yritys</Label>
                <Input value={companyDraft.name ?? ""} onChange={e => setCompanyDraft(d => ({ ...d, name: e.target.value }))} placeholder="Yrityksen nimi" className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">Yhteyshenkilö</Label>
                <Input value={companyDraft.contact ?? ""} onChange={e => setCompanyDraft(d => ({ ...d, contact: e.target.value }))} className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">Puhelin</Label>
                <Input type="tel" value={companyDraft.phone ?? ""} onChange={e => setCompanyDraft(d => ({ ...d, phone: e.target.value }))} className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">Sähköposti</Label>
                <Input value={companyDraft.email ?? ""} onChange={e => setCompanyDraft(d => ({ ...d, email: e.target.value }))} placeholder="lasku@yritys.fi" className="text-sm" />
              </div>
              <div>
                <Label className="text-xs">Osoite</Label>
                <Input value={companyDraft.address ?? ""} onChange={e => setCompanyDraft(d => ({ ...d, address: e.target.value }))} className="text-sm" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={saveCompany} disabled={savingCompany} className="flex-1">
                  {savingCompany ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Tallenna
                </Button>
                <Button variant="outline" onClick={() => setEditingCompany(false)} disabled={savingCompany}>
                  Peruuta
                </Button>
              </div>
            </div>
          ) : (() => {
            const c = gig.company;
            const rows: { label: string; value: string }[] = [
              { label: "Yritys", value: c?.name ?? "" },
              { label: "Yhteyshenkilö", value: c?.contact ?? "" },
              { label: "Puhelin", value: c?.phone ?? "" },
              { label: "Sähköposti", value: c?.email ?? "" },
              { label: "Osoite", value: c?.address ?? "" },
            ].filter((r) => r.value.trim());
            if (!rows.length) return <p className="text-sm text-muted-foreground">Ei yhteystietoja. Paina Muokkaa lisätäksesi.</p>;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {rows.map((r) => {
                  const isPhone = r.label === "Puhelin";
                  const isEmail = r.label === "Sähköposti";
                  const href = isPhone ? `tel:${r.value.replace(/\s+/g, "")}` : isEmail ? `mailto:${r.value}` : null;
                  return (
                    <div key={r.label} className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
                      {href ? (
                        <a href={href} className="text-sm font-medium text-foreground hover:underline break-words">{r.value}</a>
                      ) : (
                        <p className="text-sm font-medium text-foreground break-words">{r.value}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </Card>

        {/* Quick price editor — tweak the deal fast right before signing. For a
            floor-plan gig it edits the single €/window + total cap (saved on the
            project, so adding/removing windows on the map stays the source of
            truth); for a manual gig it edits per-sector unit price + cap. */}
        {(() => {
          const projTotals = project ? computeProjectTotals(project) : null;
          const floorMode = !!(project && projTotals && projTotals.total > 0);
          const deal = project ? fixedDealFor(project) : null;
          // A signed, fixed-price deal (FR8) is locked — show it read-only.
          if (deal) {
            return (
              <Card className="p-4 bg-card border-0 premium-shadow mb-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Receipt className="w-4 h-4 text-muted-foreground" /> Hinta &amp; katto
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    🔒 Sovittu sopimuksessa
                  </span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Allekirjoitettu kiinteä hinta. {eurFromCents(Math.round(deal.pricePerWindow * 100))} per punainen ikkuna,
                  kokonaiskatto {eurFromCents(deal.capCents)}. Keltaiset ikkunat eivät kuulu tähän sopimukseen.
                  Hintaa ei voi muokata.
                </p>
              </Card>
            );
          }
          return (
            <PriceEditor
              gig={gig}
              floorMode={floorMode}
              windowCount={projTotals?.total ?? 0}
              pricePerWindow={project?.pricePerWindow ?? 0}
              onSavePerWindow={savePricePerWindow}
              onSave={savePrices}
              saving={savingPrices}
              onOpenMap={() => navigate(`/admin/gig/${jobId}/projekti`)}
            />
          );
        })()}

        {/* Gig tools — the project dashboard is the one main button, plus a
            compact "Tiimi" button. Layout scales down cleanly on mobile. */}
        <div className="flex items-stretch gap-2 sm:gap-3 mb-6">
          <button
            onClick={() => navigate(`/admin/gig/${jobId}/projekti`)}
            className="group flex flex-1 min-w-0 items-center gap-3 sm:gap-4 rounded-2xl p-3.5 sm:p-4 text-left transition-all active:scale-[0.99] premium-shadow bg-gradient-to-br from-zinc-900 to-zinc-800 dark:from-zinc-900 dark:to-black text-white hover:brightness-110"
          >
            <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <LayoutDashboard className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight text-[15px] sm:text-base">Avaa projektinäkymä</p>
              <p className="text-xs sm:text-sm text-white/60 truncate">Pohjapiirros &amp; ikkunakartta · kojelauta · työtunnit</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-white/50 transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            onClick={() => navigate(`/admin/gig/${jobId}/tiimi`)}
            aria-label="Tiimi ja työntekijät"
            className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-2xl w-16 sm:w-auto sm:px-5 bg-card text-foreground hover:bg-accent transition-all active:scale-[0.99] premium-shadow"
          >
            <Users className="h-5 w-5" />
            <span className="text-[11px] sm:text-xs font-medium">Tiimi</span>
          </button>
        </div>

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

        {/* Contract — editable; this is what the customer reads & signs */}
        <Card className="p-4 bg-card border-0 premium-shadow mb-4">
          <button className="flex items-center justify-between w-full" onClick={() => setShowContract((v) => !v)}>
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="w-4 h-4 text-muted-foreground" /> Sopimus & asiakasnäkymä
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showContract ? "rotate-180" : ""}`} />
          </button>
          {showContract && (
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-xs">Kuvaus (näkyy keikkalistassa)</Label>
                <div className="flex gap-2">
                  <Input value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Esim. FR8 - Ikkunoiden pesu" className="text-sm" />
                  <Button size="sm" disabled={savingDescription} onClick={saveDescription} className="shrink-0">
                    {savingDescription ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="text-sm">
                  Vaadi sähköinen allekirjoitus
                  <span className="block text-xs text-muted-foreground">Asiakas allekirjoittaa ennen kuin live-näkymä avautuu.</span>
                </span>
                <input type="checkbox" className="h-5 w-5 accent-foreground" checked={draft.requireSignature} onChange={(e) => setDraft({ ...draft, requireSignature: e.target.checked })} />
              </label>
              <div>
                <Label className="text-xs">Sopimustunnus</Label>
                <Input value={draft.contractId} onChange={(e) => setDraft({ ...draft, contractId: e.target.value })} placeholder="Esim. PT-2026-02" />
              </div>
              <div>
                <Label className="text-xs">Sopimusteksti (asiakas näkee ja allekirjoittaa)</Label>
                <Textarea rows={8} value={draft.contractText} onChange={(e) => setDraft({ ...draft, contractText: e.target.value })} className="font-mono text-xs" placeholder="Liitä koko sopimus tähän…" />
              </div>
              <div>
                <Label className="text-xs">Asiakkaalle näytettävä huomautus</Label>
                <Textarea rows={2} value={draft.customerNote} onChange={(e) => setDraft({ ...draft, customerNote: e.target.value })} placeholder="Esim. Maksat vain pestyistä ikkunoista…" />
              </div>
              <div>
                <Label className="text-xs">ALV-huomautus</Label>
                <Input value={draft.vatNote} onChange={(e) => setDraft({ ...draft, vatNote: e.target.value })} />
              </div>
              <Button className="w-full" disabled={savingContract} onClick={saveContract}>
                <Save className="w-4 h-4 mr-2" /> {savingContract ? "Tallennetaan…" : "Tallenna sopimus"}
              </Button>
            </div>
          )}
        </Card>

        {/* Activity log — tucked away; collapsed by default */}
        {gig.log.length > 0 && (
          <Card className="p-4 bg-card border-0 premium-shadow mb-4">
            <button className="flex items-center justify-between w-full" onClick={() => setShowLog((v) => !v)}>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Loki · {gig.log.length}</span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showLog ? "rotate-180" : ""}`} />
            </button>
            {showLog && (
              <div className="space-y-1.5 max-h-72 overflow-y-auto mt-3">
                {[...gig.log].reverse().slice(0, 60).map((l, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{l.text}{l.by ? ` · ${l.by.split(" ")[0]}` : ""}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">
                      {new Date(l.t).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

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
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => openGigContractForPrint(docInput())}>
              <Printer className="w-4 h-4 mr-1.5" /> Tulosta
            </Button>
            <Button variant="outline" onClick={() => downloadGigContract(docInput())}>
              <Download className="w-4 h-4 mr-1.5" /> Lataa
            </Button>
            <Button onClick={() => setSigOpen(false)}>Sulje</Button>
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

/**
 * Quick price editor. Two modes:
 *  - Floor-plan gig (floorMode): one €/window rate + a total cap that
 *    back-computes the rate, plus a jump to the map to add/remove windows.
 *    Saved on the project so the dot map stays the single source of truth.
 *  - Manual gig: per-sector unit price + cap count, saved straight to the gig.
 */
function PriceEditor(props: {
  gig: GigData;
  floorMode: boolean;
  windowCount: number;
  pricePerWindow: number; // euros
  onSavePerWindow: (euros: number) => void;
  onSave: (sectors: { id: string; unitPriceCents: number; total: number }[]) => void;
  saving: boolean;
  onOpenMap: () => void;
}) {
  if (props.floorMode) return <FloorPriceEditor {...props} />;
  return <SectorPriceEditor gig={props.gig} onSave={props.onSave} saving={props.saving} />;
}

/**
 * Floor-plan price editor — the whole job is priced at one €/window rate, and
 * the cap is (live window count × rate). The admin can set either the rate or
 * the total price (which back-computes the rate), and add/remove windows on the
 * map to move the cap. Reducing windows or the rate is exactly how a deal gets
 * trimmed during negotiation.
 */
function FloorPriceEditor({
  windowCount, pricePerWindow, onSavePerWindow, saving, onOpenMap,
}: {
  windowCount: number;
  pricePerWindow: number;
  onSavePerWindow: (euros: number) => void;
  saving: boolean;
  onOpenMap: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [unitStr, setUnitStr] = useState(String(pricePerWindow));
  const [totalStr, setTotalStr] = useState(String(Math.round(pricePerWindow * windowCount)));

  // Re-seed when the saved price / window count changes underneath us.
  useEffect(() => {
    setUnitStr(String(pricePerWindow));
    setTotalStr(String(Math.round(pricePerWindow * windowCount)));
  }, [pricePerWindow, windowCount]);

  const parseEur = (v: string) => {
    const n = parseFloat((v || "").replace(",", ".").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const unit = parseEur(unitStr);
  const onUnit = (v: string) => {
    setUnitStr(v);
    setTotalStr(String(Math.round(parseEur(v) * windowCount)));
  };
  const onTotal = (v: string) => {
    setTotalStr(v);
    const t = parseEur(v);
    setUnitStr(windowCount > 0 ? String(Math.round((t / windowCount) * 100) / 100) : "0");
  };
  const capCents = Math.round(unit * windowCount * 100);
  const dirty = Math.round(unit * 100) !== Math.round(pricePerWindow * 100);

  return (
    <Card className="p-4 bg-card border-0 premium-shadow mb-4">
      <button className="flex items-center justify-between w-full" onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Receipt className="w-4 h-4 text-muted-foreground" /> Hinta &amp; katto
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">Katto {eur(capCents)}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Koko keikka hinnoitellaan yhdellä ikkunahinnalla. Aseta joko hinta per ikkuna tai
            kokonaishinta — toinen lasketaan automaattisesti. Ikkunoiden määrää muutat lisäämällä
            tai poistamalla pisteitä kartalla.
          </p>

          {/* Window count → drives the cap. Editable on the map. */}
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Ikkunoita (katto)</p>
              <p className="text-lg font-bold text-foreground tabular-nums">{windowCount} kpl</p>
            </div>
            <Button variant="outline" size="sm" onClick={onOpenMap} className="shrink-0">
              <LayoutDashboard className="w-3.5 h-3.5 mr-1.5" /> Lisää / poista kartalla
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">€ / ikkuna</Label>
              <Input inputMode="decimal" value={unitStr} onChange={(e) => onUnit(e.target.value)} placeholder="esim. 35" />
            </div>
            <div>
              <Label className="text-xs">Kokonaishinta (katto)</Label>
              <Input inputMode="decimal" value={totalStr} onChange={(e) => onTotal(e.target.value)} placeholder="esim. 4095" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-muted-foreground">{windowCount} × {eur(Math.round(unit * 100))}</span>
            <span className="text-lg font-bold text-foreground tabular-nums">{eur(capCents)}</span>
          </div>
          <Button className="w-full" disabled={saving || !dirty} onClick={() => onSavePerWindow(unit)}>
            <Save className="w-4 h-4 mr-2" /> {saving ? "Tallennetaan…" : "Tallenna hinta"}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Manual per-sector price editor — edit each sector's unit price (€/ikkuna) and
 * its cap count (total). Local draft until "Tallenna hinnat" writes to the
 * gigData. Used by gigs without a floor-plan map.
 */
function SectorPriceEditor({
  gig, onSave, saving,
}: {
  gig: GigData;
  onSave: (sectors: { id: string; unitPriceCents: number; total: number }[]) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Draft strings keyed by sector id. Unit price held in euros (2 dp), total as int.
  const [draft, setDraft] = useState<Record<string, { unit: string; total: string }>>({});

  // Seed/refresh the draft whenever the gig prices change underneath us.
  useEffect(() => {
    const next: Record<string, { unit: string; total: string }> = {};
    for (const s of gig.sectors) {
      next[s.id] = { unit: (s.unitPriceCents / 100).toString(), total: String(s.total) };
    }
    setDraft(next);
  }, [gig.sectors]);

  if (gig.sectors.length === 0) return null;

  const parseUnitCents = (v: string) => {
    const n = parseFloat((v || "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  };
  const parseTotal = (v: string) => {
    const n = parseInt((v || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const grandCap = gig.sectors.reduce((sum, s) => {
    const d = draft[s.id];
    return sum + parseUnitCents(d?.unit ?? "") * parseTotal(d?.total ?? "");
  }, 0);

  const dirty = gig.sectors.some((s) => {
    const d = draft[s.id];
    return d && (parseUnitCents(d.unit) !== s.unitPriceCents || parseTotal(d.total) !== s.total);
  });

  const save = () => {
    onSave(gig.sectors.map((s) => {
      const d = draft[s.id];
      return { id: s.id, unitPriceCents: parseUnitCents(d?.unit ?? ""), total: parseTotal(d?.total ?? "") };
    }));
  };

  return (
    <Card className="p-4 bg-card border-0 premium-shadow mb-4">
      <button className="flex items-center justify-between w-full" onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Receipt className="w-4 h-4 text-muted-foreground" /> Hinnat &amp; katto
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">Katto {eur(grandCap)}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Säädä yksikköhintaa ja kattomäärää nopeasti. Tallennus päivittyy myös projektinäkymään.
          </p>
          {gig.sectors.map((s) => {
            const d = draft[s.id] ?? { unit: "", total: "" };
            const cap = parseUnitCents(d.unit) * parseTotal(d.total);
            return (
              <div key={s.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center gap-2 mb-2 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                  <p className="font-medium text-foreground truncate text-sm">{s.name}</p>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">= {eur(cap)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">€ / {s.unitLabel}</Label>
                    <Input
                      inputMode="decimal"
                      value={d.unit}
                      onChange={(e) => setDraft((p) => ({ ...p, [s.id]: { ...d, unit: e.target.value } }))}
                      placeholder="esim. 34"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Katto ({s.unitLabel})</Label>
                    <Input
                      inputMode="numeric"
                      value={d.total}
                      onChange={(e) => setDraft((p) => ({ ...p, [s.id]: { ...d, total: e.target.value } }))}
                      placeholder="esim. 117"
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-muted-foreground">Kokonaiskatto</span>
            <span className="text-lg font-bold text-foreground tabular-nums">{eur(grandCap)}</span>
          </div>
          <Button className="w-full" disabled={saving || !dirty} onClick={save}>
            <Save className="w-4 h-4 mr-2" /> {saving ? "Tallennetaan…" : "Tallenna hinnat"}
          </Button>
        </div>
      )}
    </Card>
  );
}
