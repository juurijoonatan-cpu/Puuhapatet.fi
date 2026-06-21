/**
 * FR8 projektinäkymä — overview dashboard (ported from fr8-ikkunat prototype).
 * Adds a per-worker "TEKIJÄT" strip (window counts + €/h optimisation).
 */
import { allPoints, computeDealBilling, type ProjectData, type WindowStatus, type WorkerStat, type FixedDeal } from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState, useEffect } from "react";

interface Props {
  project: ProjectData;
  workerStats: WorkerStat[];
  workerName: (id: string) => string;
  onGoToFloor: (floor: string) => void;
  /** When set, a signed fixed-price deal drives the money figures (FR8). */
  deal?: FixedDeal | null;
  /** Manually set/clear a person's earnings (founders' agreed split). */
  onSetEarnings?: (id: string, cents: number | null) => void;
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function euro(n: number) { return fmt(n) + " €"; }
/** Per-window price — keeps cents (e.g. "37,50 €") so 37.5 never rounds to 38. */
function euroUnit(n: number) {
  return n.toLocaleString("fi-FI", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + " €";
}
function ago(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "juuri nyt";
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h";
  return Math.floor(s / 86400) + " pv";
}
function statusLabel(s: WindowStatus) { return s === "pesty" ? "Pesty" : s === "kesken" ? "Kesken" : "Ei pesty"; }
function colorRgb(p: 1 | 2, status: WindowStatus) {
  if (status === "pesty") return p === 1 ? "255,72,72" : "255,205,40";
  if (status === "kesken") return "188,150,255";
  return p === 1 ? "255,140,178" : "240,226,150";
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};
const mono: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  fontSize: "11px",
  letterSpacing: "0.14em",
  color: "rgba(255,255,255,0.4)",
};

export default function Dashboard({ project, workerStats, workerName, onGoToFloor, deal, onSetEarnings }: Props) {
  const m = useIsMobile();
  const [showLog, setShowLog] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [openSessions, setOpenSessions] = useState<string | null>(null);
  const crewMemberOf = (id: string) => (project.crew || []).find((c) => c.id === id);
  // Live clock for "shift running" indicators (ticks once a minute).
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const shiftStartFor = (id: string) => (project.crew || []).find((c) => c.id === id)?.activeShiftAt;
  const fmtDur = (ms: number) => {
    const min = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(min / 60), mm = min % 60;
    return h > 0 ? `${h} t ${mm} min` : `${mm} min`;
  };
  const FLOORS = project.building.floors;
  const PRICE = deal ? deal.pricePerWindow : project.pricePerWindow;
  const CIRC = 2 * Math.PI * 80;
  // Money model: a signed deal accrues only on the billable priority (red) and
  // is capped at the agreed total; an open gig bills every washed window.
  const billing = deal ? computeDealBilling(project, deal) : null;
  const accruedEur = billing ? billing.accruedCents / 100 : 0;
  const capEur = billing ? billing.capCents / 100 : 0;
  const all = allPoints(project);
  const log = project.log;

  const total = all.length;
  const washed = all.filter((a) => a.status === "pesty").length;
  const kesken = all.filter((a) => a.status === "kesken").length;
  const unwashed = total - washed - kesken;
  const pct = total > 0 ? (washed / total) * 100 : 0;
  const pctStr = Math.round(pct) + " %";

  const grp = (p: 1 | 2) => {
    const arr = all.filter((a) => a.p === p);
    const w = arr.filter((a) => a.status === "pesty").length;
    const k = arr.filter((a) => a.status === "kesken").length;
    const pc = arr.length > 0 ? (w / arr.length) * 100 : 0;
    return { total: arr.length, washed: w, kesken: k, pctStr: Math.round(pc) + " %", pct: pc, revStr: euro(w * PRICE) };
  };
  const p1 = grp(1), p2 = grp(2);

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const todaySet = new Set<string>();
  log.forEach((l) => { if (l.status === "pesty" && l.ts >= startToday.getTime() && (!deal || l.p === deal.billablePriority)) todaySet.add(l.key); });
  const todayWindows = todaySet.size;
  const remaining = total - washed;
  const estStr = remaining === 0 && total > 0 ? "valmis" : todayWindows > 0 ? "~" + Math.ceil(remaining / todayWindows) + " työpv" : "—";

  const activity = log.slice(0, 5).map((l) => {
    const rgb = colorRgb(l.p, l.status);
    const num = l.key.includes("#c") ? " (lisätty)" : " " + (parseInt(l.key.split("#")[1], 10) + 1);
    const who = l.by ? " · " + workerName(l.by) : "";
    return { color: `rgb(${rgb})`, glow: `rgba(${rgb},0.7)`, title: "Ikkuna" + num + " — " + statusLabel(l.status), sub: "Kerros " + l.floor + " · P" + l.p + who, time: ago(l.ts) };
  });

  // Workers with any activity or hours, busiest first.
  const activeWorkers = workerStats
    .filter((s) => s.washed > 0 || s.hours > 0)
    .sort((a, b) => b.washed - a.washed);

  return (
    <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", boxSizing: "border-box", padding: m ? "16px 12px calc(96px + env(safe-area-inset-bottom))" : "26px 30px 40px" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>

        {/* Header */}
        <div style={{ display: "flex", flexDirection: m ? "column" : "row", alignItems: m ? "center" : "flex-end", justifyContent: "space-between", gap: m ? "6px" : "12px", textAlign: m ? "center" : "left", marginBottom: m ? "14px" : "20px" }}>
          <div>
            <div style={{ ...mono, letterSpacing: "0.18em", marginBottom: "7px" }}>KOKONAISTILANNE</div>
            <h1 style={{ margin: 0, fontSize: m ? "22px" : "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>Projektin yleiskatsaus</h1>
          </div>
          <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: m ? "10px" : "11px", color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textAlign: "right", flexShrink: 0 }}>
            {FLOORS.length} KERROSTA · {total > 0 ? total : "…"} IKKUNAA
          </div>
        </div>

        {/* Row 1: ring + revenue */}
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1.35fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div className="anim-fadeUp-0" style={{ ...card, borderRadius: "22px", display: "flex", flexDirection: m ? "column" : "row", gap: m ? "20px" : "26px", alignItems: "center", padding: m ? "22px" : "30px" }}>
            <div style={{ position: "relative", width: "184px", height: "184px", flexShrink: 0 }}>
              <svg width="184" height="184" viewBox="0 0 184 184" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="92" cy="92" r="80" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
                <circle cx="92" cy="92" r="80" fill="none" stroke="#ffffff" strokeWidth="11" strokeLinecap="round"
                  strokeDasharray={`${((pct / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
                  style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: "38px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{pctStr}</div>
                <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>VALMIS</div>
              </div>
            </div>
            <div style={{ flex: 1, width: m ? "100%" : undefined, textAlign: m ? "center" : "left" }}>
              <div style={{ ...mono, marginBottom: "10px" }}>KOKONAISEDISTYMINEN</div>
              <div style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.01em", marginBottom: "2px" }}>
                {washed} <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>/ {total}</span>
              </div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", marginBottom: "20px" }}>ikkunaa pesty</div>
              <div style={{ display: "flex", gap: "10px" }}>
                {([["kesken", "rgb(188,150,255)", "rgba(188,150,255,0.7)", kesken], ["Pesemättä", "rgba(255,255,255,0.4)", undefined, unwashed]] as [string, string, string|undefined, number][]).map(([label, bg, shadow, val]) => (
                  <div key={label} style={{ flex: 1, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "13px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: m ? "center" : "flex-start", gap: "7px", marginBottom: "5px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: bg, boxShadow: shadow ? `0 0 7px ${shadow}` : undefined, flexShrink: 0 }} />
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>{label === "kesken" ? "Kesken" : label}</span>
                    </div>
                    <div style={{ fontSize: "21px", fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Revenue card */}
          <div className="anim-fadeUp-1" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "26px", background: "linear-gradient(155deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "22px", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ ...mono, minWidth: 0 }}>{deal ? "KERTYNYT SUMMA" : "LIIKEVAIHTO"}</div>
              <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10.5px", color: "rgba(255,255,255,0.4)", flexShrink: 0, whiteSpace: "nowrap" }}>
                {euroUnit(PRICE)} / {deal ? "PUNAINEN" : "IKKUNA"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "46px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{euro(deal ? accruedEur : washed * PRICE)}</div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", marginTop: "4px" }}>
                / {euro(deal ? capEur : total * PRICE)} {deal ? "sopimuskatto" : "sopimusarvo"}
                {deal && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8, padding: "1px 7px", borderRadius: 7, background: "rgba(95,224,138,0.12)", border: "1px solid rgba(95,224,138,0.3)", color: "#9ff0bd", fontSize: "10px", fontWeight: 600 }}>🔒 sovittu hinta</span>}
              </div>
            </div>
            <div>
              <div style={{ height: "9px", borderRadius: "6px", background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: "9px" }}>
                <div style={{ width: `${(deal ? billing!.pct : pct).toFixed(1)}%`, height: "100%", borderRadius: "6px", background: "linear-gradient(90deg,rgba(255,255,255,0.55),#fff)", boxShadow: "0 0 12px rgba(255,255,255,0.4)", transition: "width .6s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10.5px", color: "rgba(255,255,255,0.45)" }}>
                <span>{deal ? billing!.billableWashed : washed} × {euroUnit(PRICE)}</span>
                <span>{Math.round(deal ? billing!.pct : pct)} % {deal ? "katosta" : "kerätty"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: P1 + P2 + mini cards */}
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr 1fr" : "1fr 1fr 1fr", gap: m ? "10px" : "16px", marginBottom: "14px" }}>
          {[{ label: "Prioriteetti 1", rgb: "255,72,72", data: p1, p: 1 }, { label: "Prioriteetti 2", rgb: "255,205,40", data: p2, p: 2 }].map((g, gi) => {
            // With a signed deal, only the billable priority (red) earns money;
            // the other priority is mapped for future work, not billed now.
            const outOfDeal = !!deal && g.p !== deal.billablePriority;
            return (
            <div key={g.label} className={`anim-fadeUp-${gi + 2}`} style={{ ...card, padding: "22px", opacity: outOfDeal ? 0.72 : 1 }}>
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                    <span style={{ width: "11px", height: "11px", borderRadius: "50%", flexShrink: 0, background: `rgb(${g.rgb})`, boxShadow: `0 0 10px rgba(${g.rgb},0.8)` }} />
                    <span style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</span>
                  </div>
                  <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>{g.data.pctStr}</span>
                </div>
                {outOfDeal && <span style={{ display: "inline-block", marginTop: 7, fontSize: "9.5px", fontWeight: 600, color: "rgba(255,255,255,0.5)", padding: "2px 7px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)" }}>ei sopimuksessa</span>}
                {!!deal && !outOfDeal && <span style={{ display: "inline-block", marginTop: 7, fontSize: "9.5px", fontWeight: 600, color: "#9ff0bd", padding: "2px 7px", borderRadius: 6, border: "1px solid rgba(95,224,138,0.3)", background: "rgba(95,224,138,0.1)" }}>sopimus</span>}
              </div>
              <div style={{ fontSize: "28px", fontWeight: 700, marginBottom: "3px" }}>
                {g.data.washed} <span style={{ color: "rgba(255,255,255,0.32)", fontWeight: 500, fontSize: "22px" }}>/ {g.data.total}</span>
              </div>
              <div style={{ height: "6px", borderRadius: "5px", background: "rgba(255,255,255,0.08)", overflow: "hidden", margin: "13px 0 14px" }}>
                <div style={{ width: `${g.data.pct.toFixed(1)}%`, height: "100%", borderRadius: "5px", background: `rgb(${g.rgb})`, boxShadow: `0 0 10px rgba(${g.rgb},0.6)`, transition: "width .6s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
                <span>Kesken <b style={{ color: "#fff", fontWeight: 600 }}>{g.data.kesken}</b></span>
                <span>{outOfDeal ? "— ei laskuteta" : g.data.revStr}</span>
              </div>
            </div>
            );
          })}

          <div style={{ display: "flex", flexDirection: m ? "row" : "column", gap: m ? "10px" : "12px", gridColumn: m ? "1 / -1" : undefined }}>
            {[{ label: "TÄNÄÄN TEHTY", val: todayWindows, sub: `ikkunaa · ${euro(todayWindows * PRICE)}`, cls: "anim-fadeUp-4" }, { label: "ARVIO JÄLJELLÄ", val: remaining, sub: `ikkunaa · ${estStr}`, cls: "anim-fadeUp-5" }].map((mc) => (
              <div key={mc.label} className={mc.cls} style={{ ...card, flex: 1, padding: "16px 18px" }}>
                <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", marginBottom: "9px" }}>{mc.label}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "25px", fontWeight: 700 }}>{mc.val}</span>
                  <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>{mc.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Workers strip — per-worker window counts & €/h optimisation */}
        {activeWorkers.length > 0 && (
          <div className="anim-fadeUp-6" style={{ ...card, padding: m ? "18px" : "20px 24px", marginBottom: "14px" }}>
            <div style={{ ...mono, marginBottom: "16px" }}>TEKIJÄT · IKKUNAT & TEHO</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(activeWorkers.length, m ? 2 : 4)}, 1fr)`, gap: m ? "10px" : "12px" }}>
              {activeWorkers.map((s) => {
                const share = washed > 0 ? (s.washed / washed) * 100 : 0;
                const rate = s.washed > 0 ? s.revenueCents / s.washed / 100 : 0; // €/ikkuna (personal pay)
                const shiftStart = shiftStartFor(s.worker);
                const cm = crewMemberOf(s.worker);
                const canEditPay = !!onSetEarnings && cm?.role === "host"; // founders adjust own split
                const overridden = cm?.manualEarningsCents != null;
                const editing = editId === s.worker;
                return (
                  <div key={s.worker} style={{ padding: "16px 18px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "15px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: 8 }}>
                      <span style={{ fontSize: "15px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{workerName(s.worker)}</span>
                      <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>{Math.round(share)} %</span>
                    </div>
                    <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1 }}>
                      {s.washed} <span style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>ikkunaa</span>
                    </div>
                    {shiftStart && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, padding: "3px 9px", borderRadius: 999, background: "rgba(95,224,138,0.12)", border: "1px solid rgba(95,224,138,0.3)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.9)", animation: "fr8-zonePulse 1.8s ease-in-out infinite" }} />
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "#9ff0bd" }}>Vuoro käynnissä · {fmtDur(now - shiftStart)}</span>
                      </div>
                    )}
                    <div style={{ height: "6px", borderRadius: "5px", background: "rgba(255,255,255,0.08)", overflow: "hidden", margin: "12px 0" }}>
                      <div style={{ width: `${share.toFixed(1)}%`, height: "100%", borderRadius: "5px", background: "linear-gradient(90deg,rgba(255,255,255,0.5),#fff)", transition: "width .6s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
                      <span>
                        <b style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>{euro(s.revenueCents / 100)}</b>
                        {overridden
                          ? <span style={{ marginLeft: 6, color: "#9ff0bd", fontSize: 10.5 }}>muokattu</span>
                          : cm?.role === "host" ? " · sis. tuotto-osuus" : ` · ${euroUnit(rate)}/ikkuna`}
                      </span>
                      <span>{s.hours > 0 ? `${euro(s.eurPerHour)}/h · ${s.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} h` : "0 h"}</span>
                    </div>
                    {canEditPay && !editing && (
                      <button onClick={() => { setEditId(s.worker); setEditVal(overridden ? String(Math.round((cm!.manualEarningsCents! / 100))) : String(Math.round(s.revenueCents / 100))); }}
                        style={{ marginTop: 10, width: "100%", padding: "7px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
                        Muokkaa ansiota
                      </button>
                    )}
                    {canEditPay && editing && (
                      <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
                        <input value={editVal} onChange={(e) => setEditVal(e.target.value)} inputMode="decimal" autoFocus
                          style={{ width: 64, padding: "7px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: "13px", textAlign: "right", fontFamily: "var(--font-onest, system-ui, sans-serif)" }} />
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>€</span>
                        <button onClick={() => { const v = parseFloat(editVal.replace(",", ".")); onSetEarnings!(s.worker, Number.isFinite(v) ? Math.round(v * 100) : null); setEditId(null); }}
                          style={{ flex: 1, padding: "7px", borderRadius: 8, border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Tallenna</button>
                        {overridden && (
                          <button onClick={() => { onSetEarnings!(s.worker, null); setEditId(null); }} title="Palauta laskettu"
                            style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: "12px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>↺</button>
                        )}
                      </div>
                    )}
                    {/* Per-worker session / day log (managers only) */}
                    {(cm?.sessions?.length ?? 0) > 0 && (
                      <>
                        <button onClick={() => setOpenSessions(openSessions === s.worker ? null : s.worker)}
                          style={{ marginTop: 10, width: "100%", padding: "6px", borderRadius: 8, border: "none", background: "transparent", color: "rgba(255,255,255,0.45)", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.06em" }}>
                          PÄIVÄKIRJA ({cm!.sessions!.length}) {openSessions === s.worker ? "▲" : "▾"}
                        </button>
                        {openSessions === s.worker && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                            {[...cm!.sessions!].reverse().slice(0, 10).map(( se, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11.5px", color: "rgba(255,255,255,0.6)", padding: "5px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                                <span>{new Date(se.end).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" })} · {se.windows} ikk · {fmtDur(se.minutes * 60000)}</span>
                                <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{euro(se.earnedCents / 100)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 3: floor breakdown (activity log is tucked away below) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: m ? "14px" : "16px" }}>
          <div className="anim-fadeUp-7" style={{ ...card, padding: m ? "18px" : "22px 24px" }}>
            <div style={{ ...mono, marginBottom: "16px" }}>KERROKSITTAIN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {FLOORS.map((f) => {
                const arr = all.filter((a) => a.floor === f);
                const w = arr.filter((a) => a.status === "pesty").length;
                const pc = arr.length > 0 ? (w / arr.length) * 100 : 0;
                return (
                  <button key={f} className="floor-row-btn" onClick={() => onGoToFloor(f)}>
                    <span style={{ width: "34px", height: "34px", flexShrink: 0, borderRadius: "9px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px" }}>{f}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ height: "7px", borderRadius: "5px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div style={{ width: `${pc.toFixed(1)}%`, height: "100%", borderRadius: "5px", background: "linear-gradient(90deg,rgba(255,255,255,0.5),#fff)", transition: "width .6s" }} />
                      </div>
                    </div>
                    <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", color: "rgba(255,255,255,0.6)", width: "74px", textAlign: "right" }}>{w}/{arr.length}</span>
                    <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px", fontWeight: 600, width: "50px", textAlign: "right" }}>{Math.round(pc)} %</span>
                  </button>
                );
              })}
            </div>
          </div>

          {activity.length > 0 && (
            <div className="anim-fadeUp-8" style={{ ...card, padding: m ? "14px 18px" : "16px 24px" }}>
              <button
                onClick={() => setShowLog((v) => !v)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: "#fff" }}
              >
                <span style={mono}>VIIMEISIN TOIMINTA</span>
                <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{showLog ? "Piilota ▲" : "Näytä ▾"}</span>
              </button>
              {showLog && (
                <div style={{ display: "flex", flexDirection: "column", gap: "11px", marginTop: "16px" }}>
                  {activity.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "11px" }}>
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0, background: a.color, boxShadow: `0 0 8px ${a.glow}` }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
                        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{a.sub}</div>
                      </div>
                      <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10.5px", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>{a.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
