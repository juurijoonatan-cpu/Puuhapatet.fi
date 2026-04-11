/**
 * New Job Wizard - "Uusi Keikka"
 * 
 * The heart of the admin tool for door-to-door sales.
 * 
 * Steps:
 * 0. Optional prefill by Lead-ID / JobID
 * 1. Customer info (customer fills on iPad)
 * 2. Employer assessment (staff fills after handback)
 * 3. Package proposal with pricing
 * 4. Agreement/contract with signatures
 * 5. Completion (submit to API)
 */

import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Search, User, ClipboardCheck, Package, FileText, CheckCircle, Loader2, Percent, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { api, generateJobId, NormalizedPackage } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

interface JobFormData {
  jobId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerLanguage: "fi" | "en";
  customerNotes: string;
  propertyType: string;
  floors: string;
  windowCount: string;
  accessConstraints: string;
  weatherNotes: string;
  internalNotes: string;
  selectedPackage: string;
  selectedPackageName: string;
  originalPrice: number;
  discountPercent: number;
  discountReason: string;
  finalPrice: number;
  customerSignature: string;
  staffSignature: string;
  agreedTerms: boolean;
}

const steps = [
  { icon: Search, label: "Hae", short: "ID" },
  { icon: User, label: "Asiakas", short: "Tiedot" },
  { icon: ClipboardCheck, label: "Arviointi", short: "Kohde" },
  { icon: Package, label: "Paketti", short: "Ehdotus" },
  { icon: FileText, label: "Sopimus", short: "Allekirj." },
  { icon: CheckCircle, label: "Valmis", short: "Valmis" },
];

