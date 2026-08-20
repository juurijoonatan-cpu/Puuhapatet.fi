/**
 * SIIVOUS — hinnoittelumalli (kotisiivous + yritys/toimistosiivous).
 *
 * TILA: EI VIELÄ TILATTAVISSA. Palvelu on avaamassa, ja jokainen tätä käyttävä
 * näkymä on velvollinen sanomaan sen ääneen (`CLEANING_STATUS`). Laskurin
 * siivousvälilehti kerää kiinnostuksen ja antaa ENNAKKOARVION — se ei ole
 * tilaus, eikä sitä saa esittää tilauksena. Tämä on tarkoituksellinen ero
 * ikkunanpesuun, joka on tilattavissa nyt.
 *
 * MIKSI AIKAPERUSTEINEN MALLI EIKÄ TAULUKKOHINTA:
 * Ikkunanpesu hinnoitellaan taulukolla (shared/pricing.ts), koska kohteen koko
 * ennustaa ikkunamäärän kohtuullisesti. Siivouksessa hinta on suoraan
 * työaikaa: neliöt → tunnit → €. Kun malli on läpinäkyvä (m²/h ja €/h ovat
 * näkyviä vakioita), asiakkaalle voi kertoa MISTÄ luku tulee — eikä tarvitse
 * väittää tietävänsä tarkkaa hintaa kohteesta jota ei ole nähty.
 *
 * LUVUT OVAT OMA HINNOITTELUPÄÄTÖS, EI MARKKINAVÄITE. Näkymissä ei siis sanota
 * "halvempi kuin X" — vain mitä me veloitamme ja miten se laskettiin.
 */

import { HOUSEHOLD_DEDUCTION_RATE } from "./tax";

/** Palvelun elinkaaritila. Näkymät lukevat tämän — älä kovakoodaa "tulossa". */
export const CLEANING_STATUS = "tulossa" as const;

/**
 * Avauspäivää EI luvata, koska sitä ei ole päätetty. Tyhjä merkkijono
 * tarkoittaa "ei päivämäärää" ja näkymien pitää kestää se. Kun päivä on
 * varma, se kirjoitetaan tähän — silloin ja vain silloin sen voi näyttää.
 */
export const CLEANING_LAUNCH_LABEL = "";

// ─── Segmentti ───────────────────────────────────────────────────────────────

export type CleaningSegment = "koti" | "yritys";

/**
 * Työnopeus (m² / työtunti) ja tuntihinta segmentin mukaan.
 *
 * Yritys- ja toimistotilat siivotaan nopeammin neliötä kohti kuin koti: isot
 * avoimet pinnat, vähemmän tavaraa, vakioitu tehtävälista. Siksi sama neliömäärä
 * on toimistona halvempi kuin kotina — ei siksi että työ olisi vähempiarvoista.
 */
export const SEGMENTS: Record<CleaningSegment, {
  /** Neliötä työtunnissa ylläpitosiivouksessa. */
  sqmPerHour: number;
  /** €/työtunti, sisältää välineet ja aineet. */
  eurPerHour: number;
  /** Lyhin laskutettava käynti tunteina (siirtymä ja valmistelu). */
  minHours: number;
  /** Onko työ kotitalousvähennyskelpoista (kotitaloustyö kyllä, yritys ei). */
  householdDeductible: boolean;
}> = {
  koti:   { sqmPerHour: 45, eurPerHour: 39, minHours: 2, householdDeductible: true  },
  yritys: { sqmPerHour: 90, eurPerHour: 35, minHours: 2, householdDeductible: false },
};

// ─── Laajuus ─────────────────────────────────────────────────────────────────

/**
 * Työn laajuus kertoimena ylläpitosiivoukseen verrattuna. Kertoimet kasvattavat
 * AIKAA, eivät tuntihintaa — perusteellinen siivous on samaa työtä hitaammin.
 */
export const SCOPES = [
  { key: "yllapito",  mult: 1.0, recurring: true  },
  { key: "perus",     mult: 1.7, recurring: false },
  { key: "muutto",    mult: 2.2, recurring: false },
] as const;
export type CleaningScopeKey = (typeof SCOPES)[number]["key"];

// ─── Käyntitiheys ────────────────────────────────────────────────────────────

/**
 * Toistuva sopimus on meille ennustettavaa työtä (sama kohde, tutut tilat, ei
 * uutta myyntiä), ja se alennus annetaan asiakkaalle. `visitsPerMonth` on
 * keskiarvo kuukausihinnan laskemiseen: viikoittain ≈ 4,33 käyntiä/kk.
 */
export const FREQUENCIES = [
  { key: "kerta",      visitsPerMonth: 0,    discount: 0    },
  { key: "kuukausi",   visitsPerMonth: 1,    discount: 0.05 },
  { key: "kaksiviikko", visitsPerMonth: 2.17, discount: 0.10 },
  { key: "viikko",     visitsPerMonth: 4.33, discount: 0.15 },
] as const;
export type CleaningFrequencyKey = (typeof FREQUENCIES)[number]["key"];

// ─── Lisätyöt ────────────────────────────────────────────────────────────────

/** Kiinteähintaiset lisät käyntiä kohti (€). */
export const CLEANING_ADDONS = [
  { key: "ikkunat",  price: 45 },
  { key: "uuni",     price: 25 },
  { key: "jaakaappi", price: 20 },
  { key: "parveke",  price: 20 },
] as const;
export type CleaningAddonKey = (typeof CLEANING_ADDONS)[number]["key"];

