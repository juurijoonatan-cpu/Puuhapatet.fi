/**
 * Asiakkaan näkymien muotoilupoletit (seuranta, allekirjoitus, lataus).
 *
 * Nämä kolme näkymää ovat sama matka samalle ihmiselle, joten niiden värit,
 * kirjasin ja välistys tulevat yhdestä paikasta. Aiemmin jokainen tiedosto
 * määritteli oman `T`- ja `FONT`-vakionsa, ja ne ehtivät jo erkaantua.
 *
 * TYPOGRAFIA. Onest on ladattu valmiiksi index.html:ssä (400–800), joten sitä
 * ei tarvitse hakea ajonaikaisesti — yksi renderöintiä estävä pyyntö vähemmän
 * asiakkaan puhelimella. Poppins jää varalle: jos Onest ei jostain syystä
 * lataudu, näkymä näyttää täsmälleen entiseltä. Onest on tiiviimpi ja kantaa
 * lihavat leikkaukset paremmin, mikä on koko tämän muotoilun idea: iso luku,
 * paksu leikkaus, paljon ilmaa.
 */

import type { CSSProperties } from "react";

export const CT = {
  ink: "#1A1A1A",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  /** Pehmeä täyttö korteille joissa ei ole reunaviivaa (tilastoruudut). */
  fill: "#F1EFE9",
  hair: "#E4E1D7",
  muted: "#8C8A82",
  navy: "#1F3B57",
  green: "#3E7C59",
  amber: "#E0A800",
} as const;

export const CFONT =
  "'Onest', 'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Edistymispalkin täyttö: raikas mutta ei neon, toimii vaalealla paperilla. */
export const PROGRESS_GRADIENT = "linear-gradient(90deg, #9BE47F 0%, #5FD9B4 58%, #45D6C0 100%)";
export const PROGRESS_GLOW = "0 6px 22px -6px rgba(69,214,192,0.65)";

/** Pieni yläotsikko: harva, versaali, hiljainen. */
export const eyebrow: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: CT.muted,
};

/**
 * Näyttöluku. Lihava leikkaus ja tiukka kirjainväli — mitä isompi luku, sitä
 * tiukemmalle se halutaan, muuten iso koko hajoaa harakoiksi.
 */
export function display(size: number): CSSProperties {
  return {
    fontSize: size,
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: size >= 44 ? "-0.045em" : "-0.03em",
    fontVariantNumeric: "tabular-nums",
    color: CT.ink,
  };
}

/** Valkoinen kortti — sivun perusyksikkö. */
export const cardStyle: CSSProperties = {
  background: CT.card,
  border: `1px solid ${CT.hair}`,
  borderRadius: 20,
  padding: 22,
};

/** Täytetty ruutu ilman reunaa — tilastoille ja tiiviille tiedoille. */
export const tileStyle: CSSProperties = {
  background: CT.fill,
  borderRadius: 16,
  padding: "13px 15px",
  minWidth: 0,
};
