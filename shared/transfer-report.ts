/**
 * SIIRTORAPORTTI — "mitä minun pitää siirtää kenelle".
 *
 * MIKSI TÄMÄ MODUULI ON OLEMASSA
 *
 * Kun asiakkaan lasku lähtee, johtajan päässä on täsmälleen yksi kysymys: **kun
 * tämä raha tulee tilille, kenelle minä siirrän ja paljonko.** Vastaus oli
 * hajallaan neljässä näkymässä (Maksut-välilehden tekijälista, tasausnäkymä,
 * erälaskuhistoria ja sisäinen maksuraportti), ja jokainen niistä vastasi vain
 * osaan: kukaan ei kertonut yhtä listaa jonka voi tehdä pankissa alusta loppuun.
 *
 * Tämä moduuli kokoaa sen yhdeksi listaksi:
 *
 *   1. **Tekijöille** — jokaisen tekijän osuus eriteltynä (punaiset ikkunat,
 *      keltaiset, tuntityö) ja se yksi summa joka hänelle siirretään, sekä
 *      onko hän jo hyväksynyt oman laskunsa.
 *   2. **Johtajalta johtajalle** — tasauksen jäljellä oleva siirto, eli se
 *      kumman taskussa raha oikeasti on vs. kenelle se kuuluu.
 *
 * Puhdas laskenta: ei I/O:ta, ei Reactia. Client näyttää tämän Maksut-
 * välilehdellä ja server lähettää saman sisällön sähköpostilla molemmille
 * johtajille kun asiakkaan lasku lähtee — SAMASTA funktiosta, jotta ruudulla ja
 * sähköpostissa ei voi lukea kahta eri lukua.
 */

import type { ProjectData } from "./project";
import { getCrew } from "./crew";
import { eraScopeOf } from "./era-billing";
import {
  computeWorkerSettlements, eraSettlementByWorker, sumWorkerSettlements,
  type EraInvoiceLike, type WorkerSettlement,
} from "./worker-payouts";
import { buildTasaus, type TasausEraInvoice, type TasausPayment } from "./fr8-tasaus";
import type { FounderSettlementState } from "./founder-settlement";
import { BRAND_BILLERS } from "./billers";

/** Erälasku sellaisena kuin siirtoraportti sen tarvitsee: tasauksen kentät
 *  (id, tila, ostaja) sekä `worker-payouts`in summat samasta rivistä. */
export type ReportEraInvoice = TasausEraInvoice & EraInvoiceLike;

/** Missä tekijän oma lasku menee. Tämä on se hyväksyntäketju jonka pitää olla
 *  valmis ENNEN kuin raha liikkuu. */
export type WorkerApproval =
  /** Ei vielä luotu maksua — johtajan pitää tehdä lasku. */
  | "ei_laskua"
  /** Luonnos odottaa tekijän hyväksyntää hänen omalla työpöydällään. */
  | "odottaa_tekijaa"
  /** Tekijä hyväksyi ja lähetti laskun — raha voi liikkua. */
  | "hyvaksytty"
  /** Ei maksettavaa. */
  | "ei_maksettavaa";

export interface TransferReportWorkerRow {
  workerId: string;
  name: string;
  trainee: boolean;
  /** Ikkunatyö: pestyt punaiset ja niistä vielä siirtämättä. */
  p1Washed: number;
  openP1Cents: number;
  /** Keltaiset (asiakkaan hyväksymä lisätyö). */
  p2Washed: number;
  openP2Cents: number;
  /** Tuntityö eriteltynä — tämä puuttui laskuilta ja näkymistä kokonaan. */
  hours: number;
  hourRateCents: number;
  openHoursCents: number;
  /** Punaiset + keltaiset + tunnit. Tämä on se luku joka siirretään. */
  openTotalCents: number;
  /** Mitä tälle tekijälle on jo hoidettu (maksut + lähetetyt erälaskut). */
  settledCents: number;
  /** Luonnoksena odottava (johtaja loi maksun, tekijä ei ole kuitannut). */
  pendingCents: number;
  approval: WorkerApproval;
  /** Kenelle tekijä laskuttaa = kuka siirtää rahat. Null kun laskua ei ole. */
  payerId: string | null;
}

/** Yksi konkreettinen siirto: kuka maksaa, kenelle, paljonko ja miksi. */
export interface TransferInstruction {
  kind: "worker" | "founder";
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  cents: number;
  /** Selite ("34 ikkunaa · 12,5 h") — pankkiin ei siirretä lukua jonka syytä
   *  ei näe. */
  why: string;
  /** Odottaako tämä vielä tekijän hyväksyntää? Raportti ei piilota näitä, mutta
   *  se sanoo ääneen ettei rahaa vielä siirretä. */
  blocked: boolean;
  blockedReason?: string;
}

