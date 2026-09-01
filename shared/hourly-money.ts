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
import { getCrew, DEFAULT_WORKER_PER_WINDOW_CENTS } from "./crew";
import {
  computeShiftStats, computeProjectTotals, expenseCustomerCents, expenseCustomerLabel, hourRateOf, workerHourRateOf,
  pricePerWindowOf, allPoints, customerChargeableExpenses,
  type CustomerChargeLine,
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
  /**
   * IKKUNARAHA. `null` kun keikalla ei ole karttaa lainkaan.
   *
   * Ikkunatyö on OMA veloituksensa tuntien rinnalla, ei niiden sisällä:
   * ikkunat on pesty ikkunahinnalla (usein ennen tuntitilaan siirtymistä),
   * eivätkä ne ole samaa työtä kuin tunneille kirjattu aika. Laskulle menee
   * vain laskuttamaton osa — `windowsCents`.
   */
  windows: WindowMoney | null;
  /** Mitä ikkunoista veloitetaan TÄLLÄ kertymällä (laskuttamaton osuus). */
  windowsCents: number;
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

/** Yksi kulurivi laskulla. Alihankinta on YKSI luku: kulu + kate.
 *  Sama tyyppi kuin lisätyölaskulla — sääntö on jaettu, joten tyyppi on myös. */
export type HourlyCostLine = CustomerChargeLine;

export function computeHourlyMoney(
  data: Pick<ProjectData, "shifts" | "hourRateCents" | "workerHourCents" | "expenses">,
  opts?: { today?: string; stats?: ShiftStats; uninvoicedWindows?: number },
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
  // Sääntö on `customerChargeableExpenses`issa, koska SAMA sääntö ratkaisee
  // myös kohdennetun keikan lisätyölaskun. Kaksi kopiota tarkoittaisi kaksi
  // laskua jotka voivat olla eri mieltä siitä mikä on asiakkaan kulu.
  const costLines: HourlyCostLine[] = customerChargeableExpenses(data);
  let customerCostCents = 0, subcontractCostCents = 0, subcontractMarginCents = 0;
  for (const c of costLines) {
    if (c.kind === "subcontract") { subcontractCostCents += c.costCents; subcontractMarginCents += c.marginCents; }
    else customerCostCents += c.costCents;
  }

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

  /**
   * Ikkunaraha lasketaan vain kun keikalla on kartta. Kartaton keikka
   * (pelkkä tuntityö) ei saa kaatua siihen että ikkunalaskenta yrittää lukea
   * kerroksia joita ei ole.
   */
  let windows: WindowMoney | null = null;
  try {
    const w = computeWindowMoney(data as ProjectData, { uninvoicedWindows: opts?.uninvoicedWindows });
    if (w.washedTotal > 0) windows = w;
  } catch { /* kartaton keikka: ei ikkunarahaa */ }
  const windowsCents = windows?.uninvoicedCents ?? 0;

  return {
    windows,
    windowsCents,
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
    customerTotalCents: billableCents + customerCostCents + subcontractCostCents + subcontractMarginCents + windowsCents,
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

export function hourlyItemisation(
  data: Pick<ProjectData, "shifts" | "hourRateCents" | "workerHourCents" | "expenses"
    | "marks" | "customMarks" | "deleted" | "statuses" | "building" | "pricePerWindow">,
  opts?: { today?: string; uninvoicedWindows?: number },
): HourlyItemisation {
  const money = computeHourlyMoney(data, { today: opts?.today, uninvoicedWindows: opts?.uninvoicedWindows });
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
    //
    // JA YHTENÄ NIMENÄ, joka on aina asiakkaalle kirjoitettu: `customerLabel`
    // tulee `expenseCustomerLabel`ista eikä `desc`istä. Sisäinen kuvaus on
    // alihankkijan nimi ja sovittu hinta — se on juuri se mitä lasku ei kerro.
    // Kenttä ei voi olla tyhjä, joten nimetöntä riviä ei synny.
    lines.push({ label: c.customerLabel, cents: c.customerCents });
  }

  /**
   * PESTYT IKKUNAT — VELOITUS, EI PELKKÄ TIETO.
   *
   * Aiemmin tämä oli tietorivi ilman euroa, perusteena ettei samaa työtä
   * veloiteta kahdesti: tuntikeikalla työ on jo tunneissa. Perustelu ei pidä
   * paikkaansa silloin kun ikkunat on pesty ikkunahinnalla — usein ennen kuin
   * keikka siirtyi tuntitilaan — eikä niistä ole kirjattu tunteja. Ne ovat eri
   * työtä ja eri rahaa, ja tuntinäkymässä ei ollut mitään muutakaan tapaa
   * laskuttaa niitä: urakan ja keltaisten laskunapit eivät näy tuntikeikalla.
   *
   * Veloitetaan siis LASKUTTAMATON osuus, ja vain se. Merkinnän pitää
   * (`invoicedWashed`) siirtyä lähetyksessä, tai sama ikkuna laskutetaan
   * uudelleen ensi kerralla.
   */
  const w = money.windows;
  if (w && w.uninvoicedWindows > 0) {
    const price = (w.pricePerWindowCents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    lines.push({
      label: `Ikkunanpesu ${w.uninvoicedWindows} ikkunaa × ${price} €`,
      cents: w.uninvoicedCents,
    });
    // Jo laskutetut kerrotaan tietona, ettei rivin luku näytä siltä kuin osa
    // pesuista olisi kadonnut. Ei euroa: se on jo veloitettu aiemmin.
    const already = Math.round(w.washedTotal) - w.uninvoicedWindows;
    if (already > 0) lines.push({ label: `Aiemmin laskutettu ${already} ikkunaa`, cents: null });
  } else if (w && w.washedTotal > 0) {
    lines.push({ label: `Pesty ${Math.round(w.washedTotal)} ikkunaa · laskutettu`, cents: null });
  }

  const totalCents = lines.reduce((sum, l) => sum + (l.cents ?? 0), 0);
  return {
    lines,
    totalCents,
    customerTotalCents: money.customerTotalCents,
    matchesBilling: totalCents === money.customerTotalCents,
    money,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * IKKUNARAHA TUNTIKEIKALLA
 *
 * Tuntikeikka ei ole pelkkä tuntikeikka. Sama kohde on voitu pestä
 * ikkunahinnalla ennen kuin tuntitilaan siirryttiin, ja ne pesut ovat rahaa
 * joka on yhä laskuttamatta. Ikkunapuoli on edelleen käytössä: ikkunoita
 * merkitään pestyiksi ja ne kohdistuvat tekijöihin.
 *
 * TÄMÄ OLI RIKKI KAHDESTI, JA MOLEMMAT MAKSOIVAT MEILLE.
 *
 *   1. Tuntikeikan laskulla pestyt ikkunat olivat pelkkä TIETORIVI ilman euroa,
 *      eikä tuntinäkymässä ollut mitään muutakaan tapaa laskuttaa niitä:
 *      urakan ja keltaisten laskunapit eivät näy tuntikeikalla lainkaan.
 *      Ikkunatyö ei siis päätynyt yhdellekään laskulle.
 *   2. Pahempi: lasku kuittasi ne silti laskutetuiksi. Lähetys ajoi
 *      `s.invoicedWashed = s.washed` kaikille muille paitsi keltaisille, joten
 *      tuntilasku merkitsi jokaisen pestyn ikkunan laskutetuksi veloittamatta
 *      niistä senttiäkään. Raha ei jäänyt odottamaan — se katosi.
 *
 * Sääntö on sama kuin tunneilla, sana vaihdettuna:
 *   · TEKIJÄN ikkuna: hän saa oman ikkunapalkkansa, erotus on katetta ja
 *     jaetaan tasan perustajien kesken;
 *   · PERUSTAJAN ikkuna: katetta ei oteta lainkaan — se on omaa työtä, ja koko
 *     ikkunahinta on hänen.
 *
 * Jaettu ikkuna (`washedBy2`) on puolikas kummallekin, kuten muuallakin.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface WindowWasherRow {
  id: string;
  /** Puolikkaita voi tulla: yhdessä pesty ikkuna on 0,5 kummallekin. */
  windows: number;
  isFounder: boolean;
  /** Mitä tästä kuuluu hänelle. Perustajalla koko ikkunahinta, tekijällä oma. */
  earnedCents: number;
  /** Millä hinnalla hänen ikkunansa on laskettu — tekijän palkka tai täysi hinta. */
  perWindowCents: number;
}

export interface WindowMoney {
  /** Asiakkaan ikkunahinta sentteinä. Sama kuin keikan sektoreilla. */
  pricePerWindowCents: number;
  /** Pesty yhteensä koko keikan ajalta (kohdistettu; puolikkaat mukana). */
  washedTotal: number;
  /** Laskuttamatta olevat ikkunat ja niiden hinta — TÄMÄ menee laskulle. */
  uninvoicedWindows: number;
  uninvoicedCents: number;
  byWasher: WindowWasherRow[];
  /** Tekijöiden ikkunapalkka yhteensä (koko keikan ajalta). */
  workerCostCents: number;
  /** Perustajien omista ikkunoista suoraan heille. */
  founderWindowCents: number;
  /** Tekijöiden ikkunoista jäävä kate. */
  marginCents: number;
  byFounder: { id: string; windowCents: number; marginCents: number; totalCents: number }[];
  /** Mitä asiakas maksaa kaikista pestyistä ikkunoista (elinikäinen kertymä). */
  customerCents: number;
}

/**
 * @param uninvoiced Montako pestyä ikkunaa on yhä laskuttamatta. Luku tulee
 *   keikan sektoreilta (`washed − invoicedWashed`), koska laskutusmerkintä
 *   elää siellä eikä projektikartalla. Puuttuessaan kaikki ovat laskuttamatta.
 */
export function computeWindowMoney(
  data: Pick<ProjectData, "marks" | "customMarks" | "deleted" | "statuses" | "building" | "pricePerWindow" | "washedBy2" | "crew" | "workers">,
  opts?: { uninvoicedWindows?: number },
): WindowMoney {
  const pricePerWindowCents = Math.round(pricePerWindowOf(data as ProjectData) * 100);
  const crew = getCrew(data as ProjectData);
  const memberOf = (id: string) => crew.find((m) => m.id === id);
  /** Perustaja joko tiimilistan tai crew-roolin mukaan — kumpi tahansa riittää. */
  const isFounderId = (id: string) => isFounder(id) || memberOf(id)?.role === "host";
  const workerRateOf = (id: string) => memberOf(id)?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS;

  // Kohdistus samalla säännöllä kuin `computeWorkerStats`: yhdessä pesty ikkuna
  // on puolikas kummallekin. Eri sääntö tarkoittaisi että sama ikkuna maksetaan
  // eri tavalla riippuen siitä mikä näkymä sen laskee.
  const washedBy2 = (data as ProjectData).washedBy2 || {};
  const credit = new Map<string, number>();
  let washedTotal = 0;
  for (const p of allPoints(data as ProjectData)) {
    if (p.status !== "pesty") continue;
    washedTotal += 1;
    const second = washedBy2[p.key];
    if (p.washedBy) credit.set(p.washedBy, (credit.get(p.washedBy) ?? 0) + (second ? 0.5 : 1));
    if (second) credit.set(second, (credit.get(second) ?? 0) + 0.5);
  }

  const byWasher: WindowWasherRow[] = [];
  const founderWindow = new Map<string, number>();
  let workerCostCents = 0, founderWindowCents = 0, marginCents = 0;

  for (const [id, windows] of Array.from(credit.entries())) {
    if (windows <= 0) continue;
    const billed = Math.round(windows * pricePerWindowCents);
    if (isFounderId(id)) {
      // Omaa työtä: koko ikkunahinta hänelle, ei katetta kenellekään.
      founderWindowCents += billed;
      founderWindow.set(id, (founderWindow.get(id) ?? 0) + billed);
      byWasher.push({ id, windows, isFounder: true, earnedCents: billed, perWindowCents: pricePerWindowCents });
      continue;
    }
    const rate = workerRateOf(id);
    // Käänteinen hinta on kirjausvirhe eikä tulos, kuten tunneillakin: tekijä
    // saa omansa, mutta katetta ei paineta miinukselle.
    const pay = Math.min(billed, Math.round(windows * rate));
    // Kate on EROTUS eikä oma pyöristyksensä — osat summautuvat senttiin asti.
    const margin = Math.max(0, billed - pay);
    workerCostCents += pay;
    marginCents += margin;
    byWasher.push({ id, windows, isFounder: false, earnedCents: pay, perWindowCents: rate });
  }
  byWasher.sort((a, b) => b.windows - a.windows);

  const marginShare = splitEvenly(marginCents, FOUNDER_IDS);
  const founderIds = Array.from(new Set(FOUNDER_IDS.concat(Array.from(founderWindow.keys()))));
  const byFounder = founderIds.map((id) => {
    const windowCents = founderWindow.get(id) ?? 0;
    const mCents = marginShare.get(id) ?? 0;
    return { id, windowCents, marginCents: mCents, totalCents: windowCents + mCents };
  }).filter((r) => r.totalCents > 0);

  /**
   * LASKUTTAMATTOMAT IKKUNAT. Merkintä siitä mitkä pesut on jo laskutettu elää
   * KEIKAN sektoreilla (`invoicedWashed`), ei projektikartalla — tämä laskenta
   * ei siis voi tietää sitä itse, vaan kutsuja kertoo sen.
   *
   * PUUTTUVA TIETO ON NOLLA, EI KAIKKI. Aluksi oletus oli "kaikki pestyt ovat
   * laskuttamatta", ja se oli väärä suunta: kutsuja joka ei tunne laskutustilaa
   * (esim. tuntipaneelin rahakortti, jolla on vain projektidata) olisi
   * näyttänyt jo laskutetut ikkunat uudelleen laskuttamattomina — sadan pesun
   * keikalla tuhansia euroja liikaa, ja se luku olisi näyttänyt laskun
   * summalta. Tuntematon laskutustila ei saa keksiä veloitusta; se kysytään.
   *
   * Rajataan pestyihin, ettei kirjausvirhe tuota laskulle ikkunoita joita ei
   * ole pesty.
   */
  const uninvoicedWindows = Math.max(0, Math.min(
    Math.round(washedTotal),
    Math.round(opts?.uninvoicedWindows ?? 0),
  ));

  return {
    pricePerWindowCents,
    washedTotal,
    uninvoicedWindows,
    uninvoicedCents: uninvoicedWindows * pricePerWindowCents,
    byWasher,
    workerCostCents,
    founderWindowCents,
    marginCents,
    byFounder,
    customerCents: workerCostCents + founderWindowCents + marginCents,
  };
}
