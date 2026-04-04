import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Minus, Plus, Send, Loader2, CheckCircle2, Info } from "lucide-react";

// ─── SVG illustrations — blue glass, shine lines, handles ────────────────────
// Glass color constant — light blue used throughout
const G = "#bfdbfe"; // glass fill
const G2 = "#dbeafe"; // lighter glass
const FR = "#f1f5f9"; // frame fill (light)
const shine = (x1: number, y1: number, x2: number, y2: number, k: number) =>
  <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeOpacity=".75"/>;

// 2-pintainen ikkuna — two side-by-side panes, front view
const Svg2Pin = () => (
  <svg viewBox="0 0 84 70" fill="none" className="w-full h-full">
    <rect x="2" y="2" width="80" height="66" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    <rect x="7" y="7" width="32" height="56" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    <rect x="45" y="7" width="32" height="56" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    <rect x="39" y="2" width="6" height="66" fill={FR} stroke="currentColor" strokeWidth="1"/>
    {shine(13,11,24,22,0)}{shine(18,11,29,22,1)}
    {shine(51,11,62,22,2)}{shine(56,11,67,22,3)}
  </svg>
);

// Tuuletusikkuna kahvalla — main pane + small top vent with handle
const SvgVentilation = () => (
  <svg viewBox="0 0 72 72" fill="none" className="w-full h-full">
    <rect x="2" y="2" width="68" height="68" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    <rect x="7" y="7" width="58" height="40" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    <rect x="7" y="52" width="58" height="13" rx="1" fill={G2} stroke="currentColor" strokeWidth="1.8"/>
    <line x1="7" y1="51" x2="65" y2="51" stroke="currentColor" strokeWidth="2"/>
    <rect x="32" y="55" width="8" height="4" rx="1" fill="currentColor" fillOpacity=".5"/>
    {shine(13,11,22,20,0)}{shine(18,11,27,20,1)}{shine(23,11,32,20,2)}
  </svg>
);

// Avautuva 4-pintainen — casement window open to left, frame depth visible
const Svg4Pin = () => (
  <svg viewBox="0 0 84 76" fill="none" className="w-full h-full">
    {/* Fixed outer frame */}
    <rect x="2" y="2" width="60" height="72" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    {/* Right-side depth (frame thickness) */}
    <path d="M62 2 L80 8 L80 66 L62 72 Z" fill={FR} stroke="currentColor" strokeWidth="1.5"/>
    <line x1="71" y1="5" x2="71" y2="69" stroke="currentColor" strokeWidth="1"/>
    {/* Glass pane */}
    <rect x="8" y="8" width="48" height="60" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Handle */}
    <rect x="52" y="32" width="5" height="12" rx="2" fill="currentColor" fillOpacity=".6"/>
    <rect x="54" y="35" width="6" height="6" rx="1" fill={FR} stroke="currentColor" strokeWidth="1"/>
    {shine(14,13,26,25,0)}{shine(20,13,32,25,1)}{shine(26,13,38,25,2)}{shine(32,13,44,25,3)}{shine(38,13,50,25,4)}
  </svg>
);

// Avautuva 6-pintainen — double casement, both sashes visible open
const Svg6Pin = () => (
  <svg viewBox="0 0 96 76" fill="none" className="w-full h-full">
    {/* Fixed frame */}
    <rect x="2" y="2" width="92" height="72" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    {/* Left sash */}
    <rect x="7" y="7" width="37" height="62" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Right sash */}
    <rect x="52" y="7" width="37" height="62" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Center divider */}
    <rect x="44" y="2" width="8" height="72" fill={FR} stroke="currentColor" strokeWidth="1"/>
    {/* Left handle */}
    <rect x="40" y="31" width="4" height="14" rx="2" fill="currentColor" fillOpacity=".55"/>
    {/* Right handle */}
    <rect x="52" y="31" width="4" height="14" rx="2" fill="currentColor" fillOpacity=".55"/>
    {shine(11,11,20,20,0)}{shine(16,11,25,20,1)}{shine(21,11,30,20,2)}
    {shine(56,11,65,20,3)}{shine(61,11,70,20,4)}{shine(66,11,75,20,5)}
  </svg>
);

