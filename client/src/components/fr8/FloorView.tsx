/**
 * FR8 projektinäkymä — per-floor window map (ported from fr8-ikkunat prototype).
 * The dot positions, drag/add/delete and status logic are kept identical to the
 * prototype; only persistence (handled by the parent) and the plan image base
 * path differ.
 */
import { useState, useRef, useEffect } from "react";
import type { ProjMarksData, WindowStatus, ProjCustomMark, ProjMapNote, ProjNoteKind, ProjActiveZone, ProjWindowObservation, FixedDeal } from "@shared/project";
import { NOTE_KINDS } from "@shared/project";
import type { P2Offer } from "@shared/p2";
import { P2_PRICE_PRESETS_CENTS } from "@shared/p2";
import { useIsMobile } from "@/hooks/use-mobile";

const CIRC_S = 2 * Math.PI * 17; // mini ring

// Hard-crop the plan's outer edges so the stray white structure lines that bleed
// off the floor-plan image's sides are simply cut off (no fade). Applied to the
// plan image only, never the dots layer, so interior markers stay fully visible.
const PLAN_CROP = "inset(2%)";

interface Point { key: string; p: 1 | 2; x: number; y: number; }

interface Props {
  floors: string[];
  planBase: string;
  pricePerWindow: number;
  marks: ProjMarksData | null;
  statuses: Record<string, WindowStatus>;
  posOverrides: Record<string, { x: number; y: number }>;
  customMarks: Record<string, ProjCustomMark[]>;
  deleted: Record<string, boolean>;
  initialFloor: string;
  onStatusChange: (key: string, status: WindowStatus, washedById?: string) => void;
  onAddCustomMark: (floor: string, x: number, y: number, p: 1 | 2) => void;
  onDeleteMark: (key: string) => void;
  onMoveMark: (key: string, x: number, y: number) => void;
  onMoveMarkCommit: (key: string, x: number, y: number) => void;
  onResetFloor: (floor: string) => void;
  /** When false, hide the structural edit controls (move/add/delete) — workers
   *  can still set window status, but cannot restructure the map. Default true. */
  canEdit?: boolean;
  /** Allow adding/editing map notes (huomio, tikkaat, …) WITHOUT full edit rights.
   *  Lets workers leave simple markers while still not moving/deleting windows. */
  canAddNotes?: boolean;
  /** Hide all € figures on the map (worker view — they never see gig pricing). */
  hideMoney?: boolean;
  /** key → worker id who washed it (manager view). Enables the "who cleaned this"
   *  label in the status popover. Workers/customers don't pass this. */
  washedBy?: Record<string, string>;
  /** key → second washer id for a window done together (50/50 split). Manager view. */
  washedBy2?: Record<string, string>;
  /** Credit a washed window to a second worker (50/50), or clear it (null). Manager view. */
  onSetSplit?: (key: string, second: string | null) => void;
  /** key → worker id who marked it "kesken". */
  keskenBy?: Record<string, string>;
  /** worker id → display name, for the washedBy/keskenBy label. */
  workerNames?: Record<string, string>;
  /** This gig's pickable crew (id + name) for the washed-by picker. Manager view only. */
  workers?: { id: string; name: string }[];
  /** Logged-in user's worker id — default washer when marking a window washed. */
  currentWorkerId?: string;
  /** Navigation markers / notes per floor (ladders, entrances, hazards, …). */
  notes?: Record<string, ProjMapNote[]>;
  onAddNote?: (floor: string, x: number, y: number, kind: ProjNoteKind) => string | void;
  onUpdateNote?: (floor: string, key: string, text: string) => void;
  onDeleteNote?: (floor: string, key: string) => void;
  /** Per-window observations (text + optional photo), keyed by window key. */
  observations?: Record<string, ProjWindowObservation>;
  /** Allow leaving an observation on a window (worker/admin). */
  canObserve?: boolean;
  /** Persist an observation. Empty text + no image clears it. */
  onSetObservation?: (key: string, text: string, imageDataUrl?: string) => void;
  /** The single "work happening here now" highlight (shown to the customer too). */
  activeZone?: ProjActiveZone | null;
  onSetActiveZone?: (floor: string, x: number, y: number) => void;
  onClearActiveZone?: () => void;
  /** When set, the price is a locked, signed deal (no editing, billable priority
   *  + agreed cap drive the figures). FR8 = €37.50/red window, €6300 cap. */
  deal?: FixedDeal | null;
  /** P2 (keltaiset ikkunat) — per-window pricing state. Admin view passes the
   *  full offers map; the worker view passes only lockedKeys + its OWN
   *  payoutByKey (customer prices never reach a worker). Null/absent = no P2. */
  p2?: {
    enabled: boolean;
    offers?: Record<string, P2Offer>;
    lockedKeys?: string[];
    payoutByKey?: Record<string, number>;
  } | null;
  /** Admin: bulk price proposal for selected yellow windows — enables the
   *  "€ Hinnoittele" multi-select mode. */
  onP2Propose?: (keys: string[], priceCents: number) => void;
  /** Ohjattu eteneminen (guided): the open floor + which floors are locked + the
   *  single next window to wash. Drives the locked-floor tabs and the pulsing
   *  "next" ring. Null/absent = no guidance (map fully open). */
  guided?: {
    enabled: boolean;
    activeFloor: string | null;
    lockedFloors: string[];
    nextKey: string | null;
  } | null;
  /** Bump `nonce` to programmatically jump the map to `floor` (e.g. the worker's
   *  "Vie minut seuraavaan" button). */
  floorFocus?: { floor: string; nonce: number } | null;
}

/** A minimal on-screen anchor (viewport coords) for positioning a fixed popover. */
interface Anchor { left: number; top: number; width: number; bottom: number; }
function rectToAnchor(r: DOMRect): Anchor { return { left: r.left, top: r.top, width: r.width, bottom: r.bottom }; }
function pointAnchor(x: number, y: number): Anchor { return { left: x - 8, top: y - 8, width: 16, bottom: y + 8 }; }

/** Position a fixed popover near an on-screen anchor rect, flipping above/below
 *  and clamping to the viewport so its buttons are always fully visible/tappable. */
function fixedPopoverStyle(anchor: Anchor | null, width: number, height: number): React.CSSProperties {
  if (typeof window === "undefined" || !anchor) {
    return { position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: 1200 };
  }
  const margin = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = anchor.left + anchor.width / 2 - width / 2;
  left = Math.max(margin, Math.min(vw - width - margin, left));
  // Prefer above the anchor; flip below if there isn't room.
  let top = anchor.top - height - 12;
  if (top < margin) top = Math.min(vh - height - margin, anchor.bottom + 12);
  top = Math.max(margin, top);
  return { position: "fixed", left: `${left}px`, top: `${top}px`, zIndex: 1200 };
}

