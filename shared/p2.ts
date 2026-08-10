/**
 * Priority 2 (keltaiset ikkunat) — per-window pricing + customer negotiation.
 *
 * The FR8 Priority 1 deal is a signed FLAT TOTAL (€6300, shared/project.ts) and
 * stays untouched. Priority 2 works the opposite way: each yellow window gets its
 * OWN price, negotiated per window with the customer on the public live view:
 *
 *   admin proposes a price  →  customer accepts (→ LOCKED)
 *                           →  or counters      →  admin accepts (→ LOCKED)
 *                                               →  or re-proposes …
 *
 * Only a LOCKED yellow window is part of the work scope (washable, billable).
 * The customer-visible P2 total is simply Σ locked prices — it grows as prices
 * are locked, unlike the fixed P1 cap. Worker pay for a locked yellow window is
 * a percentage share of ITS locked price (cheaper window → smaller payout).
 *
 * All state lives in ProjectData.p2 (jobs.project_data JSON) keyed by the same
 * window keys as statuses/washedBy, so it travels with the map. Every transition
 * is version-checked (optimistic concurrency) and appended to an audit log —
 * the accepted prices + the log ARE the P2 agreement (kevyt sopimus).
 */

import type { ProjectData } from "./project";
import { allPoints } from "./project";

// ─── Constants ─────────────────────────────────────────────────────────────────

export const MAX_P2_PRICE_CENTS = 100_000;        // 1000 € / ikkuna hard cap
export const DEFAULT_P2_WORKER_SHARE_PCT = 53;    // ≈ existing 20 € / 37,50 € economics
export const MAX_P2_EVENTS = 500;                 // audit log cap (newest kept)
export const MAX_P2_CUSTOMER_POINTS = 300;        // cap on customer-added yellow dots
export const MAX_P2_PAYOUT_RULES = 20;            // cap on the payout-schedule size
/** Hintahuomion pituusraja — yksi rivi, ei essee. */
export const MAX_P2_NOTE_LEN = 140;

/** Quick admin price presets (cents) shown in the pricing UI — the two agreed
 *  FR8 yellow sizes (34,00 € / 37,50 €) plus a larger option. */
export const P2_PRICE_PRESETS_CENTS = [3400, 3750, 5000];

/**
 * A fixed worker payout for an EXACT locked price. The founder pays a flat euro
 * amount per window size rather than a percentage: a 34,00 € window pays the
 * worker 18,00 €, a 37,50 € window pays 20,00 €. Any locked price WITHOUT a rule
 * falls back to the percentage share (`workerSharePct`).
 */
export interface P2PayoutRule {
  priceCents: number;    // the exact locked price this rule matches
  payoutCents: number;   // what the worker is paid for that window
}

/** Default FR8 payout schedule for the three window sizes — worker keeps ≈53 %:
 *  34 € → 18 €, 37,50 € → 20 €, 50 € → 27 €. Prices not listed fall back to %. */
export const DEFAULT_P2_PAYOUT_SCHEDULE: P2PayoutRule[] = [
  { priceCents: 3400, payoutCents: 1800 },
  { priceCents: 3750, payoutCents: 2000 },
  { priceCents: 5000, payoutCents: 2700 },
];

// ─── Data shapes ───────────────────────────────────────────────────────────────

export type P2OfferStatus =
  | "proposed"    // admin ehdotti hintaa — odottaa asiakasta
  | "countered"   // asiakas teki vastatarjouksen — odottaa adminia
  | "locked"      // hinta lukittu — ikkuna kuuluu P2-työhön
  | "declined";   // asiakas hylkäsi / admin perui
// A yellow point with NO offer record = "ei hinnoiteltu" (implicit initial state).

export interface P2Offer {
  status: P2OfferStatus;
  priceCents: number;        // admin's current proposal; equals lockedCents when locked
  counterCents?: number;     // customer's open counter-offer (only while "countered")
  version: number;           // bumped on EVERY state/price transition (concurrency)
  lockedCents?: number;      // final agreed price (only when "locked")
  lockedAt?: number;         // epoch ms
  lockedBy?: "customer" | "admin";
  updatedAt: number;         // epoch ms
  /**
   * HINTAHUOMIO: lyhyt perustelu ehdotetulle hinnalle, esim. "iso ikkuna,
   * tikkaat" tai "kaksi puolta". Asiakas näkee sen samassa kohdassa kuin
   * hinnan, joten hyväksyntäpäätös ei ole pelkkä luku ilman kontekstia.
   * Kulkee tarjouksen mukana, koska se koskee HINTAA — työtä koskevat
   * huomiot ovat erikseen (ProjWindowObservation).
   */
  note?: string;
}

export type P2Action =
  | "propose"          // admin: set/change price
  | "accept"           // customer: accept proposed price → locked
  | "counter"          // customer: counter-offer
  | "accept_counter"   // admin: accept the counter → locked
  | "decline"          // customer: decline the offer
  | "cancel"           // admin: withdraw offer / drop from scope
  | "unlock"           // admin: reopen a locked (unwashed) window
  | "add_point"        // customer added a yellow point (audit only)
  | "remove_point";    // customer removed a point THEY added (audit only)

export interface P2Event {
  ts: number;
  key: string;
  action: P2Action;
  actor: "customer" | string;   // "customer" or an admin id ("joonatan")
  priceCents?: number;          // price tied to the transition
  prevPriceCents?: number;
  version: number;              // offer.version AFTER the transition (0 for add_point)
  ip?: string;                  // customer actions: filled server-side
}

