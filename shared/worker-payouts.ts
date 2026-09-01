/**
 * FR8 — tekijöiden maksettava: YKSI totuuden lähde.
 *
 * Miksi tämä moduuli on olemassa: sama laskenta ("paljonko tekijälle pitää vielä
 * siirtää") oli aiemmin kolmessa paikassa (crew.tsx PayrollSummary, project.tsx
 * ansiomalli, WorkerEraInvoiceDialogin esitäyttö) ja jokainen laski sen eri
 * tavalla. Pahin seuraus: kaikki kolme laskivat KELTAISET (P2) mukaan punaisten
 * maksuun, vaikka keltaisia ei ole vielä laskutettu asiakkaalta eikä siis
 * makseta tekijöille.
 *
 * Kaksi rahavirtaa, jotka EI SAA sekoittua (ks. docs/fr8-jarjestelma-yleiskuva.md):
 *
 *  1. **PUNAISET (P1)** — kiinteä urakka, 4 arvomääräistä maksuerää. Kun asiakas
 *     on maksanut erän, perustaja siirtää tekijöille heidän punaisista
 *     kertyneen palkkansa. `openP1Cents` on TÄSMÄLLEEN se summa.
 *  2. **KELTAISET (P2)** — ikkunakohtaisesti neuvoteltu lisätyö, laskutetaan
 *     erikseen (`scope:"p2"`). Tekijän keltainen palkkio on `openP2Cents`, ja se
 *     odottaa omaa laskuaan — sitä EI koskaan lisätä punaisten erämaksuun.
 *
 * Puhdas laskenta: ei I/O:ta, ei Reactia. Sekä client että server importtaavat.
 */

import type { ProjectData } from "./project";
import { getCrew, crewMemberStats, type CrewMember, type CrewMemberStats } from "./crew";
import { traineeForUserId, traineeForName } from "./trainees";
import { isP2EraSelection } from "./era-billing";

/** Erälaskun tila joka tarkoittaa "tämä on tekijälle hoidettu". Luonnos odottaa
 *  vielä tekijää, hylätty ei koskaan maksettu. */
export type SettledEraTila = "lähetetty" | "hyväksytty";

export interface EraInvoiceLike {
  kind: string;
  tila: string;
  /** Tekijälaskulla myyjä = tekijän crew-id. */
  senderId: string;
  totalCents: number;
  /** Erät joita tämä lasku koskee (esim. [1,2,3] tai [4]). */
  eraNumbers?: number[];
  /** Tallennettu laskurivi. `input.pestytIkkunat` = montako ikkunaa lasku kattoi,
   *  `computed.ansaittuCents` = BRUTTO ansio (ennen ennakon vähennystä). */
  rivit?: { input?: { pestytIkkunat?: number }; computed?: { ansaittuCents?: number } } | null;
}

/** Onko tämä erälasku tekijälle jo "hoidettu"? Lähetetty/hyväksytty = lukittu ja
 *  maksussa. Yksi predikaatti, ettei tila-suodatus rapistu eri näkymissä. */
export function isEraInvoiceSettled(inv: EraInvoiceLike): boolean {
  return inv.kind === "tekija" && (inv.tila === "lähetetty" || inv.tila === "hyväksytty");
}

/** Luonnos = johtaja on jo luonut maksun, mutta tekijä ei ole vielä kuitannut sitä.
 *  Ei vielä maksettu — MUTTA ei myöskään "tekemättä": jos tämä laskettaisiin
 *  avoimeksi, johtaja luulisi maksun kadonneen ja loisi sen uudelleen. */
export function isEraInvoicePending(inv: EraInvoiceLike): boolean {
  return inv.kind === "tekija" && inv.tila === "luonnos";
}

/** Erälaskun kattama BRUTTO velka. `totalCents` on maksettava = ansaittu − ennakko,
 *  joten se aliarvioi hoidetun velan aina kun ennakkoa on kirjattu. Velan
 *  kuittaukseen käytetään bruttoa; puuttuessa palataan `totalCents`iin. */
