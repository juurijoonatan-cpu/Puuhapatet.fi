/**
 * Custom gig team tracker (protected)
 *
 * Live counter for the crew: +1 washed / +1 kuntovaraus per sector with undo,
 * running accrual vs cap, activity log, contract view, shareable customer
 * link, and partial-invoice sending (the "every ~100 units" invoice button).
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Share2, Copy, Check, FileText,
  Send, AlertCircle, ChevronDown, Receipt, ExternalLink, ChevronRight,
  PenLine, ShieldCheck, Clock, Save, Download, Printer, LayoutDashboard, Users, Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import LoadingOrb from "@/components/LoadingOrb";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { BRAND_BILLERS, resolveBrandBiller, DEFAULT_BILLER_ID } from "@shared/billers";
import { useCrewWorkerRedirect } from "@/lib/use-crew-redirect";
import {
  emptyGigData, computeTotals, nextInvoiceThreshold, invoiceDue, eur, eur2,
  sanitizeGigData, gigStatus, signatureRequired, FR8_CONTRACT_ID, type GigData, type GigCompany,
} from "@shared/gig";
import { computeProjectTotals, fixedDealFor, computeDealBilling, dealAgreedTotalCents, eurFromCents, isHourlyGig, type ProjectData } from "@shared/project";
import { hourlyItemisation } from "@shared/hourly-money";
import { computeP2Billing } from "@shared/p2";
import { p2InvoiceState } from "@shared/worker-payouts";
import { downloadGigContract, openGigContractForPrint } from "@/lib/gig-contract-doc";
import { cn } from "@/lib/utils";

/**
 * Keikan työkalut (pohjakartat, kerrokset, tehokkuus).
 *
 * MIKSI LAZY: työkalupaneeli on koko ruudun tumma kuori omine riippuvuuksineen,
 * eikä sitä tarvita ennen kuin nappia painetaan. Ks. `lazyRetry`-huomio
 * docs/fr8-jarjestelma-yleiskuva.md ("Julkaisu ja Importing a module script
 * failed") — Suspense-fallback pitää virhesivun poissa julkaisun aikana.
 */
const GigToolsOverlay = lazy(() => import("@/components/gig-tools/GigToolsOverlay"));

const PUBLIC_BASE = "https://puuhapatet.fi";

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Split a recipient field into individual addresses. The customer often has two
 *  contact people, entered as "a@x.fi & b@x.fi" / comma- / semicolon-separated. */
function parseEmailList(s: string): string[] {
  return Array.from(new Set(
    String(s).split(/[\s,;&]+/).map((e) => e.trim()).filter((e) => e.includes("@")),
  ));
}

