"use client";

import { useState } from "react";
import { HourEntry } from "./AppShell";

interface Props {
  hours: { matias: number; joonatan: number };
  hourLog: HourEntry[];
  onAddHours: (worker: "matias" | "joonatan", delta: number) => void;
}

const WORKERS = [
  { key: "matias" as const, name: "Matias", initial: "M" },
  { key: "joonatan" as const, name: "Joonatan", initial: "J" },
];

function fmtH(n: number) { return (Math.round(n * 100) / 100).toLocaleString("fi-FI"); }
function timeStr(ts: number) { return new Date(ts).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" }); }

export default function HoursView({ hours, hourLog, onAddHours }: Props) {
  const [inputs, setInputs] = useState({ matias: "", joonatan: "" });

  function handleAdd(w: "matias" | "joonatan") {
    const s = inputs[w].trim().replace(",", ".");
    const n = parseFloat(s);
    if (isNaN(n) || n === 0) { setInputs((p) => ({ ...p, [w]: "" })); return; }
    onAddHours(w, n);
    setInputs((p) => ({ ...p, [w]: "" }));
  }

  const combined = hours.matias + hours.joonatan;

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.035)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "22px",
    backdropFilter: "blur(22px)",
    WebkitBackdropFilter: "blur(22px)",
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "26px 30px 40px" }}>
      <div style={{ maxWidth: "980px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: "22px" }}>
          <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.18em", color: "rgba(255,255,255,0.4)", marginBottom: "7px" }}>TEHDYT TUNNIT</div>
          <h1 style={{ margin: 0, fontSize: "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>Työaikakirjanpito</h1>
        </div>

        {/* Combined total */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 28px", background: "linear-gradient(155deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "22px", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", marginBottom: "16px" }}>
          <div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", letterSpacing: "0.14em", color: "rgba(255,255,255,0.45)", marginBottom: "7px" }}>YHTEENSÄ TEHTYJÄ TUNTEJA</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "48px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtH(combined)}</span>
              <span style={{ fontSize: "18px", color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>h</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "28px" }}>
            {WORKERS.map((w) => (
              <div key={w.key} style={{ textAlign: "right" }}>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", marginBottom: "3px" }}>{w.name}</div>
                <div style={{ fontSize: "22px", fontWeight: 600, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{fmtH(hours[w.key])} h</div>
              </div>
            ))}
          </div>
        </div>

        {/* Worker cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          {WORKERS.map((w) => {
            const entries = hourLog.filter((e) => e.worker === w.key).slice(0, 4);
            return (
              <div key={w.key} style={{ ...card, padding: "24px" }}>
                {/* Worker header */}
                <div style={{ display: "flex", alignItems: "center", gap: "13px", marginBottom: "20px" }}>
                  <div style={{ width: "46px", height: "46px", borderRadius: "14px", background: "linear-gradient(140deg,rgba(255,255,255,0.16),rgba(255,255,255,0.04))", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700 }}>{w.initial}</div>
                  <div>
                    <div style={{ fontSize: "18px", fontWeight: 600 }}>{w.name}</div>
                    <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>Ikkunanpesijä</div>
                  </div>
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <div style={{ fontSize: "32px", fontWeight: 700, lineHeight: 1, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{fmtH(hours[w.key])}</div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>tuntia</div>
                  </div>
                </div>

                {/* Input */}
                <div style={{ display: "flex", gap: "9px", marginBottom: "6px" }}>
                  <input type="text" value={inputs[w.key]}
                    onChange={(e) => setInputs((p) => ({ ...p, [w.key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(w.key); }}
                    placeholder="Syötä tehdyt tunnit"
                    style={{ flex: 1, padding: "13px 15px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "13px", color: "#fff", fontSize: "14px", outline: "none" }} />
                  <button onClick={() => handleAdd(w.key)}
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