export function eraInvoiceGrossCents(inv: EraInvoiceLike): number {
  const gross = inv.rivit?.computed?.ansaittuCents;
  return typeof gross === "number" && Number.isFinite(gross) ? gross : inv.totalCents;
}

export interface EraSettlementMaps {
  /** Tekijä-id → erälaskuilla hoidetut sentit (brutto). */
  centsByWorker: Record<string, number>;
  /** Tekijä-id → erälaskuilla katetut ikkunat (esitäytön jäljellä-määrä). */
  windowsByWorker: Record<string, number>;
  /** Tekijä-id → mitkä erät on jo laskutettu (esim. {jani: [1,2,3]}). */
  eraNumbersByWorker: Record<string, number[]>;
  /** Tekijä-id → luonnoksena odottavat sentit (tekijä ei ole vielä kuitannut). */
  pendingCentsByWorker: Record<string, number>;
  /** Tekijä-id → luonnoksissa olevat ikkunat — nämäkin vähennetään esitäytöstä,
   *  ettei samasta työstä synny toista maksua. */
  pendingWindowsByWorker: Record<string, number>;
}

/**
 * Erälaskuista johdetut per-tekijä summat yhdellä läpikäynnillä.
 *
 * `scope` valitsee kumman rahavirran laskut luetaan: "p1" (punaisten erät 1–4,
 * oletus) tai "p2" (keltaisten potti). Ne EIVÄT saa kuitata toisiaan — keltaisten
 * maksu ei vähennä punaista velkaa eikä toisinpäin.
 */
export function eraSettlementByWorker(invoices: EraInvoiceLike[], scope: "p1" | "p2" = "p1"): EraSettlementMaps {
  const wanted = scope === "p2";
  invoices = invoices.filter((i) => isP2EraSelection(i.eraNumbers) === wanted);
  const centsByWorker: Record<string, number> = {};
  const windowsByWorker: Record<string, number> = {};
  const eraNumbersByWorker: Record<string, number[]> = {};
  const pendingCentsByWorker: Record<string, number> = {};
  const pendingWindowsByWorker: Record<string, number> = {};
  for (const inv of invoices) {
    const windows = inv.rivit?.input?.pestytIkkunat || 0;
    if (isEraInvoicePending(inv)) {
      pendingCentsByWorker[inv.senderId] = (pendingCentsByWorker[inv.senderId] || 0) + eraInvoiceGrossCents(inv);
      pendingWindowsByWorker[inv.senderId] = (pendingWindowsByWorker[inv.senderId] || 0) + windows;
    }
    if (!isEraInvoiceSettled(inv)) continue;
    centsByWorker[inv.senderId] = (centsByWorker[inv.senderId] || 0) + eraInvoiceGrossCents(inv);
    windowsByWorker[inv.senderId] = (windowsByWorker[inv.senderId] || 0) + windows;
    const list = eraNumbersByWorker[inv.senderId] || (eraNumbersByWorker[inv.senderId] = []);
    for (const n of inv.eraNumbers || []) if (!list.includes(n)) list.push(n);
  }
  for (const list of Object.values(eraNumbersByWorker)) list.sort((a, b) => a - b);
  return { centsByWorker, windowsByWorker, eraNumbersByWorker, pendingCentsByWorker, pendingWindowsByWorker };
}

