/**
 * TUNTILASKUTUKSEN KAUSI — mitä on tehty EDELLISEN tuntilaskun jälkeen.
 *
 * MIKSI TÄMÄ ON OLEMASSA. Tuntivirran laskut olivat pelkkiä euroja: maksurivi
 * sanoi "laskutettu 884 €", mutta ei sitä MITKÄ tunnit ja kulut sillä olivat.
 * Lasku itse meni oikein (kertymä − jo laskutettu), mutta kaikki muu näytti
 * koko keikan:
 *
 *   · tuntinäkymä näytti laskun jälkeenkin kaikki keikan tunnit — luku ei
 *     nollautunut koskaan, joten kysymykseen "paljonko on tehty edellisen
 *     laskun jälkeen" ei ollut vastausta;
 *   · jokainen kulu näkyi yhä "takaisin maksajalle", myös ne jotka edellinen
 *     lasku oli jo perinyt ja jotka oli jo maksettu takaisin.
 *
 * Nyt jokainen tuntivirran lasku tallentaa KATTAVUUTENSA (`HoursInvoiceCover`):
 * kunkin tekijän tunnit ja laskulla olleet kulurivit lähetyshetkellä. Kausi on
 * kaikki mikä on kertynyt sen jälkeen.
 *
 * KATTAVUUS ON SUMMA PER TEKIJÄ JA PÄIVÄ, EI RIVILISTA. Käsin kirjatut tunnit
 * yhdistyvät yhteen riviin per tekijä ja päivä (`addShiftEntry`), joten sama
 * rivi voi sisältää sekä laskutettuja että laskuttamattomia tunteja. Summa ei
 * välitä siitä: avoin = nyt − laskutettu, solu kerrallaan.
 *
 * VANHA LASKU ILMAN KATTAVUUTTA päätellään aikaleimoista: lasku laskutti aina
 * koko laskuttamattoman kertymän, joten kaikki ennen sen lähetystä kirjattu oli
 * laskulla. Ks. `inferHoursCover` siitä mihin päättely ei yllä.
 *
 * LASKUN SUMMA TULEE YHÄ RAHASTA. Seuraava lasku perii `remainingCents`:
 * kertymä − jo laskutettu, kuten ennenkin. Kauden erittely kertoo mistä se
 * koostuu, ja jos ne eivät täsmää (laskutettua tuntia on korjattu jälkikäteen,
 * hinta on muuttunut tai kulu poistettu), ero on näkyvissä omana rivinään
 * (`adjustmentCents`) eikä katoa mihinkään.
 */

import {
  computeShiftStats, customerChargeableExpenses, dayKey, fmtShiftHours,
  type ProjectData, type ProjShift,
} from "./project";
import { computeHourlyMoney, type HourlyInvoiceLine, type HourlyMoney } from "./hourly-money";
import type { HoursInvoiceCover } from "./gig";

/** Mitä tämä moduuli tarvitsee maksuriviltä. `GigPayment` käy sellaisenaan. */
export interface HoursPaymentLike {
  t: number;
  amountCents: number;
  scope?: string;
  parts?: { hours?: number; p2?: number };
  voided?: boolean;
  cover?: HoursInvoiceCover;
}

/** Onko maksurivi tuntivirran lasku (tuntilasku tai yhdistetyn laskun tuntiosa)? */
export function isHoursStreamPayment(p: HoursPaymentLike | null | undefined): boolean {
  if (!p || p.voided) return false;
  if (p.scope === "hours") return true;
  return p.scope === "all" && Math.round(p.parts?.hours ?? 0) > 0;
}

/** Tuntivirran osuus maksurivistä senttiä. Yhdistetyllä laskulla `parts.hours`. */
export function hoursStreamCents(p: HoursPaymentLike): number {
  if (p.scope === "hours") return Math.max(0, Math.round(p.amountCents || 0));
  if (p.scope === "all") return Math.max(0, Math.round(p.parts?.hours ?? 0));
  return 0;
}

/**
 * Kirjatut tunnit tekijä → päivä — samat solut kuin tuntinäkymällä
 * (`computeShiftStats`), eli päivä ei mene miinukselle eikä korjausrivi syö
 * toisen päivän tunteja.
 */
function cellsOf(shifts: ProjShift[] | undefined): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const d of computeShiftStats(shifts ?? []).byDay) {
    for (const w of d.workers) {
      const row = out[w.id] ?? (out[w.id] = {});
      row[d.day] = w.hours;
    }
  }
  return out;
}