// Ruudukkoikkunat — 3×3 grid of small panes
const SvgGrid = () => (
  <svg viewBox="0 0 78 72" fill="none" className="w-full h-full">
    <rect x="2" y="2" width="74" height="68" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    {/* Vertical dividers */}
    <line x1="28" y1="2" x2="28" y2="70" stroke="currentColor" strokeWidth="2.5"/>
    <line x1="50" y1="2" x2="50" y2="70" stroke="currentColor" strokeWidth="2.5"/>
    {/* Horizontal dividers */}
    <line x1="2" y1="27" x2="76" y2="27" stroke="currentColor" strokeWidth="2.5"/>
    <line x1="2" y1="48" x2="76" y2="48" stroke="currentColor" strokeWidth="2.5"/>
    {/* All 9 panes */}
    {[[7,7,17,16],[31,7,15,16],[54,7,18,16],
      [7,31,17,13],[31,31,15,13],[54,31,18,13],
      [7,52,17,14],[31,52,15,14],[54,52,18,14]].map(([x,y,w,h],i) => (
      <rect key={i} x={x} y={y} width={w} height={h} fill={G} stroke="currentColor" strokeWidth="1"/>
    ))}
  </svg>
);

// Parvekelasit — folding accordion balcony glass panels
const SvgBalcony = () => (
  <svg viewBox="0 0 90 66" fill="none" className="w-full h-full">
    <line x1="2" y1="5" x2="88" y2="5" stroke="currentColor" strokeWidth="3.5"/>
    <line x1="2" y1="61" x2="88" y2="61" stroke="currentColor" strokeWidth="3.5"/>
    {/* Panel 1 — slightly angled (open) */}
    <path d="M6 5 L18 8 L18 58 L6 61 Z" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Panel 2 */}
    <rect x="18" y="5" width="16" height="56" fill={G2} stroke="currentColor" strokeWidth="1.8"/>
    {/* Panel 3 */}
    <rect x="36" y="5" width="16" height="56" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Panel 4 */}
    <rect x="54" y="5" width="16" height="56" fill={G2} stroke="currentColor" strokeWidth="1.8"/>
    {/* Panel 5 — angled edge */}
    <path d="M70 5 L84 8 L84 58 L70 61 Z" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Open arrow hint */}
    <path d="M22 28 L28 33 L22 38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

// Terassilasit — wide sliding terrace glass
const SvgTerrace = () => (
  <svg viewBox="0 0 96 58" fill="none" className="w-full h-full">
    <line x1="2" y1="4" x2="94" y2="4" stroke="currentColor" strokeWidth="3.5"/>
    <line x1="2" y1="54" x2="94" y2="54" stroke="currentColor" strokeWidth="3.5"/>
    <rect x="4" y="4" width="20" height="50" fill={G} stroke="currentColor" strokeWidth="2"/>
    <rect x="26" y="4" width="20" height="50" fill={G2} stroke="currentColor" strokeWidth="2"/>
    <rect x="48" y="4" width="20" height="50" fill={G} stroke="currentColor" strokeWidth="2"/>
    <rect x="70" y="4" width="22" height="50" fill={G2} stroke="currentColor" strokeWidth="2"/>
    {/* Sliding arrows */}
    <path d="M30 25 L36 29 L30 33" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    <path d="M66 25 L60 29 L66 33" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    {shine(8,8,16,16,0)}{shine(50,8,58,16,1)}
  </svg>
);

