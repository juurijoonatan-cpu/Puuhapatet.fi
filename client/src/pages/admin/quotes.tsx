import { useState, useEffect } from "react";
import {
  ArrowLeft, Plus, Trash2, Send, Check, Loader2, FileText,
} from "lucide-react";
import { useLocation } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

// ── Quote ID ──────────────────────────────────────────────────────────────────

function generateQuoteId(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `T-PP-${ts}-${rand}`;
}

// ── Quick-add services ────────────────────────────────────────────────────────

const QUICK_SERVICES = [
  { label: "Ikkunanpesu (sisä + ulko)",    price: 149 },
  { label: "Ikkunanpesu (ulkoa)",           price: 89  },
  { label: "Nurmikon leikkuu",              price: 39  },
  { label: "Pihapalvelut (kertakäynti)",    price: 79  },
  { label: "Auton sisäfreesaus",            price: 40  },
  { label: "Parveke-/terassilasitus",       price: 39  },
  { label: "Terassin lasikate",             price: 89  },
  { label: "Rännien puhdistus",             price: 69  },
  { label: "Lasikaide",                     price: 39  },
  { label: "Peilien pesu",                  price: 19  },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuoteItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number; // euros
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyItem(): QuoteItem {
  return { id: uid(), description: "", qty: 1, unitPrice: 0 };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminQuotesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Read customerId from URL query (?customerId=123)
  const params     = new URLSearchParams(window.location.search);
  const customerId = params.get("customerId");

  const [quoteId] = useState<string>(generateQuoteId);
  const [lang, setLang]       = useState<"fi" | "en">("fi");
  const [vatMode, setVatMode] = useState<"incl" | "excl">("incl");

  // Customer info
  const [customerName,    setCustomerName]    = useState("");
  const [customerEmail,   setCustomerEmail]   = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [loadingCustomer, setLoadingCustomer] = useState(false);

  // Quote settings
  const [validDays,      setValidDays]      = useState(14);
  const [customMessage,  setCustomMessage]  = useState("");

  // Line items
  const [items, setItems] = useState<QuoteItem[]>([emptyItem()]);

  // Send state
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);

  // ── Load customer if navigated from customers page ─────────────────────────
  useEffect(() => {
    if (!customerId) return;
    setLoadingCustomer(true);
    api.getCustomer(Number(customerId)).then((res) => {
      if (res.ok && res.data) {
        const c = res.data as { name: string; email: string | null; phone: string; address: string };
        setCustomerName(c.name    ?? "");
        setCustomerEmail(c.email  ?? "");
        setCustomerPhone(c.phone  ?? "");
        setCustomerAddress(c.address ?? "");
      }
      setLoadingCustomer(false);
    });
  }, [customerId]);

  // ── Line item helpers ──────────────────────────────────────────────────────

  const addItem = () => setItems(prev => [...prev, emptyItem()]);

  const removeItem = (id: string) =>
    setItems(prev => prev.filter(i => i.id !== id));

  const updateItem = (id: string, field: keyof Omit<QuoteItem, "id">, value: string | number) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));

  const addQuickService = (svc: { label: string; price: number }) => {
    const emptyIdx = items.findIndex(i => !i.description.trim() && i.unitPrice === 0);
    if (emptyIdx >= 0) {
      setItems(prev => prev.map((it, idx) =>
        idx === emptyIdx ? { ...it, description: svc.label, unitPrice: svc.price } : it
      ));
    } else {
      setItems(prev => [...prev, { id: uid(), description: svc.label, qty: 1, unitPrice: svc.price }]);
    }
  };

  // ── Price calculations ─────────────────────────────────────────────────────

  const subtotal  = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  const vatAmount = vatMode === "excl" ? Math.round(subtotal * 0.24 * 100) / 100 : 0;
  const total     = subtotal + vatAmount;
  const kotitalous = Math.round(total * 0.65);

  const validUntilDate = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)
    .toLocaleDateString("fi-FI");

  // ── Send quote ─────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!customerEmail.trim()) {
      toast({ variant: "destructive", title: "Puuttuva sähköposti", description: "Syötä asiakkaan sähköpostiosoite." });
      return;
    }
    const validItems = items.filter(i => i.description.trim());
    if (validItems.length === 0) {
      toast({ variant: "destructive", title: "Tarjous on tyhjä", description: "Lisää vähintään yksi palvelu." });
      return;
    }

    setSending(true);
    const profile = getAdminProfile();

    const res = await api.sendQuote({
      to:              customerEmail.trim(),
      bcc:             profile?.email,
      quoteId,
      customerName:    customerName.trim() || "Asiakas",
      customerAddress: customerAddress.trim() || undefined,
      items:           validItems.map(i => ({
        description: i.description.trim(),
        qty:         i.qty,
        unitPrice:   i.unitPrice,
      })),
      subtotal,
      vatAmount,
      total,
      vatMode,
      validDays,
      customMessage: customMessage.trim() || undefined,
      workerName:    profile?.name,
      workerPhone:   profile?.phone,
      workerEmail:   profile?.email,
      lang,
    });

    setSending(false);

    if (res.ok) {
      setSent(true);
      toast({ title: "Tarjous lähetetty!", description: `Lähetetty: ${customerEmail.trim()}` });
    } else {
      toast({ variant: "destructive", title: "Lähetys epäonnistui", description: res.error });
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────

  if (sent) {
    return (
      <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28 flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-5">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Tarjous lähetetty!</h2>
          <p className="text-muted-foreground text-sm mb-1">
            <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{quoteId}</span>
          </p>
          <p className="text-muted-foreground text-sm mb-7">
            Toimitettu osoitteeseen {customerEmail}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              className="gap-2"
              onClick={() => {
                setSent(false);
                setItems([emptyItem()]);
                setCustomMessage("");
              }}
            >
              <FileText className="w-4 h-4" />
              Luo uusi tarjous
            </Button>
            <Button variant="outline" onClick={() => navigate("/admin/customers")}>
              Takaisin asiakkaisiin
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Editor view ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">

        {/* Page header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold">Uusi tarjous</h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{quoteId}</p>
          </div>
          {/* Language toggle */}
          <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
            <button
              onClick={() => setLang("fi")}
              className={cn(
                "px-3.5 py-1.5 text-sm font-semibold transition-colors",
                lang === "fi" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              )}
            >
              FI
            </button>
            <button
              onClick={() => setLang("en")}
              className={cn(
                "px-3.5 py-1.5 text-sm font-semibold transition-colors",
                lang === "en" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              )}
            >
              EN
            </button>
          </div>
        </div>

        {/* ── Asiakas ───────────────────────────────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
            Asiakas
          </h2>
          {loadingCustomer ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Nimi *</p>
                <Input
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Etunimi Sukunimi"
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Sähköposti *</p>
                <Input
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  type="email"
                  placeholder="email@esimerkki.fi"
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Puhelin</p>
                <Input
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  type="tel"
                  placeholder="+358 40 000 0000"
                  className="text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Osoite</p>
                <Input
                  value={customerAddress}
                  onChange={e => setCustomerAddress(e.target.value)}
                  placeholder="Kadunnimi 1, 02100 Espoo"
                  className="text-sm"
                />
              </div>
            </div>
          )}
        </Card>

        {/* ── Tarjouksen asetukset ──────────────────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
            Tarjouksen asetukset
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Voimassaoloaika (päiviä)</p>
              <Input
                type="number"
                value={validDays}
                min={1}
                max={90}
                onChange={e => setValidDays(Math.max(1, Number(e.target.value)))}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Vanhenee: <strong>{validUntilDate}</strong>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Arvonlisävero</p>
              <div className="flex rounded-lg overflow-hidden border border-border">
                <button
                  onClick={() => setVatMode("incl")}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                    vatMode === "incl" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  ALV 24% sis.
                </button>
                <button
                  onClick={() => setVatMode("excl")}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                    vatMode === "excl" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  + ALV 24%
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Palvelut (line items) ─────────────────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
            Palvelut
          </h2>

          {/* Quick-add chips */}
          <div className="mb-5">
            <p className="text-xs text-muted-foreground mb-2">Pikalisäys</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SERVICES.map(svc => (
                <button
                  key={svc.label}
                  onClick={() => addQuickService(svc)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted hover:bg-muted/60 transition-colors border border-border"
                >
                  + {svc.label} ({svc.price} €)
                </button>
              ))}
            </div>
          </div>

          {/* Items */}
          <div className="space-y-3 mb-4">
            {items.map((item, idx) => (
              <div key={item.id} className="grid grid-cols-[1fr_60px_76px_36px] gap-2 items-end">
                <div>
                  {idx === 0 && (
                    <p className="text-xs text-muted-foreground mb-1">Kuvaus</p>
                  )}
                  <Input
                    value={item.description}
                    onChange={e => updateItem(item.id, "description", e.target.value)}
                    placeholder="Palvelun kuvaus…"
                    className="text-sm"
                  />
                </div>
                <div>
                  {idx === 0 && (
                    <p className="text-xs text-muted-foreground mb-1">Kpl</p>
                  )}
                  <Input
                    type="number"
                    value={item.qty}
                    min={1}
                    onChange={e => updateItem(item.id, "qty", Math.max(1, Number(e.target.value)))}
                    className="text-sm text-center"
                  />
                </div>
                <div>
                  {idx === 0 && (
                    <p className="text-xs text-muted-foreground mb-1">€ / kpl</p>
                  )}
                  <Input
                    type="number"
                    value={item.unitPrice || ""}
                    min={0}
                    step={1}
                    onChange={e => updateItem(item.id, "unitPrice", Number(e.target.value))}
                    placeholder="0"
                    className="text-sm text-right"
                  />
                </div>
                <div className={idx === 0 ? "pt-[22px]" : ""}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => items.length > 1 ? removeItem(item.id) : undefined}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" className="gap-2 mb-4" onClick={addItem}>
            <Plus className="w-4 h-4" />
            Lisää rivi
          </Button>

          {/* Totals summary */}
          {subtotal > 0 && (
            <div className="border-t pt-4 space-y-1.5 text-sm">
              {vatMode === "excl" && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Veroton hinta</span>
                    <span>{subtotal.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>ALV 24%</span>
                    <span>{vatAmount.toFixed(2)} €</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-base pt-1">
                <span>
                  Yhteensä
                  {vatMode === "incl" && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">(ALV 24% sis.)</span>
                  )}
                </span>
                <span>{total.toFixed(2)} €</span>
              </div>
              {vatMode === "incl" && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Kotitalousvähennyksen jälkeen ~{kotitalous} €
                </p>
              )}
            </div>
          )}
        </Card>

        {/* ── Viesti asiakkaalle ────────────────────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">
            Viesti asiakkaalle
            <span className="ml-2 font-normal normal-case text-xs">(valinnainen)</span>
          </h2>
          <Textarea
            value={customMessage}
            onChange={e => setCustomMessage(e.target.value)}
            placeholder={
              lang === "fi"
                ? "Hei! Oheisessa tarjouksessa on sovitut palvelut. Vastaamme mielellämme lisäkysymyksiin."
                : "Hi! Please find our quote for the requested services. Feel free to reach out with any questions."
            }
            rows={4}
            className="text-sm resize-none"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Jätetty tyhjäksi → automaattinen tervehdys {lang === "fi" ? "suomeksi" : "englanniksi"}.
          </p>
        </Card>

        {/* ── Send ─────────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <Button
            className="w-full h-12 text-base font-semibold gap-2"
            onClick={handleSend}
            disabled={sending || !customerEmail.trim()}
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
            {sending ? "Lähetetään…" : "Lähetä tarjous sähköpostilla"}
          </Button>
          {!customerEmail.trim() && (
            <p className="text-xs text-muted-foreground text-center">
              Täytä asiakkaan sähköpostiosoite lähettääksesi tarjouksen.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
