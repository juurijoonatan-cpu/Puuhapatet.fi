/**
 * Read-only floor-plan map for the customer live view (/seuranta/:token).
 *
 * Deliberately a separate, lightweight component from the worker/admin
 * FloorView (which is dark-themed and fully editable). This one is WHITE,
 * read-only — no drag, no add/delete, no status popovers — so the customer
 * can only watch which windows have been washed. It shares the exact same
 * dot coordinate scheme as FloorView so the markers line up identically.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { GigPublicView, P2PublicOffer, P2PublicView } from "@/lib/api";
import { NOTE_KINDS } from "@shared/project";
import { eur } from "@shared/gig";

/** Position a fixed popup near an on-screen anchor rect, flipping above/below and
 *  clamping to the viewport so it's never clipped (mobile-friendly). */
function popupStyle(rect: DOMRect | null, width: number, height: number): React.CSSProperties {
  if (typeof window === "undefined" || !rect) {
    return { position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: 60 };
  }
  const margin = 10, vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(vw - width - margin, left));
  let top = rect.top - height - 10;
  if (top < margin) top = Math.min(vh - height - margin, rect.bottom + 10);
  top = Math.max(margin, top);
  return { position: "fixed", left: `${left}px`, top: `${top}px`, zIndex: 60 };
}

const T = {
  ink: "#1A1A1A",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  hair: "#E4E1D7",
  muted: "#8C8A82",
  navy: "#1F3B57",
};
const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const MIN_SCALE = 1, MAX_SCALE = 5;
const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

type WindowStatus = "ei" | "kesken" | "pesty";
interface Point { key: string; p: 1 | 2; x: number; y: number; }

type MapData = NonNullable<GigPublicView["map"]>;

// Same colour scheme as FloorView, tuned to read on a light background.
function dotColor(p: 1 | 2, status: WindowStatus): string {
  if (status === "pesty") return p === 1 ? "#E03B3B" : "#E0A800";
  if (status === "kesken") return "#7C5CD6";
  return p === 1 ? "#F4A6C0" : "#D9C97E";
}

function getPoints(floor: string, map: MapData): Point[] {
  const out: Point[] = [];
  (map.marks[floor]?.marks || []).forEach((mk, idx) => {
    const key = `${floor}#${idx}`;
    if (map.deleted[key]) return;
    const ov = map.posOverrides[key];
    out.push({ key, p: mk.p, x: ov ? ov.x : mk.x, y: ov ? ov.y : mk.y });
  });
  (map.customMarks[floor] || []).forEach((cm) => {
    if (map.deleted[cm.key]) return;
    const ov = map.posOverrides[cm.key];
    out.push({ key: cm.key, p: cm.p, x: ov ? ov.x : cm.x, y: ov ? ov.y : cm.y });
  });
  return out;
}

const LEGEND: { label: string; color: string }[] = [
  { label: "Pesemättä", color: "#F4A6C0" },
  { label: "Kesken", color: "#7C5CD6" },
  { label: "Pesty", color: "#E03B3B" },
  { label: "Ei tässä sopimuksessa", color: "#D9C97E" },
];

// Phase-2 legend describes the NUMBERED badge colours (map shows numbers, not
// prices — the euros live in the list below).
const LEGEND_P2: { label: string; color: string }[] = [
  { label: "Hintaehdotus odottaa sinua", color: "#1F3B57" },
  { label: "Vastatarjouksesi", color: "#E0A800" },
  { label: "Sovittu ✓", color: "#3E7C59" },
  { label: "Ehdottamasi (odottaa hintaa)", color: "#FFFFFF" },
];

/** P2 numbered-badge colors by negotiation state ("none" = priced not yet). */
type P2BadgeState = P2PublicOffer["status"] | "none";
function p2BadgeStyle(state: P2BadgeState): { bg: string; fg: string; border: string } {
  switch (state) {
    case "proposed":  return { bg: T.navy,    fg: "#fff",     border: "#fff" };
    case "countered": return { bg: "#E0A800", fg: "#1A1A1A",  border: "#fff" };
    case "locked":    return { bg: "#3E7C59", fg: "#fff",     border: "#fff" };
    case "declined":  return { bg: "#EDEBE4", fg: "#9A988F",  border: "#fff" };
    default:          return { bg: "#FFFFFF", fg: T.navy,     border: T.navy }; // not priced yet
  }
}

/** Actions the customer can take on P2 offers — wired to the API by the parent.
 *  Each returns an error message to show inline, or null on success. */
export interface P2CustomerActions {
  accept: (items: { key: string; priceCents: number; version: number }[]) => Promise<string | null>;
  counter: (key: string, counterCents: number, version: number) => Promise<string | null>;
  decline: (key: string, version: number) => Promise<string | null>;
  addPoint: (floor: string, x: number, y: number) => Promise<string | null>;
  removePoint: (key: string) => Promise<string | null>;
  /** Terms not accepted yet → the parent opens the terms dialog. */
  requireTerms: () => void;
}

