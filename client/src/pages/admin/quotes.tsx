import { useState, useEffect } from "react";
import {
  ArrowLeft, Plus, Trash2, Send, Check, Loader2,
  ChevronDown, ChevronUp, Home, Leaf, Wrench, X, Monitor,
} from "lucide-react";
import { QuotePresentation } from "@/components/quote-presentation";
import { useLocation } from "wouter";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { getAdminProfile, USERS } from "@/lib/admin-profile";
import { cn } from "@/lib/utils";

// ── Pricing constants (same as laskuri.tsx) ────────────────────────────────────

const HOUSE_TYPES = [
  { key: "omakoti",    label: "Omakotitalo",  sub: "Erillistalo"   },
  { key: "paritalo",   label: "Paritalo",     sub: "2 huoneistoa"  },
  { key: "rivitalo",   label: "Rivitalo",     sub: "Oma huoneisto" },
  { key: "kerrostalo", label: "Kerrostalo",   sub: "Huoneisto"     },
] as const;
type HouseKey = (typeof HOUSE_TYPES)[number]["key"];

const SQM_RANGES: Record<HouseKey, { label: string; price: number }[]> = {
  omakoti: [
    { label: "alle 60 m²",  price: 139 }, { label: "60–80 m²",   price: 169 },
    { label: "80–100 m²",   price: 199 }, { label: "100–120 m²", price: 229 },
    { label: "120–140 m²",  price: 269 }, { label: "140–160 m²", price: 309 },
    { label: "160–180 m²",  price: 349 }, { label: "180–200 m²", price: 389 },
    { label: "200–220 m²",  price: 439 }, { label: "220–240 m²", price: 489 },
    { label: "240–260 m²",  price: 549 }, { label: "260–280 m²", price: 609 },
    { label: "yli 280 m²",  price: 669 },
  ],
  paritalo: [
    { label: "alle 60 m²",  price: 139 }, { label: "60–80 m²",   price: 169 },
    { label: "80–100 m²",   price: 199 }, { label: "100–120 m²", price: 229 },
    { label: "120–140 m²",  price: 269 }, { label: "140–160 m²", price: 309 },
    { label: "160–180 m²",  price: 349 }, { label: "180–200 m²", price: 389 },
    { label: "200–220 m²",  price: 439 }, { label: "220–240 m²", price: 489 },
    { label: "240–260 m²",  price: 549 }, { label: "260–280 m²", price: 609 },
    { label: "yli 280 m²",  price: 669 },
  ],
  rivitalo: [
    { label: "alle 40 m²",  price:  89 }, { label: "40–60 m²",   price: 109 },
    { label: "60–80 m²",    price: 129 }, { label: "80–100 m²",  price: 149 },
    { label: "100–120 m²",  price: 169 }, { label: "120–140 m²", price: 199 },
    { label: "140–160 m²",  price: 229 }, { label: "yli 160 m²", price: 279 },
  ],
  kerrostalo: [
    { label: "alle 40 m²",  price:  99 }, { label: "40–60 m²",   price: 119 },
    { label: "60–80 m²",    price: 149 }, { label: "80–100 m²",  price: 179 },
    { label: "100–120 m²",  price: 209 }, { label: "120–140 m²", price: 249 },
    { label: "yli 140 m²",  price: 329 },
  ],
};

const SERVICE_TIERS = [
  { key: "all",     label: "Sisä + ulko",          sub: "Kaikkien pintojen pesu",  mult: 1.00 },
  { key: "outside", label: "Vain ulkopinnat",       sub: "Nopea ja edullinen",      mult: 0.58 },
  { key: "annual",  label: "Vuosipaketti (2×/v)",   sub: "Säästät n. 10 %",         mult: 1.80 },
] as const;
type TierKey = (typeof SERVICE_TIERS)[number]["key"];

const IKK_ADDONS = [
  { key: "balcony", label: "Parveke-/terassilasit",  price: 39 },
  { key: "railing", label: "Lasikaide",               price: 39 },
  { key: "mirror",  label: "Peilien pesu",            price: 19 },
  { key: "canopy",  label: "Terassin lasikate",       price: 89 },
  { key: "gutter",  label: "Rännien puhdistus",       price: 69 },
] as const;
type AddonKey = (typeof IKK_ADDONS)[number]["key"];

