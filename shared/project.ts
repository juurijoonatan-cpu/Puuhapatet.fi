/**
 * Project / floor-plan window-washing tool — shared by client and server.
 *
 * This is the persistent model behind the FR8 "projektinäkymä" (the floor-plan
 * mapping, dashboard and work-hours tool that used to live as a localStorage-only
 * Next.js prototype in `fr8-ikkunat/`). It is stored as JSON in `jobs.projectData`
 * so nothing gets lost, and it adds worker attribution on top of the original
 * prototype so we can show per-worker window counts and €/h optimisation.
 *
 * Window identity: a key is `"<floor>#<index>"` for a seeded mark, or
 * `"<floor>#c<rand>"` for a custom (manually added) mark — same scheme the
 * prototype used, so the dot positions and logic stay identical.
 */

import type { GigData, GigSector } from "./gig";

// ─── Data shapes ───────────────────────────────────────────────────────────────

export type WindowStatus = "ei" | "kesken" | "pesty";

export interface ProjMark { p: 1 | 2; x: number; y: number; }
export interface ProjFloorData { marks: ProjMark[]; }
export type ProjMarksData = Record<string, ProjFloorData>;

export interface ProjCustomMark { key: string; p: 1 | 2; x: number; y: number; }

export interface ProjLogEntry {
  floor: string;
  key: string;
  p: 1 | 2;
  status: WindowStatus;
  ts: number;            // epoch ms
  by?: string;           // worker id who logged it
}

export interface ProjHourEntry {
  worker: string;        // worker id ("matias" | "joonatan" | …)
  delta: number;         // hours added (may be negative)
  ts: number;            // epoch ms
  by?: string;           // who recorded it
}

export interface ProjBuilding {
  name?: string;         // "FR8 — VANHA TKK"
  address?: string;      // "Bulevardi 31"
  floors: string[];      // ["K","1","2","3","4","5"]
  planBase?: string;     // image base path, e.g. "/fr8/plans/bp-" → bp-K.png
}

