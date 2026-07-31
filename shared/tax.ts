/**
 * FR8 — vero- ja maksulogiikka alihankkijan korvauksille (työkorvaus).
 *
 * Yksi totuuden lähde sille, miten Puuhapatet maksaa itsenäiselle alihankkijalle
 * ja miten alihankkijan lasku Puuhapatetille muodostuu.
 *
 * PÄÄTÖS (2026-07-16, käyttäjän nimenomainen pyyntö): Puuhapatet EI KOSKAAN
 * pidätä ennakonpidätystä alihankkijan laskulta — kaikki työkorvaukset
 * maksetaan aina täysimääräisenä (bruttona), riippumatta siitä onko maksunsaaja
 * ennakkoperintärekisterissä. `inPrepaymentRegister`/`payeeType`/
 * `withholdingRate` säilyvät `TaxInputs`-rajapinnassa taaksepäinyhteensopivuuden
 * vuoksi, mutta `computeTax` EI KÄYTÄ niitä laskentaan — `withheld` on aina
 * `false`. (HUOM: tämä siirtää ennakonpidätysvastuun riskin — jos maksunsaaja
 * ei tosiasiassa ole ennakkoperintärekisterissä, maksaja voi lain mukaan olla
 * vastuussa pidättämättä jääneestä verosta. Käyttäjä on tehnyt tämän päätöksen
 * tietoisena vaihtoehdosta; ks. docs/fr8-era-laskutus-plan.md.)
 *
 * ARVONLISÄVERO (ALV) on erillinen asia eikä tätä koske: jos alihankkija on
 * ALV-rekisterissä, hänen laskunsa Puuhapatetille lisää yleisen ALV-kannan
 * 25,5 % (voimassa 1.9.2024 alkaen). Jos toiminta on vähäistä (AVL 3 §, alle
 * 20 000 €/kalenterivuosi 1.1.2025 alkaen → tarkista vero.fi), ALV:tä ei
 * lisätä ja laskuun merkitään verottomuuden peruste.
 *
 * Lopullinen tilille maksettava: maksettava = työkorvaus + ALV.
 */

/** Yleinen arvonlisäverokanta Suomessa 1.9.2024 alkaen. */
export const ALV_RATE = 0.255;

/** Vähäisen toiminnan (AVL 3 §) liikevaihtoraja. Nousi 20 000 €:oon (kalenterivuosi)
 *  1.1.2025 alkaen; alarajahuojennus poistui samalla. Tarkista vero.fi. */
export const VAT_SMALL_BUSINESS_LIMIT_EUR = 20000;

/** Kotitalousvähennys (TVL 127 a §) verovuosina 2025–2026: 35 % yrityksen laskun
 *  työn osuudesta, enintään 1 600 €/henkilö/vuosi, omavastuu 150 €/vuosi.
 *  (Vuoteen 2024 asti 40 % / 2 250 € / 100 €.) Kaikki asiakasviestintä ja
 *  tekoälyn verokonteksti lukevat nämä täältä — päivitä lakimuutoksissa vain tämä. */
export const HOUSEHOLD_DEDUCTION_RATE = 0.35;
export const HOUSEHOLD_DEDUCTION_CAP_EUR = 1600;
export const HOUSEHOLD_DEDUCTION_OMAVASTUU_EUR = 150;

/** Kattoraha tuhaterottimella asiakasviestintään: "1 600" / "1,600". */
export function fmtHouseholdCap(lang: "fi" | "en" = "fi"): string {
  return HOUSEHOLD_DEDUCTION_CAP_EUR.toLocaleString(lang === "en" ? "en-US" : "fi-FI");
}

/** Alihankkijan oma ALV-asema (itse ilmoittama). */
export type VatStatus =
  | "alv_rekisterissa"   // ALV-velvollinen → lisää 25,5 % laskuun
  | "vahainen_toiminta"  // AVL 3 §, ei ALV:tä
  | "ei_tiedossa";       // ei vielä ilmoitettu → oletuksena ei ALV:tä

/** Maksunsaajan oikeudellinen muoto — ratkaisee ennakonpidätys-%:n, jos saaja EI
 *  ole ennakkoperintärekisterissä: luonnollinen henkilö / toiminimi 60 %, yhtiö 13 %. */
export type PayeeType =
  | "individual"   // luonnollinen henkilö tai toiminimi (yksityinen elinkeinonharjoittaja)
  | "company";     // oikeushenkilö: Oy, Ky, Ay, osuuskunta…

/** Profiiliin (profile.answers) tallennettavat avaimet. */
export const VAT_STATUS_KEY = "vatStatus";
export const PREPAYMENT_REGISTER_KEY = "prepaymentRegister"; // "kylla" | "ei"
export const PAYEE_TYPE_KEY = "payeeType"; // "henkilo" | "yritys"

