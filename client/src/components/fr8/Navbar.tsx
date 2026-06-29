/**
 * FR8 projektinäkymä — top navbar (ported from fr8-ikkunat prototype).
 * Adds a back button to return to the gig page and a current-worker chip.
 */
import { useState, useEffect } from "react";
import { ArrowLeft, Maximize2, Minimize2, ChevronDown, Check } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

export type Fr8Tab = "dashboard" | "floor" | "hours";

interface NavbarProps {
  activeTab: Fr8Tab;
  onTabChange: (tab: Fr8Tab) => void;
  buildingName?: string;
  buildingAddress?: string;
  currentWorkerName?: string;
  saving?: boolean;
  onBack: () => void;
  /** Pickable crew for the "default washer" selector (manager view only). When
   *  given together with onChangeDefaultWasher, the worker chip becomes a
   *  dropdown that sets who new window markings are attributed to by default. */
  workers?: { id: string; name: string }[];
  defaultWasherId?: string;
  onChangeDefaultWasher?: (id: string) => void;
}

const TABS: { id: Fr8Tab; label: string; short: string }[] = [
  { id: "dashboard", label: "Kokonaistilanne", short: "Tilanne" },
  { id: "floor", label: "Tilanne kerroksittain", short: "Kerrokset" },
  { id: "hours", label: "Tehdyt tunnit", short: "Tunnit" },
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

export default function Navbar({ activeTab, onTabChange, buildingName, buildingAddress, currentWorkerName, saving, onBack, workers, defaultWasherId, onChangeDefaultWasher }: NavbarProps) {
  const m = useIsMobile();
  const [isFs, setIsFs] = useState(false);
  const [washerOpen, setWasherOpen] = useState(false);
  const canFs = typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
  // The chip becomes a "default washer" picker when a crew + change handler are given.
  const canPickWasher = !!onChangeDefaultWasher && !!workers && workers.length > 0;

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <nav
      style={{
        position: "relative",
        zIndex: 20,
        height: "62px",
        display: "flex",
        alignItems: "center",
        gap: m ? "10px" : "18px",
        padding: m ? "0 12px" : "0 20px",
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
          display: "flex", alignItems: "center", gap: "7px", flexShrink: 0,
          padding: m ? "8px" : "7px 12px", borderRadius: "10px", cursor: "pointer",
          border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)",
          color: "rgba(255,255,255,0.75)", fontFamily: "var(--font-onest, system-ui, sans-serif)",
          fontSize: "12.5px", fontWeight: 600,
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} /> {m ? "" : "Keikka"}
      </button>

      {/* Tab switcher — scrolls horizontally on mobile if needed */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "4px",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "13px", overflowX: "auto", flexShrink: 1, minWidth: 0,
        }}
      >
        {TABS.map((t) => (
          <button key={t.id} onClick={() => onTabChange(t.id)} style={{ ...tabStyle(activeTab === t.id), whiteSpace: "nowrap", padding: m ? "8px 12px" : "8px 15px" }}>
            {m ? t.short : t.label}
          </button>
        ))}
      </div>

      {/* Project info + status */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: m ? "8px" : "13px", flexShrink: 0 }}>
        {canFs && (
          <button
            onClick={toggleFs}
            title={isFs ? "Poistu koko näytöstä" : "Koko näyttö"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px", borderRadius: "10px", cursor: "pointer",
              border: `1px solid ${isFs ? "transparent" : "rgba(255,255,255,0.12)"}`,
              background: isFs ? "#fff" : "rgba(255,255,255,0.04)",
              color: isFs ? "#0a0a0c" : "rgba(255,255,255,0.7)", flexShrink: 0,
            }}
          >
            {isFs ? <Minimize2 style={{ width: 15, height: 15 }} /> : <Maximize2 style={{ width: 15, height: 15 }} />}
          </button>
        )}
        {currentWorkerName && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => canPickWasher && setWasherOpen((v) => !v)}
              title={canPickWasher
                ? "Oletustekijä — uudet ikkunamerkinnät kirjataan tälle. Vaihda tästä; voit silti vaihtaa yksittäisen ikkunan tekijän kartalla."
                : "Kirjaukset merkitään tälle tekijälle"}
              style={{
                display: "flex", alignItems: "center", gap: "7px", padding: m ? "6px 9px" : "5px 11px",
                borderRadius: "10px", background: washerOpen ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: canPickWasher ? "pointer" : "default",
                fontFamily: "var(--font-onest, system-ui, sans-serif)",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: saving ? "#ffce28" : "#5fe08a", boxShadow: `0 0 8px ${saving ? "rgba(255,206,40,0.8)" : "rgba(95,224,138,0.8)"}` }} />
              {!m && <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>{currentWorkerName}</span>}
              {canPickWasher && <ChevronDown style={{ width: 13, height: 13, color: "rgba(255,255,255,0.45)" }} />}
            </button>
            {canPickWasher && washerOpen && (
              <>
                <div onClick={() => setWasherOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44 }} />
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 46, width: "208px", padding: "7px", background: "rgba(16,16,20,0.94)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "13px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                  <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", padding: "5px 8px 7px" }}>OLETUSTEKIJÄ</div>
                  {workers!.map((w) => {
                    const active = w.id === defaultWasherId;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => { onChangeDefaultWasher!(w.id); setWasherOpen(false); }}
                        style={{ display: "flex", alignItems: "center", gap: "9px", width: "100%", padding: "9px 10px", borderRadius: "9px", cursor: "pointer", textAlign: "left", border: `1px solid ${active ? "rgba(255,255,255,0.16)" : "transparent"}`, background: active ? "rgba(255,255,255,0.09)" : "transparent", color: "#fff", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "13px", fontWeight: active ? 600 : 500 }}
                      >
                        <span style={{ width: "20px", height: "20px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, background: "rgba(95,224,138,0.16)", color: "rgba(95,224,138,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1 }}>{w.name}</span>
                        {active && <Check style={{ width: 14, height: 14, color: "rgba(95,224,138,0.95)" }} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
        {!m && (
          <div style={{ textAlign: "right", lineHeight: 1.25 }}>
            <div style={{ fontWeight: 700, fontSize: "13.5px", letterSpacing: "0.03em" }}>
              {buildingName || "Projektinäkymä"}
            </div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "10px", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)" }}>
              {buildingAddress ? `${buildingAddress.toUpperCase()} · ` : ""}{saving ? "TALLENNETAAN…" : "IKKUNANPESU"}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