/** Customer's one-time lightweight terms acceptance (nimi + aikaleima). */
export interface P2Terms {
  acceptedAt: number;
  acceptorName: string;
  ip?: string;
  userAgent?: string;
}

export interface P2State {
  enabled: boolean;             // phase switch: is the negotiation UI live for the customer
  workerSharePct: number;       // worker's share of a locked price, 1..100 (FALLBACK)
  offers: Record<string, P2Offer>;   // window key → offer
  events: P2Event[];            // newest-first, capped at MAX_P2_EVENTS
  terms?: P2Terms | null;
  /** Optional P2 contract/terms text shown to the customer in the terms dialog.
   *  The founders can paste the finished sopimus here later. */
  termsText?: string;
  /** Fixed worker payout per exact locked price (34 € → 18 €, 37,50 € → 20 €).
   *  A locked price NOT in the schedule falls back to `workerSharePct`. Absent =
   *  DEFAULT_P2_PAYOUT_SCHEDULE. Drives worker pay for every locked yellow window,
   *  so editing it re-values already-washed yellows too (pay is computed live). */
  payoutSchedule?: P2PayoutRule[];
}

export function emptyP2State(): P2State {
  return {
    enabled: false,
    workerSharePct: DEFAULT_P2_WORKER_SHARE_PCT,
    offers: {},
    events: [],
    terms: null,
  };
}

// ─── State machine ─────────────────────────────────────────────────────────────

export type P2Actor = { who: "admin"; id?: string } | { who: "customer" };

export interface P2TransitionOk { ok: true; offer: P2Offer; }
export interface P2TransitionErr { ok: false; error: string; code: 400 | 403 | 409; }
export type P2TransitionResult = P2TransitionOk | P2TransitionErr;

function err(code: 400 | 403 | 409, error: string): P2TransitionErr {
  return { ok: false, code, error };
}

function validPrice(n: unknown): n is number {
  const v = Number(n);
  return Number.isFinite(v) && Number.isInteger(v) && v > 0 && v <= MAX_P2_PRICE_CENTS;
}

/**
 * Pure state-machine step for one offer. The caller resolves the window key to a
 * live p=2 point BEFORE calling (this function never sees the map) and appends
 * the audit event + persists on success.
 *
 * Concurrency: customer/admin actions must reference the exact `version` (and,
 * for accepts, the exact price) they saw — a mismatch returns 409 so a price
 * that changed mid-flight can never be silently accepted.
 */
export function p2Transition(
  offer: P2Offer | undefined,
  action: Exclude<P2Action, "add_point" | "remove_point">,
  actor: P2Actor,
  payload: { priceCents?: number; version?: number; note?: string },
  now: number = Date.now(),
): P2TransitionResult {
  const versionMatches = offer !== undefined && Number(payload.version) === offer.version;

  switch (action) {
    case "propose": {
      if (actor.who !== "admin") return err(403, "Vain admin voi ehdottaa hintaa");
      if (offer?.status === "locked") return err(409, "Hinta on jo lukittu");
      if (!validPrice(payload.priceCents)) return err(400, "Virheellinen hinta");
      // Hintahuomio: annettu teksti korvaa vanhan, tyhjä merkkijono poistaa sen,
      // ja `undefined` säilyttää aiemman — niin hinnan voi päivittää huomiota
      // menettämättä, mutta huomion saa myös nollattua.
      const note = payload.note === undefined
        ? offer?.note
        : (String(payload.note).trim().slice(0, MAX_P2_NOTE_LEN) || undefined);
      return {
        ok: true,
        offer: {
          status: "proposed",
          priceCents: payload.priceCents!,
          counterCents: undefined,
          version: (offer?.version ?? 0) + 1,
          updatedAt: now,
          note,
        },
      };
    }
    case "accept": {
      if (actor.who !== "customer") return err(403, "Vain asiakas voi hyväksyä ehdotuksen");
      if (!offer || offer.status !== "proposed") return err(409, "Ehdotus ei ole avoinna");
      if (!versionMatches || Number(payload.priceCents) !== offer.priceCents) {
        return err(409, "Hinta ehti muuttua — päivitä näkymä");
      }
      return {
        ok: true,
        offer: {
          ...offer,
          status: "locked",
          counterCents: undefined,
          lockedCents: offer.priceCents,
          lockedAt: now,
          lockedBy: "customer",
          version: offer.version + 1,
          updatedAt: now,
        },
      };
    }
    case "counter": {
      if (actor.who !== "customer") return err(403, "Vain asiakas voi tehdä vastatarjouksen");
      if (!offer || (offer.status !== "proposed" && offer.status !== "countered")) {
        return err(409, "Ehdotus ei ole avoinna");
      }
      if (!versionMatches) return err(409, "Hinta ehti muuttua — päivitä näkymä");
      if (!validPrice(payload.priceCents)) return err(400, "Virheellinen hinta");
      return {
        ok: true,
        offer: {
          ...offer,
          status: "countered",
          counterCents: payload.priceCents!,
          version: offer.version + 1,
          updatedAt: now,
        },
      };
    }
    case "accept_counter": {
      if (actor.who !== "admin") return err(403, "Vain admin voi hyväksyä vastatarjouksen");
      if (!offer || offer.status !== "countered" || !offer.counterCents) {
        return err(409, "Avointa vastatarjousta ei ole");
      }
      if (!versionMatches || Number(payload.priceCents) !== offer.counterCents) {
        return err(409, "Vastatarjous ehti muuttua — päivitä näkymä");
      }
      return {
        ok: true,
        offer: {
          ...offer,
          status: "locked",
          priceCents: offer.counterCents,
          lockedCents: offer.counterCents,
          counterCents: undefined,
          lockedAt: now,
          lockedBy: "admin",
          version: offer.version + 1,
          updatedAt: now,
        },
      };
    }
    case "decline": {
      if (actor.who !== "customer") return err(403, "Vain asiakas voi hylätä ehdotuksen");
      if (!offer || (offer.status !== "proposed" && offer.status !== "countered")) {
        return err(409, "Ehdotus ei ole avoinna");
      }
      if (!versionMatches) return err(409, "Hinta ehti muuttua — päivitä näkymä");
      return {
        ok: true,
        offer: { ...offer, status: "declined", counterCents: undefined, version: offer.version + 1, updatedAt: now },
      };
    }
    case "cancel": {
      if (actor.who !== "admin") return err(403, "Vain admin voi perua ehdotuksen");
      if (!offer) return err(409, "Ehdotusta ei ole");
      if (offer.status === "locked") return err(409, "Lukittu hinta peruttava unlock-toiminnolla");
      return {
        ok: true,
        offer: { ...offer, status: "declined", counterCents: undefined, version: offer.version + 1, updatedAt: now },
      };
    }
    case "unlock": {
      // NOTE: the caller must additionally check that the window is NOT "pesty".
      if (actor.who !== "admin") return err(403, "Vain admin voi avata lukituksen");
      if (!offer || offer.status !== "locked") return err(409, "Ikkuna ei ole lukittu");
      return {
        ok: true,
        offer: {
          status: "proposed",
          priceCents: offer.lockedCents ?? offer.priceCents,
          counterCents: undefined,
          version: offer.version + 1,
          updatedAt: now,
          // Sama ikkuna, uusi neuvottelu — hintaperustelu pätee yhä.
          note: offer.note,
        },
      };
    }
  }
}

