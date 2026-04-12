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
  { key: "small",  label: "Pikkuauto",      sub: "Hatchback, city-auto", price: 30 },
  { key: "medium", label: "Keskikokoinen",  sub: "Sedan, pieni SUV",     price: 40 },
  { key: "large",  label: "Iso auto",       sub: "SUV, tila-auto, vm",   price: 50 },
] as const;
type CarSize = (typeof CAR_SIZES)[number]["key"];

const CAR_INCLUDES = [
  "Imurointi",
  "Kojelaudan ja pintojen puhdistus",
  "Ovien sisäpinnat",
  "Keskikonsoli",
  "Auton sisäikkunoiden kevyt putsaus",
];

// ─── NELIÖHINNAT (per-m² pricing) ────────────────────────────────────────────
// Base prices for "Kaikkien pintojen pesu" (sisä + ulko). Aggressive — clearly under competitor.
// Competitor ikkunanpesu.com: omakoti 189–799, rivitalo 129–349, kerrostalo 149–449.

const HOUSE_TYPES = [
  { key: "omakoti",   label: "Omakotitalo",    sub: "Erillistalo" },
  { key: "paritalo",  label: "Paritalo",       sub: "2 huoneistoa" },
  { key: "rivitalo",  label: "Rivitalo",       sub: "Oma huoneisto" },
  { key: "kerrostalo",label: "Kerrostalo",     sub: "Huoneisto" },
] as const;
type HouseKey = (typeof HOUSE_TYPES)[number]["key"];

// Square meter ranges with base "kaikki pinnat" price
// Prices set below competitor + kotitalousvähennys shown as headline in UI
const SQM_RANGES: Record<HouseKey, { label: string; price: number }[]> = {
  omakoti: [
    { label: "alle 60 m²",     price: 139 },
    { label: "60–80 m²",       price: 169 },
    { label: "80–100 m²",      price: 199 },
    { label: "100–120 m²",     price: 229 },
    { label: "120–140 m²",     price: 269 },
    { label: "140–160 m²",     price: 309 },
    { label: "160–180 m²",     price: 349 },
    { label: "180–200 m²",     price: 389 },
    { label: "200–220 m²",     price: 439 },
    { label: "220–240 m²",     price: 489 },
    { label: "240–260 m²",     price: 549 },
    { label: "260–280 m²",     price: 609 },
    { label: "yli 280 m²",     price: 669 },
  ],
  paritalo: [
    { label: "alle 60 m²",     price: 139 },
    { label: "60–80 m²",       price: 169 },
    { label: "80–100 m²",      price: 199 },
    { label: "100–120 m²",     price: 229 },
    { label: "120–140 m²",     price: 269 },
    { label: "140–160 m²",     price: 309 },
    { label: "160–180 m²",     price: 349 },
    { label: "180–200 m²",     price: 389 },
    { label: "200–220 m²",     price: 439 },
    { label: "220–240 m²",     price: 489 },
    { label: "240–260 m²",     price: 549 },
    { label: "260–280 m²",     price: 609 },
    { label: "yli 280 m²",     price: 669 },
  ],
  rivitalo: [
    { label: "alle 40 m²",     price:  89 },
    { label: "40–60 m²",       price: 109 },
    { label: "60–80 m²",       price: 129 },
    { label: "80–100 m²",      price: 149 },
    { label: "100–120 m²",     price: 169 },
    { label: "120–140 m²",     price: 199 },
    { label: "140–160 m²",     price: 229 },
    { label: "yli 160 m²",     price: 279 },
  ],
  kerrostalo: [
    { label: "alle 40 m²",     price:  99 },
    { label: "40–60 m²",       price: 119 },
    { label: "60–80 m²",       price: 149 },
    { label: "80–100 m²",      price: 179 },
    { label: "100–120 m²",     price: 209 },
    { label: "120–140 m²",     price: 249 },
    { label: "yli 140 m²",     price: 329 },
  ],
};

const SERVICE_TIERS = [
  { key: "all",      label: "Kaikkien pintojen pesu",  sub: "Sisä + ulko",           mult: 1.00 },
  { key: "outside",  label: "Vain ulkopintojen pesu",  sub: "Nopea ja edullinen",    mult: 0.58 },
  { key: "annual",   label: "Vuosipaketti (2×/v)",     sub: "10 % alennus",          mult: 1.80 },
] as const;
type TierKey = (typeof SERVICE_TIERS)[number]["key"];

