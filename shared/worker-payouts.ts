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

import { computeShiftStats, effectiveWorkerHourRateOf, hourRateOf, isHourlyGig, type ProjectData, type ProjShift } from "./project";
import { getCrew, crewMemberStats, type CrewMember, type CrewMemberStats } from "./crew";
import { traineeForUserId, traineeForName } from "./trainees";
import { eraScopeOf, type EraScope } from "./era-billing";
import { isFounder } from "./team";

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
   *  `input.tunnit` = montako tuntia, `computed.ansaittuCents` = BRUTTO ansio
   *  (ennen ennakon vähennystä). */
  rivit?: { input?: { pestytIkkunat?: number; tunnit?: number }; computed?: { ansaittuCents?: number } } | null;
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
  /** Tekijä-id → erälaskuilla katetut TUNNIT (tuntityön esitäytön jäljellä-määrä). */
  hoursByWorker: Record<string, number>;
  /** Tekijä-id → luonnoksissa odottavat tunnit. */
  pendingHoursByWorker: Record<string, number>;
}

/**
 * Erälaskuista johdetut per-tekijä summat yhdellä läpikäynnillä.
 *
 * `scope` valitsee kumman rahavirran laskut luetaan: "p1" (punaisten erät 1–4,
 * oletus) tai "p2" (keltaisten potti). Ne EIVÄT saa kuitata toisiaan — keltaisten
 * maksu ei vähennä punaista velkaa eikä toisinpäin.
 */