/** Append an audit event (newest-first, capped). Mutates and returns the array. */
export function pushP2Event(events: P2Event[], ev: P2Event): P2Event[] {
  events.unshift(ev);
  if (events.length > MAX_P2_EVENTS) events.length = MAX_P2_EVENTS;
  return events;
}

// ─── Pestyt keltaiset: rivi riviltä ────────────────────────────────────────────

/** Missä tilassa pestyn keltaisen hinta on. */
export type P2WashedState =
  | "locked"     // sovittu — asiakas hyväksyi hinnan
  | "pending"    // hinta ehdotettu tai vastatarjottu — odottaa asiakasta
  | "declined"   // asiakas hylkäsi — ei rahaa
  | "unpriced";  // ei hintaa lainkaan — hinnoittelematta

export interface P2WashedLine {
  key: string;
  floor: string;
  /** Kerroskohtainen juokseva numero — sama kuin asiakkaan kartalla. */
  number: number;
  state: P2WashedState;
  /**
   * Mitä TÄMÄ ikkuna tuo "PESTY"-ruudun summaan. Sovittu tuo lukitun hinnan,
   * odottava odotetun, ja hylätty tai hinnoittelematon tuo nollan. Rivien summa
   * on siis sama luku kuin ruudussa — se on tarkistettavissa eikä uskon asia.
   */
  priceCents: number;
}

export interface P2WashedFloorGroup {
  floor: string;
  count: number;
  sumCents: number;
  lines: P2WashedLine[];
}

export interface P2WashedList {
  byFloor: P2WashedFloorGroup[];
  /** Kaikki pestyt keltaiset. Sama luku kuin `computeP2Billing().washedTotal`. */
  count: number;
  /** Σ rivien hinnat. Sama kuin ruudun euro (earned + pending). */
  sumCents: number;
  byState: Record<P2WashedState, { count: number; sumCents: number }>;
  /** Täsmääkö lista ruudun lukuihin? Epätosi = jompikumpi on väärin. */
  matchesBilling: boolean;
}

/**
 * JOKAINEN pesty keltainen omana rivinään, kerroksittain.
 *
 * MIKSI: "79 pestyä · 2 587,50 €" ei ole tarkistettavissa. Kun rakennuksesta
 * lasketaan 77, pelkkä loppuluku ei kerro kumpi on oikeassa eikä mistä ero
 * tulee. Rivilista kertoo: käy kerros kerrallaan läpi, ja ylimääräinen tai
 * puuttuva ikkuna näkyy siinä kerroksessa jossa se on.
 *
 * Summa lasketaan riveistä, ei erikseen, ja verrataan `computeP2Billing`in
 * lukuihin. Jos ne eroavat, `matchesBilling` on epätosi — silloin virhe on
 * laskennassa eikä laskennassa.
 */
