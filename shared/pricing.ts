/**
 * Window-cleaning quick-quote pricing — used by the marketer offer tool
 * (client/src/pages/admin/sell.tsx). Numbers mirror the public calculator
 * (client/src/pages/laskuri.tsx); keep them in sync if the public prices change.
 *
 * A door-to-door estimate is intentionally simpler than the full public laskuri
 * (no car wash / lawn / annual package): house type + size + surfaces + height
 * + an area uplift + a few add-ons.
 */

export type HouseKey = "omakoti" | "paritalo" | "rivitalo" | "kerrostalo";

export const HOUSE_TYPES: { key: HouseKey; label: string }[] = [
  { key: "omakoti", label: "Omakotitalo" },
  { key: "paritalo", label: "Paritalo" },
  { key: "rivitalo", label: "Rivitalo" },
  { key: "kerrostalo", label: "Kerrostalo" },
];

// Base price for "kaikki pinnat" (sisä + ulko), euros.
export const SQM_RANGES: Record<HouseKey, { label: string; price: number }[]> = {
  omakoti: [
    { label: "alle 60 m²", price: 139 }, { label: "60–80 m²", price: 169 },
    { label: "80–100 m²", price: 199 }, { label: "100–120 m²", price: 229 },
    { label: "120–140 m²", price: 269 }, { label: "140–160 m²", price: 309 },
    { label: "160–180 m²", price: 349 }, { label: "180–200 m²", price: 389 },
    { label: "200–220 m²", price: 439 }, { label: "220–240 m²", price: 489 },
    { label: "240–260 m²", price: 549 }, { label: "260–280 m²", price: 609 },
    { label: "yli 280 m²", price: 669 },
  ],
  paritalo: [
    { label: "alle 60 m²", price: 139 }, { label: "60–80 m²", price: 169 },
    { label: "80–100 m²", price: 199 }, { label: "100–120 m²", price: 229 },
    { label: "120–140 m²", price: 269 }, { label: "140–160 m²", price: 309 },
    { label: "160–180 m²", price: 349 }, { label: "180–200 m²", price: 389 },
    { label: "200–220 m²", price: 439 }, { label: "220–240 m²", price: 489 },
    { label: "240–260 m²", price: 549 }, { label: "260–280 m²", price: 609 },
    { label: "yli 280 m²", price: 669 },
  ],
  rivitalo: [
    { label: "alle 40 m²", price: 99 }, { label: "40–60 m²", price: 119 },
    { label: "60–80 m²", price: 149 }, { label: "80–100 m²", price: 179 },
    { label: "100–120 m²", price: 209 }, { label: "120–140 m²", price: 249 },
    { label: "140–160 m²", price: 369 }, { label: "160–180 m²", price: 389 },
    { label: "180–200 m²", price: 409 }, { label: "yli 200 m²", price: 449 },
  ],
  kerrostalo: [
    { label: "alle 40 m²", price: 99 }, { label: "40–60 m²", price: 119 },
    { label: "60–80 m²", price: 149 }, { label: "80–100 m²", price: 179 },
    { label: "100–120 m²", price: 209 }, { label: "120–140 m²", price: 249 },
    { label: "140–160 m²", price: 369 }, { label: "160–180 m²", price: 389 },
    { label: "180–200 m²", price: 409 }, { label: "yli 200 m²", price: 449 },
  ],
};

export const SERVICE_TIERS = [
  { key: "all", label: "Kaikki pinnat (sisä + ulko)", mult: 1.0 },
  { key: "outside", label: "Vain ulkopinnat", mult: 0.58 },
] as const;
export type TierKey = (typeof SERVICE_TIERS)[number]["key"];

export const HEIGHT_OPTS = [
  { key: "ground", label: "Maantaso", mult: 1.0 },
  { key: "ladder", label: "Tikastus", mult: 1.2 },
  { key: "second", label: "2. kerros+", mult: 1.4 },
] as const;
export type HeightKey = (typeof HEIGHT_OPTS)[number]["key"];

