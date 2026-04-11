/**
 * New Job Wizard - "Uusi Keikka"
 *
 * Steps:
 * 0. Customer info (customer fills on iPad)
 * 1. Site assessment notes (staff fills)
 * 2. Pricing — same model as laskuri.tsx
 * 3. Contract + signatures
 * 4. Done
 */

import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, User, ClipboardCheck, Package,
  FileText, CheckCircle, Loader2, Percent, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { api, generateJobId } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

type WizardStep = 0 | 1 | 2 | 3 | 4;

// ─── Pricing tables — same values as laskuri.tsx ─────────────────────────────

const HOUSE_TYPES = [
  { key: "omakoti",    label: "Omakotitalo", sub: "Erillistalo" },
  { key: "paritalo",   label: "Paritalo",    sub: "2 huoneistoa" },
  { key: "rivitalo",   label: "Rivitalo",    sub: "Oma huoneisto" },
  { key: "kerrostalo", label: "Kerrostalo",  sub: "Huoneisto" },
] as const;
type HouseKey = (typeof HOUSE_TYPES)[number]["key"];

const SQM_RANGES: Record<HouseKey, { label: string; price: number }[]> = {
  omakoti: [
    { label: "alle 60 m²",  price: 139 },
    { label: "60–80 m²",    price: 169 },
    { label: "80–100 m²",   price: 199 },
    { label: "100–120 m²",  price: 229 },
    { label: "120–140 m²",  price: 269 },
    { label: "140–160 m²",  price: 309 },
    { label: "160–180 m²",  price: 349 },
    { label: "180–200 m²",  price: 389 },
    { label: "200–220 m²",  price: 439 },
    { label: "220–240 m²",  price: 489 },
    { label: "240–260 m²",  price: 549 },
    { label: "260–280 m²",  price: 609 },
    { label: "yli 280 m²",  price: 669 },
  ],
  paritalo: [
    { label: "alle 60 m²",  price: 139 },
    { label: "60–80 m²",    price: 169 },
    { label: "80–100 m²",   price: 199 },
    { label: "100–120 m²",  price: 229 },
    { label: "120–140 m²",  price: 269 },
    { label: "140–160 m²",  price: 309 },
    { label: "160–180 m²",  price: 349 },
    { label: "180–200 m²",  price: 389 },
    { label: "200–220 m²",  price: 439 },
    { label: "220–240 m²",  price: 489 },
    { label: "240–260 m²",  price: 549 },
    { label: "260–280 m²",  price: 609 },
    { label: "yli 280 m²",  price: 669 },
  ],
  rivitalo: [
    { label: "alle 40 m²",  price:  89 },
    { label: "40–60 m²",    price: 109 },
    { label: "60–80 m²",    price: 129 },
    { label: "80–100 m²",   price: 149 },
    { label: "100–120 m²",  price: 169 },
    { label: "120–140 m²",  price: 199 },
    { label: "140–160 m²",  price: 229 },
    { label: "yli 160 m²",  price: 279 },
  ],
  kerrostalo: [
    { label: "alle 40 m²",  price:  99 },
    { label: "40–60 m²",    price: 119 },
    { label: "60–80 m²",    price: 149 },
    { label: "80–100 m²",   price: 179 },
    { label: "100–120 m²",  price: 209 },
    { label: "120–140 m²",  price: 249 },
    { label: "yli 140 m²",  price: 329 },
  ],
};

const SERVICE_TIERS = [
  { key: "all",     label: "Kaikki pinnat",   sub: "Sisä + ulko",        mult: 1.00 },
  { key: "outside", label: "Vain ulkopinnat", sub: "Nopea ja edullinen", mult: 0.58 },
  { key: "annual",  label: "Vuosipaketti 2×", sub: "10 % alennus",       mult: 1.80 },
] as const;
type TierKey = (typeof SERVICE_TIERS)[number]["key"];