export function p2WashedYellows(data: ProjectData): P2WashedList {
  const p2 = data.p2;
  const byFloor: P2WashedFloorGroup[] = [];
  const groups = new Map<string, P2WashedFloorGroup>();
  const byState: Record<P2WashedState, { count: number; sumCents: number }> = {
    locked: { count: 0, sumCents: 0 }, pending: { count: 0, sumCents: 0 },
    declined: { count: 0, sumCents: 0 }, unpriced: { count: 0, sumCents: 0 },
  };
  let count = 0, sumCents = 0;

  if (p2) {
    const counters: Record<string, number> = {};
    for (const pt of allPoints(data)) {
      if (pt.p !== 2) continue;
      // Numero juoksee kerroksen KAIKISTA keltaisista, jotta se vastaa karttaa.
      counters[pt.floor] = (counters[pt.floor] ?? 0) + 1;
      if (pt.status !== "pesty") continue;
      const offer = p2.offers[pt.key];
      let state: P2WashedState;
      let priceCents = 0;
      if (offer?.status === "locked" && offer.lockedCents) { state = "locked"; priceCents = offer.lockedCents; }
      else if (offer?.status === "declined") { state = "declined"; }
      else {
        const pending = p2PendingPriceCents(offer);
        if (pending != null) { state = "pending"; priceCents = pending; }
        else { state = "unpriced"; }
      }
      const line: P2WashedLine = { key: pt.key, floor: pt.floor, number: counters[pt.floor], state, priceCents };
      count += 1; sumCents += priceCents;
      byState[state].count += 1; byState[state].sumCents += priceCents;
      let g = groups.get(pt.floor);
      if (!g) { g = { floor: pt.floor, count: 0, sumCents: 0, lines: [] }; groups.set(pt.floor, g); byFloor.push(g); }
      g.count += 1; g.sumCents += priceCents; g.lines.push(line);
    }
  }

  const b = computeP2Billing(data);
  return {
    byFloor, count, sumCents, byState,
    matchesBilling: count === b.washedTotal && sumCents === b.earnedCents + b.pendingEarnedCents,
  };
}

// ─── Keltaisten palkkiot tekijöittäin ──────────────────────────────────────────

export interface P2WorkerSplit {
  /** Tekijä → sovituista keltaisista kertynyt palkkio (senttiä). Maksetaan. */
  earnedCents: Record<string, number>;
  /** Tekijä → pestyjen mutta hyväksymättömien keltaisten palkkio. EI vielä rahaa. */
  pendingCents: Record<string, number>;
  /** Tekijä → montako pestyä keltaista odottaa asiakkaan hyväksyntää (0,5 = jaettu). */
  pendingCount: Record<string, number>;
}

/**
 * Keltaisten palkkiot tekijöittäin YHDELLÄ kartan läpikäynnillä.
 *
 * MIKSI YHDESSÄ: nämä kolme laskettiin kolmena lähes identtisenä silmukkana
 * peräkkäin. Yhden ehdon muuttuessa muut jäisivät jälkeen, ja tekijän kortti
 * väittäisi eri asiaa kuin hänen palkkansa. Yhtenä funktiona ne eivät voi
 * erkaantua, ja niiden jako (kahdestaan pesty ikkuna = 50/50) on testattavissa.
 */
export function p2WorkerSplit(data: ProjectData): P2WorkerSplit {
  const out: P2WorkerSplit = { earnedCents: {}, pendingCents: {}, pendingCount: {} };
  const p2 = data.p2;
  if (!p2?.enabled) return out;
  const sharePct = p2.workerSharePct || DEFAULT_P2_WORKER_SHARE_PCT;
  const schedule = p2.payoutSchedule;
  const by2 = data.washedBy2 || {};
  const add = (bucket: Record<string, number>, who: string | undefined, amount: number) => {
    if (!who) return;
    bucket[who] = (bucket[who] || 0) + amount;
  };
  for (const pt of allPoints(data)) {
    if (pt.p !== 2 || pt.status !== "pesty") continue;
    const offer = p2.offers[pt.key];
    const second = by2[pt.key];
    const half = second ? 0.5 : 1;
    if (offer?.status === "locked" && offer.lockedCents) {
      const pay = p2WorkerPayoutCents(offer.lockedCents, sharePct, schedule);
      add(out.earnedCents, pt.washedBy, pay * half);
      if (second) add(out.earnedCents, second, pay * 0.5);
      continue;
    }
    const pending = p2PendingPriceCents(offer);
    if (pending == null) continue;
    const pay = p2WorkerPayoutCents(pending, sharePct, schedule);
    add(out.pendingCents, pt.washedBy, pay * half);
    add(out.pendingCount, pt.washedBy, half);
    if (second) { add(out.pendingCents, second, pay * 0.5); add(out.pendingCount, second, 0.5); }
  }
  return out;
}

// ─── Laskun erittely: mistä ikkunoista kertymä koostuu ─────────────────────────

/** Yksi laskutettava ikkuna. */
export interface P2InvoiceLine {
  key: string;
  floor: string;
  /** Kerroskohtainen juokseva numero — sama numero jonka asiakas näkee kartalla. */
  number: number;
  /** Sovittu hinta (lockedCents). */
  priceCents: number;
  lockedAt?: number;
  lockedBy?: "customer" | "admin";
}

export interface P2InvoiceFloorGroup {
  floor: string;
  count: number;
  sumCents: number;
  lines: P2InvoiceLine[];
}

/** Yksi hintaporras: montako ikkunaa tällä hinnalla ja paljonko yhteensä. */
export interface P2PriceBucket {
  priceCents: number;
  count: number;
  sumCents: number;
}