export interface WorkerSettlement {
  workerId: string;
  name: string;
  active: boolean;
  /** Onko tämä tekijä perustaja (role "host")? Perustajat eivät ole tekijöiden
   *  maksulistalla — he tilittävät keskenään johtaja-välisillä laskuilla. */
  founder: boolean;
  /** Harjoittelija (esim. Milja): EI itsenäinen alihankkija, ei laskuta meitä.
   *  Hänen palkkansa tilittää vastuujohtaja, joten hän ei koskaan kuulu
   *  tekijöiden maksulistalle — muuten sama työ maksettaisiin kahdesti. */
  trainee: boolean;
  /** Ikkunat prioriteetin mukaan (0,5 jaetusta ikkunasta). */
  p1Washed: number;
  p2Washed: number;
  washed: number;
  /** Punaisista kertynyt palkka BRUTTONA (× tekijän oma €/ikkuna). */
  p1EarnedCents: number;
  /** Sovittu muutos punaisten palkkaan (− vähennys / + lisä). Näkyy erikseen,
   *  jotta brutto ja lopullinen maksettava ovat molemmat luettavissa. */
  p1AdjustmentCents: number;
  /** p1Earned + sovittu muutos, ei koskaan alle nollan = maksettava brutto. */
  p1PayableCents: number;
  /** Keltaisista kertynyt palkkio ASIAKKAAN HYVÄKSYMISTÄ ikkunoista. */
  p2EarnedCents: number;
  /** Keltaiset jotka on PESTY mutta joiden hintaa asiakas ei ole vielä
   *  hyväksynyt: odotettu palkkio. Työ on tehty — ei katoa mihinkään — mutta ei
   *  ole vielä maksettavaa rahaa. */
  p2PendingCents: number;
  p2PendingWashed: number;
  earnedCents: number;
  /** Käsin kirjatut, "maksettu"-tilaiset payoutit. */
  paidCents: number;
  /** Tekijälle lähetetyt/hyväksytyt erälaskut (brutto ansio). */
  eraSentCents: number;
  /** Luonnoksena odottavat erälaskut — johtaja loi maksun, tekijä ei ole vielä
   *  kuitannut. EI hoidettu, mutta ei myöskään uudelleen luotava. */
  eraPendingCents: number;
  /** paid + eraSent — kaikki mitä tekijälle on hoidettu. */
  settledCents: number;
  /** PUNAISISTA vielä siirtämättä. Tämä on se summa jonka perustaja maksaa
   *  erämaksulla. */
  openP1Cents: number;
  /** KELTAISISTA vielä siirtämättä — odottaa P2-laskun rahoja, ei mene punaisten
   *  erämaksuun. */
  openP2Cents: number;
  /** Ikkunamäärä joka on vielä maksamatta punaisista — erämaksun esitäyttö. */
  openP1Windows: number;
  /** Erät jotka tälle tekijälle on jo laskutettu (esim. [1,2,3]). */
  settledEras: number[];
  /** Keltaisista jo maksettu tai maksussa (kuittaa vain keltaista velkaa). */
  p2SettledCents: number;
}

/**
 * Kaikkien tekijöiden maksutilanne yhdellä kutsulla.
 *
 * Kohdennus: hoidetut eurot (payoutit + erälaskut) kuittaavat ENSIN punaista
 * velkaa ja vasta ylivuoto keltaista. Näin `openP1Cents` ei koskaan näytä
 * maksettua punaista velkaa avoimena, eikä keltainen palkkio "katoa" siksi että
 * punaisia maksettiin.
 */
