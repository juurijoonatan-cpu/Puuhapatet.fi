/**
 * TUNTITILAN RAHA — yksi laskenta, jota sekä admin, tekijä että lasku lukevat.
 *
 * Tuntitila (`billingMode: "hourly"`) oli tähän asti pelkkä aikakirjanpito:
 * `ProjShift`-rivit ilman yhtäkään senttiä. Tämä tiedosto lisää rahan, ja
 * säännöt ovat tässä YHDESSÄ paikassa — jos ne olisivat näkymissä, adminin,
 * tekijän ja laskun luvut ehtisivät erota toisistaan ennen kuin kukaan huomaa.
 *
 * SÄÄNNÖT (perustajien sopimat):
 *
 *   · Asiakas maksaa JOKAISESTA tunnista `hourRateCents` (oletus 26,00 €).
 *   · TYÖNTEKIJÄN tunti: tekijä ansaitsee `workerHourCents` (oletus 15,00 €),
 *     ja erotus (11,00 €) on katetta, joka jaetaan perustajien kesken tasan.
 *   · PERUSTAJAN tunti: katetta EI oteta lainkaan. Se on omaa työtä, joten
 *     perustaja ansaitsee koko tuntihinnan (26,00 €).
 *
 * Viimeinen sääntö on se joka helposti unohtuu, ja sen unohtaminen näkyisi
 * väärin päin kahdesti: perustajan palkka olisi liian pieni ja "kate" liian
 * suuri — eli raha näyttäisi olevan yhteistä vaikka se on hänen palkkaansa.
 *
 * TUNNIT LUETAAN `computeShiftStats`ISTA eikä raakariveistä. Se on tarkoitus:
 * sama funktio piirtää tuntinäkymän luvut, ja se myös rajaa johtajan
 * miinuskorjaukset niin ettei kenenkään tunnit mene alle nollan. Jos raha
 * laskettaisiin raakariveistä, näkyvä tuntimäärä ja laskutettava tuntimäärä
 * voisivat erota — ja ero olisi väärä lasku.
 *
 * SENTIT OVAT KOKONAISLUKUJA JA OSAT SUMMAUTUVAT KOKONAISUUDEKSI. Kate
 * johdetaan vähennyslaskuna (`laskutettava − tekijän palkka`) eikä pyöristetä
 * erikseen, ja perustajien kesken jaettaessa jakojäännös annetaan
 * järjestyksessä. Muuten sentti katoaisi tai syntyisi tyhjästä.
 */

import { FOUNDER_IDS, isFounder } from "./team";
import {
  computeShiftStats, hourRateOf, workerHourRateOf,
  type ProjectData, type ProjShift, type ShiftStats,
} from "./project";

export interface HourlyWorkerRow {
  id: string;
  hours: number;
  /** Perustajan tunnista ei oteta katetta — hän saa koko tuntihinnan. */
  isFounder: boolean;
  /** Mitä TÄMÄ henkilö ansaitsee näistä tunneista. */
  earnedCents: number;
  /** Mitä asiakas maksaa näistä tunneista. */
  billedCents: number;
}

export interface HourlyFounderRow {
  id: string;
  /** Oma työ: perustajan omat tunnit täydellä tuntihinnalla. */
  wageCents: number;
  /** Osuus työntekijätuntien katteesta. */
  marginCents: number;
  /** Yhteensä tälle perustajalle. */
  totalCents: number;
}

export interface HourlyMoney {
  /** Käytetyt hinnat, jotta näkymän ei tarvitse päätellä niitä uudelleen. */
  hourRateCents: number;
  workerHourCents: number;

  totalHours: number;
  /** Tunnit joista otetaan katetta (työntekijöiden tunnit). */
  workerHours: number;
  /** Perustajien omat tunnit. */
  founderHours: number;

  /** Asiakkaalta laskutettava tuntityö. */
  billableCents: number;
  /** Työntekijöille kertynyt tuntipalkka. */
  workerCostCents: number;
  /** Perustajien oma työ täydellä hinnalla (ei katetta). */
  founderWageCents: number;
  /** Työntekijätunneista jäävä kate ennen jakoa. */
  marginCents: number;

