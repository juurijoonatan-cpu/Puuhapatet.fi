"use client";

import { Tab } from "./AppShell";

interface NavbarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
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

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  return (
    <nav
      style={{
        position: "relative",
        zIndex: 20,
        height: "62px",
        display: "flex",
        alignItems: "center",
        gap: "22px",
        padding: "0 26px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(8,8,10,0.55)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "11px",
          paddingRight: "6px",
        }}
      >
        <div
          style={{
            width: "30px",
            height: "30px",
            borderRadius: "9px",
            background: "linear-gradient(140deg, #fff, #c9c9d2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "11px",
              height: "11px",
              borderRadius: "3px",
              background: "#0a0a0c",
            }}
          />
        </div>
        <span
          style={{ fontWeight: 700, fontSize: "15px", letterSpacing: "0.02em" }}
        >
          FR8
        </span>
      </div>

      {/* Tab switcher */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "13px",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            style={tabStyle(activeTab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Project info + status */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "13px",
        }}
      >
        <div style={{ textAlign: "right", lineHeight: 1.25 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: "13.5px",
              letterSpacing: "0.03em",
            }}
          >
            FR8 — VANHA TKK
          </div>
          <div
            style={{
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              fontSize: "10px",
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            BULEVARDI 31 · IKKUNANPESU
          </div>
        </div>
        <div
          style={{
            width: "9px",
            height: "9px",
            borderRadius: "50%",
            background: "#5fe08a",
            boxShadow: "0 0 9px rgba(95,224,138,0.8)",
          }}
        />
      </div>
    </nav>
  );
}