export function computeWorkerSettlements(
  project: ProjectData,
  opts: {
    /** PUNAISTEN erälaskuista johdetut summat (`eraSettlementByWorker(inv, "p1")`). */
    era?: Partial<EraSettlementMaps>;
    /** KELTAISTEN maksuista johdetut summat (`eraSettlementByWorker(inv, "p2")`). */
    p2Era?: Partial<EraSettlementMaps>;
    /** Jätä perustajat (role "host") pois — oletus true, koska perustajat
     *  tilittävät johtaja-välisillä laskuilla, eivät tekijämaksuilla. */
    includeFounders?: boolean;
    /** Ota harjoittelijat mukaan (oletus: EI — heidän palkkansa kulkee johtajan
     *  kautta, joten maksulistalla he olisivat tuplaus). */
    includeTrainees?: boolean;
    /** Ota epäaktiiviset (active === false) mukaan. Oletus: EI — deaktivoitu
     *  tekijä on hoidettu eikä kuulu enää maksulistalle. */
    includeInactive?: boolean;
    /** Valmiit crew-rivit, jos kutsuja on jo ladannut ne (server /crew-reitti
     *  suodattaa host-rivit pois, joten se antaa oman listansa). */
    crew?: CrewMember[];
  } = {},
): WorkerSettlement[] {
  const eraSent = opts.era?.centsByWorker ?? {};
  const p2Era = opts.p2Era ?? {};
  const eraWindows = opts.era?.windowsByWorker ?? {};
  const eraNums = opts.era?.eraNumbersByWorker ?? {};
  const eraPending = opts.era?.pendingCentsByWorker ?? {};
  const eraPendingWindows = opts.era?.pendingWindowsByWorker ?? {};
  const crew = opts.crew ?? getCrew(project);
  const rows: WorkerSettlement[] = [];

  for (const member of crew) {
    const founder = member.role === "host";
    if (founder && !opts.includeFounders) continue;
    const trainee = isTraineeMember(member);
    if (trainee && !opts.includeTrainees) continue;
    if (member.active === false && !opts.includeInactive) continue;
    rows.push(settleWorker({
      id: member.id,
      name: member.name || member.id,
      active: member.active !== false,
      founder,
      trainee,
      stats: crewMemberStats(project, member),
      payouts: member.payouts || [],
      adjustmentCents: member.payAdjustmentCents ?? 0,
      p2Enabled: !!project.p2?.enabled,
      era: { eraSent, eraWindows, eraNums, eraPending, eraPendingWindows },
      p2Settled: {
        sentCents: p2Era.centsByWorker?.[member.id] || 0,
        pendingCents: p2Era.pendingCentsByWorker?.[member.id] || 0,
      },
    }));
  }

  return rows.sort((a, b) => b.openP1Cents - a.openP1Cents || b.p1EarnedCents - a.p1EarnedCents);
}

/**
 * Yhden tekijän maksutilanne valmiista statseista. Oma funktio, koska Tiimi-sivu
 * saa crew-rivit serveriltä (`GET /crew` palauttaa jo `crewMemberStats`in) eikä
 * sillä ole koko karttablobia — silti sen pitää laskea maksettava TÄSMÄLLEEN
 * samalla säännöllä kuin Maksut-välilehti ja maksudialogi.
 */