export default function AdminGigTrackerPage() {
  const [, params] = useRoute("/admin/gig/:id");
  const [, navigate] = useLocation();
  const jobId = Number(params?.id);
  const { toast } = useToast();
  const profile = getAdminProfile();
  // Admin-linked workers (e.g. Petrus) don't get the host view (no gig total /
  // customer price). Instead of force-redirecting, we keep them in their normal
  // admin and render a personalised "open my workspace" landing below — their
  // gig shows in Keikat and they reach THEIR dashboard from there.
  const { checking: crewChecking, linkedMember } = useCrewWorkerRedirect(jobId, { autoRedirect: false });


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
  // Keikan työkalut (pohjakartat & asetukset, tehokkuus). Tämä on se paikka
  // josta UUSI keikka saa rakennuksensa, kerroksensa ja pohjakuvansa — ilman
  // sitä toista keikkaa ei pysty perustamaan sovelluksen sisältä lainkaan.
  const [toolsOpen, setToolsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [approving, setApproving] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [savingContract, setSavingContract] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  // Keltaisten (2. vaihe) sopimusteksti — asiakas näkee tämän hyväksyessään
  // tilausehdot. Asuu TÄÄLLÄ sopimusosiossa, ei mustan dashin P2-paneelissa:
  // sopimusteksti on sopimusasia, ei hinnoittelutyökalu.
  const [p2Terms, setP2Terms] = useState("");
  const [p2TermsOpen, setP2TermsOpen] = useState(false);
  const [savingP2Terms, setSavingP2Terms] = useState(false);
  /**
   * `signMode` korvaa yksittäisen "Vaadi sähköinen allekirjoitus" -rastin.
   *
   *  - `first` seuranta avautuu vasta allekirjoituksesta (vanha rasti päällä)
   *  - `popup` seuranta on auki, ja sopimus nousee siihen popuppina (rasti pois)
   *  - `later` sopimusta ei ole vielä lainkaan
   *
   * Rasti ei riittänyt: se kertoi vain onko portti päällä. Kun se otettiin pois
   * ja sopimus liitettiin silti, asiakas ei nähnyt sopimusta MISSÄÄN eikä voinut
   * allekirjoittaa sitä — ja päälle jättäminen heitti seurantaa katsovan
   * asiakkaan takaisin koko sivun lomakkeeseen ilman selitystä.
   */
  const [draft, setDraft] = useState({ contractId: "", contractText: "", customerNote: "", vatNote: "", signMode: "first" as "first" | "popup" | "later", customerTheme: "paper" as "paper" | "tech" });

  // Invoice dialog state
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  /**
   * Kumpaa rahaa dialogi lähettää: punaisten erä vai keltaisten kertymä.
   *
   * Keltaisten lasku lähti ennen pelkän `confirm()`in takaa kirjautuneen
   * käyttäjän nimissä — ei laskuttajan valintaa, ei verkkolaskuosoitetta, ei
   * ALV-tekstiä. Juuri se lasku on keikan suurin, ja sen laskuttaja ratkaisee
   * kenen 20 000 €:n rajaa se kerryttää. Nyt molemmat kulkevat saman dialogin
   * läpi, jossa nuo valitaan.
   */
  const [invoiceScope, setInvoiceScope] = useState<"p1" | "p2" | "hours">("p1");
  const [sending, setSending] = useState(false);
  const [p2Sending, setP2Sending] = useState(false);
  const [reporting, setReporting] = useState(false);
  // billerId = which leader (Joonatan/Matias) is the laskuttaja for THIS instalment.
  // Defaults to the logged-in leader when they are a brand biller, else Joonatan.
  const defaultBillerId = resolveBrandBiller(profile?.id) ? profile!.id : DEFAULT_BILLER_ID;
  const [invForm, setInvForm] = useState({
    to: "", iban: "", bic: "", viitenumero: "", dueDate: isoPlusDays(14),
    message: "", isFinal: false, billerId: defaultBillerId, eInvoice: "", paymentNumber: 1,
    // "email": Puuhapatet sends the full priced invoice by email (default).
    // "verkkolasku": the founder issues the real invoice themselves via their
    // own invoicing software (e.g. Laskuguru) to the verkkolaskuosoite below —
    // Puuhapatet only sends a short confirmation and records the instalment.
    sendMethod: "email" as "email" | "verkkolasku",
    // When the recipient field holds several addresses, the ones the user has
    // unticked in the chip row (so they can send to one contact or both).
    excludedRecipients: [] as string[],
    // BCC a copy to the invoicing founder's own inbox.
    bccSelf: true,
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
          customerTheme: parsed.customerTheme === "tech" ? "tech" as const : "paper" as const,
          vatNote: parsed.vatNote ?? "",
          signMode: parsed.contractLater
            ? "later" as const
            : signatureRequired(parsed) ? "first" as const : "popup" as const,
        });
        setContractTextOpen(!!parsed.contractText?.trim());
        const startBiller = resolveBrandBiller(defaultBillerId);
        const savedEInvoice = parsed.signature?.customer?.eInvoice ?? "";
        setInvForm((f) => ({
          ...f,
          to: parsed.company?.email ?? "",
          iban: startBiller?.iban ?? profile?.iban ?? "",
          bic: profile?.bic ?? "OKOYFIHH",
          viitenumero: String(jobId),
          billerId: defaultBillerId,
          eInvoice: savedEInvoice,
        }));
      } else {
        toast({ variant: "destructive", title: "Virhe", description: res.error || "Keikkaa ei löytynyt" });
      }
      if (projRes.ok && projRes.data?.project) {
        setProject(projRes.data.project);
        setP2Terms(projRes.data.project.p2?.termsText ?? "");
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

  /**
   * SOPIMUS TIEDOSTONA.
   *
   * Tiedosto EI kulje `saveContract`in mukana vaan omalla reitillään: se on
   * megatavuja, ja lomakkeen tallennus lähtee joka kerta kun tunnus tai
   * ALV-teksti muuttuu. Siksi se myös tallentuu heti valittaessa — ei
   * "Tallenna sopimus" -napin takana, jonka painamatta jättäminen olisi
   * hukannut juuri valitun tiedoston.
   */
  const [contractFileBusy, setContractFileBusy] = useState(false);
  const contractFileInput = useRef<HTMLInputElement>(null);
  /**
   * SOPIMUSTEKSTI-KENTTÄ ON PIILOSSA OLETUKSENA.
   *
   * Sopimus on PDF. Tekstikenttä oli lomakkeen isoin elementti ja se paikka
   * johon koko sopimus liimattiin plain textinä — muoto joka hukkaa taulukot,
   * liitteet ja allekirjoitussivun. Se ei ole poistettu (FR8:n sopimus on
   * tekstinä, ja ladattava sopimusdokumentti koostuu siitä), mutta se ei ole
   * enää se mitä lomake ehdottaa ensimmäisenä.
   *
   * AUKEAA ITSESTÄÄN JOS TEKSTIÄ ON, koska muuten keikan olemassa oleva
   * sopimusteksti näyttäisi kadonneen tallennuksen mukana.
   */
  const [contractTextOpen, setContractTextOpen] = useState(false);

  const pickContractFile = async (file: File | null | undefined) => {
    if (!file || !jobId) return;
    if (file.type !== "application/pdf") {
      toast({ variant: "destructive", title: "Vain PDF", description: "Liitä sopimus PDF-tiedostona." });
      return;
    }
    setContractFileBusy(true);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    }).catch(() => "");
    if (!dataUrl) {
      setContractFileBusy(false);
      toast({ variant: "destructive", title: "Tiedostoa ei voitu lukea" });
      return;
    }
    const res = await api.uploadGigContractFile(jobId, dataUrl, file.name);
    setContractFileBusy(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      toast({ title: "Sopimus liitetty", description: "Asiakas näkee sen omassa näkymässään." });
    } else {
      toast({ variant: "destructive", title: "Liittäminen epäonnistui", description: res.error });
    }
  };

  /**
   * Esikatselu adminille. Tiedosto haetaan blobina eikä linkitetä suoraan:
   * adminin reitti vaatii Bearer-otsakkeen, jota `<a href>` ei lähetä — suora
   * linkki avaisi välilehden jossa lukee "Kirjautuminen vaaditaan".
   */
  const openContractFile = async () => {
    if (!jobId) return;
    setContractFileBusy(true);
    const res = await api.fetchGigContractFile(jobId);
    setContractFileBusy(false);
    if (res.ok && res.blob) {
      const url = URL.createObjectURL(res.blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      toast({ variant: "destructive", title: "Sopimusta ei voitu avata", description: res.error });
    }
  };

  const removeContractFile = async () => {
    if (!jobId) return;
    setContractFileBusy(true);
    const res = await api.deleteGigContractFile(jobId);
    setContractFileBusy(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      toast({ title: "Sopimustiedosto poistettu" });
    } else {
      toast({ variant: "destructive", title: "Poisto epäonnistui", description: res.error });
    }
  };

  const saveContract = async () => {
    if (!gig) return;
    setSavingContract(true);
    const updated: GigData = {
      ...gig,
      contractId: draft.contractId.trim() || undefined,
      contractText: draft.contractText.trim() || undefined,
      customerNote: draft.customerNote.trim() || undefined,
      customerTheme: draft.customerTheme,
      vatNote: draft.vatNote.trim() || undefined,
      // Molemmat kentät kirjataan tilasta, jottei kumpikaan jää roikkumaan
      // vanhaan arvoon. `later` sulkee portin aina (`signatureRequired` palauttaa
      // silloin false joka tapauksessa) — kirjataan silti nimenomaisesti.
      requireSignature: draft.signMode === "first",
      contractLater: draft.signMode === "later",
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
    // The laskuttaja is the biller PICKED in the dialog (not necessarily the
    // logged-in leader) — their name + Y-tunnus go on the invoice and become the
    // buyer on the alihankkija invoices funded by this instalment.
    const biller = resolveBrandBiller(invForm.billerId);
    // Only the ticked recipients (a customer may have two contact people). Fall
    // back to whatever's typed if the parse found nothing to toggle.
    const allTo = parseEmailList(invForm.to);
    const chosenTo = allTo.filter((e) => !invForm.excludedRecipients.includes(e));
    const recipients = (chosenTo.length ? chosenTo : allTo).join(", ") || invForm.to;
    const bccSelfEmail = invForm.bccSelf ? (biller?.email ?? profile?.email ?? "") : "";
    const res = await api.sendGigInvoice(jobId, {
      to: recipients || undefined,
      bcc: bccSelfEmail || undefined,
      iban: invForm.iban || undefined,
      bic: invForm.bic || undefined,
      viitenumero: invForm.viitenumero || undefined,
      dueDate: invForm.dueDate || undefined,
      senderName: biller?.name ?? profile?.name,
      senderYTunnus: biller?.yTunnus ?? profile?.yTunnus,
      senderAddress: biller?.address ?? profile?.address,
      billerId: biller?.id ?? profile?.id, // which leader billed the customer
      workerPhone: profile?.phone,
      message: invForm.message || undefined,
      isFinal: invForm.isFinal,
      eInvoice: invForm.eInvoice || undefined,
      // Keltaisilla ei ole eränumeroa — ne eivät kuluta punaisten erälaskuria.
      paymentNumber: invoiceScope === "p1" && deal ? invForm.paymentNumber : undefined,
      sendMethod: invForm.sendMethod,
      scope: invoiceScope,
    });
    setSending(false);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      setInvoiceOpen(false);
      const what = invoiceScope === "p2" ? "Keltaisten lasku" : invoiceScope === "hours" ? "Tuntilasku" : "Lasku";
      toast(invForm.sendMethod === "verkkolasku"
        ? { title: `${what} — vahvistus lähetetty`, description: `${eur(res.data.amountCents)} → ${recipients} (muista lähettää itse varsinainen verkkolasku)` }
        : { title: `${what} lähetetty`, description: `${eur(res.data.amountCents)} → ${recipients}` });
    } else {
      toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error });
    }
  };

  // Priority 2 (keltaiset) -lasku — erillinen scope:"p2"-haara, ei koske P1:n
  // eriin. Summa = laskuttamaton P2-kertymä. Sama kevyt lähetys kuin mustassa
  // dashissa (billerId = kirjautunut perustaja).
  /** Avaa laskudialogin keltaisten kertymälle. Lähetys tapahtuu `sendInvoice`ssa. */
  const sendP2 = () => {
    if (p2RemainingCents <= 0) return;
    setInvoiceScope("p2");
    setInvoiceOpen(true);
  };

  /** Avaa laskudialogin tuntikeikan kertymälle. Lähetys tapahtuu `sendInvoice`ssa. */
  const sendHours = () => {
    if (hoursRemainingCents <= 0) return;
    setInvoiceScope("hours");
    setInvoiceOpen(true);
  };

  const saveP2Terms = async () => {
    setSavingP2Terms(true);
    const res = await api.p2SetPhase(jobId, { termsText: p2Terms, by: profile?.id });
    setSavingP2Terms(false);
    if (res.ok && res.data) {
      setProject((cur) => (cur ? { ...cur, p2: res.data!.p2 } : cur));
      toast({ title: "2. vaiheen sopimusteksti tallennettu" });
    } else {
      toast({ variant: "destructive", title: "Tallennus epäonnistui", description: res.error });
    }
  };

  const sendReport = async () => {
    setReporting(true);
    const res = await api.sendGigReport(jobId);
    setReporting(false);
    if (res.ok) {
      toast({ title: "Maksuraportti lähetetty", description: "Kooste lähetettiin johtajille sähköpostiin." });
    } else {
      toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error });
    }
  };

  // Open the invoice dialog, defaulting the instalment number to the next one in
  // sequence (the admin can still change it manually in the dialog).
  const openInvoice = () => {
    // Erän numero ELÄVISTÄ eristä. Raa'an taulukon pituus juoksi mitätöinnin
    // jälkeen edelle, joten dialogi tarjosi seuraavaksi eräksi jo laskutettua
    // numeroa ja esikatselu näytti 1575 € vaikka jäljellä oli vähemmän.
    setInvForm((f) => ({ ...f, paymentNumber: (gig?.payments ?? []).filter((p) => !p.voided).length + 1 }));
    // Nollaa scope: keltaisten lähetyksen jälkeen dialogi jäisi muuten P2-tilaan.
    setInvoiceScope("p1");
    setInvoiceOpen(true);
  };

  const undoInstalment = async () => {
    if (!confirm("Peruutetaanko viimeisin maksuerä seurannasta? Tämä ei peru jo lähetettyä sähköpostia, mutta nollaa laskurin (esim. testilähetys).")) return;
    const res = await api.undoGigInstalment(jobId);
    if (res.ok && res.data) {
      setGig(res.data.gigData);
      toast({ title: "Maksuerä peruttu", description: "Laskuri palautettu." });
    } else {
      toast({ variant: "destructive", title: "Peruutus epäonnistui", description: res.error });
    }
  };

  if (crewChecking) {
    return <div className="min-h-screen bg-background"><LoadingOrb label="Ladataan keikkaa" theme="light" /></div>;
  }

  // Admin-linked worker (e.g. Petrus): stay in the normal admin, but show a clean
  // personalised landing — their gig + a button to open THEIR own dashboard. No
  // customer price, no other workers' earnings, no host tools render here at all.
  if (linkedMember) {
    const first = linkedMember.name?.trim().split(/\s+/)[0] || "";
    return (
      <div className="min-h-screen bg-background admin-shell-pad">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/admin/jobs">
              <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground truncate">
                {gig?.company?.name || jobDescription || "Keikka"}
              </h1>
              <p className="text-sm text-muted-foreground truncate">Oma keikkasi</p>
            </div>
          </div>

          <Card className="p-6 bg-card border-0 premium-shadow text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/5">
              <LayoutDashboard className="h-7 w-7 text-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Tervetuloa{first ? `, ${first}` : ""} 👋
            </h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              Tämä on sinun keikkasi. Avaa oma työpöytäsi nähdäksesi kartan, omat ansiosi
              ja tuntisi. Näet vain oman työsi — et asiakashintoja etkä muiden tietoja.
            </p>
            <Button className="w-full" onClick={() => navigate(`/tyo/${linkedMember.token}`)}>
              <LayoutDashboard className="w-4 h-4 mr-2" /> Avaa oma työpöytä
            </Button>
            <Link href="/admin/jobs">
              <Button variant="ghost" className="w-full mt-2 text-muted-foreground">
                Takaisin keikkoihin
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen bg-background"><LoadingOrb label="Ladataan keikkaa" theme="light" /></div>;
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
  const deal = project ? fixedDealFor(project) : null;
  const dealBilling = (deal && project) ? computeDealBilling(project, deal) : null;

  // Recipient addresses parsed from the "to" field (a customer can have two
  // contact people), and the subset the founder has kept ticked in the chip row.
  const invoiceToEmails = parseEmailList(invForm.to);
  const chosenToEmails = invoiceToEmails.filter((e) => !invForm.excludedRecipients.includes(e));

  // For fixed-price deals: invoice is available when the next quarter of windows is done.
  // Quarter size = billableTotal / 4 and scales dynamically if dots are added to the map.
  // Each erä is a fixed 25 %, EXCEPT the final (4th) which bills the remainder of the
  // effective agreed total — so removed red windows come off the last invoice.
  // P2 (keltaiset) — lisätyön laskutus asuu SAMASSA Laskutus-kortissa kuin
  // punaiset (jatkona niiden päälle), ei enää omassa dropdownissa. Locked sum
  // kasvattaa myös sopimuksen kokonaissummaa.
  const p2 = project?.p2;
  const p2On = !!p2?.enabled;
  const p2b = project ? computeP2Billing(project) : null;
  const p2Locked = p2b?.lockedSumCents ?? 0;
  // P1/P2-maksujen erottelu tulee YHDESTÄ jaetusta funktiosta (shared/worker-payouts.ts)
  // — sama laskenta kuin mustassa dashissa ja serverillä, ei kolmea kopiota
  // erilaisia scope-suodatuksia.
  const invState = p2InvoiceState(p2b?.earnedCents ?? 0, gig.payments);
  // ELÄVÄT erät. Mitätöity rivi jää `gig.payments`iin tositteeksi, joten sen
  // pituus ei kerro montako laskua on lähetetty eikä ole peruttavissa.
  const liveGigPayments = (gig.payments ?? []).filter((p) => !p.voided);
  const p1PayCount = invState.p1Payments;
  const p1InvoicedCents = invState.p1InvoicedCents;
  const p2InvoicedCents = invState.invoicedCents;
  const p2RemainingCents = invState.remainingCents;
  /**
   * TUNTIKEIKAN LASKUTUS. Summa JA erittely tulevat samasta
   * `hourlyItemisation`ista jota palvelin käyttää lähetyksessä, joten
   * dialogissa näkyvä luku on se joka lähtee — ei erillistä esikatselu-
   * aritmetiikkaa joka voisi ajautua siitä erilleen.
   */
  const hourlyBill = project && isHourlyGig(project) ? hourlyItemisation(project) : null;
  const hoursInvoicedCents = invState.hoursInvoicedCents;
  const hoursRemainingCents = hourlyBill
    ? Math.max(0, hourlyBill.customerTotalCents - hoursInvoicedCents) : 0;
  /** Etunimi kulun maksajalle: keikan tekijälista ensin, sitten johtajat. */
  const payerName = (id: string): string => {
    const c = (project?.crew ?? []).find((x) => x.id === id);
    if (c?.name?.trim()) return c.name.trim().split(/\s+/)[0];
    const u = USERS.find((x) => x.id === id);
    if (u) return u.name.split(" ")[0];
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
  };
  const agreedTotalCents = (deal && project) ? dealAgreedTotalCents(project, deal) : 0;
  const isFinalEra = !!deal && p1PayCount === 3;
  const fixedInstallmentCents = deal
    ? (isFinalEra ? Math.max(0, agreedTotalCents - p1InvoicedCents) : Math.round(deal.capCents / 4))
    : 0;
  // The reduced final (4th) erä = effective agreed total − the three fixed 25 %
  // instalments (e.g. 6150 − 3×1575 = 1425 when red windows were removed).
  const rawInstalmentCents = deal ? Math.round(deal.capCents / 4) : 0;
  const finalEraCents = deal ? Math.max(0, agreedTotalCents - rawInstalmentCents * 3) : 0;
  const perQuarter = dealBilling ? dealBilling.billableTotal / 4 : 0;
  // Use p1PayCount (red erät only) — P2 payments must never perturb P1 progression.
  const nextQuarterNeeded = dealBilling ? perQuarter * (p1PayCount + 1) : 0;
  const fixedDue = !!(dealBilling && dealBilling.billableWashed >= nextQuarterNeeded && p1PayCount < 4);

  const due = deal ? fixedDue : invoiceDue(gig);
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
        <Disclosure
          icon={<Users className="w-4 h-4 text-muted-foreground" />}
          title="Yhteystiedot"
        >
          {!editingCompany && (
            <div className="flex justify-end -mt-1 mb-2">
              <Button variant="ghost" size="sm" onClick={() => { setCompanyDraft(gig.company ?? {}); setEditingCompany(true); }} className="text-xs gap-1.5 h-7 px-2">
                <PenLine className="w-3.5 h-3.5" /> Muokkaa
              </Button>
            </div>
          )}
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
              {/* Sisäinen listanimi — ei osa sopimusta, joten se ei kuulu sopimusosioon. */}
              <div>
                <Label className="text-xs">Kuvaus (näkyy keikkalistassa)</Label>
                <div className="flex gap-2">
                  <Input value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Esim. FR8 - Ikkunoiden pesu" className="text-sm" />
                  <Button size="sm" variant="outline" disabled={savingDescription} onClick={saveDescription} className="shrink-0">
                    {savingDescription ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  </Button>
                </div>
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
        </Disclosure>

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
              <Disclosure
                icon={<Receipt className="w-4 h-4 text-muted-foreground" />}
                title="Sopimushinta"
                right={<span className="text-sm font-bold text-foreground tabular-nums">{eurFromCents(agreedTotalCents + p2Locked)}</span>}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Punaiset (kiinteä)</span>
                    <span className="text-sm font-bold text-foreground tabular-nums">{eurFromCents(agreedTotalCents)}</span>
                  </div>
                  {agreedTotalCents < deal.capCents && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Katto {eurFromCents(deal.capCents)} · pienentynyt, koska punaisia ikkunoita on poistettu (37,50 € / ikkuna).
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Maksuerät 1–3</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">3 × {eurFromCents(rawInstalmentCents)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Maksuerä 4 (loppuerä)</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">{eurFromCents(finalEraCents)}</span>
                  </div>
                  {p2Locked > 0 && (
                    <div className="flex items-center justify-between border-t border-border pt-2.5">
                      <span className="text-xs text-muted-foreground">Priority 2 (keltaiset, sovitut)</span>
                      <span className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">+ {eurFromCents(p2Locked)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border pt-2.5">
                    <span className="text-xs font-semibold text-foreground">Yhteensä</span>
                    <span className="text-sm font-bold text-foreground tabular-nums">{eurFromCents(agreedTotalCents + p2Locked)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Tila</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">🔒 Sovittu sopimuksessa</span>
                  </div>
                </div>
              </Disclosure>
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
            onClick={() => setToolsOpen(true)}
            aria-label="Keikan asetukset ja pohjakartat"
            title="Pohjakartat, kerrokset ja keikan asetukset"
            className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-2xl w-16 sm:w-auto sm:px-5 bg-card text-foreground hover:bg-accent transition-all active:scale-[0.99] premium-shadow"
          >
            <SlidersHorizontal className="h-5 w-5" />
            <span className="text-[11px] sm:text-xs font-medium">Asetukset</span>
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
          /**
           * Onko allekirjoitettavaa: liitetty PDF TAI luonnoksen sopimusteksti.
           *
           * Teksti luetaan `draft`ista eikä `gig`istä, jotta varoitus vastaa
           * sitä mitä ruudulla juuri nyt on — kirjoittaminen sammuttaa sen
           * heti, ei vasta tallennuksen jälkeen. Tiedosto luetaan `gig`istä,
           * koska se tallentuu heti valittaessa eikä ole osa luonnosta.
           */
          const hasDoc = !!gig.contractFile || !!draft.contractText.trim();
          /**
           * Onko tunnukseksi kirjoitettu FR8:n tunnus keikalle joka ei ole FR8.
           *
           * Ehdossa on toinen puoli (`gig.contractId !== FR8`) jotta FR8:n oma
           * keikka ei saa varoitusta omasta tunnuksestaan — varoitus koskee
           * tunnuksen VAIHTAMISTA FR8:n tunnukseksi, ei sen omistamista.
           */
          const fr8IdClash = draft.contractId.trim() === FR8_CONTRACT_ID
            && (gig.contractId ?? "") !== FR8_CONTRACT_ID;
          const statusPill = (
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
              {status === "approved" ? "Hyväksytty" : status === "signed" ? "Allekirjoitettu" : "Odottaa"}
            </span>
          );
          return (
            <Disclosure
              icon={<PenLine className="w-4 h-4 text-muted-foreground" />}
              title="Sopimus & asiakasnäkymä"
              right={statusPill}
              defaultOpen={status === "draft"}
            >
              <div className="space-y-5">
                {/* Allekirjoitus & hyväksyntä */}
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
                    Asiakas ei ole vielä allekirjoittanut. Jaa live-linkki allekirjoitettavaksi.
                  </p>
                )}

                {/* Keltaisten (2. vaihe) tilausehdot kuuluvat SAMAAN sopimusosioon
                    kuin punaisten allekirjoitus — kaksi vaihetta, yksi sopimustila.
                    Aiemmin tämä oli omassa dropdownissaan, jossa se jäi piiloon. */}
                {p2On && (
                  <div className="rounded-xl border border-border p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">2. vaihe — keltaisten tilausehdot</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p2?.terms ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>
                        {p2?.terms ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {p2?.terms ? "Hyväksytty" : "Odottaa"}
                      </span>
                    </div>
                    {p2?.terms ? (
                      <p className="text-sm text-emerald-700 dark:text-emerald-400">
                        {p2.terms.acceptorName}
                        {p2.terms.acceptedAt ? ` · ${new Date(p2.terms.acceptedAt).toLocaleDateString("fi-FI")}` : ""}
                        {p2b && p2b.lockedCount > 0 ? ` · ${p2b.lockedCount} ikkunaa sovittu (${eur(p2b.lockedSumCents)})` : ""}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Asiakas hyväksyy ehdot kertaalleen seurantalinkissä ennen ensimmäistä hinnan hyväksyntää.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 pt-0.5">
                      <a href="/fr8/priority2-sopimus-2026.pdf" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline">
                        <FileText className="w-3.5 h-3.5" /> Sopimus (PDF)
                      </a>
                      <button type="button" onClick={() => { setP2TermsOpen((v) => !v); setP2Terms(project?.p2?.termsText ?? ""); }}
                        className="text-xs font-medium text-muted-foreground underline underline-offset-2">
                        {p2TermsOpen ? "Sulje teksti" : `Muokkaa tekstiä${project?.p2?.termsText?.trim() ? " ✓" : ""}`}
                      </button>
                    </div>
                    {p2TermsOpen && (
                      <div className="space-y-2 pt-1">
                        <Textarea rows={7} value={p2Terms} onChange={(e) => setP2Terms(e.target.value)}
                          className="text-xs" placeholder="Liitä 2. vaiheen sopimusteksti — asiakas näkee sen hyväksyessään tilausehdot." />
                        <Button size="sm" className="w-full" disabled={savingP2Terms || p2Terms === (project?.p2?.termsText ?? "")} onClick={saveP2Terms}>
                          <Save className="w-4 h-4 mr-2" /> {savingP2Terms ? "Tallennetaan…" : "Tallenna teksti"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Customer live-link — signing page before signature, live tracker after. */}
                <div className="space-y-1.5 pt-1 border-t border-border">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5" /> Asiakkaan live-linkki
                  </Label>
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
                </div>

                {gig.signature ? (
                  /* Signed → the agreed contract is locked and shown read-only. */
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      Sopimus on allekirjoitettu ja lukittu — tietoja ei voi enää muokata.
                    </div>
                    {draft.contractId && (
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">Sopimustunnus</Label>
                        <p className="text-sm text-foreground">{draft.contractId}</p>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-muted-foreground">Sopimusteksti (allekirjoitettu)</Label>
                      <div className="rounded-xl border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap max-h-72 overflow-y-auto">
                        {draft.contractText || "—"}
                      </div>
                    </div>
                    {draft.customerNote && (
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">Asiakkaalle näytettävä huomautus</Label>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{draft.customerNote}</p>
                      </div>
                    )}
                    {draft.vatNote && (
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">ALV-huomautus</Label>
                        <p className="text-sm text-foreground">{draft.vatNote}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Draft → still editable until the customer signs. */
                  <>
                    {/* Allekirjoituksen ajoitus. Kolme tilaa, koska niitä on
                        oikeasti kolme — rasti pystyi ilmaisemaan vain kaksi ja
                        jätti kolmannen (sopimus olemassa, portti pois) tilaan
                        jossa asiakas ei nähnyt sopimusta lainkaan. */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Allekirjoitus</p>
                      <div role="radiogroup" aria-label="Allekirjoitus" className="grid grid-cols-1 gap-2">
                        {([
                          { id: "first", title: "Ensin sopimus", sub: "Seuranta avautuu asiakkaalle vasta allekirjoituksesta." },
                          { id: "popup", title: "Seuranta auki, sopimus popuppina", sub: "Asiakas näkee edistymisen heti ja allekirjoittaa samassa näkymässä." },
                          { id: "later", title: "Sopimus tehdään myöhemmin", sub: "Ei sopimusta vielä. Liitä teksti alle kun se on valmis." },
                        ] as const).map((o) => {
                          const active = draft.signMode === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setDraft({ ...draft, signMode: o.id })}
                              className={cn(
                                "text-left rounded-xl border p-3 transition-colors",
                                active
                                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                  : "border-border hover:bg-muted/30",
                              )}
                            >
                              <span className={cn("text-sm", active && "font-semibold text-blue-700 dark:text-blue-300")}>{o.title}</span>
                              <span className="block text-xs text-muted-foreground mt-0.5">{o.sub}</span>
                            </button>
                          );
                        })}
                      </div>
                      {/* HUOMAUTUKSET LUKEVAT MOLEMMAT ASIAKIRJAN MUODOT.
                          Ennen ne katsoivat vain sopimustekstiä, joten liitetty
                          PDF ei kelpatessaankaan sammuttanut varoitusta: admin
                          näki "allekirjoitettavaa ei ole" sopimuksesta joka oli
                          juuri liitetty, ja asiakas näki samaan aikaan sen
                          sopimuksen omassa näkymässään. */}
                      {draft.signMode !== "later" && !hasDoc && (
                        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                          Sopimusta ei ole vielä liitetty (ei tiedostoa eikä tekstiä), joten
                          allekirjoitettavaa ei ole. Asiakas näkee seurannan, mutta ei sopimusta.
                        </p>
                      )}
                      {draft.signMode === "later" && hasDoc && (
                        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                          Sopimus on jo liitetty. Valitse "sopimus popuppina", niin asiakas
                          näkee ja voi allekirjoittaa sen.
                        </p>
                      )}
                    </div>

                    {/* ── SOPIMUS TIEDOSTONA ─────────────────────────────────
                        Tämä on se tapa jolla sopimus oikeasti liitetään: se on
                        PDF. Tekstikenttä alla jää vaihtoehdoksi (ja tiedoston
                        rinnalle lisätiedoksi), mutta PDF säilyttää sen mitä
                        teksti ei: taulukot, liitteet ja allekirjoitussivun. */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" /> Sopimus tiedostona (PDF)
                      </Label>
                      <input
                        ref={contractFileInput}
                        type="file"
                        accept="application/pdf,.pdf"
                        className="hidden"
                        onChange={(e) => { void pickContractFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
                      />
                      {gig.contractFile ? (
                        <div className="rounded-xl border border-border p-3 space-y-2">
                          <div className="flex items-start gap-2">
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-sm text-foreground break-all">{gig.contractFile.name}</p>
                              <p className="text-[11px] text-muted-foreground tabular-nums">
                                {Math.max(1, Math.round(gig.contractFile.bytes / 1000))} kB · liitetty{" "}
                                {new Date(gig.contractFile.uploadedAt).toLocaleDateString("fi-FI")}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" disabled={contractFileBusy} onClick={openContractFile}>
                              Avaa
                            </Button>
                            <Button variant="outline" size="sm" disabled={contractFileBusy}
                              onClick={() => contractFileInput.current?.click()}>
                              Korvaa
                            </Button>
                            <Button variant="outline" size="sm" disabled={contractFileBusy} onClick={removeContractFile}>
                              Poista
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" className="w-full" disabled={contractFileBusy}
                          onClick={() => contractFileInput.current?.click()}>
                          <FileText className="w-4 h-4 mr-2" />
                          {contractFileBusy ? "Liitetään…" : "Valitse PDF-tiedosto"}
                        </Button>
                      )}
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Asiakas näkee tiedoston omassa näkymässään selattavana ja allekirjoittaa
                        sen samasta paikasta. Tallentuu heti valittaessa — enintään noin 5 MB.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Sopimustunnus</Label>
                      {/* PLACEHOLDER EI OLE ENÄÄ FR8:N OIKEA TUNNUS.
                          Kenttä ehdotti "Esim. PT-2026-02", joka on FR8:n tunnus
                          ja samalla portti FR8:n sopimus-PDF:ään. Esimerkin
                          kopioiminen olisi näyttänyt toiselle asiakkaalle FR8:n
                          allekirjoitetun sopimuksen — juuri sen vuodon jonka
                          keikkakohtainen portti korjasi. */}
                      <Input value={draft.contractId} onChange={(e) => setDraft({ ...draft, contractId: e.target.value })} placeholder="Esim. PT-2026-04" />
                      {fr8IdClash ? (
                        <p className="text-xs text-red-600 dark:text-red-400 leading-snug">
                          {FR8_CONTRACT_ID} on FR8:n sopimustunnus, ja tällä tunnuksella asiakkaan
                          näkymä avaa FR8:n sopimus-PDF:n. Anna tälle keikalle oma tunnus.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Vapaaehtoinen. Näkyy asiakkaalle otsikossa ja hyväksyntälauseessa, ja
                          laskunumero muodostuu siitä ({draft.contractId.trim() || "PT-2026-04"}-01).
                          Muoto on vapaa — käytä omaa juoksevaa numerointia.
                        </p>
                      )}
                    </div>
                    {/* Sopimusteksti — vaihtoehto PDF:lle, ei rinnakkainen
                        pääkenttä. Ks. `contractTextOpen`. */}
                    {contractTextOpen ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs font-medium text-muted-foreground">Sopimusteksti (asiakas näkee ja allekirjoittaa)</Label>
                          {/* Piilotus vain tyhjänä: kirjoitetun sopimustekstin
                              piilottaminen olisi sisällön piilottamista, ei
                              lomakkeen siistimistä. */}
                          {!draft.contractText.trim() && (
                            <button type="button" onClick={() => setContractTextOpen(false)}
                              className="text-[11px] text-muted-foreground underline underline-offset-2 shrink-0">
                              Piilota
                            </button>
                          )}
                        </div>
                        <Textarea rows={8} value={draft.contractText} onChange={(e) => setDraft({ ...draft, contractText: e.target.value })} className="font-mono text-xs" placeholder="Liitä koko sopimus tähän…" />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setContractTextOpen(true)}
                        className="text-xs text-muted-foreground underline underline-offset-2 self-start">
                        tai liitä sopimus tekstinä
                      </button>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Asiakkaalle näytettävä huomautus</Label>
                      <Textarea rows={2} value={draft.customerNote} onChange={(e) => setDraft({ ...draft, customerNote: e.target.value })} placeholder="Esim. Maksat vain pestyistä ikkunoista…" />
                    </div>

                    {/* Asiakasnäkymän ulkoasu. Sama tieto, kaksi kieltä: vaalea
                        esite tai tumma mittalaite. Tekninen sopii asiakkaalle
                        jolle jälkimmäinen on tutumpi — ei koristeeksi vaan
                        siksi että näkymä luetaan oikein. */}
                    <div>
                      <Label className="text-xs">Asiakasnäkymän ulkoasu</Label>
                      <div role="radiogroup" aria-label="Asiakasnäkymän ulkoasu" className="grid grid-cols-2 gap-2 mt-1.5">
                        {([
                          { id: "paper" as const, title: "Vaalea", desc: "Selkeä ja rauhallinen" },
                          { id: "tech" as const, title: "Tekninen", desc: "Tumma, mittarit ja tarkat luvut" },
                        ]).map((o) => {
                          const active = draft.customerTheme === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => setDraft({ ...draft, customerTheme: o.id })}
                              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                                active
                                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                  : "border-border hover:bg-muted/30"
                              }`}
                            >
                              <p className={`text-sm ${active ? "font-semibold text-blue-700 dark:text-blue-300" : "text-foreground"}`}>{o.title}</p>
                              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{o.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">ALV-huomautus</Label>
                      <Input value={draft.vatNote} onChange={(e) => setDraft({ ...draft, vatNote: e.target.value })} />
                    </div>
                    <Button className="w-full" disabled={savingContract} onClick={saveContract}>
                      <Save className="w-4 h-4 mr-2" /> {savingContract ? "Tallennetaan…" : "Tallenna sopimus"}
                    </Button>
                  </>
                )}
              </div>
            </Disclosure>
          );
        })()}

        {/* Laskutus — YKSI kortti, joka kattaa koko asiakaslaskutuksen:
            punaiset (kiinteät 4 erää) ja niiden JATKONA keltaiset (2. vaihe).
            Aiemmin keltaiset olivat omassa dropdownissaan, mikä hajotti saman
            asian kahteen paikkaan; nyt sama kortti jatkuu punaisista keltaisiin. */}
        <Card className="p-5 bg-card border-0 premium-shadow mb-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Receipt className="w-4 h-4 text-muted-foreground shrink-0" />
              <h2 className="font-semibold text-foreground">Laskutus</h2>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              laskutettu {eur(p1InvoicedCents + p2InvoicedCents)}
            </span>
          </div>
          {deal && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Punaiset · kiinteä urakka
            </p>
          )}
          {due && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {deal && dealBilling
                  ? `${p1PayCount + 1}. maksuerä valmis — ${Math.round(dealBilling.pct)} % ikkunoista pesty.`
                  : `Laskutusraja ylittynyt (${totals.washedTotal} ≥ ${nextThr}). Muodosta osalasku kertyneestä summasta.`}
              </p>
            </div>
          )}
          {/* ── TUNTIKEIKKA. Oma haaransa, koska tuntikeikalla ei ole urakan
                neljää erää eikä kohdehintoja: laskutettava on kertyneet tunnit
                + asiakkaalle merkityt tarvikkeet + alihankinta katteineen.
                Erittely näytetään tässä samana kuin se menee laskulle — johtaja
                ei lähetä summaa jonka koostumusta hän ei nähnyt. */}
          {hourlyBill ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">Kertynyt yhteensä</span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{eur(hourlyBill.customerTotalCents)}</span>
              </div>
              {hoursInvoicedCents > 0 && (
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Jo laskutettu</span>
                  <span className="text-sm font-semibold text-green-600 tabular-nums">{eur(hoursInvoicedCents)}</span>
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Laskuttamatta</span>
                <span className={`text-lg font-bold tabular-nums ${hoursRemainingCents > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                  {eur(hoursRemainingCents)}
                </span>
              </div>

              {/* Erittely: mistä summa koostuu. Tiedoksi-rivit (esim. pestyt
                  ikkunat) näkyvät ilman euroa — ne eivät ole toinen veloitus
                  vaan kertovat mitä tunneilla tehtiin. */}
              {hourlyBill.lines.length > 0 && (
                <div className="mb-3 rounded-xl bg-muted/40 p-2.5">
                  {hourlyBill.lines.map((l, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 py-0.5">
                      <span className="text-[11px] text-muted-foreground">{l.label}</span>
                      <span className={`text-[11px] tabular-nums shrink-0 ${l.cents == null ? "text-muted-foreground/70" : "font-semibold text-foreground"}`}>
                        {l.cents == null ? "—" : eur(l.cents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Mihin raha jakautuu — sama kolmijako kuin keltaisilla, jottei
                  "asiakkaalta 26 €/h" ja "tekijälle 15 €/h" näytä ristiriidalta.
                  Pomojen omista tunneista ei oteta katetta: ne ovat omaa työtä
                  ja näkyvät "Teille"-sarakkeessa täytenä. */}
              {hourlyBill.customerTotalCents > 0 && (
                <div className={`mb-3 grid gap-2 rounded-xl bg-muted/40 p-2.5 text-center ${hourlyBill.money.reimbursementCents > 0 ? "grid-cols-4" : "grid-cols-3"}`}>
                  {([
                    ["Asiakkaalta", eur(hourlyBill.customerTotalCents), "text-foreground"],
                    ["Tekijöille", eur(hourlyBill.money.workerCostCents), "text-foreground"],
                    ...(hourlyBill.money.reimbursementCents > 0
                      ? [["Kulut takaisin", eur(hourlyBill.money.reimbursementCents), "text-foreground"] as [string, string, string]]
                      : []),
                    ["Teille", eur(hourlyBill.money.founderTotalCents), "text-green-600"],
                  ] as [string, string, string][]).map(([l, v, tone]) => (
                    <div key={l}>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                      <p className={`text-sm font-bold tabular-nums ${tone}`}>{v}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Kenelle kulut palautuvat. Kohdentamatonta rahaa ei arvata:
                  jos maksajaa ei ole kirjattu, se sanotaan eikä jaeta. */}
              {hourlyBill.money.reimbursementCents > 0 && (
                <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
                  {hourlyBill.money.byPayer.length > 0
                    ? `Kulut takaisin maksajalle: ${hourlyBill.money.byPayer.map((pp) => `${payerName(pp.id)} ${eur(pp.cents)}`).join(" · ")}`
                    : "Kuluille ei ole kirjattu maksajaa — palautus jää kohdentamatta."}
                </p>
              )}

              {/* Väärinpäin kirjatut hinnat estävät lähetyksen palvelimella;
                  sanotaan se tässä ennen kuin nappia painetaan. */}
              {hourlyBill.money.rateInverted && (
                <p className="mb-3 text-[11px] leading-snug text-red-600 dark:text-red-400">
                  Tuntipalkka on suurempi kuin asiakkaan tuntihinta — tarkista hinnat ennen laskutusta.
                </p>
              )}
              {!hourlyBill.matchesBilling && (
                <p className="mb-3 text-[11px] leading-snug text-red-600 dark:text-red-400">
                  Erittely ei täsmää kokonaissummaan. Laskua ei voi lähettää ennen kuin syy on selvitetty.
                </p>
              )}

              <Button className="w-full" disabled={hoursRemainingCents <= 0 || !hourlyBill.matchesBilling || hourlyBill.money.rateInverted} onClick={sendHours}>
                <Send className="w-4 h-4 mr-2" />
                {hoursRemainingCents > 0 ? `Lähetä tuntilasku (${eur(hoursRemainingCents)})` : "Kaikki tunnit laskutettu ✓"}
              </Button>
            </>
          ) : deal && dealBilling ? (
            p1PayCount >= 4 ? (
              /* Kaikki neljä erää lähetetty — sopimus laskutettu. Ei haamu-
                 "seuraava erä 1575 €" eikä kuollutta lähetysnappia. */
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="w-4 h-4 shrink-0" /> 4 laskua lähetetty
                  </span>
                  <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">{eur(p1InvoicedCents)}</span>
                </div>
                {liveGigPayments.length > 0 && (
                  <button type="button" className="mt-1 text-[11px] text-muted-foreground underline underline-offset-2" onClick={undoInstalment}>
                    Peruuta viimeisin erä
                  </button>
                )}
              </>
            ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Seuraava maksuerä</span>
                <span className="text-lg font-bold text-foreground tabular-nums">{eur(fixedInstallmentCents)}</span>
              </div>
              {/* Two SEPARATE, honest figures: actual work done (windows washed)
                  vs. invoices actually sent. Never derive "done" from the invoice
                  count — that would claim a milestone the work hasn't reached. */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">Työ tehty</span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{Math.round(dealBilling.pct)} %</span>
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Laskuja lähetetty</span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{p1PayCount}/4 erää</span>
              </div>
              {dealBilling.billableTotal > 0 && (
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">Ikkunoita pesty</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {dealBilling.billableWashed} / {dealBilling.billableTotal} kpl
                    {!due && p1PayCount < 4 && (
                      <span className="ml-1">(vielä {Math.ceil(nextQuarterNeeded - dealBilling.billableWashed)} ennen {p1PayCount + 1}. erää)</span>
                    )}
                  </span>
                </div>
              )}
              <Button
                className="w-full"
                onClick={openInvoice}
              >
                <Send className="w-4 h-4 mr-2" />
                Lähetä lasku
              </Button>
              {liveGigPayments.length > 0 && (
                <Button variant="ghost" size="sm" className="w-full mt-1 text-xs text-muted-foreground" onClick={undoInstalment}>
                  Peruuta viimeisin erä (nollaa laskuri)
                </Button>
              )}
            </>
            )
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Laskuttamatta</span>
                <span className="text-lg font-bold text-foreground tabular-nums">{eur(totals.uninvoicedCents)}</span>
              </div>
              {totals.invoicedCents > 0 && (
                <p className="text-xs text-muted-foreground mb-3">Jo laskutettu: {eur(totals.invoicedCents)} ({liveGigPayments.length} laskua)</p>
              )}
              <Button className="w-full" disabled={totals.uninvoicedCents <= 0} onClick={openInvoice}>
                <Send className="w-4 h-4 mr-2" /> Lähetä lasku sähköpostilla
              </Button>
            </>
          )}

          {/* ── KELTAISET (2. vaihe) — samaa laskutusta, jatkona punaisten päälle.
                Näkyy vasta kun vaihe 2 on avattu asiakkaalle, ettei tyhjä osio
                roiku näkymässä valmistelun aikana. */}
          {deal && p2On && p2b && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  Keltaiset · 2. vaihe (lisätyö)
                </p>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  sovittu {eur(p2b.lockedSumCents)}
                </span>
              </div>
              {p2b.lockedCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Asiakas ei ole vielä hyväksynyt yhtään keltaista hintaa — laskutettavaa ei siis ole.
                  Hinnoittele keltaiset projektinäkymän kartalla.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Sovittu (lukittu)</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">{p2b.lockedCount} kpl · {eur(p2b.lockedSumCents)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Kertynyt (pesty)</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">{p2b.lockedWashedCount} kpl · {eur(p2b.earnedCents)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">Laskutettu</span>
                    <span className="text-sm font-semibold text-green-600 tabular-nums">{eur(p2InvoicedCents)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-muted-foreground">Laskuttamatta</span>
                    <span className={`text-lg font-bold tabular-nums ${p2RemainingCents > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{eur(p2RemainingCents)}</span>
                  </div>
                  {/* Mihin kertymä jakautuu. Ilman tätä riviä "asiakkaalta 408 €" ja
                      "tekijöille 216 €" näyttivät ristiriidalta — ero on teidän kate. */}
                  {p2b.earnedCents > 0 && (
                    <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-2.5 text-center">
                      {([
                        ["Asiakkaalta", eur(p2b.earnedCents), "text-foreground"],
                        ["Tekijöille", eur(p2b.workerCostCents), "text-foreground"],
                        ["Teille", eur(p2b.marginCents), "text-green-600"],
                      ] as [string, string, string][]).map(([l, v, tone]) => (
                        <div key={l}>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                          <p className={`text-sm font-bold tabular-nums ${tone}`}>{v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {p2b.pendingWashedCount > 0 && (
                    <p className="mb-3 text-[11px] leading-snug text-blue-600 dark:text-blue-400">
                      {p2b.pendingWashedCount} pestyä ikkunaa odottaa asiakkaan hyväksyntää ({eur(p2b.pendingEarnedCents)}) — ei vielä laskussa.
                    </p>
                  )}
                  <Button className="w-full" disabled={p2Sending || p2RemainingCents <= 0} onClick={sendP2}>
                    <Send className="w-4 h-4 mr-2" />
                    {p2Sending ? "Lähetetään…" : p2RemainingCents > 0 ? `Lähetä keltaisten lasku (${eur(p2RemainingCents)})` : "Kaikki keltaiset laskutettu ✓"}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Comprehensive internal report — instalments + crew payouts + expenses
              + margin — emailed to the founders, never the customer. */}
          <Button variant="outline" className="w-full mt-4" disabled={reporting} onClick={sendReport}>
            {reporting ? "Lähetetään…" : "Lähetä maksuraportti johtajille"}
          </Button>
          {/* Tekijöille maksettavat asuvat projektinäkymän Maksut-välilehdellä —
              linkki tänne, ettei samaa osiota tarvitse toistaa tässä näkymässä. */}
          {deal && (
            <button
              type="button"
              onClick={() => navigate(`/admin/gig/${jobId}/projekti?tab=maksut`)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Tekijöiden maksut &amp; erälaskut <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </Card>

      </div>

      {/* Invoice dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{invoiceScope === "p2" ? "Lähetä keltaisten lasku" : invoiceScope === "hours" ? "Lähetä tuntilasku" : "Lähetä lasku"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-muted p-3 text-center">
              <p className="text-xs text-muted-foreground">
                {invoiceScope === "p2"
                  ? "Keltaiset ikkunat — laskuttamaton kertymä"
                  : invoiceScope === "hours"
                  ? "Tunnit, tarvikkeet ja alihankinta — laskuttamaton kertymä"
                  : deal ? `Maksuerä ${invForm.paymentNumber}/4 — kiinteähintainen sopimus` : "Laskutettava summa"}
              </p>
              <p className="text-2xl font-bold text-foreground tabular-nums">
                {invoiceScope === "p2"
                  ? eur2(p2RemainingCents)
                  : invoiceScope === "hours"
                  ? eur2(hoursRemainingCents)
                  : deal ? eur2(fixedInstallmentCents) : eur2(totals.uninvoicedCents)}
              </p>
              {/* Erittely myös dialogissa: lähetysnapin vieressä on nähtävä
                  mistä summa koostuu, ei vain montako euroa lähtee. */}
              {invoiceScope === "hours" && hourlyBill && hourlyBill.lines.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/60 text-left">
                  {hourlyBill.lines.map((l, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 py-0.5">
                      <span className="text-[11px] text-muted-foreground">{l.label}</span>
                      <span className={`text-[11px] tabular-nums shrink-0 ${l.cents == null ? "text-muted-foreground/70" : "font-semibold text-foreground"}`}>
                        {l.cents == null ? "—" : eur2(l.cents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Lähetystapa</Label>
              <div className="flex rounded-lg border p-0.5 gap-0.5 mt-1">
                <button
                  type="button"
                  onClick={() => setInvForm({ ...invForm, sendMethod: "email" })}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${invForm.sendMethod === "email" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Sähköposti
                </button>
                <button
                  type="button"
                  onClick={() => setInvForm({ ...invForm, sendMethod: "verkkolasku" })}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${invForm.sendMethod === "verkkolasku" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Verkkolaskutusosoite
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {invForm.sendMethod === "verkkolasku"
                  ? "Lähetät itse varsinaisen laskun omalla laskutusohjelmallasi verkkolaskuosoitteeseen. Puuhapatet lähettää asiakkaalle vain lyhyen vahvistuksen ja kirjaa erän seurantaan."
                  : "Puuhapatet lähettää täyden, eritellyn laskun suoraan sähköpostitse."}
              </p>
            </div>
            {deal && invoiceScope === "p1" && (
              <div>
                <Label className="text-xs">Maksuerä (monesko)</Label>
                <select
                  value={invForm.paymentNumber}
                  onChange={(e) => setInvForm({ ...invForm, paymentNumber: Number(e.target.value) })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}. erä / 4</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Valitse käsin monesko maksuerä tämä on. Oletus on seuraava lähettämättä oleva erä.
                </p>
              </div>
            )}
            <div>
              <Label className="text-xs">Laskuttaja (kumman nimissä)</Label>
              <select
                value={invForm.billerId}
                onChange={(e) => {
                  const b = resolveBrandBiller(e.target.value);
                  setInvForm({ ...invForm, billerId: e.target.value, iban: b?.iban ?? invForm.iban });
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {BRAND_BILLERS.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.yTunnus ? ` · Y ${b.yTunnus}` : ""}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Tämän erän laskuttava johtaja. Sama nimi + Y-tunnus näkyy laskulla ja on ostaja alihankkijan laskuilla.
              </p>
            </div>
            <div>
              <Label className="text-xs">Vastaanottaja (sähköposti) *</Label>
              <Input type="text" value={invForm.to} onChange={(e) => setInvForm({ ...invForm, to: e.target.value })} placeholder="laskut@yritys.fi" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Voit lisätä useamman osoitteen — erota välilyönnillä, pilkulla tai &-merkillä.
              </p>
              {/* Two contact people → let the founder pick who gets it or both. */}
              {invoiceToEmails.length >= 2 && (
                <div className="mt-2">
                  <p className="text-[11px] text-muted-foreground mb-1.5">Kenelle lähetetään:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {invoiceToEmails.map((email) => {
                      const on = !invForm.excludedRecipients.includes(email);
                      return (
                        <button
                          key={email}
                          type="button"
                          onClick={() => setInvForm((f) => ({
                            ...f,
                            excludedRecipients: on
                              ? [...f.excludedRecipients, email]
                              : f.excludedRecipients.filter((x) => x !== email),
                          }))}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground border-border"}`}
                        >
                          {on ? "✓ " : ""}{email}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Verkkolaskuosoite{invForm.sendMethod === "verkkolasku" ? " *" : " (valinnainen)"}</Label>
              <Input value={invForm.eInvoice} onChange={(e) => setInvForm({ ...invForm, eInvoice: e.target.value })} placeholder="esim. OVT 003712345678 / operaattori" />
              <p className="text-[11px] text-muted-foreground mt-1">
                {invForm.sendMethod === "verkkolasku"
                  ? "Tähän osoitteeseen lähetät itse varsinaisen laskun omalla laskutusohjelmallasi. Puuhapatet lähettää asiakkaalle vain lyhyen vahvistuksen."
                  : "Asiakkaan antama verkkolaskuosoite. Merkitään laskulle. Itse lasku lähtee yllä olevaan sähköpostiin."}
              </p>
            </div>
            {/* IBAN / BIC / viite / eräpäivä matter only for the email invoice
                (barcode + payment block). In verkkolasku mode the founder's own
                invoicing software carries all of that, so these fields do nothing
                here — hide them to keep the dialog clean. */}
            {invForm.sendMethod !== "verkkolasku" && (
              <>
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
              </>
            )}
            <div>
              <Label className="text-xs">Viesti (valinnainen)</Label>
              <Textarea rows={2} value={invForm.message} onChange={(e) => setInvForm({ ...invForm, message: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={invForm.bccSelf} onChange={(e) => setInvForm({ ...invForm, bccSelf: e.target.checked })} />
              Lähetä piilokopio myös minulle{(resolveBrandBiller(invForm.billerId)?.email) ? ` (${resolveBrandBiller(invForm.billerId)!.email})` : ""}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={invForm.isFinal} onChange={(e) => setInvForm({ ...invForm, isFinal: e.target.checked })} />
              Loppulasku (työ valmis)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Peruuta</Button>
            <Button
              disabled={sending || chosenToEmails.length === 0 || (invForm.sendMethod === "verkkolasku" && !invForm.eInvoice)}
              onClick={sendInvoice}
            >
              {sending ? "Lähetetään…" : invForm.sendMethod === "verkkolasku" ? "Lähetä verkkolaskutusosoitteella" : "Lähetä lasku"}
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

      {/* Keikan työkalut. Täältä uusi keikka saa rakennuksen, kerrokset ja
          pohjakuvan polun — sulkeutuessa projekti ladataan uudelleen, jotta
          muuttunut kerroslista näkyy heti hinta-/ikkunaluvuissa. */}
      {toolsOpen && (
        <Suspense fallback={null}>
          <GigToolsOverlay
            jobId={jobId}
            title={gig?.company?.name || "Sopimuskeikka"}
            onClose={() => {
              setToolsOpen(false);
              void api.getProject(jobId).then((res) => {
                if (res.ok && res.data?.project) setProject(res.data.project);
              });
            }}
          />
        </Suspense>
      )}
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
