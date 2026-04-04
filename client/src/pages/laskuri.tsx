import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Minus, Plus, Send, Loader2, CheckCircle2, Info } from "lucide-react";

// ─── SVG illustrations ────────────────────────────────────────────────────────

const Svg2Pin = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="4" width="64" height="52" rx="3" stroke="currentColor" strokeWidth="2.5"/>
    <rect x="10" y="10" width="23" height="40" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <rect x="39" y="10" width="23" height="40" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <line x1="36" y1="10" x2="36" y2="50" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

const SvgVentilation = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="4" width="64" height="52" rx="3" stroke="currentColor" strokeWidth="2.5"/>
    <rect x="10" y="10" width="52" height="28" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <line x1="36" y1="10" x2="36" y2="38" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="10" y="42" width="52" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="36" cy="47" r="2.5" fill="currentColor"/>
  </svg>
);

const Svg4Pin = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="4" width="64" height="52" rx="3" stroke="currentColor" strokeWidth="2.5"/>
    <rect x="10" y="10" width="52" height="40" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <line x1="36" y1="10" x2="36" y2="50" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="10" y1="30" x2="62" y2="30" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="38" cy="30" r="2.5" fill="currentColor"/>
    <path d="M20 20 L28 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const Svg6Pin = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="4" width="64" height="52" rx="3" stroke="currentColor" strokeWidth="2.5"/>
    <line x1="28" y1="4" x2="28" y2="56" stroke="currentColor" strokeWidth="2"/>
    <line x1="44" y1="4" x2="44" y2="56" stroke="currentColor" strokeWidth="2"/>
    <rect x="10" y="10" width="14" height="40" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity=".06"/>
    <rect x="30" y="10" width="12" height="40" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity=".06"/>
    <rect x="48" y="10" width="14" height="40" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity=".06"/>
    <line x1="10" y1="30" x2="62" y2="30" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="30" cy="30" r="2" fill="currentColor"/>
  </svg>
);

const SvgBalcony = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <line x1="4" y1="6" x2="68" y2="6" stroke="currentColor" strokeWidth="3"/>
    <line x1="4" y1="54" x2="68" y2="54" stroke="currentColor" strokeWidth="3"/>
    <rect x="6" y="6" width="15" height="48" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <rect x="24" y="6" width="11" height="48" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".08"/>
    <rect x="38" y="6" width="11" height="48" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".08"/>
    <rect x="52" y="6" width="15" height="48" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <path d="M26 22 L22 30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const SvgTerrace = () => (
  <svg viewBox="0 0 80 52" fill="none" className="w-full h-full">
    <line x1="2" y1="5" x2="78" y2="5" stroke="currentColor" strokeWidth="3"/>
    <line x1="2" y1="48" x2="78" y2="48" stroke="currentColor" strokeWidth="3"/>
    <rect x="4" y="5" width="17" height="43" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <rect x="23" y="5" width="16" height="43" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".08"/>
    <rect x="41" y="5" width="16" height="43" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".08"/>
    <rect x="59" y="5" width="17" height="43" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
  </svg>
);

const SvgRailing = () => (
  <svg viewBox="0 0 80 52" fill="none" className="w-full h-full">
    <rect x="4" y="14" width="72" height="30" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <line x1="2" y1="12" x2="78" y2="12" stroke="currentColor" strokeWidth="4"/>
    <line x1="2" y1="46" x2="78" y2="46" stroke="currentColor" strokeWidth="4"/>
    <line x1="21" y1="12" x2="21" y2="46" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="40" y1="12" x2="40" y2="46" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="59" y1="12" x2="59" y2="46" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const SvgGrid = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="4" width="64" height="52" rx="3" stroke="currentColor" strokeWidth="2.5"/>
    <line x1="28" y1="4" x2="28" y2="56" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="44" y1="4" x2="44" y2="56" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="4" y1="23" x2="68" y2="23" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="4" y1="37" x2="68" y2="37" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="8" y="8" width="16" height="11" fill="currentColor" fillOpacity=".07"/>
    <rect x="30" y="8" width="10" height="11" fill="currentColor" fillOpacity=".07"/>
    <rect x="46" y="8" width="18" height="11" fill="currentColor" fillOpacity=".07"/>
    <rect x="8" y="27" width="16" height="6" fill="currentColor" fillOpacity=".07"/>
    <rect x="30" y="27" width="10" height="6" fill="currentColor" fillOpacity=".07"/>
    <rect x="46" y="27" width="18" height="6" fill="currentColor" fillOpacity=".07"/>
  </svg>
);