// "Assess the location": a simple area uplift the marketer picks from what they
// see at the door (mirrors the postal-code wealth multipliers in laskuri).
export const AREA_TIERS = [
  { key: "normal", label: "Vakio alue", mult: 1.0 },
  { key: "valued", label: "Arvostettu alue", mult: 1.1 },
  { key: "premium", label: "Premium alue", mult: 1.2 },
] as const;
export type AreaKey = (typeof AREA_TIERS)[number]["key"];

export const ADDONS = [
  { key: "balcony", label: "Parveke-/terassilasitus", price: 39 },
  { key: "railing", label: "Lasikaide", price: 39 },
  { key: "mirror", label: "Peilien pesu", price: 19 },
  { key: "canopy", label: "Terassin lasikate", price: 89 },
  { key: "gutter", label: "Rännien puhdistus", price: 69 },
] as const;
export type AddonKey = (typeof ADDONS)[number]["key"];

export interface OfferInput {
  house: HouseKey;
  sqmIndex: number;
  tier: TierKey;
  height: HeightKey;
  area: AreaKey;
  addons: AddonKey[];
}

/** Estimated offer in CENTS (€ × 100), rounded to whole euros first. */
export function computeOfferCents(i: OfferInput): number {
  const ranges = SQM_RANGES[i.house] || [];
  const base = ranges[i.sqmIndex]?.price ?? 0;
  const tier = SERVICE_TIERS.find(t => t.key === i.tier)?.mult ?? 1;
  const height = HEIGHT_OPTS.find(h => h.key === i.height)?.mult ?? 1;
  const area = AREA_TIERS.find(a => a.key === i.area)?.mult ?? 1;
  const addonSum = (i.addons || []).reduce((s, k) => s + (ADDONS.find(a => a.key === k)?.price ?? 0), 0);
  const euros = base * tier * height * area + addonSum;
  return Math.round(euros) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM PER-WINDOW / PER-PANE PRICING — ASSISTANT ONLY
//
// Our public, primary pricing is the per-m² model above; it is NOT changed by
// this section and this section is NOT wired into any public page or tool.
//
// This per-window model exists purely so the marketer AI assistant can price
// and time the BIGGER / unusual custom gigs that don't fit the house+m² ranges
// (e.g. "iso talo, ~40 ikkunaa, 6 ruutua per ikkuna, tikkaat, premium-alue").
// Everything is a tunable constant — defaults are derived from existing
// economics (FR8 ≈ 37,5 €/ikkuna contract price, 20 €/ikkuna worker rate), and
// the surface / height / area multipliers reuse the per-m² tables above so the
// two models stay directionally consistent.
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_PER_WINDOW_EUR = 14;        // base retail €/window (all surfaces, standard panes)
export const STANDARD_PANES = 2;                // panes/ruudut included in the base
export const PANE_UPLIFT_EUR = 2;               // €/window per extra pane beyond STANDARD_PANES
export const CUSTOM_MINUTES_PER_WINDOW = 3.5;   // base wash time per standard window (work-minutes)
export const CUSTOM_MINUTES_PER_EXTRA_PANE = 0.8;
export const CUSTOM_SETUP_MINUTES = 20;         // fixed per-visit setup/teardown

/** Difficulty (frames, access, dirt level) the marketer judges on site. */
export const DIFFICULTY_OPTS = [
  { key: "easy", label: "Helppo", mult: 0.9 },
  { key: "standard", label: "Normaali", mult: 1.0 },
  { key: "hard", label: "Hankala (raamit, vaikea pääsy)", mult: 1.25 },
] as const;
export type DifficultyKey = (typeof DIFFICULTY_OPTS)[number]["key"];

/** Gentle volume discount for large counts (economies of scale). */
function volumeMult(windows: number): number {
  if (windows >= 60) return 0.9;
  if (windows >= 30) return 0.95;
  return 1.0;
}

export interface CustomOfferInput {
  windows: number;
  panesPerWindow?: number;     // total ruudut per window; defaults to STANDARD_PANES
  tier: TierKey;               // all surfaces vs outside only
  height: HeightKey;
  area: AreaKey;
  difficulty?: DifficultyKey;  // defaults to "standard"
  addons?: AddonKey[];
}

function multsFor(i: CustomOfferInput) {
  const tier = SERVICE_TIERS.find(t => t.key === i.tier)?.mult ?? 1;
  const height = HEIGHT_OPTS.find(h => h.key === i.height)?.mult ?? 1;
  const area = AREA_TIERS.find(a => a.key === i.area)?.mult ?? 1;
  const difficulty = DIFFICULTY_OPTS.find(d => d.key === (i.difficulty ?? "standard"))?.mult ?? 1;
  const windows = Math.max(0, Math.round(i.windows || 0));
  const extraPanes = Math.max(0, (i.panesPerWindow ?? STANDARD_PANES) - STANDARD_PANES);
  return { tier, height, area, difficulty, windows, extraPanes };
}

/** Custom per-window offer in CENTS (€ × 100), rounded to whole euros first. */
export function computeCustomOfferCents(i: CustomOfferInput): number {
  const { tier, height, area, difficulty, windows, extraPanes } = multsFor(i);
  const perWindow = CUSTOM_PER_WINDOW_EUR + extraPanes * PANE_UPLIFT_EUR;
  const addonSum = (i.addons || []).reduce((s, k) => s + (ADDONS.find(a => a.key === k)?.price ?? 0), 0);
  const euros = windows * perWindow * tier * height * area * difficulty * volumeMult(windows) + addonSum;
  return Math.round(euros) * 100;
}

/** Estimated total work-minutes for a custom job (height/difficulty/surface
 *  aware). This is person-minutes of labour, not wall-clock with a crew. */
export function estimateMinutes(i: CustomOfferInput): number {
  const { tier, height, difficulty, windows, extraPanes } = multsFor(i);
  if (windows <= 0) return 0;
  const perWindow = (CUSTOM_MINUTES_PER_WINDOW + extraPanes * CUSTOM_MINUTES_PER_EXTRA_PANE) * tier * height * difficulty;
  return Math.round(windows * perWindow + CUSTOM_SETUP_MINUTES);
}

/** Format work-minutes as { hours, label } and a per-crew wall-clock estimate. */
export function formatEstimate(totalMinutes: number, crew = 2): { hours: number; perCrewHours: number; label: string } {
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  const perCrewHours = Math.round((totalMinutes / 60 / Math.max(1, crew)) * 10) / 10;
  return { hours, perCrewHours, label: `${hours} h työtä (≈ ${perCrewHours} h ${crew} hengellä)` };
}

/** Compact, human-readable summary of the custom model for the AI context. */
export const CUSTOM_PRICING_SUMMARY = [
  `Custom per-ikkuna -hinnoittelu (vain isot/erikoiskohteet, ei julkinen):`,
  `• Perus ${CUSTOM_PER_WINDOW_EUR} €/ikkuna (kaikki pinnat, ${STANDARD_PANES} ruutua).`,
  `• Lisäruudut: +${PANE_UPLIFT_EUR} €/ikkuna jokaisesta ruudusta yli ${STANDARD_PANES}:n.`,
  `• Kertoimet: pinnat (vain ulko ×0,58), korkeus (tikas ×1,2 / 2.krs ×1,4), alue (arvostettu ×1,1 / premium ×1,2), vaikeus (helppo ×0,9 / hankala ×1,25).`,
  `• Määräalennus: ≥30 ikkunaa ×0,95, ≥60 ×0,9.`,
  `• Aika-arvio: ~${CUSTOM_MINUTES_PER_WINDOW} min/ikkuna + ${CUSTOM_MINUTES_PER_EXTRA_PANE} min/lisäruutu, kertoimet huomioiden, + ${CUSTOM_SETUP_MINUTES} min valmistelu.`,
].join("\n");
