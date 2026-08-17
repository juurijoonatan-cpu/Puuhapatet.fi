/**
 * KIRJAUSSÄÄNNÖT — koko automaattikirjaajan sääntökirja puhtaana funktiona.
 *
 * `server/finance/post.ts` on kirjaaja: se hakee lähderivit kannasta, poistaa
 * vanhat automaattiviennit ja kirjoittaa uudet. Tämä moduuli vastaa siihen
 * yhteen kysymykseen mitä sääntökirja oikeasti on: *mitkä viennit näiden
 * lähderivien perusteella pitäisi olla olemassa juuri nyt*. Ei I/O:ta, ei
 * kantayhteyttä — sama kuin `settlement.ts` liikevaihtolaskennalle, ja samasta
 * syystä: rahasääntö on testattavissa ilman tietokantaa (`post.test.ts`).
 *
 * Ks. docs/talous-kirjanpito.md tarkat kirjaussäännöt ja (lyhyt, tarkoituksellinen)
 * lista siitä mitä EI vielä kirjata.
 */
import type { Job, Expense, Investment, FounderSettlement } from "@shared/schema";
import { ACCOUNT } from "./account-codes";
import { BRAND_BILLERS, inferBillerId } from "@shared/billers";
import { effectiveJobTotal } from "@shared/team";
import { sanitizeGigData, type GigData, livePayments } from "@shared/gig";
import { isEraInvoiceSettled, eraInvoiceGrossCents, type EraInvoiceLike } from "@shared/worker-payouts";
import { isP2EraSelection } from "@shared/era-billing";

function parseGig(raw: string | null): GigData | null {
  if (!raw) return null;
  try { return sanitizeGigData(JSON.parse(raw)); } catch { return null; }
}

const isFounder = (id?: string | null): id is string => !!id && BRAND_BILLERS.some((b) => b.id === id);

/**
 * Tekijän (alihankkijan) erälasku sellaisena kuin KIRJANPITO sen tarvitsee.
 *
 * Minimikentät samaan tapaan kuin `InternalInvoiceRow` liikevaihtolaskennassa
 * (server/finance/settlement.ts): kannassa `eraNumbers` ja `rivit` ovat
 * JSON-merkkijonoja, ja kutsuja parsii ne ennen kuin antaa rivit tänne — näin
 * `buildDraftEntries` pysyy puhtaana funktiona ja on testattavissa ilman kantaa.
 *
 * `EraInvoiceLike` (shared/worker-payouts.ts) on sama muoto jota tekijöiden
 * maksettavan YKSI totuuden lähde lukee, joten tilan suodatus
 * (`isEraInvoiceSettled`) ja bruttosumma (`eraInvoiceGrossCents`) ovat tässä
 * samat funktiot kuin Maksut-välilehdellä ja tasauksessa.
 */
export interface WorkerInvoiceRow extends EraInvoiceLike {
  id: number;
  jobId: number;
  /**
   * Laskun OSTAJA = se johtaja jonka Y-tunnuksella tekijä laskuttaa, eli se
   * jonka kirjanpitoon osto kuuluu. Reititetään erän mukaan laskua luotaessa
   * (`eraRecipientFounderId`, ohitettavissa todellisella maksajalla) — ks.
   * docs/fr8-vero-ja-maksut.md "Kuka laskuttaa kenet".
   */
  recipientId: string;
  /** Laskun päivä = lukitushetki. Vasta lähetetty lasku on tosite. */
  sentAt: Date | null;
  createdAt: Date;
  /** `rivit.input.name` on tekijän nimi laskuhetkellä — vientiselitteeseen. */
  rivit?: { input?: { name?: string; pestytIkkunat?: number }; computed?: { ansaittuCents?: number } } | null;
}

export interface DraftLine { accountCode: string; debitCents?: number; creditCents?: number }

export interface DraftEntry {
  ledgerId: string;
  date: Date;
  description: string;
  sourceType: "customer_invoice" | "internal_invoice" | "expense" | "investment" | "manual";
  sourceKey: string;
  lines: DraftLine[];
}

export function assertBalanced(entry: DraftEntry) {
  const debit = entry.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const credit = entry.lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  if (debit !== credit) {
    throw new Error(`Kirjanpitovirhe: vienti ei täsmää (debet ${debit} ≠ kredit ${credit}) — ${entry.sourceKey}`);
  }
}