const SvgMirror = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="14" y="4" width="44" height="48" rx="4" stroke="currentColor" strokeWidth="2.5" fill="currentColor" fillOpacity=".06"/>
    <rect x="20" y="10" width="32" height="36" rx="2" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".1"/>
    <path d="M26 24 Q28 20 32 22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    <circle cx="36" cy="18" r="3" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="28" y1="52" x2="44" y2="52" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

const SvgDoor = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="16" y="4" width="40" height="52" rx="3" stroke="currentColor" strokeWidth="2.5" fill="currentColor" fillOpacity=".06"/>
    <rect x="22" y="10" width="28" height="20" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".08"/>
    <rect x="22" y="34" width="28" height="16" rx="1" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="50" cy="32" r="2.5" fill="currentColor"/>
  </svg>
);

const SvgPole = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="6" width="40" height="40" rx="3" stroke="currentColor" strokeWidth="2"/>
    <rect x="10" y="12" width="28" height="28" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <line x1="46" y1="6" x2="46" y2="46" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="44" y1="22" x2="68" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <rect x="62" y="8" width="7" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="44" y1="30" x2="60" y2="26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2"/>
  </svg>
);

const SvgBathroom = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="10" y="4" width="24" height="52" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity=".06"/>
    <rect x="38" y="4" width="24" height="52" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity=".06"/>
    <line x1="34" y1="4" x2="38" y2="4" stroke="currentColor" strokeWidth="2"/>
    <line x1="34" y1="56" x2="38" y2="56" stroke="currentColor" strokeWidth="2"/>
    <line x1="34" y1="4" x2="34" y2="56" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"/>
    <circle cx="36" cy="30" r="2.5" fill="currentColor"/>
  </svg>
);