/**
 * KATTAVUUS LÄHETYSHETKELLÄ — palvelin tallentaa tämän maksuriville.
 *
 * Kaikki on kumulatiivista ("tähän laskuun mennessä"), paitsi `windowsCents`,
 * joka on tällä laskulla veloitettu ikkunaraha. Ikkunoiden laskutusmerkintä
 * elää keikan sektoreilla, joten niiden kumulatiivinen tila on jo siellä.
 */
export function buildHoursCover(
  project: Pick<ProjectData, "shifts" | "expenses">,
  opts: { windowsCents: number; partial?: boolean },
): HoursInvoiceCover {
  return {
    hours: cellsOf(project.shifts),
    expenseIds: customerChargeableExpenses(project).map((l) => l.id),
    windowsCents: Math.max(0, Math.round(opts.windowsCents || 0)),
    ...(opts.partial ? { partial: true } : {}),
  };
}

/**
 * VANHAN LASKUN KATTAVUUS PÄÄTELTYNÄ AIKALEIMOISTA.
 *
 * Lasku laskutti aina koko laskuttamattoman kertymän (käyttöliittymä ei lähetä
 * osasummaa), joten kaikki ennen lähetystä kirjattu oli laskulla: vuorot joiden
 * kirjaushetki `at` ≤ lähetys, ja kulut joiden aikaleima `ts` ≤ lähetys.
 *
 * MIHIN PÄÄTTELY EI YLLÄ: jos samalle tekijälle ja päivälle kirjattiin käsin
 * lisää vasta laskun jälkeen, `addShiftEntry` yhdisti sen vanhaan riviin ja
 * siirsi rivin kirjaushetken eteenpäin. Ennen laskua kirjattu osa näyttää
 * silloin uudelta. Siksi laskutettuun päivään ei enää yhdistetä
 * (`addShiftEntry`n `lockedAt`), ja jokainen uusi lasku tallentaa kattavuutensa
 * — päättelyä tarvitaan vain jo lähetetyille laskuille.
 */
export function inferHoursCover(
  project: Pick<ProjectData, "shifts" | "expenses">,
  at: number,
): HoursInvoiceCover {
  return {
    hours: cellsOf((project.shifts ?? []).filter((s) => (s.at || 0) <= at)),
    expenseIds: customerChargeableExpenses({
      expenses: (project.expenses ?? []).filter((e) => (e.ts || 0) <= at),
    }).map((l) => l.id),
    // Tuntematon. Vanhan laskun ikkunaosuutta ei tallennettu.
    windowsCents: 0,
  };
}

/** Viimeisimmän tuntilaskun hetki — laskutettuun riviin ei enää yhdistetä. */
export function lastHoursInvoiceAt(payments: HoursPaymentLike[] | null | undefined): number | undefined {
  let at: number | undefined;
  for (const p of payments ?? []) {
    if (!isHoursStreamPayment(p) || p.cover?.partial) continue;
    if (at === undefined || p.t > at) at = p.t;
  }
  return at;
}

export interface HoursPeriodInvoice {
  /** Lähetyshetki (ms). */
  at: number;
  /** Tuntivirran osuus tästä laskusta. */
  amountCents: number;
  /** `true` = tallennettu kattavuus; `false` = päätelty aikaleimoista. */
  exact: boolean;
}

