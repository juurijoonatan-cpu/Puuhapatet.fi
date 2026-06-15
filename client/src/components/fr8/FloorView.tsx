/**
 * FR8 projektinäkymä — per-floor window map (ported from fr8-ikkunat prototype).
 * The dot positions, drag/add/delete and status logic are kept identical to the
 * prototype; only persistence (handled by the parent) and the plan image base
 * path differ.
 */
import { useState, useRef, useEffect } from "react";
import type { ProjMarksData, WindowStatus, ProjCustomMark } from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";

const CIRC_S = 2 * Math.PI * 17; // mini ring

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
  onStatusChange: (key: string, status: WindowStatus) => void;
  onAddCustomMark: (floor: string, x: number, y: number, p: 1 | 2) => void;
  onDeleteMark: (key: string) => void;
  onMoveMark: (key: string, x: number, y: number) => void;
  onMoveMarkCommit: (key: string, x: number, y: number) => void;
  onResetFloor: (floor: string) => void;
}

function colorRgb(p: 1 | 2, status: WindowStatus) {
  if (status === "pesty") return p === 1 ? "255,72,72" : "255,205,40";
  if (status === "kesken") return "188,150,255";
  return p === 1 ? "255,140,178" : "240,226,150";
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function euro(n: number) { return fmt(n) + " €"; }

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

export default function FloorView({ floors, planBase, pricePerWindow, marks, statuses, posOverrides, customMarks, deleted, initialFloor, onStatusChange, onAddCustomMark, onDeleteMark, onMoveMark, onMoveMarkCommit, onResetFloor }: Props) {
  const [floor, setFloor] = useState(initialFloor);
  const [filter, setFilter] = useState<"all" | "unwashed" | "progress" | "done">("all");
  const [editMode, setEditMode] = useState(false);
  const [placeMode, setPlaceMode] = useState<1 | 2 | "del" | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [activeOrb, setActiveOrb] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const planRef = useRef<HTMLImageElement>(null);
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
  const floorWashed = points.filter((p) => (statuses[p.key] || "ei") === "pesty").length;
  const floorTotal = points.length;
  const floorPct = floorTotal > 0 ? (floorWashed / floorTotal) * 100 : 0;
  const activePt = activeOrb ? points.find((p) => p.key === activeOrb) ?? null : null;
  const activeIdx = activePt ? points.indexOf(activePt) : -1;

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
    if (soft && !editMode) {
      base.animation = "fr8-orbPulse 3.2s ease-in-out infinite";
    } else {
      base.boxShadow = isDragging
        ? `0 0 0 3px rgba(255,255,255,0.35), 0 0 14px rgba(${rgb},0.9)`
        : washed ? `0 0 6px rgba(${rgb},0.95), 0 0 13px rgba(${rgb},0.5)` : `0 0 5px rgba(${rgb},0.7), 0 0 11px rgba(${rgb},0.35)`;
    }
    return base;
  }

  function onOrbClick(pt: Point, e: React.MouseEvent) {
    e.stopPropagation();
    // Ignore the click that ends a pan gesture (so panning never toggles a dot).
    if (pannedRef.current) { pannedRef.current = false; return; }
    if (editMode && placeMode === "del") { onDeleteMark(pt.key); return; }
    if (!editMode) setActiveOrb(activeOrb === pt.key ? null : pt.key);
  }

  function onOrbPointerDown(pt: Point, e: React.PointerEvent) {
    if (!editMode || placeMode) return;
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
    if (placeMode !== 1 && placeMode !== 2) return;
    const img = planRef.current; if (!img) return;
    const r = img.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 100;
    const y = (e.clientY - r.top) / r.height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    onAddCustomMark(floor, +x.toFixed(2), +y.toFixed(2), placeMode as 1 | 2);
  }

  function toggleEdit() {
    setEditMode((e) => !e);
    setPlaceMode(null); setAddMenuOpen(false); setActiveOrb(null); setDragging(null);
  }

  function chooseAdd(mode: 1 | 2 | "del") {
    setEditMode(true);
    setPlaceMode(placeMode === mode ? null : mode);
    setAddMenuOpen(false); setActiveOrb(null);
  }

  const editBanner = placeMode === 1 ? "Lisää punaisia pisteitä — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === 2 ? "Lisää keltaisia pisteitä — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === "del" ? "Poistotila — klikkaa pisteitä jotka haluat poistaa."
    : "Muokkaustila — raahaa pisteet oikeille kohdille. Tallentuu automaattisesti.";

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>

      {/* Sub-navbar */}
      <div style={{ position: "relative", zIndex: 15, display: "flex", alignItems: "center", gap: isMobile ? "10px" : "18px", flexWrap: "wrap", padding: isMobile ? "10px 12px" : "14px 26px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(8,8,10,0.5)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>

        {/* Floor selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "5px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "13px" }}>
          <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", padding: "0 6px 0 8px" }}>KRS</span>
          {floors.map((f) => (
            <button key={f} onClick={() => { setFloor(f); setActiveOrb(null); }} style={floorBtnStyle(f === floor)}>{f}</button>
          ))}
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
              {Math.round(floorPct)} % · {euro(floorWashed * pricePerWindow)}
            </div>
          </div>
        </div>

        {/* Filter */}
        <div style={{ display: "flex", gap: "5px", padding: "5px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "13px" }}>
          {FILTERS.map((fi) => (
            <button key={fi.id} onClick={() => { setFilter(fi.id); setActiveOrb(null); }} style={filterBtnStyle(filter === fi.id)}>{fi.label}</button>
          ))}
        </div>

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

          {/* Edit button */}
          <button onClick={toggleEdit} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 13px", borderRadius: "11px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 600, transition: "all .16s", border: `1px solid ${editMode ? "transparent" : "rgba(255,255,255,0.12)"}`, background: editMode ? "#fff" : "rgba(255,255,255,0.04)", color: editMode ? "#0a0a0c" : "rgba(255,255,255,0.7)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={editMode ? "#0a0a0c" : "rgba(255,255,255,0.55)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            {editMode ? "Valmis" : "Siirrä pisteitä"}
          </button>

          {/* Add button + menu */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setAddMenuOpen((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "11px", cursor: "pointer", transition: "all .16s", border: `1px solid ${(placeMode || addMenuOpen) ? "transparent" : "rgba(255,255,255,0.12)"}`, background: (placeMode || addMenuOpen) ? "#fff" : "rgba(255,255,255,0.04)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={(placeMode || addMenuOpen) ? "#0a0a0c" : "rgba(255,255,255,0.7)"} strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            {addMenuOpen && (
              <>
                <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44 }} />
                <div data-fr8-pop="menu" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 46, width: "212px", padding: "7px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "14px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                  <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", padding: "5px 8px 7px" }}>LISÄÄ PISTE</div>
                  {ADD_ITEMS.map((it) => (
                    <button key={String(it.id)} className="add-menu-btn" onClick={() => chooseAdd(it.id)} style={{ border: `1px solid ${placeMode === it.id ? "rgba(255,255,255,0.18)" : "transparent"}`, background: placeMode === it.id ? "rgba(255,255,255,0.09)" : "transparent" }}>
                      <span style={{ width: "17px", height: "17px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#ff6b6b", background: it.dotBg, border: it.id === "del" ? "1px solid rgba(255,90,90,0.5)" : "1px solid rgba(255,255,255,0.5)" }}>{it.glyph}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>{it.label}</span>
                        <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{it.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Floor plan */}
      <div
        ref={sceneRef}
        onWheel={onSceneWheel}
        onTouchStart={onSceneTouchStart}
        onTouchMove={onSceneTouchMove}
        onTouchEnd={onSceneTouchEnd}
        style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "10px" : "26px", minHeight: 0, overflow: "hidden", touchAction: zoom > 1 && !editMode ? "none" : "auto", background: "radial-gradient(ellipse 72% 72% at 50% 47%, rgba(125,135,170,0.07), transparent 72%)" }}
      >

        {/* Edit banner */}
        {editMode && (
          <div style={{ position: "absolute", top: "14px", left: "50%", transform: "translateX(-50%)", zIndex: 20, display: "flex", alignItems: "center", gap: "14px", padding: "9px 9px 9px 16px", background: "rgba(16,16,20,0.82)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "13px", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 12px 34px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.8)" }}>{editBanner}</span>
            <button onClick={() => onResetFloor(floor)} style={{ padding: "6px 12px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Palauta tämä kerros
            </button>
          </div>
        )}

        {marks ? (
          <div style={{ position: "relative", display: "inline-block", lineHeight: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center", transition: panRef.current || pinchRef.current ? "none" : "transform .18s ease", willChange: "transform" }}>
            <img ref={planRef} src={`${planBase}${floor}.png`} alt="pohjapiirros"
              style={{ display: "block", maxWidth: "100%", maxHeight: isMobile ? "calc(100vh - 210px)" : "calc(100vh - 240px)", width: "auto", height: "auto", userSelect: "none" } as React.CSSProperties}
              draggable={false} />

            {/* Orbs layer */}
            <div onClick={onPlanClick} style={{ position: "absolute", inset: 0, cursor: (placeMode === 1 || placeMode === 2) ? "crosshair" : "default" }}>
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

              {/* Status popover */}
              {activeOrb && !editMode && activePt && (
                <>
                  <div onClick={() => setActiveOrb(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div data-fr8-pop="in" style={{ position: "absolute", left: `${activePt.x}%`, top: `${activePt.y}%`, transform: "translate(-50%,calc(-100% - 14px))", zIndex: 50, width: "188px", padding: "11px", background: "rgba(16,16,20,0.86)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 4px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "7px" }}>
                      <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${colorRgb(activePt.p, statuses[activeOrb] || "ei")})`, boxShadow: `0 0 7px rgba(${colorRgb(activePt.p, statuses[activeOrb] || "ei")},0.7)` }} />
                      <span style={{ fontSize: "12px", fontWeight: 600 }}>Ikkuna {activeIdx + 1}</span>
                      <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9.5px", color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>PRIORITEETTI {activePt.p}</span>
                    </div>
                    {(["ei", "kesken", "pesty"] as WindowStatus[]).map((s) => {
                      const cur = statuses[activeOrb] || "ei";
                      const isActive = cur === s;
                      const rgb = colorRgb(activePt.p, s);
                      return (
                        <button key={s} className="status-opt-btn"
                          onClick={() => { onStatusChange(activeOrb, s); setActiveOrb(null); }}
                          style={{ border: `1px solid ${isActive ? "rgba(255,255,255,0.16)" : "transparent"}`, background: isActive ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: isActive ? 600 : 500 }}>
                          <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${rgb})`, boxShadow: `0 0 6px rgba(${rgb},0.7)`, flexShrink: 0 }} />
                          <span style={{ flex: 1, textAlign: "left" }}>{s === "ei" ? "Ei pesty" : s === "kesken" ? "Kesken" : "Pesty"}</span>
                          {isActive && <span style={{ fontSize: "11px" }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "14px" }}>Ladataan pohjapiirros…</div>
        )}
      </div>
    </div>
  );
}