export interface P2Itemisation {
  lines: P2InvoiceLine[];
  byFloor: P2InvoiceFloorGroup[];
  /**
   * HINTAJAKAUMA, kallein ensin.
   *
   * Keltaisten hinnat neuvotellaan IKKUNAKOHTAISESTI, eivätkä ne ole yhtä
   * lukua. Pelkästä loppusummasta ei siis näe hintoja, ja summan jakaminen
   * ikkunamäärällä antaa keskiarvon jota kukaan ei ole hyväksynyt — juuri sitä
   * lukua ei saa esittää hintana. Tämä kertoo todellisen jakauman, jolloin
   * yksikin väärä hinta (näppäilyvirhe) erottuu heti omana portaanaan.
   */
  byPrice: P2PriceBucket[];
  /** Σ rivien hinnat. */
  totalCents: number;
  /** Laskutusperusta samasta datasta laskettuna (computeP2Billing). */
  earnedCents: number;
  /**
   * Täsmääkö erittely laskutusperustaan sentilleen?
   *
   * Tämä ei ole koriste. Erittely ja laskutettava summa lasketaan eri
   * funktioissa, ja jos ne joskus eroavat, lasku olisi väärä eikä kukaan
   * huomaisi. Kun tämä on epätosi, laskua EI saa lähettää ennen kuin syy on
   * selvitetty.
   */
  matchesBilling: boolean;
}

/**
 * Mitkä ikkunat muodostavat laskutettavan kertymän, kerroksittain.
 *
 * Mukaan tulevat täsmälleen ne keltaiset joista lasku muodostuu: PESTY ja
 * hinta SOVITTU (`locked` + `lockedCents`). Ei pesemättömiä sovittuja (työtä ei
 * ole tehty) eikä pestyjä hyväksymättömiä (hinnasta ei ole sovittu).
 *
 * Numerointi on sama kuin asiakkaan kartalla: kerroksen keltaiset juoksevassa
 * järjestyksessä. Silloin laskun rivi ja asiakkaan näkymä puhuvat samasta
 * ikkunasta samalla nimellä.
 */
export function p2Itemisation(data: ProjectData): P2Itemisation {
  const p2 = data.p2;
  const byFloor: P2InvoiceFloorGroup[] = [];
  const lines: P2InvoiceLine[] = [];
  if (p2) {
    const counters: Record<string, number> = {};
    const groups = new Map<string, P2InvoiceFloorGroup>();
    for (const pt of allPoints(data)) {
      if (pt.p !== 2) continue;
      // Numero juoksee kerroksen KAIKISTA keltaisista, ei vain laskutettavista —
      // muuten numero ei vastaisi asiakkaan karttaa.
      counters[pt.floor] = (counters[pt.floor] ?? 0) + 1;
      const offer = p2.offers[pt.key];
      if (offer?.status !== "locked" || !offer.lockedCents) continue;
      if (pt.status !== "pesty") continue;
      const line: P2InvoiceLine = {
        key: pt.key, floor: pt.floor, number: counters[pt.floor],
        priceCents: offer.lockedCents, lockedAt: offer.lockedAt, lockedBy: offer.lockedBy,
      };
      lines.push(line);
      let g = groups.get(pt.floor);
      if (!g) { g = { floor: pt.floor, count: 0, sumCents: 0, lines: [] }; groups.set(pt.floor, g); byFloor.push(g); }
      g.count += 1; g.sumCents += line.priceCents; g.lines.push(line);
    }
  }
  const buckets = new Map<number, P2PriceBucket>();
  for (const l of lines) {
    const b = buckets.get(l.priceCents) ?? { priceCents: l.priceCents, count: 0, sumCents: 0 };
    b.count += 1; b.sumCents += l.priceCents;
    buckets.set(l.priceCents, b);
  }
  const byPrice = Array.from(buckets.values()).sort((a, b) => b.priceCents - a.priceCents);
  const totalCents = lines.reduce((n, l) => n + l.priceCents, 0);
  const earnedCents = computeP2Billing(data).earnedCents;
  return { lines, byFloor, byPrice, totalCents, earnedCents, matchesBilling: totalCents === earnedCents };
}

// ─── Hätäperuutus: asiakkaan hyväksynnät takaisin odottamaan ───────────────────

/** Yksi peruttavissa oleva hyväksyntä. */
export interface P2CustomerLock {
  key: string;
  /** Sovittu hinta jonka hyväksyntä lukitsi. */
  lockedCents: number;
  lockedAt: number;
}

/**
 * ASIAKKAAN hyväksynnät annetun hetken jälkeen, uusin ensin.
 *
 * MIKSI TÄMÄ ON OMA FUNKTIONSA: hyväksyntä on asiakkaan tahdonilmaisu, ja sen
 * peruminen on poikkeustoimi. Sen kohdejoukko pitää voida näyttää ETUKÄTEEN
 * täsmälleen samalla säännöllä jolla palvelin sen tekee — muuten napissa lukisi
 * eri määrä kuin mitä se peruu.
 *
 * Rajaus on tarkoituksella tiukka:
 *  · vain `locked` — muut tilat eivät ole hyväksyntöjä;
 *  · vain `lockedBy === "customer"` — meidän oma `accept_counter` on eri asia
 *    eikä sitä pidä perua vahingossa mukana;
 *  · vain annetun aikarajan jälkeen — vanhoihin sopimuksiin ei kosketa.
 */
export function p2CustomerLocksSince(
  p2: P2State | null | undefined,
  sinceMs: number,
): P2CustomerLock[] {
  const out: P2CustomerLock[] = [];
  for (const [key, o] of Object.entries(p2?.offers ?? {})) {
    if (o.status !== "locked" || o.lockedBy !== "customer") continue;
    if (typeof o.lockedAt !== "number" || o.lockedAt < sinceMs) continue;
    out.push({ key, lockedCents: o.lockedCents ?? o.priceCents, lockedAt: o.lockedAt });
  }
  return out.sort((a, b) => b.lockedAt - a.lockedAt);
}

// ─── Point helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve a window key's priority from the MAP itself (never trust a
 * client-sent `p`). Returns null when the key doesn't exist or is deleted.
 */