export default function CustomerFloorMap({ map, p2, p2Actions }: {
  map: MapData;
  /** P2 negotiation state — pills + offer popups render only when enabled. */
  p2?: P2PublicView | null;
  p2Actions?: P2CustomerActions;
}) {
  const floors = map.building.floors.length ? map.building.floors : ["1"];
  const activeZone = map.activeZone ?? null;
  // Open on the floor where work is happening now, if any.
  const [floor, setFloor] = useState(() =>
    activeZone && floors.includes(activeZone.floor) ? activeZone.floor : floors[0]);

  const points = useMemo(() => getPoints(floor, map), [floor, map]);
  const floorNotes = map.notes?.[floor] ?? [];
  const observations = map.observations ?? {};
  // The window whose observation popup is open (+ the badge rect to anchor it).
  const [openObs, setOpenObs] = useState<{ key: string; rect: DOMRect } | null>(null);
  const openObservation = openObs ? observations[openObs.key] : undefined;
  const washed = points.filter((p) => map.statuses[p.key] === "pesty").length;
  const total = points.length;
  const pct = total > 0 ? Math.round((washed / total) * 100) : 0;

  // ── P2 negotiation state ──────────────────────────────────────────────────
  const p2On = !!(p2?.enabled && p2Actions);
  const [openOffer, setOpenOffer] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [p2Busy, setP2Busy] = useState(false);
  const [p2Error, setP2Error] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  // Phase-2 opens focused on just the extra (yellow) windows — the reds are done,
  // so the map starts clean and only the numbered Priority 2 points carry it.
  const [onlyYellow, setOnlyYellow] = useState(p2On);
  // Map ↔ list bridge: scroll the map into view / pulse a badge ("Kartalla"),
  // and scroll a list row into view / pulse it ("Näytä listassa").
  const mapRef = useRef<HTMLDivElement | null>(null);
  const listRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [hiRow, setHiRow] = useState<string | null>(null);

  // ── Map zoom + pan ─────────────────────────────────────────────────────────
  // The building has a lot of windows; on a desktop especially the customer
  // needs to zoom into a wing and pan around. Pinch (touch), wheel (mouse) and
  // +/−/reset buttons all drive one transform on the plan layer.
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ startDist: number; startS: number } | null>(null);
  const pan = useRef<{ x0: number; y0: number; ox: number; oy: number; id: number; active: boolean } | null>(null);
  const zoomed = view.s > 1.01 || Math.abs(view.x) > 1 || Math.abs(view.y) > 1;
  const resetView = () => setView({ s: 1, x: 0, y: 0 });
  const zoomBy = (f: number) => setView((v) => ({ ...v, s: clampScale(v.s * f) }));
  // Reset the view whenever the floor changes so a new plan opens fitted.
  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [floor]);
  // Wheel zoom needs a non-passive native listener to call preventDefault.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (addMode) return;
      e.preventDefault();
      setView((v) => ({ ...v, s: clampScale(v.s * (e.deltaY < 0 ? 1.12 : 0.89)) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [addMode]);

  function onPtrDown(e: React.PointerEvent) {
    if (addMode) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      const [a, b] = Array.from(ptrs.current.values());
      pinch.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startS: view.s };
      pan.current = null;
    } else if (ptrs.current.size === 1) {
      pan.current = { x0: e.clientX, y0: e.clientY, ox: view.x, oy: view.y, id: e.pointerId, active: false };
    }
  }
  function onPtrMove(e: React.PointerEvent) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2 && pinch.current) {
      const [a, b] = Array.from(ptrs.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setView((v) => ({ ...v, s: clampScale(pinch.current!.startS * (d / pinch.current!.startDist)) }));
      return;
    }
    const p = pan.current;
    if (p && p.id === e.pointerId) {
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      if (!p.active) {
        if (Math.hypot(dx, dy) < 5) return; // a tap, not a drag → let badge clicks through
        p.active = true;
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      setView((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
    }
  }
  function onPtrUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (pan.current && pan.current.id === e.pointerId) pan.current = null;
    if (ptrs.current.size === 0) setDragging(false);
  }
  const openOfferData = openOffer && p2 ? p2.offers[openOffer.key] ?? null : null;
  const customerAdded = p2On ? new Set(p2!.customerAddedKeys) : new Set<string>();
  const openOfferIsMine = openOffer ? customerAdded.has(openOffer.key) : false;

  // ── Organized proposal list (across ALL floors) ─────────────────────────────
  // With every yellow priced, tapping tiny dots among overlapping pills is fiddly.
  // A clean grouped list — proposals to answer, your counter-offers, and the
  // agreed windows — is the primary way to review and respond. The map stays for
  // spatial context. Per-key counter input lives here.
  const [listCounterKey, setListCounterKey] = useState<string | null>(null);
  const [listCounterVal, setListCounterVal] = useState("");
  const allYellow = useMemo(() => {
    if (!p2On) return [] as { key: string; floor: string; idx: number; offer: P2PublicOffer }[];
    const out: { key: string; floor: string; idx: number; offer: P2PublicOffer }[] = [];
    for (const f of floors) {
      getPoints(f, map).forEach((pt, i) => {
        if (pt.p !== 2) return;
        const offer = p2!.offers[pt.key];
        if (offer && offer.status !== "declined") out.push({ key: pt.key, floor: f, idx: i, offer });
      });
    }
    return out;
  }, [p2On, floors, map, p2]);
  const proposedList = allYellow.filter((o) => o.offer.status === "proposed");
  const counteredList = allYellow.filter((o) => o.offer.status === "countered");
  const lockedList = allYellow.filter((o) => o.offer.status === "locked");
  const allProposedSum = proposedList.reduce((s, o) => s + o.offer.priceCents, 0);
  const lockedSum = lockedList.reduce((s, o) => s + (o.offer.lockedCents ?? o.offer.priceCents), 0);
  const floorLabel = (f: string) => (f === "K" ? "Kellari" : `${f}. kerros`);
  // Group the open proposals BY FLOOR so the customer can review and accept
  // floor by floor (a whole floor's price at once), not scroll one flat list.
  const proposedFloors = floors
    .map((f) => ({ floor: f, items: proposedList.filter((o) => o.floor === f) }))
    .filter((g) => g.items.length > 0);
  // Stable per-floor Priority 2 numbering so the map badges and the list rows
  // always agree ("ikkuna 10" on the map = "ikkuna 10" in the list).
  const p2Number = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of floors) {
      let n = 0;
      getPoints(f, map).forEach((pt) => { if (pt.p === 2) { n += 1; m[pt.key] = n; } });
    }
    return m;
  }, [floors, map]);
  // Has the customer engaged with phase-2 yet (any yellow priced or added)?
  // Drives an inviting empty-state nudge that expects them to add windows.
  const yellowCount = p2On ? points.filter((pt) => pt.p === 2).length : 0;
  const anyYellowActivity = p2On && points.some((pt) => pt.p === 2 && p2!.offers[pt.key]);

  const closeOffer = () => { setOpenOffer(null); setP2Error(null); };

  // "Kartalla" → jump to the window's floor, scroll the map into view and pulse
  // its numbered badge so the customer can locate it among many.
  function jumpToMap(key: string, f: string) {
    setFloor(f);
    setOnlyYellow(true);
    resetView();
    closeOffer();
    setFocusKey(key);
    requestAnimationFrame(() => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    window.setTimeout(() => setFocusKey((k) => (k === key ? null : k)), 2600);
  }
  // Map badge popup → scroll down to that window's row in the decision list,
  // where accept / counter / decline live (the map itself stays planning-only).
  function jumpToList(key: string) {
    closeOffer();
    setHiRow(key);
    requestAnimationFrame(() => listRowRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" }));
    window.setTimeout(() => setHiRow((k) => (k === key ? null : k)), 2600);
  }

  // Terms-gated actions = PRICE COMMITMENTS (accept / counter). These lock or
  // negotiate an order, so the customer accepts the light terms first.
  async function runP2<A extends unknown[]>(fn: (...args: A) => Promise<string | null>, ...args: A) {
    if (!p2Actions) return;
    if (!p2?.termsAccepted) { p2Actions.requireTerms(); return; }
    await runP2Free(fn, ...args);
  }
  // Free actions = PLANNING (add / remove own window, decline). No commitment, so
  // the customer can explore and prepare the map before any terms — a logical order.
  async function runP2Free<A extends unknown[]>(fn: (...args: A) => Promise<string | null>, ...args: A) {
    if (!p2Actions) return;
    setP2Busy(true); setP2Error(null);
    const err = await fn(...args);
    setP2Busy(false);
    if (err) setP2Error(err);
    else closeOffer();
  }

  // One open-proposal row (accept / counter / decline). Extracted so the floor
  // groups below stay readable.
  const renderProposedRow = (o: { key: string; floor: string; idx: number; offer: P2PublicOffer }) => (
    <div key={o.key} ref={(el) => { listRowRefs.current[o.key] = el; }} style={{ padding: "10px 12px", borderRadius: 11, background: hiRow === o.key ? "rgba(224,168,0,0.16)" : T.paper, border: `1px solid ${hiRow === o.key ? "#E0A800" : T.hair}`, transition: "background .4s, border-color .4s", scrollMarginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: "50%", background: T.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{p2Number[o.key] ?? o.idx + 1}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Ikkuna {p2Number[o.key] ?? o.idx + 1}{customerAdded.has(o.key) ? " · sinun" : ""}</div>
          <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{eur(o.offer.priceCents)}<span style={{ fontSize: 11.5, color: T.muted, fontWeight: 500 }}> / ikkuna</span></div>
        </div>
        <button onClick={() => jumpToMap(o.key, o.floor)} title="Näytä kartalla" style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.navy, fontFamily: FONT, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Kartalla</button>
      </div>
      {listCounterKey === o.key ? (
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          <input type="number" inputMode="decimal" min={1} step="0.5" autoFocus value={listCounterVal} onChange={(e) => setListCounterVal(e.target.value)} placeholder="€ / ikkuna"
            style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, fontFamily: FONT, fontSize: 14, fontVariantNumeric: "tabular-nums" }} />
          <button disabled={p2Busy || !(Number(listCounterVal.replace(",", ".")) > 0)}
            onClick={() => { const v = Number(listCounterVal.replace(",", ".")); if (!(v > 0)) return; void runP2(p2Actions!.counter, o.key, Math.round(v * 100), o.offer.version).then(() => { setListCounterKey(null); setListCounterVal(""); }); }}
            style={{ padding: "9px 13px", borderRadius: 9, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}>Lähetä</button>
          <button disabled={p2Busy} onClick={() => { setListCounterKey(null); setListCounterVal(""); }} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.muted, fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          <button disabled={p2Busy} onClick={() => void runP2(p2Actions!.accept, [{ key: o.key, priceCents: o.offer.priceCents, version: o.offer.version }])}
            style={{ flex: 2, padding: "9px", borderRadius: 9, border: "none", background: "#3E7C59", color: "#fff", fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}>Hyväksy</button>
          <button disabled={p2Busy} onClick={() => { if (!p2!.termsAccepted) { p2Actions!.requireTerms(); return; } setListCounterKey(o.key); setListCounterVal(""); }}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.ink, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Vastatarjous</button>
          <button disabled={p2Busy} onClick={() => void runP2Free(p2Actions!.decline, o.key, o.offer.version)}
            style={{ padding: "9px 11px", borderRadius: 9, border: "none", background: "transparent", color: T.muted, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Ei</button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, color: T.ink }}>
      <style>{`
        @keyframes cfmZone{0%,100%{box-shadow:0 0 0 4px rgba(62,124,89,0.16)}50%{box-shadow:0 0 0 9px rgba(62,124,89,0.04)}}
        @keyframes cfmPillPop{0%{transform:translate(-50%,9px) scale(0.4);opacity:0}60%{transform:translate(-50%,9px) scale(1.18)}100%{transform:translate(-50%,9px) scale(1);opacity:1}}
        @keyframes cfmLockPulse{0%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 0 rgba(62,124,89,0.5)}70%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 10px rgba(62,124,89,0)}100%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 0 rgba(62,124,89,0)}}
        @keyframes cfmAddNudge{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
        @keyframes cfmMineHalo{0%,100%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(31,59,87,0.35)}50%{box-shadow:0 0 0 2px #fff,0 0 0 7px rgba(31,59,87,0.08)}}
        @keyframes cfmFocus{0%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(31,59,87,0.9)}70%{box-shadow:0 0 0 2px #fff,0 0 0 15px rgba(31,59,87,0)}100%{box-shadow:0 0 0 2px #fff,0 0 0 0 rgba(31,59,87,0)}}
        @media (prefers-reduced-motion: reduce){
          [data-cfm-anim]{animation:none !important}
        }
      `}</style>

      {/* "Work happening here now" banner */}
      {activeZone && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, padding: "9px 13px", borderRadius: 11, background: "#EAF6EE", border: "1px solid #BFE3CC", color: "#1F5B36", fontSize: 13 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3E7C59", animation: "ppPulse 1.8s ease-in-out infinite", flexShrink: 0 }} />
          <span>Työn alla juuri nyt{activeZone.label ? `: ${activeZone.label}` : ""} — <strong>kerros {activeZone.floor}</strong></span>
          {floor !== activeZone.floor && (
            <button onClick={() => setFloor(activeZone.floor)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#1F5B36", fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline", fontFamily: FONT }}>
              Näytä
            </button>
          )}
        </div>
      )}

      {/* Toolbar — a clean, always-aligned two-row layout so it never wraps into
          an awkward shape on mobile: the floor tabs scroll horizontally on their
          own row, and the filter + progress sit on a tidy second row. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 4, background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 11, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.12em", color: T.muted, padding: "0 6px 0 8px", flexShrink: 0 }}>KRS</span>
          {floors.map((f) => {
            const active = f === floor;
            return (
              <button
                key={f}
                onClick={() => setFloor(f)}
                style={{ minWidth: 34, height: 30, padding: "0 8px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: active ? 700 : 600, background: active ? T.card : "transparent", color: active ? T.ink : T.muted, boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all .15s", flexShrink: 0 }}
              >
                {f}
              </button>
            );
          })}
        </div>
        {/* Progress as a percentage only — the customer never sees raw window
            counts (those are internal; the agreed price is fixed regardless). */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {p2On && yellowCount > 0 ? (
            <button
              onClick={() => setOnlyYellow((v) => !v)}
              title="Näytä kartalla vain Priority 2 -ikkunat (keltaiset)"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, border: `1px solid ${onlyYellow ? "#E0A800" : T.hair}`, background: onlyYellow ? "rgba(224,168,0,0.14)" : T.card, color: onlyYellow ? "#8A6A00" : T.muted, flexShrink: 0 }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#E0A800" }} />
              {onlyYellow ? "Näytä kaikki" : "Vain Priority 2"}
            </button>
          ) : <span />}
          <div style={{ fontSize: 13, color: T.muted, textAlign: "right" }}>
            Pesty <strong style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{pct} %</strong> tästä kerroksesta
          </div>
        </div>
      </div>

      {/* Plan + dots — white background, black walls. The plan PNG is a light
          line drawing on a transparent background (built to read on the dark
          worker view), so on this light view we invert it to draw the walls in
          black on white for clear contrast. */}
      <div
        ref={mapRef}
        onPointerDown={onPtrDown}
        onPointerMove={onPtrMove}
        onPointerUp={onPtrUp}
        onPointerCancel={onPtrUp}
        style={{ position: "relative", borderRadius: 12, border: `1px solid ${T.hair}`, background: "#FFFFFF", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", scrollMarginTop: 12, touchAction: addMode ? "auto" : "none", cursor: addMode ? undefined : dragging ? "grabbing" : "grab" }}
      >
        {/* Zoom controls — pinch/wheel also work; these are the always-visible fallback. */}
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={() => zoomBy(1.35)} aria-label="Lähennä" title="Lähennä" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${T.hair}`, background: "rgba(255,255,255,0.95)", color: T.ink, fontSize: 19, fontWeight: 700, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>+</button>
          <button onClick={() => zoomBy(1 / 1.35)} aria-label="Loitonna" title="Loitonna" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${T.hair}`, background: "rgba(255,255,255,0.95)", color: T.ink, fontSize: 19, fontWeight: 700, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>−</button>
          {zoomed && (
            <button onClick={resetView} aria-label="Palauta" title="Palauta näkymä" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${T.hair}`, background: "rgba(255,255,255,0.95)", color: T.muted, fontSize: 15, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>⟲</button>
          )}
        </div>
        <div style={{ position: "relative", display: "inline-block", lineHeight: 0, maxWidth: "100%", transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "center center", transition: dragging ? "none" : "transform .15s ease-out", willChange: "transform" }}>
          <img
            src={`${map.building.planBase}${floor}.png`}
            alt={`Pohjapiirros, kerros ${floor}`}
            style={{ display: "block", maxWidth: "100%", maxHeight: 560, width: "auto", height: "auto", userSelect: "none", clipPath: "inset(2%)", WebkitClipPath: "inset(2%)", filter: "invert(1)", pointerEvents: "none" } as React.CSSProperties}
            draggable={false}
          />
          <div
            style={{ position: "absolute", inset: 0, cursor: p2On && addMode ? "crosshair" : undefined }}
            onClick={p2On && addMode ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
              setAddMode(false);
              void runP2Free(p2Actions!.addPoint, floor, x, y);
            } : undefined}
          >
            {points.map((pt) => {
              const status = map.statuses[pt.key] || "ei";
              const isYellow = pt.p === 2;
              if (p2On && onlyYellow && !isYellow) return null;

              // ── Priority 2 windows in phase-2: a clean NUMBERED badge, colour-
              //    coded by negotiation state. No price pills — the euro amounts
              //    live in the decision list below (the map just locates a window
              //    by its number and shows its state at a glance).
              if (p2On && isYellow && !addMode) {
                const offer = p2!.offers[pt.key];
                const state: P2BadgeState = offer && offer.status !== "declined"
                  ? offer.status
                  : offer ? "declined" : "none";
                const num = p2Number[pt.key];
                const mine = customerAdded.has(pt.key);
                const { bg, fg, border } = p2BadgeStyle(state);
                const focused = focusKey === pt.key;
                return (
                  <button
                    key={pt.key}
                    data-cfm-anim={focused || (mine && state === "none") ? "" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setOpenOffer({ key: pt.key, rect: r });
                      setP2Error(null);
                    }}
                    title={`Ikkuna ${num}${mine ? " · ehdottamasi" : ""} — napauta`}
                    style={{
                      position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                      transform: "translate(-50%, -50%)",
                      minWidth: 20, height: 20, padding: "0 4px", borderRadius: 999,
                      background: bg, color: fg, border: `2px solid ${border}`,
                      fontFamily: FONT, fontSize: 11, fontWeight: 800, lineHeight: 1,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontVariantNumeric: "tabular-nums",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                      zIndex: focused ? 9 : state === "locked" ? 4 : 6,
                      animation: focused
                        ? "cfmFocus 1.3s ease-out 2"
                        : mine && state === "none" ? "cfmMineHalo 2.4s ease-in-out infinite" : undefined,
                    }}
                  >
                    {state === "locked" ? "✓" : num}
                  </button>
                );
              }

              // ── Priority 1 (red) windows — plain status dot; faded right back
              //    during phase-2 so the numbered extra windows carry the map.
              const color = dotColor(pt.p, status);
              const done = status === "pesty";
              return (
                <span
                  key={pt.key}
                  title={`Ikkuna · ${done ? "Pesty" : status === "kesken" ? "Kesken" : "Pesemättä"}`}
                  style={{
                    position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: 13, height: 13, borderRadius: "50%", background: color,
                    border: "2px solid #fff",
                    boxShadow: done ? `0 0 0 1px ${color}, 0 1px 3px rgba(0,0,0,0.25)` : "0 1px 2px rgba(0,0,0,0.18)",
                    opacity: p2On ? 0.3 : status === "ei" ? 0.8 : 1,
                    transition: "opacity .3s",
                  }}
                />
              );
            })}

            {/* Observation badges — tappable marker on windows the crew noted.
                Näkyvät MYÖS 2. vaiheen aikana: jos ikkunasta on huomautettavaa
                (esim. vaikea pääsy, rikkinäinen tiiviste), asiakkaan pitää nähdä
                se juuri kun hän päättää hinnasta. Teksti näkyy myös hintakuplassa. */}
            {points.map((pt) => observations[pt.key] ? (
              <button
                key={`obs-${pt.key}`}
                onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setOpenObs({ key: pt.key, rect: r }); }}
                title="Huomio tästä ikkunasta"
                aria-label="Näytä huomio"
                style={{
                  position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, transform: "translate(2px, -14px)",
                  width: 16, height: 16, borderRadius: "50%", padding: 0, cursor: "pointer",
                  background: "#fff", border: `1.5px solid ${T.navy}`, color: T.navy,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, lineHeight: 1,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)", zIndex: 4,
                }}
              >
                💬
              </button>
            ) : null)}

            {/* Navigation markers / notes (ladders, entrances, hazards, …) —
                also hidden in Priority 2 planning to keep the map uncluttered. */}
            {!p2On && floorNotes.map((n) => (
              <span
                key={n.key}
                title={`${NOTE_KINDS[n.kind].label}${n.text ? " — " + n.text : ""}`}
                style={{
                  position: "absolute", left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)",
                  width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, background: "#FFFFFF", border: `1.5px solid ${n.kind === "warning" ? "#E0A800" : T.hair}`,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                }}
              >
                {NOTE_KINDS[n.kind].glyph}
              </span>
            ))}

            {/* Active work zone — pulsing highlight of where work is happening now */}
            {activeZone && activeZone.floor === floor && (
              <span
                title={activeZone.label ? `Työn alla: ${activeZone.label}` : "Työn alla nyt"}
                style={{
                  position: "absolute", left: `${activeZone.x}%`, top: `${activeZone.y}%`, transform: "translate(-50%,-50%)",
                  width: 26, height: 26, borderRadius: "50%", background: "rgba(62,124,89,0.16)", border: "2px solid #3E7C59",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, animation: "cfmZone 1.8s ease-in-out infinite",
                }}
              >
                🎯
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Organized Priority 2 list — the clean way to review + respond to every
          window across all floors, grouped by what needs your attention. */}
      {p2On && (proposedList.length + counteredList.length + lockedList.length) > 0 && (
        <div style={{ marginTop: 16, borderRadius: 14, border: `1px solid ${T.hair}`, background: T.card, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 15px", borderBottom: `1px solid ${T.hair}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Priority 2 -ikkunat</span>
            {lockedList.length > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#3E7C59", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {lockedList.length} sovittu · {eur(lockedSum)}
              </span>
            )}
          </div>

          {/* Odottaa sinua — avoimet hintaehdotukset, RYHMITELTY KERROKSITTAIN.
              Asiakas voi hyväksyä kerroksen kerrallaan (kerroskohtainen nappi)
              tai kaikki yhdellä. */}
          {proposedList.length > 0 && (
            <div style={{ padding: "12px 15px", borderBottom: (counteredList.length || lockedList.length) ? `1px solid ${T.hair}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.navy }} /> Odottaa sinua · {proposedList.length}
                </span>
                {proposedFloors.length > 1 && (
                  <button
                    disabled={p2Busy}
                    onClick={() => void runP2(p2Actions!.accept, proposedList.map((o) => ({ key: o.key, priceCents: o.offer.priceCents, version: o.offer.version })))}
                    style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: "#3E7C59", fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                  >
                    Hyväksy kaikki ({proposedList.length} · {eur(allProposedSum)})
                  </button>
                )}
              </div>

              {proposedFloors.map((g) => {
                const floorSum = g.items.reduce((s, o) => s + o.offer.priceCents, 0);
                return (
                  <div key={g.floor} style={{ marginBottom: 14 }}>
                    {/* Kerroksen otsikko + "Hyväksy kerros" */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: T.ink }}>
                        <span style={{ minWidth: 30, height: 22, padding: "0 7px", borderRadius: 7, background: T.paper, border: `1px solid ${T.hair}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: T.navy }}>{g.floor}</span>
                        {floorLabel(g.floor)} · {g.items.length} ikkunaa
                      </span>
                      <button
                        disabled={p2Busy}
                        onClick={() => void runP2(p2Actions!.accept, g.items.map((o) => ({ key: o.key, priceCents: o.offer.priceCents, version: o.offer.version })))}
                        style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: "none", background: "#3E7C59", color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                      >
                        Hyväksy kerros ({g.items.length} · {eur(floorSum)})
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {g.items.map(renderProposedRow)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Vastatarjouksesi — odottaa meidän vastausta */}
          {counteredList.length > 0 && (
            <div style={{ padding: "12px 15px", borderBottom: lockedList.length ? `1px solid ${T.hair}` : "none" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#8A6A00", marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E0A800" }} /> Vastatarjouksesi · {counteredList.length}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {counteredList.map((o) => (
                  <div key={o.key} ref={(el) => { listRowRefs.current[o.key] = el; }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: hiRow === o.key ? "rgba(224,168,0,0.16)" : T.paper, border: `1px solid ${hiRow === o.key ? "#E0A800" : T.hair}`, flexWrap: "wrap", transition: "background .4s, border-color .4s", scrollMarginTop: 12 }}>
                    <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: "50%", background: "#E0A800", color: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{p2Number[o.key] ?? o.idx + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{floorLabel(o.floor)} · ikkuna {p2Number[o.key] ?? o.idx + 1}</div>
                      <div style={{ fontSize: 12.5, color: T.muted, fontVariantNumeric: "tabular-nums" }}>Ehdotus {eur(o.offer.priceCents)} · sinun {eur(o.offer.counterCents ?? 0)}</div>
                    </div>
                    <button onClick={() => jumpToMap(o.key, o.floor)} title="Näytä kartalla" style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.navy, fontFamily: FONT, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Kartalla</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sovitut — lukitut hinnat (tiivis yhteenveto) */}
          {lockedList.length > 0 && (
            <div style={{ padding: "12px 15px", display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: "#EAF6EE", border: "1px solid #BFE3CC", display: "flex", alignItems: "center", justifyContent: "center", color: "#3E7C59", fontSize: 13, fontWeight: 800 }}>✓</span>
              <span style={{ fontSize: 13, color: T.ink }}>
                <strong>{lockedList.length}</strong> sovittua Priority 2 -ikkunaa · yhteensä <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(lockedSum)}</strong>
              </span>
            </div>
          )}
          {/* Virheet listatoiminnoista (esim. hinta ehti muuttua) — näkyy vain
              kun offer-popup ei ole auki (muuten virhe näkyy siellä). */}
          {p2Error && !openOffer && (
            <div style={{ padding: "0 15px 12px", fontSize: 12.5, color: "#B4231F", lineHeight: 1.5 }}>{p2Error}</div>
          )}
        </div>
      )}

      {/* P2 quick actions: a prominent "add a window" nudge that openly invites
          the customer to bring more windows into scope. */}
      {p2On && (
        <div style={{ marginTop: 12 }}>
          {/* The add-window CTA: a warm, obvious invitation. When the customer
              hasn't engaged at all yet, it grows into an empty-state that
              actively expects them to add windows. */}
          {addMode ? (
            <button
              disabled={p2Busy}
              onClick={() => setAddMode(false)}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1.5px solid #3E7C59", background: "#EAF6EE", color: "#1F5B36", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              👆 Napauta kartalta ikkunan kohta — tai peru tästä
            </button>
          ) : (
            <div style={{ borderRadius: 12, border: `1.5px dashed ${T.navy}55`, background: "linear-gradient(160deg, rgba(31,59,87,0.05), rgba(224,168,0,0.06))", padding: 14 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: T.ink }}>
                Lisää ikkunoita Priority 2:seen
              </p>
              <p style={{ margin: "4px 0 10px", fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
                Napauta pohjapiirrosta ja merkitse ikkunat, jotka haluat mukaan Priority 2 -vaiheeseen.
                Hinnoittelemme jokaisen erikseen, ja päätät itse mitkä otetaan. Voit lisätä niitä vapaasti.
              </p>
              <button
                disabled={p2Busy}
                data-cfm-anim=""
                onClick={() => setAddMode(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 11, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer", animation: anyYellowActivity ? undefined : "cfmAddNudge 2.4s ease-in-out infinite" }}
              >
                <span style={{ fontSize: 17, lineHeight: 1 }}>➕</span> Lisää ikkuna Priority 2:seen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 14, alignItems: "center" }}>
        {(p2On ? LEGEND_P2 : LEGEND).map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: T.muted }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: l.color, border: "2px solid #fff", boxShadow: `0 0 0 1px ${T.hair}` }} />
            {l.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.muted }}>Päivittyy automaattisesti</span>
      </div>

      {/* P2 window popup — PLANNING ONLY. Tapping a numbered badge tells you which
          window it is and its current state; the actual price decisions (accept /
          counter / decline) live in the list below, reached via "Näytä listassa".
          This keeps the map a clean planning surface. */}
      {p2On && openOffer && (
        <>
          <div onClick={closeOffer} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ ...popupStyle(openOffer.rect, 260, 170), width: 260, background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, boxShadow: "0 14px 40px rgba(0,0,0,0.22)", padding: 16, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{p2Number[openOffer.key] ?? "?"}</span>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>{floorLabel(openOffer.key.split("#")[0])} · ikkuna {p2Number[openOffer.key] ?? "?"}</span>
              <button onClick={closeOffer} aria-label="Sulje" style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            {!openOfferData && (
              <>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.muted }}>
                  {openOfferIsMine
                    ? "Kiitos ehdotuksesta! Hinnoittelemme tämän ikkunan pian — saat hintaehdotuksen tähän."
                    : "Ei vielä hinnoiteltu — saat hintaehdotuksen tähän ikkunaan pian."}
                </p>
                {openOfferIsMine && (
                  <button
                    disabled={p2Busy}
                    onClick={() => void runP2Free(p2Actions!.removePoint, openOffer.key)}
                    style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.muted, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                  >
                    Poista ehdottamani ikkuna
                  </button>
                )}
              </>
            )}

            {openOfferData?.status === "locked" && (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                Sovittu hinta <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.lockedCents ?? openOfferData.priceCents)}</strong>
                <span style={{ color: "#3E7C59", fontWeight: 700 }}> ✓</span><br />
                <span style={{ fontSize: 12.5, color: T.muted }}>
                  {map.statuses[openOffer.key] === "pesty" ? "Ikkuna on pesty." : "Ikkuna on työjonossa."}
                </span>
              </p>
            )}

            {openOfferData?.status === "declined" && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.muted }}>
                Ei tilattu. Jos muutat mieltäsi, laita meille viestiä — teemme uuden ehdotuksen.
              </p>
            )}

            {openOfferData?.status === "countered" && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6 }}>
                  Ehdotuksemme: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.priceCents)}</strong><br />
                  Sinun tarjouksesi: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.counterCents ?? 0)}</strong><br />
                  <span style={{ fontSize: 12.5, color: T.muted }}>Odottaa vastaustamme.</span>
                </p>
                <button
                  onClick={() => jumpToList(openOffer.key)}
                  style={{ width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.navy, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Näytä listassa ↓
                </button>
              </>
            )}

            {openOfferData?.status === "proposed" && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 }}>
                  Hintaehdotus: <strong style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.priceCents)}</strong>
                  <span style={{ fontSize: 12, color: T.muted }}> / ikkuna</span><br />
                  <span style={{ fontSize: 12.5, color: T.muted }}>Voit hyväksyä tai tehdä vastatarjouksen listassa.</span>
                </p>
                <button
                  onClick={() => jumpToList(openOffer.key)}
                  style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Näytä listassa ↓
                </button>
              </>
            )}

            {/* Tekijän huomio tästä ikkunasta — samassa kuplassa kuin hinta, jotta
                asiakas näkee sen päättäessään. Näkyy vain jos joku on kirjoittanut. */}
            {(() => {
              const obs = observations[openOffer.key];
              if (!obs || (!obs.text?.trim() && !obs.imageDataUrl)) return null;
              return (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.hair}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12 }}>💬</span>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.muted }}>Huomio ikkunasta</span>
                  </div>
                  {obs.text?.trim() && (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: T.navy, whiteSpace: "pre-wrap" }}>{obs.text.trim()}</p>
                  )}
                  {obs.imageDataUrl && (
                    <img src={obs.imageDataUrl} alt="Huomion kuva" style={{ display: "block", width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 10, marginTop: obs.text?.trim() ? 8 : 0, border: `1px solid ${T.hair}` }} />
                  )}
                </div>
              );
            })()}

            {p2Error && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#B4231F", lineHeight: 1.5 }}>{p2Error}</p>
            )}
          </div>
        </>
      )}

      {/* Window observation popup — small, dismissible, anchored over the dot */}
      {openObs && openObservation && (
        <>
          <div onClick={() => setOpenObs(null)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ ...popupStyle(openObs.rect, 250, openObservation.imageDataUrl ? 280 : 130), width: 250, background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, boxShadow: "0 14px 40px rgba(0,0,0,0.22)", padding: 14, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15 }}>💬</span>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>Huomio ikkunasta</span>
              <button onClick={() => setOpenObs(null)} aria-label="Sulje" style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            {openObservation.text && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.ink, whiteSpace: "pre-wrap" }}>{openObservation.text}</p>
            )}
            {openObservation.imageDataUrl && (
              <img src={openObservation.imageDataUrl} alt="Huomion kuva" style={{ display: "block", width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 10, marginTop: openObservation.text ? 10 : 0, border: `1px solid ${T.hair}` }} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
