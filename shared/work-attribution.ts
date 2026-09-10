/**
 * FR8 — KENEN TYÖTÄ TÄMÄ ON, JA VOIKO SEN MAKSAA.
 *
 * MIKSI TÄMÄ MODUULI ON OLEMASSA
 *
 * Maksulista (`computeWorkerSettlements`) näyttää vain ne tekijät joille voi
 * tehdä laskun: ei perustajia, ei harjoittelijoita, ei poistettuja. Se on oikea
 * rajaus maksamiseen — mutta se tarkoitti että kaikki muu pesty työ katosi
 * ruudulta kokonaan. Kolme tapaa jolla raha haihtui:
 *
 *  1. **Poistettu tekijä.** Kun crew-rivi poistetaan, kartalle jää `washedBy`
 *     joka ei osu enää kehenkään. Tasaus (`founderWashCounts`) laskee sen yhä
 *     TEKIJÄKULUKSI — se pienentää johtajien katetta — mutta maksulistalla
 *     riviä ei ole, joten kukaan ei koskaan saa rahaa eikä kukaan näe että se
 *     puuttuu. Raha katosi kahteen suuntaan yhtä aikaa.
 *  2. **Harjoittelija (Milja).** Hän ei laskuta meitä; hänen palkkansa tilittää
 *     vastuujohtaja. Se on oikein — mutta ilman tätä moduulia hänen tekemänsä
 *     työ ei näkynyt missään summassa, joten vastuujohtaja ei nähnyt mitä hän
 *     on velkaa hänelle.
 *  3. **Nimeämätön puolikas.** Ikkunan voi jakaa 50/50, ja toinen puolisko voi
 *     kuulua jollekin jota ei ole järjestelmässä (`UNNAMED_WASHER_ID`) tai
 *     kenellekään (`washedBy` puuttuu). Se on tarkoituksellinen tila — "tämä
 *     selvitetään myöhemmin" — mutta sen pitää NÄKYÄ, ei kadota.
 *
 * Tämä moduuli laskee ne kolme pottia yhdellä läpikäynnillä, samoilla
 * jakosäännöillä kuin `crewMemberStats` ja `founderWashCounts`, jotta ruutu,
 * tasaus ja sähköpostiraportti eivät voi olla eri mieltä samasta ikkunasta.
 *
 * Puhdas laskenta: ei I/O:ta, ei Reactia. Sekä client että server importtaavat.
 */

import {
  allPoints, computeShiftStats, effectiveWorkerHourRateOf, isHourlyGig,
  type ProjectData, type ProjShift,
} from "./project";
import { getCrew, DEFAULT_WORKER_PER_WINDOW_CENTS, type CrewMember } from "./crew";
import { p2WorkerPayoutCents, p2PendingPriceCents, DEFAULT_P2_WORKER_SHARE_PCT } from "./p2";
import { traineeForUserId, traineeForName, type TraineeInfo } from "./trainees";
import { isFounder } from "./team";
import { UNNAMED_WASHER_ID, UNNAMED_WASHER_NAME, isUnnamedWasher, normalizedSecondWasher } from "./washers";

export {
  UNNAMED_WASHER_ID, UNNAMED_WASHER_NAME, isUnnamedWasher, normalizedSecondWasher,
} from "./washers";

/** Miksi tätä työtä ei voi maksaa tekijämaksuna. */
export type UnpayableKind =
  /** Ei pesijää lainkaan, tai nimenomaisesti nimeämätön. */
  | "unnamed"
  /** Pesijä-id jota ei ole enää crew-listalla (rivi poistettu). */
  | "removed"
  /** Harjoittelija: ei laskuta meitä, vastuujohtaja tilittää. */
  | "trainee";