/**
 * Derive every journal entry that should exist today, from the source rows.
 *
 * Posted automatically (see docs/talous-kirjanpito.md §"Mitä kirjataan"):
 *   1. Asiakaslaskut — every job / FR8-erä with exactly one known founder
 *      biller → Pankkitili (debet) / Myynnit (kredit), full invoiced amount.
 *   2. Kulut — the `expenses` table, attributed via the same biller rule as
 *      revenue → Muut kulut (debet) / Pankkitili (kredit).
 *   3. Hankinnat — `investments`, attributed via boughtBy (+ 50/50 splitWith)
 *      → Kalusto ja välineet (debet) / Pankkitili (kredit). Expensed in full
 *      at purchase (pienhankinnan kertapoisto) rather than depreciated.
 *   4. Yrittäjien väliset laskut — `founderSettlements` rows (a confirmed,
 *      amount-settled vastalasku): payer's real expense + payee's real
 *      revenue, both ledgers, same amount.
 *   5. Alihankkijakulu — every SENT/ACCEPTED tekijä-erälasku (`era_invoices`)
 *      → Ostot ja ulkopuoliset palvelut (debet) / Pankkitili (kredit) in the
 *      ledger of the founder the invoice names as buyer. See the loop's own
 *      comment for the source-of-truth and accrual reasoning.
 *
 * Deliberately NOT posted yet (see docs for why): palvelumaksu (service-fee)
 * revenue, startup-bonus usage, and the part of the workers' earnings that
 * nobody has invoiced yet (`reserveCents` — no tosite, and the figure only
 * exists in the map blob the rebuild deliberately never reads).
 */
