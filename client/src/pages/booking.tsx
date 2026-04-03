import { useState } from "react";
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

const schema = z.object({
  name:    z.string().min(2,  "Nimi on pakollinen"),
  phone:   z.string().min(6,  "Puhelinnumero on pakollinen"),
  email:   z.string().email("Virheellinen sähköposti").or(z.literal("")),
  address: z.string().min(2,  "Osoite tai alue on pakollinen"),
  message: z.string().min(5,  "Kerro lyhyesti mitä tarvitset"),
});

type FormData = z.infer<typeof schema>;

export default function BookingPage() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", email: "", address: "", message: "" },
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("https://formsubmit.co/ajax/info@puuhapatet.fi", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          Nimi:        data.name,
          Puhelin:     data.phone,
          Sähköposti:  data.email || "—",
          Alue:        data.address,
          Viesti:      data.message,
          _subject:    `Uusi yhteydenotto: ${data.name}`,
          _template:   "table",
          _captcha:    "false",
        }),
      });
      if (!res.ok) throw new Error("Lähetys epäonnistui");
      setSent(true);
    } catch {
      setError("Jotain meni pieleen. Soita suoraan: 0400 389 999");
    } finally {
      setLoading(false);
    }
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
            Olemme sinuun yhteydessä pian. Tyypillisesti saman päivän aikana.
          </p>
          <Button variant="outline" onClick={() => { setSent(false); form.reset(); }}>
            Tee uusi pyyntö
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
            Täytä tiedot — otamme yhteyttä pian.
          </p>
        </div>

        <Card className="p-6 md:p-8 bg-card border-0 premium-shadow">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nimi *</FormLabel>
                  <FormControl>
                    <Input placeholder="Matti Meikäläinen" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid md:grid-cols-2 gap-4">
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Puhelinnumero *</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="040 123 4567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sähköposti</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="matti@esimerkki.fi" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Alue tai osoite *</FormLabel>
                  <FormControl>
                    <Input placeholder="Westend, Espoo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="message" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mitä tarvitset? *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Kerro vapaasti mitä palvelua tarvitset, milloin sopisi ja mahdolliset lisätiedot..."
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Lähetetään...</>
                ) : (
                  <><Send className="w-5 h-5 mr-2" /> {t("form.submit")}</>
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Tai soita suoraan:{" "}
                <a href="tel:+358400389999" className="font-medium text-foreground hover:underline">
                  0400 389 999
                </a>
              </p>
            </form>
          </Form>
        </Card>
      </div>
    </div>
  );
}
