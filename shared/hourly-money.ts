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
  computeShiftStats, computeProjectTotals, expenseCustomerCents, hourRateOf, workerHourRateOf,
  type ProjectData, type ProjExpense, type ProjShift, type ShiftStats,
} from "./project";

export interface HourlyWorkerRow {
  id: string;
  hours: number;
  /** Perustajan tunnista ei oteta katetta — hän saa koko tuntihinnan. */
  isFounder: boolean;
  /** Mitä TÄMÄ henkilö ansaitsee näistä tunneista. */
  earnedCents: number;
  /**
   * Mitä TÄMÄ henkilö saa yhdeltä tunnilta: perustajalle koko asiakashinta
   * (omasta työstä ei oteta katetta), työntekijälle hänen tuntipalkkansa.
   *
   * Valmiiksi ratkaistuna rivillä, jotta tekijälle vastaavan koodin ei tarvitse
   * lukea asiakkaan tuntihintaa päättääkseen kumpi luku on hänen. Se olisi
   * pieni ero kirjoittaa väärin ja iso vahinko: tekijä näkisi paljonko hänen
   * tunnistaan jää meille.
   */
  perHourCents: number;
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

  /** Asiakkaalle veloitettavat tarvikkeet (läpilaskutus, ei katetta). */
  customerCostCents: number;
  /** Alihankinnan toteutunut kulu. */
  subcontractCostCents: number;
  /** Alihankinnasta otettu kate. */
  subcontractMarginCents: number;
  /** Kulurivit laskun erittelyä varten. */
  costLines: HourlyCostLine[];
  /** KAIKKI mitä asiakas maksaa: tuntityö + tarvikkeet + alihankinta katteineen. */
  customerTotalCents: number;

  /**
   * KULUJEN PALAUTUS: asiakkaan maksama osuus joka menee sille joka kulun
   * maksoi — se ei ole kenenkään tuottoa vaan takaisin omasta pussista.
   * Tarvikkeiden hankintahinta + alihankinnan toteutunut kulu.
   */
  reimbursementCents: number;
  /** Kenelle palautus kuuluu. `id` on maksaja, tuntematon maksaja jää pois. */
  byPayer: { id: string; cents: number }[];
  /**
   * MITÄ PERUSTAJILLE JÄÄ TÄLTÄ KEIKALTA: oma työ + tuntikate + alihankinnan
   * kate. Sama luku kuin `byFounder`-rivien summa — näkymän ei tarvitse
   * laskea sitä uudelleen eikä se voi silloin unohtaa alihankinnan katetta.
   */
  founderTotalCents: number;

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

/** Yksi kulurivi laskulla. Alihankinta on YKSI luku: kulu + kate. */
export interface HourlyCostLine {
  id: string;
  kind: ProjExpense["kind"];
  desc: string;
  /** Mitä asiakas maksaa tästä rivistä. */
  customerCents: number;
  /** Toteutunut kulu (alihankinnassa ilman katetta). Ei mene asiakkaalle. */
  costCents: number;
  /** Kate (vain alihankinta). Ei mene asiakkaalle. */
  marginCents: number;
  /** Kuka maksoi kulun — tarvitaan kun rahat tasataan perustajien kesken. */
  paidBy?: string;
  hasReceipt: boolean;
}

export function computeHourlyMoney(
  data: Pick<ProjectData, "shifts" | "hourRateCents" | "workerHourCents" | "expenses">,
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
      byWorker.push({ id: row.id, hours: row.hours, isFounder: true, earnedCents: billed, perHourCents: hourRateCents, billedCents: billed });
      continue;
    }