// Lasikaide — glass railing with handrail and floor mount
const SvgRailing = () => (
  <svg viewBox="0 0 88 58" fill="none" className="w-full h-full">
    {/* Top rail */}
    <rect x="2" y="6" width="84" height="6" rx="3" fill={FR} stroke="currentColor" strokeWidth="2"/>
    {/* Glass panel */}
    <rect x="6" y="12" width="76" height="32" fill={G} stroke="currentColor" strokeWidth="1.5"/>
    {/* Bottom mount */}
    <rect x="2" y="44" width="84" height="7" rx="2" fill={FR} stroke="currentColor" strokeWidth="2"/>
    {/* Vertical posts */}
    <rect x="6" y="6" width="4" height="45" fill={FR} stroke="currentColor" strokeWidth="1.5"/>
    <rect x="78" y="6" width="4" height="45" fill={FR} stroke="currentColor" strokeWidth="1.5"/>
    {shine(14,16,28,28,0)}{shine(22,16,36,28,1)}{shine(30,16,44,28,2)}
  </svg>
);

// Pesu jatkovarrella — window + long extension pole from outside
const SvgPole = () => (
  <svg viewBox="0 0 84 72" fill="none" className="w-full h-full">
    {/* Wall section */}
    <rect x="2" y="2" width="52" height="62" rx="2" fill="#f8fafc" stroke="currentColor" strokeWidth="2"/>
    {/* Window opening */}
    <rect x="8" y="8" width="40" height="50" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Window frame cross */}
    <line x1="28" y1="8" x2="28" y2="58" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="8" y1="33" x2="48" y2="33" stroke="currentColor" strokeWidth="1.5"/>
    {/* Extension pole */}
    <line x1="56" y1="68" x2="66" y2="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    {/* Squeegee head */}
    <rect x="60" y="6" width="14" height="7" rx="2" fill={FR} stroke="currentColor" strokeWidth="2"/>
    <line x1="60" y1="9.5" x2="74" y2="9.5" stroke="currentColor" strokeWidth="1.5"/>
    {shine(12,12,20,20,0)}{shine(32,12,40,20,1)}
  </svg>
);

// Peili — rectangular mirror with thick frame, diagonal shine
const SvgMirror = () => (
  <svg viewBox="0 0 72 72" fill="none" className="w-full h-full">
    {/* Outer frame */}
    <rect x="8" y="4" width="56" height="60" rx="4" fill={FR} stroke="currentColor" strokeWidth="3"/>
    {/* Mirror glass */}
    <rect x="16" y="12" width="40" height="44" rx="1" fill="#e0f2fe" stroke="currentColor" strokeWidth="1.5"/>
    {/* Shine diagonals — more prominent for mirror */}
    <line x1="22" y1="16" x2="44" y2="38" stroke="white" strokeWidth="3" strokeOpacity=".8" strokeLinecap="round"/>
    <line x1="30" y1="16" x2="52" y2="38" stroke="white" strokeWidth="2" strokeOpacity=".6" strokeLinecap="round"/>
    <line x1="22" y1="24" x2="34" y2="36" stroke="white" strokeWidth="1.5" strokeOpacity=".5" strokeLinecap="round"/>
    {/* Wall mount bracket */}
    <line x1="28" y1="64" x2="44" y2="64" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

// Ovi — glass door with frame, upper glass panel, handle
const SvgDoor = () => (
  <svg viewBox="0 0 66 80" fill="none" className="w-full h-full">
    {/* Door frame */}
    <rect x="2" y="2" width="62" height="76" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    {/* Upper glass panel */}
    <rect x="10" y="8" width="46" height="34" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Lower panel */}
    <rect x="10" y="48" width="46" height="24" rx="1" fill={FR} stroke="currentColor" strokeWidth="1.5"/>
    {/* Horizontal cross in lower panel */}
    <line x1="10" y1="60" x2="56" y2="60" stroke="currentColor" strokeWidth="1"/>
    <line x1="33" y1="48" x2="33" y2="72" stroke="currentColor" strokeWidth="1"/>
    {/* Handle */}
    <rect x="46" y="36" width="6" height="12" rx="3" fill="currentColor" fillOpacity=".55"/>
    <rect x="44" y="43" width="10" height="4" rx="2" fill={FR} stroke="currentColor" strokeWidth="1.2"/>
    {shine(15,12,26,23,0)}{shine(21,12,32,23,1)}{shine(27,12,38,23,2)}
  </svg>
);