const ADDONS = [
  { key: "balcony",  label: "Parveke-/terassilasitus", price: 39 },
  { key: "railing",  label: "Lasikaide",               price: 39 },
  { key: "mirror",   label: "Peilien pesu",            price: 19 },
  { key: "canopy",   label: "Terassin lasikate",       price: 89 },
  { key: "gutter",   label: "Rännien puhdistus",       price: 69 },
] as const;
type AddonKey = (typeof ADDONS)[number]["key"];

// Regional multipliers by postal-code prefix
// Wealth score → price multiplier mapping.
// Score 1.0 (Westend) = premium market → ×1.22
// Score 0.55 (keskiluokka) = volume market → ×0.80
// Score by neighborhood sourced from market analysis.
const AREA_TABLE: Record<string, { mult: number; label: string }> = {
  // ── Ultra-premium (score 0.95–1.0) ────────────────────────────────────────
  "02160": { mult: 1.22, label: "Westend" },           // score 1.0 — Suomen kalleimpia
  "00340": { mult: 1.18, label: "Kuusisaari" },        // score 0.95 — diplomaatti/luksus
  "02380": { mult: 1.15, label: "Suvisaaristo" },      // score 0.90 — uniikki saaristo
  "00570": { mult: 1.15, label: "Kulosaari" },         // score 0.90 — vanha eliittialue
  "00830": { mult: 1.12, label: "Herttoniemenranta" }, // score 0.87 — merellinen premium
  // ── Premium (score 0.82–0.90) ──────────────────────────────────────────────
  "02170": { mult: 1.10, label: "Haukilahti" },        // score 0.85 — merellinen, arvostettu
  "00140": { mult: 1.10, label: "Kaivopuisto" },       // score 0.88 — yksi Hkin arvostetuimmista
  "00150": { mult: 1.08, label: "Punavuori / Eira" },  // score 0.85
  "00160": { mult: 1.08, label: "Ullanlinna" },        // score 0.85
  "00210": { mult: 1.05, label: "Lehtisaari" },        // score 0.83
  "02100": { mult: 1.05, label: "Tapiola" },           // score 0.82
  "02110": { mult: 1.05, label: "Otaniemi" },
  "02150": { mult: 1.05, label: "Otsolahti" },
  "00170": { mult: 1.05, label: "Kruununhaka" },
  // ── Hyvä / varakas (score 0.70–0.82) ─────────────────────────────────────
  "00330": { mult: 1.00, label: "Munkkiniemi" },       // score 0.75
  "00200": { mult: 0.97, label: "Lauttasaari" },       // score 0.70
  "00250": { mult: 1.02, label: "Töölö" },
  "00270": { mult: 0.98, label: "Pikku-Huopalahti" },
  "00280": { mult: 0.95, label: "Etelä-Haaga" },
  "02120": { mult: 0.97, label: "Laajalahti" },
  "02130": { mult: 0.97, label: "Kanta-Tapiola" },
  "02140": { mult: 0.95, label: "Kivenlahti" },
  "02180": { mult: 0.95, label: "Matinkylä" },
  "02200": { mult: 0.95, label: "Espoo keskus" },
  "02230": { mult: 0.97, label: "Leppävaara" },
  "02360": { mult: 0.95, label: "Espoonlahti" },
  // ── Keskiluokka (score 0.55–0.70) ─────────────────────────────────────────
  "00320": { mult: 0.84, label: "Munkkivuori" },       // score 0.60
  "00300": { mult: 0.87, label: "Pikku-Huopalahti" },
  "00350": { mult: 0.87, label: "Kannelmäki" },
  "00360": { mult: 0.85, label: "Paloheinä" },
  "00370": { mult: 0.85, label: "Pihlajamäki" },
  "00400": { mult: 0.87, label: "Oulunkylä" },
  "00420": { mult: 0.85, label: "Maunula" },
  "00430": { mult: 0.83, label: "Malminkartano" },
  "00440": { mult: 0.84, label: "Lassila" },
  "00500": { mult: 0.87, label: "Sörnäinen" },
  "00510": { mult: 0.87, label: "Alppiharju" },
  "00520": { mult: 0.86, label: "Vanhakaupunki" },
  "00530": { mult: 0.86, label: "Kallio" },
  "00550": { mult: 0.86, label: "Vallila" },
  "00560": { mult: 0.88, label: "Toukola" },
  "00610": { mult: 0.84, label: "Käpylä" },
  "00620": { mult: 0.84, label: "Metsälä" },
  "00630": { mult: 0.83, label: "Maunula" },
  "00640": { mult: 0.82, label: "Oulunkylä" },
  "00650": { mult: 0.83, label: "Viikki" },
  "00660": { mult: 0.83, label: "Latokartano" },
  "00670": { mult: 0.82, label: "Malmi" },
  "00680": { mult: 0.82, label: "Pukinmäki" },
  "00690": { mult: 0.82, label: "Tapanila" },
  "00700": { mult: 0.83, label: "Tapaninkylä" },
  "00710": { mult: 0.83, label: "Pihlajisto" },
  "00720": { mult: 0.82, label: "Puistola" },
  "00730": { mult: 0.82, label: "Jakomäki" },
  "00740": { mult: 0.81, label: "Siltamäki" },
  "00750": { mult: 0.80, label: "Tammisto" },
  "00760": { mult: 0.82, label: "Suutarila" },
  "00770": { mult: 0.82, label: "Tattariharju" },
  "00780": { mult: 0.82, label: "Tapaninvainio" },
  "00790": { mult: 0.82, label: "Torpparinmäki" },
  "00800": { mult: 0.86, label: "Länsi-Herttoniemi" },
  "00810": { mult: 0.84, label: "Roihuvuori" },
  "00820": { mult: 0.84, label: "Itä-Herttoniemi" },
  "00840": { mult: 0.84, label: "Tammisalo" },
  "00850": { mult: 0.85, label: "Vartiokylä" },
  "00860": { mult: 0.84, label: "Marjaniemi" },
  "00870": { mult: 0.84, label: "Mellunmäki" },
  "00880": { mult: 0.83, label: "Kontula" },
  "00890": { mult: 0.82, label: "Vuosaari" },
  "00900": { mult: 0.80, label: "Puotinharju" },
  "00920": { mult: 0.82, label: "Itäkeskus" },
  "00930": { mult: 0.82, label: "Laajasalo" },
  "00940": { mult: 0.82, label: "Roihupelto" },
  "00950": { mult: 0.81, label: "Vartioharju" },
  "00960": { mult: 0.81, label: "Mellunmäki" },
  "00980": { mult: 0.81, label: "Vuosaari" },
  "00990": { mult: 0.80, label: "Sipoo-raja" },
  // Saunalahti & Espoon eteläiset alueet
  "02330": { mult: 0.82, label: "Saunalahti" },        // score 0.55 — uudehko perhealue
  "02340": { mult: 0.82, label: "Suomenoja" },
  "02320": { mult: 0.83, label: "Soukka" },
  "02310": { mult: 0.84, label: "Nöykkiönlaakso" },
  // Vantaa
  "01200": { mult: 0.85, label: "Keimola" },
  "01300": { mult: 0.83, label: "Tikkurila" },
  "01350": { mult: 0.83, label: "Hiekkaharju" },
  "01360": { mult: 0.83, label: "Länsimäki" },
  "01370": { mult: 0.82, label: "Hakunila" },
  "01380": { mult: 0.82, label: "Itä-Hakkila" },
  "01390": { mult: 0.82, label: "Länsimäki" },
  "01400": { mult: 0.84, label: "Vantaankoski" },
  "01420": { mult: 0.85, label: "Myyrmäki" },
  "01450": { mult: 0.85, label: "Myyrmäki" },
  "01480": { mult: 0.83, label: "Martinlaakso" },
  "01490": { mult: 0.82, label: "Varisto" },
  "01600": { mult: 0.84, label: "Vantaa" },
  "01610": { mult: 0.83, label: "Lentokenttä" },
  "01620": { mult: 0.83, label: "Aviapolis" },
  "01630": { mult: 0.83, label: "Pakkala" },
  "01640": { mult: 0.83, label: "Veromies" },
  "01650": { mult: 0.84, label: "Koivuhaka" },
  "01660": { mult: 0.84, label: "Tammisto" },
  "01670": { mult: 0.83, label: "Askisto" },
  "01700": { mult: 0.85, label: "Kaivoksela" },
  "01720": { mult: 0.85, label: "Ylästö" },
  "01730": { mult: 0.84, label: "Petikko" },
  "01740": { mult: 0.84, label: "Vantaa" },
  "01800": { mult: 0.84, label: "Klaukkala" },
};

