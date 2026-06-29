/**
 * FR8 — vero- ja maksulogiikka alihankkijan korvauksille (työkorvaus).
 *
 * Yksi totuuden lähde sille, miten Puuhapatet maksaa itsenäiselle alihankkijalle
 * ja miten alihankkijan lasku Puuhapatetille muodostuu — oikein Suomen lain
 * mukaan, mahdollisimman yksinkertaisesti.
 *
 * KAKSI VEROASIAA, JOTKA RATKAISEVAT MAKSUN:
 *
 * 1) ENNAKKOPERINTÄREKISTERI (ennakkoperintälaki). Kun yritys maksaa TYÖKORVAUSTA
 *    (ei palkkaa) toiselle:
 *      • maksunsaaja ON ennakkoperintärekisterissä → maksetaan BRUTTONA, ei
 *        ennakonpidätystä. Maksunsaaja hoitaa verot itse.
 *      • maksunsaaja EI OLE rekisterissä → maksajan on LAIN MUKAAN toimitettava
 *        ennakonpidätys ennen maksua ja tilitettävä se Verolle:
 *          – luonnollinen henkilö / toiminimi ilman verokorttia: 60 %
 *          – oikeushenkilö (Oy, Ky, Ay…): 13 %
 *      Jos maksaja maksaa bruttona rekisteröimättömälle, maksaja on vastuussa
 *      pidättämättä jääneestä verosta. → Tämä on tärkein juridinen kohta.
 *
 * 2) ARVONLISÄVERO (ALV). Jos alihankkija on ALV-rekisterissä, hänen laskunsa
 *    Puuhapatetille lisää yleisen ALV-kannan 25,5 % (voimassa 1.9.2024 alkaen).
 *    Jos toiminta on vähäistä (AVL 3 §, alle 20 000 €/kalenterivuosi 1.1.2025 alkaen
 *    → tarkista vero.fi), ALV:tä ei lisätä ja laskuun merkitään verottomuuden peruste.
 *
 * ALV lisätään työkorvauksen päälle; ennakonpidätys lasketaan työkorvauksesta
 * ILMAN ALV:tä (ALV:stä ei koskaan pidätetä). Lopullinen tilille maksettava:
 *   maksettava = työkorvaus + ALV − ennakonpidätys
 */

/** Yleinen arvonlisäverokanta Suomessa 1.9.2024 alkaen. */
export const ALV_RATE = 0.255;

/** Vähäisen toiminnan (AVL 3 §) liikevaihtoraja. Nousi 20 000 €:oon (kalenterivuosi)
 *  1.1.2025 alkaen; alarajahuojennus poistui samalla. Tarkista vero.fi. */
export const VAT_SMALL_BUSINESS_LIMIT_EUR = 20000;

/** Ennakonpidätys työkorvauksesta, kun saaja EI ole ennakkoperintärekisterissä. */
export const WITHHOLDING_NATURAL_PERSON = 0.60; // luonnollinen henkilö / toiminimi, ei verokorttia
export const WITHHOLDING_COMPANY = 0.13;        // oikeushenkilö (Oy, Ky, Ay…)

/** Alihankkijan oma ALV-asema (itse ilmoittama). */
export type VatStatus =
  | "alv_rekisterissa"   // ALV-velvollinen → lisää 25,5 % laskuun
  | "vahainen_toiminta"  // AVL 3 §, ei ALV:tä
  | "ei_tiedossa";       // ei vielä ilmoitettu → oletuksena ei ALV:tä

/** Profiiliin (profile.answers) tallennettavat avaimet. */
export const VAT_STATUS_KEY = "vatStatus";
export const PREPAYMENT_REGISTER_KEY = "prepaymentRegister"; // "kylla" | "ei"

export interface TaxInputs {
  /** Työkorvaus ilman ALV:tä, sentteinä (esim. pestyt ikkunat × hinta). */
  laborCents: number;
  vatStatus: VatStatus;
  /** Onko saaja ennakkoperintärekisterissä? */
  inPrepaymentRegister: boolean;
  /** Ennakonpidätysprosentti, jos ei rekisterissä. Oletus 60 % (henkilö ilman
   *  verokorttia). Voidaan korvata esim. verokortin %:lla tai 13 %:lla (yhtiö). */
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
  withheld: boolean;        // toimitetaanko ennakonpidätys
  withholdingRate: number;  // 0 jos rekisterissä
  withholdingCents: number; // pidätetty vero (sentteinä)
  /** Mitä Puuhapatet maksaa tilille = invoiceTotal − ennakonpidätys. */
  payableCents: number;
  /** Selkokieliset perustelut (lakiviitteineen) laskua ja näkymiä varten. */
  notes: string[];
}

function round(cents: number): number {
  return Math.round(cents);
}

/**
 * Laskee koko maksuketjun verotuksen yhdellä kertaa. Pyöristää sentteihin.
 */
export function computeTax(input: TaxInputs): TaxBreakdown {
  const laborCents = Math.max(0, Math.round(input.laborCents || 0));
  const vatRegistered = input.vatStatus === "alv_rekisterissa";
  const vatRate = vatRegistered ? ALV_RATE : 0;
  const vatCents = round(laborCents * vatRate);
  const invoiceTotalCents = laborCents + vatCents;

  const withheld = !input.inPrepaymentRegister;
  const withholdingRate = withheld ? (input.withholdingRate ?? WITHHOLDING_NATURAL_PERSON) : 0;
  // Ennakonpidätys lasketaan TYÖKORVAUKSESTA ilman ALV:tä; ALV:stä ei pidätetä.
  const withholdingCents = withheld ? round(laborCents * withholdingRate) : 0;
  const payableCents = invoiceTotalCents - withholdingCents;

  const notes: string[] = [];
  if (vatRegistered) {
    notes.push(`ALV ${fmtPct(vatRate)} (yleinen verokanta). Laskuttaja on arvonlisäverovelvollinen.`);
  } else {
    notes.push("Veroton myynti – ei arvonlisäveroa (AVL 3 §, vähäinen toiminta).");
  }
  if (withheld) {
    notes.push(
      `Ennakonpidätys ${fmtPct(withholdingRate)} työkorvauksesta: laskuttaja ei ole ` +
      "ennakkoperintärekisterissä, joten maksaja toimittaa ennakonpidätyksen ja tilittää sen Verolle " +
      "(ennakkoperintälaki). Pidätetty määrä luetaan laskuttajan hyväksi verotuksessa.",
    );
  } else {
    notes.push("Ei ennakonpidätystä: laskuttaja on ennakkoperintärekisterissä. Maksetaan bruttona.");
  }
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

/** Onko alihankkija ennakkoperintärekisterissä (oletus: ei → varovainen). */
export function readInPrepaymentRegister(answers: Record<string, string> | undefined | null): boolean {
  return answers?.[PREPAYMENT_REGISTER_KEY] === "kylla";
}

export function fmtPct(rate: number): string {
  const p = rate * 100;
  return (Math.round(p * 10) / 10).toLocaleString("fi-FI") + " %";
}

export function fmtEurCents(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
