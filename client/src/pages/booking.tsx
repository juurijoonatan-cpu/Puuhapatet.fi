import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Send, User, CheckCircle2 } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useI18n } from "@/lib/i18n";
import { postJson, warmBackend } from "@/lib/api";

// Validation messages follow the site language, so the schema is built per lang.
const makeSchema = (fi: boolean) => z.object({
  name:      z.string().min(2,  fi ? "Nimi on pakollinen" : "Name is required"),
  phone:     z.string().min(6,  fi ? "Puhelinnumero on pakollinen" : "Phone number is required"),
  email:     z.string().email(fi ? "Virheellinen sähköposti" : "Invalid email").or(z.literal("")),
  address:   z.string().min(2,  fi ? "Osoite tai alue on pakollinen" : "Address or area is required"),
  message:   z.string().min(5,  fi ? "Kerro lyhyesti mitä tarvitset" : "Briefly tell us what you need"),
  urgency:   z.enum(["this_week", "flexible"]).optional(),
});

type FormData = z.infer<ReturnType<typeof makeSchema>>;

export default function BookingPage() {
  const { t, lang } = useI18n();
  const schema = useMemo(() => makeSchema(lang === "fi"), [lang]);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [coupon, setCoupon] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("ref") || "";
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", email: "", address: "", message: "", urgency: undefined },
  });

  // Wake the (free-tier) backend on mount so it's awake by the time the
  // visitor presses send — avoids the cold-start delay on the actual submit.
  useEffect(() => {
    warmBackend();
  }, []);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError("");
    const res = await postJson("/api/contact", {
      name:    data.name,
      phone:   data.phone,
      email:   data.email || undefined,
      address: data.address,
      urgency: data.urgency,
      message: data.message,
      coupon:  coupon || undefined,
    });
    if (res.ok) {
      setSent(true);
    } else {
      setError(t("booking.error"));
    }
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28 flex items-center justify-center">
        <div className="text-center px-4 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-3">
            {t("success.title")}
          </h1>
          <p className="text-muted-foreground leading-relaxed mb-8">
            {t("booking.sent.desc")}
          </p>
          <Button variant="outline" onClick={() => { setSent(false); form.reset(); }}>
            {t("booking.sent.again")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-lg">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">
            {t("form.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("booking.subtitle")}
          </p>
        </div>

        <Card className="p-6 md:p-8 bg-card border-0 premium-shadow">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.name")} *</FormLabel>
                  <FormControl>
                    <Input placeholder="Matti Meikäläinen" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid md:grid-cols-2 gap-4">
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.phone")} *</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="040 123 4567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.email")}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="matti@esimerkki.fi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("booking.address")} *</FormLabel>
                  <FormControl>
                    <Input placeholder="Westend, Espoo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="urgency" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("booking.urgency")} <span className="text-muted-foreground font-normal">({t("booking.optional")})</span></FormLabel>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    {([
                      { value: "this_week", label: t("form.time.thisWeek") },
                      { value: "flexible",  label: t("booking.urgency.flexible") },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => field.onChange(field.value === opt.value ? undefined : opt.value)}
                        className={`py-2.5 px-4 rounded-xl border text-sm font-medium transition-all ${
                          field.value === opt.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </FormItem>
              )} />

              <FormField control={form.control} name="message" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.needs")} *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t("booking.msg.placeholder")}
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">
                  {t("booking.coupon")} <span className="font-normal">({t("booking.optional")})</span>
                </label>
                <Input
                  placeholder="esim. MATTI-X4Z"
                  value={coupon}
                  onChange={e => setCoupon(e.target.value.toUpperCase())}
                  className="font-mono tracking-wider"
                />
                {coupon && (
                  <p className="text-xs text-primary mt-1">{t("booking.coupon.added")}</p>
                )}
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <div className="pt-2 space-y-3">
                <Button type="submit" size="lg" className="w-full h-14 text-base font-semibold rounded-2xl" disabled={loading}>
                  {loading ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {t("form.submitting")}</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> {t("booking.send")}</>
                  )}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  {t("booking.orCall")}{" "}
                  <a href="tel:+358400389999" className="font-medium text-foreground hover:underline">
                    0400 389 999
                  </a>
                </p>
              </div>
            </form>
          </Form>
        </Card>
      </div>
    </div>
  );
}
