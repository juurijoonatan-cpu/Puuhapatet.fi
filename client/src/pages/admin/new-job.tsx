/**
 * New Job Wizard - "Uusi Keikka"
 * 
 * The heart of the admin tool for door-to-door sales.
 * 
 * Steps:
 * 0. Optional prefill by Lead-ID / JobID
 * 1. Customer info (customer fills on iPad)
 * 2. Employer assessment (staff fills after handback)
 * 3. Package proposal (guided/AI-assisted)
 * 4. Agreement/contract with signatures
 * 5. Completion (after work done)
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Search, User, ClipboardCheck, Package, FileText, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api, generateJobId } from "@/lib/api";
import { cn } from "@/lib/utils";

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

interface JobFormData {
  jobId: string;
  customerName: string;
  customerPhone: string;
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
  originalPrice: number;
  finalPrice: number;
  discountPercent: number;
  discountReason: string;
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
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [prefillJobId, setPrefillJobId] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState<JobFormData>({
    jobId: "",
    customerName: "",
    customerPhone: "",
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
    originalPrice: 0,
    finalPrice: 0,
    discountPercent: 0,
    discountReason: "",
  });

  const updateForm = (updates: Partial<JobFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
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

  const goNext = () => {
    if (currentStep < 5) {
      setCurrentStep((prev) => (prev + 1) as WizardStep);
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => (prev - 1) as WizardStep);
    }
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
                    {isLoading ? "..." : "Hae"}
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

            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Pakettivalinta tulossa...</p>
              <p className="text-sm">Tämä osio rakennetaan Phase B:ssä.</p>
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
          </Card>
        )}

        {currentStep === 4 && (
          <Card className="p-6 bg-card border-0 premium-shadow">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Sopimus
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Allekirjoitukset ja vahvistus.
            </p>

            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Sopimus ja allekirjoitukset tulossa...</p>
              <p className="text-sm">Tämä osio rakennetaan Phase B:ssä.</p>
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
            <p className="text-muted-foreground mb-6">
              Keikka on luotu. Voit nyt siirtyä töihin tai aikatauluttaa käynnin.
            </p>

            <div className="space-y-3">
              <Link href="/admin/jobs">
                <Button className="w-full" data-testid="btn-view-jobs">
                  Näytä keikat
                </Button>
              </Link>
              <Link href="/admin/new">
                <Button variant="outline" className="w-full" data-testid="btn-new-job">
                  Luo uusi keikka
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
