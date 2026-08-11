/**
 * FR8 — tasauksen SYÖTTEEN KOKOAMINEN oikeasta keikkadatasta.
 *
 * `shared/founder-settlement.ts` on puhdas matematiikka eikä tiedä mistään
 * kartasta tai laskusta. Tämä moduuli lukee todellisen keikan (karttablobi +
 * asiakaslaskut + tekijöiden erälaskut + johtajien käsin kirjaamat korjaukset) ja
 * kokoaa siitä `TasausInput`in. Sekä client (Maksut-välilehti) että server
 * (admin-paneelin rahakortti) importtaavat tämän — kaava on yhdessä paikassa.
 *
 * KOLME LÄHDETTÄ, JOISTA "KUKA SAI / KUKA MAKSOI" LUETAAN — tässä järjestyksessä:
 *
 *  1. **Asiakasraha:** `gig.payments[i].biller.id` — se johtaja jonka Y-tunnuksella
 *     erä laskutettiin. Käsin kirjattu `settlement.receivedBy[i]` voittaa, koska
 *     laskuttaja ja rahan tosiasiallinen saaja voivat olla eri (juuri tämä tapaus:
 *     erä 1 laskutettiin paperilla Joonatanille, mutta raha meni Matiakselle).
 *  2. **Tekijöille maksettu:** tekijän erälaskun `recipientId` = laskun OSTAJA eli
 *     se johtaja jolle tekijä laskuttaa ja joka siis siirtää rahat. Käsin kirjattu
 *     `settlement.paidBy[invoiceId]` voittaa (lukittua laskua ei saa muuttaa).
 *  3. **Käsin kirjatut payoutit** (`CrewMember.payouts`, vanha kanava) eivät kerro
 *     maksajaa lainkaan. Ne raportoidaan omana rivinään `unattributedPaidCents`inä
 *     — niitä EI hiljaa lasketa kummallekaan johtajalle, koska arvaus vääristäisi
 *     tasausta satojen eurojen verran. Johtaja kohdentaa ne itse.
 */

import { allPoints, type ProjectData } from "./project";
import { computeP2Billing, p2WorkerPayoutCents, p2PendingPriceCents, DEFAULT_P2_WORKER_SHARE_PCT } from "./p2";
import { getCrew, DEFAULT_WORKER_PER_WINDOW_CENTS } from "./crew";
import { isP2EraSelection } from "./era-billing";
import { BRAND_BILLERS } from "./billers";
import {
  computeTasaus, type FounderSettlementState, type FounderSettlementManual, type TasausInput, type TasausResult,
  type TasausFounderInput, type TasausTransfer,
} from "./founder-settlement";

/** Asiakkaalta laskutettu erä sellaisena kuin tasaus sen näkee. */
export interface TasausEraRow {
  /** Indeksi `gig.payments`-taulukossa — sama avain jolla saaja tallennetaan. */
  index: number;
  /** Näytettävä nimi: "Erä 1" tai "Keltaiset". */
  label: string;
  amountCents: number;
  dateMs: number | null;
  /** Kuka laskutti (laskulla lukeva Y-tunnus). */
  billerId: string | null;
  /** Kuka OIKEASTI sai rahat — käsin kirjattu tai laskuttaja. */
  receivedById: string | null;
  /** Onko saaja kirjattu käsin (eroaa laskuttajasta)? */
  overridden: boolean;
  scope: "p1" | "p2";
  /** Mitätöity erä — näkyy historiassa, ei lasketa pottiin. */
  voided?: boolean;
}

/** Tekijälle mennyt maksu sellaisena kuin tasaus sen näkee. */
export interface TasausPayoutRow {
  /** Erälaskun id, tai `manual:<workerId>` käsin kirjatuille. */
  key: string;
  invoiceId: number | null;
  workerId: string;
  workerName: string;
  amountCents: number;
  /** Laskun ostaja = oletusmaksaja. */
  recipientId: string | null;
  /** Kuka OIKEASTI maksoi — käsin kirjattu tai laskun ostaja. */
  paidById: string | null;
  overridden: boolean;
  scope: "p1" | "p2";
  eraNumbers: number[];
  /** Käsin kirjattu payout ilman maksajatietoa. */
  unattributed: boolean;
}