    const pay = Math.round(row.hours * effectiveWorkerCents);
    // Kate on EROTUS eikä oma pyöristyksensä: näin osat summautuvat aina
    // laskutettavaan senttiin asti.
    const margin = Math.max(0, billed - pay);
    workerHours += row.hours;
    workerCostCents += pay;
    marginCents += margin;
    byWorker.push({ id: row.id, hours: row.hours, isFounder: false, earnedCents: pay, perHourCents: effectiveWorkerCents, billedCents: billed });
  }

  /**
   * KULUT. Kaksi lajia, eri säännöillä:
   *
   *   · asiakkaalle merkityt tarvikkeet (`forCustomer`) menevät LÄPI sellaisenaan
   *     — ostimme lamput asiakkaalle, asiakas maksaa lamput;
   *   · alihankinta (`subcontract`) veloitetaan AINA ja sen päälle tulee kate,
   *     joka jaetaan perustajien kesken kuten tuntikate.
   *
   * Alihankintaa ei suodateta `forCustomer`illa: se on määritelmällisesti
   * asiakkaalle välitettyä työtä. Merkinnän unohtaminen jättäisi laskulta
   * satojen eurojen rivin.
   */
  const costLines: HourlyCostLine[] = [];
  let customerCostCents = 0, subcontractCostCents = 0, subcontractMarginCents = 0;
  for (const e of data.expenses ?? []) {
    const isSub = e.kind === "subcontract";
    if (!isSub && e.forCustomer !== true) continue;
    const cost = Math.max(0, Math.round(e.amountCents || 0));
    const margin = isSub ? Math.max(0, Math.round(e.marginCents || 0)) : 0;
    const customerCents = expenseCustomerCents(e);
    if (customerCents <= 0) continue;
    if (isSub) { subcontractCostCents += cost; subcontractMarginCents += margin; }
    else customerCostCents += cost;
    costLines.push({
      id: e.id, kind: e.kind, desc: e.desc, customerCents, costCents: cost, marginCents: margin,
      paidBy: e.forWhom || e.by || undefined,
      hasReceipt: !!((e as any).receiptAssetId || e.receiptDataUrl),
    });
  }
  costLines.sort((a, b) => b.customerCents - a.customerCents);

  // Alihankinnan kate jaetaan samalla säännöllä kuin tuntikate.
  const marginShare = splitEvenly(marginCents + subcontractMarginCents, FOUNDER_IDS);
  // `Array.from` eikä spread: käännöskohde ei iteroi Map-avaimia suoraan.
  const founderIds = Array.from(new Set(FOUNDER_IDS.concat(Array.from(founderWage.keys()))));
  const byFounder: HourlyFounderRow[] = founderIds.map((id) => {
    const wageCents = founderWage.get(id) ?? 0;
    const mCents = marginShare.get(id) ?? 0;
    return { id, wageCents, marginCents: mCents, totalCents: wageCents + mCents };
  }).filter((r) => r.totalCents > 0 || FOUNDER_IDS.includes(r.id));

  /**
   * KULUJEN PALAUTUS MAKSAJITTAIN.
   *
   * Ilman tätä keikan raha ei mene tasan: asiakkaalta 1000 €, tekijöille
   * 300 €, meille 400 € — ja 300 € jää selittämättä. Se 300 € on kulu jonka
   * joku maksoi omasta pussistaan, ja se kuuluu takaisin hänelle. Kohdentamaton
   * raha ei ole tuottoa eikä sitä saa arvata: siksi maksaja luetaan riviltä
   * (`paidBy`), eikä sitä jaeta kenellekään jos sitä ei tiedetä.
   */
  const payerTotals = new Map<string, number>();
  let reimbursementCents = 0;
  for (const line of costLines) {
    const back = line.costCents;
    if (back <= 0) continue;
    reimbursementCents += back;
    if (line.paidBy) payerTotals.set(line.paidBy, (payerTotals.get(line.paidBy) ?? 0) + back);
  }
  const byPayer = Array.from(payerTotals.entries())
    .map(([id, cents]) => ({ id, cents }))
    .sort((a, b) => b.cents - a.cents);

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
    customerCostCents,
    subcontractCostCents,
    subcontractMarginCents,
    costLines,
    customerTotalCents: billableCents + customerCostCents + subcontractCostCents + subcontractMarginCents,
    reimbursementCents,
    byPayer,
    founderTotalCents: founderWageCents + marginCents + subcontractMarginCents,
    rateInverted,
  };
}

