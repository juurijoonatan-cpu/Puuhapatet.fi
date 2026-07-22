/**
 * Guided progression (ohjattu eteneminen) — "yks kerros kerrallaa, muut lukossa".
 *
 * A fairness tool for a gig with many windows across many floors: instead of
 * letting workers cherry-pick the easy/cheap windows wherever they like, the crew
 * progresses ONE FLOOR AT A TIME. Only the active floor is open; later floors are
 * locked, and the dashboard points each worker at the next specific window on the
 * active floor. This spreads the hard and the easy windows evenly across the crew
 * over time ("tasapuolistaa") without any difficulty tiers — the price already
 * encodes difficulty (pricier yellow = harder = bigger payout, shared/p2.ts).
 *
 * Design decisions (founder):
 *   • Opt-in per gig, default OFF — absent/`enabled:false` ⇒ zero behavioural change.
 *   • Rule-based, deterministic guidance (no LLM): the "next window" is simply the
 *     first unwashed in-scope window on the active floor, in a stable sweep order.
 *   • No difficulty tiers. In-scope = every Priority 1 (red) window ALWAYS, plus a
 *     Priority 2 (yellow) window ONLY once its price is locked (isP2Washable).
 *
 * The active floor is the first floor (in building order) that still has unwashed
 * in-scope windows — so it advances automatically as floors finish, and jumps back
 * if an earlier floor gains new in-scope work (e.g. a yellow gets locked, or a
 * cleared window). A founder may pin a specific floor via `activeFloorOverride`.
 *
 * State (the toggle + override) lives in `ProjectData.guided`; everything else here
 * is DERIVED — pure functions over the live map + p2 state, nothing persisted.
 */

import type { ProjectData, WindowStatus } from "./project";
import { DEFAULT_FLOORS } from "./project";
import { isP2Washable } from "./p2";

// ─── Persisted state ─────────────────────────────────────────────────────────

export interface GuidedWork {
  /** Founder toggle. Default OFF — when off, `computeGuided` returns a disabled
   *  state and the washing gate never blocks (the gig behaves exactly as before). */
  enabled: boolean;
  /** Founder-pinned active floor. Honoured only while that floor still has unwashed
   *  in-scope work; otherwise the active floor auto-advances. Null/absent = auto. */
  activeFloorOverride?: string | null;
}

export function emptyGuidedWork(): GuidedWork {
  return { enabled: false, activeFloorOverride: null };
}

// ─── Derived state ───────────────────────────────────────────────────────────

export interface GuidedFloorProgress {
  floor: string;
  inScope: number;     // in-scope windows on this floor (red always + locked yellow)
  washed: number;      // in-scope windows marked "pesty"
  remaining: number;   // inScope − washed
  complete: boolean;   // inScope > 0 && remaining === 0
  active: boolean;     // this is THE open floor
  locked: boolean;     // guided on, has remaining work, but is not the active floor
}

export interface GuidedNext {
  key: string;
  floor: string;
  p: 1 | 2;
  x: number;           // 0..100 (posOverride applied)
  y: number;           // 0..100
  status: WindowStatus;
}

export interface GuidedState {
  enabled: boolean;
  /** The single open floor, or null when nothing is in scope / everything is done. */
  activeFloor: string | null;
  /** True when `activeFloor` was pinned by the founder (a live override). */
  overrideActive: boolean;
  /** Floors AFTER-or-elsewhere that still have in-scope work and are locked shut. */
  lockedFloors: string[];
  /** In-scope, active-floor, not-yet-washed keys — what a worker may mark right now. */
  openKeys: string[];
  /** The next window to guide the worker to (kesken-first, then top→bottom sweep). */
  nextKey: string | null;
  next: GuidedNext | null;
  floorProgress: GuidedFloorProgress[];
  remainingOnActive: number;
  totalInScope: number;
  washedInScope: number;
  allComplete: boolean;   // there was in-scope work and it is ALL washed
}

interface ScopePoint {
  key: string;
  floor: string;
  p: 1 | 2;
  x: number;
  y: number;
  status: WindowStatus;
}

/**
 * Every live IN-SCOPE window with its resolved position. In-scope = Priority 1
 * (red) always, plus Priority 2 (yellow) only when its price is locked and phase 2
 * is live (isP2Washable). Positions honour posOverrides, mirroring the map.
 */
function inScopePoints(data: ProjectData): ScopePoint[] {
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const out: ScopePoint[] = [];
  const push = (floor: string, key: string, p: 1 | 2, bx: number, by: number) => {
    if (data.deleted[key]) return;
    // Red is always in scope; yellow only once its price is locked.
    if (p === 2 && !isP2Washable(data, key)) return;
    const o = data.posOverrides[key];
    out.push({
      key, floor, p,
      x: o ? o.x : bx,
      y: o ? o.y : by,
      status: data.statuses[key] || "ei",
    });
  };
  for (const f of floors) {
    (data.marks[f]?.marks || []).forEach((mk, idx) => push(f, `${f}#${idx}`, mk.p, mk.x, mk.y));
    (data.customMarks[f] || []).forEach((cm) => push(f, cm.key, cm.p, cm.x, cm.y));
  }
  return out;
}

