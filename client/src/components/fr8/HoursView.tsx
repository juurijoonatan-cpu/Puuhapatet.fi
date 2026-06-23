/**
 * FR8 projektinäkymä — work hours (ported from fr8-ikkunat prototype).
 * Generalised to a dynamic worker list and enriched with per-worker
 * window-throughput optimisation (windows/h and €/h).
 */
import { useState } from "react";
import type { ProjHourEntry, WorkerStat } from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";

interface Worker { id: string; name: string; initial: string; }

interface Props {
  workers: Worker[];
  hours: Record<string, number>;
  hourLog: ProjHourEntry[];
  stats: WorkerStat[];
  onAddHours: (worker: string, delta: number) => void;
  /** trainee id → their leader's name (e.g. Milja → "Matias"). Trainees show their
   *  own hours/windows, but no euro — pay stays combined with the leader. */
  traineeInfo?: Record<string, { leaderName: string }>;
}

function fmtH(n: number) { return (Math.round(n * 100) / 100).toLocaleString("fi-FI"); }
function fmtEur(n: number) { return (Math.round(n * 100) / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function timeStr(ts: number) { return new Date(ts).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" }); }

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "22px",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};

export default function HoursView({ workers, hours, hourLog, stats, onAddHours, traineeInfo }: Props) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const m = useIsMobile();

  function handleAdd(w: string) {
    const s = (inputs[w] || "").trim().replace(",", ".");
    const n = parseFloat(s);
    if (isNaN(n) || n === 0) { setInputs((p) => ({ ...p, [w]: "" })); return; }
    onAddHours(w, n);
    setInputs((p) => ({ ...p, [w]: "" }));
  }

  const combined = workers.reduce((sum, w) => sum + (hours[w.id] || 0), 0);
  const statFor = (id: string) => stats.find((s) => s.worker === id);

  // Team throughput / hourly-rate optimisation across the assigned workers.
  const teamWashed = workers.reduce((a, w) => a + (statFor(w.id)?.washed ?? 0), 0);
  const teamRevenue = workers.reduce((a, w) => a + (statFor(w.id)?.revenueCents ?? 0), 0) / 100;
  const teamEurPerHour = combined > 0 ? teamRevenue / combined : 0;
  const teamWinPerHour = combined > 0 ? teamWashed / combined : 0;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: m ? "18px 12px 36px" : "26px 30px 40px" }}>
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: m ? "14px" : "22px" }}>
          <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.18em", color: "rgba(255,255,255,0.4)", marginBottom: "7px" }}>TEHDYT TUNNIT</div>
          <h1 style={{ margin: 0, fontSize: m ? "22px" : "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>Työaikakirjanpito & optimointi</h1>
        </div>

        {/* Combined total + team throughput */}
        <div style={{ display: "flex", flexDirection: "column", gap: m ? "16px" : "20px", padding: m ? "18px" : "24px 28px", background: "linear-gradient(155deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "22px", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", marginBottom: m ? "12px" : "16px" }}>
          <div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.14em", color: "rgba(255,255,255,0.45)", marginBottom: "7px" }}>YHTEENSÄ TEHTYJÄ TUNTEJA</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: m ? "40px" : "48px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtH(combined)}</span>
              <span style={{ fontSize: "18px", color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>h</span>
            </div>
          </div>

          {/* Per-worker hours — a calm wrapping grid instead of a cramped row */}
          <div style={{ display: "grid", gridTemplateColumns: m ? "repeat(3, minmax(0,1fr))" : "repeat(auto-fill, minmax(120px, 1fr))", gap: m ? "8px" : "10px" }}>
            {workers.map((w) => (
              <div key={w.id} style={{ padding: m ? "10px 12px" : "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: "13px" }}>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                  <span style={{ fontSize: m ? "19px" : "22px", fontWeight: 600, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{fmtH(hours[w.id] || 0)}</span>
                  <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>h</span>
                </div>
              </div>
            ))}
          </div>

          {/* Hourly-rate optimisation across the team — borderless cells for a clean fit */}
          <div style={{ display: "grid", gridTemplateColumns: m ? "repeat(2, minmax(0,1fr))" : "repeat(4, minmax(0,1fr))", gap: "10px", paddingTop: m ? "16px" : "18px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              { label: "TIIMIN €/H", val: teamEurPerHour > 0 ? fmtEur(teamEurPerHour) : "—", sub: "tuotto / tunti" },
              { label: "IKK / H", val: teamWinPerHour > 0 ? fmtH(teamWinPerHour) : "—", sub: "tahti" },
              { label: "IKKUNAT", val: String(teamWashed), sub: "pesty" },
              { label: "LIIKEVAIHTO", val: fmtEur(teamRevenue), sub: "kertynyt" },
            ].map((c) => (
              <div key={c.label} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: "13px" }}>
                <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", marginBottom: "6px" }}>{c.label}</div>
                <div style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1 }}>{c.val}</div>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "3px" }}>{c.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Worker cards */}
        <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : (workers.length > 1 ? "1fr 1fr" : "1fr"), gap: m ? "12px" : "16px" }}>
          {workers.map((w) => {
            const entries = hourLog.filter((e) => e.worker === w.id).slice(0, 4);
            const st = statFor(w.id);
            const trainee = traineeInfo?.[w.id];
            return (
              <div key={w.id} style={{ ...card, padding: "24px" }}>
                {/* Worker header */}
                <div style={{ display: "flex", alignItems: "center", gap: "13px", marginBottom: "18px" }}>
                  <div style={{ width: "46px", height: "46px", borderRadius: "14px", background: "linear-gradient(140deg,rgba(255,255,255,0.16),rgba(255,255,255,0.04))", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700 }}>{w.initial}</div>
                  <div>
                    <div style={{ fontSize: "18px", fontWeight: 600 }}>{w.name}</div>
                    <div style={{ fontSize: "12px", color: trainee ? "#9cc1ff" : "rgba(255,255,255,0.4)" }}>{trainee ? `Harjoittelija · palkka ${trainee.leaderName}` : "Ikkunanpesijä"}</div>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <div style={{ fontSize: "32px", fontWeight: 700, lineHeight: 1, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{fmtH(hours[w.id] || 0)}</div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>tuntia</div>
                  </div>
                </div>

                {/* Optimisation stats: windows, windows/h, €/h */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "9px", marginBottom: "16px" }}>
                  {[
                    { label: "PESTY", val: String(st?.washed ?? 0), sub: "ikkunaa" },
                    { label: "IKK / H", val: st && st.windowsPerHour > 0 ? fmtH(st.windowsPerHour) : "—", sub: "tahti" },
                    // Trainees show no €/h — their pay stays combined with their leader.
                    trainee
                      ? { label: "PALKKA", val: "yhd.", sub: trainee.leaderName }
                      : { label: "€ / H", val: st && st.eurPerHour > 0 ? fmtEur(st.eurPerHour) : "—", sub: "tuotto" },
                  ].map((c) => (
                    <div key={c.label} style={{ padding: "11px 12px", background: "rgba(255,255,255,0.03)", borderRadius: "13px" }}>
                      <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", marginBottom: "5px" }}>{c.label}</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, lineHeight: 1 }}>{c.val}</div>
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Input */}
                <div style={{ display: "flex", gap: "9px", marginBottom: "6px" }}>
                  <input type="text" value={inputs[w.id] || ""}
                    onChange={(e) => setInputs((p) => ({ ...p, [w.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(w.id); }}
                    placeholder="Syötä tehdyt tunnit"
                    style={{ flex: 1, padding: "13px 15px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "13px", color: "#fff", fontSize: "14px", outline: "none" }} />
                  <button onClick={() => handleAdd(w.id)}
                    style={{ padding: "0 22px", background: "#fff", color: "#0a0a0c", border: "none", borderRadius: "13px", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
                    Lisää
                  </button>
                </div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginBottom: "16px" }}>Pilkku ja piste käyvät · miinusmerkki vähentää (esim. -1,5)</div>

                {/* Log */}
                <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", marginBottom: "9px" }}>VIIMEISIMMÄT KIRJAUKSET</div>
                {entries.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {entries.map((e, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 11px", background: "rgba(255,255,255,0.025)", borderRadius: "10px" }}>
                        <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "14px", fontWeight: 600, color: e.delta < 0 ? "rgb(255,140,140)" : "rgb(120,235,160)" }}>
                          {(e.delta > 0 ? "+" : "") + fmtH(e.delta)} h
                        </span>
                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{timeStr(e.ts)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", padding: "6px 0" }}>Ei vielä kirjauksia.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