/** Minimikentät joita tasaus tarvitsee erälaskulta. */
export interface TasausEraInvoice {
  id: number;
  kind: string;
  tila: string;
  senderId: string;
  recipientId: string;
  totalCents: number;
  eraNumbers?: number[];
  rivit?: { input?: { name?: string; pestytIkkunat?: number }; computed?: { ansaittuCents?: number } } | null;
}

/** Minimikentät joita tasaus tarvitsee asiakasmaksulta. */
export interface TasausPayment {
  t?: number;
  amountCents: number;
  scope?: "p1" | "p2";
  biller?: { id?: string } | null;
  /** Mitätöity laskutuserä — säilyy tositteena, ei lasketa mihinkään summaan. */
  voided?: boolean;
}

export interface TasausBundle {
  founders: { id: string; name: string }[];
  eras: TasausEraRow[];
  payouts: TasausPayoutRow[];
  /** Käsin kirjatut payoutit joille ei ole maksajaa — EI jaettu kummallekaan. */
  unattributedPaidCents: number;
  input: TasausInput;
  result: TasausResult;
  /** Kuinka monella erällä saaja on yhä kirjaamatta. Näiden rahat eivät ole
   *  kummankaan kassassa, joten tasaus on niiltä osin epätäydellinen. */
  unassignedEraCount: number;
  /** Pestyt punaiset ilman pesijää: ne eivät maksa palkkaa kenellekään, joten
   *  ne näkyvät katteena. Varoitus, ei laskennan osa. */
  unattributedP1Windows: number;
  /**
   * Käsin annetut lähtöluvut sellaisenaan, plus se mitä kartta olisi sanonut.
   * Näkymä voi näyttää molemmat rinnakkain: käsinsyötetty luku on merkittävä
   * poikkeama automatiikasta, ja se pitää näkyä eikä piiloutua.
   */
  manual?: {
    active: FounderSettlementManual;
    /** Sama tieto kartasta johdettuna — vertailua varten. */
    derived: {
      p1PotCents: number;
      p1WindowsTotal: number;
      workerP1EarnedCents: number;
      p1WindowsByFounder: Record<string, number>;
    };
  };
}

/** Onko tämä erälasku maksettu/maksussa (ei luonnos, ei hylätty)? */
function isLiveWorkerInvoice(inv: TasausEraInvoice): boolean {
  return inv.kind === "tekija" && (inv.tila === "lähetetty" || inv.tila === "hyväksytty");
}

/** Erälaskun BRUTTO — sama sääntö kuin `worker-payouts.eraInvoiceGrossCents`:
 *  `totalCents` on maksettava (= ansaittu − ennakko), joten se aliarvioi
 *  siirretyn rahan aina kun ennakkoa on kirjattu. Tasaus katsoo mitä johtaja on
 *  yhteensä pannut tekijään kiinni, eli bruttoa. */
function grossOf(inv: TasausEraInvoice): number {
  const gross = inv.rivit?.computed?.ansaittuCents;
  return typeof gross === "number" && Number.isFinite(gross) ? gross : inv.totalCents;
}

function eraLabel(nums: number[] | undefined, index: number): string {
  if (isP2EraSelection(nums)) return "Keltaiset";
  if (!nums || nums.length === 0) return `Erä ${index + 1}`;
  return nums.length === 1 ? `Erä ${nums[0]}` : `Erät ${nums[0]}–${nums[nums.length - 1]}`;
}

/**
 * Johtajien itse pesemät PUNAISET ikkunat ja heidän KELTAISET palkkionsa
 * suoraan kartalta. Jaettu ikkuna (`washedBy2`) on 0,5 + 0,5.
 *
 * Perustaja tunnistetaan crew-rivin roolista (`host`) — sama sääntö kuin
 * `computeEraDebts`issä, jotta johtajan ikkuna ei koskaan päädy tekijäkuluksi
 * yhdessä näkymässä ja katteeksi toisessa.
 */
