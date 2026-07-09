/**
 * FR8 projektinäkymä — overview dashboard (ported from fr8-ikkunat prototype).
 * Adds a per-worker "TEKIJÄT" strip (window counts + €/h optimisation).
 */
import { allPoints, computeDealBilling, checkWindowAttribution, type ProjectData, type WindowStatus, type WorkerStat, type FixedDeal } from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState, useEffect } from "react";
import Section from "./Section";
import Toggle from "./Toggle";

interface Props {
  project: ProjectData;
  workerStats: WorkerStat[];
  workerName: (id: string) => string;
  onGoToFloor: (floor: string) => void;
  /** When set, a signed fixed-price deal drives the money figures (FR8). */
  deal?: FixedDeal | null;
  /** Manually set/clear a person's earnings (founders' agreed split). */
  onSetEarnings?: (id: string, cents: number | null) => void;
  /** trainee id → their leader's name (e.g. Milja → "Matias"). A trainee gets their
   *  OWN windows/hours card here, but no euro: their pay stays combined with the
   *  leader, so we only show a "palkka <leader>" note instead of earnings. */
  traineeInfo?: Record<string, { leaderName: string }>;
  /** leader id → the trainee slices folded into their COMBINED pay, so the leader's
   *  card can break the total down ("sis. Milja 6 ikk · 225 €"). */
  traineeShareByLeader?: Record<string, { name: string; washed: number; cents: number }[]>;
  /** Per-founder (boss) earnings breakdown — own work + profit share from the
   *  workers' windows. Only set for a signed deal; drives the "bossien ansiot" card. */
  founderEarnings?: { id: string; name: string; ownWashed: number; ownCents: number; shareCents: number; totalCents: number; manual: boolean; hours: number }[];
  /** Total paid to the real workers (labour cost) — the other side of the margin. */
  workerLaborCents?: number;
  /** FR8 erälaskutus (kohta 3C.1): renderöi "Maksut"-toiminnon TOISEN johtajan
   *  kortille perustajien osiossa — omalle kortille palautetaan null. Slotina,
   *  koska vain project.tsx tietää kuka katsoo (getAdminProfile). */
  founderInvoiceSlot?: (founderId: string) => React.ReactNode;
  /** FR8 erälaskutus (kohta 3A): renderöi tekijöiden "Maksu"-painikkeen
   *  (WorkerEraInvoiceDialog) klikattavaksi alaotsikoksi KERROKSITTAIN- ja
   *  VIIMEISIN TOIMINTA -palkkien väliin, samaan tyyliin kuin muut osiot —
   *  ei enää kelluva nappi. Slotina samasta syystä kuin founderInvoiceSlot. */
  workerInvoiceSlot?: () => React.ReactNode;
  /** Dynamic per-window rate for founders (sisäinen kate = capCents / totalRedWindows).
   *  Replaces the nominal deal.pricePerWindow in the footer explanation text. */
  founderRateEur?: number;
  /** Total of project expenses in cents — drives the collapsed KULUT bar summary. */
  expensesTotalCents?: number;
  /** Rendered <ExpensesView>, shown inside the collapsible KULUT section (no longer
   *  its own tab). Handlers/data stay owned by the project page. */
  expensesSlot?: React.ReactNode;
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function euro(n: number) { return n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
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

export default function Dashboard({ project, workerStats, workerName, onGoToFloor, deal, onSetEarnings, traineeInfo, traineeShareByLeader, founderEarnings, workerLaborCents, founderRateEur, expensesTotalCents, expensesSlot, founderInvoiceSlot, workerInvoiceSlot }: Props) {
  const m = useIsMobile();
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [openSessions, setOpenSessions] = useState<string | null>(null);
  // Workers strip: false = show everyone assigned (incl. 0-activity like Oona),
  // true = only people who've washed a window or logged hours.
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  // €/h + tunnit are hidden by default — too much info, and hours are rarely logged.
  const [showTeho, setShowTeho] = useState(false);
  // Kulut live in a popup, off the main view (rarely used right now).
  const [showExpenses, setShowExpenses] = useState(false);
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
  const capEur = billing ? billing.capCents / 100 : 0;
  const all = allPoints(project);
  const log = project.log;
  // Kohta 6.1: kokonaistilanteen ikkunamäärän pitää täsmätä tekijöiden/johtajien
  // attribuoitujen ikkunoiden tarkkaan summaan. Elävä tarkistus (ei vain
  // yksikkötesti) — jos joku pesty ikkuna jää ilman attribuutiota, näytetään
  // hienovarainen varoitus johtajille sen sijaan että virhe jäisi huomaamatta.
  const attributionCheck = checkWindowAttribution(project);

  const total = all.length;
  const washed = all.filter((a) => a.status === "pesty").length;
  const kesken = all.filter((a) => a.status === "kesken").length;

  const grp = (p: 1 | 2) => {
    const arr = all.filter((a) => a.p === p);
    const w = arr.filter((a) => a.status === "pesty").length;
    const k = arr.filter((a) => a.status === "kesken").length;
    const pc = arr.length > 0 ? (w / arr.length) * 100 : 0;
    return { total: arr.length, washed: w, kesken: k, pctStr: Math.round(pc) + " %", pct: pc, revStr: euro(w * PRICE) };
  };
  const p1 = grp(1), p2 = grp(2);

  // ── Hero scope ────────────────────────────────────────────────────────────────
  // For a signed deal (FR8) the first view is about the CONTRACT (red) windows, not
  // the full dot count on the map. So the ring, the big number and the paydate bar
  // all track the billable priority (e.g. 161 red windows), while the full map total
  // is kept as a small secondary figure. Open gigs keep the all-windows view.
  const billGrp = deal ? grp(deal.billablePriority) : null;
  const heroTotal = billGrp ? billGrp.total : total;
  const heroWashed = billGrp ? billGrp.washed : washed;
  const heroKesken = billGrp ? billGrp.kesken : kesken;
  const heroUnwashed = heroTotal - heroWashed - heroKesken;
  const heroPct = heroTotal > 0 ? (heroWashed / heroTotal) * 100 : 0;
  const heroPctStr = Math.round(heroPct) + " %";
  // Internal per-window margin for the bosses: the FIXED agreed total spread over the
  // live billable windows. Deleting red dots raises this (fewer windows for the same
  // €6300), while the worker's own €/window rate is unchanged. Never shown to workers
  // or the customer — this is the founders' admin overview only.
  const internalPerWindowEur = billing && billing.billableTotal > 0 ? capEur / billing.billableTotal : 0;

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const todaySet = new Set<string>();
  log.forEach((l) => { if (l.status === "pesty" && l.ts >= startToday.getTime() && (!deal || l.p === deal.billablePriority)) todaySet.add(l.key); });
  const todayWindows = todaySet.size;
  // Remaining + day estimate track the SAME scope as the hero, "today" and the
  // pay-progress: for a signed deal that's the billable (red) set, otherwise all
  // windows. (Previously this always used the full map total, so a deal's "days
  // left" divided red-per-day into all-windows-left — an inconsistent estimate.)
  const estTotal = deal ? heroTotal : total;
  const estWashed = deal ? heroWashed : washed;
  const remaining = Math.max(0, estTotal - estWashed);
  const estStr = remaining === 0 && estTotal > 0 ? "valmis" : todayWindows > 0 ? "~" + Math.ceil(remaining / todayWindows) + " työpv" : "—";

  const activity = log.slice(0, 5).map((l) => {
    const rgb = colorRgb(l.p, l.status);
    const num = l.key.includes("#c") ? " (lisätty)" : " " + (parseInt(l.key.split("#")[1], 10) + 1);
    const who = l.by ? " · " + workerName(l.by) : "";
    return { color: `rgb(${rgb})`, glow: `rgba(${rgb},0.7)`, title: "Ikkuna" + num + " — " + statusLabel(l.status), sub: "Kerros " + l.floor + " · P" + l.p + who, time: ago(l.ts) };
  });

  // Full crew for the strip: every worker with stats PLUS any assigned crew member
  // who hasn't done anything yet (e.g. Oona) so they're visible from day one. The
  // "Vain aktiiviset" toggle narrows this to people with windows/hours.
  const statIds = new Set(workerStats.map((s) => s.worker));
  const zeroStats = (project.crew || [])
    .filter((c) => c.active !== false && c.role === "worker" && !c.adminLinked && !statIds.has(c.id))
    .map((c) => ({ worker: c.id, washed: 0, revenueCents: 0, hours: 0, windowsPerHour: 0, eurPerHour: 0 }));
  const allWorkers = [...workerStats, ...zeroStats].sort((a, b) => b.washed - a.washed);
  const activeWorkers = allWorkers.filter((s) => s.washed > 0 || s.hours > 0);
  const shownWorkers = showActiveOnly ? activeWorkers : allWorkers;

  // Founders' combined earnings — shown as the collapsed summary on the
  // "PERUSTAJIEN ANSIOT" bar so the headline figure is glanceable while folded.
  const foundersTotalCents = (founderEarnings ?? []).reduce((s, f) => s + f.totalCents, 0);
  const laborCents = workerLaborCents ?? 0;

  // Crew on the clock right now — drives the "KÄYNNISSÄ NYT" strip pinned under the
  // hero. Read straight from the crew so someone who just started (0 windows yet)
  // still shows. The strip is hidden entirely when nobody is working.
  const runningShifts = (project.crew || [])
    .filter((c) => c.activeShiftAt)
    .map((c) => ({ id: c.id, name: workerName(c.id), since: c.activeShiftAt as number }))
    .sort((a, b) => a.since - b.since);

  const workerSlot = workerInvoiceSlot?.();

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
            {deal
              ? <>{FLOORS.length} KERROSTA · {heroTotal > 0 ? heroTotal : "…"} SOPIMUSIKKUNAA</>
              : <>{FLOORS.length} KERROSTA · {total > 0 ? total : "…"} IKKUNAA</>}
          </div>
        </div>

        {/* Row 1: ring + revenue */}
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1.35fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <div className="anim-fadeUp-0" style={{ ...card, borderRadius: "22px", display: "flex", flexDirection: m ? "column" : "row", gap: m ? "20px" : "26px", alignItems: "center", padding: m ? "22px" : "30px" }}>
            <div style={{ position: "relative", width: "184px", height: "184px", flexShrink: 0 }}>
              <svg width="184" height="184" viewBox="0 0 184 184" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="92" cy="92" r="80" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11" />
                <circle cx="92" cy="92" r="80" fill="none" stroke="#ffffff" strokeWidth="11" strokeLinecap="round"
                  strokeDasharray={`${((heroPct / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
                  style={{ transition: "stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: "38px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{heroPctStr}</div>
                <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>VALMIS</div>
              </div>
            </div>
            <div style={{ flex: 1, width: m ? "100%" : undefined, textAlign: m ? "center" : "left" }}>
              <div style={{ ...mono, marginBottom: "10px" }}>{deal ? "SOPIMUSIKKUNAT (PUNAISET)" : "KOKONAISEDISTYMINEN"}</div>
              <div style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.01em", marginBottom: "2px" }}>
                {heroWashed} <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>/ {heroTotal}</span>
              </div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", marginBottom: "20px" }}>
                {deal ? "punaista ikkunaa pesty" : "ikkunaa pesty"}
              </div>
              {!attributionCheck.matches && (
                <div style={{ marginBottom: "16px", padding: "9px 12px", borderRadius: "10px", background: "rgba(224,168,0,0.12)", border: "1px solid rgba(224,168,0,0.3)", fontSize: "11.5px", color: "rgba(255,206,80,0.9)" }}>
                  Ikkunamäärä ei täsmää: {attributionCheck.dotCount} pestyä ikkunaa, mutta tekijöiden/johtajien summa on {attributionCheck.attributedSum}
                  {" "}(ero {attributionCheck.diff > 0 ? "+" : ""}{attributionCheck.diff}). Jollain pestyllä ikkunalla ei ole pesijää merkittynä.
                </div>
              )}
              <div style={{ display: "flex", gap: "10px" }}>
                {([["kesken", "rgb(188,150,255)", "rgba(188,150,255,0.7)", heroKesken], ["Pesemättä", "rgba(255,255,255,0.4)", undefined, heroUnwashed]] as [string, string, string|undefined, number][]).map(([label, bg, shadow, val]) => (
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

          {/* Money card — one clean figure: the accumulated internal margin
              (washed red × sisäinen kate). No instalments, no contract bubble. */}
          <div className="anim-fadeUp-1" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "10px", padding: m ? "24px 22px" : "30px", background: "linear-gradient(155deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "22px", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" }}>
            <div style={{ ...mono }}>{deal ? "KERTYNYT · VAIN PERUSTAJILLE" : "LIIKEVAIHTO"}</div>
            <div style={{ fontSize: m ? "44px" : "52px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {euro(deal ? heroWashed * internalPerWindowEur : washed * PRICE)}
            </div>
          </div>
        </div>

        {/* KÄYNNISSÄ NYT — live shift strip, pinned under the hero ONLY while someone
            is on the clock (otherwise the top stays minimal). */}
        {runningShifts.length > 0 && (
          <div className="anim-fadeUp-1" style={{ ...card, padding: m ? "12px 14px" : "12px 18px", marginBottom: "14px", display: "flex", alignItems: "center", gap: m ? "8px" : "12px", flexWrap: "wrap" }}>
            <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.55)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.9)", animation: "fr8-zonePulse 1.8s ease-in-out infinite" }} />
              KÄYNNISSÄ NYT
            </span>
            {runningShifts.map((s) => (
              <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "5px 11px", borderRadius: 999, background: "rgba(95,224,138,0.1)", border: "1px solid rgba(95,224,138,0.28)" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{s.name}</span>
                <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "#9ff0bd" }}>{fmtDur(now - s.since)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Collapsible "dropdown bar" sections — everything below the hero folds
            away, each bar keeping its headline figure visible while closed. */}
        <div style={{ display: "flex", flexDirection: "column", gap: m ? "12px" : "14px" }}>

        {/* Perustajien ansiot — bosses' earnings: own washed windows at the full
            contract rate + the profit share earned on every worker's window. Gives
            the founders a clear, fair "how much have we made" view. Founders only. */}
        {deal && founderEarnings && founderEarnings.length > 0 && (
            <Section id="founders" label="PERUSTAJIEN ANSIOT · VAIN PERUSTAJILLE" summary={euro(foundersTotalCents / 100)} animClass="anim-fadeUp-1">

              {/* Gig money split: contract value → workers' labour vs founders' share. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: m ? "8px" : "12px", marginBottom: "16px" }}>
                {[
                  { label: "Sopimushinta", val: euro(capEur), tone: "rgba(255,255,255,0.9)" },
                  { label: "Työntekijöille", val: euro(laborCents / 100), tone: "rgba(255,255,255,0.7)" },
                  { label: "Perustajille yht.", val: euro(foundersTotalCents / 100), tone: "#9ff0bd" },
                ].map((b) => (
                  <div key={b.label} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "13px" }}>
                    <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9.5px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", marginBottom: "6px" }}>{b.label.toUpperCase()}</div>
                    <div style={{ fontSize: m ? "16px" : "19px", fontWeight: 700, color: b.tone }}>{b.val}</div>
                  </div>
                ))}
              </div>

              {/* Per-founder breakdown: own work + profit share = total. */}
              <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : `repeat(${Math.min(founderEarnings.length, 2)}, 1fr)`, gap: m ? "10px" : "12px" }}>
                {founderEarnings.map((f) => {
                  // A founder who leads a trainee (e.g. Matias → Milja). The
                  // trainee's windows are tracked under the trainee's OWN id in
                  // computeWorkerStats, so f.ownWashed is the founder's own work
                  // ONLY — it does NOT include the trainee's windows (the two are
                  // disjoint). The trainee's slice is added on top in f.totalCents
                  // (the money owed to the trainee, which the founder settles).
                  // Show the founder's own count as-is and list the trainee slices
                  // separately; own + trainee slices + profit share == f.totalCents.
                  // (Previously this SUBTRACTED the trainee windows from ownWashed,
                  // which understated "Oma työ" — e.g. 15,5 shown as 9,5 — and broke
                  // the breakdown↔total reconciliation.)
                  const slices = traineeShareByLeader?.[f.id] ?? [];
                  const selfWashed = f.ownWashed;
                  const selfCents = f.ownCents;
                  return (
                  <div key={f.id} style={{ padding: "16px 18px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "15px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: "8px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 600 }}>{f.name}</span>
                      <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>PERUSTAJA</span>
                    </div>
                    <div style={{ fontSize: "28px", fontWeight: 700, lineHeight: 1, marginBottom: slices.length ? "4px" : "10px" }}>{euro(f.totalCents / 100)}</div>
                    {/* Trainee-aware total note: how much of this founder's total is
                        actually the trainee's pay (to be passed on, not kept). */}
                    {!f.manual && slices.length > 0 && (
                      <div style={{ fontSize: "11px", color: "#9cc1ff", marginBottom: "10px", lineHeight: 1.4 }}>
                        sis. {slices.map((t) => `${t.name} ${euro(t.cents / 100)}`).join(" · ")} — tilitä harjoittelijalle, älä pidä itselläsi
                      </div>
                    )}
                    {f.manual ? (
                      <div style={{ fontSize: "12px", color: "#9ff0bd" }}>Käsin asetettu ansio</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>Oma työ · {selfWashed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa</span>
                          <b style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>{euro(selfCents / 100)}</b>
                        </div>
                        {slices.map((t) => (
                          <div key={t.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#9cc1ff" }}>
                            <span>↳ {t.name} (harjoittelija) · {t.washed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikkunaa</span>
                            <b style={{ fontWeight: 600 }}>{euro(t.cents / 100)}</b>
                          </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>Tuotto-osuus työntekijöistä</span>
                          <b style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>{euro(f.shareCents / 100)}</b>
                        </div>
                      </div>
                    )}
                    {/* Johtaja-välinen erälasku (kohta 3C.1) — vain toisen johtajan kortilla. */}
                    {(() => {
                      const slot = founderInvoiceSlot?.(f.id);
                      return slot ? <div style={{ marginTop: "12px" }}>{slot}</div> : null;
                    })()}
                  </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "12px", lineHeight: 1.5 }}>
                Perustaja ansaitsee {euroUnit(founderRateEur ?? PRICE)} / ikkuna (sisäinen kate = sopimushinta ÷ punaiset ikkunat yhteensä) + osuuden katteesta jokaisesta työntekijän ikkunasta. Päivittyy pesujen myötä.
              </p>
            </Section>
        )}

        {/* Row 2: P1 + P2 + mini cards */}
        <Section id="priority" label="PRIORITEETIT & TAHTI" summary={`P1 ${p1.pctStr} · tänään ${todayWindows}`} animClass="anim-fadeUp-3">
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr 1fr" : "1fr 1fr 1fr", gap: m ? "10px" : "16px" }}>
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
        </Section>

        {/* Workers strip — per-worker window counts & €/h optimisation */}
        {allWorkers.length > 0 && (
          <Section id="workers" label="TEKIJÄT" summary={`${shownWorkers.length} tekijää`} animClass="anim-fadeUp-5">
            {/* Controls: show-all-vs-active + reveal €/h teho */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "18px", marginBottom: "14px", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>Näytä teho (€/h)</span>
                <Toggle checked={showTeho} onChange={setShowTeho} ariaLabel="Näytä €/h ja tunnit" />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>Vain aktiiviset</span>
                <Toggle checked={showActiveOnly} onChange={setShowActiveOnly} ariaLabel="Näytä vain aktiiviset tekijät" />
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(shownWorkers.length, 1), m ? 2 : 4)}, 1fr)`, gap: m ? "10px" : "12px" }}>
              {shownWorkers.map((s) => {
                const share = washed > 0 ? (s.washed / washed) * 100 : 0;
                const rate = s.washed > 0 ? s.revenueCents / s.washed / 100 : 0; // €/ikkuna (personal pay)
                const shiftStart = shiftStartFor(s.worker);
                const cm = crewMemberOf(s.worker);
                const trainee = traineeInfo?.[s.worker]; // e.g. Milja → pay folded into Matias, windows/hours shown on their own
                const canEditPay = !!onSetEarnings && cm?.role === "host" && !trainee; // founders adjust own split
                const overridden = cm?.manualEarningsCents != null;
                const editing = editId === s.worker;
                return (
                  <div key={s.worker} style={{ padding: "16px 18px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "15px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: "15px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{workerName(s.worker)}</span>
                        {trainee && <span style={{ flexShrink: 0, fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: "#9cc1ff", padding: "2px 6px", borderRadius: 6, border: "1px solid rgba(124,180,255,0.35)", background: "rgba(124,180,255,0.12)" }}>HARJOITTELIJA</span>}
                      </span>
                      <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>{Math.round(share)} %</span>
                    </div>
                    <div style={{ fontSize: "26px", fontWeight: 700, lineHeight: 1 }}>
                      {s.washed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} <span style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>ikkunaa</span>
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
                    {trainee ? (
                      // A trainee shows only their own windows + hours; the euro (pay) stays
                      // combined with their leader, so we show "palkka <leader>" instead.
                      // Each metric on its own full-width row → no number collision on mobile.
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Palkka</span>
                          <span style={{ color: "#9cc1ff", textAlign: "right" }}>→ {trainee.leaderName}</span>
                        </div>
                        {showTeho && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span>Tunnit</span>
                            <span style={{ color: "rgba(255,255,255,0.85)", textAlign: "right" }}>{s.hours > 0 ? `${s.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} h` : "0 h"}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                    <>
                    {/* Stacked label/value rows so the euro, rate and €/h figures never
                        overlap each other when they wrap on a narrow card. */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span>Ansio</span>
                        <span style={{ textAlign: "right" }}>
                          <b style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>{euro(s.revenueCents / 100)}</b>
                          {overridden && <span style={{ marginLeft: 6, color: "#9ff0bd", fontSize: 10.5 }}>muokattu</span>}
                        </span>
                      </div>
                      {cm?.role === "host" ? (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Hinnoittelu</span>
                          <span style={{ textAlign: "right", color: "rgba(255,255,255,0.5)" }}>sis. tuotto-osuus</span>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>€ / ikkuna</span>
                          <span style={{ textAlign: "right", color: "rgba(255,255,255,0.85)" }}>{euroUnit(rate)}</span>
                        </div>
                      )}
                      {showTeho && (
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Teho</span>
                          <span style={{ textAlign: "right", color: "rgba(255,255,255,0.85)" }}>{s.hours > 0 ? `${euro(s.eurPerHour)} / h · ${s.hours.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} h` : "0 h"}</span>
                        </div>
                      )}
                    </div>
                    {/* Breakdown of the COMBINED sum: how much of this leader's total is a
                        trainee's work (e.g. "sis. Milja 6 ikk · 225 €"). */}
                    {(traineeShareByLeader?.[s.worker]?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 7, fontSize: "11px", color: "rgba(156,193,255,0.95)", lineHeight: 1.5 }}>
                        {traineeShareByLeader![s.worker].map((t) => `sis. ${t.name} ${t.washed.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} ikk · ${euro(t.cents / 100)}`).join(" · ")}
                      </div>
                    )}
                    </>
                    )}
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
                                {!trainee && <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{euro(se.earnedCents / 100)}</span>}
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
          </Section>
        )}

        {/* Row 3: floor breakdown + activity log */}
        <Section id="floors" label="KERROKSITTAIN" summary={`${washed}/${total}`} animClass="anim-fadeUp-6">
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
          </Section>

          {workerSlot && <div className="anim-fadeUp-7">{workerSlot}</div>}

          {activity.length > 0 && (
            <Section id="activity" label="VIIMEISIN TOIMINTA" summary={activity[0]?.time} animClass="anim-fadeUp-8">
                <div style={{ display: "flex", flexDirection: "column", gap: "11px" }}>
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
            </Section>
          )}
        </div>

        {/* Kulut — tucked away off the main view. A quiet link opens the expense
            form/list in a popup, for the rare time something needs logging. */}
        {expensesSlot && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: m ? "18px" : "22px" }}>
            <button
              type="button"
              onClick={() => setShowExpenses(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 10, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}
            >
              Kulut{expensesTotalCents ? ` · ${euro(expensesTotalCents / 100)}` : ""}
            </button>
          </div>
        )}
      </div>

      {/* Kulut popup */}
      {expensesSlot && showExpenses && (
        <div
          onClick={() => setShowExpenses(false)}
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: m ? "flex-end" : "center", justifyContent: "center", padding: m ? "0" : "24px", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: "640px", maxHeight: m ? "88vh" : "86vh", overflowY: "auto", background: "#0c0c0e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: m ? "20px 20px 0 0" : "20px", padding: m ? "18px 14px calc(20px + env(safe-area-inset-bottom))" : "22px 22px 24px", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <span style={{ ...mono, color: "rgba(255,255,255,0.55)" }}>KULUT{expensesTotalCents ? ` · ${euro(expensesTotalCents / 100)}` : ""}</span>
              <button
                type="button"
                onClick={() => setShowExpenses(false)}
                aria-label="Sulje"
                style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", fontSize: 15, cursor: "pointer", lineHeight: 1 }}
              >×</button>
            </div>
            {expensesSlot}
          </div>
        </div>
      )}
    </div>
  );
}