export function settleWorker(input: {
  id: string;
  name: string;
  active: boolean;
  founder: boolean;
  trainee?: boolean;
  stats: Pick<CrewMemberStats, "washed" | "earnedCents" | "p1EarnedCents" | "p2EarnedCents" | "p1Washed" | "p2Washed"> & Partial<Pick<CrewMemberStats, "p2PendingCents" | "p2PendingWashed">>;
  payouts: { status: string; amountCents: number }[];
  /** Onko vaihe 2 päällä? Ohjaa sitä lasketaanko keltaiset omaan pottiinsa. */
  p2Enabled: boolean;
  era: {
    eraSent: Record<string, number>;
    eraWindows: Record<string, number>;
    eraNums: Record<string, number[]>;
    eraPending: Record<string, number>;
    eraPendingWindows: Record<string, number>;
  };
  /** Keltaisista jo maksettu / maksussa oleva — kuittaa VAIN keltaista velkaa. */
  p2Settled?: { sentCents: number; pendingCents: number };
  /** Sovittu muutos punaisten palkkaan (CrewMember.payAdjustmentCents). */
  adjustmentCents?: number;
}): WorkerSettlement {
  const { id, name, active, founder, stats, payouts, p2Enabled, era } = input;
  const trainee = input.trainee === true;
  const paidCents = payouts.filter((p) => p.status === "maksettu").reduce((s, p) => s + p.amountCents, 0);
  const eraSentCents = era.eraSent[id] || 0;
  const eraPendingCents = era.eraPending[id] || 0;
  const settledCents = paidCents + eraSentCents;

  // Kohdennus: punainen velka kuitataan punaisten maksuilla, keltainen keltaisten
  // maksuilla. Luonnokset lasketaan mukaan kuittaukseen — muuten juuri luotu maksu
  // näkyisi yhä "Avoinna"na ja johtaja loisi sen toistamiseen (ks. eraPendingCents).
  //
  // Käsin kirjatut payoutit (vanha kanava) eivät tiedä kummasta rahasta on kysymys,
  // joten ne kuittaavat ensin punaista ja ylivuoto menee keltaiseen.
  const p2SettledCents = (input.p2Settled?.sentCents ?? 0) + (input.p2Settled?.pendingCents ?? 0);
  // Sovittu vähennys/lisä pienentää (tai kasvattaa) maksettavaa punaista. Brutto
  // (`p1EarnedCents`) säilyy koskemattomana, jotta ikkunat ja raha täsmäävät yhä.
  const p1AdjustmentCents = input.adjustmentCents ?? 0;
  const p1PayableCents = Math.max(0, stats.p1EarnedCents + p1AdjustmentCents);
  const reservedCents = settledCents + eraPendingCents;
  const p1Covered = Math.min(p1PayableCents, reservedCents);
  // Ylivuoto keltaiseen lasketaan BRUTOSTA, ei vähennetystä summasta. Muuten
  // sovittu vähennys olisi syönyt keltaisia: jos punaiset oli jo laskutettu
  // täytenä (100 €) ja johtaja kirjasi jälkikäteen 10 € vähennyksen, erotus olisi
  // valunut "ylivuotona" keltaisten päälle ja pienentänyt niitä 10 € — vaikka
  // vähennys sovittiin punaisista. Aitoon ylimaksuun (yli bruton) sääntö pätee
  // edelleen: käsin kirjattu liian iso maksu kuittaa keltaista.
  const p1Overflow = Math.max(0, reservedCents - Math.max(p1PayableCents, stats.p1EarnedCents));
  const p2Covered = Math.min(stats.p2EarnedCents, p2SettledCents + p1Overflow);
  const openP1Cents = Math.max(0, p1PayableCents - p1Covered);
  const openP2Cents = Math.max(0, stats.p2EarnedCents - p2Covered);

  // Punaisia ikkunoita vielä maksamatta. Kun P2 ei ole päällä, keltaiset
  // maksetaan normaalilla taksalla (legacy), joten ne kuuluvat samaan pottiin.
  const payableWindows = p2Enabled ? stats.p1Washed : stats.washed;
  const invoicedWindows = (era.eraWindows[id] || 0) + (era.eraPendingWindows[id] || 0);
  //
  // IKKUNAMÄÄRÄ JOHDETAAN RAHASTA, EI PELKÄSTÄ IKKUNAKIRJANPIDOSTA.
  //
  // Kaksi lähdettä voivat erota, koska KAIKKI maksukanavat eivät kirjaa
  // ikkunamäärää: käsin kirjattu payout (vanha kanava) siirtää euroja mutta ei
  // ikkunoita, ja erälaskulle voi kirjata ennakon tai sovitun muutoksen.
  // Todellinen tapaus: Jani 34 pestyä (680 € brutto), hoidettu 620 € → jäljellä
  // 60 € = 3 ikkunaa. Pelkkä ikkunakirjanpito (34 − 12 laskutettua) väitti 22
  // ikkunaa, ja maksudialogi olisi esitäyttänyt 22 × 20 € = 440 € eli maksanut
  // 380 € liikaa. Rivi näytti itse molemmat luvut vierekkäin:
  // "maksamatta 22 kpl · 60,00 €".
  //
  // Otetaan aina PIENEMPI: kumpikaan lähde ei saa yksin nostaa maksettavaa.
  // Raha lasketaan BRUTOSTA (ilman sovittua vähennystä), koska vähennys menee
  // laskulle omalle "sovittu muutos" -rivilleen eikä ikkunamäärään.
  const unpaidGrossCents = Math.max(0, stats.p1EarnedCents - reservedCents);
  const perWindowCents = payableWindows > 0 ? stats.p1EarnedCents / payableWindows : 0;
  const windowsFromMoney = perWindowCents > 0 ? unpaidGrossCents / perWindowCents : 0;
  const windowsFromLedger = Math.max(0, payableWindows - invoicedWindows);
  // Sovittu vähennys voi nollata maksettavan kokonaan — silloin myös esitäytetty
  // ikkunamäärä on nolla, muuten maksudialogi tarjoaisi ikkunoita nollan euron
  // laskulle. Ehto katsoo NIMENOMAAN maksettavaa (`p1PayableCents`), ei avointa
  // saldoa: jos velka on kuitattu käsin kirjatulla maksulla, ikkunamäärä saa yhä
  // näkyä, jotta kirjanpidollisen erälaskun voi tehdä jälkikäteen.
  const openP1Windows = p1PayableCents <= 0 ? 0 : round1(Math.min(windowsFromLedger, windowsFromMoney));

  return {
    workerId: id,
    name,
    active,
    founder,
    trainee,
    p1Washed: stats.p1Washed,
    p2Washed: stats.p2Washed,
    washed: stats.washed,
    p1EarnedCents: stats.p1EarnedCents,
    p1AdjustmentCents,
    p1PayableCents,
    p2EarnedCents: stats.p2EarnedCents,
    p2PendingCents: stats.p2PendingCents ?? 0,
    p2PendingWashed: stats.p2PendingWashed ?? 0,
    earnedCents: stats.earnedCents,
    paidCents,
    eraSentCents,
    eraPendingCents,
    settledCents,
    openP1Cents,
    openP2Cents,
    openP1Windows,
    settledEras: era.eraNums[id] ?? [],
    p2SettledCents,
  };
}