// Kylpyhuoneen lasi — frameless shower glass panel(s)
const SvgBathroom = () => (
  <svg viewBox="0 0 80 72" fill="none" className="w-full h-full">
    {/* Wall bar */}
    <rect x="2" y="2" width="8" height="68" rx="2" fill={FR} stroke="currentColor" strokeWidth="2"/>
    {/* Fixed panel */}
    <rect x="12" y="4" width="26" height="64" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    {/* Hinged door panel (slightly open) */}
    <path d="M40 4 L68 8 L68 64 L40 68 Z" fill={G2} stroke="currentColor" strokeWidth="1.8"/>
    {/* Hinge dots */}
    <circle cx="40" cy="18" r="2.5" fill="currentColor" fillOpacity=".5"/>
    <circle cx="40" cy="54" r="2.5" fill="currentColor" fillOpacity=".5"/>
    {/* Handle on door */}
    <rect x="62" y="32" width="4" height="10" rx="2" fill="currentColor" fillOpacity=".5"/>
    {shine(16,8,24,16,0)}{shine(44,10,54,20,1)}
  </svg>
);

// Sälekaihdinten puhdistus — window with horizontal slat blinds
const SvgBlinds = () => (
  <svg viewBox="0 0 78 70" fill="none" className="w-full h-full">
    <rect x="2" y="2" width="74" height="66" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    {/* Pull cord at top */}
    <line x1="28" y1="2" x2="28" y2="10" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="38" y1="2" x2="38" y2="10" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="48" y1="2" x2="48" y2="10" stroke="currentColor" strokeWidth="1.5"/>
    {/* Valance bar */}
    <rect x="7" y="10" width="64" height="5" rx="1" fill={FR} stroke="currentColor" strokeWidth="1.5"/>
    {/* Slats */}
    {[18,26,34,42,50,58].map(y => (
      <rect key={y} x="7" y={y} width="64" height="5" rx="1"
        fill="#e0e7ef" stroke="currentColor" strokeWidth="1.2"/>
    ))}
  </svg>
);

// Avautuva ikkuna 3–5 m — window up high + step ladder beside it
const SvgHighWindow = () => (
  <svg viewBox="0 0 84 76" fill="none" className="w-full h-full">
    {/* Window */}
    <rect x="28" y="2" width="48" height="44" rx="3" fill={FR} stroke="currentColor" strokeWidth="2.5"/>
    <rect x="34" y="8" width="36" height="32" rx="1" fill={G} stroke="currentColor" strokeWidth="1.8"/>
    <line x1="52" y1="8" x2="52" y2="40" stroke="currentColor" strokeWidth="1.5"/>
    {/* Handle */}
    <rect x="49" y="22" width="5" height="9" rx="2" fill="currentColor" fillOpacity=".5"/>
    {/* Step ladder */}
    <line x1="6" y1="74" x2="20" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="24" y1="74" x2="18" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    <line x1="7" y1="68" x2="23" y2="68" stroke="currentColor" strokeWidth="2"/>
    <line x1="9" y1="58" x2="22" y2="58" stroke="currentColor" strokeWidth="2"/>
    <line x1="11" y1="48" x2="21" y2="48" stroke="currentColor" strokeWidth="2"/>
    <line x1="13" y1="38" x2="20" y2="38" stroke="currentColor" strokeWidth="2"/>
    <line x1="15" y1="28" x2="19" y2="28" stroke="currentColor" strokeWidth="1.5"/>
    {shine(38,11,46,19,0)}{shine(43,11,51,19,1)}
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