export function eraSettlementByWorker(invoices: EraInvoiceLike[], scope: EraScope = "p1"): EraSettlementMaps {
  invoices = invoices.filter((i) => eraScopeOf(i.eraNumbers) === scope);
  const centsByWorker: Record<string, number> = {};
  const windowsByWorker: Record<string, number> = {};
  const eraNumbersByWorker: Record<string, number[]> = {};
  const pendingCentsByWorker: Record<string, number> = {};
  const pendingWindowsByWorker: Record<string, number> = {};
  const hoursByWorker: Record<string, number> = {};
  const pendingHoursByWorker: Record<string, number> = {};
  for (const inv of invoices) {
    const windows = inv.rivit?.input?.pestytIkkunat || 0;
    const hours = inv.rivit?.input?.tunnit || 0;
    if (isEraInvoicePending(inv)) {
      pendingCentsByWorker[inv.senderId] = (pendingCentsByWorker[inv.senderId] || 0) + eraInvoiceGrossCents(inv);
      pendingWindowsByWorker[inv.senderId] = (pendingWindowsByWorker[inv.senderId] || 0) + windows;
      pendingHoursByWorker[inv.senderId] = (pendingHoursByWorker[inv.senderId] || 0) + hours;
    }
    if (!isEraInvoiceSettled(inv)) continue;
    centsByWorker[inv.senderId] = (centsByWorker[inv.senderId] || 0) + eraInvoiceGrossCents(inv);
    windowsByWorker[inv.senderId] = (windowsByWorker[inv.senderId] || 0) + windows;
    hoursByWorker[inv.senderId] = (hoursByWorker[inv.senderId] || 0) + hours;
    const list = eraNumbersByWorker[inv.senderId] || (eraNumbersByWorker[inv.senderId] = []);
    for (const n of inv.eraNumbers || []) if (!list.includes(n)) list.push(n);
  }
  for (const list of Object.values(eraNumbersByWorker)) list.sort((a, b) => a - b);
  return {
    centsByWorker, windowsByWorker, eraNumbersByWorker,
    pendingCentsByWorker, pendingWindowsByWorker, hoursByWorker, pendingHoursByWorker,
  };
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
  /** Sovittu korjaus siirrettävään summaan (etumerkillinen, 0 = ei korjausta). */
  payoutFixCents: number;
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
  /**
   * paid + eraSent PUNAISISTA. Tämä luku on osa kohdennuslaskentaa (se kuittaa
   * punaista velkaa), joten siihen EI saa lisätä keltaisten tai tuntien maksuja
   * — muuten tuntimaksu kuittaisi ikkunavelkaa.
   */
  settledCents: number;
  /**
   * KAIKKI mitä tekijälle on hoidettu, kaikista kolmesta virrasta yhteensä.
   * Pelkkä näyttöluku: "hoidettu" näytti ennen vain punaisten osuuden, joten
   * tuntikeikalla se luki 0 € vaikka tekijälle oli maksettu satoja euroja.
   */
  settledTotalCents: number;
  /** PUNAISISTA vielä siirtämättä. Tämä on se summa jonka perustaja maksaa
   *  erämaksulla. */
  openP1Cents: number;
  /** KELTAISISTA vielä siirtämättä — odottaa P2-laskun rahoja, ei mene punaisten
   *  erämaksuun. */
  openP2Cents: number;
  /** Ikkunamäärä joka on vielä maksamatta punaisista — erämaksun esitäyttö. */
  openP1Windows: number;
  /**
   * KELTAISIA vielä maksamatta, kappaleina — keltaisten maksun esitäyttö.
   *
   * Ilman tätä maksudialogi esitäytti keltaisten ikkunakentän tekijän KOKO
   * keikan keltaisilla (`p2Washed`) samalla kun summa tuli avoimesta velasta.
   * Rivi luki silloin "5 kpl · 11,00 €" tekijälle jolle oli jo maksettu 80 €
   * neljästä ikkunasta: laskulle tallentui viisi ikkunaa toistamiseen, ja
   * `eraSettlementByWorker`in ikkunakirjanpito kasvoi joka maksulla lisää
   * ilman että yhtään uutta ikkunaa oli pesty.
   */
  openP2Windows: number;
  /** Erät jotka tälle tekijälle on jo laskutettu (esim. [1,2,3]). */
  settledEras: number[];
  /** Keltaisista jo maksettu tai maksussa (kuittaa vain keltaista velkaa). */
  p2SettledCents: number;
  /**
   * Keltaisten LUONNOKSENA odottava summa — johtaja loi maksun, tekijä ei ole
   * vielä kuitannut sitä. Luonnos varaa velan (`openP2Cents` ei sisällä sitä),
   * joten ilman tätä lukua juuri tehty keltaisten maksu katosi näkyvistä
   * kokonaan: siirrettävä putosi nollaan ennen kuin senttiäkään oli liikkunut.
   */
  p2InvoicePendingCents: number;

  // ─── TUNTITYÖ (kolmas rahavirta) ──────────────────────────────────────────
  //
  // Tuntikeikalla tekijän palkka ei tule ikkunoista lainkaan, joten ilman näitä
  // kenttiä koko keikan maksettava näytti nollaa: ikkunoita ei ollut, ja
  // tunneille ei ollut kenttää mihin ne olisi laskettu.
  /** Tekijän tunnit tällä keikalla (`ProjShift`-riveistä, rajattu ≥ 0). */
  hours: number;
  /** Tekijän tuntipalkka sentteinä (perustajalla asiakashinta, ks. hourly-money). */
  hourRateCents: number;
  /** Tunneista kertynyt palkka BRUTTONA = tunnit × tuntipalkka. */
  hoursEarnedCents: number;
  /** Tunneista jo maksettu tai maksussa (tuntipotin erälaskut). */
  hoursSettledCents: number;
  /** Tunneista luonnoksena odottava — johtaja loi maksun, tekijä ei kuitannut. */
  hoursPendingCents: number;
  /**
   * KAIKKI kuittausta odottava: punaisten, keltaisten ja tuntien luonnokset.
   * Luonnos varaa velan, joten se katoaa `openTotalCents`ista — ilman tätä
   * lukua juuri tehty maksu häviäisi näkymästä kokonaan ennen kuin tekijä on
   * ehtinyt hyväksyä sen.
   */
  pendingTotalCents: number;
  /** Tunneista VIELÄ siirtämättä. Tämä on se summa jonka johtaja maksaa. */
  openHoursCents: number;
  /** Maksamattomat tunnit — maksudialogin esitäyttö. */
  openHours: number;
  /**
   * KAIKKI mitä tälle tekijälle on vielä siirrettävä: punaiset + keltaiset +
   * tunnit. Yksi luku johtajalle, joka ei halua laskea kolmea yhteen päässään.
   */
  openTotalCents: number;
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
    /** TUNTITYÖN maksuista johdetut summat (`eraSettlementByWorker(inv, "hours")`). */
    hoursEra?: Partial<EraSettlementMaps>;
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
  const hoursEra = opts.hoursEra ?? {};
  /**
   * TUNNIT LUETAAN VUOROISTA, EI KARTALTA.
   *
   * `crewMemberStats().hours` on vanha, käsin kirjattu `project.hours`-kenttä.
   * Nykyinen tuntikirjanpito on `project.shifts` (ajastin + käsinsyöttö), ja
   * juuri sen takia tuntityö ei näkynyt maksuissa lainkaan: raha laskettiin
   * kentästä johon mikään nykyinen näkymä ei enää kirjoita.
   *
   * VAIN TUNTITILASSA (`billingMode: "hourly"`). Kohdennetulla keikalla tekijä
   * saa palkkansa IKKUNOISTA ja vuororivit ovat seurantatietoa (ikkunaa/tunti,
   * tehokkuus). Jos ne muutettaisiin siellä rahaksi, sama työ maksettaisiin
   * kahdesti — kerran ikkunoina ja kerran tunteina. Tuntipalkan voi silti aina
   * kirjata käsin maksudialogin "Tunnit"-välilehdeltä, jos niin on sovittu.
   *
   * TUNTIKEIKALLA IKKUNAPALKKA JÄÄ VOIMAAN, ja se on tarkoitus eikä tuplaus:
   * ikkunatyö on tuntikeikallakin oma veloituksensa tuntien rinnalla
   * (`computeWindowMoney` laskuttaa laskuttamattomat ikkunat asiakkaalta ja
   * maksaa pesijälle hänen ikkunataksansa). Ikkunat pestään usein ennen
   * tuntitilaan siirtymistä, eikä sama työ ole molemmissa.
   */
  const hourly = isHourlyGig(project);
  const shiftStats = hourly
    ? computeShiftStats((project.shifts ?? []) as ProjShift[])
    : { byWorker: [] as { id: string; hours: number }[] };
  const hoursById = new Map(shiftStats.byWorker.map((r) => [r.id, r.hours]));
  const workerHourCents = effectiveWorkerHourRateOf(project);
  const founderHourCents = hourRateOf(project);
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
      payoutFixCents: member.payoutFixCents ?? 0,
      p2Enabled: !!project.p2?.enabled,
      era: { eraSent, eraWindows, eraNums, eraPending, eraPendingWindows },
      p2Settled: {
        sentCents: p2Era.centsByWorker?.[member.id] || 0,
        pendingCents: p2Era.pendingCentsByWorker?.[member.id] || 0,
        windows: (p2Era.windowsByWorker?.[member.id] || 0) + (p2Era.pendingWindowsByWorker?.[member.id] || 0),
      },
      hours: hoursById.get(member.id) ?? 0,
      // Perustajan tunti on omaa työtä eikä siitä oteta katetta: hän ansaitsee
      // koko asiakastuntihinnan (sama sääntö kuin `computeHourlyMoney`issa).
      hourRateCents: founder || isFounder(member.id) ? founderHourCents : workerHourCents,
      hoursSettled: {
        sentCents: hoursEra.centsByWorker?.[member.id] || 0,
        pendingCents: hoursEra.pendingCentsByWorker?.[member.id] || 0,
        hours: (hoursEra.hoursByWorker?.[member.id] || 0) + (hoursEra.pendingHoursByWorker?.[member.id] || 0),
      },
    }));
  }

  return rows.sort((a, b) => b.openTotalCents - a.openTotalCents || b.p1EarnedCents - a.p1EarnedCents);
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
  /** Keltaisista jo maksettu / maksussa oleva — kuittaa VAIN keltaista velkaa.
   *  `windows` = jo laskutetut keltaiset kappaleina (esitäytön yläraja). */
  p2Settled?: { sentCents: number; pendingCents: number; windows?: number };
  /** Sovittu muutos punaisten palkkaan (CrewMember.payAdjustmentCents). */
  adjustmentCents?: number;
  /** Sovittu korjaus SIIRRETTÄVÄÄN summaan (etumerkillinen). Ks. `payoutFixCents`. */
  payoutFixCents?: number;
  /** Tekijän tunnit tällä keikalla (`computeShiftStats`). Puuttuva = 0. */
  hours?: number;
  /** Tekijän tuntipalkka sentteinä. Puuttuva = 0 → tuntityötä ei ole. */
  hourRateCents?: number;
  /** Tuntipotista jo maksettu / maksussa — kuittaa VAIN tuntivelkaa. */
  hoursSettled?: { sentCents: number; pendingCents: number; hours?: number };
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
  // Käsin kirjatut payoutit (vanha kanava) eivät tiedä mistä rahasta on kysymys,
  // joten ne kuittaavat velkaa järjestyksessä punaiset → tunnit → keltaiset
  // (ks. ylivuodon perustelu alempana).
  const p2SettledCents = (input.p2Settled?.sentCents ?? 0) + (input.p2Settled?.pendingCents ?? 0);
  // Sovittu vähennys/lisä pienentää (tai kasvattaa) maksettavaa punaista. Brutto
  // (`p1EarnedCents`) säilyy koskemattomana, jotta ikkunat ja raha täsmäävät yhä.
  const p1AdjustmentCents = input.adjustmentCents ?? 0;
  const payoutFixCents = input.payoutFixCents ?? 0;
  const p1PayableCents = Math.max(0, stats.p1EarnedCents + p1AdjustmentCents);
  const reservedCents = settledCents + eraPendingCents;
  const p1Covered = Math.min(p1PayableCents, reservedCents);
  // Ylivuoto lasketaan BRUTOSTA, ei vähennetystä summasta. Muuten sovittu
  // vähennys olisi syönyt seuraavaa pottia: jos punaiset oli jo laskutettu
  // täytenä (100 €) ja johtaja kirjasi jälkikäteen 10 € vähennyksen, erotus olisi
  // valunut "ylivuotona" eteenpäin ja pienentänyt sitä 10 € — vaikka vähennys
  // sovittiin punaisista. Aitoon ylimaksuun (yli bruton) sääntö pätee edelleen.
  // Ylivuodon KOHDE ratkaistaan alempana, tuntien laskennan jälkeen.
  /**
   * Kuinka paljon punainen potti IMEE ennen kuin ylivuoto jatkaa eteenpäin.
   *
   * Bruttosuoja koskee VAIN kohdennettuja punaisia laskuja: jos punaiset on jo
   * laskutettu täytenä ja vähennys kirjattiin jälkikäteen, erotus ei saa valua
   * seuraavaan pottiin (se sovittiin punaisista). Käsin kirjattu maksu on eri
   * asia — se on tuoretta rahaa, ja kaikki maksettavan ylittävä kuuluu
   * seuraavalle potille. Aiemmin suoja laskettiin aina brutosta, jolloin
   * maksuehdotuksen (punaiset + tunnit) maksaminen jätti tuntivelkaa auki
   * juuri vähennyksen verran — ja sama tuntityö tuli maksettavaksi uudelleen.
   */
  const eraReservedCents = eraSentCents + eraPendingCents;
  const p1AbsorbedCents = Math.max(p1PayableCents, Math.min(stats.p1EarnedCents, eraReservedCents));
  const p1Overflow = Math.max(0, reservedCents - p1AbsorbedCents);
  const openP1Cents = Math.max(0, p1PayableCents - p1Covered);

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

  // ── TUNTITYÖ ────────────────────────────────────────────────────────────────
  // Oma potti, omat kuittaukset. Tuntimaksu ei kuittaa ikkunavelkaa eikä
  // toisinpäin — muuten yhden keikan ikkunapalkka katoaisi sillä että samalta
  // keikalta maksettiin tunnit, ja tekijä jäisi ilman rahaa jonka hän ansaitsi.
  const hours = Math.max(0, input.hours ?? 0);
  const hourRateCents = Math.max(0, Math.round(input.hourRateCents ?? 0));
  const hoursEarnedCents = Math.round(hours * hourRateCents);
  const hoursSentCents = input.hoursSettled?.sentCents ?? 0;
  const hoursPendingCents = input.hoursSettled?.pendingCents ?? 0;
  const hoursSettledCents = hoursSentCents + hoursPendingCents;
  /**
   * Punaisten ylivuoto kuittaa tuntivelkaa ENNEN keltaisia: tunnit ovat
   * maksettavaa nyt, keltaiset vasta asiakkaan maksun jälkeen.
   *
   * Ylivuotoa syntyy VAIN kohdentamattomasta rahasta (käsin kirjattu payout).
   * Tuntipotin oma lasku on nimenomaisesti merkitty tunneiksi, joten se ei saa
   * valua mihinkään muualle: sovittu 150 €:n tuntimaksu keikalla jolla ei ole
   * tuntikertymää söi muuten tekijän keltaista velkaa, vaikka asiakas ei ollut
   * maksanut keltaisista senttiäkään.
   */
  const hoursNeedCents = Math.max(0, hoursEarnedCents - hoursSettledCents);
  const hoursFromOverflow = Math.min(hoursNeedCents, p1Overflow);
  const openHoursCents = hoursNeedCents - hoursFromOverflow;
  // Sama sääntö kuin ikkunoilla: ota PIENEMPI kahdesta lähteestä, ettei kumpikaan
  // yksin nosta esitäyttöä. Rahasta johdettu tuntimäärä on lopullinen totuus.
  const hoursFromLedger = Math.max(0, hours - (input.hoursSettled?.hours ?? 0));
  // Ylivuoto ei kirjaa tunteja, joten ikkunoiden sääntö pätee tässäkin: raha on
  // lopullinen totuus ja kirjanpito vain yläraja.
  const hoursFromMoney = hourRateCents > 0 ? openHoursCents / hourRateCents : 0;
  // ALASPÄIN, EI LÄHIMPÄÄN. Esitäyttö kerrotaan tuntipalkalla, joten ylöspäin
  // pyöristetty tuntimäärä tekisi laskun joka ylittää avoimen summan (130,00 €
  // → 8,7 h × 15,00 € = 130,50 €) ja laukaisisi näkymän oman ylilaskutus-
  // varoituksen koskemattomilla oletuksilla. Täysillä tunneilla — mikä on
  // normaali tapaus, koska vuorot pyöristetään täyteen tuntiin — luku on tarkka.
  const openHours = openHoursCents <= 0 ? 0 : floor1(Math.min(hoursFromLedger, hoursFromMoney));

  /**
   * YLIVUODON JÄRJESTYS: PUNAISET → TUNNIT → KELTAISET.
   *
   * Käsin kirjattu payout (vanha kanava) ei tiedä mistä rahasta on kysymys,
   * joten se kuittaa velkaa järjestyksessä. Järjestys ei ole mielivaltainen:
   * punaiset ja tunnit ovat maksettavaa NYT, keltaiset vasta sen jälkeen kun
   * asiakas on maksanut keltaisten laskun.
   *
   * Aiemmin ylivuoto meni punaisista suoraan keltaisiin. Tuntikeikalla se
   * tarkoitti kahta virhettä yhdellä maksulla: keltainen velka kuittautui
   * ennen kuin asiakas oli maksanut siitä senttiäkään, ja tuntivelka jäi
   * silti auki — eli sama työ tuli maksettavaksi toisen kerran.
   */
  const hoursOverflow = p1Overflow - hoursFromOverflow;
  const p2Covered = Math.min(stats.p2EarnedCents, p2SettledCents + hoursOverflow);
  const openP2Cents = Math.max(0, stats.p2EarnedCents - p2Covered);

  const p2InvoicePendingCents = input.p2Settled?.pendingCents ?? 0;

  /**
   * MAKSAMATTOMAT KELTAISET KAPPALEINA — sama kahden lähteen sääntö kuin
   * punaisilla: ota PIENEMPI kirjanpidosta ja rahasta johdetusta määrästä,
   * ettei kumpikaan yksin nosta esitäyttöä. Keltaisen palkkio tulee
   * palkkiotaulukosta eikä kiinteästä taksasta, joten "€ per keltainen" on
   * tämän tekijän oma keskiarvo (ansaittu ÷ pesty) — juuri se luku jolla
   * avoin summa muuttuu takaisin kappaleiksi.
   */
  const p2InvoicedWindows = input.p2Settled?.windows ?? 0;
  // VAIN ASIAKKAAN HYVÄKSYMÄT KELTAISET. `p2Washed` sisältää myös ne joiden
  // hintaa asiakas ei ole vielä lukinnut (`p2PendingWashed`) — ne ovat
  // `p2PendingCents`iä, eivät `p2EarnedCents`iä, joten `openP2Cents` ei tunne
  // niitä lainkaan. Ilman tätä erotusta kappaleet ja euro laskettiin eri
  // joukosta: 4 lukittua + 4 hyväksymätöntä näytti "8 kpl · 80,00 €", ja kun
  // loput sitten lukittuivat, sama rivi näytti "0 kpl · 80,00 €".
  const approvedP2Washed = Math.max(0, stats.p2Washed - (stats.p2PendingWashed ?? 0));
  /**
   * KIRJANPITO RATKAISEE, EI RAHASTA JOHDETTU KESKIARVO.
   *
   * Punaisilla otetaan pienempi kahdesta lähteestä, koska siellä kappalemäärä
   * KERROTAAN taksalla eli se määrää laskun summan. Keltaisilla summa tulee
   * suoraan avoimesta velasta (`ansaittuOverrideCents`), joten kappalemäärä on
   * pelkkä selite — ja keltaisten hinta neuvotellaan ikkuna kerrallaan, joten
   * "ansaittu ÷ pesty" on hinta jota kukaan ei ole sopinut (ks. shared/p2.ts).
   * Sillä jaettu kappalemäärä valehteli aina kun hinnat vaihtelivat: 100 € ja
   * 10 € keltainen, kalliimpi maksettu → jäljellä 1 ikkuna, keskiarvo väitti
   * 0,2. Kirjanpito tietää tarkan määrän, ja koska maksu kirjaa saman luvun
   * takaisin, se pysyy täsmällisenä.
   */
  const openP2Windows = openP2Cents <= 0 ? 0 : round1(Math.max(0, approvedP2Washed - p2InvoicedWindows));

  return {
    p2InvoicePendingCents,
    pendingTotalCents: eraPendingCents + hoursPendingCents + p2InvoicePendingCents,
    // "Hoidettu" tarkoittaa oikeasti maksussa olevaa rahaa, ei luonnoksia:
    // luonnos odottaa yhä tekijän hyväksyntää (`eraPendingCents` kertoo sen
    // erikseen). Siksi tässä luetaan vain lähetetyt/hyväksytyt summat.
    settledTotalCents: settledCents + (input.p2Settled?.sentCents ?? 0) + hoursSentCents,
    hours,
    hourRateCents,
    hoursEarnedCents,
    hoursSettledCents,
    hoursPendingCents,
    openHoursCents,
    openHours,
    payoutFixCents,
    /**
     * SIIRRETTÄVÄ SUMMA KORJAUKSEN JÄLKEEN.
     *
     * Korjaus osuu summaan eikä yksittäiseen virtaan, koska ero voi olla missä
     * tahansa niistä — ja koska punaisten korjaus ei liikuta summaa lainkaan
     * silloin kun punaiset on jo katettu maksetulla rahalla. Ei mene
     * miinukselle: negatiivinen siirrettävä ei ole velkaa toiseen suuntaan.
     */
    openTotalCents: Math.max(0, openP1Cents + openP2Cents + openHoursCents + payoutFixCents),
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
    openP2Windows,
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
export function eraMapsFor(invoices: EraInvoiceLike[], scope: EraScope = "p1") {
  const m = eraSettlementByWorker(invoices, scope);
  return {
    eraSent: m.centsByWorker,
    eraWindows: m.windowsByWorker,
    eraNums: m.eraNumbersByWorker,
    eraPending: m.pendingCentsByWorker,
    eraPendingWindows: m.pendingWindowsByWorker,
    eraHours: m.hoursByWorker,
    eraPendingHours: m.pendingHoursByWorker,
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
  settledTotalCents: number;
  eraPendingCents: number;
  /** Kaikki kuittausta odottava (punaiset + keltaiset + tunnit). */
  pendingTotalCents: number;
  openP1Cents: number;
  openP2Cents: number;
  openP1Windows: number;
  openP2Windows: number;
  hours: number;
  hoursEarnedCents: number;
  hoursSettledCents: number;
  openHoursCents: number;
  openHours: number;
  /** Punaiset + keltaiset + tunnit — yksi luku "paljonko pitää siirtää". */
  openTotalCents: number;
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
    settledTotalCents: t.settledTotalCents + r.settledTotalCents,
    eraPendingCents: t.eraPendingCents + r.eraPendingCents,
    pendingTotalCents: t.pendingTotalCents + r.pendingTotalCents,
    openP1Cents: t.openP1Cents + r.openP1Cents,
    openP2Cents: t.openP2Cents + r.openP2Cents,
    openP1Windows: round1(t.openP1Windows + r.openP1Windows),
    openP2Windows: round1(t.openP2Windows + r.openP2Windows),
    hours: round1(t.hours + r.hours),
    hoursEarnedCents: t.hoursEarnedCents + r.hoursEarnedCents,
    hoursSettledCents: t.hoursSettledCents + r.hoursSettledCents,
    openHoursCents: t.openHoursCents + r.openHoursCents,
    openHours: round1(t.openHours + r.openHours),
    openTotalCents: t.openTotalCents + r.openTotalCents,
  }), {
    workers: 0, p1Washed: 0, p2Washed: 0, p1EarnedCents: 0, p1AdjustmentCents: 0, p2EarnedCents: 0,
    p2PendingCents: 0, settledCents: 0, settledTotalCents: 0, eraPendingCents: 0, pendingTotalCents: 0, openP1Cents: 0,
    openP2Cents: 0, openP1Windows: 0, openP2Windows: 0,
    hours: 0, hoursEarnedCents: 0, hoursSettledCents: 0, openHoursCents: 0, openHours: 0, openTotalCents: 0,
  });
}