export interface UnpayableBucket {
  /** Pesijä-id sellaisena kuin se on kartalla ("" kun pesijää ei ole). */
  id: string;
  /** Näytettävä nimi — crew-nimi, harjoittelijan nimi tai raaka id. */
  name: string;
  kind: UnpayableKind;
  p1Windows: number;
  p2Windows: number;
  /** Punaisista kertynyt arvo tekijän taksalla (poistetulla oletustaksa). */
  p1EarnedCents: number;
  /** Keltaisista kertynyt palkkio LUKITUISTA ikkunoista. */
  p2EarnedCents: number;
  /** Keltaiset jotka odottavat vielä asiakkaan hyväksyntää. */
  p2PendingCents: number;
  /**
   * TUNTITYÖ. Tuntikeikalla palkka ei tule ikkunoista lainkaan, joten pelkkä
   * ikkuna-auditointi olisi jättänyt poistetun tekijän ja harjoittelijan
   * tunnit yhtä näkymättömiksi kuin ikkunat olivat ennen tätä moduulia.
   */
  hours: number;
  hoursEarnedCents: number;
  /** Ansaittu yhteensä: p1 + p2 (ei pendingiä — se ei ole vielä ansaittua). */
  earnedCents: number;
  /** Tälle id:lle jo maksettu (erälaskut + käsin kirjatut maksut). */
  settledCents: number;
  /**
   * VIELÄ SELVITTÄMÄTTÄ = ansaittu − maksettu, ei koskaan alle nollan.
   *
   * Tämä on se luku joka näytetään. Ilman maksettujen vähennystä poistettu
   * tekijä, joka oli maksettu kokonaan ENNEN poistoa, olisi näyttänyt koko
   * elinkaarensa ansiot "kadonneena rahana" — varoitus jota ei voi kuitata
   * millään on varoitus jonka lukija oppii ohittamaan.
   */
  totalCents: number;
  /** Harjoittelijalla: kuka johtaja tilittää tämän. */
  responsibleLeaderId?: string;
  responsibleLeaderName?: string;
}

export interface AttributionAudit {
  buckets: UnpayableBucket[];
  /** Nimeämätön/pesijätön työ yhteensä. */
  unnamedCents: number;
  unnamedWindows: number;
  /** Poistettujen tekijöiden työ yhteensä — tämä on se raha joka "katosi". */
  removedCents: number;
  removedWindows: number;
  /** Harjoittelijoiden työ yhteensä (vastuujohtajan tilitettävä). */
  traineeCents: number;
  traineeWindows: number;
  /** Kaikki työ jota ei voi maksaa tekijämaksuna. */
  totalCents: number;
  /** Onko mitään näytettävää? */
  any: boolean;
}

interface Accum {
  id: string;
  name: string;
  kind: UnpayableKind;
  p1Windows: number;
  p2Windows: number;
  p1EarnedCents: number;
  p2EarnedCents: number;
  p2PendingCents: number;
  hours: number;
  hoursEarnedCents: number;
  trainee?: TraineeInfo;
}

/** Jaettuja ikkunoita on 0,5 — pidä yksi desimaali eikä liukulukuroskaa. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Onko tämä crew-rivi harjoittelija? Sama tunnistusjärjestys kuin muualla. */
function traineeOf(member: Pick<CrewMember, "id" | "name" | "linkedUserId">): TraineeInfo | undefined {
  return traineeForUserId(member.linkedUserId) || traineeForUserId(member.id) || traineeForName(member.name);
}

export interface AttributionAuditOptions {
  /**
   * Jo hoidettu raha id:ttäin (erälaskut kaikista virroista). Poistetulla
   * tekijällä voi olla laskuja vaikka crew-riviä ei enää ole, ja ne ovat
   * maksettua rahaa — ei selvitettävää.
   */
  settledCentsById?: Record<string, number>;
}

/**
 * Kaikki pesty työ jota EI voi maksaa tekijämaksuna, eriteltynä syyn mukaan.
 *
 * Samat jakosäännöt kuin maksulaskennassa: jaettu ikkuna on 0,5 + 0,5, keltaisen
 * palkkio tulee palkkiotaulukosta ja lukitsematon keltainen on "odottaa
 * asiakasta" eikä ansaittua rahaa. Perustajien oma työ EI ole tässä — se ei ole
 * kadonnutta rahaa vaan katetta, ja tasaus käsittelee sen omalla puolellaan.
 */
