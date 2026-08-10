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
 *     window on an open floor — red and yellow alike (hinnan hyväksyntä ei
 *     rajaa työtä, ks. shared/p2.ts isP2Priced).
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

// ─── Persisted state ─────────────────────────────────────────────────────────

export interface GuidedWork {
  /** Founder toggle. Default OFF — when off, `computeGuided` returns a disabled
   *  state and the washing gate never blocks (the gig behaves exactly as before). */
  enabled: boolean;
  /** Founder-pinned active floor (LEGACY single-floor mode). Honoured only while
   *  that floor still has unwashed in-scope work; otherwise the active floor
   *  auto-advances. Null/absent = auto. Ignored when `openFloors` is non-empty. */
  activeFloorOverride?: string | null;
  /** Founder-opened floors (MULTI mode). When non-empty, EXACTLY these floors are
   *  open for washing and every other floor is locked — a simple manual "open
   *  floors 2 and 3" control. Empty/absent = legacy single-floor auto mode.
   *  Within the open floors each worker is still guided nearest-neighbour. */
  openFloors?: string[];
  /**
   * YKSITTÄISET LUKITUT IKKUNAT.
   *
   * Kerroslukitus on tylppä työkalu: joskus koko kerros on työn alla mutta yksi
   * ikkuna ei ole (rikki, tavaraa edessä, ei kuulu tähän erään). Näitä avaimia
   * ei voi merkitä pestyksi eivätkä ne näy tekijän kartalla lainkaan.
   *
   * TÄMÄ EI RIIPU `enabled`ista. Yhden ikkunan piilottaminen on pieni arkinen
   * teko, eikä sen takia pidä joutua kytkemään koko ohjattua etenemistä päälle
   * — se muuttaisi kaikkien kerrosten käyttäytymisen kerralla.
   */
  lockedKeys?: string[];
}

export function emptyGuidedWork(): GuidedWork {
  return { enabled: false, activeFloorOverride: null, openFloors: [], lockedKeys: [] };
}