/** Jaettuja ikkunoita on 0,5 — pidä yksi desimaali eikä liukulukuroskaa. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Yksi desimaali ALASPÄIN. Käytetään esitäytöissä jotka kerrotaan hinnalla:
 *  pyöristys ylöspäin tekisi laskun joka ylittää avoimen velan. */
function floor1(n: number): number {
  return Math.floor(n * 10) / 10;
}

// ─── P2-laskutuksen tila (asiakkaalta) ────────────────────────────────────────

export interface PaymentLike {
  amountCents: number;
  scope?: "p1" | "p2" | "hours" | "all";
  /** Yhdistetyn laskun jako: sama maksu kuittaa kahta eri kertymää. */
  parts?: { hours?: number; p2?: number };
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
  /**
   * YHDISTETTY LASKU kuittaa kahta kertymää yhdellä summalla, joten sen osuus
   * luetaan `parts`ista eikä `amountCents`ista. Ilman tätä yksi 952 €:n lasku
   * olisi joko kokonaan tuntia tai kokonaan lisätyötä — ja toinen kertymä
   * jäisi näyttämään laskuttamatonta rahaa jonka asiakas on jo maksanut.
   */
  const allPayments = live.filter((p) => p.scope === "all");
  const partSum = (key: "hours" | "p2") =>
    allPayments.reduce((s2, p) => s2 + Math.max(0, Math.round(p.parts?.[key] ?? 0)), 0);
  const invoicedCents = p2Payments.reduce((s, p) => s + p.amountCents, 0) + partSum("p2");
  const p1InvoicedCents = p1Payments.reduce((s, p) => s + p.amountCents, 0);
  return {
    invoicedCents,
    remainingCents: Math.max(0, earnedCents - invoicedCents),
    payments: p2Payments.length,
    /** P1-puoli samasta suodatuksesta, jotta kutsujien ei tarvitse toistaa sitä. */
    p1InvoicedCents,
    p1Payments: p1Payments.length,
    /** Tuntikeikan oma virta — ei P1:n eriä eikä keltaisten kertymää. */
    hoursInvoicedCents: live.filter((p) => p.scope === "hours").reduce((s2, p) => s2 + p.amountCents, 0) + partSum("hours"),
    hoursPayments: live.filter((p) => p.scope === "hours").length + allPayments.filter((p) => (p.parts?.hours ?? 0) > 0).length,
    /** Yhdistettyjen laskujen määrä — oma numerosarjansa. */
    allPayments: allPayments.length,
  };
}

/** Punaisten ikkunoiden kertymä eräkohtaisesti kuvattuna yhtenä rivinä
 *  ("2/4 erää lähetetty · 3 150,00 €") — käytetään useassa näkymässä. */
export function eraProgressLabel(p1PaymentCount: number, p1InvoicedCents: number): string {
  const eur = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  return `${Math.min(4, p1PaymentCount)}/4 erää · ${eur(p1InvoicedCents)}`;
}
