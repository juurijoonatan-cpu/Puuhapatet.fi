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

const LEGEND_P2: { label: string; color: string }[] = [
  { label: "Pesemättä", color: "#F4A6C0" },
  { label: "Kesken", color: "#7C5CD6" },
  { label: "Pesty", color: "#E03B3B" },
  { label: "Lisäikkuna — hinta sovitaan ikkunakohtaisesti", color: "#D9C97E" },
];

/** P2 offer pill colors by status. */
function p2PillStyle(status: P2PublicOffer["status"]): { bg: string; fg: string } {
  switch (status) {
    case "proposed":  return { bg: T.navy,    fg: "#fff" };
    case "countered": return { bg: "#E0A800", fg: "#1A1A1A" };
    case "locked":    return { bg: "#3E7C59", fg: "#fff" };
    case "declined":  return { bg: "#C9C6BC", fg: "#5A584F" };
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
  const [counterInput, setCounterInput] = useState("");
  const [showCounterInput, setShowCounterInput] = useState(false);
  const [p2Busy, setP2Busy] = useState(false);
  const [p2Error, setP2Error] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  // When planning phase-2, let the customer focus the map on just the extra
  // (yellow) windows — the reds are done, so this keeps the negotiation clean.
  const [onlyYellow, setOnlyYellow] = useState(false);
  const openOfferData = openOffer && p2 ? p2.offers[openOffer.key] ?? null : null;
  const customerAdded = p2On ? new Set(p2!.customerAddedKeys) : new Set<string>();
  const openOfferIsMine = openOffer ? customerAdded.has(openOffer.key) : false;
  // Open proposals on THIS floor (for the one-tap batch accept).
  const floorProposed = p2On
    ? points.filter((pt) => pt.p === 2 && p2!.offers[pt.key]?.status === "proposed")
    : [];
  const floorProposedSum = floorProposed.reduce((s, pt) => s + (p2!.offers[pt.key]?.priceCents ?? 0), 0);
  // Has the customer engaged with phase-2 yet (any yellow priced or added)?
  // Drives an inviting empty-state nudge that expects them to add windows.
  const yellowCount = p2On ? points.filter((pt) => pt.p === 2).length : 0;
  const anyYellowActivity = p2On && points.some((pt) => pt.p === 2 && p2!.offers[pt.key]);

  const closeOffer = () => { setOpenOffer(null); setShowCounterInput(false); setCounterInput(""); setP2Error(null); };

  async function runP2<A extends unknown[]>(fn: (...args: A) => Promise<string | null>, ...args: A) {
    if (!p2Actions) return;
    if (!p2?.termsAccepted) { p2Actions.requireTerms(); return; }
    setP2Busy(true); setP2Error(null);
    const err = await fn(...args);
    setP2Busy(false);
    if (err) setP2Error(err);
    else closeOffer();
  }

  return (
    <div style={{ fontFamily: FONT, color: T.ink }}>
      <style>{`
        @keyframes cfmZone{0%,100%{box-shadow:0 0 0 4px rgba(62,124,89,0.16)}50%{box-shadow:0 0 0 9px rgba(62,124,89,0.04)}}
        @keyframes cfmPillPop{0%{transform:translate(-50%,9px) scale(0.4);opacity:0}60%{transform:translate(-50%,9px) scale(1.18)}100%{transform:translate(-50%,9px) scale(1);opacity:1}}
        @keyframes cfmLockPulse{0%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 0 rgba(62,124,89,0.5)}70%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 10px rgba(62,124,89,0)}100%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 0 rgba(62,124,89,0)}}
        @keyframes cfmAddNudge{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
        @keyframes cfmMineHalo{0%,100%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(31,59,87,0.35)}50%{box-shadow:0 0 0 2px #fff,0 0 0 7px rgba(31,59,87,0.08)}}
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
        {/* Progress as a percentage only — the customer never sees raw window
            counts (those are internal; the agreed price is fixed regardless). */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {p2On && yellowCount > 0 && (
            <button
              onClick={() => setOnlyYellow((v) => !v)}
              title="Näytä kartalla vain lisäikkunat (keltaiset)"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, border: `1px solid ${onlyYellow ? "#E0A800" : T.hair}`, background: onlyYellow ? "rgba(224,168,0,0.14)" : T.card, color: onlyYellow ? "#8A6A00" : T.muted }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#E0A800" }} />
              {onlyYellow ? "Näytä kaikki" : "Vain lisäikkunat"}
            </button>
          )}
          <div style={{ fontSize: 13, color: T.muted }}>
            Pesty <strong style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{pct} %</strong> tästä kerroksesta
          </div>
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
          <div
            style={{ position: "absolute", inset: 0, cursor: p2On && addMode ? "crosshair" : undefined }}
            onClick={p2On && addMode ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
              setAddMode(false);
              void runP2(p2Actions!.addPoint, floor, x, y);
            } : undefined}
          >
            {points.map((pt) => {
              const status = map.statuses[pt.key] || "ei";
              const color = dotColor(pt.p, status);
              const done = status === "pesty";
              const tappable = p2On && pt.p === 2 && !addMode;
              // Phase-2 focus: the reds are done, so fade them right back and let
              // the yellow extra windows carry the map. "Vain lisäikkunat" hides
              // the reds entirely.
              const isYellow = pt.p === 2;
              if (p2On && onlyYellow && !isYellow) return null;
              const mine = p2On && isYellow && customerAdded.has(pt.key);
              const dimForFocus = p2On && !isYellow;
              const dot = (
                <span
                  key={pt.key}
                  role={tappable ? "button" : undefined}
                  data-cfm-anim={mine ? "" : undefined}
                  onClick={tappable ? (e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setOpenOffer({ key: pt.key, rect: r });
                    setShowCounterInput(false); setCounterInput(""); setP2Error(null);
                  } : undefined}
                  title={tappable
                    ? (mine ? "Ehdottamasi ikkuna — napauta nähdäksesi tila" : "Lisäikkuna — napauta nähdäksesi hinnan")
                    : `Ikkuna · ${done ? "Pesty" : status === "kesken" ? "Kesken" : "Pesemättä"}`}
                  style={{
                    position: "absolute",
                    left: `${pt.x}%`,
                    top: `${pt.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: isYellow && p2On ? 15 : 13,
                    height: isYellow && p2On ? 15 : 13,
                    borderRadius: "50%",
                    background: color,
                    border: "2px solid #fff",
                    boxShadow: mine
                      ? `0 0 0 2px #fff, 0 0 0 4px rgba(31,59,87,0.35)`
                      : done ? `0 0 0 1px ${color}, 0 1px 3px rgba(0,0,0,0.25)` : "0 1px 2px rgba(0,0,0,0.18)",
                    opacity: dimForFocus ? 0.32 : status === "ei" ? 0.8 : 1,
                    cursor: tappable ? "pointer" : undefined,
                    animation: mine ? "cfmMineHalo 2.4s ease-in-out infinite" : undefined,
                    transition: "opacity .3s",
                  }}
                />
              );
              return dot;
            })}

            {/* P2 price pills — the negotiation state of each yellow window */}
            {p2On && points.map((pt) => {
              if (pt.p !== 2) return null;
              const offer = p2!.offers[pt.key];
              if (!offer || offer.status === "declined") return null;
              const { bg, fg } = p2PillStyle(offer.status);
              const text = offer.status === "locked"
                ? `✓ ${eur(offer.lockedCents ?? offer.priceCents)}`
                : offer.status === "countered"
                  ? `sinun: ${eur(offer.counterCents ?? 0)}`
                  : eur(offer.priceCents);
              return (
                <button
                  key={`p2-${pt.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setOpenOffer({ key: pt.key, rect: r });
                    setShowCounterInput(false); setCounterInput(""); setP2Error(null);
                  }}
                  title="Näytä hintaehdotus"
                  data-cfm-anim=""
                  style={{
                    position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                    transform: "translate(-50%, 9px)",
                    padding: "2px 7px", borderRadius: 999, border: "1.5px solid #fff",
                    background: bg, color: fg, fontFamily: FONT, fontSize: 10, fontWeight: 700,
                    lineHeight: 1.3, whiteSpace: "nowrap", cursor: "pointer",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.28)", zIndex: 5, fontVariantNumeric: "tabular-nums",
                    // Locked windows get a one-shot celebratory pulse; fresh
                    // proposals pop in so a new price never appears silently.
                    animation: offer.status === "locked"
                      ? "cfmLockPulse 1.2s ease-out"
                      : "cfmPillPop 0.35s cubic-bezier(0.22,1,0.36,1)",
                  }}
                >
                  {text}
                </button>
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

      {/* P2 quick actions: batch accept + a prominent "add a window" nudge that
          openly invites the customer to bring more windows into scope. */}
      {p2On && (
        <div style={{ marginTop: 12 }}>
          {floorProposed.length > 0 && (
            <button
              disabled={p2Busy}
              onClick={() => void runP2(p2Actions!.accept, floorProposed.map((pt) => ({
                key: pt.key,
                priceCents: p2!.offers[pt.key]!.priceCents,
                version: p2!.offers[pt.key]!.version,
              })))}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 11, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1, marginBottom: 8 }}
            >
              Hyväksy kaikki ehdotetut tällä kerroksella ({floorProposed.length} kpl · yht. {eur(floorProposedSum)})
            </button>
          )}

          {/* The add-window CTA: a warm, obvious invitation. When the customer
              hasn't engaged at all yet, it grows into an empty-state that
              actively expects them to add windows. */}
          {addMode ? (
            <button
              disabled={p2Busy}
              onClick={() => setAddMode(false)}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1.5px solid #3E7C59", background: "#EAF6EE", color: "#1F5B36", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              👆 Napauta kartalta kohta, johon haluat ikkunan — tai peru tästä
            </button>
          ) : (
            <div style={{ borderRadius: 12, border: `1.5px dashed ${T.navy}55`, background: "linear-gradient(160deg, rgba(31,59,87,0.05), rgba(224,168,0,0.06))", padding: 14 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: T.ink }}>
                {anyYellowActivity ? "Haluatko vielä lisää puhtaita ikkunoita?" : "Toivotko lisää ikkunoita puhtaaksi?"}
              </p>
              <p style={{ margin: "4px 0 10px", fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
                Napauta pohjapiirrosta ja merkitse ikkuna, jonka haluaisit mukaan — hinnoittelemme
                sen sinulle, ja päätät itse otetaanko se. Lisää niin monta kuin haluat.
              </p>
              <button
                disabled={p2Busy}
                data-cfm-anim=""
                onClick={() => {
                  if (!p2?.termsAccepted) { p2Actions!.requireTerms(); return; }
                  setAddMode(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 11, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer", animation: anyYellowActivity ? undefined : "cfmAddNudge 2.4s ease-in-out infinite" }}
              >
                <span style={{ fontSize: 17, lineHeight: 1 }}>➕</span> Ehdota lisättävää ikkunaa
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

      {/* P2 offer popup — the customer's accept / counter / decline actions */}
      {p2On && openOffer && (
        <>
          <div onClick={closeOffer} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ ...popupStyle(openOffer.rect, 270, 220), width: 270, background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, boxShadow: "0 14px 40px rgba(0,0,0,0.22)", padding: 16, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#D9C97E", border: "2px solid #fff", boxShadow: `0 0 0 1px ${T.hair}`, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>{openOfferIsMine ? "Ehdottamasi ikkuna" : "Lisäikkuna"}</span>
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
                    onClick={() => void runP2(p2Actions!.removePoint, openOffer.key)}
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
              <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6 }}>
                Ehdotuksemme: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.priceCents)}</strong><br />
                Sinun tarjouksesi: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.counterCents ?? 0)}</strong><br />
                <span style={{ fontSize: 12.5, color: T.muted }}>Odottaa vastaustamme. Voit myös hyväksyä alkuperäisen hinnan tai muuttaa tarjoustasi.</span>
              </p>
            )}

            {openOfferData?.status === "proposed" && (
              <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 }}>
                Hintaehdotus: <strong style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.priceCents)}</strong>
                <span style={{ fontSize: 12, color: T.muted }}> / ikkuna</span>
              </p>
            )}

            {(openOfferData?.status === "proposed" || openOfferData?.status === "countered") && !p2!.termsAccepted && (
              <button
                onClick={() => { closeOffer(); p2Actions!.requireTerms(); }}
                style={{ width: "100%", padding: "10px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                Hyväksy ensin tilausehdot
              </button>
            )}

            {(openOfferData?.status === "proposed" || openOfferData?.status === "countered") && p2!.termsAccepted && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {openOfferData.status === "proposed" && (
                  <button
                    disabled={p2Busy}
                    onClick={() => void runP2(p2Actions!.accept, [{ key: openOffer.key, priceCents: openOfferData.priceCents, version: openOfferData.version }])}
                    style={{ width: "100%", padding: "10px", borderRadius: 10, border: "none", background: "#3E7C59", color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                  >
                    Hyväksy {eur(openOfferData.priceCents)}
                  </button>
                )}
                {!showCounterInput ? (
                  <button
                    disabled={p2Busy}
                    onClick={() => { setShowCounterInput(true); setCounterInput(openOfferData.counterCents ? String(openOfferData.counterCents / 100) : ""); }}
                    style={{ width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    {openOfferData.status === "countered" ? "Muuta tarjoustasi" : "Tee vastatarjous"}
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="number" inputMode="decimal" min={1} step="0.5"
                      value={counterInput}
                      onChange={(e) => setCounterInput(e.target.value)}
                      placeholder="€ / ikkuna"
                      style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 10, border: `1px solid ${T.hair}`, fontFamily: FONT, fontSize: 14, fontVariantNumeric: "tabular-nums" }}
                    />
                    <button
                      disabled={p2Busy || !(Number(counterInput.replace(",", ".")) > 0)}
                      onClick={() => {
                        const eurVal = Number(counterInput.replace(",", "."));
                        if (!(eurVal > 0)) return;
                        void runP2(p2Actions!.counter, openOffer.key, Math.round(eurVal * 100), openOfferData.version);
                      }}
                      style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: T.navy, color: "#fff", fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                    >
                      Lähetä
                    </button>
                  </div>
                )}
                {openOfferData.status === "proposed" && (
                  <button
                    disabled={p2Busy}
                    onClick={() => void runP2(p2Actions!.decline, openOffer.key, openOfferData.version)}
                    style={{ width: "100%", padding: "8px", borderRadius: 10, border: "none", background: "transparent", color: T.muted, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    Ei kiitos — jätä pois
                  </button>
                )}
              </div>
            )}

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