export function founderWashCounts(project: ProjectData): {
  /** Johtaja-id → hänen itse pesemänsä punaiset ikkunat. */
  p1ByFounder: Record<string, number>;
  /** Johtaja-id → hänen omista keltaisistaan kertynyt palkkio. */
  p2CentsByFounder: Record<string, number>;
  /** KAIKKI pestyt punaiset — x:n nimittäjä. */
  p1WindowsTotal: number;
  /** Tekijöiden (ei johtajien) pesemät punaiset. */
  workerP1Windows: number;
  /** Tekijä-id → hänen punaisista ansaitsemansa brutto (× oma taksa). */
  workerP1EarnedByWorker: Record<string, number>;
  /** Pestyt punaiset joilla ei ole pesijää merkittynä — nämä eivät maksa
   *  palkkaa kenellekään, joten ne kasvattavat katetta. Näytetään varoituksena. */
  unattributedP1Windows: number;
} {
  const crew = getCrew(project);
  const roleById = new Map(crew.map((c) => [c.id, c.role]));
  const rateById = new Map(crew.map((c) => [c.id, c.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS]));
  // Tekijän kanssa SOVITTU vähennys/lisä (esim. "sovittiin että siitä vähennetään
  // 10 €"). Tasauksen kulupuolen pitää käyttää sitä mitä tekijälle todella
  // maksetaan: ilman tätä kulu oli 10 € liian suuri, johtajien kate (joka on
  // jäännös) 10 € liian pieni ja siirtosumma 5 € väärin.
  const adjustById = new Map(crew.map((c) => [c.id, c.payAdjustmentCents ?? 0]));
  const isFounder = (id: string) => roleById.get(id) === "host";
  const rateOf = (id: string) => rateById.get(id) ?? DEFAULT_WORKER_PER_WINDOW_CENTS;
  const adjustOf = (id: string) => adjustById.get(id) ?? 0;
  const by2 = project.washedBy2 || {};
  const p1ByFounder: Record<string, number> = {};
  const p2CentsByFounder: Record<string, number> = {};
  const workerP1WindowsByWorker: Record<string, number> = {};
  let p1WindowsTotal = 0;
  let workerP1Windows = 0;
  let unattributedP1Windows = 0;

  const p2Enabled = !!project.p2?.enabled;
  const offers = project.p2?.offers ?? {};
  const sharePct = project.p2?.workerSharePct ?? DEFAULT_P2_WORKER_SHARE_PCT;
  const schedule = project.p2?.payoutSchedule;

  // YKSI läpikäynti koko kartasta. Aiemmin sama tieto haettiin per tekijä, mikä
  // teki tästä O(tekijät × pisteet) jokaisella renderillä.
  for (const pt of allPoints(project)) {
    if (pt.status !== "pesty") continue;
    const second = by2[pt.key];
    if (pt.p === 1) {
      // x:n nimittäjä on KAIKKI pestyt punaiset, myös ne joilla ei ole pesijää —
      // muuten puuttuva attribuutio nostaisi x:ää ja johtajat jakaisivat
      // enemmän kuin asiakkaalta on laskutettu.
      p1WindowsTotal += 1;
      if (!pt.washedBy && !second) { unattributedP1Windows += 1; continue; }
      const primaryShare = second ? 0.5 : 1;
      if (pt.washedBy) {
        if (isFounder(pt.washedBy)) p1ByFounder[pt.washedBy] = (p1ByFounder[pt.washedBy] || 0) + primaryShare;
        else {
          workerP1Windows += primaryShare;
          workerP1WindowsByWorker[pt.washedBy] = (workerP1WindowsByWorker[pt.washedBy] || 0) + primaryShare;
        }
      } else {
        unattributedP1Windows += primaryShare;
      }
      if (second) {
        if (isFounder(second)) p1ByFounder[second] = (p1ByFounder[second] || 0) + 0.5;
        else {
          workerP1Windows += 0.5;
          workerP1WindowsByWorker[second] = (workerP1WindowsByWorker[second] || 0) + 0.5;
        }
      }
      continue;
    }
    if (!p2Enabled) continue;
    const offer = offers[pt.key];
    if (offer?.status !== "locked" || !offer.lockedCents) continue;
    const payout = p2WorkerPayoutCents(offer.lockedCents, sharePct, schedule);
    if (pt.washedBy && isFounder(pt.washedBy)) {
      p2CentsByFounder[pt.washedBy] = (p2CentsByFounder[pt.washedBy] || 0) + (second ? payout / 2 : payout);
    }
    if (second && isFounder(second)) {
      p2CentsByFounder[second] = (p2CentsByFounder[second] || 0) + payout / 2;
    }
  }
  for (const k of Object.keys(p2CentsByFounder)) p2CentsByFounder[k] = Math.round(p2CentsByFounder[k]);
  const workerP1EarnedByWorker: Record<string, number> = {};
  for (const [id, windows] of Object.entries(workerP1WindowsByWorker)) {
    // Sama kaava kuin `settleWorker`in `p1PayableCents`: brutto + sovittu
    // muutos, ei koskaan alle nollan. Yksi sääntö, kaksi kutsujaa.
    workerP1EarnedByWorker[id] = Math.max(0, Math.round(windows * rateOf(id)) + adjustOf(id));
  }
  return {
    p1ByFounder, p2CentsByFounder, p1WindowsTotal, workerP1Windows,
    workerP1EarnedByWorker, unattributedP1Windows,
  };
}

