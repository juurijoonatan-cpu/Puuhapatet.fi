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
  /** MAKSAMATTOMAT punaiset ikkunat. Selite kirjoitetaan tästä eikä koko
   *  pestystä määrästä: "34 ikkunaa 60,00 €" olisi rivi joka väittää
   *  20 €/ikkuna-työstä 1,76 €/ikkuna. */
  openP1Windows: number;
  /** Keltaiset (asiakkaan hyväksymä lisätyö). */
  p2Washed: number;
  openP2Cents: number;
  /** Tuntityö eriteltynä — tämä puuttui laskuilta ja näkymistä kokonaan. */
  hours: number;
  hourRateCents: number;
  openHoursCents: number;
  /** MAKSAMATTOMAT tunnit. Selite lasketaan tästä eikä kokonaistuntimäärästä:
   *  osamaksun jälkeen "20 h × 15 € = 75 €" ei täsmäisi millään. */
  openHours: number;
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

/**
 * Mikä tätä siirtoa vielä estää.
 *
 * Tekijälle ei siirretä rahaa ennen kuin hänen oma laskunsa on olemassa ja hän
 * on hyväksynyt sen (ks. hyväksyntäketju tekijän työpöydällä). Siksi jokainen
 * tekijärivi on jommassakummassa odotustilassa, ja rivin tila kertoo mitä
 * seuraavaksi pitää tehdä — ei pelkkää "estetty"-varoitusta koko summan päälle.
 */
export type TransferStatus =
  /** Valmis siirrettäväksi (johtajien tasaus). */
  | "valmis"
  /** Lasku on tehty, tekijä ei ole vielä hyväksynyt sitä. */
  | "odottaa_hyvaksyntaa"
  /** Velkaa jolle ei ole vielä tehty laskua lainkaan. */
  | "lasku_tekematta"
  /**
   * Johtajien siirto joka on VIELÄ VÄLIAIKAINEN: se sisältää tekijöille
   * kuuluvaa rahaa tasan jaettuna, joten se pienenee kun tekijät on maksettu.
   * Tässä järjestyksessä tehtynä kumpikaan ei siirrä liikaa.
   */
  | "maksa_tekijat_ensin";

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
  status: TransferStatus;
  /** Mitä pitää tehdä ennen kuin raha liikkuu. Tyhjä kun status on "valmis". */
  blockedReason?: string;
  /** Odottaako tämä vielä jotain? `status !== "valmis"`. Pidetään omana
   *  kenttänään, jotta näkymän ei tarvitse tulkita statusta itse. */
  blocked: boolean;
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
  /** Asiakkaalta laskutettu virroittain. Yhdistetyn laskun (`scope:"all"`)
   *  osuudet luetaan `parts`ista, jotta tuntilasku ei näy urakan eränä. */
  p1InvoicedCents: number;
  p2InvoicedCents: number;
  hoursInvoicedCents: number;
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
  /** Summa joka odottaa tekijän hyväksyntää (lasku tehty, ei kuitattu). */
  awaitingApprovalCents: number;
  /** Summa jolle ei ole vielä tehty laskua lainkaan. */
  missingInvoiceCents: number;
  /** Kaikki mikä odottaa jotain ennen siirtoa = awaiting + missing. */
  blockedCents: number;
}

const eur = (c: number) =>
  (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const num = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 1 });

/**
 * Tekijän osuuden selite: vain ne virrat joissa on rahaa.
 *
 * Tunnit luetaan MAKSAMATTOMISTA tunneista (`openHours`), ei koko keikan
 * tuntimäärästä: osamaksun jälkeen "20 h × 15,00 € = 75,00 €" olisi rivi joka
 * ei täsmää itsensä kanssa.
 */