  byWorker: HourlyWorkerRow[];
  byFounder: HourlyFounderRow[];

  /**
   * Tuli tuntipalkka yli asiakashinnan. Silloin kate olisi negatiivinen, ja se
   * on kirjausvirhe eikä tulos: kate rajataan nollaan ja tämä lippu nousee,
   * jotta näkymä voi sanoa sen ääneen sen sijaan että näyttäisi miinuskatetta.
   */
  rateInverted: boolean;
}

/** Jaa sentit tasan annetuille — jakojäännös järjestyksessä, summa säilyy. */
function splitEvenly(cents: number, ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!ids.length || cents <= 0) {
    for (const id of ids) out.set(id, 0);
    return out;
  }
  const base = Math.floor(cents / ids.length);
  let rest = cents - base * ids.length;
  for (const id of ids) {
    out.set(id, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest -= 1;
  }
  return out;
}

export function computeHourlyMoney(
  data: Pick<ProjectData, "shifts" | "hourRateCents" | "workerHourCents">,
  opts?: { today?: string; stats?: ShiftStats },
): HourlyMoney {
  const hourRateCents = hourRateOf(data);
  const workerHourCents = workerHourRateOf(data);
  const rateInverted = workerHourCents > hourRateCents;
  /** Miinuskate ei ole tulos vaan kirjausvirhe — tekijä saa silti omansa. */
  const effectiveWorkerCents = rateInverted ? hourRateCents : workerHourCents;

  const stats = opts?.stats
    ?? computeShiftStats((data.shifts ?? []) as ProjShift[], opts?.today);

  const byWorker: HourlyWorkerRow[] = [];
  const founderWage = new Map<string, number>();
  let workerHours = 0, founderHours = 0;
  let billableCents = 0, workerCostCents = 0, founderWageCents = 0, marginCents = 0;

  for (const row of stats.byWorker) {
    const billed = Math.round(row.hours * hourRateCents);
    billableCents += billed;

    if (isFounder(row.id)) {
      // Omaa työtä: koko tuntihinta hänelle, ei katetta kenellekään.
      founderHours += row.hours;
      founderWageCents += billed;
      founderWage.set(row.id, (founderWage.get(row.id) ?? 0) + billed);
      byWorker.push({ id: row.id, hours: row.hours, isFounder: true, earnedCents: billed, billedCents: billed });
      continue;
    }

    const pay = Math.round(row.hours * effectiveWorkerCents);
    // Kate on EROTUS eikä oma pyöristyksensä: näin osat summautuvat aina
    // laskutettavaan senttiin asti.
    const margin = Math.max(0, billed - pay);
    workerHours += row.hours;
    workerCostCents += pay;
    marginCents += margin;
    byWorker.push({ id: row.id, hours: row.hours, isFounder: false, earnedCents: pay, billedCents: billed });
  }

  const marginShare = splitEvenly(marginCents, FOUNDER_IDS);
  // `Array.from` eikä spread: käännöskohde ei iteroi Map-avaimia suoraan.
  const founderIds = Array.from(new Set(FOUNDER_IDS.concat(Array.from(founderWage.keys()))));
  const byFounder: HourlyFounderRow[] = founderIds.map((id) => {
    const wageCents = founderWage.get(id) ?? 0;
    const mCents = marginShare.get(id) ?? 0;
    return { id, wageCents, marginCents: mCents, totalCents: wageCents + mCents };
  }).filter((r) => r.totalCents > 0 || FOUNDER_IDS.includes(r.id));

  return {
    hourRateCents,
    workerHourCents,
    totalHours: Math.round((workerHours + founderHours) * 100) / 100,
    workerHours: Math.round(workerHours * 100) / 100,
    founderHours: Math.round(founderHours * 100) / 100,
    billableCents,
    workerCostCents,
    founderWageCents,
    marginCents,
    byWorker,
    byFounder,
    rateInverted,
  };
}