/** Onko tämä crew-rivi harjoittelija? Tunnistus linkitetystä login-id:stä, crew
 *  id:stä tai etunimestä — sama järjestys kuin muualla sovelluksessa. */
export function isTraineeMember(member: { id: string; name?: string; linkedUserId?: string }): boolean {
  return !!(traineeForUserId(member.linkedUserId) || traineeForUserId(member.id) || traineeForName(member.name));
}

/** `settleWorker`in era-parametri suoraan erälaskuista — kutsujan ei tarvitse
 *  koota viittä mappia itse. */
export function eraMapsFor(invoices: EraInvoiceLike[], scope: "p1" | "p2" = "p1") {
  const m = eraSettlementByWorker(invoices, scope);
  return {
    eraSent: m.centsByWorker,
    eraWindows: m.windowsByWorker,
    eraNums: m.eraNumbersByWorker,
    eraPending: m.pendingCentsByWorker,
    eraPendingWindows: m.pendingWindowsByWorker,
  };
}

export interface WorkerSettlementTotals {
  workers: number;
  p1Washed: number;
  p2Washed: number;
  p1EarnedCents: number;
  p1AdjustmentCents: number;
  p2EarnedCents: number;
  p2PendingCents: number;
  settledCents: number;
  eraPendingCents: number;
  openP1Cents: number;
  openP2Cents: number;
  openP1Windows: number;
}

/** Yhteissummat maksut-näkymän tiiliä varten. */
export function sumWorkerSettlements(rows: WorkerSettlement[]): WorkerSettlementTotals {
  return rows.reduce<WorkerSettlementTotals>((t, r) => ({
    workers: t.workers + 1,
    p1Washed: t.p1Washed + r.p1Washed,
    p2Washed: t.p2Washed + r.p2Washed,
    p1EarnedCents: t.p1EarnedCents + r.p1EarnedCents,
    p1AdjustmentCents: t.p1AdjustmentCents + r.p1AdjustmentCents,
    p2EarnedCents: t.p2EarnedCents + r.p2EarnedCents,
    p2PendingCents: t.p2PendingCents + r.p2PendingCents,
    settledCents: t.settledCents + r.settledCents,
    eraPendingCents: t.eraPendingCents + r.eraPendingCents,
    openP1Cents: t.openP1Cents + r.openP1Cents,
    openP2Cents: t.openP2Cents + r.openP2Cents,
    openP1Windows: round1(t.openP1Windows + r.openP1Windows),
  }), {
    workers: 0, p1Washed: 0, p2Washed: 0, p1EarnedCents: 0, p1AdjustmentCents: 0, p2EarnedCents: 0,
    p2PendingCents: 0, settledCents: 0, eraPendingCents: 0, openP1Cents: 0,
    openP2Cents: 0, openP1Windows: 0,
  });
}