export function pointPriority(data: ProjectData, key: string): 1 | 2 | null {
  if (data.deleted[key]) return null;
  const hash = key.indexOf("#");
  if (hash <= 0) return null;
  const floor = key.slice(0, hash);
  const rest = key.slice(hash + 1);
  if (rest.startsWith("c")) {
    const cm = (data.customMarks[floor] || []).find((c) => c.key === key);
    return cm ? cm.p : null;
  }
  const idx = Number(rest);
  if (!Number.isInteger(idx) || idx < 0) return null;
  const mk = data.marks[floor]?.marks?.[idx];
  return mk ? mk.p : null;
}

/**
 * Is this yellow window's price AGREED with the customer (locked, phase on)?
 *
 * HUOM: tämä EI enää estä pesua. Tekijät pesevät kaikki keltaiset — hinnan
 * hyväksyntä on rahakysymys, ei työkysymys. Tätä käytetään vain rahan puolella:
 * lukittu → laskutetaan asiakkaalta ja maksetaan tekijälle; lukitsematta →
 * "odottaa hyväksyntää" (ks. `computeP2Billing.pending*`).
 */
export function isP2Priced(data: ProjectData, key: string): boolean {
  const p2 = data.p2;
  if (!p2 || !p2.enabled) return false;
  return p2.offers[key]?.status === "locked";
}

/** @deprecated Käytä `isP2Priced`. Nimi jäi kun pesuportti poistettiin. */
export const isP2Washable = isP2Priced;

/**
 * Odotettu hinta keltaiselle ikkunalle jota asiakas ei ole vielä hyväksynyt:
 * vastatarjous > oma ehdotus. Ei mitään → null (ei hinnoiteltu lainkaan).
 * Tätä käytetään "odottaa hyväksyntää" -summiin, jotta pesty mutta hyväksymätön
 * työ näkyy sekä perustajalle että tekijän maksettavassa — merkittynä.
 */
export function p2PendingPriceCents(offer: P2Offer | undefined): number | null {
  if (!offer || offer.status === "locked" || offer.status === "declined") return null;
  const cents = offer.counterCents ?? offer.priceCents;
  return typeof cents === "number" && cents > 0 ? cents : null;
}

// ─── Money ─────────────────────────────────────────────────────────────────────

/**
 * Worker's payout for one locked yellow window. A fixed rule for the exact
 * locked price wins (34 € → 18 €, 37,50 € → 20 €); otherwise a percentage share
 * of the locked price. `schedule` absent → DEFAULT_P2_PAYOUT_SCHEDULE, so the two
 * agreed FR8 sizes always pay their flat amount without any per-gig config.
 */
export function p2WorkerPayoutCents(
  lockedCents: number,
  workerSharePct: number,
  schedule?: P2PayoutRule[] | null,
): number {
  const cents = Math.max(0, Math.round(Number(lockedCents) || 0));
  const rules = schedule && schedule.length ? schedule : DEFAULT_P2_PAYOUT_SCHEDULE;
  const rule = rules.find((r) => r.priceCents === cents);
  if (rule) return Math.max(0, Math.round(rule.payoutCents));
  const pct = Math.max(1, Math.min(100, Math.round(Number(workerSharePct) || 0)));
  return Math.round(cents * pct / 100);
}

export interface P2Billing {
  yellowTotal: number;          // live p=2 points on the map
  pricedCount: number;          // yellow points with any offer record
  proposedCount: number;        // status "proposed" (waiting for the customer)
  counteredCount: number;       // status "countered" (admin inbox badge)
  lockedCount: number;
  lockedSumCents: number;       // Σ lockedCents — the customer's growing total
  lockedWashedCount: number;    // locked & washed
  earnedCents: number;          // Σ lockedCents over washed locked windows
  remainingLockedCents: number; // lockedSum − earned
  workerCostCents: number;      // Σ worker share over washed locked windows
  marginCents: number;          // earned − workerCost (founders' P2 kate)
  /** ODOTTAA HYVÄKSYNTÄÄ — pesty keltainen jolla on hinta ehdotettuna mutta
   *  asiakas ei ole sitä vielä hyväksynyt. Työ on tehty, raha ei ole varmaa:
   *  ei laskuteta eikä makseta ennen lukitusta, mutta näytetään aina. */
  pendingWashedCount: number;
  pendingEarnedCents: number;      // Σ odotettu asiakashinta
  pendingWorkerCostCents: number;  // Σ odotettu tekijän palkkio
  /** Pesty keltainen jolla EI ole hintaa lainkaan — hinnoittele tai tyhjennä. */
  unpricedWashedCount: number;
  /**
   * Pesty keltainen jonka asiakas HYLKÄSI. Työ on tehty mutta siitä ei saada
   * rahaa, eikä sille tehdä mitään.
   *
   * OMA LASKURINSA, koska nämä laskettiin ennen `unpricedWashedCount`iin: sama
   * ikkuna näkyi yhtä aikaa "hylätty" ja "ilman hintaa", ja perustajaa
   * kehotettiin hinnoittelemaan ikkuna jonka asiakas oli juuri torjunut.
   * Luvut näyttivät siltä että jossain on virhe — ja juuri sitä epäluottamusta
   * ei laskutushetkellä kaivata.
   */
  declinedWashedCount: number;
  /** Washed yellow windows with no price at all (avaimet varoitukseen). */
  washedUnlockedKeys: string[];
  /**
   * KAIKKI pestyt keltaiset — riippumatta siitä onko hinta lukittu, ehdotettu
   * vai puuttuuko se kokonaan.
   *
   * MIKSI TÄMÄ ON OLEMASSA: pestyt keltaiset hajosivat kolmeen laskuriin
   * (lockedWashedCount / pendingWashedCount / unpricedWashedCount), joista
   * kahta näytettiin vain jos ne olivat nollaa suurempia. Perustajan
   * "PESTY"-tiili näytti siis pelkän lukitun osajoukon, ja kun sen vähensi
   * kokonaismäärästä (`yellowTotal`), erotus oli aivan liian suuri. Tekijän
   * sovellus taas laski pestyt keltaiset ilman tarjousliitosta, joten se
   * näytti oikean luvun — kaksi näkymää, kaksi eri totuutta samasta asiasta.
   *
   * Tämä lasketaan suoraan kartan tilasta samalla tavalla kuin tekijän
   * sovelluksessa, EI kolmen osalaskurin summana. Niiden yhtäsuuruus on siis
   * aito väite jonka testi voi tarkistaa, ei määritelmä joka pitää itsestään.
   */
  washedTotal: number;
  /** Asiakkaan hylkäämät hinnat. Puuttui tilariviltä, jolloin osat eivät
   *  summautuneet kokonaismäärään ja rivi näytti kadottavan ikkunoita. */
  declinedCount: number;
}

