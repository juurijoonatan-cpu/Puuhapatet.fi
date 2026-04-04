import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Minus, Plus, Send, Loader2, CheckCircle2, Info } from "lucide-react";

// ─── SVG Window Illustrations ───────────────────────────────────────────────

const Svg2Pin = () => (
  <svg viewBox="0 0 80 64" className="w-full h-full" fill="none">
    <rect x="3" y="3" width="74" height="58" rx="3" stroke="currentColor" strokeWidth="3"/>
    <rect x="8" y="8" width="64" height="48" rx="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="0"/>
    <line x1="40" y1="8" x2="40" y2="56" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const SvgVentilation = () => (
  <svg viewBox="0 0 80 64" className="w-full h-full" fill="none">
    <rect x="3" y="3" width="74" height="58" rx="3" stroke="currentColor" strokeWidth="3"/>
    <rect x="8" y="8" width="64" height="30" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="40" y1="8" x2="40" y2="38" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="8" y="42" width="64" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="40" cy="49" r="3" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const Svg4Pin = () => (
  <svg viewBox="0 0 80 64" className="w-full h-full" fill="none">
    <rect x="3" y="3" width="74" height="58" rx="3" stroke="currentColor" strokeWidth="3"/>
    <rect x="8" y="8" width="64" height="48" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="40" y1="8" x2="40" y2="56" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="8" y1="32" x2="72" y2="32" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M 30 22 L 36 28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const Svg6Pin = () => (
  <svg viewBox="0 0 80 64" className="w-full h-full" fill="none">
    <rect x="3" y="3" width="74" height="58" rx="3" stroke="currentColor" strokeWidth="3"/>
    <line x1="30" y1="3" x2="30" y2="61" stroke="currentColor" strokeWidth="2"/>
    <line x1="50" y1="3" x2="50" y2="61" stroke="currentColor" strokeWidth="2"/>
    <line x1="3" y1="32" x2="77" y2="32" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M 17 20 L 23 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const SvgBalcony = () => (
  <svg viewBox="0 0 80 64" className="w-full h-full" fill="none">
    <rect x="3" y="8" width="74" height="52" rx="2" stroke="currentColor" strokeWidth="3"/>
    <line x1="23" y1="8" x2="23" y2="60" stroke="currentColor" strokeWidth="2"/>
    <line x1="43" y1="8" x2="43" y2="60" stroke="currentColor" strokeWidth="2"/>
    <line x1="63" y1="8" x2="63" y2="60" stroke="currentColor" strokeWidth="2"/>
    <line x1="3" y1="8" x2="77" y2="8" stroke="currentColor" strokeWidth="3"/>
    <path d="M 13 30 L 13 38 L 20 34 Z" fill="currentColor"/>
  </svg>
);

const SvgRailing = () => (
  <svg viewBox="0 0 80 64" className="w-full h-full" fill="none">
    <rect x="3" y="16" width="74" height="40" rx="2" stroke="currentColor" strokeWidth="3"/>
    <line x1="3" y1="14" x2="77" y2="14" stroke="currentColor" strokeWidth="4"/>
    <line x1="3" y1="58" x2="77" y2="58" stroke="currentColor" strokeWidth="4"/>
    <line x1="20" y1="14" x2="20" y2="58" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="40" y1="14" x2="40" y2="58" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="60" y1="14" x2="60" y2="58" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// ─── Car SVGs ────────────────────────────────────────────────────────────────

const SvgSmallCar = () => (
  <svg viewBox="0 0 100 56" className="w-full h-full" fill="none">
    <path d="M10 38 Q10 44 16 44 L84 44 Q90 44 90 38 L90 30 L78 20 L58 16 L36 16 L20 24 L10 30 Z" stroke="currentColor" strokeWidth="2.5" fill="none"/>
    <path d="M36 16 L30 30 L70 30 L64 16 Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <circle cx="25" cy="44" r="6" stroke="currentColor" strokeWidth="2.5"/>
    <circle cx="75" cy="44" r="6" stroke="currentColor" strokeWidth="2.5"/>
  </svg>
);

const SvgMediumCar = () => (
  <svg viewBox="0 0 110 56" className="w-full h-full" fill="none">
    <path d="M8 38 Q8 46 16 46 L94 46 Q102 46 102 38 L102 30 L88 18 L68 14 L40 14 L22 22 L8 30 Z" stroke="currentColor" strokeWidth="2.5" fill="none"/>
    <path d="M40 14 L32 30 L78 30 L70 14 Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <circle cx="26" cy="46" r="7" stroke="currentColor" strokeWidth="2.5"/>
    <circle cx="84" cy="46" r="7" stroke="currentColor" strokeWidth="2.5"/>
  </svg>
);

const SvgLargeCar = () => (
  <svg viewBox="0 0 120 60" className="w-full h-full" fill="none">
    <path d="M6 40 Q6 50 16 50 L104 50 Q114 50 114 40 L114 30 L96 16 L74 12 L44 12 L22 22 L6 32 Z" stroke="currentColor" strokeWidth="2.5" fill="none"/>
    <path d="M44 12 L34 30 L86 30 L76 12 Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    <circle cx="28" cy="50" r="8" stroke="currentColor" strokeWidth="2.5"/>
    <circle cx="92" cy="50" r="8" stroke="currentColor" strokeWidth="2.5"/>
    <line x1="6" y1="32" x2="114" y2="32" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3"/>
  </svg>
);

// ─── Pricing data ─────────────────────────────────────────────────────────────

const START_FEE = 25;
const MIN_ORDER = 80;
const VAT = 0.255;
const KOTITALOUS_PCT = 0.35;

const WINDOW_TYPES = [
  { key: "w2",          label: "2-pintainen ikkuna",        price: 9,  unit: "kpl", Icon: Svg2Pin },
  { key: "ventilation", label: "Tuuletusikkuna kahvalla",   price: 10, unit: "kpl", Icon: SvgVentilation },
  { key: "w4",          label: "4-pintainen avautuva",      price: 16, unit: "kpl", Icon: Svg4Pin },
  { key: "w6",          label: "6-pintainen avautuva",      price: 21, unit: "kpl", Icon: Svg6Pin },
  { key: "balcony",     label: "Parvekelasi",               price: 7,  unit: "paneeli", Icon: SvgBalcony },
  { key: "railing",     label: "Lasikaide",                 price: 7,  unit: "metri", Icon: SvgRailing },
] as const;

type WindowKey = (typeof WINDOW_TYPES)[number]["key"];

const CAR_SIZES = [
  { key: "small",  label: "Pieni auto",       sub: "Hatchback, city-auto", Icon: SvgSmallCar },
  { key: "medium", label: "Keskikokoinen",     sub: "Sedan, pieni SUV",    Icon: SvgMediumCar },
  { key: "large",  label: "Iso auto",          sub: "SUV, tila-auto, vm",  Icon: SvgLargeCar },
] as const;

type CarSize = (typeof CAR_SIZES)[number]["key"];

const DIRT_LEVELS = [
  { key: "normal",    label: "Normaali",        sub: "Tavallinen arkilikaantuminen" },
  { key: "dirty",     label: "Likainen",        sub: "Selkeästi likaisempi kuin normaalisti" },
  { key: "very",      label: "Erittäin likainen", sub: "Tahroja, lemmikkejä, pitkään pesemättä" },
] as const;

type DirtLevel = (typeof DIRT_LEVELS)[number]["key"];

const CAR_PRICES: Record<CarSize, Record<DirtLevel, number>> = {
  small:  { normal: 89,  dirty: 119, very: 149 },
  medium: { normal: 109, dirty: 139, very: 179 },
  large:  { normal: 129, dirty: 169, very: 219 },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function LaskuriPage() {
  const [tab, setTab] = useState<"ikkunat" | "auto">("ikkunat");

  // Window state
  const [counts, setCounts] = useState<Record<WindowKey, number>>({
    w2: 0, ventilation: 0, w4: 0, w6: 0, balcony: 0, railing: 0,
  });

  // Car state
  const [carSize, setCarSize] = useState<CarSize | null>(null);
  const [dirtLevel, setDirtLevel] = useState<DirtLevel>("normal");

  // Order form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", urgency: "" as "" | "this_week" | "flexible", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");

  // ── Calculations ──
  const windowSubtotal = WINDOW_TYPES.reduce((sum, t) => sum + t.price * counts[t.key], 0);
  const windowTotal = Math.max(windowSubtotal + START_FEE, MIN_ORDER);
  const windowHasItems = windowSubtotal > 0;

  const carPrice = carSize ? CAR_PRICES[carSize][dirtLevel] : 0;

  const activeTotal = tab === "ikkunat" ? windowTotal : carPrice;
  const hasResult = tab === "ikkunat" ? windowHasItems : carSize !== null;

  const kotitalous = Math.round(activeTotal * KOTITALOUS_PCT);
  const afterKotitalous = activeTotal - kotitalous;

  // ── Counter helpers ──
  const adjust = (key: WindowKey, delta: number) =>
    setCounts(prev => ({ ...prev, [key]: Math.max(0, prev[key] + delta) }));

  // ── Submit ──
  const handleSend = async () => {
    if (!form.name || !form.phone || !form.address) return;
    setSending(true);
    setSendError("");
    try {
      const serviceDesc =
        tab === "ikkunat"
          ? WINDOW_TYPES.filter(t => counts[t.key] > 0)
              .map(t => `${t.label}: ${counts[t.key]} ${t.unit}`)
              .join(", ")
          : `Auton sisäpuhdistus — ${CAR_SIZES.find(c => c.key === carSize)?.label}, ${DIRT_LEVELS.find(d => d.key === dirtLevel)?.label}`;

      const body = {
        access_key: "f70be445-1acf-4e5a-87f8-e27056edf67e",
        botcheck: false,
        subject: `Hinta-arvio: ${form.name}`,
        from_name: "Puuhapatet.fi Laskuri",
        Nimi: form.name,
        Puhelin: form.phone,
        Sähköposti: form.email || "—",
        Alue: form.address,
        Kiireellisyys: form.urgency === "this_week" ? "Tällä viikolla" : form.urgency === "flexible" ? "Ei kiireellinen" : "—",
        Palvelu: serviceDesc,
        "Hinta-arvio": `${activeTotal} € (kotitalousväh. jälkeen ~${afterKotitalous} €)`,
        Lisätiedot: form.message || "—",
      };

      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error();
      setSent(true);
    } catch {
      setSendError("Jotain meni pieleen. Soita suoraan: 0400 389 999");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28 flex items-center justify-center">
        <div className="text-center px-4 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-3">Hinta-arvio lähetetty!</h1>
          <p className="text-muted-foreground leading-relaxed mb-8">
            Tarkistamme arvion ja vahvistamme hinnan sinulle pian — yleensä saman päivän aikana.
          </p>
          <Button variant="outline" onClick={() => { setSent(false); setShowForm(false); }}>
            Tee uusi arvio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">Hinta-arvio</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Laske suuntaa-antava hinta palvelullesi. Suuremmille kohteille teemme aina erillisen tarjouksen.
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex rounded-2xl bg-muted p-1 mb-6">
          {(["ikkunat", "auto"] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setShowForm(false); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                tab === t ? "bg-card premium-shadow text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "ikkunat" ? "Ikkunanpesu" : "Auton sisäpuhdistus"}
            </button>
          ))}
        </div>

        {/* ── WINDOW CALCULATOR ── */}
        {tab === "ikkunat" && (
          <div className="space-y-3">
            {WINDOW_TYPES.map(({ key, label, price, unit, Icon }) => (
              <Card key={key} className="p-4 bg-card border-0 premium-shadow">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-11 text-muted-foreground flex-shrink-0">
                    <Icon />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
                    <p className="text-xs text-muted-foreground">{price} € / {unit}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => adjust(key, -1)}
                      className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition-all"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">
                      {counts[key]}
                    </span>
                    <button
                      onClick={() => adjust(key, 1)}
                      className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}

            {/* Start fee note */}
            <p className="text-xs text-muted-foreground text-center pt-1">
              Aloitusmaksu {START_FEE} € sisältyy hintaan. Minimitilaus {MIN_ORDER} €.
            </p>
          </div>
        )}

        {/* ── CAR CALCULATOR ── */}
        {tab === "auto" && (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium text-foreground mb-3">Auton koko</p>
              <div className="grid grid-cols-3 gap-3">
                {CAR_SIZES.map(({ key, label, sub, Icon }) => (
                  <button
                    key={key}
                    onClick={() => setCarSize(key)}
                    className={`p-3 rounded-2xl border-2 transition-all text-center ${
                      carSize === key
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="h-10 text-muted-foreground mb-2">
                      <Icon />
                    </div>
                    <p className="text-xs font-semibold text-foreground">{label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-3">Likaantumisaste</p>
              <div className="space-y-2">
                {DIRT_LEVELS.map(({ key, label, sub }) => (
                  <button
                    key={key}
                    onClick={() => setDirtLevel(key)}
                    className={`w-full p-3.5 rounded-2xl border-2 text-left transition-all flex items-center gap-3 ${
                      dirtLevel === key
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      dirtLevel === key ? "bg-primary" : "bg-muted-foreground/30"
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PRICE RESULT ── */}
        {hasResult && (
          <Card className="mt-6 p-5 bg-card border-0 premium-shadow">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Hinta-arvio (sis. ALV)</span>
                <span className="text-lg font-semibold text-foreground">{activeTotal} €</span>
              </div>
              <div className="flex justify-between items-center text-primary">
                <span className="text-sm font-medium flex items-center gap-1">
                  <span>Kotitalousvähennys (35 %)</span>
                </span>
                <span className="text-sm font-medium">−{kotitalous} €</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between items-center">
                <span className="text-sm font-semibold text-foreground">Sinulle jää maksettavaksi</span>
                <span className="text-xl font-bold text-primary">~{afterKotitalous} €</span>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 bg-muted/50 rounded-xl p-3">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Tämä on suuntaa-antava arvio. Isommille kohteille teemme aina erillisen konkreettisen tarjouksen — laskuri on silloin hyödytön. Lähetä tilaus niin vahvistamme hinnan.
              </p>
            </div>

            {!showForm && (
              <Button className="w-full mt-4" size="lg" onClick={() => setShowForm(true)}>
                Lähetä tilaus vahvistettavaksi
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </Card>
        )}

        {/* ── ORDER FORM ── */}
        {showForm && hasResult && (
          <Card className="mt-4 p-5 bg-card border-0 premium-shadow space-y-4">
            <h2 className="text-base font-semibold text-foreground">Yhteystiedot</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 md:col-span-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Nimi *</label>
                <Input placeholder="Matti Meikäläinen" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Puhelin *</label>
                <Input type="tel" placeholder="040 123 4567" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Alue tai osoite *</label>
                <Input placeholder="Westend, Espoo" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Kiireellisyys</label>
              <div className="grid grid-cols-2 gap-2">
                {([{ v: "this_week", l: "Tällä viikolla" }, { v: "flexible", l: "Ei kiireellinen" }] as const).map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, urgency: f.urgency === opt.v ? "" : opt.v }))}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                      form.urgency === opt.v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lisätiedot</label>
              <Textarea
                placeholder="Vapaaehtoinen — kerro esim. kohteen lisätiedot..."
                rows={3}
                className="resize-none text-sm"
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              />
            </div>

            {sendError && <p className="text-xs text-destructive">{sendError}</p>}

            <Button
              className="w-full h-12 text-sm font-semibold rounded-2xl"
              disabled={sending || !form.name || !form.phone || !form.address}
              onClick={handleSend}
            >
              {sending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Lähetetään...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Lähetä vahvistettavaksi</>
              )}
            </Button>
          </Card>
        )}

      </div>
    </div>
  );
}