const LAWN_SIZES = [
  { label: "alle 50 m²",  price: 29 }, { label: "50–100 m²",  price: 39 },
  { label: "100–150 m²",  price: 49 }, { label: "150–200 m²", price: 59 },
  { label: "200–300 m²",  price: 69 }, { label: "300–500 m²", price: 89 },
  { label: "yli 500 m²",  price: 119 },
] as const;

const VISIT_PLANS = [
  { visits: 1,  label: "1 käynti",   disc: 0,    desc: "Kertaluontoinen"       },
  { visits: 4,  label: "4 käyntiä",  disc: 0.05, desc: "Noin kuukausittain"    },
  { visits: 8,  label: "8 käyntiä",  disc: 0.10, desc: "Joka toinen viikko"    },
  { visits: 12, label: "12 käyntiä", disc: 0.15, desc: "Kausisuositus ⭐"      },
  { visits: 16, label: "16 käyntiä", disc: 0.18, desc: "Viikoittain"           },
  { visits: 20, label: "20 käyntiä", disc: 0.20, desc: "Täyskausi — paras hinta" },
] as const;

// ── Quote ID ──────────────────────────────────────────────────────────────────

function generateQuoteId(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `T-PP-${ts}-${rand}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceItem {
  id: string;
  type: "ikkuna" | "nurmikko" | "muu";
  title: string;
  detail: string;
  price: number;     // euros — user-editable
}

type ConfigMode = "ikkuna" | "nurmikko" | "muu" | null;

interface IkkunaMultipliers {
  height: number;
  access: number;
  dirt: number;
  windowType: number;
}

function uid(): string { return Math.random().toString(36).slice(2, 10); }

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminQuotesPage() {
  const { toast }    = useToast();
  const [, navigate] = useLocation();

  const params      = new URLSearchParams(window.location.search);
  const customerId  = params.get("customerId");

  const [quoteId]    = useState<string>(generateQuoteId);
  const [quoteToken] = useState<string>(() => Math.random().toString(36).slice(2, 12));
  const [lang, setLang] = useState<"fi" | "en">("fi");

  // Customer
  const [customerName,    setCustomerName]    = useState("");
  const [customerEmail,   setCustomerEmail]   = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [loadingCustomer, setLoadingCustomer] = useState(false);

  // Quote settings
  const [validDays,     setValidDays]     = useState(14);
  const [customMessage, setCustomMessage] = useState("");
  const [quoteVideoUrl, setQuoteVideoUrl] = useState("");

  // BCC to other worker
  const profile     = getAdminProfile();
  const otherWorker = USERS.find(u => u.id !== profile?.id);
  const [bccOther, setBccOther] = useState(false);

  // Added service items
  const [serviceItems, setServiceItems] = useState<ServiceItem[]>([]);
  const [editingPrices, setEditingPrices] = useState<Record<string, string>>({});

  // Active configurator
  const [configMode, setConfigMode] = useState<ConfigMode>(null);

  // ── Ikkunanpesu configurator state ────────────────────────────────────────
  const [iHouse,  setIHouse]  = useState<HouseKey | "">("");
  const [iSqmIdx, setISqmIdx] = useState<number | null>(null);
  const [iTier,   setITier]   = useState<TierKey>("all");
  const [iAddons, setIAddons] = useState<Set<AddonKey>>(new Set());
  const [iMult,   setIMult]   = useState<IkkunaMultipliers>({ height: 1, access: 1, dirt: 1, windowType: 1 });

  const iBase         = iHouse && iSqmIdx !== null ? SQM_RANGES[iHouse][iSqmIdx].price : 0;
  const iTierMult     = SERVICE_TIERS.find(t => t.key === iTier)?.mult ?? 1;
  const iAddonSum     = Array.from(iAddons).reduce((s, k) => s + (IKK_ADDONS.find(a => a.key === k)?.price ?? 0), 0);
  const iCombinedMult = iMult.height * iMult.access * iMult.dirt * iMult.windowType;
  const iTotal        = iHouse && iSqmIdx !== null ? Math.round(iBase * iTierMult * iCombinedMult) + iAddonSum : 0;

  // ── Nurmikko configurator state ───────────────────────────────────────────
  const [nSizeIdx, setNSizeIdx]   = useState<number | null>(null);
  const [nPlanIdx, setNPlanIdx]   = useState<number | null>(null);

  const nBase    = nSizeIdx !== null ? LAWN_SIZES[nSizeIdx].price : 0;
  const nPlan    = nPlanIdx !== null ? VISIT_PLANS[nPlanIdx] : null;
  const nDisc    = nPlan?.disc ?? 0;
  const nTotal   = nPlan ? Math.round(nBase * nPlan.visits * (1 - nDisc)) : 0;

  // ── Muu palvelu ───────────────────────────────────────────────────────────
  const [muuDesc,  setMuuDesc]  = useState("");
  const [muuPrice, setMuuPrice] = useState("");

  // ── Totals ────────────────────────────────────────────────────────────────
  const total      = serviceItems.reduce((s, i) => s + i.price, 0);
  const kotitalous = Math.round(total * 0.65);
  const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000)
    .toLocaleDateString("fi-FI");

  // Presentation mode
  const [presenting, setPresenting] = useState(false);

  // Send state
  const [sending,    setSending]    = useState(false);
  const [sent,       setSent]       = useState(false);
  const [createdJobId, setCreatedJobId] = useState<number | null>(null);

  // ── Load customer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!customerId) return;
    setLoadingCustomer(true);
    api.getCustomer(Number(customerId)).then(res => {
      if (res.ok && res.data) {
        const c = res.data as { name: string; email: string | null; phone: string; address: string };
        setCustomerName(c.name ?? "");
        setCustomerEmail(c.email ?? "");
        setCustomerPhone(c.phone ?? "");
        setCustomerAddress(c.address ?? "");
      }
      setLoadingCustomer(false);
    });
  }, [customerId]);

  // ── Configurator helpers ──────────────────────────────────────────────────

  const openConfig = (mode: ConfigMode) => {
    setConfigMode(prev => prev === mode ? null : mode);
    // reset on open
    if (mode === "ikkuna") { setIHouse(""); setISqmIdx(null); setITier("all"); setIAddons(new Set()); setIMult({ height: 1, access: 1, dirt: 1, windowType: 1 }); }
    if (mode === "nurmikko") { setNSizeIdx(null); setNPlanIdx(null); }
    if (mode === "muu") { setMuuDesc(""); setMuuPrice(""); }
  };

  const toggleAddon = (k: AddonKey) =>
    setIAddons(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const addIkkuna = () => {
    if (!iHouse || iSqmIdx === null) return;
    const houseLabel = HOUSE_TYPES.find(h => h.key === iHouse)!.label;
    const sqmLabel   = SQM_RANGES[iHouse][iSqmIdx].label;
    const tierLabel  = SERVICE_TIERS.find(t => t.key === iTier)!.label;
    const addonLines = Array.from(iAddons).map(k => IKK_ADDONS.find(a => a.key === k)!.label);

    // Build multiplier description if any factor > 1
    const multParts: string[] = [];
    if (iMult.height > 1)     multParts.push(`Korkeus ×${iMult.height.toFixed(2)}`);
    if (iMult.access > 1)     multParts.push(`Pääsy ×${iMult.access.toFixed(2)}`);
    if (iMult.dirt > 1)       multParts.push(`Likaisuus ×${iMult.dirt.toFixed(2)}`);
    if (iMult.windowType > 1) multParts.push(`Ikkunatyyppi ×${iMult.windowType.toFixed(2)}`);
    if (iCombinedMult > 1 && multParts.length > 1) multParts.push(`→ kerroin ×${iCombinedMult.toFixed(2)}`);

    const detail = [tierLabel, ...addonLines, ...multParts].join(" · ");
    setServiceItems(prev => [...prev, {
      id: uid(), type: "ikkuna",
      title:  `Ikkunanpesu — ${houseLabel}, ${sqmLabel}`,
      detail, price: iTotal,
    }]);
    setConfigMode(null);
  };

  const addNurmikko = () => {
    if (nSizeIdx === null || nPlanIdx === null) return;
    const sizeLabel = LAWN_SIZES[nSizeIdx].label;
    const plan      = VISIT_PLANS[nPlanIdx];
    const detail    = plan.disc > 0
      ? `${plan.visits} käyntiä, ${Math.round(plan.disc * 100)} % alennus (${plan.desc})`
      : `${plan.visits} käynti`;
    setServiceItems(prev => [...prev, {
      id: uid(), type: "nurmikko",
      title:  `Nurmikon leikkuu — ${sizeLabel}`,
      detail, price: nTotal,
    }]);
    setConfigMode(null);
  };

  const addMuu = () => {
    const p = parseFloat(muuPrice);
    if (!muuDesc.trim() || isNaN(p) || p <= 0) return;
    setServiceItems(prev => [...prev, {
      id: uid(), type: "muu",
      title: muuDesc.trim(), detail: "", price: p,
    }]);
    setConfigMode(null);
  };

  const removeItem = (id: string) => {
    setServiceItems(prev => prev.filter(i => i.id !== id));
    setEditingPrices(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const commitPrice = (id: string) => {
    const v = parseFloat(editingPrices[id] ?? "");
    if (!isNaN(v) && v >= 0) {
      setServiceItems(prev => prev.map(i => i.id === id ? { ...i, price: v } : i));
    }
    setEditingPrices(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!customerEmail.trim()) {
      toast({ variant: "destructive", title: "Puuttuva sähköposti", description: "Syötä asiakkaan sähköpostiosoite." });
      return;
    }
    if (serviceItems.length === 0) {
      toast({ variant: "destructive", title: "Tarjous on tyhjä", description: "Lisää vähintään yksi palvelu." });
      return;
    }
    setSending(true);

    // ── 1. Save lead job first (independent of email) ──────────────────────
    let custId = customerId ? Number(customerId) : null;
    if (!custId) {
      const custRes = await api.createCustomer({
        name:    customerName.trim() || "Asiakas",
        phone:   customerPhone.trim() || "—",
        email:   customerEmail.trim() || undefined,
        address: customerAddress.trim() || "—",
      });
      if (custRes.ok && custRes.data) {
        custId = (custRes.data as { id: number }).id;
      }
    }

    if (custId) {
      const description = serviceItems.map(i => i.title).join(" + ");
      const scheduledAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
      const jobRes = await api.createJob({
        customerId:   custId,
        description,
        agreedPrice:  Math.round(total * 100),
        status:       "lead",
        scheduledAt,
        assignedTo:   profile?.id || undefined,
        notes:        `Tarjous ${quoteId} lähetetty ${new Date().toLocaleDateString("fi-FI")}`,
        quoteToken,
        quoteVideoUrl: quoteVideoUrl.trim() || undefined,
      });
      if (jobRes.ok && jobRes.data) {
        setCreatedJobId((jobRes.data as { id: number }).id);
      } else {
        toast({ variant: "destructive", title: "Liidi ei tallentunut", description: jobRes.error ?? "Tuntematon virhe" });
      }
    } else {
      toast({ variant: "destructive", title: "Asiakas ei tallentunut", description: "Tarkista asiakastiedot." });
    }

    // ── 2. Send email ────────────────────────────────────────────────────────
    const bccAddresses: string[] = [];
    if (profile?.email) bccAddresses.push(profile.email);
    if (bccOther && otherWorker?.email) bccAddresses.push(otherWorker.email);

    const res = await api.sendQuote({
      to:              customerEmail.trim(),
      bcc:             bccAddresses.length ? bccAddresses.join(",") : undefined,
      quoteId,
      quoteToken,
      quoteVideoUrl:   quoteVideoUrl.trim() || undefined,
      customerName:    customerName.trim() || "Asiakas",
      customerAddress: customerAddress.trim() || undefined,
      items:           serviceItems.map(i => ({
        title:  i.title,
        detail: i.detail,
        price:  i.price,
      })),
      total,
      validDays,
      customMessage: customMessage.trim() || undefined,
      workerName:    profile?.name,
      workerPhone:   profile?.phone,
      workerEmail:   profile?.email,
      lang,
    });

    setSending(false);

    if (!res.ok) {
      toast({
        variant: "destructive",
        title: "Sähköposti epäonnistui",
        description: `Liidi tallennettu, mutta sähköpostin lähetys epäonnistui: ${res.error}`,
      });
    } else {
      toast({ title: "Tarjous lähetetty!", description: `${customerEmail.trim()}` });
    }

    setSent(true);
  };

  // ── Success ───────────────────────────────────────────────────────────────

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Video backdrop */}
        <div className="relative w-full h-52 sm:h-64 overflow-hidden shrink-0">
          <video
            src="/quote-success-bg.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-4">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center mb-3 ring-2 ring-white/40">
              <Check className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Tarjous lähetetty!</h2>
            <p className="text-white/80 text-sm mt-1">{customerEmail}</p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-start justify-center pt-8 pb-24 px-4">
          <div className="w-full max-w-sm space-y-4">
            <p className="text-center text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
              {quoteId}
            </p>

            {createdJobId ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2">
                <Check className="w-3.5 h-3.5 shrink-0" />
                Liidi tallennettu keikkalistaan · vanhenee {new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toLocaleDateString("fi-FI")}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-destructive bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
                Liidi ei tallentunut — lähetys onnistui silti
              </div>
            )}

            {/* Portal link */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="bg-muted/60 px-4 py-2.5 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tarjousportaali-linkki</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-mono break-all text-foreground mb-2">
                  puuhapatet.fi/tarjous/{quoteToken}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://puuhapatet.fi/tarjous/${quoteToken}`);
                    toast({ title: "Linkki kopioitu!" });
                  }}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Kopioi linkki
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button className="w-full" onClick={() => navigate("/admin/jobs")}>
                Avaa keikkalista
              </Button>
              <Button variant="outline" className="w-full" onClick={() => navigate("/admin/customers")}>
                Takaisin asiakkaisiin
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Editor ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold">Uusi tarjous</h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{quoteId}</p>
          </div>
          {/* Language */}
          <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
            {(["fi", "en"] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={cn("px-3.5 py-1.5 text-sm font-semibold transition-colors uppercase",
                  lang === l ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                )}
              >{l}</button>
            ))}
          </div>
        </div>

        {/* ── Palvelut ────────────────────────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Palvelut</h2>

          {/* Added items */}
          {serviceItems.length > 0 && (
            <div className="space-y-2 mb-5">
              {serviceItems.map(item => (
                <div key={item.id} className="flex items-start gap-3 rounded-xl bg-muted/30 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
                  </div>
                  {/* Editable price */}
                  <div className="flex items-center gap-1 shrink-0">
                    {editingPrices[item.id] !== undefined ? (
                      <>
                        <Input
                          type="number"
                          value={editingPrices[item.id]}
                          onChange={e => setEditingPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                          onBlur={() => commitPrice(item.id)}
                          onKeyDown={e => e.key === "Enter" && commitPrice(item.id)}
                          className="w-20 h-8 text-right text-sm font-semibold"
                          autoFocus
                        />
                        <span className="text-sm text-muted-foreground">€</span>
                      </>
                    ) : (
                      <button
                        onClick={() => setEditingPrices(prev => ({ ...prev, [item.id]: String(item.price) }))}
                        className="text-sm font-semibold text-foreground hover:text-primary tabular-nums min-w-[52px] text-right"
                        title="Klikkaa muokataksesi hintaa"
                      >
                        {item.price} €
                      </button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive ml-1"
                      onClick={() => removeItem(item.id)}
                    ><X className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              ))}
              {/* Running total */}
              <div className="flex justify-between items-center px-4 pt-2 border-t">
                <span className="text-sm font-semibold">Yhteensä</span>
                <span className="text-base font-bold">{total} €</span>
              </div>
              {total > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 px-4">
                  Kotitalousvähennyksen jälkeen ~{kotitalous} €
                </p>
              )}
            </div>
          )}

          {/* Add service buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { mode: "ikkuna"   as ConfigMode, label: "Ikkunanpesu",       Icon: Home  },
              { mode: "nurmikko" as ConfigMode, label: "Nurmikon leikkuu",  Icon: Leaf  },
              { mode: "muu"      as ConfigMode, label: "Muu palvelu",       Icon: Wrench},
            ].map(({ mode, label, Icon }) => (
              <Button key={mode} variant={configMode === mode ? "default" : "outline"}
                size="sm" className="gap-1.5" onClick={() => openConfig(mode)}
              >
                <Icon className="w-4 h-4" />
                {label}
                {configMode === mode ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
              </Button>
            ))}
          </div>

          {/* ── Ikkunanpesu configurator ─────────────────────────────── */}
          {configMode === "ikkuna" && (
            <div className="border border-border rounded-xl p-4 space-y-4 bg-muted/10">
              {/* House type */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Kiinteistötyyppi</p>
                <div className="grid grid-cols-2 gap-2">
                  {HOUSE_TYPES.map(h => (
                    <button key={h.key} onClick={() => { setIHouse(h.key); setISqmIdx(null); }}
                      className={cn(
                        "rounded-lg px-3 py-2.5 text-left border transition-colors",
                        iHouse === h.key
                          ? "border-foreground bg-foreground/5 font-semibold"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <p className="text-sm font-medium">{h.label}</p>
                      <p className="text-xs text-muted-foreground">{h.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sqm range */}
              {iHouse && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Asuinpinta-ala</p>
                  <select
                    value={iSqmIdx ?? ""}
                    onChange={e => setISqmIdx(e.target.value === "" ? null : Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Valitse koko…</option>
                    {SQM_RANGES[iHouse].map((r, i) => (
                      <option key={i} value={i}>{r.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Service tier */}
              {iSqmIdx !== null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Palvelu</p>
                  <div className="space-y-2">
                    {SERVICE_TIERS.map(t => {
                      const tPrice = iBase ? Math.round(iBase * t.mult) : 0;
                      return (
                        <button key={t.key} onClick={() => setITier(t.key)}
                          className={cn(
                            "w-full flex justify-between items-center rounded-lg px-4 py-2.5 border text-left transition-colors",
                            iTier === t.key
                              ? "border-foreground bg-foreground/5"
                              : "border-border hover:bg-muted/50"
                          )}
                        >
                          <div>
                            <p className="text-sm font-medium">{t.label}</p>
                            <p className="text-xs text-muted-foreground">{t.sub}</p>
                          </div>
                          <span className="text-sm font-semibold ml-3 shrink-0">{tPrice} €</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Addons */}
              {iSqmIdx !== null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Lisäpalvelut (valinnainen)</p>
                  <div className="flex flex-wrap gap-2">
                    {IKK_ADDONS.map(a => (
                      <button key={a.key} onClick={() => toggleAddon(a.key)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                          iAddons.has(a.key)
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        {a.label} +{a.price} €
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Vaikeuskertoimet */}
              {iSqmIdx !== null && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Vaikeuskertoimet (valinnainen)</p>
                  {([
                    {
                      label: "Korkeus / kerrosluku",
                      key: "height" as const,
                      options: [
                        { label: "Maantaso", value: 1 },
                        { label: "Tikastus ×1.20", value: 1.20 },
                        { label: "2. kerros ×1.40", value: 1.40 },
                        { label: "Erikois ×1.65", value: 1.65 },
                      ],
                    },
                    {
                      label: "Pääsy / saavutettavuus",
                      key: "access" as const,
                      options: [
                        { label: "Normaali", value: 1 },
                        { label: "Haastava ×1.10", value: 1.10 },
                        { label: "Vaikea ×1.25", value: 1.25 },
                      ],
                    },
                    {
                      label: "Likaisuus / rakennuslika",
                      key: "dirt" as const,
                      options: [
                        { label: "Normaali", value: 1 },
                        { label: "Tavallista enemmän ×1.15", value: 1.15 },
                        { label: "Rakennuslika ×1.40", value: 1.40 },
                      ],
                    },
                    {
                      label: "Ikkunatyyppi",
                      key: "windowType" as const,
                      options: [
                        { label: "Tavalliset", value: 1 },
                        { label: "Kippi-käännös ×1.10", value: 1.10 },
                        { label: "Erikoikoot ×1.25", value: 1.25 },
                      ],
                    },
                  ] as const).map(group => (
                    <div key={group.key}>
                      <p className="text-xs text-muted-foreground mb-1.5">{group.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.options.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setIMult(prev => ({ ...prev, [group.key]: opt.value }))}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              iMult[group.key] === opt.value
                                ? "border-foreground bg-foreground text-background"
                                : "border-border hover:bg-muted/50"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {iCombinedMult > 1 && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                        Kokonaiskerroin ×{iCombinedMult.toFixed(2)} — hinta korotettu vaikeustekijöillä
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Price + add button */}
              {iSqmIdx !== null && (
                <div className="flex justify-between items-center pt-2 border-t">
                  <div>
                    <p className="text-sm font-bold">{iTotal} €</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Kotital. jälkeen ~{Math.round(iTotal * 0.65)} €
                    </p>
                  </div>
                  <Button onClick={addIkkuna} className="gap-2">
                    <Plus className="w-4 h-4" /> Lisää tarjoukseen
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Nurmikko configurator ────────────────────────────────── */}
          {configMode === "nurmikko" && (
            <div className="border border-border rounded-xl p-4 space-y-4 bg-muted/10">
              {/* Lawn size */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Nurmikon koko</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {LAWN_SIZES.map((s, i) => (
                    <button key={i} onClick={() => setNSizeIdx(i)}
                      className={cn(
                        "rounded-lg px-3 py-2 text-center border transition-colors",
                        nSizeIdx === i
                          ? "border-foreground bg-foreground/5 font-semibold"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <p className="text-xs font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.price} €/krt</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Visit plan */}
              {nSizeIdx !== null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Käyntikerrat</p>
                  <div className="space-y-2">
                    {VISIT_PLANS.map((p, i) => {
                      const planPrice = Math.round(nBase * p.visits * (1 - p.disc));
                      return (
                        <button key={i} onClick={() => setNPlanIdx(i)}
                          className={cn(
                            "w-full flex justify-between items-center rounded-lg px-4 py-2.5 border text-left transition-colors",
                            nPlanIdx === i
                              ? "border-foreground bg-foreground/5"
                              : "border-border hover:bg-muted/50"
                          )}
                        >
                          <div>
                            <p className="text-sm font-medium">{p.label}</p>
                            <p className="text-xs text-muted-foreground">{p.desc}</p>
                          </div>
                          <div className="text-right ml-3 shrink-0">
                            <p className="text-sm font-semibold">{planPrice} €</p>
                            {p.disc > 0 && <p className="text-xs text-emerald-600">-{Math.round(p.disc * 100)} %</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {nSizeIdx !== null && nPlanIdx !== null && (
                <div className="flex justify-between items-center pt-2 border-t">
                  <p className="text-sm font-bold">{nTotal} €</p>
                  <Button onClick={addNurmikko} className="gap-2">
                    <Plus className="w-4 h-4" /> Lisää tarjoukseen
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Muu palvelu configurator ─────────────────────────────── */}
          {configMode === "muu" && (
            <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/10">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Kuvaus</p>
                <Input value={muuDesc} onChange={e => setMuuDesc(e.target.value)}
                  placeholder="Esim. Talvisiivous, maalaus…" className="text-sm" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Hinta (€)</p>
                <Input type="number" value={muuPrice} onChange={e => setMuuPrice(e.target.value)}
                  placeholder="0" min="0" step="1" className="text-sm" />
              </div>
              <Button onClick={addMuu} disabled={!muuDesc.trim() || !muuPrice}
                className="gap-2 w-full">
                <Plus className="w-4 h-4" /> Lisää tarjoukseen
              </Button>
            </div>
          )}
        </Card>

        {/* ── Asiakas ─────────────────────────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Asiakas</h2>
          {loadingCustomer ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Nimi *",        val: customerName,    set: setCustomerName,    type: "text",  ph: "Etunimi Sukunimi" },
                { label: "Sähköposti *",  val: customerEmail,   set: setCustomerEmail,   type: "email", ph: "email@esimerkki.fi" },
                { label: "Puhelin",       val: customerPhone,   set: setCustomerPhone,   type: "tel",   ph: "+358 40 000 0000" },
                { label: "Osoite",        val: customerAddress, set: setCustomerAddress, type: "text",  ph: "Kadunnimi 1, 02100 Espoo" },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground mb-1.5">{f.label}</p>
                  <Input value={f.val} onChange={e => f.set(e.target.value)}
                    type={f.type} placeholder={f.ph} className="text-sm" />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── Voimassaolo + viesti + BCC ───────────────────────────────── */}
        <Card className="p-6 bg-card border-0 premium-shadow mb-4">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Tarjouksen tiedot</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Voimassa (päiviä)</p>
              <Input type="number" value={validDays} min={1} max={90}
                onChange={e => setValidDays(Math.max(1, Number(e.target.value)))}
                className="text-sm" />
              <p className="text-xs text-muted-foreground mt-1.5">
                Vanhenee: <strong>{validUntil}</strong>
              </p>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1.5">
              Henkilökohtainen viesti <span className="font-normal">(valinnainen)</span>
            </p>
            <Textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)}
              placeholder={lang === "fi"
                ? "Hei! Kartoituksen perusteella tässä ehdotuksemme…"
                : "Hi! Based on our assessment, here's our proposal…"}
              rows={3} className="text-sm resize-none" />
          </div>

          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1.5">
              Video-linkki <span className="font-normal">(valinnainen — YouTube, Vimeo tai MP4)</span>
            </p>
            <Input value={quoteVideoUrl} onChange={e => setQuoteVideoUrl(e.target.value)}
              type="url" placeholder="https://youtube.com/..." className="text-sm" />
          </div>

          {/* BCC to other worker */}
          {otherWorker && (
            <button
              onClick={() => setBccOther(v => !v)}
              className={cn(
                "w-full flex items-center justify-between rounded-xl px-4 py-3 border transition-colors text-sm",
                bccOther ? "border-foreground bg-foreground/5" : "border-border hover:bg-muted/30"
              )}
            >
              <span>
                Lähetä piilokopio myös <strong>{otherWorker.name}</strong>:lle
              </span>
              <div className={cn(
                "w-10 h-6 rounded-full transition-colors relative shrink-0",
                bccOther ? "bg-foreground" : "bg-muted"
              )}>
                <div className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
                  bccOther ? "translate-x-5" : "translate-x-1"
                )} />
              </div>
            </button>
          )}
        </Card>

        {/* ── Send + Esitä ─────────────────────────────────────────────── */}
        <div className="flex gap-2">
          {serviceItems.length > 0 && (
            <Button
              variant="outline"
              className="gap-2 shrink-0"
              onClick={() => setPresenting(true)}
              title="Esitä tarjous asiakkaalle koko ruudussa"
            >
              <Monitor className="w-4 h-4" />
              Esitä
            </Button>
          )}
          <Button
            className="flex-1 h-12 text-base font-semibold gap-2"
            onClick={handleSend}
            disabled={sending || !customerEmail.trim() || serviceItems.length === 0}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            {sending ? "Lähetetään…" : `Lähetä tarjous${total > 0 ? ` · ${total} €` : ""}`}
          </Button>
        </div>
        {(!customerEmail.trim() || serviceItems.length === 0) && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            {!customerEmail.trim() ? "Syötä asiakkaan sähköposti" : "Lisää vähintään yksi palvelu"}
          </p>
        )}

        {/* ── Live-esitystila ───────────────────────────────────────────── */}
        {presenting && (
          <QuotePresentation
            customerName={customerName || "Asiakas"}
            customerAddress={customerAddress}
            serviceItems={serviceItems}
            total={total}
            workerName={profile?.name ?? ""}
            workerPhone={profile?.phone ?? ""}
            onClose={() => setPresenting(false)}
            onSend={handleSend}
            sending={sending}
          />
        )}

      </div>
    </div>
  );
}
