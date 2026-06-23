/**
 * Read-only floor-plan map for the customer live view (/seuranta/:token).
 *
 * Deliberately a separate, lightweight component from the worker/admin
 * FloorView (which is dark-themed and fully editable). This one is WHITE,
 * read-only — no drag, no add/delete, no status popovers — so the customer
 * can only watch which windows have been washed. It shares the exact same
 * dot coordinate scheme as FloorView so the markers line up identically.
 */

import { useMemo, useState } from "react";
import type { GigPublicView } from "@/lib/api";
import { NOTE_KINDS } from "@shared/project";

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

export default function CustomerFloorMap({ map }: { map: MapData }) {
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

  return (
    <div style={{ fontFamily: FONT, color: T.ink }}>
      <style>{`@keyframes cfmZone{0%,100%{box-shadow:0 0 0 4px rgba(62,124,89,0.16)}50%{box-shadow:0 0 0 9px rgba(62,124,89,0.04)}}`}</style>

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

      {/* Floor selector + progress */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 4, background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 11 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.12em", color: T.muted, padding: "0 6px 0 8px" }}>KRS</span>
          {floors.map((f) => {
            const active = f === floor;
            return (
              <button
                key={f}
                onClick={() => setFloor(f)}
                style={{ minWidth: 32, height: 30, padding: "0 6px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 13.5, fontWeight: active ? 700 : 600, background: active ? T.card : "transparent", color: active ? T.ink : T.muted, boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all .15s" }}
              >
                {f}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 13, color: T.muted }}>
          Pesty <strong style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{washed}</strong> / {total} ({pct} %)
        </div>
      </div>

      {/* Plan + dots — white background, black walls. The plan PNG is a light
          line drawing on a transparent background (built to read on the dark
          worker view), so on this light view we invert it to draw the walls in
          black on white for clear contrast. */}
      <div style={{ position: "relative", borderRadius: 12, border: `1px solid ${T.hair}`, background: "#FFFFFF", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <div style={{ position: "relative", display: "inline-block", lineHeight: 0, maxWidth: "100%" }}>
          <img
            src={`${map.building.planBase}${floor}.png`}
            alt={`Pohjapiirros, kerros ${floor}`}
            style={{ display: "block", maxWidth: "100%", maxHeight: 560, width: "auto", height: "auto", userSelect: "none", clipPath: "inset(2%)", WebkitClipPath: "inset(2%)", filter: "invert(1)" } as React.CSSProperties}
            draggable={false}
          />
          <div style={{ position: "absolute", inset: 0 }}>
            {points.map((pt) => {
              const status = map.statuses[pt.key] || "ei";
              const color = dotColor(pt.p, status);
              const done = status === "pesty";
              return (
                <span
                  key={pt.key}
                  title={`Ikkuna · ${done ? "Pesty" : status === "kesken" ? "Kesken" : "Pesemättä"}`}
                  style={{
                    position: "absolute",
                    left: `${pt.x}%`,
                    top: `${pt.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: color,
                    border: "2px solid #fff",
                    boxShadow: done ? `0 0 0 1px ${color}, 0 1px 3px rgba(0,0,0,0.25)` : "0 1px 2px rgba(0,0,0,0.18)",
                    opacity: status === "ei" ? 0.8 : 1,
                  }}
                />
              );
            })}

            {/* Observation badges — tappable marker on windows the crew noted */}
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

            {/* Navigation markers / notes (ladders, entrances, hazards, …) */}
            {floorNotes.map((n) => (
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

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 14, alignItems: "center" }}>
        {LEGEND.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: T.muted }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: l.color, border: "2px solid #fff", boxShadow: `0 0 0 1px ${T.hair}` }} />
            {l.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.muted }}>Päivittyy automaattisesti</span>
      </div>

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
