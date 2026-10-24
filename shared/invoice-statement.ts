/**
 * ASIAKKAAN ERITTELY — tuntilaskun liite: kuka teki mitäkin päivänä, ja miten
 * lasku on jaettu kahden laskuttajan kesken.
 *
 * MIKSI TÄMÄ ON OLEMASSA. Suuri tuntilasku jaetaan kahdelle laskuttajalle
 * (Joonatan 1/2, Matias 2/2), jolloin asiakas saa kaksi summaa mutta ei näe
 * mistä ne koostuvat. Liite näyttää kolme asiaa: (1) kumpi lasku sisältää
 * kenen tunnit ja että summat täsmäävät järjestelmän "seuraava lasku" -lukuun,
 * (2) kaikki päivät tekijöineen kuten projektinäkymän tuntilista, ja (3) muut
 * kulut tuntien lisäksi.
 *
 * EI UUTTA LASKENTAA. Tunnit, hinta ja kulut tulevat `computeHoursPeriod`ista
 * eli samasta funktiosta josta seuraavan laskun summa tulee. Tämä moduuli vain
 * JAKAA ne kahdelle laskulle — se ei laske rahaa uudelleen — ja tarkistaa että
 * jaon jälkeen osat summautuvat siihen mihin kokonaisuus summautui
 * (`reconciles`). Jos eivät, ero on näkyvissä eikä katoa.
 *
 * ASIAKAS EI NÄE SISÄISTÄ. Ei tuntipalkkaa, ei katetta, ei kuittia, ei
 * kulun sisäistä kuvausta: kulurivin teksti on `customerLabel` (alihankinta
 * on pelkkä "Alihankinta"), summa `customerCents`.
 *
 * JAKO TEHDÄÄN TEKIJÄ KERRALLAAN. Johtaja kertoo montako tuntia kunkin tekijän
 * tunneista on ensimmäisellä laskulla; loput ovat toisella. Tunnit kohdistetaan
 * päiville aikajärjestyksessä (vanhimmat päivät ensin), ja päivä jonka tunnit
 * jakautuvat kahdelle laskulle näkyy kahtena rivinä. Näin jokainen tunti on
 * tasan yhdellä laskulla.
 */

import { customerChargeableExpenses, fmtShiftHours, type ProjectData } from "./project";
import type { HoursPeriod } from "./hours-period";
import { resolveBrandBiller } from "./billers";

/** Laskun numero erittelyssä: 1 = ensimmäinen (1/2), 2 = toinen (2/2). */
export type StatementInvoiceNo = 1 | 2;

export interface StatementHourRow {
  worker: string;
  hours: number;
  invoice: StatementInvoiceNo;
}

export interface StatementDay {
  day: string;
  /** Päivän tunnit yhteensä (molemmat laskut). */
  hours: number;
  rows: StatementHourRow[];
}

export interface StatementExpense {
  id: string;
  /** Mitä asiakas näkee (ei sisäistä kuvausta). */
  label: string;
  kind: string;
  cents: number;
  invoice: StatementInvoiceNo;
  /** Kuka maksoi — tästä lasku on päätelty. `null` = tuntematon (meni laskulle 1). */
  payer: string | null;
}

export interface StatementInvoice {
  no: StatementInvoiceNo;
  billerId: string;
  billerName: string;
  yTunnus?: string;
  /** Tekijä → tunnit tällä laskulla, suurin ensin. */
  people: { worker: string; hours: number }[];
  hours: number;
  hoursCents: number;
  expenses: StatementExpense[];
  expensesCents: number;
  /** Ikkunaraha ja korjaus aiemmin laskutettuun — vain jos niitä on. Menee laskulle 1. */
  otherCents: number;
  totalCents: number;
}