export interface HoursPeriod {
  /** Viimeisin tuntivirran lasku joka siirsi kauden alkua, tai null. */
  last: HoursPeriodInvoice | null;
  /** Montako tuntivirran laskua on lähetetty (mitätöidyt pois). */
  invoiceCount: number;
  /** Tuntivirran laskut yhteensä. Sama luku kuin `hoursInvoicedCents`. */
  invoicedCents: number;
  /** Edellisen laskun jälkeen kirjatut tunnit tekijöittäin, suurin ensin. */
  openByWorker: { id: string; hours: number }[];
  /** Samat tunnit päivittäin (uusin ensin) — kalenteri näyttää mikä on laskuttamatta. */
  openByDay: { day: string; hours: number; workers: { id: string; hours: number }[] }[];
  openHours: number;
  /** Laskutetut tunnit lähetyshetkellä (kaikki tekijät). */
  invoicedHours: number;
  /** Jo laskutettuja tunteja joita on sen jälkeen vähennetty tai poistettu. */
  reducedHours: number;
  /** Asiakkaalta veloitettavat kulut joita ei ole vielä laskutettu. */
  openExpenseIds: string[];
  /** Kulut jotka olivat jo laskulla. */
  invoicedExpenseIds: string[];
  /** Kauden raha: avoimet tunnit + avoimet kulut + laskuttamattomat ikkunat. */
  money: HourlyMoney;
  /** Koko keikan raha, kumulatiivisesti. */
  lifetime: HourlyMoney;
  /** Mitä seuraava tuntilasku perii. */
  remainingCents: number;
  /**
   * Seuraavan laskun summa − kauden erittely. Nolla kun kaikki täsmää.
   * Muu kuin nolla = jo laskutettua on muutettu jälkikäteen: tunteja korjattu
   * alas tai poistettu, laskutettu kulu poistettu, tai tuntihinta vaihdettu
   * (hinta koskee myös jo laskutettuja tunteja).
   */
  adjustmentCents: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * KAUSI JA SEURAAVAN LASKUN SUMMA — yksi laskenta, jota tuntinäkymä,
 * keikkasivun laskutuskortti ja palvelimen lähetys kaikki lukevat.
 *
 * `uninvoicedWindows` tulee keikan sektoreilta (`washed − invoicedWashed`),
 * kuten `computeHourlyMoney`llekin.
 */
export function computeHoursPeriod(
  project: ProjectData,
  payments: HoursPaymentLike[] | null | undefined,
  opts?: { uninvoicedWindows?: number; today?: string },
): HoursPeriod {
  const today = opts?.today ?? dayKey();
  const uninvoicedWindows = opts?.uninvoicedWindows;
  const stream = (payments ?? []).filter(isHoursStreamPayment).slice().sort((a, b) => a.t - b.t);
  const invoicedCents = stream.reduce((s, p) => s + hoursStreamCents(p), 0);

  // Kauden alku = uusin lasku joka kattoi kaiken. Osalasku ei siirrä sitä.
  let anchor: HoursPaymentLike | null = null;
  for (const p of stream) if (!p.cover?.partial) anchor = p;
  const cover = anchor ? (anchor.cover ?? inferHoursCover(project, anchor.t)) : null;

  const lifetime = computeHourlyMoney(project, { uninvoicedWindows, today });

  /**
   * TUNNIT: avoin = nyt − laskutettu, SOLU KERRALLAAN (tekijä × päivä).
   *
   * Päivätasolla eikä tekijän summana, koska muuten laskutetun päivän korjaus
   * ja laskun jälkeen tehty uusi työ kuittaisivat toisensa: tunti pois
   * maanantailta ja kaksi uutta torstaina näkyisi "1 h laskuttamatta". Nyt se
   * näkyy kahtena uutena tuntina ja yhden tunnin korjauksena.
   */
  const now = cellsOf(project.shifts);
  const covered = cover?.hours ?? {};
  const open = new Map<string, number>();
  const dayMap = new Map<string, Map<string, number>>();
  let reducedHours = 0;
  let invoicedHours = 0;
  for (const id of Array.from(new Set(Object.keys(now).concat(Object.keys(covered))))) {
    const nRow = now[id] ?? {};
    const cRow = covered[id] ?? {};
    for (const day of Array.from(new Set(Object.keys(nRow).concat(Object.keys(cRow))))) {
      const n = nRow[day] ?? 0;
      const c = cRow[day] ?? 0;
      invoicedHours += c;
      if (n > c) {
        const h = round2(n - c);
        open.set(id, round2((open.get(id) ?? 0) + h));
        const dm = dayMap.get(day) ?? new Map<string, number>();
        dm.set(id, round2((dm.get(id) ?? 0) + h));
        dayMap.set(day, dm);
      } else if (c > n) reducedHours += c - n;
    }
  }
  const openByWorker = Array.from(open.entries())
    .map(([id, hours]) => ({ id, hours }))
    .sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id));
  const openByDay = Array.from(dayMap.entries())
    .map(([day, m]) => {
      const workers = Array.from(m.entries()).map(([id, hours]) => ({ id, hours }))
        .sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id));
      return { day, hours: round2(workers.reduce((x, w) => x + w.hours, 0)), workers };
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const openHours = round2(openByWorker.reduce((x, r) => x + r.hours, 0));

  // KULUT: laskulla olleet erotetaan uusista rivin tunnuksella.
  const coveredExpenses = new Set(cover?.expenseIds ?? []);
  const chargeable = customerChargeableExpenses(project);
  const openExpenseIds = chargeable.filter((l) => !coveredExpenses.has(l.id)).map((l) => l.id);
  const invoicedExpenseIds = chargeable.filter((l) => coveredExpenses.has(l.id)).map((l) => l.id);
  const openSet = new Set(openExpenseIds);

  /**
   * KAUDEN RAHA SAMALLA FUNKTIOLLA KUIN KOKO KEIKAN. Avoimet tunnit annetaan
   * yhtenä rivinä per tekijä, jolloin perustajan tunti, työntekijän palkka,
   * kate ja sen jako lasketaan täsmälleen samoilla säännöillä — kausi ei voi
   * laskea rahaa eri tavalla kuin lasku.
   */
  const periodShifts: ProjShift[] = openByWorker.map((r, i) => ({
    id: `kausi-${i}`, worker: r.id, day: today, hours: r.hours, at: 0,
  }));
  const money = computeHourlyMoney(
    { ...project, shifts: periodShifts, expenses: (project.expenses ?? []).filter((e) => openSet.has(e.id)) },
    { uninvoicedWindows, today },
  );

  /**
   * SEURAAVAN LASKUN SUMMA — kertymä − jo laskutettu, kuten ennenkin, MUTTA
   * LASKUTETUT IKKUNAT PALAUTETAAN VERTAILUUN.
   *
   * Kertymässä ikkunat ovat vain LASKUTTAMATTOMAT (keikan sektoreilta), tunnit
   * ja kulut taas koko keikan ajalta. Lasku joka veloitti ikkunat siirsi niiden
   * merkinnän laskutetuksi, jolloin ne putosivat kertymästä — mutta niiden euro
   * jäi "jo laskutettuun". Seuraava lasku jäi juuri sen verran vajaaksi.
   * Laskulla veloitettu ikkunaraha (`cover.windowsCents`) lisätään siksi
   * takaisin. Vanhalla laskulla sitä ei tiedetä (0), joten summa on täsmälleen
   * sama kuin ennen tätä muutosta.
   */
  const windowsInvoicedCents = stream.reduce((s, p) => s + Math.min(hoursStreamCents(p), p.cover?.windowsCents ?? 0), 0);
  const remainingCents = Math.max(0, lifetime.customerTotalCents - invoicedCents + windowsInvoicedCents);

  return {
    last: anchor ? { at: anchor.t, amountCents: hoursStreamCents(anchor), exact: !!anchor.cover } : null,
    invoiceCount: stream.length,
    invoicedCents,
    openByWorker,
    openByDay,
    openHours,
    invoicedHours: round2(invoicedHours),
    reducedHours: round2(reducedHours),
    openExpenseIds,
    invoicedExpenseIds,
    money,
    lifetime,
    remainingCents,
    adjustmentCents: remainingCents - money.customerTotalCents,
  };
}