const SvgBlinds = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="4" y="4" width="64" height="52" rx="3" stroke="currentColor" strokeWidth="2"/>
    {[14, 22, 30, 38, 46].map(y => (
      <rect key={y} x="10" y={y} width="52" height="5" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity=".12"/>
    ))}
    <line x1="36" y1="4" x2="36" y2="14" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="30" y1="4" x2="30" y2="14" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="42" y1="4" x2="42" y2="14" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const SvgHighWindow = () => (
  <svg viewBox="0 0 72 60" fill="none" className="w-full h-full">
    <rect x="22" y="4" width="30" height="36" rx="2" stroke="currentColor" strokeWidth="2"/>
    <rect x="28" y="10" width="18" height="24" rx="1" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".06"/>
    <line x1="37" y1="10" x2="37" y2="34" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="8" y1="56" x2="16" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="20" y1="56" x2="16" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="8" y1="56" x2="20" y2="56" stroke="currentColor" strokeWidth="2"/>
    <line x1="10" y1="50" x2="18" y2="50" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="11" y1="44" x2="19" y2="44" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="16" y1="40" x2="16" y2="56" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// ─── Pricing ──────────────────────────────────────────────────────────────────

const START_FEE = 25;
const MIN_ORDER = 80;
const KOTITALOUS_PCT = 0.35;

const WINDOW_TYPES = [
  { key: "w2",       label: "2-pintainen ikkuna",            price: 9,  unit: "kpl",   Icon: Svg2Pin },
  { key: "vent",     label: "Tuuletusikkuna kahvalla",       price: 10, unit: "kpl",   Icon: SvgVentilation },
  { key: "w4",       label: "Avautuva 4-pintainen",          price: 16, unit: "kpl",   Icon: Svg4Pin },
  { key: "w6",       label: "Avautuva 6-pintainen",          price: 21, unit: "kpl",   Icon: Svg6Pin },
  { key: "grid",     label: "Ruudukkoikkunat",               price: 21, unit: "kpl",   Icon: SvgGrid },
  { key: "balcony",  label: "Parvekelasit",                  price: 7,  unit: "paneeli", Icon: SvgBalcony },
  { key: "terrace",  label: "Terassilasit",                  price: 11, unit: "paneeli", Icon: SvgTerrace },
  { key: "railing",  label: "Lasikaide",                     price: 7,  unit: "metri", Icon: SvgRailing },
  { key: "pole",     label: "Pesu jatkovarrella",            price: 13, unit: "pinta", Icon: SvgPole },
  { key: "mirror",   label: "Peili",                         price: 5,  unit: "kpl",   Icon: SvgMirror },
  { key: "door",     label: "Ovi (lasinen)",                 price: 10, unit: "kpl",   Icon: SvgDoor },
  { key: "bathroom", label: "Kylpyhuoneen lasi",             price: 7,  unit: "kpl",   Icon: SvgBathroom },
  { key: "blinds",   label: "Sälekaihdinten puhdistus",      price: 8,  unit: "ikkuna", Icon: SvgBlinds },
  { key: "high",     label: "Avautuva ikkuna 3–5 m",         price: 34, unit: "kpl",   Icon: SvgHighWindow },
] as const;

type WindowKey = (typeof WINDOW_TYPES)[number]["key"];

const CAR_SIZES = [
  { key: "small",  label: "Pieni auto",    sub: "Hatchback, city" },
  { key: "medium", label: "Keskikokoinen", sub: "Sedan, pieni SUV" },
  { key: "large",  label: "Iso auto",      sub: "SUV, tila-auto" },
] as const;
type CarSize = (typeof CAR_SIZES)[number]["key"];

const DIRT_LEVELS = [
  { key: "normal", label: "Normaali",           sub: "Tavallinen arkilika" },
  { key: "dirty",  label: "Likainen",           sub: "Selkeästi likaisempi" },
  { key: "very",   label: "Erittäin likainen",  sub: "Tahroja, lemmikkejä" },
] as const;
type DirtLevel = (typeof DIRT_LEVELS)[number]["key"];

const CAR_PRICES: Record<CarSize, Record<DirtLevel, number>> = {
  small:  { normal: 89,  dirty: 119, very: 149 },
  medium: { normal: 109, dirty: 139, very: 179 },
  large:  { normal: 129, dirty: 169, very: 219 },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LaskuriPage() {
  const [tab, setTab] = useState<"ikkunat" | "auto">("ikkunat");
  const [counts, setCounts] = useState<Record<WindowKey, number>>(
    Object.fromEntries(WINDOW_TYPES.map(t => [t.key, 0])) as Record<WindowKey, number>
  );
  const [carSize, setCarSize] = useState<CarSize | null>(null);
  const [dirtLevel, setDirtLevel] = useState<DirtLevel>("normal");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", urgency: "" as "" | "this_week" | "flexible", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");

  // Calculations
  const windowSubtotal = WINDOW_TYPES.reduce((s, t) => s + t.price * counts[t.key], 0);
  const windowTotal = Math.max(windowSubtotal + (windowSubtotal > 0 ? START_FEE : 0), windowSubtotal > 0 ? MIN_ORDER : 0);
  const carPrice = carSize ? CAR_PRICES[carSize][dirtLevel] : 0;
  const activeTotal = tab === "ikkunat" ? windowTotal : carPrice;
  const hasResult = tab === "ikkunat" ? windowSubtotal > 0 : carSize !== null;
  const kotitalous = Math.round(activeTotal * KOTITALOUS_PCT);
  const afterKotitalous = activeTotal - kotitalous;

  const selectedWindows = WINDOW_TYPES.filter(t => counts[t.key] > 0);

  const adjust = (key: WindowKey, d: number) =>
    setCounts(p => ({ ...p, [key]: Math.max(0, p[key] + d) }));

  const handleSend = async () => {
    if (!form.name || !form.phone || !form.address) return;
    setSending(true); setSendError("");
    try {
      const serviceDesc = tab === "ikkunat"
        ? selectedWindows.map(t => `${t.label}: ${counts[t.key]} ${t.unit}`).join(", ")
        : `Auton sisäpuhdistus — ${CAR_SIZES.find(c => c.key === carSize)?.label}, ${DIRT_LEVELS.find(d => d.key === dirtLevel)?.label}`;
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: "f70be445-1acf-4e5a-87f8-e27056edf67e",
          botcheck: false,
          subject: `Hinta-arvio: ${form.name}`,
          from_name: "Puuhapatet.fi Laskuri",
          Nimi: form.name, Puhelin: form.phone, Sähköposti: form.email || "—",
          Alue: form.address,
          Kiireellisyys: form.urgency === "this_week" ? "Tällä viikolla" : form.urgency === "flexible" ? "Ei kiireellinen" : "—",
          Palvelu: serviceDesc,
          "Hinta-arvio": `${activeTotal} € (kotitalousväh. jälkeen ~${afterKotitalous} €)`,
          Lisätiedot: form.message || "—",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error();
      setSent(true);
    } catch { setSendError("Jotain meni pieleen. Soita suoraan: 0400 389 999"); }
    finally { setSending(false); }
  };

  if (sent) return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28 flex items-center justify-center">
      <div className="text-center px-4 max-w-sm">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground mb-3">Lähetetty!</h1>
        <p className="text-muted-foreground leading-relaxed mb-8">Tarkistamme arvion ja vahvistamme hinnan sinulle pian.</p>
        <Button variant="outline" onClick={() => { setSent(false); setShowForm(false); }}>Tee uusi arvio</Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-5xl">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">Hinta-arvio</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Laske suuntaa-antava hinta. Isommille kohteille teemme aina erillisen tarjouksen paikan päällä.
          </p>
        </div>

        {/* Tab */}
        <div className="flex rounded-2xl bg-muted p-1 mb-6 max-w-sm mx-auto">
          {(["ikkunat", "auto"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === t ? "bg-card premium-shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "ikkunat" ? "Ikkunanpesu" : "Auton sisäpuhdistus"}
            </button>
          ))}
        </div>

        {/* Main layout: items + summary sidebar */}
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">

          {/* Left: items */}
          <div className="lg:col-span-2">

            {/* ── WINDOW TYPES ── */}
            {tab === "ikkunat" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {WINDOW_TYPES.map(({ key, label, price, unit, Icon }) => (
                    <Card key={key} className="p-3 bg-card border-0 premium-shadow">
                      <div className="flex flex-col items-center text-center gap-2">
                        <div className="w-full h-14 text-primary/70">
                          <Icon />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground leading-tight">{label}</p>
                          <p className="text-[10px] text-muted-foreground">{price} € / {unit}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <button onClick={() => adjust(key, -1)}
                            className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-all">
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className={`w-6 text-center text-sm font-bold tabular-nums ${counts[key] > 0 ? "text-primary" : "text-muted-foreground"}`}>
                            {counts[key]}
                          </span>
                          <button onClick={() => adjust(key, 1)}
                            className="w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-all">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  Aloitusmaksu {START_FEE} € sisältyy hintaan · Minimitilaus {MIN_ORDER} €
                </p>
              </div>
            )}

            {/* ── CAR ── */}
            {tab === "auto" && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Auton koko</p>
                  <div className="grid grid-cols-3 gap-3">
                    {CAR_SIZES.map(({ key, label, sub }) => (
                      <button key={key} onClick={() => setCarSize(key)}
                        className={`p-3 rounded-2xl border-2 text-center transition-all ${carSize === key ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Likaantumisaste</p>
                  <div className="space-y-2">
                    {DIRT_LEVELS.map(({ key, label, sub }) => (
                      <button key={key} onClick={() => setDirtLevel(key)}
                        className={`w-full p-3.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${dirtLevel === key ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${dirtLevel === key ? "bg-primary" : "bg-muted-foreground/30"}`} />
                        <div>
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">{sub}</p>
                        </div>
                        {carSize && <span className="ml-auto text-sm font-bold text-primary">{CAR_PRICES[carSize][key]} €</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: summary sidebar */}
          <div className="lg:col-span-1 mt-6 lg:mt-0">
            <div className="lg:sticky lg:top-24 space-y-3">

              {/* Summary card */}
              <Card className="p-4 bg-card border-0 premium-shadow">
                <h3 className="text-sm font-semibold text-foreground mb-3">Yhteenveto</h3>

                {!hasResult && (
                  <p className="text-xs text-muted-foreground text-center py-4">Valitse palvelut vasemmalta</p>
                )}

                {tab === "ikkunat" && selectedWindows.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {selectedWindows.map(t => (
                      <div key={t.key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground truncate mr-2">{t.label} × {counts[t.key]}</span>
                        <span className="text-foreground font-medium flex-shrink-0">{t.price * counts[t.key]} €</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs border-t border-border pt-1.5 mt-1.5">
                      <span className="text-muted-foreground">Aloitusmaksu</span>
                      <span className="text-foreground font-medium">{START_FEE} €</span>
                    </div>
                  </div>
                )}

                {tab === "auto" && carSize && (
                  <div className="space-y-1.5 mb-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{CAR_SIZES.find(c => c.key === carSize)?.label}</span>
                      <span className="text-foreground font-medium">{carPrice} €</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{DIRT_LEVELS.find(d => d.key === dirtLevel)?.label}</span>
                    </div>
                  </div>
                )}

                {hasResult && (
                  <div className="border-t border-border pt-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Hinta-arvio (sis. ALV)</span>
                      <span className="text-base font-bold text-foreground">{activeTotal} €</span>
                    </div>
                    <div className="flex justify-between items-center text-primary">
                      <span className="text-xs">Kotitalousvähennys</span>
                      <span className="text-xs font-medium">−{kotitalous} €</span>
                    </div>
                    <div className="flex justify-between items-center bg-primary/5 rounded-xl px-2 py-1.5">
                      <span className="text-xs font-semibold text-foreground">Maksat itse</span>
                      <span className="text-base font-bold text-primary">~{afterKotitalous} €</span>
                    </div>
                  </div>
                )}

                {hasResult && !showForm && (
                  <Button className="w-full mt-4" size="sm" onClick={() => setShowForm(true)}>
                    Lähetä vahvistettavaksi
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                )}
              </Card>

              {/* Quick info */}
              <Card className="p-4 bg-card border-0 premium-shadow">
                <div className="flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Ikkunatyypit tarkistetaan paikan päällä</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Kaikki välineet mukana, ei lisäkuluja</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">Isommille kohteille teemme erillisen tarjouksen</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">25 € aloitusmaksu sisältää matkan ja pesuaineet</p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>

        {/* Order form */}
        {showForm && hasResult && (
          <Card className="mt-6 p-5 bg-card border-0 premium-shadow max-w-lg mx-auto space-y-4">
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
                  <button key={opt.v} type="button"
                    onClick={() => setForm(f => ({ ...f, urgency: f.urgency === opt.v ? "" : opt.v }))}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${form.urgency === opt.v ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}>
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lisätiedot</label>
              <Textarea placeholder="Vapaaehtoinen..." rows={3} className="resize-none text-sm"
                value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
            </div>
            {sendError && <p className="text-xs text-destructive">{sendError}</p>}
            <Button className="w-full h-12 text-sm font-semibold rounded-2xl"
              disabled={sending || !form.name || !form.phone || !form.address} onClick={handleSend}>
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Lähetetään...</> : <><Send className="w-4 h-4 mr-2" />Lähetä vahvistettavaksi</>}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
