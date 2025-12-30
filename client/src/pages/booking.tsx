import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, User, Check } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { api, generateJobId } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { type InsertJob } from "@shared/schema";

const contactFormSchema = z.object({
  name: z.string().min(2, "Nimi on pakollinen"),
  phone: z.string().min(6, "Puhelin on pakollinen"),
  email: z.string().email("Virheellinen sähköposti").or(z.literal("")),
  address: z.string().min(2, "Osoite tai alue on pakollinen"),
  estimate: z.string().optional(),
  needs: z.array(z.string()).min(1, "Valitse vähintään yksi tarve"),
  timePreference: z.string().min(1, "Valitse aikatoive"),
  notes: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

const needsOptions = [
  { id: "inside", labelKey: "form.needs.inside" },
  { id: "outside", labelKey: "form.needs.outside" },
  { id: "balcony", labelKey: "form.needs.balcony" },
  { id: "glass", labelKey: "form.needs.glass" },
  { id: "talvikiilto", labelKey: "form.needs.talvikiilto" },
  { id: "special", labelKey: "form.needs.special" },
];

const estimateOptions = [
  { value: "none", labelKey: "form.estimate.none" },
  { value: "single", labelKey: "form.estimate.single" },
  { value: "recurring", labelKey: "form.estimate.recurring" },
  { value: "talvikiilto", labelKey: "form.estimate.talvikiilto" },
  { value: "kiilto", labelKey: "form.estimate.kiilto" },
];

const timeOptions = [
  { value: "asap", labelKey: "form.time.asap" },
  { value: "thisWeek", labelKey: "form.time.thisWeek" },
  { value: "nextWeek", labelKey: "form.time.nextWeek" },
  { value: "later", labelKey: "form.time.later" },
];

export default function BookingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      estimate: "none",
      needs: [],
      timePreference: "",
      notes: "",
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: ContactFormData) => {
      const jobId = generateJobId();
      
      const job: InsertJob = {
        JobID: jobId,
        WorkflowStatus: "NEW",
        AssignedTo: "",
        Source: "WEBAPP",
        CustomerName: data.name,
        CustomerPhone: data.phone,
        CustomerEmail: data.email || "",
        Address: data.address,
        PreferredTime: data.timePreference,
        ServicePackage: data.estimate || "",
        AdditionalServices: data.needs,
        Notes: data.notes || "",
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

  const onSubmit = (data: ContactFormData) => {
    submitMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">
            {t("form.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("form.subtitle")}
          </p>
        </div>

        <Card className="p-6 md:p-8 bg-card border-0 premium-shadow">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.name")} *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Matti Meikäläinen" 
                        {...field} 
                        data-testid="input-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.phone")} *</FormLabel>
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.email")}</FormLabel>
                      <FormControl>
                        <Input 
                          type="email" 
                          placeholder="matti@esimerkki.fi" 
                          {...field} 
                          data-testid="input-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.address")} *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Westend, 02160" 
                        {...field} 
                        data-testid="input-address"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      {t("form.addressHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="needs"
                render={() => (
                  <FormItem>
                    <FormLabel>{t("form.needs")} *</FormLabel>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      {needsOptions.map((option) => (
                        <FormField
                          key={option.id}
                          control={form.control}
                          name="needs"
                          render={({ field }) => (
                            <FormItem className="flex items-center space-x-2 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(option.id)}
                                  onCheckedChange={(checked) => {
                                    const current = field.value || [];
                                    if (checked) {
                                      field.onChange([...current, option.id]);
                                    } else {
                                      field.onChange(current.filter((v) => v !== option.id));
                                    }
                                  }}
                                  data-testid={`checkbox-${option.id}`}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal cursor-pointer">
                                {t(option.labelKey)}
                              </FormLabel>
                            </FormItem>
                          )}
                        />
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="estimate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.estimate")}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-estimate">
                          <SelectValue placeholder={t("form.estimate.none")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {estimateOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      {t("form.estimateHint")}
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timePreference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.time")} *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-time">
                          <SelectValue placeholder="Valitse aikatoive" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {timeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {t(option.labelKey)}
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
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.notes")}</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Lisätietoja kohteesta tai toiveista..." 
                        className="resize-none"
                        rows={3}
                        {...field} 
                        data-testid="input-notes"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <Button 
                type="submit" 
                size="lg" 
                className="w-full"
                disabled={submitMutation.isPending}
                data-testid="submit-form"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    {t("form.submitting")}
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    {t("form.submit")}
                  </>
                )}
              </Button>
            </form>
          </Form>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6 italic">
          {t("hero.tagline")}
        </p>
      </div>
    </div>
  );
}