/**
 * P2 money, computed the same defensive way as computeDealBilling: joins the
 * offers against the LIVE p=2 points, so deleted dots drop out of every total.
 * With no `p2` on the project everything is zero and P1 behaves exactly as today.
 */
export function computeP2Billing(data: ProjectData): P2Billing {
  const out: P2Billing = {
    yellowTotal: 0, pricedCount: 0, proposedCount: 0, counteredCount: 0,
    lockedCount: 0, lockedSumCents: 0, lockedWashedCount: 0, earnedCents: 0,
    remainingLockedCents: 0, workerCostCents: 0, marginCents: 0,
    pendingWashedCount: 0, pendingEarnedCents: 0, pendingWorkerCostCents: 0,
    unpricedWashedCount: 0, declinedWashedCount: 0,
    washedUnlockedKeys: [],
    washedTotal: 0, declinedCount: 0,
  };
  const p2 = data.p2;
  const yellows = allPoints(data).filter((p) => p.p === 2);
  out.yellowTotal = yellows.length;
  if (!p2) return out;
  const sharePct = p2.workerSharePct || DEFAULT_P2_WORKER_SHARE_PCT;
  const schedule = p2.payoutSchedule;
  for (const pt of yellows) {
    const offer = p2.offers[pt.key];
    // Pesty on pesty riippumatta hinnan tilasta. Lasketaan tässä, ennen
    // tarjouskohtaisia haaroja, jotta luku ei voi jäädä yhdenkään haaran
    // varaan — juuri se teki "PESTY"-tiilestä osajoukon.
    if (pt.status === "pesty") out.washedTotal += 1;
    if (offer) out.pricedCount += 1;
    if (offer?.status === "proposed") out.proposedCount += 1;
    if (offer?.status === "countered") out.counteredCount += 1;
    if (offer?.status === "declined") out.declinedCount += 1;
    if (offer?.status === "locked" && offer.lockedCents) {
      out.lockedCount += 1;
      out.lockedSumCents += offer.lockedCents;
      if (pt.status === "pesty") {
        out.lockedWashedCount += 1;
        out.earnedCents += offer.lockedCents;
        out.workerCostCents += p2WorkerPayoutCents(offer.lockedCents, sharePct, schedule);
      }
    } else if (pt.status === "pesty") {
      // Pesty, mutta hintaa ei ole lukittu. Kolme eri tapausta:
      //  • asiakas hylkäsi → ei rahaa, ei tehtävää (oma laskurinsa)
      //  • hinta ehdotettu / vastatarjottu → ODOTTAA HYVÄKSYNTÄÄ (raha tulossa)
      //  • ei hintaa lainkaan → hinnoittelematon (perustajan tehtävälista)
      if (offer?.status === "declined") {
        out.declinedWashedCount += 1;
        continue;
      }
      const pending = p2PendingPriceCents(offer);
      if (pending != null) {
        out.pendingWashedCount += 1;
        out.pendingEarnedCents += pending;
        out.pendingWorkerCostCents += p2WorkerPayoutCents(pending, sharePct, schedule);
      } else {
        out.unpricedWashedCount += 1;
        out.washedUnlockedKeys.push(pt.key);
      }
    }
  }
  out.remainingLockedCents = out.lockedSumCents - out.earnedCents;
  out.marginCents = out.earnedCents - out.workerCostCents;
  return out;
}

// ─── Sanitisation (server-side validation) ─────────────────────────────────────

function cleanKey(v: any): string {
  return String(v ?? "").slice(0, 64);
}

function toOfferStatus(v: any): P2OfferStatus | null {
  return v === "proposed" || v === "countered" || v === "locked" || v === "declined" ? v : null;
}

const P2_ACTIONS: P2Action[] = ["propose", "accept", "counter", "accept_counter", "decline", "cancel", "unlock", "add_point", "remove_point"];

/**
 * Window keys the CUSTOMER added themselves (from the audit log), still live on
 * the map. Drives the "your suggestion" marker + the customer's own remove
 * control. A key that was added then removed is excluded.
 */
