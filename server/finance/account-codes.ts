/**
 * TILIKARTAN PUHDAS DATA — tilinumerot, tilien nimet ja kirjanpitoyksiköt.
 *
 * MIKSI OMA TIEDOSTO: `accounts.ts` importtaa `../db`, joka heittää heti jos
 * `DATABASE_URL` puuttuu. Vientisäännöt (`draft-entries.ts`) tarvitsevat vain
 * tilinumerot, eivät kantaa — ja niin kauan kuin `ACCOUNT` asui kantaa
 * koskevassa tiedostossa, sääntöjen testaaminen olisi vaatinut tietokannan tai
 * sen mockaamisen. Tämä data ei tiedä kannasta mitään.
 *
 * `accounts.ts` re-exporttaa nämä, joten vanhat importit toimivat ennallaan.
 */

import { BRAND_BILLERS } from "@shared/billers";

export interface AccountDef {
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
}

export const STANDARD_ACCOUNTS: AccountDef[] = [
  // ── Vastaavaa (assets) ──────────────────────────────────────────────────
  { code: "1090", name: "Koneet ja kalusto", accountType: "asset" },       // reserved (isot hankinnat, ei käytössä oletuksena)
  { code: "1700", name: "Myyntisaamiset", accountType: "asset" },          // reserved (suoriteperusteinen AR, ei käytössä oletuksena)
  { code: "1910", name: "Pankkitili", accountType: "asset" },

  // ── Vastattavaa: vieras pääoma (liabilities) ────────────────────────────
  { code: "2800", name: "Ostovelat", accountType: "liability" },           // reserved
  { code: "2820", name: "Ostovelka toiselle yrittäjälle", accountType: "liability" }, // reserved
  { code: "2900", name: "ALV-velka", accountType: "liability" },           // reserved (ALV-rekisteröinnin jälkeen)

  // ── Vastattavaa: oma pääoma (equity) ────────────────────────────────────
  { code: "2000", name: "Yksityissijoitukset", accountType: "equity" },    // reserved
  { code: "2010", name: "Yksityisotot", accountType: "equity" },           // reserved
  { code: "2020", name: "Edellisten tilikausien voitto/tappio", accountType: "equity" },

  // ── Tuotot (revenue) ─────────────────────────────────────────────────────
  { code: "3000", name: "Myynnit", accountType: "revenue" },
  { code: "3010", name: "Myynnit toiselle yrittäjälle", accountType: "revenue" },

  // ── Kulut (expenses) ─────────────────────────────────────────────────────
  { code: "4000", name: "Ostot ja ulkopuoliset palvelut", accountType: "expense" },
  { code: "4010", name: "Ostot toiselta yrittäjältä", accountType: "expense" },
  { code: "4900", name: "Kalusto ja välineet", accountType: "expense" },
  { code: "4990", name: "Muut kulut", accountType: "expense" },
  { code: "5000", name: "Henkilöstökulut", accountType: "expense" },       // reserved (Oy + palkat)
  { code: "6000", name: "Poistot", accountType: "expense" },               // reserved (jos isompi hankinta joskus poistetaan)
  { code: "8000", name: "Rahoitustuotot ja -kulut", accountType: "expense" }, // reserved
];

/** account code → column name shortcuts used throughout the poster/reports. */
export const ACCOUNT = {
  BANK: "1910",
  SALES: "3000",
  SALES_INTERNAL: "3010",
  PURCHASES: "4000",
  PURCHASES_INTERNAL: "4010",
  EQUIPMENT: "4900",
  OTHER_EXPENSE: "4990",
  RETAINED_EARNINGS: "2020",
} as const;

/** Ledger definitions, derived from the brand's billers so the two never drift. */
export const LEDGER_DEFS = BRAND_BILLERS.map((b) => ({
  id: b.id,
  name: b.name,
  yTunnus: b.yTunnus,
  entityType: "toiminimi" as const,
}));