/**
 * Kokoaa koko tasauksen yhdestä keikasta.
 *
 * `payments` = `gig.payments` (asiakaslaskut, sekä punaiset erät että keltaiset).
 * `invoices` = keikan erälaskut. `state` = johtajien käsin kirjaamat korjaukset.
 */
export function buildTasaus(
  project: ProjectData,
  payments: TasausPayment[],
  invoices: TasausEraInvoice[],
  state?: FounderSettlementState | null,
): TasausBundle {
  const crew = getCrew(project);
  // Johtajat vakaassa järjestyksessä (Joonatan ensin) — pariton sentti menee
  // aina samalle henkilölle, joten luku ei heilu renderöinnistä toiseen.
  const founders = BRAND_BILLERS.map((b) => ({
    id: b.id,
    name: crew.find((c) => c.id === b.id)?.name?.trim() || b.name,
  }));
  const founderIds = new Set(founders.map((f) => f.id));

  const receivedBy = state?.receivedBy ?? {};
  const paidBy = state?.paidBy ?? {};

  // ── 1. Asiakkaalta saatu, per erä ──────────────────────────────────────────
  const eras: TasausEraRow[] = payments.map((p, index) => {
    const billerId = p.biller?.id && founderIds.has(p.biller.id) ? p.biller.id : null;
    const manual = receivedBy[String(index)];
    const receivedById = manual && founderIds.has(manual) ? manual : billerId;
    const scope: "p1" | "p2" = p.scope === "p2" ? "p2" : "p1";
    return {
      index,
      label: scope === "p2" ? "Keltaiset" : `Erä ${payments.slice(0, index + 1).filter((q) => (q.scope ?? "p1") !== "p2" && !q.voided).length}`,
      amountCents: Math.round(p.amountCents || 0),
      dateMs: p.t ?? null,
      billerId,
      receivedById,
      overridden: !!manual && manual !== billerId,
      scope,
      voided: !!p.voided,
    };
  });

  const receivedByFounder: Record<string, number> = {};
  let p1PotCents = 0;
  let p2PotCents = 0;
  let unassignedEraCount = 0;
  for (const e of eras) {
    // Mitätöity erä näkyy rivinä (tosite), mutta ei ole rahaa kenellekään.
    if (e.voided) continue;
    if (e.scope === "p2") p2PotCents += e.amountCents; else p1PotCents += e.amountCents;
    if (!e.receivedById) { if (e.amountCents > 0) unassignedEraCount += 1; continue; }
    receivedByFounder[e.receivedById] = (receivedByFounder[e.receivedById] || 0) + e.amountCents;
  }

  // ── 2. Tekijöille maksettu, per maksaja ────────────────────────────────────
  const payouts: TasausPayoutRow[] = [];
  const paidByFounder: Record<string, number> = {};
  let workerP1EarnedCents = 0;
  let workerP2EarnedCents = 0;

  for (const inv of invoices) {
    if (!isLiveWorkerInvoice(inv)) continue;
    const gross = grossOf(inv);
    const scope: "p1" | "p2" = isP2EraSelection(inv.eraNumbers) ? "p2" : "p1";
    const recipientId = founderIds.has(inv.recipientId) ? inv.recipientId : null;
    const manual = paidBy[String(inv.id)];
    const paidById = manual && founderIds.has(manual) ? manual : recipientId;
    if (paidById) paidByFounder[paidById] = (paidByFounder[paidById] || 0) + gross;
    payouts.push({
      key: String(inv.id),
      invoiceId: inv.id,
      workerId: inv.senderId,
      workerName: inv.rivit?.input?.name || crew.find((c) => c.id === inv.senderId)?.name || inv.senderId,
      amountCents: gross,
      recipientId,
      paidById,
      overridden: !!manual && manual !== recipientId,
      scope,
      eraNumbers: inv.eraNumbers ?? [],
      unattributed: !paidById,
    });
  }

  // Käsin kirjatut payoutit (vanha kanava): raha on liikkunut, mutta kanava ei
  // tallenna maksajaa. Ne näkyvät omana rivinään eikä niitä arvata kummallekaan.
  let unattributedPaidCents = 0;
  for (const member of crew) {
    if (member.role === "host") continue;
    const paid = (member.payouts || []).filter((p) => p.status === "maksettu").reduce((s, p) => s + p.amountCents, 0);
    if (paid <= 0) continue;
    unattributedPaidCents += paid;
    payouts.push({
      key: `manual:${member.id}`,
      invoiceId: null,
      workerId: member.id,
      workerName: member.name || member.id,
      amountCents: paid,
      recipientId: null,
      paidById: paidBy[`manual:${member.id}`] && founderIds.has(paidBy[`manual:${member.id}`])
        ? paidBy[`manual:${member.id}`] : null,
      overridden: !!paidBy[`manual:${member.id}`],
      scope: "p1",
      eraNumbers: [],
      unattributed: !paidBy[`manual:${member.id}`],
    });
  }
  for (const row of payouts) {
    if (row.invoiceId != null || !row.paidById) continue;
    // Käsin kirjattu payout joka on kohdennettu → lasketaan maksajalle ja
    // poistetaan kohdentamattomien summasta.
    paidByFounder[row.paidById] = (paidByFounder[row.paidById] || 0) + row.amountCents;
    unattributedPaidCents -= row.amountCents;
  }

  // ── 3. Tekijöiden ansainta (kulupuoli) ─────────────────────────────────────
  // Luetaan KARTALTA eikä laskuista: lasku kertoo mitä on maksettu, ei mitä on
  // ansaittu. Jos näiden ero jätettäisiin huomiotta, maksamaton tekijävelka
  // näkyisi johtajien katteena — eli tasaus antaisi molemmille liikaa.
  const p2Bill = computeP2Billing(project);
  const wash = founderWashCounts(project);
  const { p1ByFounder, p2CentsByFounder, p1WindowsTotal } = wash;
  workerP1EarnedCents = Object.values(wash.workerP1EarnedByWorker).reduce((s, c) => s + c, 0);
  // KELTAISISTA VÄHENNETÄÄN JOHTAJIEN OMA OSUUS. `computeP2Billing.workerCostCents`
  // laskee palkkion JOKAISESTA pestystä ja lukitusta keltaisesta — myös niistä
  // jotka johtaja itse pesi. Sama summa annetaan johtajalle vielä kertaalleen
  // `p2OwnCents`inä, joten se laskettiin kahdesti: kertaalleen tekijäkuluna ja
  // kertaalleen johtajan ansaintana. Punaisilla sääntö on oikein päin
  // (`workerP1EarnedByWorker` sisältää vain tekijät), joten tämä yhdenmukaistaa
  // keltaiset punaisten kanssa.
  const founderP2Cents = Object.values(p2CentsByFounder).reduce((s, c) => s + c, 0);
  workerP2EarnedCents = Math.max(0, (p2Bill.workerCostCents ?? 0) - founderP2Cents);

  /**
   * KÄSINSYÖTTÖ OHITTAA JOHDETUN ARVON — KENTTÄ KERRALLAAN.
   *
   * Kartasta johtaminen on oikein niin kauan kuin kartta kertoo totuuden.
   * Mutta kartta voidaan nollata maksujen jälkeen, osa työstä on voitu tehdä
   * ennen järjestelmän käyttöönottoa, tai johtaja yksinkertaisesti tietää
   * luvun paremmin. Silloin automatiikka ei auta vaan haittaa: se kertoo
   * itsevarmasti nollaa, ja kaikki sen päälle laskettu menee pieleen.
   *
   * `null`/puuttuva = laske kartasta kuten ennenkin, joten käsinsyöttö voi
   * olla osittainen. Nolla on oikea arvo eikä tarkoita "ei asetettu".
   */
  const man = state?.manual;
  const pick = <T,>(manual: T | null | undefined, derived: T): T =>
    manual === null || manual === undefined ? derived : manual;

  const effP1Pot = pick(man?.p1PotCents, p1PotCents);
  const effP1WindowsTotal = pick(man?.p1WindowsTotal, p1WindowsTotal);
  const effWorkerP1Earned = pick(man?.workerP1EarnedCents, workerP1EarnedCents);

  const founderInputs: TasausFounderInput[] = founders.map((f) => ({
    id: f.id,
    name: f.name,
    p1Windows: pick(man?.p1WindowsByFounder?.[f.id], p1ByFounder[f.id] || 0),
    p2OwnCents: p2CentsByFounder[f.id] || 0,
    receivedCents: receivedByFounder[f.id] || 0,
    paidOutCents: paidByFounder[f.id] || 0,
    expensesCents: state?.expensesCents?.[f.id] || 0,
  }));

  const transfers: TasausTransfer[] = (state?.transfers ?? []).map((t) => ({
    fromId: t.fromId, toId: t.toId, cents: t.cents,
  }));

  const input: TasausInput = {
    founders: founderInputs,
    p1PotCents: effP1Pot,
    p2PotCents,
    workerP1EarnedCents: effWorkerP1Earned,
    workerP2EarnedCents,
    p1WindowsTotal: effP1WindowsTotal,
    transfers,
    overrideCents: state?.overrideCents ?? null,
    overrideFromId: state?.overrideFromId ?? null,
    reserveOwnerId: state?.reserveOwnerId ?? null,
  };

  return {
    founders,
    eras,
    payouts,
    unattributedPaidCents: Math.max(0, unattributedPaidCents),
    input,
    result: computeTasaus(input),
    unassignedEraCount,
    unattributedP1Windows: wash.unattributedP1Windows,
    ...(man ? {
      manual: {
        active: man,
        derived: {
          p1PotCents, p1WindowsTotal, workerP1EarnedCents,
          p1WindowsByFounder: p1ByFounder,
        },
      },
    } : {}),
  };
}

/** Ei-laskettu, mutta hyödyllinen: onko keltaisia hyväksymättä (teoreettista
 *  rahaa joka ei ole vielä kenenkään). */
export function tasausPendingP2Cents(project: ProjectData): number {
  if (!project.p2?.enabled) return 0;
  const offers = project.p2?.offers ?? {};
  let cents = 0;
  for (const pt of allPoints(project)) {
    if (pt.p !== 2 || pt.status !== "pesty") continue;
    const pending = p2PendingPriceCents(offers[pt.key]);
    if (pending != null) cents += pending;
  }
  return cents;
}