export interface TaxInputs {
  /** Työkorvaus ilman ALV:tä, sentteinä (esim. pestyt ikkunat × hinta). */
  laborCents: number;
  vatStatus: VatStatus;
  /** @deprecated Ei enää käytössä laskentaan — Puuhapatet ei koskaan pidätä
   *  ennakonpidätystä (ks. tiedoston yläreunan huomautus). Säilytetty
   *  rajapinnassa vain kutsupaikkojen taaksepäinyhteensopivuuden vuoksi. */
  inPrepaymentRegister?: boolean;
  /** @deprecated Ei enää käytössä laskentaan, ks. `inPrepaymentRegister`. */
  payeeType?: PayeeType;
  /** @deprecated Ei enää käytössä laskentaan, ks. `inPrepaymentRegister`. */
  withholdingRate?: number;
}

export interface TaxBreakdown {
  /** Työkorvaus ilman ALV:tä (laskun veroton rivisumma). */
  laborCents: number;
  vatRegistered: boolean;
  vatRate: number;          // 0 jos ei ALV-velvollinen
  vatCents: number;         // ALV euroina (sentteinä)
  /** Laskun loppusumma (työkorvaus + ALV) — mitä alihankkija laskuttaa. */
  invoiceTotalCents: number;
  /** Aina `false` — Puuhapatet ei koskaan pidätä ennakonpidätystä. Kenttä
   *  säilytetty rajapinnassa kutsupaikkojen (PDF, sähköposti, admin-näkymät)
   *  taaksepäinyhteensopivuuden vuoksi. */
  withheld: boolean;
  withholdingRate: number;  // aina 0
  withholdingCents: number; // aina 0
  /** Mitä Puuhapatet maksaa tilille = invoiceTotal (ei koskaan ennakonpidätystä). */
  payableCents: number;
  /** Selkokieliset perustelut (lakiviitteineen) laskua ja näkymiä varten. */
  notes: string[];
}

function round(cents: number): number {
  return Math.round(cents);
}

/**
 * Laskee koko maksuketjun verotuksen yhdellä kertaa. Pyöristää sentteihin.
 * Ei koskaan pidätä ennakonpidätystä (käyttäjän päätös) — ks. tiedoston alku.
 */
export function computeTax(input: TaxInputs): TaxBreakdown {
  const laborCents = Math.max(0, Math.round(input.laborCents || 0));
  const vatRegistered = input.vatStatus === "alv_rekisterissa";
  const vatRate = vatRegistered ? ALV_RATE : 0;
  const vatCents = round(laborCents * vatRate);
  const invoiceTotalCents = laborCents + vatCents;

  // Ei koskaan ennakonpidätystä — maksetaan aina täysimääräisenä (bruttona),
  // riippumatta ennakkoperintärekisteristä tai maksunsaajan muodosta.
  const withheld = false;
  const withholdingRate = 0;
  const withholdingCents = 0;
  const payableCents = invoiceTotalCents;

  const notes: string[] = [];
  if (vatRegistered) {
    notes.push(`ALV ${fmtPct(vatRate)} (yleinen verokanta). Laskuttaja on arvonlisäverovelvollinen.`);
  } else {
    notes.push("Veroton myynti – ei arvonlisäveroa (AVL 3 §, vähäinen toiminta).");
  }
  notes.push("Ei ennakonpidätystä: maksetaan aina täysimääräisenä (bruttona).");
  return {
    laborCents, vatRegistered, vatRate, vatCents, invoiceTotalCents,
    withheld, withholdingRate, withholdingCents, payableCents, notes,
  };
}

/** Lukee alihankkijan ALV-aseman profiilin vastauksista (oletus: ei tiedossa). */
export function readVatStatus(answers: Record<string, string> | undefined | null): VatStatus {
  const v = answers?.[VAT_STATUS_KEY];
  return v === "alv_rekisterissa" || v === "vahainen_toiminta" ? v : "ei_tiedossa";
}

/** @deprecated Puhtaasti informatiivinen — ei vaikuta `computeTax`-laskentaan
 *  (Puuhapatet ei koskaan pidätä ennakonpidätystä). Lukee vanhan/mahdollisen
 *  profiilivastauksen näyttöä varten (esim. admin-työntekijänäkymä). */
export function readInPrepaymentRegister(answers: Record<string, string> | undefined | null): boolean {
  return answers?.[PREPAYMENT_REGISTER_KEY] === "kylla";
}

/** @deprecated Puhtaasti informatiivinen — ei vaikuta `computeTax`-laskentaan,
 *  ks. `readInPrepaymentRegister`. */
export function readPayeeType(answers: Record<string, string> | undefined | null): PayeeType {
  return answers?.[PAYEE_TYPE_KEY] === "yritys" ? "company" : "individual";
}

export function fmtPct(rate: number): string {
  const p = rate * 100;
  return (Math.round(p * 10) / 10).toLocaleString("fi-FI") + " %";
}

export function fmtEurCents(cents: number): string {
  // Sitova välilyönti: tavallisella välillä "215,00 €" katkesi rivin lopussa
  // niin että pelkkä € jäi omalle rivilleen.
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