export function customerAddedKeys(data: ProjectData): string[] {
  const p2 = data.p2;
  if (!p2) return [];
  const added = new Set<string>();
  // Events are newest-first; walk oldest→newest so remove after add wins.
  for (let i = p2.events.length - 1; i >= 0; i--) {
    const e = p2.events[i];
    if (e.actor !== "customer") continue;
    if (e.action === "add_point") added.add(e.key);
    else if (e.action === "remove_point") added.delete(e.key);
  }
  return Array.from(added).filter((k) => !data.deleted[k]);
}

/** Sanitize an incoming p2 state so a bad client/blob can't corrupt it. */
export function sanitizeP2State(input: any): P2State | undefined {
  if (!input || typeof input !== "object") return undefined;

  const offers: Record<string, P2Offer> = {};
  if (input.offers && typeof input.offers === "object") {
    for (const k of Object.keys(input.offers).slice(0, 10000)) {
      const o = input.offers[k];
      const status = toOfferStatus(o?.status);
      const priceCents = Math.floor(Number(o?.priceCents));
      if (!status || !Number.isFinite(priceCents) || priceCents <= 0 || priceCents > MAX_P2_PRICE_CENTS) continue;
      const key = cleanKey(k);
      if (!key) continue;
      const counter = Math.floor(Number(o?.counterCents));
      const locked = Math.floor(Number(o?.lockedCents));
      offers[key] = {
        status,
        priceCents,
        counterCents: status === "countered" && counter > 0 && counter <= MAX_P2_PRICE_CENTS ? counter : undefined,
        version: Math.max(1, Math.floor(Number(o?.version)) || 1),
        lockedCents: status === "locked" && locked > 0 && locked <= MAX_P2_PRICE_CENTS ? locked : undefined,
        lockedAt: o?.lockedAt ? Number(o.lockedAt) || undefined : undefined,
        lockedBy: o?.lockedBy === "customer" || o?.lockedBy === "admin" ? o.lockedBy : undefined,
        updatedAt: Number(o?.updatedAt) || Date.now(),
        note: typeof o?.note === "string" && o.note.trim() ? String(o.note).trim().slice(0, MAX_P2_NOTE_LEN) : undefined,
      };
      // A "locked" offer without a usable lockedCents is corrupt — drop it back
      // to proposed so it can be re-negotiated instead of billing garbage.
      if (status === "locked" && !offers[key].lockedCents) {
        offers[key] = { ...offers[key], status: "proposed", lockedAt: undefined, lockedBy: undefined };
      }
    }
  }

  const events: P2Event[] = Array.isArray(input.events)
    ? input.events.slice(0, MAX_P2_EVENTS).map((e: any): P2Event | null => {
        const action = P2_ACTIONS.includes(e?.action) ? (e.action as P2Action) : null;
        const key = cleanKey(e?.key);
        if (!action || !key) return null;
        return {
          ts: Number(e?.ts) || Date.now(),
          key,
          action,
          actor: String(e?.actor ?? "").slice(0, 40) || "customer",
          priceCents: e?.priceCents != null ? Math.max(0, Math.floor(Number(e.priceCents)) || 0) : undefined,
          prevPriceCents: e?.prevPriceCents != null ? Math.max(0, Math.floor(Number(e.prevPriceCents)) || 0) : undefined,
          version: Math.max(0, Math.floor(Number(e?.version)) || 0),
          ip: e?.ip ? String(e.ip).slice(0, 64) : undefined,
        };
      }).filter((e: P2Event | null): e is P2Event => !!e)
    : [];

  let terms: P2Terms | null = null;
  if (input.terms && typeof input.terms === "object") {
    const name = String(input.terms.acceptorName ?? "").slice(0, 160).trim();
    if (name) {
      terms = {
        acceptedAt: Number(input.terms.acceptedAt) || Date.now(),
        acceptorName: name,
        ip: input.terms.ip ? String(input.terms.ip).slice(0, 64) : undefined,
        userAgent: input.terms.userAgent ? String(input.terms.userAgent).slice(0, 400) : undefined,
      };
    }
  }

  // Payout schedule: exact price → flat worker pay. Keep only well-formed,
  // positive, de-duplicated rules within the price cap. Absent/empty stays
  // undefined so the DEFAULT_P2_PAYOUT_SCHEDULE applies.
  let payoutSchedule: P2PayoutRule[] | undefined;
  if (Array.isArray(input.payoutSchedule)) {
    const seen = new Set<number>();
    const rules: P2PayoutRule[] = [];
    for (const r of input.payoutSchedule.slice(0, MAX_P2_PAYOUT_RULES)) {
      const priceCents = Math.floor(Number(r?.priceCents));
      const payoutCents = Math.floor(Number(r?.payoutCents));
      if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents > MAX_P2_PRICE_CENTS) continue;
      if (!Number.isFinite(payoutCents) || payoutCents < 0 || payoutCents > MAX_P2_PRICE_CENTS) continue;
      if (seen.has(priceCents)) continue;
      seen.add(priceCents);
      rules.push({ priceCents, payoutCents });
    }
    if (rules.length) payoutSchedule = rules.sort((a, b) => a.priceCents - b.priceCents);
  }

  const sharePct = Math.floor(Number(input.workerSharePct));
  return {
    enabled: input.enabled === true,
    workerSharePct: Number.isFinite(sharePct) && sharePct >= 1 && sharePct <= 100 ? sharePct : DEFAULT_P2_WORKER_SHARE_PCT,
    offers,
    events,
    terms,
    termsText: input.termsText ? String(input.termsText).slice(0, 60000) : undefined,
    ...(payoutSchedule ? { payoutSchedule } : {}),
  };
}