function colorRgb(p: 1 | 2, status: WindowStatus) {
  if (status === "pesty") return p === 1 ? "255,72,72" : "255,205,40";
  if (status === "kesken") return "188,150,255";
  return p === 1 ? "255,140,178" : "240,226,150";
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function euro(n: number) { return n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
/** Per-window price — keeps cents (e.g. "37,50 €") so 37.5 never rounds to 38. */
function euroUnit(n: number) {
  return n.toLocaleString("fi-FI", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + " €";
}

/** Count live (non-deleted) windows across every floor — the billable window
 *  count that drives the contract cap (count × price/window). */
function countAllLive(floors: string[], marks: ProjMarksData | null, customMarks: Record<string, ProjCustomMark[]>, deleted: Record<string, boolean>, onlyPriority?: 1 | 2): number {
  let n = 0;
  for (const f of floors) {
    (marks?.[f]?.marks || []).forEach((mk, idx) => { if (!deleted[`${f}#${idx}`] && (!onlyPriority || mk.p === onlyPriority)) n += 1; });
    (customMarks[f] || []).forEach((cm) => { if (!deleted[cm.key] && (!onlyPriority || cm.p === onlyPriority)) n += 1; });
  }
  return n;
}

function getPoints(floor: string, marks: ProjMarksData | null, posOverrides: Record<string, { x: number; y: number }>, customMarks: Record<string, ProjCustomMark[]>, deleted: Record<string, boolean>): Point[] {
  const out: Point[] = [];
  if (!marks) return out;
  (marks[floor]?.marks || []).forEach((mk, idx) => {
    const key = `${floor}#${idx}`;
    if (deleted[key]) return;
    const ov = posOverrides[key];
    out.push({ key, p: mk.p, x: ov ? ov.x : mk.x, y: ov ? ov.y : mk.y });
  });
  (customMarks[floor] || []).forEach((cm) => {
    if (deleted[cm.key]) return;
    const ov = posOverrides[cm.key];
    out.push({ key: cm.key, p: cm.p, x: ov ? ov.x : cm.x, y: ov ? ov.y : cm.y });
  });
  return out;
}

function floorBtnStyle(active: boolean): React.CSSProperties {
  return { minWidth: "34px", height: "34px", padding: "0 4px", borderRadius: "9px", border: "none", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "14px", fontWeight: active ? 700 : 600, background: active ? "#fff" : "transparent", color: active ? "#0a0a0c" : "rgba(255,255,255,0.55)", transition: "all .16s" };
}

function filterBtnStyle(active: boolean): React.CSSProperties {
  return { padding: "7px 13px", borderRadius: "10px", border: "none", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: active ? 600 : 500, background: active ? "rgba(255,255,255,0.92)" : "transparent", color: active ? "#0a0a0c" : "rgba(255,255,255,0.55)", transition: "all .15s" };
}

const zoomBtnStyle: React.CSSProperties = {
  width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: "8px", border: "none", cursor: "pointer", background: "transparent",
  color: "rgba(255,255,255,0.75)", fontSize: "16px", fontWeight: 600, lineHeight: 1,
  fontFamily: "var(--font-onest, system-ui, sans-serif)",
};

const LEGEND = [
  { label: "P1 pesemättä", rgb: "255,140,178" }, { label: "P2 pesemättä", rgb: "240,226,150" },
  { label: "Kesken", rgb: "188,150,255" }, { label: "P1 pesty", rgb: "255,72,72" }, { label: "P2 pesty", rgb: "255,205,40" },
];

const FILTERS = [
  { id: "all", label: "Kaikki" }, { id: "unwashed", label: "Pesemättä" },
  { id: "progress", label: "Kesken" }, { id: "done", label: "Pesty" },
] as const;

type PlaceMode = 1 | 2 | "del";
const ADD_ITEMS: { id: PlaceMode; label: string; desc: string; dotBg: string; glyph: string }[] = [
  { id: 1, label: "Punainen piste", desc: "Prioriteetti 1", dotBg: "radial-gradient(circle at 35% 30%, #fff, rgb(255,140,178) 55%)", glyph: "" },
  { id: 2, label: "Keltainen piste", desc: "Prioriteetti 2", dotBg: "radial-gradient(circle at 35% 30%, #fff, rgb(240,226,150) 55%)", glyph: "" },
  { id: "del", label: "Poista piste", desc: "Klikkaa poistettavaa", dotBg: "rgba(255,90,90,0.16)", glyph: "✕" },
];

export default function FloorView({ floors, planBase, pricePerWindow, marks, statuses, posOverrides, customMarks, deleted, initialFloor, onStatusChange, onAddCustomMark, onDeleteMark, onMoveMark, onMoveMarkCommit, onResetFloor, canEdit = true, canAddNotes = false, hideMoney = false, washedBy, washedBy2, onSetSplit, keskenBy, workerNames, workers, currentWorkerId, notes, onAddNote, onUpdateNote, onDeleteNote, observations, canObserve = false, onSetObservation, activeZone, onSetActiveZone, onClearActiveZone, deal, p2, onP2Propose, guided, floorFocus }: Props) {
  const [floor, setFloor] = useState(initialFloor);
  const [filter, setFilter] = useState<"all" | "unwashed" | "progress" | "done">("all");
  const [editMode, setEditMode] = useState(false);
  const [placeMode, setPlaceMode] = useState<1 | 2 | "del" | "note" | "zone" | null>(null);
  const [noteKind, setNoteKind] = useState<ProjNoteKind>("ladder");
  const [dragging, setDragging] = useState<string | null>(null);
  const [activeOrb, setActiveOrb] = useState<string | null>(null);
  const [orbAnchor, setOrbAnchor] = useState<Anchor | null>(null);
  const [showWasherPicker, setShowWasherPicker] = useState(false);
  const [showSplitPicker, setShowSplitPicker] = useState(false);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [noteAnchor, setNoteAnchor] = useState<Anchor | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  // Per-window observation editor (text + optional photo) inside the status popover.
  const [obsDraft, setObsDraft] = useState("");
  const [obsImage, setObsImage] = useState<string | undefined>(undefined);
  const [obsBusy, setObsBusy] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // P2 multi-select pricing (admin): tap yellow dots to select, then propose one
  // price for the whole selection.
  const [p2SelectMode, setP2SelectMode] = useState(false);
  const [p2Selected, setP2Selected] = useState<Set<string>>(new Set());
  const [p2Price, setP2Price] = useState("");
  const planRef = useRef<HTMLImageElement>(null);
  const notesCanEdit = !!onAddNote;
  const zoneCanEdit = !!onSetActiveZone;
  const dragKeyRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const isMobile = useIsMobile();

  // Zoom & pan (so tiny dots are tappable on phones). The plan + orbs share one
  // transformed wrapper, so the dot %-coordinate math (which reads the image's
  // post-transform rect) stays correct at any zoom.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const sceneRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const pannedRef = useRef(false);
  const clampZoom = (z: number) => Math.min(5, Math.max(1, z));

  // Keep the plan from being dragged past its own edges, so the hard edge lines /
  // background gaps never appear at the sides when zoomed. Pan is bounded to the
  // overflow of the scaled image over the visible scene; when the image is not
  // larger than the scene it stays locked to centre.
  const clampPan = (p: { x: number; y: number }, z: number) => {
    const scene = sceneRef.current, img = planRef.current;
    if (!scene || !img) return p;
    const maxX = Math.max(0, (img.offsetWidth * z - scene.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * z - scene.clientHeight) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  };
  const zoomBy = (factor: number) => setZoom((z) => {
    const nz = clampZoom(z * factor);
    setPan((p) => (nz === 1 ? { x: 0, y: 0 } : clampPan(p, nz)));
    return nz;
  });
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Reset zoom/pan when switching floors.
  useEffect(() => { resetView(); }, [floor]);

  // Ohjattu eteneminen: kun "Vie minut seuraavaan" -nappia painetaan (nonce
  // kasvaa), hypätään aktiiviselle kerrokselle ja suljetaan avoin popover.
  useEffect(() => {
    if (floorFocus && floorFocus.floor && floors.includes(floorFocus.floor)) {
      setFloor(floorFocus.floor);
      setActiveOrb(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorFocus?.nonce]);

  function touchDist(t: React.TouchList) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }
  function onSceneWheel(e: React.WheelEvent) {
    if (editMode) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }
  function onSceneTouchStart(e: React.TouchEvent) {
    if (editMode) return;
    if (e.touches.length === 2) { pinchRef.current = touchDist(e.touches); panRef.current = null; }
    else if (e.touches.length === 1 && zoom > 1) {
      const p = e.touches[0];
      panRef.current = { x: p.clientX, y: p.clientY, px: pan.x, py: pan.y };
      pannedRef.current = false;
    }
  }
  function onSceneTouchMove(e: React.TouchEvent) {
    if (editMode) return;
    if (e.touches.length === 2 && pinchRef.current != null) {
      e.preventDefault();
      const d = touchDist(e.touches);
      zoomBy(d / pinchRef.current);
      pinchRef.current = d;
    } else if (panRef.current && e.touches.length === 1) {
      e.preventDefault();
      const p = e.touches[0];
      setPan(clampPan({ x: panRef.current.px + (p.clientX - panRef.current.x), y: panRef.current.py + (p.clientY - panRef.current.y) }, zoom));
      pannedRef.current = true;
    }
  }
  function onSceneTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 0) { pinchRef.current = null; panRef.current = null; }
  }

  const points = getPoints(floor, marks, posOverrides, customMarks, deleted);

  // ── P2 (keltaiset ikkunat) helpers ──────────────────────────────────────────
  const p2OfferFor = (key: string): P2Offer | undefined => p2?.offers?.[key];
  /** Is this yellow window part of the locked P2 work scope? Admin resolves from
   *  the offers map, the worker from its lockedKeys list. */
  const p2LockedForWork = (key: string): boolean => {
    if (!p2 || !p2.enabled) return false;
    if (p2.offers) return p2.offers[key]?.status === "locked";
    return (p2.lockedKeys || []).includes(key);
  };
  /** Worker view: yellow windows are gated (not washable) until locked. */
  const p2WorkerGated = (pt: Point): boolean =>
    !canEdit && !!p2 && pt.p === 2 && !p2LockedForWork(pt.key);
  const floorYellowUnpriced = points.filter((pt) => pt.p === 2 && !p2OfferFor(pt.key));
  const p2PriceCents = (() => {
    const v = Number(p2Price.replace(",", "."));
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  })();

  function toggleP2Select(key: string) {
    setP2Selected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleP2SelectMode() {
    setP2SelectMode((v) => !v);
    setP2Selected(new Set());
    setEditMode(false); setPlaceMode(null); setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null);
  }

  // Floor revenue: with a signed deal only the billable priority (red) counts.
  const floorBillable = deal ? points.filter((p) => p.p === deal.billablePriority) : points;
  const floorWashed = floorBillable.filter((p) => (statuses[p.key] || "ei") === "pesty").length;
  const floorTotal = floorBillable.length;
  const floorPct = floorTotal > 0 ? (floorWashed / floorTotal) * 100 : 0;
  // Whole-contract billable window count (every floor) → drives the price cap.
  const totalLive = countAllLive(floors, marks, customMarks, deleted, deal?.billablePriority);
  // A signed deal has a fixed agreed cap; an open gig's cap is count × price.
  const capEur = deal ? deal.capCents / 100 : totalLive * pricePerWindow;
  const activePt = activeOrb ? points.find((p) => p.key === activeOrb) ?? null : null;
  const activeIdx = activePt ? points.indexOf(activePt) : -1;
  const floorNotes = notes?.[floor] || [];
  const activeNoteObj = activeNote ? floorNotes.find((n) => n.key === activeNote) ?? null : null;

  function matchFilter(status: WindowStatus) {
    if (filter === "all") return true;
    if (filter === "unwashed") return status === "ei";
    if (filter === "progress") return status === "kesken";
    if (filter === "done") return status === "pesty";
    return true;
  }

  function orbStyle(pt: Point, status: WindowStatus, isDragging: boolean): React.CSSProperties {
    const rgb = colorRgb(pt.p, status);
    const washed = status === "pesty";
    const soft = status === "ei";
    const delMode = editMode && placeMode === "del";
    const addMode = editMode && (placeMode === 1 || placeMode === 2);
    const dim = editMode ? false : !matchFilter(status);
    // P2 select mode: red dots fade out, selected yellows get a white ring.
    const p2Selectable = p2SelectMode && pt.p === 2;
    const p2IsSelected = p2Selectable && p2Selected.has(pt.key);
    const size = editMode ? (washed ? 13 : 12) : (washed ? 10 : 9);
    const base: React.CSSProperties = {
      position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
      transform: "translate(-50%,-50%)", width: `${size}px`, height: `${size}px`,
      borderRadius: "50%", padding: 0,
      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(${rgb},0.95) 45%, rgba(${rgb},0.72))`,
      border: editMode ? "1.5px solid rgba(255,255,255,0.9)" : "1px solid rgba(255,255,255,0.45)",
      color: `rgba(${rgb},0.9)`,
      cursor: delMode ? "pointer" : (editMode ? (isDragging ? "grabbing" : "grab") : "pointer"),
      zIndex: isDragging ? 35 : (dim ? 2 : 6),
      opacity: dim ? 0.08 : 1,
      pointerEvents: (dim || addMode) ? "none" : "auto",
      touchAction: "none",
      transition: isDragging ? "none" : "opacity .3s, transform .15s, box-shadow .2s",
    };
    // The pulsing glow is pretty on desktop but murders phone performance: an
    // FR8 floor has hundreds of unwashed dots, and that many infinite CSS
    // animations inside a scaled/panned layer makes the whole PWA stutter. On
    // mobile we use a static glow instead — smooth scrolling beats a pulse.
    if (soft && !editMode && !isMobile) {
      base.animation = "fr8-orbPulse 3.2s ease-in-out infinite";
    } else {
      base.boxShadow = isDragging
        ? `0 0 0 3px rgba(255,255,255,0.35), 0 0 14px rgba(${rgb},0.9)`
        : washed ? `0 0 6px rgba(${rgb},0.95), 0 0 13px rgba(${rgb},0.5)` : `0 0 5px rgba(${rgb},0.7), 0 0 11px rgba(${rgb},0.35)`;
    }
    // P2 select mode overrides: fade the non-selectable reds, ring the selection.
    if (p2SelectMode) {
      if (pt.p !== 2) {
        base.opacity = 0.12;
        base.pointerEvents = "none";
        base.animation = undefined;
      } else if (p2IsSelected) {
        base.boxShadow = `0 0 0 3.5px rgba(255,255,255,0.95), 0 0 14px rgba(${rgb},0.9)`;
        base.animation = undefined;
        base.zIndex = 12;
      }
    }
    // Worker view: an unlocked yellow window is not in the work scope yet.
    if (p2WorkerGated(pt)) {
      base.opacity = Math.min(Number(base.opacity ?? 1), 0.35);
      base.animation = undefined;
    }
    return base;
  }

  function onOrbClick(pt: Point, e: React.MouseEvent) {
    e.stopPropagation();
    // Ignore the click that ends a pan gesture (so panning never toggles a dot).
    if (pannedRef.current) { pannedRef.current = false; return; }
    // P2 pricing mode: tapping a yellow dot toggles its selection (locked ones
    // are skipped — a locked price is renegotiated via unlock, not re-propose).
    if (p2SelectMode) {
      if (pt.p !== 2) return;
      if (p2OfferFor(pt.key)?.status === "locked") return;
      toggleP2Select(pt.key);
      return;
    }
    if (editMode && placeMode === "del") { onDeleteMark(pt.key); return; }
    if (!editMode) {
      const next = activeOrb === pt.key ? null : pt.key;
      // Capture the dot's on-screen position so the status popover renders as a
      // fixed overlay (never clipped by the zoom/pan scene) and stays tappable.
      setOrbAnchor(next ? rectToAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) : null);
      setActiveNote(null);
      setShowWasherPicker(false); // names stay hidden until "Vaihda" is tapped
      setShowSplitPicker(false);
      // Load any existing observation for this window into the editor.
      const ex = next ? observations?.[next] : undefined;
      setObsDraft(ex?.text ?? "");
      setObsImage(ex?.imageDataUrl);
      setObsOpen(!!ex);
      setActiveOrb(next);
    }
  }

  // Downscale + compress a picked photo to a small data URL (kept inside the
  // project JSON). Targets ≤ ~0.5 MB so several photos never bloat the gig.
  async function pickObservationImage(file: File) {
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, w, h);
      let q = 0.72;
      let url = canvas.toDataURL("image/jpeg", q);
      while (url.length > 650_000 && q > 0.4) { q -= 0.12; url = canvas.toDataURL("image/jpeg", q); }
      setObsImage(url);
    } catch {
      // Fallback: read as-is (rare; e.g. createImageBitmap unsupported).
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === "string") setObsImage(reader.result.slice(0, 650_000)); };
      reader.readAsDataURL(file);
    }
  }

  function saveObservation() {
    if (!activeOrb || !onSetObservation) return;
    setObsBusy(true);
    onSetObservation(activeOrb, obsDraft.trim(), obsImage);
    setObsBusy(false);
    setObsOpen(false);
  }

  function openNote(note: ProjMapNote, e: React.MouseEvent) {
    e.stopPropagation();
    if (pannedRef.current) { pannedRef.current = false; return; }
    if (editMode && placeMode === "del") { onDeleteNote?.(floor, note.key); return; }
    const next = activeNote === note.key ? null : note.key;
    setNoteAnchor(next ? rectToAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) : null);
    setNoteDraft(next ? (note.text || "") : "");
    setActiveOrb(null);
    setActiveNote(next);
  }

  function saveActiveNote() {
    if (activeNote) onUpdateNote?.(floor, activeNote, noteDraft.trim());
    setActiveNote(null); setNoteAnchor(null);
  }

  function deleteActiveNote() {
    if (activeNote) onDeleteNote?.(floor, activeNote);
    setActiveNote(null); setNoteAnchor(null);
  }

  function onOrbPointerDown(pt: Point, e: React.PointerEvent) {
    if (!canEdit || !editMode || placeMode) return;
    e.preventDefault(); e.stopPropagation();
    dragKeyRef.current = pt.key;
    movedRef.current = false; lastPosRef.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(pt.key); setActiveOrb(null);
  }

  function onOrbPointerMove(pt: Point, e: React.PointerEvent) {
    if (dragKeyRef.current !== pt.key) return;
    const img = planRef.current; if (!img) return;
    const r = img.getBoundingClientRect(); if (!r.width || !r.height) return;
    const x = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
    const y = Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100));
    const pos = { x: +x.toFixed(2), y: +y.toFixed(2) };
    movedRef.current = true; lastPosRef.current = pos;
    onMoveMark(pt.key, pos.x, pos.y);
  }

  function onOrbPointerUp(pt: Point, e: React.PointerEvent) {
    if (dragKeyRef.current !== pt.key) return;
    dragKeyRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const moved = movedRef.current; const last = lastPosRef.current;
    movedRef.current = false; lastPosRef.current = null;
    setDragging(null);
    if (moved && last) onMoveMarkCommit(pt.key, last.x, last.y);
  }

  function onPlanClick(e: React.MouseEvent) {
    const img = planRef.current; if (!img) return;
    const r = img.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 100;
    const y = (e.clientY - r.top) / r.height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    if (placeMode === "note") {
      const key = onAddNote?.(floor, +x.toFixed(2), +y.toFixed(2), noteKind);
      // Open the new note's editor immediately so the crew can type a label.
      if (typeof key === "string") {
        setActiveOrb(null);
        setNoteDraft("");
        setNoteAnchor(pointAnchor(e.clientX, e.clientY));
        setActiveNote(key);
      }
      return;
    }
    if (placeMode === "zone") {
      // One "work happening here now" highlight — placing it relocates the marker.
      onSetActiveZone?.(floor, +x.toFixed(2), +y.toFixed(2));
      setPlaceMode(null);
      return;
    }
    if (placeMode !== 1 && placeMode !== 2) return;
    onAddCustomMark(floor, +x.toFixed(2), +y.toFixed(2), placeMode as 1 | 2);
  }

  function toggleEdit() {
    setEditMode((e) => !e);
    setPlaceMode(null); setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setDragging(null);
  }

  function chooseAdd(mode: 1 | 2 | "del") {
    setEditMode(true);
    setPlaceMode(placeMode === mode ? null : mode);
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null);
  }

  function chooseNoteKind(kind: ProjNoteKind) {
    setEditMode(true);
    setNoteKind(kind);
    setPlaceMode("note");
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null);
  }

  function chooseZone() {
    setEditMode(true);
    setPlaceMode("zone");
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null);
  }

  const editBanner = placeMode === 1 ? "Lisää punaisia pisteitä — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === 2 ? "Lisää keltaisia pisteitä — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === "del" ? "Poistotila — klikkaa pisteitä tai merkintöjä jotka haluat poistaa."
    : placeMode === "note" ? `Lisää merkintä (${NOTE_KINDS[noteKind].label}) — klikkaa pohjapiirrosta. Voit kirjoittaa muistiinpanon heti.`
    : placeMode === "zone" ? "Merkitse työn alla -alue — klikkaa kohtaa, jossa juuri nyt työskennellään. Asiakas näkee tämän."
    : "Muokkaustila — raahaa pisteet oikeille kohdille. Tallentuu automaattisesti.";

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>

      {/* Sub-navbar */}
      <div style={{ position: "relative", zIndex: 15, display: "flex", alignItems: "center", gap: isMobile ? "10px" : "18px", flexWrap: "wrap", padding: isMobile ? "10px 12px" : "14px 26px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: isMobile ? "rgba(10,10,12,0.96)" : "rgba(8,8,10,0.5)", backdropFilter: isMobile ? undefined : "blur(18px)", WebkitBackdropFilter: isMobile ? undefined : "blur(18px)" }}>

        {/* Floor selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "5px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "13px" }}>
          <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", padding: "0 6px 0 8px" }}>KRS</span>
          {floors.map((f) => {
            const gLocked = !!guided?.enabled && (guided.lockedFloors || []).includes(f);
            const gActive = !!guided?.enabled && guided.activeFloor === f;
            const st = floorBtnStyle(f === floor);
            return (
              <button key={f} onClick={() => { setFloor(f); setActiveOrb(null); }}
                title={gLocked ? "Lukossa — ohjattu eteneminen: pese aktiivinen kerros ensin (voit silti katsoa)" : gActive ? "Aktiivinen kerros — pese tämä ensin" : undefined}
                style={{
                  ...st,
                  ...(gActive && f !== floor ? { boxShadow: "inset 0 0 0 1.5px rgba(95,224,138,0.7)", color: "#9ff0bd" } : {}),
                  ...(gLocked && f !== floor ? { opacity: 0.5 } : {}),
                }}>
                {gLocked ? `🔒${f}` : f}
              </button>
            );
          })}
        </div>

        {/* Mini ring + stats */}
        <div style={{ display: "flex", alignItems: "center", gap: "13px", minWidth: "188px" }}>
          <div style={{ position: "relative", width: "42px", height: "42px", flexShrink: 0 }}>
            <svg width="42" height="42" viewBox="0 0 42 42" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="21" cy="21" r="17" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
              <circle cx="21" cy="21" r="17" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${((floorPct / 100) * CIRC_S).toFixed(1)} ${CIRC_S.toFixed(1)}`}
                style={{ transition: "stroke-dasharray .6s" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700 }}>
              {floor === "K" ? "K" : floor + "."}
            </div>
          </div>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: "15px", fontWeight: 700 }}>
              {floorWashed}<span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 500 }}> / {floorTotal}</span>{" "}
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>pesty</span>
            </div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
              {Math.round(floorPct)} %{hideMoney ? "" : ` · ${euro(floorWashed * pricePerWindow)}`}
            </div>
          </div>
        </div>

        {/* Filter */}
        <div style={{ display: "flex", gap: "5px", padding: "5px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "13px" }}>
          {FILTERS.map((fi) => (
            <button key={fi.id} onClick={() => { setFilter(fi.id); setActiveOrb(null); }} style={filterBtnStyle(filter === fi.id)}>{fi.label}</button>
          ))}
        </div>

        {/* Active work zone chip — jump to the floor where work is happening now. */}
        {activeZone && (
          <button onClick={() => { setFloor(activeZone.floor); setActiveOrb(null); }}
            title="Siirry kerrokseen, jossa työ on käynnissä"
            style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 11px", borderRadius: "11px", border: "1px solid rgba(95,224,138,0.35)", background: "rgba(95,224,138,0.1)", color: "#9ff0bd", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600 }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.9)", animation: "fr8-zonePulse 1.8s ease-in-out infinite" }} />
            Työn alla: krs {activeZone.floor}
          </button>
        )}

        {/* Right: legend + controls */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? "8px" : "14px" }}>
          {!isMobile && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center" }}>
                {LEGEND.map((l) => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${l.rgb})`, boxShadow: `0 0 7px rgba(${l.rgb},0.7)` }} />
                    <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{l.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ width: "1px", height: "26px", background: "rgba(255,255,255,0.1)" }} />
            </>
          )}

          {/* Zoom controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "11px" }}>
            <button onClick={() => zoomBy(1 / 1.3)} title="Loitonna" style={zoomBtnStyle}>−</button>
            <span style={{ minWidth: 34, textAlign: "center", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomBy(1.3)} title="Lähennä" style={zoomBtnStyle}>+</button>
            <button onClick={resetView} title="Nollaa näkymä" style={{ ...zoomBtnStyle, fontSize: 13 }}>⟳</button>
          </div>

          {/* Edit / add controls — full editing for hosts (canEdit), notes-only for workers (canAddNotes) */}
          {(canEdit || canAddNotes) && <>
          {/* P2 pricing mode — multi-select yellow windows, propose one price.
              Available already in the preparation phase (server auto-inits p2
              on the first proposal), so pricing can be prepped before the
              phase is opened to the customer. */}
          {canEdit && onP2Propose && (
          <button onClick={toggleP2SelectMode} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 13px", borderRadius: "11px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 600, transition: "all .16s", border: `1px solid ${p2SelectMode ? "transparent" : "rgba(255,205,40,0.35)"}`, background: p2SelectMode ? "rgb(255,205,40)" : "rgba(255,205,40,0.08)", color: p2SelectMode ? "#0a0a0c" : "rgba(255,220,110,0.95)" }}>
            € {p2SelectMode ? "Valmis" : "Hinnoittele"}
          </button>
          )}
          {canEdit && (
          <button onClick={toggleEdit} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 13px", borderRadius: "11px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 600, transition: "all .16s", border: `1px solid ${editMode ? "transparent" : "rgba(255,255,255,0.12)"}`, background: editMode ? "#fff" : "rgba(255,255,255,0.04)", color: editMode ? "#0a0a0c" : "rgba(255,255,255,0.7)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={editMode ? "#0a0a0c" : "rgba(255,255,255,0.55)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            {editMode ? "Valmis" : "Siirrä pisteitä"}
          </button>
          )}

          {/* Add button + menu */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setAddMenuOpen((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "11px", cursor: "pointer", transition: "all .16s", border: `1px solid ${(placeMode || addMenuOpen) ? "transparent" : "rgba(255,255,255,0.12)"}`, background: (placeMode || addMenuOpen) ? "#fff" : "rgba(255,255,255,0.04)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={(placeMode || addMenuOpen) ? "#0a0a0c" : "rgba(255,255,255,0.7)"} strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            {addMenuOpen && (
              <>
                <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44 }} />
                <div data-fr8-pop="menu" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 46, width: "212px", maxHeight: "min(70vh, 460px)", overflowY: "auto", padding: "7px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "14px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                  {canEdit && <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "5px 8px 7px" }}>
                    <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)" }}>LISÄÄ PISTE</span>
                    {pricePerWindow > 0 && <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9.5px", color: "rgba(95,224,138,0.85)" }}>{deal ? "punainen = " : "+1 = "}{euroUnit(pricePerWindow)}</span>}
                  </div>
                  {ADD_ITEMS.map((it) => (
                    <button key={String(it.id)} className="add-menu-btn" onClick={() => chooseAdd(it.id)} style={{ border: `1px solid ${placeMode === it.id ? "rgba(255,255,255,0.18)" : "transparent"}`, background: placeMode === it.id ? "rgba(255,255,255,0.09)" : "transparent" }}>
                      <span style={{ width: "17px", height: "17px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#ff6b6b", background: it.dotBg, border: it.id === "del" ? "1px solid rgba(255,90,90,0.5)" : "1px solid rgba(255,255,255,0.5)" }}>{it.glyph}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>{it.label}</span>
                        <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{it.id === 2 && deal ? "Keltainen · ei kuulu sopimukseen" : it.desc}</span>
                      </span>
                    </button>
                  ))}
                  </>}

                  {/* Navigation markers / notes — ladders, entrances, hazards, free notes. */}
                  {notesCanEdit && (
                    <>
                      {canEdit && <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "6px 4px" }} />}
                      <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", padding: "2px 8px 7px" }}>{canEdit ? "MERKINNÄT & HUOMIOT" : "LISÄÄ MERKINTÄ"}</div>
                      {(Object.keys(NOTE_KINDS) as ProjNoteKind[]).map((k) => (
                        <button key={k} className="add-menu-btn" onClick={() => chooseNoteKind(k)} style={{ border: `1px solid ${placeMode === "note" && noteKind === k ? "rgba(255,255,255,0.18)" : "transparent"}`, background: placeMode === "note" && noteKind === k ? "rgba(255,255,255,0.09)" : "transparent" }}>
                          <span style={{ width: "17px", height: "17px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>{NOTE_KINDS[k].glyph}</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>{NOTE_KINDS[k].label}</span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Active work zone — one coloured "work happening here now" marker. */}
                  {zoneCanEdit && (
                    <>
                      <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "6px 4px" }} />
                      <button className="add-menu-btn" onClick={chooseZone} style={{ border: `1px solid ${placeMode === "zone" ? "rgba(95,224,138,0.4)" : "transparent"}`, background: placeMode === "zone" ? "rgba(95,224,138,0.12)" : "transparent" }}>
                        <span style={{ width: "17px", height: "17px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>🎯</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>Työn alla nyt</span>
                          <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>Näkyy asiakkaalle reaaliajassa</span>
                        </span>
                      </button>
                      {activeZone && (
                        <button className="add-menu-btn" onClick={() => { onClearActiveZone?.(); setAddMenuOpen(false); }} style={{ border: "1px solid transparent" }}>
                          <span style={{ width: "17px", height: "17px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "#ff9b9b" }}>✕</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>Poista työalue-merkintä</span>
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          </>}
        </div>
      </div>

      {/* Floor plan */}
      <div
        ref={sceneRef}
        onWheel={onSceneWheel}
        onTouchStart={onSceneTouchStart}
        onTouchMove={onSceneTouchMove}
        onTouchEnd={onSceneTouchEnd}
        style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "10px" : "26px", minHeight: 0, overflow: "hidden", touchAction: editMode ? "auto" : "none", background: "radial-gradient(ellipse 72% 72% at 50% 47%, rgba(125,135,170,0.07), transparent 72%)" }}
      >

        {/* Edit banner */}
        {editMode && (
          <div style={{ position: "absolute", top: "14px", left: "50%", transform: "translateX(-50%)", zIndex: 20, display: "flex", alignItems: "center", gap: "12px", padding: "9px 9px 9px 16px", background: "rgba(16,16,20,0.82)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "13px", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 12px 34px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.8)" }}>{editBanner}</span>
            {/* Live price impact — each dot is worth one window, so adding/removing
                dots moves the contract cap in real time. */}
            {pricePerWindow > 0 && (
              <span
                title={deal
                  ? "Allekirjoitettu sopimus: punaiset ikkunat × 37,50 €, kiinteä kokonaiskatto. Keltaiset eivät kuulu tähän sopimukseen."
                  : "Koko sopimuksen ikkunamäärä × hinta/ikkuna — muuttuu kun lisäät tai poistat pisteitä"}
                style={{ display: "flex", alignItems: "center", gap: "7px", padding: "5px 11px", borderRadius: "9px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11.5px", color: "rgba(255,255,255,0.85)" }}
              >
                <span style={{ color: "rgba(255,255,255,0.5)" }}>{deal ? "SOPIMUS" : "KATTO"}</span>
                <strong style={{ fontWeight: 700 }}>{totalLive} {deal ? "punaista" : "ikkunaa"} · {euro(capEur)}</strong>
              </span>
            )}
            <button onClick={() => onResetFloor(floor)} style={{ padding: "6px 12px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Palauta tämä kerros
            </button>
          </div>
        )}

        {!planBase ? (
          <div style={{ maxWidth: "420px", textAlign: "center", padding: "30px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "15px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z" /><path d="M9 7v13M15 4v13" /></svg>
            </div>
            <div style={{ fontSize: "16px", fontWeight: 600 }}>Ei pohjakuvaa tälle keikalle</div>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              Lisää rakennuksen kerrokset ja pohjakuvan polku — tai tuo omat ikkunamerkinnät — <strong style={{ color: "rgba(255,255,255,0.7)" }}>Pohjakartat &amp; asetukset</strong> -työkalussa. Sen jälkeen kartta näkyy tässä.
            </div>
          </div>
        ) : marks ? (
          <div style={{ position: "relative", display: "inline-block", lineHeight: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center", transition: panRef.current || pinchRef.current ? "none" : "transform .18s ease", willChange: "transform" }}>
            <img ref={planRef} src={`${planBase}${floor}.png`} alt="pohjapiirros"
              style={{ display: "block", maxWidth: "100%", maxHeight: isMobile ? "calc(100vh - 210px)" : "calc(100vh - 240px)", width: "auto", height: "auto", userSelect: "none", WebkitClipPath: PLAN_CROP, clipPath: PLAN_CROP } as React.CSSProperties}
              draggable={false} />

            {/* Orbs layer */}
            <div onClick={onPlanClick} style={{ position: "absolute", inset: 0, cursor: (placeMode === 1 || placeMode === 2 || placeMode === "note" || placeMode === "zone") ? "crosshair" : "default" }}>
              {/* Active work zone — pulsing coloured highlight of current work. */}
              {activeZone && activeZone.floor === floor && (
                <span aria-label="Työn alla nyt" title={activeZone.label ? `Työn alla: ${activeZone.label}` : "Työn alla nyt"}
                  style={{ position: "absolute", left: `${activeZone.x}%`, top: `${activeZone.y}%`, transform: "translate(-50%,-50%)", width: "30px", height: "30px", borderRadius: "50%", background: "rgba(95,224,138,0.18)", border: "2px solid #5fe08a", boxShadow: "0 0 0 6px rgba(95,224,138,0.12)", animation: "fr8-zonePulse 1.8s ease-in-out infinite", pointerEvents: "none", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>
                  🎯
                </span>
              )}
              {points.map((pt) => {
                const status = statuses[pt.key] || "ei";
                const isDragging = dragging === pt.key;
                return (
                  <button key={pt.key}
                    style={orbStyle(pt, status, isDragging)}
                    onClick={(e) => onOrbClick(pt, e)}
                    onPointerDown={(e) => onOrbPointerDown(pt, e)}
                    onPointerMove={(e) => onOrbPointerMove(pt, e)}
                    onPointerUp={(e) => onOrbPointerUp(pt, e)}
                    title={editMode && placeMode === "del" ? "Poista tämä piste" : `Ikkuna ${points.indexOf(pt) + 1} · P${pt.p} · ${status === "pesty" ? "Pesty" : status === "kesken" ? "Kesken" : "Ei pesty"}`}
                  />
                );
              })}

              {/* P2 price badges (admin view): the negotiation state of each
                  yellow window. Worker view shows a lock on gated yellows instead. */}
              {p2?.offers && !editMode && points.map((pt) => {
                if (pt.p !== 2) return null;
                const offer = p2.offers![pt.key];
                if (!offer || offer.status === "declined") return null;
                const bg = offer.status === "locked" ? "rgba(95,224,138,0.92)"
                  : offer.status === "countered" ? "rgba(255,205,40,0.95)"
                  : "rgba(120,150,255,0.92)";
                const text = offer.status === "locked"
                  ? `✓ ${euroUnit((offer.lockedCents ?? offer.priceCents) / 100)}`
                  : offer.status === "countered"
                    ? `↩ ${euroUnit((offer.counterCents ?? 0) / 100)}`
                    : euroUnit(offer.priceCents / 100);
                return (
                  <span key={`p2-${pt.key}`} aria-hidden
                    style={{ position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, transform: "translate(-50%, 7px)", pointerEvents: "none", padding: "1px 5px", borderRadius: "999px", background: bg, color: "#0a0a0c", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "7.5px", fontWeight: 700, lineHeight: 1.5, whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
                    {text}
                  </span>
                );
              })}

              {/* Worker view: lock marker on yellow windows not yet in scope. */}
              {!canEdit && p2 && !editMode && points.map((pt) => p2WorkerGated(pt) ? (
                <span key={`p2lock-${pt.key}`} aria-hidden
                  style={{ position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, transform: "translate(3px, 3px)", pointerEvents: "none", fontSize: "7px", lineHeight: 1, zIndex: 5, opacity: 0.85 }}>
                  🔒
                </span>
              ) : null)}

              {/* Ohjattu eteneminen: sykkivä rengas seuraavan pestävän ikkunan
                  ympärillä ("mene tähän seuraavaksi"). Vain kun ikkuna on tällä
                  (aktiivisella) kerroksella. Ei ota napautuksia — dotti hoitaa sen. */}
              {guided?.enabled && guided.nextKey && !editMode && points.map((pt) => pt.key === guided.nextKey ? (
                <span key={`guided-${pt.key}`} aria-hidden className="fr8-guided-next"
                  style={{ position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, width: "26px", height: "26px", borderRadius: "50%", border: "2px solid #5fe08a", background: "rgba(95,224,138,0.1)", boxShadow: "0 0 10px rgba(95,224,138,0.65)", pointerEvents: "none", zIndex: 4 }} />
              ) : null)}

              {/* Observation badges — a small marker on windows that carry a note */}
              {points.map((pt) => observations?.[pt.key] ? (
                <span key={`obs-${pt.key}`} aria-hidden
                  style={{ position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, transform: "translate(3px, -13px)", pointerEvents: "none", width: "13px", height: "13px", borderRadius: "50%", background: "#1b1b1f", border: "1.5px solid #7CE0A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "7px", lineHeight: 1, zIndex: 5 }}>
                  💬
                </span>
              ) : null)}

              {/* Navigation markers / notes layer */}
              {floorNotes.map((n) => (
                <button key={n.key}
                  onClick={(e) => openNote(n, e)}
                  title={`${NOTE_KINDS[n.kind].label}${n.text ? " — " + n.text : ""}`}
                  style={{
                    position: "absolute", left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)",
                    width: "24px", height: "24px", borderRadius: "8px", padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px",
                    background: activeNote === n.key ? "rgba(255,255,255,0.95)" : "rgba(20,20,26,0.86)",
                    border: `1.5px solid ${n.kind === "warning" ? "rgba(255,176,72,0.9)" : "rgba(255,255,255,0.65)"}`,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.55)",
                    cursor: editMode && placeMode === "del" ? "pointer" : "pointer",
                    zIndex: 7, touchAction: "none",
                  }}
                >
                  {NOTE_KINDS[n.kind].glyph}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "14px" }}>Ladataan pohjapiirros…</div>
        )}
      </div>

      {/* P2 pricing bar — shown in select mode: pick yellows, set one price. */}
      {p2SelectMode && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(14px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 1150, display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100vw - 24px)", padding: "10px 12px", background: "rgba(16,16,20,0.94)", border: "1px solid rgba(255,205,40,0.4)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 18px 50px rgba(0,0,0,0.7)" }}>
          {!p2?.enabled && (
            <span title="Vaihe 2 ei ole vielä auki asiakkaalle — hinnat menevät jonoon odottamaan" style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 999, border: "1px solid rgba(255,205,40,0.4)", background: "rgba(255,205,40,0.1)", color: "rgb(255,220,110)", whiteSpace: "nowrap" }}>
              VALMISTELU
            </span>
          )}
          <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
            {p2Selected.size} valittu
          </span>
          <button
            onClick={() => setP2Selected((prev) => {
              const next = new Set(prev);
              floorYellowUnpriced.forEach((pt) => next.add(pt.key));
              return next;
            })}
            disabled={floorYellowUnpriced.length === 0}
            style={{ padding: "7px 11px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.8)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", opacity: floorYellowUnpriced.length === 0 ? 0.4 : 1, whiteSpace: "nowrap" }}
          >
            + Kerroksen hinnoittelemattomat ({floorYellowUnpriced.length})
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            {P2_PRICE_PRESETS_CENTS.map((c) => (
              <button key={c} onClick={() => setP2Price(String(c / 100))}
                style={{ padding: "7px 9px", borderRadius: "9px", border: `1px solid ${p2PriceCents === c ? "rgba(255,205,40,0.7)" : "rgba(255,255,255,0.14)"}`, background: p2PriceCents === c ? "rgba(255,205,40,0.16)" : "rgba(255,255,255,0.04)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                {euroUnit(c / 100)}
              </button>
            ))}
            <input
              type="number" inputMode="decimal" min={1} step="0.5"
              value={p2Price}
              onChange={(e) => setP2Price(e.target.value)}
              placeholder="€ / ikkuna"
              style={{ width: "84px", padding: "7px 9px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", outline: "none" }}
            />
          </div>
          <button
            disabled={p2Selected.size === 0 || !p2PriceCents}
            onClick={() => {
              if (!p2PriceCents || p2Selected.size === 0) return;
              onP2Propose?.(Array.from(p2Selected), p2PriceCents);
              setP2Selected(new Set());
            }}
            style={{ padding: "8px 15px", borderRadius: "10px", border: "none", background: (p2Selected.size && p2PriceCents) ? "rgb(255,205,40)" : "rgba(255,255,255,0.12)", color: (p2Selected.size && p2PriceCents) ? "#0a0a0c" : "rgba(255,255,255,0.4)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Ehdota hintaa{p2Selected.size > 0 && p2PriceCents ? ` (${p2Selected.size} × ${euroUnit(p2PriceCents / 100)})` : ""}
          </button>
        </div>
      )}

      {/* Status popover — rendered as a fixed overlay (outside the zoom/pan scene)
          so its buttons are NEVER clipped and stay tappable at any zoom or edge. */}
      {activeOrb && !editMode && activePt && (
        <>
          <div onClick={() => { setActiveOrb(null); setOrbAnchor(null); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
          <div data-fr8-pop="menu" style={{ ...fixedPopoverStyle(orbAnchor, 210, canObserve ? 380 : 230), width: "210px", maxHeight: "min(78vh, 460px)", overflowY: "auto", padding: "11px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 4px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "7px" }}>
              <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${colorRgb(activePt.p, statuses[activeOrb] || "ei")})`, boxShadow: `0 0 7px rgba(${colorRgb(activePt.p, statuses[activeOrb] || "ei")},0.7)` }} />
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Ikkuna {activeIdx + 1}</span>
              <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9.5px", color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>{activePt.p === 2 && p2 ? "PRIORITY 2" : deal && activePt.p === 2 ? "EI SOPIMUKSESSA" : `PRIORITEETTI ${activePt.p}`}</span>
            </div>

            {/* P2 offer state (admin) — where the negotiation stands for this window. */}
            {canEdit && activePt.p === 2 && p2?.offers && (() => {
              const offer = p2.offers[activeOrb];
              if (!offer) return (
                <div style={{ padding: "2px 4px 8px", fontSize: "11.5px", color: "rgba(255,220,110,0.9)" }}>
                  Ei hinnoiteltu — käytä € Hinnoittele -tilaa.
                </div>
              );
              return (
                <div style={{ padding: "2px 4px 8px", fontSize: "11.5px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                  {offer.status === "locked" && <>Lukittu hinta <strong style={{ color: "#7CE0A6" }}>{euroUnit((offer.lockedCents ?? offer.priceCents) / 100)}</strong> ✓</>}
                  {offer.status === "proposed" && <>Ehdotettu <strong>{euroUnit(offer.priceCents / 100)}</strong> — odottaa asiakasta</>}
                  {offer.status === "countered" && <>Vastatarjous <strong style={{ color: "rgb(255,205,40)" }}>{euroUnit((offer.counterCents ?? 0) / 100)}</strong> (oma ehdotus {euroUnit(offer.priceCents / 100)}) — vastaa projektinäkymän P2-osiossa</>}
                  {offer.status === "declined" && <>Asiakas hylkäsi / peruttu — voit ehdottaa uutta hintaa</>}
                </div>
              );
            })()}

            {/* Worker view: an unlocked yellow window is not washable yet. */}
            {p2WorkerGated(activePt) ? (
              <div style={{ padding: "6px 4px 4px", fontSize: "12px", color: "rgba(255,255,255,0.7)", lineHeight: 1.55 }}>
                🔒 Ei vielä työn piirissä — tämän ikkunan hinta sovitaan ensin asiakkaan kanssa. Saat merkata sen, kun hinta on lukittu.
              </div>
            ) : (["ei", "kesken", "pesty"] as WindowStatus[]).map((s) => {
              const cur = statuses[activeOrb] || "ei";
              const isActive = cur === s;
              const rgb = colorRgb(activePt.p, s);
              const hasCrew = s === "pesty" && !!workers && workers.length > 0;
              return (
                <button key={s} className="status-opt-btn"
                  onClick={() => {
                    if (hasCrew) {
                      // Mark washed and attribute to the default worker. Names stay
                      // hidden — change them only via "Vaihda" below. Keep open so
                      // the attribution row is visible.
                      onStatusChange(activeOrb, "pesty", washedBy?.[activeOrb] ?? currentWorkerId);
                      setShowWasherPicker(false);
                      return;
                    }
                    onStatusChange(activeOrb, s);
                    setActiveOrb(null); setOrbAnchor(null);
                  }}
                  style={{ border: `1px solid ${isActive ? "rgba(255,255,255,0.16)" : "transparent"}`, background: isActive ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: isActive ? 600 : 500 }}>
                  <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${rgb})`, boxShadow: `0 0 6px rgba(${rgb},0.7)`, flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: "left" }}>{s === "ei" ? "Ei pesty" : s === "kesken" ? "Kesken" : "Pesty"}</span>
                  {isActive && <span style={{ fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}

            {/* Worker's own payout for a locked P2 window (their share of ITS
                agreed price — the customer price itself is never shown). */}
            {!canEdit && activePt.p === 2 && p2?.payoutByKey?.[activeOrb] != null && p2LockedForWork(activeOrb) && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", padding: "6px 4px 0", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                <span>Sinulle tästä ikkunasta:</span>
                <strong style={{ color: "#7CE0A6", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{euroUnit((p2.payoutByKey[activeOrb]) / 100)}</strong>
              </div>
            )}

            {/* Washer attribution — shows WHO washed this window. Hosts can change
                it via "Vaihda"; workers see it read-only. */}
            {(statuses[activeOrb] || "ei") === "pesty" && (washedBy?.[activeOrb] || (canEdit && workers && workers.length > 0)) && (
              showWasherPicker && canEdit && workers && workers.length > 0 ? (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Kuka pesi?</div>
                  {workers.map((w) => {
                    const picked = (washedBy?.[activeOrb] ?? currentWorkerId) === w.id;
                    return (
                      <button key={w.id} className="status-opt-btn"
                        onClick={() => { onStatusChange(activeOrb, "pesty", w.id); setShowWasherPicker(false); }}
                        style={{ border: `1px solid ${picked ? "rgba(255,255,255,0.16)" : "transparent"}`, background: picked ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: picked ? 600 : 500 }}>
                        <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, background: "rgba(124,224,166,0.16)", color: "rgba(124,224,166,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, textAlign: "left" }}>{w.name}</span>
                        {picked && <span style={{ fontSize: "11px" }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(124,224,166,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Pesi <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[washedBy?.[activeOrb] ?? currentWorkerId ?? ""] ?? (washedBy?.[activeOrb] ?? currentWorkerId)}</strong>
                  </span>
                  {canEdit && workers && workers.length > 0 && (
                    <button onClick={() => setShowWasherPicker(true)} style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(124,224,166,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Vaihda</button>
                  )}
                </div>
              )
            )}

            {/* 50/50 split — managers can credit a window done together to a
                second worker. The window stays one washed window; only the
                earnings/credit split half-and-half between the two. */}
            {canEdit && onSetSplit && (statuses[activeOrb] || "ei") === "pesty" && workers && workers.length > 1 && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                {washedBy2?.[activeOrb] ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Jaettu 50/50: <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[washedBy2[activeOrb]] ?? washedBy2[activeOrb]}</strong>
                    </span>
                    <button onClick={() => { onSetSplit(activeOrb, null); setShowSplitPicker(false); }}
                      style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(255,155,155,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Poista jako</button>
                  </div>
                ) : showSplitPicker ? (
                  <>
                    <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Kuka teki yhdessä? (50/50)</div>
                    {workers.filter((w) => w.id !== (washedBy?.[activeOrb] ?? currentWorkerId)).map((w) => (
                      <button key={w.id} className="status-opt-btn"
                        onClick={() => { onSetSplit(activeOrb, w.id); setShowSplitPicker(false); }}
                        style={{ border: "1px solid transparent", background: "transparent", fontWeight: 500 }}>
                        <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, background: "rgba(124,224,166,0.16)", color: "rgba(124,224,166,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, textAlign: "left" }}>{w.name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <button className="status-opt-btn" onClick={() => setShowSplitPicker(true)} style={{ border: "1px solid transparent", background: "transparent" }}>
                    <span style={{ width: "13px", height: "13px", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(124,224,166,0.95)", fontSize: "15px", fontWeight: 700, flexShrink: 0 }}>+</span>
                    <span style={{ flex: 1, textAlign: "left" }}>Jaa 50/50 toiselle</span>
                  </button>
                )}
              </div>
            )}

            {/* Kesken attribution — shows WHO marked this window as "kesken". */}
            {(statuses[activeOrb] || "ei") === "kesken" && keskenBy?.[activeOrb] && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(188,150,255,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Kesken: <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[keskenBy[activeOrb]] ?? keskenBy[activeOrb]}</strong>
                </span>
              </div>
            )}

            {/* Per-window observation — text + optional photo. Shown to the
                customer as a small popup on this window. */}
            {canObserve && onSetObservation && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                {!obsOpen ? (
                  <button className="status-opt-btn" onClick={() => setObsOpen(true)}
                    style={{ border: "1px solid transparent" }}>
                    <span style={{ fontSize: "13px" }}>💬</span>
                    <span style={{ flex: 1, textAlign: "left" }}>{(obsDraft.trim() || obsImage) ? "Muokkaa huomiota" : "Lisää huomio"}</span>
                    {(obsDraft.trim() || obsImage) && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7CE0A6", flexShrink: 0 }} />}
                  </button>
                ) : (
                  <>
                    <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 2px 6px" }}>Huomio ikkunasta</div>
                    <textarea value={obsDraft} onChange={(e) => setObsDraft(e.target.value)} rows={2}
                      placeholder="Esim. rikkinäinen tiiviste, naarmu lasissa…" autoFocus
                      style={{ width: "100%", resize: "none", padding: "8px 10px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "12.5px", outline: "none", fontFamily: "var(--font-onest, system-ui, sans-serif)", boxSizing: "border-box" }} />
                    {obsImage && (
                      <div style={{ position: "relative", marginTop: "8px" }}>
                        <img src={obsImage} alt="huomio" style={{ width: "100%", maxHeight: "120px", objectFit: "cover", borderRadius: "9px", display: "block" }} />
                        <button onClick={() => setObsImage(undefined)} aria-label="Poista kuva"
                          style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "13px", cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "7px", marginTop: "8px" }}>
                      {!obsImage && (
                        <label style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 11px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.8)", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", whiteSpace: "nowrap" }}>
                          + Kuva
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickObservationImage(f); e.currentTarget.value = ""; }} />
                        </label>
                      )}
                      <button onClick={saveObservation} disabled={obsBusy}
                        style={{ flex: 1, padding: "8px 12px", borderRadius: "10px", border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", opacity: obsBusy ? 0.6 : 1 }}>
                        {(obsDraft.trim() || obsImage) ? "Tallenna" : "Poista huomio"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Delete this window — managers only. Removes the dot from the map
                (seeded dots are hidden, custom dots are removed entirely). */}
            {canEdit && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button className="status-opt-btn"
                  onClick={() => {
                    if (typeof window === "undefined" || window.confirm("Poistetaanko tämä ikkuna kartalta?")) {
                      onDeleteMark(activeOrb);
                      setActiveOrb(null); setOrbAnchor(null);
                    }
                  }}
                  style={{ color: "#ff9b9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff9b9b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  <span style={{ flex: 1, textAlign: "left" }}>Poista ikkuna kartalta</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Note popover — view / edit the marker's label, or delete it. Also fixed. */}
      {activeNote && activeNoteObj && (
        <>
          <div onClick={() => { saveActiveNote(); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
          <div data-fr8-pop="menu" style={{ ...fixedPopoverStyle(noteAnchor, 232, 180), width: "232px", padding: "12px", background: "rgba(16,16,20,0.94)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 2px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "9px" }}>
              <span style={{ fontSize: "16px" }}>{NOTE_KINDS[activeNoteObj.kind].glyph}</span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{NOTE_KINDS[activeNoteObj.kind].label}</span>
            </div>
            {notesCanEdit ? (
              <>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Kirjoita muistiinpano (esim. ”Tikkaat tässä, 3 m”)"
                  autoFocus
                  rows={3}
                  style={{ width: "100%", resize: "none", padding: "9px 11px", borderRadius: "11px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "13px", outline: "none", fontFamily: "var(--font-onest, system-ui, sans-serif)", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button onClick={deleteActiveNote} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(255,90,90,0.4)", background: "rgba(255,90,90,0.1)", color: "#ff9b9b", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Poista</button>
                  <button onClick={saveActiveNote} style={{ flex: 1, padding: "9px 12px", borderRadius: "10px", border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Valmis</button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.5, minHeight: "20px" }}>
                {activeNoteObj.text || <span style={{ color: "rgba(255,255,255,0.4)" }}>Ei muistiinpanoa.</span>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