export function buildDraftEntries(
  jobRows: Job[],
  expenseRows: Expense[],
  investmentRows: Investment[],
  settlementRows: FounderSettlement[],
  workerInvoiceRows: WorkerInvoiceRow[] = [],
): DraftEntry[] {
  const drafts: DraftEntry[] = [];
  const jobsById = new Map(jobRows.map((j) => [j.id, j]));

  for (const job of jobRows) {
    if (job.gigData) {
      const gig = parseGig(job.gigData);
      const gigName = gig?.company?.name || job.description || `Keikka #${job.id}`;
      // Mitätöityä laskutuserää ei kirjata myyntinä (ks. GigPayment.voided).
      livePayments(gig?.payments).forEach((p, i) => {
        if (!p?.amountCents || p.amountCents <= 0 || !isFounder(p.biller?.id)) return;
        const date = new Date(p.t || job.scheduledAt || job.createdAt);
        drafts.push({
          ledgerId: p.biller!.id, date,
          description: `Asiakaslasku — ${gigName}, erä ${i + 1}`,
          sourceType: "customer_invoice", sourceKey: `job:${job.id}:era:${i}`,
          lines: [
            { accountCode: ACCOUNT.BANK, debitCents: p.amountCents },
            { accountCode: ACCOUNT.SALES, creditCents: p.amountCents },
          ],
        });
      });
      continue; // FR8/custom-gig jobs are fully handled via their eras above.
    }
    if (job.isCustomGig) continue; // set up but no eras recorded yet — nothing to post.
    if (job.status !== "done" || job.quoteStatus === "declined") continue;
    const total = effectiveJobTotal(job);
    if (total <= 0) continue;
    const billerId = inferBillerId(job);
    if (!isFounder(billerId)) continue; // unattributed — surfaced in the ALV card, never guessed here.
    drafts.push({
      ledgerId: billerId, date: new Date(job.scheduledAt ?? job.createdAt),
      description: `Asiakaslasku — keikka #${job.id}`,
      sourceType: "customer_invoice", sourceKey: `job:${job.id}`,
      lines: [
        { accountCode: ACCOUNT.BANK, debitCents: total },
        { accountCode: ACCOUNT.SALES, creditCents: total },
      ],
    });
  }

  /**
   * ALIHANKKIJAKULU — tekijöiden erälaskut kuluksi sille johtajalle joka ne ostaa.
   *
   * MIKSI TÄMÄ ON OLEMASSA: yllä oleva silmukka kirjaa urakkakeikan JOKAISEN
   * asiakaserän kokonaan myynniksi (3000). Aiemmin tekijöiden palkkaa ei
   * veloitettu lainkaan, ja perusteluna oli että se "on jo netotettu pois
   * katteessa" — mutta kirjaussääntö kirjaa BRUTON erän, ei katetta. Siksi
   * laskuttavan johtajan tuloslaskelma näytti koko urakkasumman tuloksena:
   * lippulaivakeikassa 6 150 € laskutettua, josta 5 576,50 € on tekijöiden
   * palkkaa ja johtajien yhteinen kate 573,50 €.
   *
   * MISTÄ SUMMA TULEE: tekijän erälaskusta (`era_invoices`, kind "tekija") eli
   * siitä tositteesta jolla alihankkija laskuttaa johtajaa. Kaksi asiaa luetaan
   * jaetuista totuuden lähteistä eikä kirjoiteta uudestaan:
   *   - `isEraInvoiceSettled` (shared/worker-payouts.ts) — vain lähetetty tai
   *     hyväksytty lasku on tosite. Luonnos odottaa vielä tekijää ja hylätty
   *     lasku ei koskaan syntynyt kuluksi.
   *   - `eraInvoiceGrossCents` — BRUTTO (`rivit.computed.ansaittuCents`), ei
   *     `totalCents`. `totalCents` on "maksettava nyt" = ansaittu − ennakko,
   *     joten se aliarvioisi kulun aina kun ennakkoa on kirjattu. Sama sääntö
   *     kuin velan kuittauksessa ja tasauksessa (`fr8-tasaus.grossOf`).
   *
   * EI KAKSOISLASKENTAA PUNAISISTA JA KELTAISISTA: punaisten erämaksu ja
   * keltaisten potti ovat eri laskuja eri riveillä (`eraNumbers`, sentinel-erä
   * 0 = keltaiset, `isP2EraSelection`). Kumpikin rivi kirjataan kertaalleen
   * omana vientinään, joten kaksi rahavirtaa eivät voi summautua päällekkäin —
   * eikä sama euro voi tulla molempia teitä, koska lähde on rivi eikä kaava.
   *
   * SUORITE- VAI MAKSUPERUSTE: kulu kirjataan LASKUN päivälle (`sentAt`), ei
   * pankkisiirron päivälle — järjestelmä ei edes tiedä milloin tekijän lasku
   * maksettiin (`tila` kertoo tekijän kuittauksen, ei maksua). Sama peruste
   * kuin myyntipuolella: asiakaserä kirjataan laskutushetkelle (`p.t`).
   * Vastatilinä on Pankkitili kuten kaikilla muillakin tämän kirjaajan
   * vienneillä — 1700/2800 (myyntisaamiset/ostovelat) ovat tilikartassa yhä
   * varattuja. Peruste on tarkoituksella sama molemmilla puolilla; sen
   * lopullinen lukkoonlyönti on kirjanpitäjän päätös (ks. docs).
   *
   * MIHIN KIRJANPITOON: laskun ostajalle (`recipientId`). Se on erän mukaan
   * reititetty eli oletuksena juuri se johtaja joka laskutti asiakkaan tästä
   * erästä (docs/fr8-vero-ja-maksut.md) — sama kirjanpito johon erän myynti
   * meni. Se on myös oikea vastaus silloin kun rahan tosiasiallinen liike oli
   * toinen: tosite nimeää ostajan, ja johtajien keskinäinen oikaisu kulkee
   * `founder_settlements`-vientien kautta (invariantti 16).
   */
  for (const inv of workerInvoiceRows) {
    if (!isEraInvoiceSettled(inv)) continue;
    const cents = eraInvoiceGrossCents(inv);
    if (cents <= 0) continue;
    // Tuntematon ostaja: EI arvata kummallekaan johtajalle. Sama sääntö kuin
    // laskuttajattomalla erällä yllä ja invariantti 18 (kohdentamaton raha ei
    // kuulu kenellekään) — arvaus siirtäisi satoja euroja väärään kirjanpitoon.
    if (!isFounder(inv.recipientId)) continue;
    const job = jobsById.get(inv.jobId);
    const gig = job?.gigData ? parseGig(job.gigData) : null;
    const gigName = gig?.company?.name || job?.description || `Keikka #${inv.jobId}`;
    const workerName = inv.rivit?.input?.name?.trim() || inv.senderId;
    const eraLabel = isP2EraSelection(inv.eraNumbers)
      ? "keltaiset"
      : inv.eraNumbers?.length ? `erä ${inv.eraNumbers.join("+")}` : "erittelemätön";
    drafts.push({
      ledgerId: inv.recipientId,
      date: new Date(inv.sentAt ?? inv.createdAt),
      description: `Alihankkijalasku — ${workerName}, ${gigName}, ${eraLabel}`,
      sourceType: "expense",
      // Erälaskun id on globaalisti uniikki, joten avain on vakaa ja erottuu
      // sekä asiakaserästä (`job:1:era:0`) että kulusta (`expense:1`). Yksi
      // lasku → yksi vienti → yksi kirjanpito, joten uudelleenajo ei koskaan
      // tuota duplikaattia (uniikkirajoite `(ledgerId, sourceKey)`).
      sourceKey: `job:${inv.jobId}:tekijalasku:${inv.id}`,
      lines: [
        // 4000 Ostot ja ulkopuoliset palvelut — EI 4010, joka on varattu
        // yrittäjien VÄLISILLE laskuille: tekijä on ulkopuolinen alihankkija,
        // ja jos nämä menisivät samalle tilille, tuloslaskelmasta ei enää
        // näkisi erikseen ulos maksettua palkkaa ja johtajien keskinäistä
        // siirtoa (joka brändin tasolla kuittaa itsensä). EI myöskään 5000
        // Henkilöstökulut: maksu on työkorvausta eikä palkkaa, eikä
        // työnantajavelvoitteita synny (docs/fr8-vero-ja-maksut.md).
        { accountCode: ACCOUNT.PURCHASES, debitCents: cents },
        { accountCode: ACCOUNT.BANK, creditCents: cents },
      ],
    });
  }

  for (const exp of expenseRows) {
    const job = jobsById.get(exp.jobId);
    if (!job || exp.amount <= 0) continue;
    const billerId = inferBillerId(job);
    if (!isFounder(billerId)) continue;
    drafts.push({
      ledgerId: billerId, date: new Date(exp.createdAt),
      description: `Kulu — ${exp.description}`,
      sourceType: "expense", sourceKey: `expense:${exp.id}`,
      lines: [
        { accountCode: ACCOUNT.OTHER_EXPENSE, debitCents: exp.amount },
        { accountCode: ACCOUNT.BANK, creditCents: exp.amount },
      ],
    });
  }

  for (const inv of investmentRows) {
    if (inv.amount <= 0) continue;
    const buyers = (inv.splitWith ? [inv.boughtBy, inv.splitWith] : [inv.boughtBy]).filter(isFounder);
    if (buyers.length === 0) continue;
    const base = Math.floor(inv.amount / buyers.length);
    buyers.forEach((ledgerId, i) => {
      const cents = i === 0 ? inv.amount - base * (buyers.length - 1) : base;
      if (cents <= 0) return;
      drafts.push({
        ledgerId, date: new Date(inv.purchasedAt),
        description: `Hankinta — ${inv.description}`,
        sourceType: "investment", sourceKey: `investment:${inv.id}:${ledgerId}`,
        lines: [
          { accountCode: ACCOUNT.EQUIPMENT, debitCents: cents },
          { accountCode: ACCOUNT.BANK, creditCents: cents },
        ],
      });
    });
  }

  for (const s of settlementRows) {
    if (s.cents <= 0 || !isFounder(s.fromId) || !isFounder(s.toId)) continue;
    const date = new Date(s.createdAt);
    const label = s.invoiceNo ? ` (${s.invoiceNo})` : "";
    drafts.push({
      ledgerId: s.fromId, date,
      description: `Yrittäjien välinen lasku, maksettu${label}`,
      sourceType: "internal_invoice", sourceKey: `settlement:${s.id}:payer`,
      lines: [
        { accountCode: ACCOUNT.PURCHASES_INTERNAL, debitCents: s.cents },
        { accountCode: ACCOUNT.BANK, creditCents: s.cents },
      ],
    });
    drafts.push({
      ledgerId: s.toId, date,
      description: `Yrittäjien välinen lasku, saatu${label}`,
      sourceType: "internal_invoice", sourceKey: `settlement:${s.id}:payee`,
      lines: [
        { accountCode: ACCOUNT.BANK, debitCents: s.cents },
        { accountCode: ACCOUNT.SALES_INTERNAL, creditCents: s.cents },
      ],
    });
  }

  drafts.forEach(assertBalanced);
  return drafts;
}