export interface HoursStatement {
  /** Ensimmäinen ja viimeinen päivä jolla on tunteja ("YYYY-MM-DD"). */
  from: string | null;
  to: string | null;
  hourRateCents: number;
  invoices: [StatementInvoice, StatementInvoice];
  days: StatementDay[];
  /** Tekijä → tunnit yhteensä (molemmat laskut). */
  byWorker: { worker: string; hours: number; invoice1: number; invoice2: number }[];
  totalHours: number;
  totalHoursCents: number;
  totalExpensesCents: number;
  totalCents: number;
  /** Järjestelmän "seuraavalle laskulle" -summa, johon osat verrataan. */
  nextInvoiceCents: number;
  /** Osat summautuvat järjestelmän summaan (sentilleen). */
  reconciles: boolean;
  /** Jaosta puuttui tunteja tai se ylitti tekijän tunnit — selitykset käyttäjälle. */
  warnings: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Jaa jakso kahdelle laskulle.
 *
 * `firstHours[tekijä]` = montako tuntia tekijän jakson tunneista on laskulla 1
 * (loput laskulla 2). Puuttuva arvo = 0. Yli tekijän tuntimäärän oleva arvo
 * rajataan siihen ja siitä tulee varoitus — sitä ei hiljaa hyväksytä.
 *
 * Kulu kuuluu sille laskulle jonka laskuttaja sen maksoi (`forWhom`/`by`).
 * Tuntematon maksaja menee laskulle 1 ja siitä tulee varoitus.
 */
export function buildHoursStatement(
  project: ProjectData,
  period: HoursPeriod,
  opts: {
    billers: [string, string];
    firstHours: Record<string, number>;
  },
): HoursStatement {
  const warnings: string[] = [];
  const hourRateCents = period.money.hourRateCents;

  // ── Tunnit: tekijä kerrallaan aikajärjestyksessä ──────────────────────────
  const daysAsc = period.openByDay.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const workerIds = Array.from(new Set(daysAsc.flatMap((d) => d.workers.map((w) => w.id))));

  /** Tekijän jäljellä oleva laskun 1 kiintiö. */
  const quota = new Map<string, number>();
  for (const id of workerIds) {
    const total = round2(daysAsc.reduce((s, d) => s + (d.workers.find((w) => w.id === id)?.hours ?? 0), 0));
    const asked = Math.max(0, round2(Number(opts.firstHours[id]) || 0));
    if (asked > total) warnings.push(`${id}: laskulle 1 annettu ${fmtShiftHours(asked)} h, mutta tunteja on vain ${fmtShiftHours(total)} h.`);
    quota.set(id, Math.min(asked, total));
  }

  const days: StatementDay[] = daysAsc.map((d) => {
    const rows: StatementHourRow[] = [];
    for (const w of d.workers.slice().sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id))) {
      const left = quota.get(w.id) ?? 0;
      const toFirst = round2(Math.min(w.hours, left));
      const toSecond = round2(w.hours - toFirst);
      quota.set(w.id, round2(left - toFirst));
      if (toFirst > 0) rows.push({ worker: w.id, hours: toFirst, invoice: 1 });
      if (toSecond > 0) rows.push({ worker: w.id, hours: toSecond, invoice: 2 });
    }
    return { day: d.day, hours: d.hours, rows };
  });

  // ── Kulut: maksajan mukaan ────────────────────────────────────────────────
  const open = new Set(period.openExpenseIds);
  const [b1, b2] = opts.billers;
  const expenses: StatementExpense[] = customerChargeableExpenses(project)
    .filter((l) => open.has(l.id))
    .map((l) => {
      const payer = l.paidBy ?? null;
      const invoice: StatementInvoiceNo = payer === b2 ? 2 : 1;
      if (payer !== b1 && payer !== b2) {
        warnings.push(`Kulun "${l.customerLabel}" maksajaa ei tunnistettu — se on laskulla 1.`);
      }
      return { id: l.id, label: l.customerLabel, kind: l.kind, cents: l.customerCents, invoice, payer };
    });

  // ── Laskut ────────────────────────────────────────────────────────────────
  const windowsCents = period.money.windows?.uninvoicedCents ?? 0;
  const otherCents = windowsCents + period.adjustmentCents;

  const mkInvoice = (no: StatementInvoiceNo): StatementInvoice => {
    const billerId = opts.billers[no - 1];
    const biller = resolveBrandBiller(billerId);
    const perWorker = new Map<string, number>();
    for (const d of days) for (const r of d.rows) if (r.invoice === no) {
      perWorker.set(r.worker, round2((perWorker.get(r.worker) ?? 0) + r.hours));
    }
    const people = Array.from(perWorker.entries())
      .map(([worker, hours]) => ({ worker, hours }))
      .sort((a, b) => b.hours - a.hours || a.worker.localeCompare(b.worker));
    const hours = round2(people.reduce((s, p) => s + p.hours, 0));
    const hoursCents = Math.round(hours * hourRateCents);
    const exp = expenses.filter((x) => x.invoice === no);
    const expensesCents = exp.reduce((s, x) => s + x.cents, 0);
    const oc = no === 1 ? otherCents : 0;
    return {
      no, billerId, billerName: biller?.name ?? billerId, yTunnus: biller?.yTunnus,
      people, hours, hoursCents, expenses: exp, expensesCents, otherCents: oc,
      totalCents: hoursCents + expensesCents + oc,
    };
  };
  const inv1 = mkInvoice(1);
  const inv2 = mkInvoice(2);

  const byWorker = workerIds.map((worker) => {
    const i1 = inv1.people.find((p) => p.worker === worker)?.hours ?? 0;
    const i2 = inv2.people.find((p) => p.worker === worker)?.hours ?? 0;
    return { worker, hours: round2(i1 + i2), invoice1: i1, invoice2: i2 };
  }).sort((a, b) => b.hours - a.hours || a.worker.localeCompare(b.worker));

  const totalHours = round2(inv1.hours + inv2.hours);
  const totalHoursCents = inv1.hoursCents + inv2.hoursCents;
  const totalExpensesCents = inv1.expensesCents + inv2.expensesCents;
  const totalCents = inv1.totalCents + inv2.totalCents;
  const nextInvoiceCents = period.remainingCents;
  const reconciles = totalCents === nextInvoiceCents;
  if (!reconciles) {
    warnings.push(`Laskujen summa ${totalCents / 100} € ei täsmää järjestelmän seuraavan laskun summaan ${nextInvoiceCents / 100} €.`);
  }

  return {
    from: daysAsc[0]?.day ?? null,
    to: daysAsc[daysAsc.length - 1]?.day ?? null,
    hourRateCents,
    invoices: [inv1, inv2],
    days, byWorker, totalHours, totalHoursCents, totalExpensesCents, totalCents,
    nextInvoiceCents, reconciles, warnings,
  };
}
