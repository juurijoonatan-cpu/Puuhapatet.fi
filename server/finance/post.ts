/**
 * The automatic posting engine — turns invoicing (jobs), receipts (expenses),
 * tool purchases (investments) and inter-founder settlements into real
 * double-entry journal entries, one ledger per founder. Nothing here is
 * hand-typed; see docs/talous-kirjanpito.md for the exact posting rules and
 * the (small, deliberate) list of things NOT yet posted.
 *
 * Design: `rebuildLedgers()` derives the FULL set of entries that SHOULD
 * exist right now from the current source rows, deletes the old auto-posted
 * entries (never touching closed fiscal years or any future manual entry),
 * and re-inserts the fresh set. The ledger is therefore always a pure,
 * current function of jobs/expenses/investments/founderSettlements — it can
 * never drift, because it is rebuilt from scratch every time it's read.
 */
import { eq, and, ne, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  jobs, expenses, investments, founderSettlements, eraInvoices, fiscalYears,
  journalEntries, journalLines,
  type Job, type Expense, type Investment, type FounderSettlement,
} from "@shared/schema";
import { ensureAllLedgers, ensureFiscalYear, accountsByCode, ACCOUNT, LEDGER_DEFS } from "./accounts";
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

interface DraftLine { accountCode: string; debitCents?: number; creditCents?: number }
interface DraftEntry {
  ledgerId: string;
  date: Date;
  description: string;
  sourceType: "customer_invoice" | "internal_invoice" | "expense" | "investment" | "manual";
  sourceKey: string;
  lines: DraftLine[];
}

function assertBalanced(entry: DraftEntry) {
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
 * exists in the map blob this rebuild deliberately never reads).
 *
 * Exported for `post.test.ts`: this is the whole posting rulebook as a pure
 * function of the source rows, so it is tested directly without a database.
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

/**
 * Rebuild every founder's ledger from current source data. Safe to call on
 * every finance-API request — this business runs at a scale (tens to low
 * hundreds of entries/year) where a full rebuild is fast, and
 * correctness-by-construction beats incremental-update bookkeeping.
 *
 * A single Express process serves this app, but one page load fires several
 * finance GETs in parallel (summary, journal, general-ledger, …) — each
 * calls this function. Without a guard, two concurrent rebuilds both try to
 * delete-then-reinsert the same rows and collide on the sourceKey unique
 * constraint. rebuildLedgers() is therefore serialized behind a single
 * in-flight promise: concurrent callers all await the SAME run.
 */
/**
 * Tekijöiden (alihankkijoiden) erälaskut kirjanpitoa varten.
 *
 * Vain ne sarakkeet joita `buildDraftEntries` lukee, ja `eraNumbers`/`rivit`
 * parsitaan JSONista samalla tavalla kuin tasauksessa (`loadTasaus`,
 * server/routes.ts). Rivit ovat kevyitä: ei liitteitä, ei karttablobia — tämä
 * ajetaan joka `/api/finance/*`-pyynnöllä siinä missä muut kyselyt.
 */
async function loadWorkerInvoices(): Promise<WorkerInvoiceRow[]> {
  try {
    const rows = await db.select({
      id: eraInvoices.id, jobId: eraInvoices.jobId, kind: eraInvoices.kind,
      tila: eraInvoices.tila, senderId: eraInvoices.senderId,
      recipientId: eraInvoices.recipientId, eraNumbers: eraInvoices.eraNumbers,
      rivit: eraInvoices.rivit, totalCents: eraInvoices.totalCents,
      sentAt: eraInvoices.sentAt, createdAt: eraInvoices.createdAt,
    }).from(eraInvoices);
    return rows.map((r) => {
      let eraNumbers: number[] = [];
      let rivit: WorkerInvoiceRow["rivit"] = null;
      try { const parsed = JSON.parse(r.eraNumbers); if (Array.isArray(parsed)) eraNumbers = parsed; } catch { /* tyhjä */ }
      try { rivit = JSON.parse(r.rivit); } catch { /* null */ }
      return { ...r, eraNumbers, rivit };
    });
  } catch (e: any) {
    // Taulua ei ole vielä kannassa (db:push ajamatta) → kirjanpito rakentuu
    // ilman alihankkijakuluja eikä kaadu. Sama suoja kuin erälaskureiteillä
    // (server/routes.ts `isMissingTableError`), joka ei ole exportattu sieltä
    // (routes.ts importtaa tämän moduulin — kehäriippuvuus).
    if (e?.code !== "42P01") throw e;
    return [];
  }
}