const ADDONS = [
  { key: "balcony", label: "Parveke-/terassilasit", price: 39 },
  { key: "railing", label: "Lasikaide",             price: 39 },
  { key: "mirror",  label: "Peilien pesu",          price: 19 },
  { key: "canopy",  label: "Terassin lasikate",     price: 89 },
  { key: "gutter",  label: "Rännien puhdistus",     price: 69 },
] as const;
type AddonKey = (typeof ADDONS)[number]["key"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobFormData {
  jobId: string;
  // Customer
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerLanguage: "fi" | "en";
  customerNotes: string;
  // Assessment
  accessConstraints: string;
  weatherNotes: string;
  internalNotes: string;
  // Pricing
  houseType: HouseKey | "";
  sqmIdx: number | null;
  serviceTier: TierKey;
  selectedAddons: AddonKey[];
  originalPrice: number;
  discountPercent: number;
  discountReason: string;
  finalPrice: number;
  // Contract
  customerSignature: string;
  staffSignature: string;
  agreedTerms: boolean;
}

const EMPTY_FORM: JobFormData = {
  jobId: "",
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  customerAddress: "",
  customerLanguage: "fi",
  customerNotes: "",
  accessConstraints: "",
  weatherNotes: "",
  internalNotes: "",
  houseType: "",
  sqmIdx: null,
  serviceTier: "all",
  selectedAddons: [],
  originalPrice: 0,
  discountPercent: 0,
  discountReason: "",
  finalPrice: 0,
  customerSignature: "",
  staffSignature: "",
  agreedTerms: false,
};

const steps = [
  { icon: User,          label: "Asiakas",     short: "Tiedot" },
  { icon: ClipboardCheck,label: "Arviointi",   short: "Kohde" },
  { icon: Package,       label: "Hinnoittelu", short: "Hinta" },
  { icon: FileText,      label: "Sopimus",     short: "Allekirj." },
  { icon: CheckCircle,   label: "Valmis",      short: "Valmis" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcPrice(data: JobFormData): { original: number; final: number } {
  const ht = data.houseType as HouseKey | "";
  const si = data.sqmIdx;
  const tierMult = SERVICE_TIERS.find(t => t.key === data.serviceTier)?.mult ?? 1.0;
  const addonsTotal = ADDONS.reduce((s, a) => s + (data.selectedAddons.includes(a.key) ? a.price : 0), 0);
  let original = addonsTotal;
  if (ht && si !== null) {
    const base = SQM_RANGES[ht]?.[si]?.price ?? 0;
    original = Math.round(base * tierMult) + addonsTotal;
  }
  const final = Math.round(original * (1 - data.discountPercent / 100) * 100) / 100;
  return { original, final };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewJobPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const customerSigRef = useRef<HTMLCanvasElement>(null);
  const staffSigRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingCustomer, setIsDrawingCustomer] = useState(false);
  const [isDrawingStaff, setIsDrawingStaff] = useState(false);

  const profile = getAdminProfile();

  const [formData, setFormData] = useState<JobFormData>(EMPTY_FORM);

  useEffect(() => {
    setFormData((prev) => ({ ...prev, jobId: generateJobId() }));
  }, []);

  const updateForm = (updates: Partial<JobFormData>) => {
    setFormData((prev) => {
      const next = { ...prev, ...updates };

      // Changing house type resets sqm and prices
      if ("houseType" in updates && updates.houseType !== prev.houseType) {
        next.sqmIdx = null;
        next.originalPrice = 0;
        next.finalPrice = 0;
        return next;
      }

      // Recalculate price when any pricing input changes
      if (
        "sqmIdx" in updates ||
        "serviceTier" in updates ||
        "selectedAddons" in updates ||
        "discountPercent" in updates
      ) {
        const { original, final } = calcPrice(next);
        next.originalPrice = original;
        next.finalPrice = final;
      }

      return next;
    });
  };

  // ── Canvas signatures ──────────────────────────────────────────────────────

  const initCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent, isCustomer: boolean) => {
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
    if (isCustomer) setIsDrawingCustomer(true);
    else setIsDrawingStaff(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent, isCustomer: boolean) => {
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

  const stopDrawing = (isCustomer: boolean) => {
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL();
      if (isCustomer) { updateForm({ customerSignature: dataUrl }); setIsDrawingCustomer(false); }
      else             { updateForm({ staffSignature: dataUrl });    setIsDrawingStaff(false); }
    }
  };

  const clearSignature = (isCustomer: boolean) => {
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isCustomer) updateForm({ customerSignature: "" });
    else            updateForm({ staffSignature: "" });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmitJob = async () => {
    if (!formData.houseType || formData.sqmIdx === null) {
      toast({ variant: "destructive", title: "Hinnoittelu puuttuu", description: "Valitse kiinteistötyyppi ja koko." });
      return;
    }
    if (!formData.customerSignature) {
      toast({ variant: "destructive", title: "Allekirjoitus puuttuu", description: "Asiakkaan allekirjoitus vaaditaan." });
      return;
    }
    if (!formData.agreedTerms) {
      toast({ variant: "destructive", title: "Hyväksy ehdot", description: "Palveluehdot on hyväksyttävä ennen lähettämistä." });
      return;
    }

    setIsSubmitting(true);
    try {
      const customerRes = await api.createCustomer({
        name: formData.customerName,
        phone: formData.customerPhone,
        email: formData.customerEmail || undefined,
        address: formData.customerAddress,
        notes: formData.customerNotes || undefined,
      });

      if (!customerRes.ok || !customerRes.data?.id) {
        toast({ variant: "destructive", title: "Asiakastietojen tallennus epäonnistui", description: customerRes.error || "Yritä uudelleen." });
        setIsSubmitting(false);
        return;
      }

      const customerId = customerRes.data.id;

      const houseLabel = HOUSE_TYPES.find(h => h.key === formData.houseType)?.label ?? "";
      const sqmLabel   = formData.houseType && formData.sqmIdx !== null
        ? SQM_RANGES[formData.houseType as HouseKey]?.[formData.sqmIdx]?.label ?? ""
        : "";
      const tierLabel  = SERVICE_TIERS.find(t => t.key === formData.serviceTier)?.label ?? "";
      const addonLabels = ADDONS.filter(a => formData.selectedAddons.includes(a.key)).map(a => a.label);

      const description = [
        `${houseLabel} ${sqmLabel}`.trim(),
        tierLabel,
        ...addonLabels,
        formData.discountPercent > 0 && `Alennus: ${formData.discountPercent}% (${formData.discountReason || "—"})`,
      ].filter(Boolean).join(" | ");

      const internalNotes = [
        formData.internalNotes,
        formData.accessConstraints && `Kulkurajoitukset: ${formData.accessConstraints}`,
        formData.weatherNotes && `Sää: ${formData.weatherNotes}`,
        `Allekirjoitettu: asiakas=${formData.customerSignature ? "kyllä" : "ei"}, henkilöstö=${formData.staffSignature ? "kyllä" : "ei"}`,
      ].filter(Boolean).join("\n");

      const jobRes = await api.createJob({
        customerId,
        description,
        agreedPrice: Math.round(formData.finalPrice * 100),
        status: "lead",
        assignedTo: profile?.name || undefined,
        notes: internalNotes || undefined,
      });

      if (!jobRes.ok || !jobRes.data?.id) {
        toast({ variant: "destructive", title: "Keikan tallennus epäonnistui", description: jobRes.error || "Yritä uudelleen." });
        setIsSubmitting(false);
        return;
      }

      toast({ title: "Keikka luotu!", description: `Asiakas #${customerId} · Keikka #${jobRes.data.id}` });
      setCurrentStep(4);
    } catch {
      toast({ variant: "destructive", title: "Yhteysvirhe", description: "Tarkista verkkoyhteys ja yritä uudelleen." });
    }
    setIsSubmitting(false);
  };

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goNext = () => {
    if (currentStep === 0) {
      if (!formData.customerName || !formData.customerPhone || !formData.customerAddress) {
        toast({ variant: "destructive", title: "Täytä pakolliset kentät", description: "Nimi, puhelin ja osoite vaaditaan." });
        return;
      }
    }
    if (currentStep === 2) {
      if (!formData.houseType || formData.sqmIdx === null) {
        toast({ variant: "destructive", title: "Valitse kohde", description: "Valitse kiinteistötyyppi ja koko ennen jatkamista." });
        return;
      }
    }
    if (currentStep < 4) setCurrentStep((prev) => (prev + 1) as WizardStep);
  };

  const goBack = () => {
    if (currentStep > 0) setCurrentStep((prev) => (prev - 1) as WizardStep);
  };

  const resetWizard = () => {
    setFormData({ ...EMPTY_FORM, jobId: generateJobId() });
    setCurrentStep(0);
  };

  // ── Contract summary helpers ───────────────────────────────────────────────

  const houseLabel = HOUSE_TYPES.find(h => h.key === formData.houseType)?.label ?? "";
  const sqmLabel   = formData.houseType && formData.sqmIdx !== null
    ? SQM_RANGES[formData.houseType as HouseKey]?.[formData.sqmIdx]?.label ?? ""
    : "";
  const tierLabel  = SERVICE_TIERS.find(t => t.key === formData.serviceTier)?.label ?? "";
  const addonLabels = ADDONS.filter(a => formData.selectedAddons.includes(a.key)).map(a => a.label);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Uusi keikka</h1>
            <p className="text-sm text-muted-foreground">
              {steps[currentStep].label}
              {formData.jobId && ` · ${formData.jobId}`}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center justify-between mb-8 px-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive    = index === currentStep;
            const isCompleted = index < currentStep;
            return (
              <div key={index} className="flex flex-col items-center gap-1">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                  isActive    && "bg-primary text-primary-foreground",
                  isCompleted && "bg-primary/20 text-primary",
                  !isActive && !isCompleted && "bg-muted text-muted-foreground",
                )}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={cn(
                  "text-xs",
                  isActive && "text-primary font-medium",
                  !isActive && "text-muted-foreground",
                )}>
                  {step.short}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Step 0: Customer info ── */}
        {currentStep === 0 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">Asiakkaan tiedot</h2>
            <p className="text-sm text-muted-foreground mb-6">Anna iPad asiakkaalle täytettäväksi.</p>

            <div className="space-y-4">
              <div>
                <Label htmlFor="customerName">Nimi *</Label>
                <Input
                  id="customerName"
                  value={formData.customerName}
                  onChange={(e) => updateForm({ customerName: e.target.value })}
                  placeholder="Koko nimi"
                  className="mt-2"
                  data-testid="input-customer-name"
                />
              </div>
              <div>
                <Label htmlFor="customerPhone">Puhelin *</Label>
                <Input
                  id="customerPhone"
                  type="tel"
                  value={formData.customerPhone}
                  onChange={(e) => updateForm({ customerPhone: e.target.value })}
                  placeholder="+358 40 123 4567"
                  className="mt-2"
                  data-testid="input-customer-phone"
                />
              </div>
              <div>
                <Label htmlFor="customerEmail">Sähköposti</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  value={formData.customerEmail}
                  onChange={(e) => updateForm({ customerEmail: e.target.value })}
                  placeholder="email@esimerkki.fi"
                  className="mt-2"
                  data-testid="input-customer-email"
                />
              </div>
              <div>
                <Label htmlFor="customerAddress">Osoite *</Label>
                <Input
                  id="customerAddress"
                  value={formData.customerAddress}
                  onChange={(e) => updateForm({ customerAddress: e.target.value })}
                  placeholder="Katuosoite"
                  className="mt-2"
                  data-testid="input-customer-address"
                />
              </div>
              <div>
                <Label htmlFor="customerNotes">Lisätiedot</Label>
                <Textarea
                  id="customerNotes"
                  value={formData.customerNotes}
                  onChange={(e) => updateForm({ customerNotes: e.target.value })}
                  placeholder="Muita huomioita…"
                  className="mt-2 min-h-20 resize-none"
                  data-testid="input-customer-notes"
                />
              </div>

              <div className="pt-4">
                <Button
                  className="w-full"
                  onClick={goNext}
                  disabled={!formData.customerName || !formData.customerPhone || !formData.customerAddress}
                  data-testid="btn-next"
                >
                  Seuraava
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Step 1: Site assessment ── */}
        {currentStep === 1 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">Kohteen arviointi</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Henkilökunnan huomiot kohteesta (kaikki valinnaisia).
            </p>

            <div className="space-y-4">
              <div>
                <Label htmlFor="accessConstraints">Kulkurajoitukset</Label>
                <Input
                  id="accessConstraints"
                  value={formData.accessConstraints}
                  onChange={(e) => updateForm({ accessConstraints: e.target.value })}
                  placeholder="Esim. tikkaat tarvitaan, hankala pääsy…"
                  className="mt-2"
                  data-testid="input-access-constraints"
                />
              </div>
              <div>
                <Label htmlFor="weatherNotes">Sää / kausihuomiot</Label>
                <Input
                  id="weatherNotes"
                  value={formData.weatherNotes}
                  onChange={(e) => updateForm({ weatherNotes: e.target.value })}
                  placeholder="Esim. pakkasraja, märkä pinta…"
                  className="mt-2"
                  data-testid="input-weather-notes"
                />
              </div>
              <div>
                <Label htmlFor="internalNotes">Sisäiset muistiinpanot</Label>
                <Textarea
                  id="internalNotes"
                  value={formData.internalNotes}
                  onChange={(e) => updateForm({ internalNotes: e.target.value })}
                  placeholder="Tiimin sisäisiä huomioita…"
                  className="mt-2 min-h-20 resize-none"
                  data-testid="input-internal-notes"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={goBack} data-testid="btn-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Takaisin
                </Button>
                <Button className="flex-1" onClick={goNext} data-testid="btn-next">
                  Seuraava
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Step 2: Pricing ── */}
        {currentStep === 2 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">Hinnoittelu</h2>
            <p className="text-sm text-muted-foreground mb-6">Valitse kohde ja palvelut.</p>

            <div className="space-y-6">

              {/* House type */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Kiinteistötyyppi
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {HOUSE_TYPES.map((ht) => (
                    <button
                      key={ht.key}
                      type="button"
                      onClick={() => updateForm({ houseType: ht.key })}
                      className={cn(
                        "p-3 rounded-xl border-2 text-left transition-all",
                        formData.houseType === ht.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/40",
                      )}
                      data-testid={`house-${ht.key}`}
                    >
                      <p className="font-medium text-sm text-foreground">{ht.label}</p>
                      <p className="text-xs text-muted-foreground">{ht.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sqm range */}
              {formData.houseType && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Koko
                  </p>
                  <Select
                    value={formData.sqmIdx !== null ? String(formData.sqmIdx) : ""}
                    onValueChange={(v) => updateForm({ sqmIdx: parseInt(v, 10) })}
                  >
                    <SelectTrigger data-testid="select-sqm">
                      <SelectValue placeholder="Valitse koko…" />
                    </SelectTrigger>
                    <SelectContent>
                      {SQM_RANGES[formData.houseType as HouseKey].map((r, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Service tier */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Palvelu
                </p>
                <div className="space-y-2">
                  {SERVICE_TIERS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => updateForm({ serviceTier: t.key })}
                      className={cn(
                        "w-full p-3 rounded-xl border-2 text-left transition-all flex items-center justify-between",
                        formData.serviceTier === t.key
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/40",
                      )}
                      data-testid={`tier-${t.key}`}
                    >
                      <div>
                        <p className="font-medium text-sm text-foreground">{t.label}</p>
                        <p className="text-xs text-muted-foreground">{t.sub}</p>
                      </div>
                      {formData.serviceTier === t.key && (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Addons */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Lisäpalvelut
                </p>
                <div className="space-y-2">
                  {ADDONS.map((a) => {
                    const isOn = formData.selectedAddons.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => {
                          const next = isOn
                            ? formData.selectedAddons.filter(k => k !== a.key)
                            : [...formData.selectedAddons, a.key];
                          updateForm({ selectedAddons: next });
                        }}
                        className={cn(
                          "w-full p-3 rounded-xl border-2 text-left flex items-center justify-between transition-all",
                          isOn
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/40",
                        )}
                        data-testid={`addon-${a.key}`}
                      >
                        <span className="text-sm font-medium text-foreground">{a.label}</span>
                        <span className={cn("text-sm font-semibold shrink-0 ml-2", isOn ? "text-primary" : "text-muted-foreground")}>
                          +{a.price} €
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pricing summary + discount */}
              {formData.sqmIdx !== null && (
                <div className="border-t pt-5 space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Perushinta</span>
                    <span className="font-medium text-foreground">{formData.originalPrice} €</span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="flex items-center gap-1.5 text-sm">
                        <Percent className="w-3.5 h-3.5" />
                        Alennus
                      </Label>
                      <span className="font-medium text-sm">{formData.discountPercent} %</span>
                    </div>
                    <Slider
                      value={[formData.discountPercent]}
                      onValueChange={([v]) => updateForm({ discountPercent: v })}
                      max={50}
                      step={5}
                      className="my-2"
                      data-testid="slider-discount"
                    />
                  </div>

                  {formData.discountPercent > 0 && (
                    <div>
                      <Label htmlFor="discountReason">Alennuksen syy</Label>
                      <Input
                        id="discountReason"
                        value={formData.discountReason}
                        onChange={(e) => updateForm({ discountReason: e.target.value })}
                        placeholder="Esim. ensimmäinen tilaus…"
                        className="mt-1.5"
                        data-testid="input-discount-reason"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className="font-semibold text-foreground">Lopullinen hinta</span>
                    <span className="text-2xl font-bold text-primary">{formData.finalPrice} €</span>
                  </div>

                  <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                    Kotitalousvähennys ~{Math.round(formData.finalPrice * 0.35)} € → asiakkaalle ~{Math.round(formData.finalPrice * 0.65)} €
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-6">
              <Button variant="outline" onClick={goBack} data-testid="btn-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Takaisin
              </Button>
              <Button
                className="flex-1"
                onClick={goNext}
                disabled={!formData.houseType || formData.sqmIdx === null}
                data-testid="btn-next"
              >
                Seuraava
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {/* ── Step 3: Contract + signatures ── */}
        {currentStep === 3 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">Sopimus</h2>
            <p className="text-sm text-muted-foreground mb-6">Yhteenveto ja allekirjoitukset.</p>

            {/* Summary */}
            <div className="space-y-3 mb-6 p-4 bg-muted/50 rounded-xl text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Asiakas</span>
                <span className="font-medium">{formData.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Osoite</span>
                <span className="font-medium">{formData.customerAddress}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kohde</span>
                <span className="font-medium">{houseLabel} {sqmLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Palvelu</span>
                <span className="font-medium">{tierLabel}</span>
              </div>
              {addonLabels.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lisäpalvelut</span>
                  <span className="font-medium text-right max-w-[55%]">{addonLabels.join(", ")}</span>
                </div>
              )}
              {formData.discountPercent > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Alennus</span>
                  <span className="font-medium text-orange-600 dark:text-orange-400">−{formData.discountPercent} %</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-3">
                <span className="font-semibold text-foreground">Hinta</span>
                <span className="text-primary font-bold text-xl">{formData.finalPrice} €</span>
              </div>
            </div>

            {/* Signatures */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Asiakkaan allekirjoitus</Label>
                  <Button variant="ghost" size="sm" onClick={() => clearSignature(true)} data-testid="btn-clear-customer-sig">
                    Tyhjennä
                  </Button>
                </div>
                <canvas
                  ref={(el) => { (customerSigRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el; initCanvas(el); }}
                  width={300}
                  height={100}
                  className="w-full border rounded-xl bg-white touch-none"
                  style={{ touchAction: "none", height: "100px" }}
                  onMouseDown={(e) => startDrawing(e, true)}
                  onMouseMove={(e) => draw(e, true)}
                  onMouseUp={() => stopDrawing(true)}
                  onMouseLeave={() => stopDrawing(true)}
                  onTouchStart={(e) => startDrawing(e, true)}
                  onTouchMove={(e) => draw(e, true)}
                  onTouchEnd={() => stopDrawing(true)}
                  data-testid="canvas-customer-signature"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Työntekijän allekirjoitus</Label>
                  <Button variant="ghost" size="sm" onClick={() => clearSignature(false)} data-testid="btn-clear-staff-sig">
                    Tyhjennä
                  </Button>
                </div>
                <canvas
                  ref={(el) => { (staffSigRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el; initCanvas(el); }}
                  width={300}
                  height={100}
                  className="w-full border rounded-xl bg-white touch-none"
                  style={{ touchAction: "none", height: "100px" }}
                  onMouseDown={(e) => startDrawing(e, false)}
                  onMouseMove={(e) => draw(e, false)}
                  onMouseUp={() => stopDrawing(false)}
                  onMouseLeave={() => stopDrawing(false)}
                  onTouchStart={(e) => startDrawing(e, false)}
                  onTouchMove={(e) => draw(e, false)}
                  onTouchEnd={() => stopDrawing(false)}
                  data-testid="canvas-staff-signature"
                />
              </div>

              <label className="flex items-start gap-3 p-4 bg-muted/30 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.agreedTerms}
                  onChange={(e) => updateForm({ agreedTerms: e.target.checked })}
                  className="mt-1"
                  data-testid="checkbox-agree-terms"
                />
                <span className="text-sm text-muted-foreground">
                  Hyväksyn Puuhapatet-palvelun ehdot ja vahvistan tilauksen.
                </span>
              </label>
            </div>

            <div className="flex gap-3 pt-6">
              <Button variant="outline" onClick={goBack} data-testid="btn-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Takaisin
              </Button>
              <Button
                className="flex-1"
                onClick={handleSubmitJob}
                disabled={isSubmitting || !formData.agreedTerms || !formData.customerSignature}
                data-testid="btn-submit"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Vahvista ja lähetä
              </Button>
            </div>
          </Card>
        )}

        {/* ── Step 4: Done ── */}
        {currentStep === 4 && (
          <Card className="p-6 bg-card border-0 premium-shadow text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Valmis!</h2>
            <p className="text-muted-foreground mb-2">Keikka on tallennettu.</p>
            <p className="font-mono text-primary mb-6">{formData.jobId}</p>

            <div className="space-y-3">
              <Link href="/admin/jobs">
                <Button className="w-full" data-testid="btn-view-jobs">
                  Näytä keikat
                </Button>
              </Link>
              <Button variant="outline" className="w-full" onClick={resetWizard} data-testid="btn-new-job">
                Luo uusi keikka
              </Button>
            </div>
          </Card>
        )}

      </div>
    </div>
  );
}