export interface TransferReportFounderRow {
  id: string;
  name: string;
  /** Mitä tälle johtajalle kuuluu tästä keikasta. */
  entitledCents: number;
  /** Mitä hänen käsissään on nyt (asiakkaalta saatu − maksetut − kulut). */
  holdsCents: number;
  receivedCents: number;
  paidOutCents: number;
  /** Vielä maksettava (+) tai saatava (−) toiselle johtajalle. */
  remainingDueCents: number;
}

export interface TransferReport {
  /** Keikan nimi raportin otsikkoon. */
  title: string;
  /** Viimeisin asiakkaalle lähtenyt lasku — se joka raportin laukaisi. */
  latestInvoice: { label: string; amountCents: number; dateMs: number | null; billerId: string | null; billerName: string } | null;
  /** Asiakkaalta laskutettu virroittain. */
  p1InvoicedCents: number;
  p2InvoicedCents: number;
  invoicedTotalCents: number;
  workers: TransferReportWorkerRow[];
  /** Tekijöille yhteensä siirrettävä. */
  workerOpenTotalCents: number;
  /** Tekijöille jo hoidettu. */
  workerSettledTotalCents: number;
  founders: TransferReportFounderRow[];
  /** Johtajien välinen siirto, tasauksen jälkeen jäljellä. */
  founderTransfer: { fromId: string; fromName: string; toId: string; toName: string; cents: number } | null;
  /** Kaikki siirrot yhtenä listana — tämä on se mitä pankissa tehdään. */
  instructions: TransferInstruction[];
  /** Jakamaton varaus (tekijöille kuuluvaa johtajien käsissä tai päinvastoin). */
  reserveCents: number;
  /** Onko jokin siirto jumissa tekijän hyväksynnän takana? */
  blockedCents: number;
}