/** Stable systematic sweep: unfinished-started (kesken) first, then top→bottom,
 *  then left→right, then key — so guidance never leaves half-done windows behind
 *  and is fully deterministic for identical maps. */
function sweepOrder(a: ScopePoint, b: ScopePoint): number {
  const ak = a.status === "kesken" ? 0 : 1;
  const bk = b.status === "kesken" ? 0 : 1;
  if (ak !== bk) return ak - bk;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Derive the full guided-progression state from a project. Pure and cheap — safe
 * to call per request. With `guided` absent or disabled the result is a disabled
 * state (activeFloor null, nothing locked) and the washing gate stays open.
 */
export function computeGuided(data: ProjectData): GuidedState {
  const enabled = data.guided?.enabled === true;
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const pts = inScopePoints(data);

  // Per-floor tallies (only floors that actually carry in-scope windows matter).
  const byFloor = new Map<string, { inScope: number; washed: number }>();
  for (const f of floors) byFloor.set(f, { inScope: 0, washed: 0 });
  for (const p of pts) {
    const t = byFloor.get(p.floor);
    if (!t) continue; // floor not in the building list — ignore
    t.inScope += 1;
    if (p.status === "pesty") t.washed += 1;
  }

  const totalInScope = pts.length;
  const washedInScope = pts.filter((p) => p.status === "pesty").length;
  const allComplete = totalInScope > 0 && washedInScope >= totalInScope;

  // First floor (building order) that still has unwashed in-scope work.
  const firstIncomplete = floors.find((f) => {
    const t = byFloor.get(f)!;
    return t.inScope > 0 && t.washed < t.inScope;
  }) ?? null;

  // Founder override wins only while it names a real floor that still has work.
  const override = data.guided?.activeFloorOverride ?? null;
  const overrideValid =
    !!override &&
    floors.includes(override) &&
    (() => { const t = byFloor.get(override); return !!t && t.inScope > 0 && t.washed < t.inScope; })();

  const activeFloor = !enabled ? null : (overrideValid ? override! : firstIncomplete);
  const overrideActive = enabled && overrideValid;

  const floorProgress: GuidedFloorProgress[] = floors.map((f) => {
    const t = byFloor.get(f)!;
    const remaining = t.inScope - t.washed;
    const active = enabled && activeFloor === f;
    return {
      floor: f,
      inScope: t.inScope,
      washed: t.washed,
      remaining,
      complete: t.inScope > 0 && remaining === 0,
      active,
      locked: enabled && !active && remaining > 0,
    };
  });

  const lockedFloors = floorProgress.filter((fp) => fp.locked).map((fp) => fp.floor);

  // Open keys + the single next window, from the active floor's unwashed windows.
  let openKeys: string[] = [];
  let next: GuidedNext | null = null;
  if (enabled && activeFloor) {
    const onActive = pts
      .filter((p) => p.floor === activeFloor && p.status !== "pesty")
      .sort(sweepOrder);
    openKeys = onActive.map((p) => p.key);
    if (onActive.length) {
      const n = onActive[0];
      next = { key: n.key, floor: n.floor, p: n.p, x: n.x, y: n.y, status: n.status };
    }
  }

  const remainingOnActive = activeFloor ? (byFloor.get(activeFloor)!.inScope - byFloor.get(activeFloor)!.washed) : 0;

  return {
    enabled,
    activeFloor,
    overrideActive,
    lockedFloors,
    openKeys,
    nextKey: next?.key ?? null,
    next,
    floorProgress,
    remainingOnActive,
    totalInScope,
    washedInScope,
    allComplete,
  };
}

/**
 * Washing gate for guided mode: is marking this window (to "pesty"/"kesken")
 * currently blocked because it is not on the open floor?
 *
 * Returns false (never blocks) when guided is off, or when there is no active
 * floor (nothing in scope / all done) — so clearing and normal work are unaffected.
 * The caller still applies the independent P2 lock (isP2Washable) for yellows and
 * always allows clearing a status back to "ei".
 */
export function isGuidedBlocked(data: ProjectData, key: string): boolean {
  if (data.guided?.enabled !== true) return false;
  const g = computeGuided(data);
  if (!g.activeFloor) return false;
  const hash = key.indexOf("#");
  if (hash <= 0) return false;
  const floor = key.slice(0, hash);
  return floor !== g.activeFloor;
}

// ─── Sanitisation (server-side validation) ─────────────────────────────────────

/** Sanitize an incoming guided-work object so a bad client/blob can't corrupt it. */
export function sanitizeGuidedWork(input: any): GuidedWork | undefined {
  if (!input || typeof input !== "object") return undefined;
  const override = input.activeFloorOverride;
  return {
    enabled: input.enabled === true,
    activeFloorOverride:
      typeof override === "string" && override.trim() ? override.slice(0, 8) : null,
  };
}
