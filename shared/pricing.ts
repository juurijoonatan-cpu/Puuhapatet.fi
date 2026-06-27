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