/**
 * SEURAAVAN LASKUN RIVIT — kauden erittely, joka summautuu laskun summaan.
 *
 * Sama rivimuoto kuin `hourlyItemisation`illa, mutta vain kauden tunnit ja
 * kulut. Ensimmäisellä laskulla kausi on koko keikka, joten rivit ovat samat.
 * Jos jo laskutettua on muutettu, ero on oma rivinsä — rivit summautuvat aina
 * laskun summaan, eikä yksikään euro jää selittämättä.
 */
export function hoursPeriodLines(period: HoursPeriod): HourlyInvoiceLine[] {
  const m = period.money;
  const lines: HourlyInvoiceLine[] = [];
  const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (m.billableCents > 0) {
    const people = m.byWorker.length;
    lines.push({
      label: `Tuntityö ${fmtShiftHours(m.totalHours)} h × ${eur(m.hourRateCents)} € · ${people} ${people === 1 ? "tekijä" : "tekijää"}`,
      cents: m.billableCents,
    });
  }
  // Alihankinta yhtenä rivinä ja asiakkaan omalla nimellä — sama sääntö kuin
  // koko keikan erittelyssä (`customerLabel`, ei sisäistä kuvausta).
  for (const c of m.costLines) lines.push({ label: c.customerLabel, cents: c.customerCents });
  const w = m.windows;
  if (w && w.uninvoicedWindows > 0) {
    lines.push({
      label: `Ikkunanpesu ${w.uninvoicedWindows} ikkunaa × ${eur(w.pricePerWindowCents)} €`,
      cents: w.uninvoicedCents,
    });
  }
  if (period.adjustmentCents !== 0) {
    lines.push({ label: "Korjaus aiemmin laskutettuun", cents: period.adjustmentCents });
  }
  return lines;
}