/** Onko tämä yksittäinen ikkuna lukittu tekijöiltä? */
export function isWindowLocked(data: ProjectData, key: string): boolean {
  const keys = data.guided?.lockedKeys;
  return Array.isArray(keys) && keys.includes(key);
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
  /** The floor THIS request is being guided to (the worker's own floor within the
   *  open set), or null when nothing is in scope / everything open is done. */
  activeFloor: string | null;
  /** ALL floors currently open for washing. One in legacy single-floor mode; the
   *  founder-selected set in multi mode. The washing gate allows any of these. */
  activeFloors: string[];
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
 * Positions honour posOverrides, mirroring the map.
 */
function inScopePoints(data: ProjectData): ScopePoint[] {
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const out: ScopePoint[] = [];
  const push = (floor: string, key: string, p: 1 | 2, bx: number, by: number) => {
    if (data.deleted[key]) return;
    // KAIKKI kartan ikkunat ovat työn piirissä — myös keltaiset joiden hintaa
    // asiakas ei ole vielä hyväksynyt. Tekijät pesevät kaikki keltaiset; hinnan
    // hyväksyntä on rahakysymys (ks. shared/p2.ts isP2Priced), ei työkysymys.
    // Aiemmin tässä oli `if (p === 2 && !isP2Washable(...)) return;`, mikä piti
    // hinnoittelemattomat keltaiset kokonaan pois kerrosten edistymisestä.
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
 *  and is fully deterministic for identical maps. Used as the START-OF-FLOOR order
 *  (before anything is washed) and as the tiebreak inside nearest-neighbor. */
function sweepOrder(a: ScopePoint, b: ScopePoint): number {
  const ak = a.status === "kesken" ? 0 : 1;
  const bk = b.status === "kesken" ? 0 : 1;
  if (ak !== bk) return ak - bk;
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Position of the window most recently FINISHED on `floor` — the anchor for
 * nearest-neighbor guidance. Read from the activity log (newest-first "pesty"
 * events), matched to a live in-scope point on the floor that is still washed.
 *
 * When `workerId` is given, PREFER that worker's own most-recent wash on the
 * floor, so several workers on the same floor each continue from THEIR own spot
 * and spread out to different areas instead of all being sent to one window; if
 * they haven't washed here yet, fall back to the floor's global last wash. Null
 * when nothing has been washed on the floor yet (→ start at the top-left corner).
 */
function lastWashedAnchor(
  data: ProjectData,
  floor: string,
  scope: ScopePoint[],
  workerId?: string | null,
): { x: number; y: number } | null {
  const onFloor = new Map<string, ScopePoint>();
  for (const p of scope) if (p.floor === floor) onFloor.set(p.key, p);
  const washedBy = data.washedBy || {};
  const scan = (ownerOnly: boolean): { x: number; y: number } | null => {
    for (const l of data.log) {
      if (l.status !== "pesty") continue;
      const p = onFloor.get(l.key);
      if (!p || p.status !== "pesty") continue;
      if (ownerOnly && washedBy[l.key] !== workerId) continue;
      return { x: p.x, y: p.y };
    }
    return null;
  };
  if (workerId) { const own = scan(true); if (own) return own; }
  return scan(false);
}

/** The floor of a worker's most recent wash among the given candidate floors, or
 *  null. Used in multi-floor open mode to keep each worker on the floor they were
 *  already working, so several workers spread across the open floors instead of
 *  all being pulled to the same one. */
function workerFloor(data: ProjectData, workerId: string, candidates: string[]): string | null {
  const washedBy = data.washedBy || {};
  const set = new Set(candidates);
  for (const l of data.log) {
    if (l.status !== "pesty") continue;
    if (washedBy[l.key] !== workerId) continue;
    const hash = l.key.indexOf("#");
    if (hash <= 0) continue;
    const f = l.key.slice(0, hash);
    if (set.has(f)) return f;
  }
  return null;
}

/** Nearest-neighbor order from an anchor: kesken-first (never abandon a started
 *  window), then nearest by squared distance, then a stable y/x/key tiebreak —
 *  so the worker is sent to the adjacent window, not across the building. */
function nearestOrder(a: ScopePoint, b: ScopePoint, anchor: { x: number; y: number }): number {
  const ak = a.status === "kesken" ? 0 : 1;
  const bk = b.status === "kesken" ? 0 : 1;
  if (ak !== bk) return ak - bk;
  const da = dist2(a.x, a.y, anchor.x, anchor.y);
  const db = dist2(b.x, b.y, anchor.x, anchor.y);
  if (da !== db) return da - db;
  return sweepOrder(a, b);
}

/**
 * Derive the full guided-progression state from a project. Pure and cheap — safe
 * to call per request. With `guided` absent or disabled the result is a disabled
 * state (activeFloor null, nothing locked) and the washing gate stays open.
 */
export function computeGuided(data: ProjectData, opts?: { anchorWorkerId?: string | null }): GuidedState {
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

  // ── The OPEN SET of floors ──────────────────────────────────────────────────
  // MULTI mode: the founder has explicitly opened one or more floors → EXACTLY
  // those are open, everything else locked, no auto-advance (the founder opens
  // the next floors when ready). LEGACY mode (openFloors empty): a single active
  // floor that auto-advances, optionally pinned by activeFloorOverride.
  const openSel = Array.isArray(data.guided?.openFloors)
    ? floors.filter((f) => data.guided!.openFloors!.includes(f))   // building order, valid only
    : [];
  let activeFloors: string[];
  let overrideActive = false;
  if (!enabled) {
    activeFloors = [];
  } else if (openSel.length) {
    activeFloors = openSel;
  } else {
    const override = data.guided?.activeFloorOverride ?? null;
    const overrideValid =
      !!override &&
      floors.includes(override) &&
      (() => { const t = byFloor.get(override); return !!t && t.inScope > 0 && t.washed < t.inScope; })();
    overrideActive = overrideValid;
    const single = overrideValid ? override! : firstIncomplete;
    activeFloors = single ? [single] : [];
  }
  const activeSet = new Set(activeFloors);

  const floorProgress: GuidedFloorProgress[] = floors.map((f) => {
    const t = byFloor.get(f)!;
    const remaining = t.inScope - t.washed;
    const active = enabled && activeSet.has(f);
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

  // The floor THIS worker is guided to: an open floor that still has work,
  // preferring the worker's own most-recent wash floor so several workers on
  // different open floors each stay in their area (and one worker finishes a
  // floor before moving to the next open one).
  const openWithWork = activeFloors.filter((f) => {
    const t = byFloor.get(f)!;
    return t.inScope - t.washed > 0;
  });
  let guideFloor: string | null = null;
  if (enabled && openWithWork.length) {
    const wf = opts?.anchorWorkerId ? workerFloor(data, opts.anchorWorkerId, openWithWork) : null;
    guideFloor = wf ?? openWithWork[0];
  }
  const activeFloor = guideFloor;

  // Open keys + the next window, from the guide floor's unwashed windows.
  // Efficiency: guide to the window PHYSICALLY NEAREST the one the worker just
  // finished on this floor — not the top-left corner — so they move to the
  // adjacent window instead of being thrown across the building. The anchor is
  // the most recently washed in-scope window on the floor; with nothing washed
  // yet we start at the top-left corner (sweepOrder). Started (kesken) win.
  let openKeys: string[] = [];
  let next: GuidedNext | null = null;
  if (enabled && guideFloor) {
    const onActive = pts.filter((p) => p.floor === guideFloor && p.status !== "pesty");
    const anchor = lastWashedAnchor(data, guideFloor, pts, opts?.anchorWorkerId);
    const ordered = anchor
      ? onActive.slice().sort((a, b) => nearestOrder(a, b, anchor))
      : onActive.slice().sort(sweepOrder);
    openKeys = ordered.map((p) => p.key);
    if (ordered.length) {
      const n = ordered[0];
      next = { key: n.key, floor: n.floor, p: n.p, x: n.x, y: n.y, status: n.status };
    }
  }

  const remainingOnActive = guideFloor ? (byFloor.get(guideFloor)!.inScope - byFloor.get(guideFloor)!.washed) : 0;

  return {
    enabled,
    activeFloor,
    activeFloors,
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
 * The caller applies no P2 price gate any more (yellows are always washable) and
 * always allows clearing a status back to "ei".
 */
export function isGuidedBlocked(data: ProjectData, key: string): boolean {
  // Yksittäinen lukko ENSIN: se pätee riippumatta siitä onko ohjattu eteneminen
  // päällä. Muuten yhden ikkunan piilottaminen vaatisi koko järjestelmän
  // kytkemisen, mikä muuttaisi jokaisen kerroksen käyttäytymisen kerralla.
  if (isWindowLocked(data, key)) return true;
  if (data.guided?.enabled !== true) return false;
  const g = computeGuided(data);
  if (!g.activeFloors.length) return false;   // nothing open / all in-scope done
  const hash = key.indexOf("#");
  if (hash <= 0) return false;
  const floor = key.slice(0, hash);
  return !g.activeFloors.includes(floor);      // washable only on an OPEN floor
}

// ─── Sanitisation (server-side validation) ─────────────────────────────────────

/** Sanitize an incoming guided-work object so a bad client/blob can't corrupt it. */
export function sanitizeGuidedWork(input: any): GuidedWork | undefined {
  if (!input || typeof input !== "object") return undefined;
  const override = input.activeFloorOverride;
  const rawOpen = input.openFloors;
  const openFloors = Array.isArray(rawOpen)
    ? Array.from(new Set(
        rawOpen.filter((f: any) => typeof f === "string" && f.trim()).map((f: string) => f.slice(0, 8)),
      )).slice(0, 32)
    : [];
  const rawLocked = input.lockedKeys;
  // Sama muoto ja rajat kuin muualla avaimilla: enintään 64 merkkiä, ei
  // duplikaatteja. Yläraja on karkea suoja rikkinäistä clienttiä vastaan, ei
  // tuotepäätös — 4000 lukittua ikkunaa on enemmän kuin yhdessäkään keikassa.
  const lockedKeys = Array.isArray(rawLocked)
    ? Array.from(new Set(
        rawLocked.filter((k: any) => typeof k === "string" && k.trim()).map((k: string) => k.slice(0, 64)),
      )).slice(0, 4000)
    : [];
  return {
    enabled: input.enabled === true,
    activeFloorOverride:
      typeof override === "string" && override.trim() ? override.slice(0, 8) : null,
    openFloors,
    lockedKeys,
  };
}