export default function NewJobPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [prefillJobId, setPrefillJobId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [packages, setPackages] = useState<NormalizedPackage[]>([]);
  const [packagesLoading] = useState(false);
  
  const customerSigRef = useRef<HTMLCanvasElement>(null);
  const staffSigRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingCustomer, setIsDrawingCustomer] = useState(false);
  const [isDrawingStaff, setIsDrawingStaff] = useState(false);

  const profile = getAdminProfile();

  const [formData, setFormData] = useState<JobFormData>({
    jobId: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    customerAddress: "",
    customerLanguage: "fi",
    customerNotes: "",
    propertyType: "",
    floors: "",
    windowCount: "",
    accessConstraints: "",
    weatherNotes: "",
    internalNotes: "",
    selectedPackage: "",
    selectedPackageName: "",
    originalPrice: 0,
    discountPercent: 0,
    discountReason: "",
    finalPrice: 0,
    customerSignature: "",
    staffSignature: "",
    agreedTerms: false,
  });

  const updateForm = (updates: Partial<JobFormData>) => {
    setFormData((prev) => {
      const newData = { ...prev, ...updates };
      if ("originalPrice" in updates || "discountPercent" in updates) {
        const price = updates.originalPrice ?? prev.originalPrice;
        const discount = updates.discountPercent ?? prev.discountPercent;
        newData.finalPrice = Math.round(price * (1 - discount / 100) * 100) / 100;
      }
      return newData;
    });
  };

  useEffect(() => {
    if (currentStep === 3 && packages.length === 0) {
      loadPackages();
    }
  }, [currentStep, packages.length]);

  const loadPackages = () => {
    setPackages([
      { id: "BASIC",   name: "Peruspesu", description: "Ikkunoiden peruspesu ulkoa",          price: 89,  durationMinutes: 60,  active: true },
      { id: "FULL",    name: "Täyspesu",  description: "Ikkunat ja karmit sisä + ulko",        price: 149, durationMinutes: 90,  active: true },
      { id: "PREMIUM", name: "Premium",   description: "Kaikki pinnat, sisä ja ulko + karmit", price: 249, durationMinutes: 120, active: true },
    ]);
  };

  const handlePrefill = async () => {
    if (!prefillJobId.trim()) {
      toast({
        variant: "destructive",
        title: "Anna tilausnumero",
        description: "Syötä Asiakas-ID/Lead-ID hakeaksesi tietoja.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const result = await api.getJob(prefillJobId.trim());
      if (result.ok && result.data?.ok && result.data.job) {
        const job = result.data.job as Record<string, unknown>;
        updateForm({
          jobId: (job.JobID as string) || prefillJobId,
          customerName: (job.CustomerName as string) || "",
          customerPhone: (job.CustomerPhone as string) || "",
          customerEmail: (job.CustomerEmail as string) || "",
          customerAddress: (job.Address as string) || "",
          customerNotes: (job.Notes as string) || "",
        });
        toast({
          title: "Tiedot haettu",
          description: "Asiakastiedot ladattu onnistuneesti.",
        });
        setCurrentStep(1);
      } else {
        toast({
          variant: "destructive",
          title: "Tilausta ei löytynyt",
          description: "Tarkista tilausnumero tai jatka uutena tilauksena.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Virhe haussa",
        description: "Yhteysongelma. Yritä uudelleen.",
      });
    }
    setIsLoading(false);
  };

  const handleSkipPrefill = () => {
    updateForm({ jobId: generateJobId() });
    setCurrentStep(1);
  };

  const selectPackage = (pkg: NormalizedPackage) => {
    updateForm({
      selectedPackage: pkg.id,
      selectedPackageName: pkg.name,
      originalPrice: pkg.price,
      finalPrice: pkg.price * (1 - formData.discountPercent / 100),
    });
  };

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
    if ("touches" in e) {
      e.preventDefault();
    }
    
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    
    if (isCustomer) {
      setIsDrawingCustomer(true);
    } else {
      setIsDrawingStaff(true);
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent, isCustomer: boolean) => {
    const isDrawing = isCustomer ? isDrawingCustomer : isDrawingStaff;
    if (!isDrawing) return;

    if ("touches" in e) {
      e.preventDefault();
    }

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
      if (isCustomer) {
        updateForm({ customerSignature: dataUrl });
        setIsDrawingCustomer(false);
      } else {
        updateForm({ staffSignature: dataUrl });
        setIsDrawingStaff(false);
      }
    }
  };

  const clearSignature = (isCustomer: boolean) => {
    const canvas = isCustomer ? customerSigRef.current : staffSigRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isCustomer) {
      updateForm({ customerSignature: "" });
    } else {
      updateForm({ staffSignature: "" });
    }
  };

  const handleSubmitJob = async () => {
    if (!formData.selectedPackage) {
      toast({
        variant: "destructive",
        title: "Valitse paketti",
        description: "Valitse palvelupaketti ennen sopimuksen lähettämistä.",
      });
      return;
    }
    if (!formData.customerSignature) {
      toast({
        variant: "destructive",
        title: "Allekirjoitus puuttuu",
        description: "Asiakkaan allekirjoitus vaaditaan.",
      });
      return;
    }
    if (!formData.agreedTerms) {
      toast({
        variant: "destructive",
        title: "Hyväksy ehdot",
        description: "Palveluehdot on hyväksyttävä ennen lähettämistä.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Create or find customer
      const customerRes = await api.createCustomer({
        name: formData.customerName,
        phone: formData.customerPhone,
        email: formData.customerEmail || undefined,
        address: formData.customerAddress,
        notes: formData.customerNotes || undefined,
      });

      if (!customerRes.ok || !customerRes.data?.id) {
        toast({
          variant: "destructive",
          title: "Asiakastietojen tallennus epäonnistui",
          description: customerRes.error || "Yritä uudelleen.",
        });
        setIsSubmitting(false);
        return;
      }

      const customerId = customerRes.data.id;

      // 2. Create job
      const description = [
        formData.selectedPackageName,
        formData.propertyType && `Kohde: ${formData.propertyType}`,
        formData.floors && `Kerrokset: ${formData.floors}`,
        formData.windowCount && `Ikkunat: ${formData.windowCount}`,
        formData.accessConstraints && `Rajoitteet: ${formData.accessConstraints}`,
        formData.discountPercent > 0 && `Alennus: ${formData.discountPercent}% (${formData.discountReason})`,
      ]
        .filter(Boolean)
        .join(" | ");

      const internalNotes = [
        formData.internalNotes,
        formData.weatherNotes && `Sää: ${formData.weatherNotes}`,
        `Allekirjoitettu: asiakas=${formData.customerSignature ? "kyllä" : "ei"}, henkilöstö=${formData.staffSignature ? "kyllä" : "ei"}`,
      ]
        .filter(Boolean)
        .join("\n");

      const jobRes = await api.createJob({
        customerId,
        description,
        agreedPrice: Math.round(formData.finalPrice * 100), // euros → cents
        status: "lead",
        assignedTo: profile?.name || undefined,
        notes: internalNotes || undefined,
      });

      if (!jobRes.ok || !jobRes.data?.id) {
        toast({
          variant: "destructive",
          title: "Keikan tallennus epäonnistui",
          description: jobRes.error || "Yritä uudelleen.",
        });
        setIsSubmitting(false);
        return;
      }

      toast({
        title: "Keikka luotu!",
        description: `Asiakas #${customerId} · Keikka #${jobRes.data.id}`,
      });
      setCurrentStep(5);
    } catch {
      toast({
        variant: "destructive",
        title: "Yhteysvirhe",
        description: "Tarkista verkkoyhteys ja yritä uudelleen.",
      });
    }

    setIsSubmitting(false);
  };

  const goNext = () => {
    if (currentStep === 2) {
      if (!formData.propertyType || !formData.floors || !formData.windowCount) {
        toast({
          variant: "destructive",
          title: "Täytä pakolliset kentät",
          description: "Valitse kiinteistötyyppi, kerrokset ja ikkunamäärä.",
        });
        return;
      }
    }
    if (currentStep === 3) {
      if (!formData.selectedPackage) {
        toast({
          variant: "destructive",
          title: "Valitse paketti",
          description: "Valitse palvelupaketti ennen jatkamista.",
        });
        return;
      }
    }
    if (currentStep < 5) {
      setCurrentStep((prev) => (prev + 1) as WizardStep);
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const resetWizard = () => {
    setFormData({
      jobId: "",
      customerName: "",
      customerPhone: "",
      customerEmail: "",
      customerAddress: "",
      customerLanguage: "fi",
      customerNotes: "",
      propertyType: "",
      floors: "",
      windowCount: "",
      accessConstraints: "",
      weatherNotes: "",
      internalNotes: "",
      selectedPackage: "",
      selectedPackageName: "",
      originalPrice: 0,
      discountPercent: 0,
      discountReason: "",
      finalPrice: 0,
      customerSignature: "",
      staffSignature: "",
      agreedTerms: false,
    });
    setCurrentStep(0);
    setPrefillJobId("");
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon" data-testid="back-to-dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Uusi keikka
            </h1>
            <p className="text-sm text-muted-foreground">
              {steps[currentStep].label}
              {formData.jobId && ` • ${formData.jobId}`}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-8 px-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            return (
              <div key={index} className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                    isActive && "bg-primary text-primary-foreground",
                    isCompleted && "bg-primary/20 text-primary",
                    !isActive && !isCompleted && "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className={cn(
                  "text-xs",
                  isActive && "text-primary font-medium",
                  !isActive && "text-muted-foreground"
                )}>
                  {step.short}
                </span>
              </div>
            );
          })}
        </div>

        {currentStep === 0 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Onko asiakkaalla jo Puuha-ID?
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Jos asiakas on jättänyt yhteydenottopyynnön verkkosivuilla, 
              hän on saanut Puuha-ID:n jolla tiedot voidaan hakea.
            </p>

            <div className="space-y-4">
              <div>
                <Label htmlFor="prefillJobId">Asiakas-ID / Lead-ID</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="prefillJobId"
                    value={prefillJobId}
                    onChange={(e) => setPrefillJobId(e.target.value.toUpperCase())}
                    placeholder="PP-XXXX-XXXX"
                    className="font-mono flex-1"
                    data-testid="input-prefill-job-id"
                  />
                  <Button
                    onClick={handlePrefill}
                    disabled={isLoading || !prefillJobId.trim()}
                    data-testid="btn-prefill"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Hae"}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">tai</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleSkipPrefill}
                data-testid="btn-skip-prefill"
              >
                Jatka ilman ID:tä (uusi asiakas)
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {currentStep === 1 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Asiakkaan tiedot
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Anna iPad asiakkaalle täytettäväksi.
            </p>

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
                <Label htmlFor="customerAddress">Osoite / alue *</Label>
                <Input
                  id="customerAddress"
                  value={formData.customerAddress}
                  onChange={(e) => updateForm({ customerAddress: e.target.value })}
                  placeholder="Katuosoite tai alue"
                  className="mt-2"
                  data-testid="input-customer-address"
                />
              </div>

              <div>
                <Label htmlFor="customerLanguage">Kieli</Label>
                <Select
                  value={formData.customerLanguage}
                  onValueChange={(v) => updateForm({ customerLanguage: v as "fi" | "en" })}
                >
                  <SelectTrigger className="mt-2" data-testid="select-customer-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fi">Suomi</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="customerNotes">Lisätiedot (valinnainen)</Label>
                <Textarea
                  id="customerNotes"
                  value={formData.customerNotes}
                  onChange={(e) => updateForm({ customerNotes: e.target.value })}
                  placeholder="Muita huomioita..."
                  className="mt-2 min-h-20"
                  data-testid="input-customer-notes"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={goBack} data-testid="btn-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Takaisin
                </Button>
                <Button
                  className="flex-1"
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

        {currentStep === 2 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Kohteen arviointi
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Täytä henkilökunnan arvio kohteesta.
            </p>

            <div className="space-y-4">
              <div>
                <Label>Kiinteistötyyppi</Label>
                <Select
                  value={formData.propertyType}
                  onValueChange={(v) => updateForm({ propertyType: v })}
                >
                  <SelectTrigger className="mt-2" data-testid="select-property-type">
                    <SelectValue placeholder="Valitse..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apartment">Kerrostalo</SelectItem>
                    <SelectItem value="townhouse">Rivitalo</SelectItem>
                    <SelectItem value="house">Omakotitalo</SelectItem>
                    <SelectItem value="commercial">Liiketila</SelectItem>
                    <SelectItem value="other">Muu</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Kerroksia</Label>
                <Select
                  value={formData.floors}
                  onValueChange={(v) => updateForm({ floors: v })}
                >
                  <SelectTrigger className="mt-2" data-testid="select-floors">
                    <SelectValue placeholder="Valitse..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 kerros</SelectItem>
                    <SelectItem value="2">2 kerrosta</SelectItem>
                    <SelectItem value="3+">3+ kerrosta</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Ikkunoiden määrä (arvio)</Label>
                <Select
                  value={formData.windowCount}
                  onValueChange={(v) => updateForm({ windowCount: v })}
                >
                  <SelectTrigger className="mt-2" data-testid="select-window-count">
                    <SelectValue placeholder="Valitse..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Pieni (1-5 ikkunaa)</SelectItem>
                    <SelectItem value="medium">Keskikokoinen (6-12 ikkunaa)</SelectItem>
                    <SelectItem value="large">Suuri (13-20 ikkunaa)</SelectItem>
                    <SelectItem value="xlarge">Erittäin suuri (21+ ikkunaa)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="accessConstraints">Kulkurajoitukset</Label>
                <Input
                  id="accessConstraints"
                  value={formData.accessConstraints}
                  onChange={(e) => updateForm({ accessConstraints: e.target.value })}
                  placeholder="Esim. tikkaat tarvitaan, hankala pääsy..."
                  className="mt-2"
                  data-testid="input-access-constraints"
                />
              </div>

              <div>
                <Label htmlFor="weatherNotes">Sää/kausihuomiot</Label>
                <Input
                  id="weatherNotes"
                  value={formData.weatherNotes}
                  onChange={(e) => updateForm({ weatherNotes: e.target.value })}
                  placeholder="Esim. talvikausi, pakkasraja..."
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
                  placeholder="Tiimin sisäisiä huomioita..."
                  className="mt-2 min-h-20"
                  data-testid="input-internal-notes"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={goBack} data-testid="btn-back">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Takaisin
                </Button>
                <Button
                  className="flex-1"
                  onClick={goNext}
                  disabled={!formData.propertyType || !formData.floors || !formData.windowCount}
                  data-testid="btn-next"
                >
                  Seuraava
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {currentStep === 3 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Pakettiehdotus
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Valitse sopiva paketti asiakkaalle.
            </p>

            {packagesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-6">
                  {packages.map((pkg) => (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => selectPackage(pkg)}
                      className={cn(
                        "w-full p-4 rounded-xl border-2 text-left transition-all",
                        formData.selectedPackage === pkg.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/50"
                      )}
                      data-testid={`package-${pkg.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-foreground">{pkg.name}</span>
                        <span className="font-semibold text-foreground">{pkg.price} EUR</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{pkg.description}</p>
                    </button>
                  ))}
                </div>

                {formData.selectedPackage && (
                  <div className="space-y-4 border-t pt-6">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Perushinta</span>
                      <span className="font-medium">{formData.originalPrice} EUR</span>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="flex items-center gap-2">
                          <Percent className="w-4 h-4" />
                          Alennus
                        </Label>
                        <span className="font-medium">{formData.discountPercent}%</span>
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
                          placeholder="Esim. ensimmäinen tilaus, useita ikkunoita..."
                          className="mt-2"
                          data-testid="input-discount-reason"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-4 border-t">
                      <span className="text-lg font-semibold text-foreground">Lopullinen hinta</span>
                      <span className="text-2xl font-bold text-primary">{formData.finalPrice} EUR</span>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3 pt-6">
              <Button variant="outline" onClick={goBack} data-testid="btn-back">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Takaisin
              </Button>
              <Button
                className="flex-1"
                onClick={goNext}
                disabled={!formData.selectedPackage}
                data-testid="btn-next"
              >
                Seuraava
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        )}

        {currentStep === 4 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Sopimus
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Yhteenveto ja allekirjoitukset.
            </p>

            <div className="space-y-4 mb-6 p-4 bg-muted/50 rounded-xl">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Asiakas</span>
                <span className="font-medium">{formData.customerName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Osoite</span>
                <span className="font-medium">{formData.customerAddress}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paketti</span>
                <span className="font-medium">{formData.selectedPackageName}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-4">
                <span className="text-foreground font-semibold">Hinta</span>
                <span className="text-primary font-bold">{formData.finalPrice} EUR</span>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Asiakkaan allekirjoitus</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clearSignature(true)}
                    data-testid="btn-clear-customer-sig"
                  >
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clearSignature(false)}
                    data-testid="btn-clear-staff-sig"
                  >
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

        {currentStep === 5 && (
          <Card className="p-6 bg-card border-0 premium-shadow text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Valmis!
            </h2>
            <p className="text-muted-foreground mb-2">
              Keikka on tallennettu.
            </p>
            <p className="font-mono text-primary mb-6">
              {formData.jobId}
            </p>

            <div className="space-y-3">
              <Link href="/admin/jobs">
                <Button className="w-full" data-testid="btn-view-jobs">
                  Näytä keikat
                </Button>
              </Link>
              <Button
                variant="outline"
                className="w-full"
                onClick={resetWizard}
                data-testid="btn-new-job"
              >
                Luo uusi keikka
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