let inFlight: Promise<void> | null = null;
export function rebuildLedgers(): Promise<void> {
  if (!inFlight) inFlight = rebuildLedgersNow().finally(() => { inFlight = null; });
  return inFlight;
}

async function rebuildLedgersNow(): Promise<void> {
  await ensureAllLedgers();

  const [jobRows, expenseRows, investmentRows, settlementRows, workerInvoiceRows] = await Promise.all([
    // Kirjanpidon uudelleenrakennus lukee vain rahakentät ja gigData:n
    // laskutuserät. `db.select().from(jobs)` veti mukanaan allekirjoitus-PNG:t
    // ja koko karttablobin — ja tämä ajetaan JOKAISELLA /api/finance-haulla,
    // joita Talous-sivu tekee viisi kerralla.
    db.select({
      id: jobs.id, customerId: jobs.customerId, description: jobs.description,
      agreedPrice: jobs.agreedPrice, status: jobs.status, assignedTo: jobs.assignedTo,
      scheduledAt: jobs.scheduledAt, waiveFee: jobs.waiveFee, quoteStatus: jobs.quoteStatus,
      isTaloyhtiio: jobs.isTaloyhtiio, unitCount: jobs.unitCount, isCustomGig: jobs.isCustomGig,
      billedBy: jobs.billedBy, createdAt: jobs.createdAt, updatedAt: jobs.updatedAt,
      // EI `projectData`ta: `buildDraftEntries` ei lue sitä kertaakaan, mutta se
      // on koko karttablobi (havaintokuvat, kuitit, dokumentit — kymmeniä
      // megatavuja per FR8-keikka). Tämä kysely ajetaan JOKAISELLA
      // /api/finance-haulla ja Talous-sivu tekee viisi kerralla.
      gigData: jobs.gigData,
    }).from(jobs) as unknown as Promise<Job[]>,
    db.select().from(expenses),
    db.select().from(investments),
    db.select().from(founderSettlements),
    loadWorkerInvoices(),
  ]);
  const drafts = buildDraftEntries(jobRows, expenseRows, investmentRows, settlementRows, workerInvoiceRows);

  for (const ledgerDef of LEDGER_DEFS) {
    const ledgerId = ledgerDef.id;
    const accByCode = await accountsByCode(ledgerId);

    const closedYears = await db.select().from(fiscalYears)
      .where(and(eq(fiscalYears.ledgerId, ledgerId), eq(fiscalYears.isClosed, true)));
    const isClosedDate = (d: Date) => closedYears.some((y) => d >= y.startDate && d <= y.endDate);

    // Delete every previously auto-posted entry for this ledger EXCEPT those
    // in a closed fiscal year — a closed year is frozen, matching how a real
    // tilinpäätös is never silently rewritten.
    const existingAuto = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.ledgerId, ledgerId), ne(journalEntries.sourceType, "manual")));
    const staleIds = existingAuto.filter((e) => !isClosedDate(e.date)).map((e) => e.id);
    if (staleIds.length > 0) {
      await db.delete(journalLines).where(inArray(journalLines.entryId, staleIds));
      await db.delete(journalEntries).where(inArray(journalEntries.id, staleIds));
    }

    const keptEntries = await db.select().from(journalEntries).where(eq(journalEntries.ledgerId, ledgerId));
    let nextNumber = keptEntries.reduce((max, e) => Math.max(max, e.entryNumber), 0) + 1;

    const ledgerDrafts = drafts
      .filter((d) => d.ledgerId === ledgerId && !isClosedDate(d.date))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    for (const draft of ledgerDrafts) {
      const fy = await ensureFiscalYear(ledgerId, draft.date);
      if (fy.isClosed) continue; // belt-and-suspenders; already filtered above
      const [entry] = await db.insert(journalEntries).values({
        ledgerId, fiscalYearId: fy.id, entryNumber: nextNumber++,
        date: draft.date, description: draft.description,
        sourceType: draft.sourceType, sourceKey: draft.sourceKey,
      }).returning();
      await db.insert(journalLines).values(
        draft.lines.map((l, i) => ({
          entryId: entry.id,
          accountId: accByCode[l.accountCode].id,
          debitCents: l.debitCents ?? 0,
          creditCents: l.creditCents ?? 0,
          lineNo: i,
        })),
      );
    }
  }
}
