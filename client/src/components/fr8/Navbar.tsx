/**
 * FR8 projektinäkymä — top navbar (ported from fr8-ikkunat prototype).
 * Adds a back button to return to the gig page and a current-worker chip.
 */
import { ArrowLeft } from "lucide-react";

export type Fr8Tab = "dashboard" | "floor" | "hours";

interface NavbarProps {
  activeTab: Fr8Tab;
  onTabChange: (tab: Fr8Tab) => void;
  buildingName?: string;
  buildingAddress?: string;
  currentWorkerName?: string;
  saving?: boolean;
  onBack: () => void;
}

const TABS: { id: Fr8Tab; label: string }[] = [
  { id: "dashboard", label: "Kokonaistilanne" },
  { id: "floor", label: "Tilanne kerroksittain" },
  { id: "hours", label: "Tehdyt tunnit" },
];

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 15px",
    borderRadius: "9px",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-onest, system-ui, sans-serif)",
    fontSize: "13px",
    fontWeight: active ? 600 : 500,
    letterSpacing: "0.01em",
    transition: "all .18s",
    background: active ? "#ffffff" : "transparent",
    color: active ? "#0a0a0c" : "rgba(255,255,255,0.55)",
  };
}

export default function Navbar({ activeTab, onTabChange, buildingName, buildingAddress, currentWorkerName, saving, onBack }: NavbarProps) {
  return (
    <nav
      style={{
        position: "relative",
        zIndex: 20,
        height: "62px",
        display: "flex",
        alignItems: "center",
        gap: "18px",
        padding: "0 20px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(8,8,10,0.55)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Back to gig */}
      <button
        onClick={onBack}
        title="Takaisin keikkaan"
        style={{
          display: "flex", alignItems: "center", gap: "7px",
          padding: "7px 12px", borderRadius: "10px", cursor: "pointer",
          border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)",
          color: "rgba(255,255,255,0.75)", fontFamily: "var(--font-onest, system-ui, sans-serif)",
          fontSize: "12.5px", fontWeight: 600,
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} /> Keikka
      </button>

      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: "11px", paddingRight: "2px" }}>
        <div
          style={{
            width: "30px", height: "30px", borderRadius: "9px",
            background: "linear-gradient(140deg, #fff, #c9c9d2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ width: "11px", height: "11px", borderRadius: "3px", background: "#0a0a0c" }} />
        </div>
        <span style={{ fontWeight: 700, fontSize: "15px", letterSpacing: "0.02em" }}>FR8</span>
      </div>

      {/* Tab switcher */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "4px",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "13px",
        }}
      >
        {TABS.map((t) => (
          <button key={t.id} onClick={() => onTabChange(t.id)} style={tabStyle(activeTab === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Project info + status */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "13px" }}>
        {currentWorkerName && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "7px", padding: "5px 11px",
              borderRadius: "10px", background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
            title="Kirjaukset merkitään tälle tekijälle"
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.8)" }} />
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>{currentWorkerName}</span>
          </div>
        )}
        <div style={{ textAlign: "right", lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, fontSize: "13.5px", letterSpacing: "0.03em" }}>
            {buildingName || "FR8 — VANHA TKK"}
          </div>
          <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)" }}>
            {(buildingAddress || "BULEVARDI 31").toUpperCase()} · {saving ? "TALLENNETAAN…" : "IKKUNANPESU"}
          </div>
        </div>
      </div>
    </nav>
  );
}