function regionMultiplier(pc: string): { mult: number; label: string } {
  const p = pc.trim();
  if (!/^\d{5}$/.test(p)) return { mult: 1.00, label: "Pääkaupunkiseutu" };
  // Exact match first
  if (AREA_TABLE[p]) return AREA_TABLE[p];
  // Helsinki kantakaupunki fallback (001xx)
  if (p.startsWith("001")) return { mult: 1.05, label: "Helsinki kantakaupunki" };
  if (p.startsWith("002")) return { mult: 0.97, label: "Helsinki länsi" };
  // Muu Helsinki
  if (p.startsWith("00")) return { mult: 0.84, label: "Helsinki" };
  // Muu Espoo
  if (p.startsWith("02")) return { mult: 0.88, label: "Espoo" };
  // Kauniainen
  if (p.startsWith("028")) return { mult: 1.02, label: "Kauniainen" };
  // Vantaa fallback
  if (p.startsWith("01")) return { mult: 0.83, label: "Vantaa" };
  // Kauempi (Kirkkonummi, Järvenpää, jne.)
  return { mult: 0.78, label: "Muu alue" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LaskuriPage() {
  const [tab, setTab] = useState<"ikkunat" | "auto" | "nelio">("nelio");
  const [counts, setCounts] = useState<Record<WindowKey, number>>(
    Object.fromEntries(WINDOW_TYPES.map(t => [t.key, 0])) as Record<WindowKey, number>
  );
  const [carSize, setCarSize] = useState<CarSize | null>(null);

  // Neliöhinnat state
  const [postalCode, setPostalCode] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("pp_postal") || "";
  });
  const [showPcModal, setShowPcModal] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return !window.localStorage.getItem("pp_postal");
  });
  const [pcInput, setPcInput] = useState("");
  const [houseType, setHouseType] = useState<HouseKey>("omakoti");
  const [sqmIdx, setSqmIdx] = useState<number | null>(null);
  const [tier, setTier] = useState<TierKey>("all");
  const [addons, setAddons] = useState<Record<AddonKey, boolean>>(
    Object.fromEntries(ADDONS.map(a => [a.key, false])) as Record<AddonKey, boolean>
  );
  const [kvEligible, setKvEligible] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { name: "", phone: "", email: "", address: "", urgency: "" as "" | "this_week" | "flexible", message: "", coupon: params.get("ref") || "" };
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");

  // Calculations
  const windowSubtotal = WINDOW_TYPES.reduce((s, t) => s + t.price * counts[t.key], 0);
  const windowTotal = Math.max(windowSubtotal + (windowSubtotal > 0 ? START_FEE : 0), windowSubtotal > 0 ? MIN_ORDER : 0);
  const carPrice = carSize ? CAR_SIZES.find(c => c.key === carSize)!.price : 0;

  // Neliö calculations
  const region = regionMultiplier(postalCode);
  const sqmBase = sqmIdx !== null ? SQM_RANGES[houseType][sqmIdx].price : 0;
  const tierObj = SERVICE_TIERS.find(t => t.key === tier)!;
  const sqmTiered = Math.round(sqmBase * tierObj.mult);
  const addonsTotal = ADDONS.reduce((s, a) => s + (addons[a.key] ? a.price : 0), 0);
  const sqmPreRegion = sqmTiered + addonsTotal;
  const sqmTotal = Math.round(sqmPreRegion * region.mult);

  const activeTotal = tab === "ikkunat" ? windowTotal : tab === "auto" ? carPrice : sqmTotal;
  const hasResult = tab === "ikkunat" ? windowSubtotal > 0 : tab === "auto" ? carSize !== null : sqmIdx !== null;
  const kotitalous = kvEligible ? Math.round(activeTotal * KOTITALOUS_PCT) : 0;
  const afterKotitalous = activeTotal - kotitalous;

  const selectedWindows = WINDOW_TYPES.filter(t => counts[t.key] > 0);

  const adjust = (key: WindowKey, d: number) =>
    setCounts(p => ({ ...p, [key]: Math.max(0, p[key] + d) }));

  const handleSend = async () => {
    if (!form.name || !form.phone || !form.address) return;
    setSending(true); setSendError("");
    try {
      const houseLabel = HOUSE_TYPES.find(h => h.key === houseType)?.label;
      const sqmLabel = sqmIdx !== null ? SQM_RANGES[houseType][sqmIdx].label : "";
      const addonsList = ADDONS.filter(a => addons[a.key]).map(a => a.label).join(", ") || "—";
      const serviceDesc = tab === "ikkunat"
        ? selectedWindows.map(t => `${t.label}: ${counts[t.key]} ${t.unit}`).join(", ")
        : tab === "auto"
        ? `Sisäfreesaus — ${CAR_SIZES.find(c => c.key === carSize)?.label} (${carPrice} €). Sisältää: ${CAR_INCLUDES.join(", ")}.`
        : `Neliöhinta — ${houseLabel} ${sqmLabel}, ${tierObj.label}. Lisät: ${addonsList}. Alue: ${region.label} (${region.mult}×). Postinumero: ${postalCode || "—"}`;
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
          Alennuskoodi: form.coupon || "—",
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
      {/* Postal code modal */}
      {showPcModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 bg-card border-0 premium-shadow space-y-4" data-testid="postal-modal">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Missä asut?</h2>
              <p className="text-xs text-muted-foreground">Postinumeron perusteella tarkennamme hinta-arviota alueellesi.</p>
            </div>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="02100"
              value={pcInput}
              onChange={e => setPcInput(e.target.value.replace(/\D/g, "").slice(0, 5))}
              className="text-center text-lg font-semibold tabular-nums h-12"
              data-testid="postal-input"
              autoFocus
            />
            {pcInput.length === 5 && (
              <p className="text-xs text-center text-muted-foreground">
                {regionMultiplier(pcInput).label}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowPcModal(false); if (typeof window !== "undefined") window.localStorage.setItem("pp_postal", postalCode || ""); }}
              >
                Ohita
              </Button>
              <Button
                className="flex-1"
                disabled={pcInput.length !== 5}
                onClick={() => {
                  setPostalCode(pcInput);
                  if (typeof window !== "undefined") window.localStorage.setItem("pp_postal", pcInput);
                  setShowPcModal(false);
                }}
                data-testid="postal-confirm"
              >
                Vahvista
              </Button>
            </div>
          </Card>
        </div>
      )}

      <div className="container mx-auto px-4 max-w-5xl">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">Hinta-arvio</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Laske suuntaa-antava hinta. Isommille kohteille teemme aina erillisen tarjouksen paikan päällä.
          </p>
        </div>

        {/* Tab */}
        <div className="flex rounded-2xl bg-muted p-1 mb-6 max-w-xl mx-auto">
          {(["nelio", "ikkunat", "auto"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
              className={`flex-1 py-2.5 px-2 rounded-xl text-xs md:text-sm font-medium transition-all ${tab === t ? "bg-card premium-shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "nelio" ? "Neliöhinnat" : t === "ikkunat" ? "Ikkuna­laskuri" : "Sisä­freesaus"}
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

            {/* ── NELIÖHINNAT ── */}
            {tab === "nelio" && (
              <div className="space-y-5">
                {/* Postal code bar + KV toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPcInput(postalCode); setShowPcModal(true); }}
                    className="flex-1 p-3 rounded-2xl border border-border bg-card hover:border-primary/50 flex items-center justify-between transition-all"
                    data-testid="postal-bar"
                  >
                    <div className="text-left">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Alue</p>
                      <p className="text-sm font-semibold text-foreground">
                        {postalCode ? `${postalCode} · ${region.label}` : "Syötä postinumero"}
                      </p>
                    </div>
                    <span className="text-xs text-primary font-medium">
                      {postalCode ? (region.mult === 1 ? "Vakio" : region.mult > 1 ? `+${Math.round((region.mult-1)*100)} %` : `−${Math.round((1-region.mult)*100)} %`) : "Muuta"}
                    </span>
                  </button>

                  {/* Kotitalousvähennys toggle */}
                  <button
                    onClick={() => setKvEligible(v => !v)}
                    className={`p-3 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 min-w-[80px] transition-all ${kvEligible ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                    data-testid="kv-toggle"
                    title="Kotitalousvähennys"
                  >
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${kvEligible ? "bg-primary" : "bg-muted-foreground/30"}`}>
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all shadow-sm ${kvEligible ? "left-4" : "left-0.5"}`} />
                    </div>
                    <p className="text-[9px] font-medium leading-tight text-center">
                      {kvEligible ? <span className="text-primary">Kotitalous­väh.</span> : <span className="text-muted-foreground">Ei väh.</span>}
                    </p>
                  </button>
                </div>

                {/* House type */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Talotyyppi</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {HOUSE_TYPES.map(({ key, label, sub }) => (
                      <button key={key}
                        onClick={() => { setHouseType(key); setSqmIdx(null); }}
                        className={`p-3 rounded-2xl border-2 text-center transition-all ${houseType === key ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                        data-testid={`house-${key}`}
                      >
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Square meters */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Kohteen koko</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {SQM_RANGES[houseType].map((r, i) => {
                      const fullPrice = Math.round(r.price * region.mult);
                      const afterKv = Math.round(fullPrice * (1 - KOTITALOUS_PCT));
                      const displayPrice = kvEligible ? afterKv : fullPrice;
                      return (
                        <button key={i}
                          onClick={() => setSqmIdx(i)}
                          className={`p-2.5 rounded-xl border-2 text-left transition-all ${sqmIdx === i ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                          data-testid={`sqm-${i}`}
                        >
                          <p className="text-xs font-semibold text-foreground">{r.label}</p>
                          <p className="text-sm font-bold text-primary mt-0.5">
                            {kvEligible ? "~" : ""}{displayPrice} €{kvEligible && <span className="text-[9px] font-normal text-primary/70 ml-0.5">*</span>}
                          </p>
                          {kvEligible && <p className="text-[9px] text-muted-foreground leading-tight">norm. {fullPrice} €</p>}
                        </button>
                      );
                    })}
                  </div>
                  {kvEligible && (
                    <p className="text-[10px] text-muted-foreground mt-2">
                      <span className="text-primary font-medium">*</span> Kotitalousvähennyksellä (35 %) maksat vain noin kaksi kolmasosaa — vähennys tehdään verotuksessa automaattisesti.
                    </p>
                  )}
                </div>

                {/* Service tier */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Palvelu</p>
                  <div className="space-y-2">
                    {SERVICE_TIERS.map(({ key, label, sub, mult }) => (
                      <button key={key}
                        onClick={() => setTier(key)}
                        className={`w-full p-3.5 rounded-2xl border-2 text-left flex items-center gap-3 transition-all ${tier === key ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                        data-testid={`tier-${key}`}
                      >
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${tier === key ? "bg-primary" : "bg-muted-foreground/30"}`} />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">{sub}</p>
                        </div>
                        {sqmIdx !== null && (() => {
                          const full = Math.round(sqmBase * mult * region.mult);
                          const kv = Math.round(full * (1 - KOTITALOUS_PCT));
                          const display = kvEligible ? kv : full;
                          return (
                            <div className="text-right">
                              <p className="text-sm font-bold text-primary">
                                {kvEligible ? "~" : ""}{display} €{kvEligible && <span className="text-[9px] font-normal ml-0.5">*</span>}
                              </p>
                              {kvEligible && <p className="text-[9px] text-muted-foreground">{full} €</p>}
                            </div>
                          );
                        })()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Add-ons */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Lisäpalvelut</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {ADDONS.map(({ key, label, price }) => (
                      <button key={key}
                        onClick={() => setAddons(p => ({ ...p, [key]: !p[key] }))}
                        className={`p-3 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all ${addons[key] ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
                        data-testid={`addon-${key}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${addons[key] ? "border-primary bg-primary" : "border-muted-foreground/40"}`}>
                            {addons[key] && <CheckCircle2 className="w-3 h-3 text-white" />}
                          </div>
                          <span className="text-xs font-medium text-foreground">{label}</span>
                        </div>
                        <span className="text-xs font-semibold text-primary">+{price} €</span>
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  Suuntaa-antava arvio. Lopullinen hinta vahvistetaan katselmuksen jälkeen.
                </p>
              </div>
            )}

            {/* ── SISÄFREESAUS ── */}
            {tab === "auto" && (
              <div className="space-y-5">
                {/* Header badge */}
                <div className="rounded-2xl bg-primary/5 border border-primary/20 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/70 mb-0.5">Puuhapatet × KJ Cardetailing</p>
                  <p className="text-base font-bold text-foreground">Sisäfreesaus</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Kevyt ja vaivaton auton sisäpuhdistus · 20–30 min · Kuivapesu</p>
                </div>

                {/* Car size picker */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-3">Valitse autosi koko</p>
                  <div className="grid grid-cols-3 gap-3">
                    {CAR_SIZES.map(({ key, label, sub, price }) => (
                      <button key={key} onClick={() => setCarSize(key)}
                        className={`p-3.5 rounded-2xl border-2 text-center transition-all ${carSize === key ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}>
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>
                        <p className="text-lg font-bold text-primary mt-2">{price} €</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* What's included */}
                <div className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Sisältää</p>
                  <ul className="space-y-2">
                    {CAR_INCLUDES.map((item, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-sm text-foreground">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="text-[10px] text-muted-foreground text-center">
                  Varaa aika soittamalla tai laskurin kautta — tulemme luoksesi.
                </p>
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
                      <span className="text-muted-foreground">Sisäfreesaus · {CAR_SIZES.find(c => c.key === carSize)?.label}</span>
                      <span className="text-foreground font-medium">{carPrice} €</span>
                    </div>
                  </div>
                )}

                {tab === "nelio" && sqmIdx !== null && (
                  <div className="space-y-1.5 mb-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground truncate mr-2">
                        {HOUSE_TYPES.find(h => h.key === houseType)?.label} · {SQM_RANGES[houseType][sqmIdx].label}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{tierObj.label}</span>
                      <span className="text-foreground font-medium">{sqmTiered} €</span>
                    </div>
                    {ADDONS.filter(a => addons[a.key]).map(a => (
                      <div key={a.key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground truncate mr-2">{a.label}</span>
                        <span className="text-foreground font-medium">+{a.price} €</span>
                      </div>
                    ))}
                    {region.mult !== 1 && (
                      <div className="flex justify-between text-xs border-t border-border pt-1.5 mt-1.5">
                        <span className="text-muted-foreground">Alue ({region.label})</span>
                        <span className="text-foreground font-medium">{region.mult > 1 ? "+" : ""}{Math.round((region.mult - 1) * 100)} %</span>
                      </div>
                    )}
                  </div>
                )}

                {hasResult && (
                  <div className="border-t border-border pt-3 space-y-2">
                    <div className="bg-primary/5 rounded-xl px-3 py-2.5 text-center">
                      {kvEligible ? (
                        <>
                          <p className="text-[10px] text-muted-foreground mb-0.5">Maksat kotitalousväh. jälkeen</p>
                          <p className="text-2xl font-bold text-primary">~{afterKotitalous} €</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Väh. {kotitalous} € verotuksessa automaattisesti</p>
                        </>
                      ) : (
                        <>
                          <p className="text-[10px] text-muted-foreground mb-0.5">Hinta-arvio (sis. ALV)</p>
                          <p className="text-2xl font-bold text-primary">{activeTotal} €</p>
                        </>
                      )}
                    </div>
                    {kvEligible && (
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-muted-foreground">Normaali hinta (sis. ALV)</span>
                        <span className="text-xs font-medium text-muted-foreground line-through">{activeTotal} €</span>
                      </div>
                    )}
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
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Alennuskoodi <span className="text-muted-foreground font-normal">(vapaaehtoinen)</span>
              </label>
              <Input
                placeholder="esim. MATTI-X4Z"
                value={form.coupon}
                onChange={e => setForm(f => ({ ...f, coupon: e.target.value.toUpperCase() }))}
                className="font-mono tracking-wider text-sm"
              />
              {form.coupon && (
                <p className="text-xs text-primary mt-1">Koodi lisätty — 5 % alennus vahvistetaan yhteydenoton yhteydessä.</p>
              )}
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