const eur = (c: number) =>
  (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const num = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

/** Tekijän osuuden selite: vain ne virrat joissa on rahaa. */
function whyFor(r: TransferReportWorkerRow): string {
  const parts: string[] = [];
  if (r.openP1Cents > 0) parts.push(`${num(r.p1Washed)} ikkunaa ${eur(r.openP1Cents)}`);
  if (r.openP2Cents > 0) parts.push(`keltaiset ${eur(r.openP2Cents)}`);
  if (r.openHoursCents > 0) parts.push(`${num(r.hours)} h × ${eur(r.hourRateCents)} = ${eur(r.openHoursCents)}`);
  return parts.join(" · ") || "—";
}

/**
 * Kuka siirtää tälle tekijälle?
 *
 * Etusijajärjestys: (1) tekijän oman avoimen laskun ostaja — se johtaja jolle
 * lasku on osoitettu, (2) sen johtajan id joka sai viimeisimmän asiakaserän
 * rahat, (3) tyhjä. EI arvausta kolikonheitolla: tuntematon maksaja näkyy
 * raportilla tyhjänä, jotta johtaja kirjaa sen itse.
 */
function payerFor(
  workerId: string,
  invoices: ReportEraInvoice[],
  fallbackFounderId: string | null,
): string | null {
  const own = invoices
    .filter((i) => i.kind === "tekija" && i.senderId === workerId && i.tila !== "hylätty")
    .sort((a, b) => b.id - a.id);
  const live = own.find((i) => i.tila === "luonnos") ?? own[0];
  return live?.recipientId || fallbackFounderId;
}

/** Tekijän hyväksyntätila hänen omista laskuistaan. */
function approvalFor(workerId: string, invoices: ReportEraInvoice[], openCents: number): WorkerApproval {
  const own = invoices.filter((i) => i.kind === "tekija" && i.senderId === workerId);
  if (own.some((i) => i.tila === "luonnos")) return "odottaa_tekijaa";
  if (openCents <= 0) return own.length > 0 ? "hyvaksytty" : "ei_maksettavaa";
  return "ei_laskua";
}

export function buildTransferReport(input: {
  title: string;
  project: ProjectData;
  /** Asiakkaan maksuerät (`gig.payments`). */
  payments: TasausPayment[];
  /** Keikan erälaskut. */
  invoices: ReportEraInvoice[];
  /** Johtajien käsin kirjaamat korjaukset (`project.settlement`). */
  settlement?: FounderSettlementState | null;
}): TransferReport {
  const { project, payments, invoices } = input;
  const crew = getCrew(project);
  const founderName = (id: string) =>
    crew.find((c) => c.id === id)?.name?.trim() || BRAND_BILLERS.find((b) => b.id === id)?.name || id;

  const tasaus = buildTasaus(project, payments, invoices, input.settlement ?? null);

  // ── Asiakaslaskutus ────────────────────────────────────────────────────────
  const live = tasaus.eras.filter((e) => !e.voided);
  const p1InvoicedCents = live.filter((e) => e.scope !== "p2").reduce((s, e) => s + e.amountCents, 0);
  const p2InvoicedCents = live.filter((e) => e.scope === "p2").reduce((s, e) => s + e.amountCents, 0);
  const latest = live.slice().sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0))[0] ?? null;
  const latestInvoice = latest
    ? {
        label: latest.label,
        amountCents: latest.amountCents,
        dateMs: latest.dateMs,
        billerId: latest.receivedById ?? latest.billerId,
        billerName: founderName(latest.receivedById ?? latest.billerId ?? ""),
      }
    : null;

  // ── Tekijöiden osuudet ─────────────────────────────────────────────────────
  //
  // Kolme rahavirtaa yhdestä laskennasta: ikkunat, keltaiset ja tunnit. Tämä on
  // sama `computeWorkerSettlements` jota Maksut-välilehti näyttää, joten raportti
  // ei voi olla eri mieltä ruudun kanssa.
  const settlements: WorkerSettlement[] = computeWorkerSettlements(project, {
    era: eraSettlementByWorker(invoices, "p1"),
    p2Era: eraSettlementByWorker(invoices, "p2"),
    hoursEra: eraSettlementByWorker(invoices, "hours"),
    includeTrainees: true,   // harjoittelijan palkan siirtää vastuujohtaja — se on yhä siirto
    includeInactive: true,   // tehty työ ei katoa deaktivoinnista
  });

  const workers: TransferReportWorkerRow[] = settlements
    .filter((r) => r.openTotalCents > 0 || r.settledTotalCents > 0 || r.eraPendingCents > 0)
    .map((r) => ({
      workerId: r.workerId,
      name: r.name,
      trainee: r.trainee,
      p1Washed: r.p1Washed,
      openP1Cents: r.openP1Cents,
      p2Washed: r.p2Washed,
      openP2Cents: r.openP2Cents,
      hours: r.hours,
      hourRateCents: r.hourRateCents,
      openHoursCents: r.openHoursCents,
      openTotalCents: r.openTotalCents,
      settledCents: r.settledTotalCents,
      pendingCents: r.eraPendingCents + r.hoursPendingCents,
      approval: approvalFor(r.workerId, invoices, r.openTotalCents),
      payerId: payerFor(r.workerId, invoices, latestInvoice?.billerId ?? null),
    }));

  const totals = sumWorkerSettlements(settlements);

  // ── Johtajat ───────────────────────────────────────────────────────────────
  const founders: TransferReportFounderRow[] = tasaus.result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    entitledCents: row.entitledCents,
    holdsCents: row.holdsCents,
    receivedCents: row.receivedCents,
    paidOutCents: row.paidOutCents,
    remainingDueCents: row.remainingDueCents,
  }));

  const t = tasaus.result.transfer;
  const founderTransfer = t
    ? { fromId: t.fromId, fromName: founderName(t.fromId), toId: t.toId, toName: founderName(t.toId), cents: t.cents }
    : null;

  // ── Siirrot yhtenä listana ─────────────────────────────────────────────────
  const instructions: TransferInstruction[] = [];
  for (const w of workers) {
    if (w.openTotalCents <= 0) continue;
    const blocked = w.approval !== "hyvaksytty" && w.approval !== "ei_maksettavaa";
    instructions.push({
      kind: "worker",
      fromId: w.payerId ?? "",
      fromName: w.payerId ? founderName(w.payerId) : "— maksaja kirjaamatta",
      toId: w.workerId,
      toName: w.name,
      cents: w.openTotalCents,
      why: whyFor(w),
      blocked,
      blockedReason: w.approval === "odottaa_tekijaa"
        ? "Tekijä ei ole vielä hyväksynyt laskuaan"
        : w.approval === "ei_laskua"
        ? "Laskua ei ole vielä luotu tekijälle"
        : undefined,
    });
  }
  if (founderTransfer) {
    instructions.push({
      kind: "founder",
      fromId: founderTransfer.fromId,
      fromName: founderTransfer.fromName,
      toId: founderTransfer.toId,
      toName: founderTransfer.toName,
      cents: founderTransfer.cents,
      why: "Johtajien tasaus — oma työ + osuus katteesta vs. käsissä oleva raha",
      blocked: false,
    });
  }

  return {
    title: input.title,
    latestInvoice,
    p1InvoicedCents,
    p2InvoicedCents,
    invoicedTotalCents: p1InvoicedCents + p2InvoicedCents,
    workers,
    workerOpenTotalCents: totals.openTotalCents,
    workerSettledTotalCents: totals.settledTotalCents,
    founders,
    founderTransfer,
    instructions,
    reserveCents: tasaus.result.reserveCents,
    blockedCents: instructions.filter((i) => i.blocked).reduce((s, i) => s + i.cents, 0),
  };
}