// ─── Laskenta ────────────────────────────────────────────────────────────────

export interface CleaningInput {
  segment: CleaningSegment;
  /** Siivottava pinta-ala neliömetreinä. */
  sqm: number;
  scope: CleaningScopeKey;
  frequency: CleaningFrequencyKey;
  addons?: CleaningAddonKey[];
  /** Aluekerroin (sama ajatus kuin ikkunanpesussa). Oletus 1. */
  areaMult?: number;
}

export interface CleaningEstimate {
  /** Arvioitu työaika käynnillä, tuntia (pyöristetty 0,25 h tarkkuuteen). */
  hours: number;
  /** Osuiko arvio käynnin minimiin (kerrottava asiakkaalle). */
  atMinimum: boolean;
  /** Työn osuus käynnistä ilman lisiä, €. */
  laborEur: number;
  /** Lisätyöt yhteensä, €. */
  addonsEur: number;
  /** Toistuvuusalennus, € (positiivinen luku = asiakkaan säästö). */
  discountEur: number;
  /** Käynnin hinta, € (sis. ALV). */
  perVisitEur: number;
  /** Kuukausihinta toistuvassa sopimuksessa, € — 0 kertakäynnillä. */
  perMonthEur: number;
  /** Kotitalousvähennyksen arvo käynnistä, € (0 jos ei kelpaa). */
  deductionEur: number;
  /** Käynnin hinta vähennyksen jälkeen, €. */
  perVisitAfterDeductionEur: number;
}

/** Pyöristys 0,25 tunnin tarkkuuteen: aikaa myydään neljännestunneissa. */
function roundQuarter(h: number): number {
  return Math.round(h * 4) / 4;
}

/**
 * Arvio yhdestä siivouskäynnistä. Kaikki eurot pyöristetään kokonaisiksi:
 * kyseessä on arvio, ja sentit antaisivat siitä väärän kuvan.
 *
 * Vähennys lasketaan koko käynnistä (myös lisistä), koska ne ovat samaa
 * kotitaloustyötä. Omavastuuta (150 €/v) ei vähennetä täältä: se on
 * vuosikohtainen eikä käyntikohtainen, ja sen kertominen kuuluu näkymän
 * selitetekstiin.
 */
export function estimateCleaning(input: CleaningInput): CleaningEstimate {
  const seg = SEGMENTS[input.segment];
  const scope = SCOPES.find(s => s.key === input.scope) ?? SCOPES[0];
  const freq = FREQUENCIES.find(f => f.key === input.frequency) ?? FREQUENCIES[0];
  const areaMult = input.areaMult && input.areaMult > 0 ? input.areaMult : 1;
  const sqm = Math.max(0, input.sqm || 0);

  const rawHours = (sqm / seg.sqmPerHour) * scope.mult;
  const hours = roundQuarter(Math.max(seg.minHours, rawHours));
  const atMinimum = rawHours < seg.minHours;

  const laborEur = Math.round(hours * seg.eurPerHour * areaMult);
  const addonsEur = (input.addons || []).reduce(
    (s, k) => s + (CLEANING_ADDONS.find(a => a.key === k)?.price ?? 0), 0,
  );
  const gross = laborEur + addonsEur;
  const discountEur = Math.round(gross * freq.discount);
  const perVisitEur = gross - discountEur;
  const perMonthEur = Math.round(perVisitEur * freq.visitsPerMonth);

  const deductionEur = seg.householdDeductible
    ? Math.round(perVisitEur * HOUSEHOLD_DEDUCTION_RATE)
    : 0;

  return {
    hours,
    atMinimum,
    laborEur,
    addonsEur,
    discountEur,
    perVisitEur,
    perMonthEur,
    deductionEur,
    perVisitAfterDeductionEur: perVisitEur - deductionEur,
  };
}

/**
 * Tiivis, ihmisluettava kuvaus mallista tekoäly- ja myyntikonteksteihin.
 * Sisältää tilan, koska ilman sitä botti voisi kertoa hinnan palvelusta jota ei
 * vielä ole.
 */
export const CLEANING_PRICING_SUMMARY = [
  `Siivous — TILA: ${CLEANING_STATUS}. Palvelua EI voi vielä tilata; kiinnostuneet jättävät yhteystiedot ja heille ilmoitetaan kun palvelu avautuu.`,
  `Malli on aikaperusteinen: neliöt → työtunnit → hinta.`,
  `• Koti: ~${SEGMENTS.koti.sqmPerHour} m²/h, ${SEGMENTS.koti.eurPerHour} €/h (sis. välineet ja aineet), lyhin käynti ${SEGMENTS.koti.minHours} h.`,
  `• Yritys/toimisto: ~${SEGMENTS.yritys.sqmPerHour} m²/h, ${SEGMENTS.yritys.eurPerHour} €/h, lyhin käynti ${SEGMENTS.yritys.minHours} h.`,
  `• Laajuuskertoimet aikaan: ylläpito ×1,0, perusteellinen ×1,7, muuttosiivous ×2,2.`,
  `• Toistuvuusalennus: kuukausittain −5 %, kahden viikon välein −10 %, viikoittain −15 %.`,
  `• Lisät käynnille: ikkunat 45 €, uuni 25 €, jääkaappi 20 €, parveke 20 €.`,
  `• Kotisiivous on kotitalousvähennyskelpoista; yrityssiivous ei ole.`,
  `• Kaikki luvut ovat ennakkoarvioita. Lopullinen hinta sovitaan aina katselmuksen jälkeen.`,
].join("\n");