/**
 * LASKUN ERITTELY tuntikeikalta — ja tarkistus että se täsmää laskutettavaan.
 *
 * Sama kuvio kuin keltaisten `p2Itemisation`illa, ja samasta syystä: summa ja
 * erittely lasketaan samasta datasta samalla säännöllä, joten ero niiden
 * välillä tarkoittaa vikaa. Silloin laskua EI lähetetä — väärä lasku on
 * pahempi kuin lähettämätön.
 *
 * MERKITYT IKKUNAT OVAT ERITTELYSSÄ TIETONA, EIVÄT VELOITUKSENA. Tuntikeikalla
 * työ on jo laskutettu tunneissa; sama työ toiseen kertaan ikkunahinnalla olisi
 * kaksinkertainen veloitus. Luku kerrotaan silti, koska asiakas näkee siitä
 * mitä tunneilla on saatu aikaan.
 */
export interface HourlyInvoiceLine {
  label: string;
  /** Senttiä. `null` = pelkkä tieto, ei veloitusta (esim. pestyt ikkunat). */
  cents: number | null;
}

export interface HourlyItemisation {
  lines: HourlyInvoiceLine[];
  /** Veloitettavien rivien summa. */
  totalCents: number;
  /** Laskentakoneen kokonaissumma, johon tämän pitää täsmätä. */
  customerTotalCents: number;
  matchesBilling: boolean;
  money: HourlyMoney;
}

/** Varanimi kulun riville kun kuvaus on jätetty tyhjäksi. */
const COST_KIND_LABEL: Record<string, string> = {
  transport: "Kuljetus",
  materials: "Tarvikkeet",
  equipment: "Välineet",
  subcontract: "Alihankinta",
  other: "Hankinta",
};

export function hourlyItemisation(
  data: Pick<ProjectData, "shifts" | "hourRateCents" | "workerHourCents" | "expenses"
    | "marks" | "customMarks" | "deleted" | "statuses" | "building" | "pricePerWindow">,
  opts?: { today?: string },
): HourlyItemisation {
  const money = computeHourlyMoney(data, { today: opts?.today });
  const lines: HourlyInvoiceLine[] = [];

  if (money.billableCents > 0) {
    const people = money.byWorker.length;
    const hours = money.totalHours.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
    const rate = (money.hourRateCents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    lines.push({
      label: `Tuntityö ${hours} h × ${rate} € · ${people} ${people === 1 ? "tekijä" : "tekijää"}`,
      cents: money.billableCents,
    });
  }

  for (const c of money.costLines) {
    // Alihankinta yhtenä lukuna: kulu + kate. Erittely paljastaisi ostohinnan.
    // KUVAUS ON VAPAAEHTOINEN, joten laskulla ei saa olla nimetöntä riviä:
    // ilman varanimeä asiakas näkisi tyhjän selitteen ja summan vieressä.
    const label = c.kind === "subcontract"
      ? (c.desc ? `Alihankinta · ${c.desc}` : "Alihankinta")
      : (c.desc || COST_KIND_LABEL[c.kind] || "Hankinta");
    lines.push({ label, cents: c.customerCents });
  }

  // Pestyt ikkunat TIETONA. `computeProjectTotals` on sama laskenta jota kartta
  // käyttää, joten luku ei voi olla eri mieltä näkymän kanssa.
  try {
    const t = computeProjectTotals(data as ProjectData);
    if (t.washed > 0) lines.push({ label: `Pesty ${t.washed} ikkunaa`, cents: null });
  } catch { /* kartaton keikka: ei ikkunariviä */ }

  const totalCents = lines.reduce((sum, l) => sum + (l.cents ?? 0), 0);
  return {
    lines,
    totalCents,
    customerTotalCents: money.customerTotalCents,
    matchesBilling: totalCents === money.customerTotalCents,
    money,
  };
}
