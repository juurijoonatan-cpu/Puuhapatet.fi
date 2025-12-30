import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Loader2, Package, User, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { StepIndicator } from "@/components/step-indicator";
import { PackageCardSkeleton } from "@/components/loading-skeleton";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { api, generateJobId, normalizePackage, type NormalizedPackage } from "@/lib/api";
import { bookingFormSchema, type BookingFormData, type InsertJob } from "@shared/schema";
import { cn } from "@/lib/utils";

const steps = [
  { id: 1, title: "Palvelu" },
  { id: 2, title: "Tiedot" },
  { id: 3, title: "Vahvistus" },
];

const preferredTimes = [
  { value: "morning", label: "Aamupäivä (8-12)" },
  { value: "afternoon", label: "Iltapäivä (12-16)" },
  { value: "evening", label: "Ilta (16-19)" },
  { value: "flexible", label: "Joustava" },
];

export default function BookingPage() {
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");
  const { toast } = useToast();

  const form = useForm<BookingFormData>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      CustomerName: "",
      CustomerPhone: "",
      CustomerEmail: "",
      Address: "",
      PreferredTime: "",
      ServicePackage: "",
      AdditionalServices: [],
      Notes: "",
    },
  });

  const packagesQuery = useQuery({
    queryKey: ["/api/packages"],
    queryFn: async (): Promise<NormalizedPackage[]> => {
      const result = await api.packages();
      if (!result.ok || !result.data?.ok) {
        throw new Error(result.error || "Failed to fetch packages");
      }
      return (result.data.packages || []).filter(p => p.Active !== false).map(normalizePackage);
    },
    retry: 2,
  });

  const submitMutation = useMutation({
    mutationFn: async (data: BookingFormData) => {
      const jobId = generateJobId();
      const now = new Date().toISOString();
      
      const job: InsertJob = {
        JobID: jobId,
        WorkflowStatus: "NEW",
        AssignedTo: "",
        Source: "WEBAPP",
        CustomerName: data.CustomerName,
        CustomerPhone: data.CustomerPhone,
        CustomerEmail: data.CustomerEmail || "",
        Address: data.Address,
        PreferredTime: data.PreferredTime,
        ServicePackage: data.ServicePackage,
        AdditionalServices: data.AdditionalServices || [],
        Notes: data.Notes || "",
      };

      const result = await api.upsertJob(job);
      
      return {
        jobId,
        response: result,
        job,
      };
    },
    onSuccess: (data) => {
      sessionStorage.setItem("lastBooking", JSON.stringify({
        jobId: data.jobId,
        response: data.response,
        job: data.job,
        timestamp: new Date().toISOString(),
      }));
      navigate("/kiitos");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Virhe lähetyksessä",
        description: error instanceof Error ? error.message : "Yritä uudelleen",
      });
    },
  });

  const handlePackageSelect = (packageId: string, packageName: string) => {
    setSelectedPackageId(packageId);
    form.setValue("ServicePackage", packageName);
  };

  const nextStep = () => {
    if (currentStep === 1) {
      if (!selectedPackageId) {
        toast({
          variant: "destructive",
          title: "Valitse palvelu",
          description: "Valitse haluamasi palvelupaketti jatkaaksesi.",
        });
        return;
      }
    }
    setCurrentStep((prev) => Math.min(prev + 1, 3));
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const onSubmit = (data: BookingFormData) => {
    submitMutation.mutate(data);
  };

  const selectedPackage = packagesQuery.data?.find((p) => p.id === selectedPackageId);

  return (
    <div className="min-h-screen bg-background pt-6 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2 text-center">
            Tee tilaus
          </h1>
          <p className="text-muted-foreground text-center mb-6">
            Täytä tiedot ja lähetä tilauksesi
          </p>
          
          <StepIndicator steps={steps} currentStep={currentStep} />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Package className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Valitse palvelu</h2>
                    <p className="text-sm text-muted-foreground">Valitse tarvitsemasi palvelupaketti</p>
                  </div>
                </div>

                {packagesQuery.isLoading ? (
                  <div className="grid gap-4">
                    <PackageCardSkeleton />
                    <PackageCardSkeleton />
                    <PackageCardSkeleton />
                  </div>
                ) : packagesQuery.isError ? (
                  <EmptyState
                    icon={Package}
                    title="Pakettien lataus epäonnistui"
                    description="Emme pystyneet lataamaan palvelupaketteja. Yritä uudelleen."
                    actionLabel="Yritä uudelleen"
                    onAction={() => packagesQuery.refetch()}
                  />
                ) : packagesQuery.data?.length === 0 ? (
                  <EmptyState
                    icon={Package}
                    title="Ei palvelupaketteja"
                    description="Palvelupaketteja ei ole tällä hetkellä saatavilla."
                  />
                ) : (
                  <div className="grid gap-4">
                    {packagesQuery.data?.map((pkg) => (
                      <Card
                        key={pkg.id}
                        className={cn(
                          "p-5 cursor-pointer transition-all duration-200 border-2",
                          selectedPackageId === pkg.id
                            ? "border-primary bg-primary/5 premium-shadow-hover"
                            : "border-transparent bg-card premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5"
                        )}
                        onClick={() => handlePackageSelect(pkg.id, pkg.name)}
                        data-testid={`package-card-${pkg.id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-foreground mb-1">
                              {pkg.name}
                            </h3>
                            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                              {pkg.description}
                            </p>
                            <div className="flex items-center gap-4 text-sm">
                              <span className="text-muted-foreground">
                                {pkg.durationMinutes} min
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-semibold text-primary">
                              {pkg.price} €
                            </div>
                            {selectedPackageId === pkg.id && (
                              <div className="mt-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                                <Check className="w-4 h-4 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-4">
                  <Button 
                    type="button" 
                    onClick={nextStep}
                    disabled={!selectedPackageId}
                    data-testid="step1-next"
                  >
                    Jatka
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Yhteystiedot</h2>
                    <p className="text-sm text-muted-foreground">Täytä yhteystietosi</p>
                  </div>
                </div>

                <Card className="p-6 bg-card border-0 premium-shadow">
                  <div className="space-y-5">
                    <FormField
                      control={form.control}
                      name="CustomerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nimi *</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Etunimi Sukunimi" 
                              {...field} 
                              data-testid="input-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="CustomerPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Puhelinnumero *</FormLabel>
                          <FormControl>
                            <Input 
                              type="tel"
                              placeholder="040 123 4567" 
                              {...field} 
                              data-testid="input-phone"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="CustomerEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sähköposti</FormLabel>
                          <FormControl>
                            <Input 
                              type="email"
                              placeholder="nimi@esimerkki.fi" 
                              {...field} 
                              data-testid="input-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="Address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Osoite *</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Katuosoite, Postinumero Kaupunki" 
                              {...field} 
                              data-testid="input-address"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="PreferredTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Toivottu ajankohta *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-time">
                                <SelectValue placeholder="Valitse ajankohta" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {preferredTimes.map((time) => (
                                <SelectItem key={time.value} value={time.value}>
                                  {time.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="Notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lisätiedot</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Kerro lisätietoja työstä tai erityistoiveista..."
                              className="min-h-[100px] resize-none"
                              {...field} 
                              data-testid="input-notes"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </Card>

                <div className="flex justify-between pt-4">
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={prevStep}
                    data-testid="step2-back"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Takaisin
                  </Button>
                  <Button 
                    type="button" 
                    onClick={nextStep}
                    data-testid="step2-next"
                  >
                    Jatka
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Send className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Vahvista tilaus</h2>
                    <p className="text-sm text-muted-foreground">Tarkista tiedot ja lähetä tilaus</p>
                  </div>
                </div>

                <Card className="p-6 bg-card border-0 premium-shadow">
                  <h3 className="text-base font-semibold text-foreground mb-4">Valittu palvelu</h3>
                  {selectedPackage && (
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl mb-6">
                      <div>
                        <p className="font-medium text-foreground">{selectedPackage.name}</p>
                        <p className="text-sm text-muted-foreground">{selectedPackage.durationMinutes} min</p>
                      </div>
                      <p className="text-xl font-semibold text-primary">{selectedPackage.price} €</p>
                    </div>
                  )}

                  <h3 className="text-base font-semibold text-foreground mb-4">Yhteystiedot</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Nimi</span>
                      <span className="text-foreground font-medium">{form.watch("CustomerName") || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Puhelin</span>
                      <span className="text-foreground font-medium">{form.watch("CustomerPhone") || "-"}</span>
                    </div>
                    {form.watch("CustomerEmail") && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sähköposti</span>
                        <span className="text-foreground font-medium">{form.watch("CustomerEmail")}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Osoite</span>
                      <span className="text-foreground font-medium text-right max-w-[200px]">
                        {form.watch("Address") || "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Toivottu aika</span>
                      <span className="text-foreground font-medium">
                        {preferredTimes.find(t => t.value === form.watch("PreferredTime"))?.label || "-"}
                      </span>
                    </div>
                    {form.watch("Notes") && (
                      <div className="pt-2 border-t border-border">
                        <span className="text-muted-foreground block mb-1">Lisätiedot</span>
                        <span className="text-foreground">{form.watch("Notes")}</span>
                      </div>
                    )}
                  </div>
                </Card>

                <div className="flex justify-between pt-4">
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={prevStep}
                    disabled={submitMutation.isPending}
                    data-testid="step3-back"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Takaisin
                  </Button>
                  <Button 
                    type="submit"
                    disabled={submitMutation.isPending}
                    data-testid="submit-booking"
                  >
                    {submitMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Lähetetään...
                      </>
                    ) : (
                      <>
                        Lähetä tilaus
                        <Send className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Form>
      </div>
    </div>
  );
}