export interface ProjectData {
  version: 1;
  building: ProjBuilding;
  pricePerWindow: number;                          // euros per washed window
  marks: ProjMarksData;                            // seeded base marks (persisted)
  statuses: Record<string, WindowStatus>;          // key → status (non-"ei" only)
  washedBy: Record<string, string>;                // key → worker id who last washed it
  customMarks: Record<string, ProjCustomMark[]>;   // floor → manually added marks
  posOverrides: Record<string, { x: number; y: number }>; // key → moved position
  deleted: Record<string, boolean>;                // key → true if seeded mark removed
  log: ProjLogEntry[];                             // newest-first
  hours: Record<string, number>;                   // worker id → total hours
  hourLog: ProjHourEntry[];                         // newest-first
  workers: string[];                                // worker ids shown in hours view
  updatedAt: number;                                // epoch ms
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_FLOORS = ["K", "1", "2", "3", "4", "5"];
export const DEFAULT_PRICE_PER_WINDOW = 35;
export const PLAN_BASE = "/fr8/plans/bp-";

export function emptyProjectData(): ProjectData {
  return {
    version: 1,
    building: {
      name: "FR8 — VANHA TKK",
      address: "Bulevardi 31",
      floors: [...DEFAULT_FLOORS],
      planBase: PLAN_BASE,
    },
    pricePerWindow: DEFAULT_PRICE_PER_WINDOW,
    marks: {},
    statuses: {},
    washedBy: {},
    customMarks: {},
    posOverrides: {},
    deleted: {},
    log: [],
    hours: {},
    hourLog: [],
    workers: ["matias", "joonatan"],
    updatedAt: Date.now(),
  };
}

// ─── Window enumeration ────────────────────────────────────────────────────────

export interface ProjPoint {
  floor: string;
  key: string;
  p: 1 | 2;
  status: WindowStatus;
  washedBy?: string;
}

/** Flatten all live (non-deleted) windows across floors, with current status. */
export function allPoints(data: ProjectData): ProjPoint[] {
  const out: ProjPoint[] = [];
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  for (const f of floors) {
    (data.marks[f]?.marks || []).forEach((mk, idx) => {
      const key = `${f}#${idx}`;
      if (!data.deleted[key]) {
        out.push({ floor: f, key, p: mk.p, status: data.statuses[key] || "ei", washedBy: data.washedBy[key] });
      }
    });
    (data.customMarks[f] || []).forEach((cm) => {
      if (!data.deleted[cm.key]) {
        out.push({ floor: f, key: cm.key, p: cm.p, status: data.statuses[cm.key] || "ei", washedBy: data.washedBy[cm.key] });
      }
    });
  }
  return out;
}

// ─── Calculations ──────────────────────────────────────────────────────────────

export interface ProjTotals {
  total: number;
  washed: number;
  kesken: number;
  unwashed: number;
  pct: number;            // 0..100
  revenueCents: number;   // washed × price
  contractCents: number;  // total × price
}

export function computeProjectTotals(data: ProjectData): ProjTotals {
  const pts = allPoints(data);
  const total = pts.length;
  const washed = pts.filter((p) => p.status === "pesty").length;
  const kesken = pts.filter((p) => p.status === "kesken").length;
  const unwashed = total - washed - kesken;
  const price = data.pricePerWindow || DEFAULT_PRICE_PER_WINDOW;
  return {
    total,
    washed,
    kesken,
    unwashed,
    pct: total > 0 ? (washed / total) * 100 : 0,
    revenueCents: Math.round(washed * price * 100),
    contractCents: Math.round(total * price * 100),
  };
}

export interface WorkerStat {
  worker: string;
  washed: number;          // windows washed (attributed)
  revenueCents: number;    // washed × price
  hours: number;           // logged hours
  windowsPerHour: number;  // washed / hours (0 if no hours)
  eurPerHour: number;      // euros earned / hours (work-hour optimisation)
}

/**
 * Per-worker optimisation stats: how many windows each worker has washed,
 * how many hours they've logged, and the resulting throughput (windows/h and €/h).
 */
export function computeWorkerStats(data: ProjectData): WorkerStat[] {
  const pts = allPoints(data);
  const price = data.pricePerWindow || DEFAULT_PRICE_PER_WINDOW;
  // Union of configured workers + anyone who appears in attribution / hours.
  const ids = new Set<string>(data.workers || []);
  pts.forEach((p) => { if (p.status === "pesty" && p.washedBy) ids.add(p.washedBy); });
  Object.keys(data.hours || {}).forEach((w) => ids.add(w));
  return Array.from(ids).map((worker) => {
    const washed = pts.filter((p) => p.status === "pesty" && p.washedBy === worker).length;
    const hours = Math.max(0, data.hours?.[worker] || 0);
    const revenueCents = Math.round(washed * price * 100);
    return {
      worker,
      washed,
      revenueCents,
      hours,
      windowsPerHour: hours > 0 ? washed / hours : 0,
      eurPerHour: hours > 0 ? revenueCents / 100 / hours : 0,
    };
  });
}

// ─── Efficiency / pace analytics ───────────────────────────────────────────────

export interface GigEfficiency {
  total: number;
  washed: number;
  kesken: number;
  remaining: number;          // total − washed
  pct: number;                // 0..100 by window count
  revenueCents: number;       // washed × price
  contractCents: number;      // total × price
  remainingCents: number;     // remaining × price (still to earn)
  todayWashed: number;        // windows marked pesty today (from log)
  weekWashed: number;         // …in the last 7 days
  activeDays: number;         // distinct calendar days with a pesty event
  loggedWashed: number;       // pesty events retained in the (capped) log — pace basis
  perDay: number;             // average washed per active day
  etaWorkingDays: number | null; // working days left at current pace (null if no pace)
  bestDay: { ts: number; count: number } | null;
  totalHours: number;
  eurPerHour: number;         // revenue / total hours
  windowsPerHour: number;     // washed / total hours
}

/** Local YYYY-MM-DD key for grouping log events by calendar day. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Derive pace / projection stats for a project so the gig-tools "Tehokkuus"
 * view can show throughput and an ETA. Pace is based on the retained activity
 * log (capped), so it is an estimate — the long-running totals (washed, revenue)
 * come from the authoritative window set.
 */
export function computeEfficiency(data: ProjectData): GigEfficiency {
  const totals = computeProjectTotals(data);
  const price = data.pricePerWindow || DEFAULT_PRICE_PER_WINDOW;

  // Group pesty events by calendar day from the activity log.
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86400_000;
  const byDay = new Map<string, { ts: number; count: number }>();
  let todayWashed = 0, weekWashed = 0, loggedWashed = 0;
  const seenKeysPerDay = new Map<string, Set<string>>();

  for (const l of data.log) {
    if (l.status !== "pesty") continue;
    const k = dayKey(l.ts);
    // Count each window once per day to avoid double-counting status flips.
    let seen = seenKeysPerDay.get(k);
    if (!seen) { seen = new Set(); seenKeysPerDay.set(k, seen); }
    if (seen.has(l.key)) continue;
    seen.add(l.key);
    loggedWashed += 1;
    const entry = byDay.get(k) || { ts: l.ts, count: 0 };
    entry.count += 1;
    entry.ts = Math.min(entry.ts, l.ts);
    byDay.set(k, entry);
    if (l.ts >= startToday.getTime()) todayWashed += 1;
    if (l.ts >= weekAgo) weekWashed += 1;
  }

  const activeDays = byDay.size;
  const perDay = activeDays > 0 ? loggedWashed / activeDays : 0;
  const remaining = totals.total - totals.washed;
  const etaWorkingDays = perDay > 0 && remaining > 0 ? Math.ceil(remaining / perDay) : (remaining === 0 ? 0 : null);

  let bestDay: { ts: number; count: number } | null = null;
  Array.from(byDay.values()).forEach((v) => { if (!bestDay || v.count > bestDay.count) bestDay = v; });

  const totalHours = Object.values(data.hours || {}).reduce((a, h) => a + Math.max(0, h || 0), 0);

  return {
    total: totals.total,
    washed: totals.washed,
    kesken: totals.kesken,
    remaining,
    pct: totals.pct,
    revenueCents: totals.revenueCents,
    contractCents: totals.contractCents,
    remainingCents: Math.round(remaining * price * 100),
    todayWashed,
    weekWashed,
    activeDays,
    loggedWashed,
    perDay,
    etaWorkingDays,
    bestDay,
    totalHours,
    eurPerHour: totalHours > 0 ? totals.revenueCents / 100 / totalHours : 0,
    windowsPerHour: totalHours > 0 ? totals.washed / totalHours : 0,
  };
}

// ─── Gig billing sync (FR8 toolkit = source of truth) ──────────────────────────

const GIG_FLOOR_PALETTE = ["#D9472B", "#DFA614", "#1F3B57", "#3E7C59", "#7A4FA3", "#C2557A"];

function gigFloorName(f: string): string {
  if (f === "K") return "Kellari";
  return `${f}. kerros`;
}

/**
 * Derive a gig's billing sectors from the floor-plan window project so the FR8
 * toolkit is the single source of truth for progress and money. One sector per
 * floor: `total` = live windows on the floor, `washed` = windows marked "pesty",
 * unit price = the project's price per window. Per-floor `invoicedWashed` is
 * preserved (matched by sector id) so the existing invoicing pipeline keeps
 * working unchanged, and gig metadata (company, invoices, notes, log) is left
 * untouched.
 */
export function syncGigSectorsFromProject(gig: GigData, project: ProjectData): GigData {
  const floors = project.building.floors.length ? project.building.floors : DEFAULT_FLOORS;
  const unitPriceCents = Math.round((project.pricePerWindow || DEFAULT_PRICE_PER_WINDOW) * 100);
  const pts = allPoints(project);
  const prevById = new Map(gig.sectors.map((s) => [s.id, s]));

  const sectors: GigSector[] = floors.map((f, i) => {
    const onFloor = pts.filter((p) => p.floor === f);
    const total = onFloor.length;
    const washed = onFloor.filter((p) => p.status === "pesty").length;
    const id = `floor:${f}`;
    const prevInvoiced = Math.max(0, prevById.get(id)?.invoicedWashed ?? 0);
    return {
      id,
      name: gigFloorName(f),
      color: GIG_FLOOR_PALETTE[i % GIG_FLOOR_PALETTE.length],
      unitLabel: "ikkuna",
      total,
      unitPriceCents,
      washed,
      skipped: 0,
      invoicedWashed: Math.min(washed, prevInvoiced),
      priority: i + 1,
    };
  });

  return { ...gig, sectors, updatedAt: Date.now() };
}

// ─── Sanitisation (server-side validation) ─────────────────────────────────────

function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
function toPriority(v: any): 1 | 2 {
  return Number(v) === 2 ? 2 : 1;
}
function toStatus(v: any): WindowStatus {
  return v === "pesty" || v === "kesken" ? v : "ei";
}
function cleanKey(v: any): string {
  return String(v ?? "").slice(0, 64);
}

/** Sanitize an incoming projectData object so a bad client can't corrupt the DB. */
export function sanitizeProjectData(input: any): ProjectData {
  const base = emptyProjectData();
  if (!input || typeof input !== "object") return base;

  const floors: string[] = Array.isArray(input?.building?.floors) && input.building.floors.length
    ? input.building.floors.slice(0, 40).map((f: any) => String(f).slice(0, 8))
    : [...DEFAULT_FLOORS];

  const marks: ProjMarksData = {};
  if (input.marks && typeof input.marks === "object") {
    for (const f of Object.keys(input.marks).slice(0, 40)) {
      const arr = Array.isArray(input.marks[f]?.marks) ? input.marks[f].marks : [];
      marks[String(f).slice(0, 8)] = {
        marks: arr.slice(0, 2000).map((m: any) => ({
          p: toPriority(m?.p),
          x: clampPct(Number(m?.x)),
          y: clampPct(Number(m?.y)),
        })),
      };
    }
  }

  const customMarks: Record<string, ProjCustomMark[]> = {};
  if (input.customMarks && typeof input.customMarks === "object") {
    for (const f of Object.keys(input.customMarks).slice(0, 40)) {
      const arr = Array.isArray(input.customMarks[f]) ? input.customMarks[f] : [];
      customMarks[String(f).slice(0, 8)] = arr.slice(0, 2000).map((c: any) => ({
        key: cleanKey(c?.key),
        p: toPriority(c?.p),
        x: clampPct(Number(c?.x)),
        y: clampPct(Number(c?.y)),
      })).filter((c: ProjCustomMark) => c.key);
    }
  }

  const statuses: Record<string, WindowStatus> = {};
  if (input.statuses && typeof input.statuses === "object") {
    for (const k of Object.keys(input.statuses).slice(0, 20000)) {
      const s = toStatus(input.statuses[k]);
      if (s !== "ei") statuses[cleanKey(k)] = s;
    }
  }

  const washedBy: Record<string, string> = {};
  if (input.washedBy && typeof input.washedBy === "object") {
    for (const k of Object.keys(input.washedBy).slice(0, 20000)) {
      const v = input.washedBy[k];
      if (v) washedBy[cleanKey(k)] = String(v).slice(0, 40);
    }
  }

  const posOverrides: Record<string, { x: number; y: number }> = {};
  if (input.posOverrides && typeof input.posOverrides === "object") {
    for (const k of Object.keys(input.posOverrides).slice(0, 20000)) {
      const o = input.posOverrides[k];
      if (o && typeof o === "object") {
        posOverrides[cleanKey(k)] = { x: clampPct(Number(o.x)), y: clampPct(Number(o.y)) };
      }
    }
  }

  const deleted: Record<string, boolean> = {};
  if (input.deleted && typeof input.deleted === "object") {
    for (const k of Object.keys(input.deleted).slice(0, 20000)) {
      if (input.deleted[k]) deleted[cleanKey(k)] = true;
    }
  }

  const log: ProjLogEntry[] = Array.isArray(input.log)
    ? input.log.slice(0, 200).map((l: any) => ({
        floor: String(l?.floor ?? "").slice(0, 8),
        key: cleanKey(l?.key),
        p: toPriority(l?.p),
        status: toStatus(l?.status),
        ts: Number(l?.ts) || Date.now(),
        by: l?.by ? String(l.by).slice(0, 40) : undefined,
      }))
    : [];

  const hours: Record<string, number> = {};
  if (input.hours && typeof input.hours === "object") {
    for (const w of Object.keys(input.hours).slice(0, 40)) {
      hours[String(w).slice(0, 40)] = Math.round(clampNonNeg(Number(input.hours[w])) * 100) / 100;
    }
  }

  const hourLog: ProjHourEntry[] = Array.isArray(input.hourLog)
    ? input.hourLog.slice(0, 200).map((h: any) => ({
        worker: String(h?.worker ?? "").slice(0, 40),
        delta: Math.round((Number(h?.delta) || 0) * 100) / 100,
        ts: Number(h?.ts) || Date.now(),
        by: h?.by ? String(h.by).slice(0, 40) : undefined,
      })).filter((h: ProjHourEntry) => h.worker)
    : [];

  const workers: string[] = Array.isArray(input.workers) && input.workers.length
    ? Array.from(new Set(input.workers.slice(0, 40).map((w: any) => String(w).slice(0, 40)))) as string[]
    : [...base.workers];

  return {
    version: 1,
    building: {
      name: input?.building?.name ? String(input.building.name).slice(0, 120) : base.building.name,
      address: input?.building?.address ? String(input.building.address).slice(0, 200) : base.building.address,
      floors,
      planBase: input?.building?.planBase ? String(input.building.planBase).slice(0, 200) : PLAN_BASE,
    },
    pricePerWindow: clampNonNeg(Number(input.pricePerWindow)) || DEFAULT_PRICE_PER_WINDOW,
    marks,
    statuses,
    washedBy,
    customMarks,
    posOverrides,
    deleted,
    log,
    hours,
    hourLog,
    workers,
    updatedAt: Date.now(),
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function eurFromCents(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}