function whyFor(r: TransferReportWorkerRow): string {
  const parts: string[] = [];
  if (r.openP1Cents > 0) {
    parts.push(r.openP1Windows > 0
      ? `${num(r.openP1Windows)} ikkunaa ${eur(r.openP1Cents)}`
      : `ikkunatyö ${eur(r.openP1Cents)}`);
  }
  if (r.openP2Cents > 0) parts.push(`keltaiset ${eur(r.openP2Cents)}`);
  if (r.openHoursCents > 0) {
    parts.push(r.openHours > 0 && r.hourRateCents > 0
      ? `${num(r.openHours)} h × ${eur(r.hourRateCents)} = ${eur(r.openHoursCents)}`
      : `tuntityö ${eur(r.openHoursCents)}`);
  }
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

/**
 * Tekijän hyväksyntätila — JOHDETTU SUMMISTA, ei laskujen olemassaolosta.
 *
 * Aiempi versio katsoi vain "onko tällä tekijällä luonnos", jolloin yhden
 * rahavirran luonnos leimasi toisen virran täysin laskuttamattoman saldon
 * "odottaa tekijän hyväksyntää" -tilaan. Summat tietävät totuuden: luonnos
 * varaa velan (`pendingCents`), joten kaikki mikä on yhä `openCents`inä on
 * laskuttamatta riippumatta siitä mitä muita laskuja tekijällä on.
 *
 * MITÄTÖITY LASKU EI OLE HYVÄKSYNTÄ: se ei kuittaa velkaa eikä siirrä rahaa.
 */
function approvalOf(pendingCents: number, openCents: number, hasLiveInvoice: boolean): WorkerApproval {
  if (openCents > 0) return "ei_laskua";
  if (pendingCents > 0) return "odottaa_tekijaa";
  return hasLiveInvoice ? "hyvaksytty" : "ei_maksettavaa";
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
  //
  // VIRTA KERRALLAAN. Ehto oli `scope !== "p2"`, eli tuntilasku ja yhdistetty
  // lasku luettiin urakan eräksi — sama vika joka `p2InvoiceState`ssa on jo
  // korjattu. Yhdistetyn laskun osuudet luetaan `parts`ista, ja jäännös on
  // urakkaa; kokonaissumma on maksurivien summa sellaisenaan, jokainen euro
  // kerran.
  const live = tasaus.eras.filter((e) => !e.voided);
  let p1InvoicedCents = 0;
  let p2InvoicedCents = 0;
  let hoursInvoicedCents = 0;
  for (const e of live) {
    if (e.scope === "p2") p2InvoicedCents += e.amountCents;
    else if (e.scope === "hours") hoursInvoicedCents += e.amountCents;
    else if (e.scope === "all") {
      const hoursPart = e.parts?.hours ?? 0;
      const p2Part = e.parts?.p2 ?? 0;
      hoursInvoicedCents += hoursPart;
      p2InvoicedCents += p2Part;
      p1InvoicedCents += Math.max(0, e.amountCents - hoursPart - p2Part);
    } else p1InvoicedCents += e.amountCents;
  }
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
  //
  // SAMAT RAJAUKSET KUIN MAKSUNÄKYMÄSSÄ (oletukset: ei harjoittelijoita, ei
  // deaktivoituja). Raportti listasi ne aiemmin mukaan, jolloin siirtolistalla
  // oli rivejä joille ei voi tehdä maksua lainkaan — harjoittelija ei laskuta
  // meitä, vaan hänen palkkansa tilittää vastuujohtaja — ja "siirrettävää
  // yhteensä" oli eri luku raportissa kuin ruudulla.
  const settlements: WorkerSettlement[] = computeWorkerSettlements(project, {
    era: eraSettlementByWorker(invoices, "p1"),
    p2Era: eraSettlementByWorker(invoices, "p2"),
    hoursEra: eraSettlementByWorker(invoices, "hours"),
  });

  const liveInvoiceWorkers = new Set(
    invoices.filter((i) => i.kind === "tekija" && i.tila !== "hylätty").map((i) => i.senderId),
  );

  const workers: TransferReportWorkerRow[] = settlements
    .map((r) => {
      // KAIKKI KOLME VIRTAA (`pendingTotalCents`). Luonnos varaa velan, joten
      // ilman tätä juuri tehty maksu katosi raportilta: avoin summa oli nolla
      // eikä mikään kenttä kertonut mihin se meni.
      const pendingCents = r.pendingTotalCents;
      return {
        workerId: r.workerId,
        name: r.name,
        trainee: r.trainee,
        p1Washed: r.p1Washed,
        openP1Cents: r.openP1Cents,
        openP1Windows: r.openP1Windows,
        p2Washed: r.p2Washed,
        openP2Cents: r.openP2Cents,
        hours: r.hours,
        hourRateCents: r.hourRateCents,
        openHoursCents: r.openHoursCents,
        openHours: r.openHours,
        openTotalCents: r.openTotalCents,
        settledCents: r.settledTotalCents,
        pendingCents,
        approval: approvalOf(pendingCents, r.openTotalCents, liveInvoiceWorkers.has(r.workerId)),
        payerId: payerFor(r.workerId, invoices, latestInvoice?.billerId ?? null),
      };
    })
    // Rivi on mukana jos siinä on rahaa jossain vaiheessa ketjua: siirrettävää,
    // kuittausta odottavaa tai jo hoidettua. Luonnos on nimenomaan mukana —
    // se on se rivi jonka tekijä on unohtanut hyväksyä.
    .filter((r) => r.openTotalCents > 0 || r.pendingCents > 0 || r.settledCents > 0);

  const totals = sumWorkerSettlements(settlements);
  /**
   * SIIRRETTÄVÄÄ YHTEENSÄ = avoin velka + kuittausta odottavat laskut.
   *
   * Luonnos varaa velan (`openTotalCents` ei sisällä sitä), joten pelkkä avoin
   * summa jättäisi juuri tehdyt maksut kokonaan pois otsikkoluvusta: johtaja
   * tekisi laskut ja näkisi siirrettävän tippuvan nollaan ennen kuin senttiäkään
   * on liikkunut.
   */
  const workerOpenTotalCents = workers.reduce((sum, w) => sum + w.openTotalCents + w.pendingCents, 0);

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
  //
  // Tekijälle voi tulla KAKSI riviä, koska ne odottavat eri asiaa: jo tehty
  // lasku odottaa tekijän hyväksyntää, ja sen ylittävä velka odottaa että
  // johtaja tekee laskun. Yhtenä rivinä kahdesta tilasta ei voisi kertoa
  // kumpaakaan oikein.
  const instructions: TransferInstruction[] = [];
  let awaitingApprovalCents = 0;
  let missingInvoiceCents = 0;
  for (const w of workers) {
    const from = {
      fromId: w.payerId ?? "",
      fromName: w.payerId ? founderName(w.payerId) : "— maksaja kirjaamatta",
      toId: w.workerId,
      toName: w.name,
    };
    if (w.pendingCents > 0) {
      awaitingApprovalCents += w.pendingCents;
      instructions.push({
        kind: "worker", ...from,
        cents: w.pendingCents,
        why: "Lasku tehty — siirto kun tekijä on hyväksynyt sen työpöydällään",
        status: "odottaa_hyvaksyntaa",
        blocked: true,
        blockedReason: "Tekijä ei ole vielä hyväksynyt laskuaan",
      });
    }
    if (w.openTotalCents > 0) {
      missingInvoiceCents += w.openTotalCents;
      instructions.push({
        kind: "worker", ...from,
        cents: w.openTotalCents,
        why: whyFor(w),
        status: "lasku_tekematta",
        blocked: true,
        blockedReason: "Tee tekijälle lasku — hyväksynnän jälkeen siirto",
      });
    }
  }
  if (founderTransfer) {
    /**
     * VAROITUS TEKIJÖILLE KUULUVASTA RAHASTA.
     *
     * Kun tekijöille on vielä maksamatta, se raha on jonkun johtajan taskussa
     * ja tasaus jakaa varauksen (`reserveCents`) oletuksena tasan — kumpikaan
     * ei rahoita sitä yksin. Se on oikea sääntö, mutta se tekee johtajasiirrosta
     * VÄLIAIKAISEN: jos siirron tekee ennen tekijöiden maksua, siirtäjä maksaa
     * ensin puolet varauksesta toiselle ja sitten koko tekijävelan itse — eli
     * siirtää liikaa.
     *
     * Siksi rivi sanoo sen ääneen ja kehottaa maksamaan tekijät ensin. Luku
     * päivittyy itsestään kun tekijät on maksettu (tasausnäkymässä voi myös
     * merkitä kumpi varauksen kantaa).
     */
    const reserveWarning = tasaus.result.reserveCents > 0 && missingInvoiceCents + awaitingApprovalCents > 0
      ? ` · HUOM: sisältää ${eur(tasaus.result.reserveCents)} tekijöille kuuluvaa rahaa tasan jaettuna — maksa tekijät ensin, niin tämä luku päivittyy`
      : "";
    instructions.push({
      kind: "founder",
      fromId: founderTransfer.fromId,
      fromName: founderTransfer.fromName,
      toId: founderTransfer.toId,
      toName: founderTransfer.toName,
      cents: founderTransfer.cents,
      why: `Johtajien tasaus — oma työ + osuus katteesta vs. käsissä oleva raha${reserveWarning}`,
      status: reserveWarning ? "maksa_tekijat_ensin" : "valmis",
      blocked: !!reserveWarning,
      ...(reserveWarning ? { blockedReason: "Maksa tekijät ensin — summa sisältää heille kuuluvaa rahaa" } : {}),
    });
  }

  return {
    title: input.title,
    latestInvoice,
    p1InvoicedCents,
    p2InvoicedCents,
    hoursInvoicedCents,
    invoicedTotalCents: live.reduce((sum, e) => sum + e.amountCents, 0),
    workers,
    workerOpenTotalCents,
    workerSettledTotalCents: totals.settledTotalCents,
    founders,
    founderTransfer,
    instructions,
    reserveCents: tasaus.result.reserveCents,
    awaitingApprovalCents,
    missingInvoiceCents,
    blockedCents: awaitingApprovalCents + missingInvoiceCents,
  };
}