export function buildAttributionAudit(
  project: ProjectData | null | undefined,
  opts: AttributionAuditOptions = {},
): AttributionAudit {
  const empty: AttributionAudit = {
    buckets: [], unnamedCents: 0, unnamedWindows: 0, removedCents: 0, removedWindows: 0,
    traineeCents: 0, traineeWindows: 0, totalCents: 0, any: false,
  };
  if (!project) return empty;

  const crew = getCrew(project);
  const byId = new Map(crew.map((c) => [c.id, c]));
  const p2 = project.p2?.enabled ? project.p2 : undefined;
  const sharePct = p2?.workerSharePct || DEFAULT_P2_WORKER_SHARE_PCT;
  const schedule = p2?.payoutSchedule;
  const by2 = project.washedBy2 || {};
  const acc = new Map<string, Accum>();

  const bucketFor = (id: string): Accum | null => {
    const trimmed = (id || "").trim();
    // Pesijätön tai nimenomaisesti nimeämätön → yksi yhteinen potti.
    if (!trimmed || isUnnamedWasher(trimmed)) {
      return upsert(acc, UNNAMED_WASHER_ID, UNNAMED_WASHER_NAME, "unnamed");
    }
    // PERUSTAJA TUNNISTETAAN MYÖS ILMAN CREW-RIVIÄ. Ilman tätä johtajan oma
    // ikkuna keikalla jolle häntä ei ole lisätty tekijäksi olisi näkynyt
    // "kadonneena rahana" hänen omalla nimellään — varoitus joka syyttää
    // väärää asiaa on pahempi kuin ei varoitusta.
    if (isFounder(trimmed)) return null;
    const member = byId.get(trimmed);
    if (!member) {
      // Ei crew-riviä. Jos id silti tunnistetaan harjoittelijaksi, se on
      // harjoittelijaraha eikä "kadonnut" — vastuujohtaja tilittää sen.
      const t = traineeForUserId(trimmed) || traineeForName(trimmed);
      if (t) {
        const b = upsert(acc, trimmed, t.name, "trainee");
        b.trainee = t;
        return b;
      }
      return upsert(acc, trimmed, trimmed, "removed");
    }
    // PERUSTAJA EI OLE TÄSSÄ: hänen työnsä on katetta, ei maksettavaa velkaa.
    if (member.role === "host") return null;
    const t = traineeOf(member);
    if (t) {
      const b = upsert(acc, member.id, member.name || t.name, "trainee");
      b.trainee = t;
      return b;
    }
    // Aktiivinen, maksettava tekijä — kuuluu normaalille maksulistalle.
    if (member.active !== false) return null;
    // Deaktivoitu rivi: maksulista jättää hänet pois, joten hänen avoin työnsä
    // olisi muuten yhtä näkymätöntä kuin poistetun. Sama potti, sama varoitus.
    return upsert(acc, member.id, member.name || member.id, "removed");
  };

  const rateOf = (id: string): number => byId.get(id)?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS;

  for (const pt of allPoints(project)) {
    if (pt.status !== "pesty") continue;
    const primary = (pt.washedBy || "").trim();
    const second = normalizedSecondWasher(primary, by2[pt.key]);
    const primaryShare = second ? 0.5 : 1;
    // Molemmat päät käydään läpi samalla säännöllä: pesijätön pää on oma
    // osuutensa, ei koko ikkuna eikä nolla.
    const legs: { id: string; share: number }[] = [{ id: primary, share: primaryShare }];
    if (second) legs.push({ id: second, share: 0.5 });

    for (const leg of legs) {
      const bucket = bucketFor(leg.id);
      if (!bucket) continue;
      if (pt.p === 2) {
        bucket.p2Windows += leg.share;
        if (p2) {
          const offer = p2.offers[pt.key];
          if (offer?.status === "locked" && offer.lockedCents) {
            bucket.p2EarnedCents += leg.share * p2WorkerPayoutCents(offer.lockedCents, sharePct, schedule);
          } else {
            const pending = p2PendingPriceCents(offer);
            if (pending != null) {
              bucket.p2PendingCents += leg.share * p2WorkerPayoutCents(pending, sharePct, schedule);
            }
          }
        } else {
          // Ilman P2-sopimusta keltainen maksetaan normaalitaksalla (legacy) —
          // sama sääntö kuin `crewMemberStats`issä, joten summat täsmäävät.
          bucket.p1EarnedCents += leg.share * rateOf(leg.id);
        }
      } else {
        bucket.p1Windows += leg.share;
        bucket.p1EarnedCents += leg.share * rateOf(leg.id);
      }
    }
  }

  /**
   * TUNNIT — vain tuntitilassa, sama rajaus kuin `computeWorkerSettlements`issä.
   * Kohdennetulla keikalla vuororivit ovat seurantatietoa eivätkä rahaa, joten
   * niiden lukeminen tässä maksaisi saman työn kahdesti.
   */
  if (isHourlyGig(project)) {
    const workerHourCents = effectiveWorkerHourRateOf(project);
    for (const row of computeShiftStats((project.shifts ?? []) as ProjShift[]).byWorker) {
      const hours = Math.max(0, row.hours);
      if (hours <= 0) continue;
      const bucket = bucketFor(row.id);
      if (!bucket) continue;
      bucket.hours += hours;
      bucket.hoursEarnedCents += hours * workerHourCents;
    }
  }

  const settledById = opts.settledCentsById ?? {};
  /** Käsin kirjatut, maksetut payoutit crew-riviltä (jos rivi on yhä olemassa). */
  const paidOnCrewRow = (id: string): number =>
    (byId.get(id)?.payouts ?? [])
      .filter((p) => p.status === "maksettu")
      .reduce((sum, p) => sum + (p.amountCents || 0), 0);

  const buckets: UnpayableBucket[] = Array.from(acc.values())
    .map((b) => {
      const p1EarnedCents = Math.round(b.p1EarnedCents);
      const p2EarnedCents = Math.round(b.p2EarnedCents);
      const hoursEarnedCents = Math.round(b.hoursEarnedCents);
      const earnedCents = p1EarnedCents + p2EarnedCents + hoursEarnedCents;
      // Nimeämättömälle ei voi olla maksuja: hänellä ei ole laskua eikä
      // crew-riviä. Muilla vähennetään kaikki mitä on jo hoidettu.
      const settledCents = b.kind === "unnamed"
        ? 0
        : (settledById[b.id] || 0) + paidOnCrewRow(b.id);
      return {
        id: b.id,
        name: b.name,
        kind: b.kind,
        p1Windows: round1(b.p1Windows),
        p2Windows: round1(b.p2Windows),
        p1EarnedCents,
        p2EarnedCents,
        p2PendingCents: Math.round(b.p2PendingCents),
        hours: round1(b.hours),
        hoursEarnedCents,
        earnedCents,
        settledCents,
        totalCents: Math.max(0, earnedCents - settledCents),
        ...(b.trainee
          ? { responsibleLeaderId: b.trainee.responsibleLeaderId, responsibleLeaderName: b.trainee.responsibleLeaderName }
          : {}),
      };
    })
    // Selvitetyt ja tyhjät rivit pois: maksettu tekijä ei ole varoitus, ja
    // nollan euron rivi on pelkkää kohinaa. Ikkunamäärä yksin ei riitä
    // syyksi näyttää riviä — muuten kokonaan maksettu poistettu tekijä jäisi
    // roikkumaan listalle ikuisesti.
    .filter((b) => b.totalCents > 0 || b.p2PendingCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "fi"));

  const sum = (kind: UnpayableKind, key: "totalCents" | "windows") =>
    buckets.filter((b) => b.kind === kind).reduce(
      (s, b) => s + (key === "totalCents" ? b.totalCents : b.p1Windows + b.p2Windows), 0);

  const unnamedCents = sum("unnamed", "totalCents");
  const removedCents = sum("removed", "totalCents");
  const traineeCents = sum("trainee", "totalCents");

  return {
    buckets,
    unnamedCents,
    unnamedWindows: round1(sum("unnamed", "windows")),
    removedCents,
    removedWindows: round1(sum("removed", "windows")),
    traineeCents,
    traineeWindows: round1(sum("trainee", "windows")),
    totalCents: unnamedCents + removedCents + traineeCents,
    any: buckets.length > 0,
  };
}

function upsert(acc: Map<string, Accum>, id: string, name: string, kind: UnpayableKind): Accum {
  const existing = acc.get(id);
  if (existing) return existing;
  const fresh: Accum = {
    id, name, kind,
    p1Windows: 0, p2Windows: 0, p1EarnedCents: 0, p2EarnedCents: 0, p2PendingCents: 0,
    hours: 0, hoursEarnedCents: 0,
  };
  acc.set(id, fresh);
  return fresh;
}
