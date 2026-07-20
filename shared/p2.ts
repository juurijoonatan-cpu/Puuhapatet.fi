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

/** Quick admin price presets (cents) shown in the pricing UI. */
export const P2_PRICE_PRESETS_CENTS = [2500, 3750, 5000];

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
  workerSharePct: number;       // worker's share of a locked price, 1..100
  offers: Record<string, P2Offer>;   // window key → offer
  events: P2Event[];            // newest-first, capped at MAX_P2_EVENTS
  terms?: P2Terms | null;
  /** Optional P2 contract/terms text shown to the customer in the terms dialog.
   *  The founders can paste the finished sopimus here later. */
  termsText?: string;
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
  payload: { priceCents?: number; version?: number },
  now: number = Date.now(),
): P2TransitionResult {
  const versionMatches = offer !== undefined && Number(payload.version) === offer.version;

  switch (action) {
    case "propose": {
      if (actor.who !== "admin") return err(403, "Vain admin voi ehdottaa hintaa");
      if (offer?.status === "locked") return err(409, "Hinta on jo lukittu");
      if (!validPrice(payload.priceCents)) return err(400, "Virheellinen hinta");
      return {
        ok: true,
        offer: {
          status: "proposed",
          priceCents: payload.priceCents!,
          counterCents: undefined,
          version: (offer?.version ?? 0) + 1,
          updatedAt: now,
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

/** Is this yellow window part of the P2 work scope (locked price, phase on)? */
export function isP2Washable(data: ProjectData, key: string): boolean {
  const p2 = data.p2;
  if (!p2 || !p2.enabled) return false;
  return p2.offers[key]?.status === "locked";
}

// ─── Money ─────────────────────────────────────────────────────────────────────

/** Worker's payout for one locked yellow window (share of ITS locked price). */
export function p2WorkerPayoutCents(lockedCents: number, workerSharePct: number): number {
  const pct = Math.max(1, Math.min(100, Math.round(Number(workerSharePct) || 0)));
  return Math.round(Math.max(0, lockedCents) * pct / 100);
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
  /** Washed yellow windows WITHOUT a locked price (legacy / anomaly — pay 0). */
  washedUnlockedKeys: string[];
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
    washedUnlockedKeys: [],
  };
  const p2 = data.p2;
  const yellows = allPoints(data).filter((p) => p.p === 2);
  out.yellowTotal = yellows.length;
  if (!p2) return out;
  const sharePct = p2.workerSharePct || DEFAULT_P2_WORKER_SHARE_PCT;
  for (const pt of yellows) {
    const offer = p2.offers[pt.key];
    if (offer) out.pricedCount += 1;
    if (offer?.status === "proposed") out.proposedCount += 1;
    if (offer?.status === "countered") out.counteredCount += 1;
    if (offer?.status === "locked" && offer.lockedCents) {
      out.lockedCount += 1;
      out.lockedSumCents += offer.lockedCents;
      if (pt.status === "pesty") {
        out.lockedWashedCount += 1;
        out.earnedCents += offer.lockedCents;
        out.workerCostCents += p2WorkerPayoutCents(offer.lockedCents, sharePct);
      }
    } else if (pt.status === "pesty") {
      out.washedUnlockedKeys.push(pt.key);
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

  const sharePct = Math.floor(Number(input.workerSharePct));
  return {
    enabled: input.enabled === true,
    workerSharePct: Number.isFinite(sharePct) && sharePct >= 1 && sharePct <= 100 ? sharePct : DEFAULT_P2_WORKER_SHARE_PCT,
    offers,
    events,
    terms,
    termsText: input.termsText ? String(input.termsText).slice(0, 60000) : undefined,
  };
}