/** Jaettuja ikkunoita on 0,5 — pidä yksi desimaali eikä liukulukuroskaa. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── P2-laskutuksen tila (asiakkaalta) ────────────────────────────────────────

export interface PaymentLike {
  amountCents: number;
  scope?: "p1" | "p2" | "hours";
  /** Mitätöity laskutuserä — säilyy tositteena, ei lasketa summiin. */
  voided?: boolean;
}

/**
 * Keltaisten laskutustila asiakkaalta. Tämä oli aiemmin kopioitu kolmeen
 * paikkaan (gig-tracker.tsx, project.tsx P2AdminPanel, server/routes.ts) —
 * jokainen suodatti `scope`ia omalla tavallaan. Nyt yksi funktio.
 *
 * KRIITTINEN invariantti: P1:n erälaskenta katsoo VAIN `scope !== "p2"`
 * -maksuja, joten p2-maksu ei koskaan kuluta punaisen urakan 4 erän rajaa.
 */
export function p2InvoiceState(earnedCents: number, payments: PaymentLike[]) {
  // Mitätöity erä ei ole laskutettua rahaa. Se jää riviksi tositteeksi, mutta
  // se ei saa näkyä missään summassa — muuten peruttu lasku pitäisi
  // liikevaihtoa keinotekoisesti ylhäällä.
  const live = payments.filter((p) => !p.voided);
  const p2Payments = live.filter((p) => p.scope === "p2");
  /**
   * P1 = urakan erät. Ehto oli `scope !== "p2"`, eli KAIKKI muu luettiin
   * P1:ksi — myös tuntikeikan lasku, joka on oma virtansa. Yksi tuntilasku
   * olisi siis kasvattanut kiinteän urakan eränumeroa ja syönyt sen
   * neljän erän laskennasta erän jota kukaan ei ole lähettänyt.
   *
   * Nyt P1 on nimenomainen: puuttuva scope (vanhat erät) tai "p1".
   */
  const p1Payments = live.filter((p) => p.scope == null || p.scope === "p1");
  const invoicedCents = p2Payments.reduce((s, p) => s + p.amountCents, 0);
  const p1InvoicedCents = p1Payments.reduce((s, p) => s + p.amountCents, 0);
  return {
    invoicedCents,
    remainingCents: Math.max(0, earnedCents - invoicedCents),
    payments: p2Payments.length,
    /** P1-puoli samasta suodatuksesta, jotta kutsujien ei tarvitse toistaa sitä. */
    p1InvoicedCents,
    p1Payments: p1Payments.length,
    /** Tuntikeikan oma virta — ei P1:n eriä eikä keltaisten kertymää. */
    hoursInvoicedCents: live.filter((p) => p.scope === "hours").reduce((s2, p) => s2 + p.amountCents, 0),
    hoursPayments: live.filter((p) => p.scope === "hours").length,
  };
}

/** Punaisten ikkunoiden kertymä eräkohtaisesti kuvattuna yhtenä rivinä
 *  ("2/4 erää lähetetty · 3 150,00 €") — käytetään useassa näkymässä. */
export function eraProgressLabel(p1PaymentCount: number, p1InvoicedCents: number): string {
  const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  return `${Math.min(4, p1PaymentCount)}/4 erää · ${eur(p1InvoicedCents)}`;
}
