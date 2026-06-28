/**
 * FR8 projektinäkymä — reusable collapsible "dropdown bar".
 *
 * A calm, dark-themed section that keeps the panel glanceable: the bar always
 * shows a mono label + a one-line summary figure, and expands to reveal the full
 * detail on demand. Each section remembers whether it's open (localStorage), so
 * the bosses' chosen layout sticks across reloads.
 *
 * Presentational only — no data dependencies — so it can wrap any block on any
 * FR8 tab. It provides the card chrome + padding, so move the *inner* content of
 * a block in here (drop the old outer card wrapper).
 */
import { useState, useCallback, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const STORE_PREFIX = "fr8.section.";

function readOpen(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(STORE_PREFIX + id);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeOpen(id: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_PREFIX + id, open ? "1" : "0");
  } catch {
    /* storage unavailable (private mode) — state just won't persist */
  }
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  overflow: "hidden",
};

interface Props {
  /** Stable key for localStorage persistence (e.g. "founders"). */
  id: string;
  /** Mono uppercase label shown on the left of the bar. */
  label: string;
  /** One-line glance figure shown on the right (visible open or closed). */
  summary?: ReactNode;
  /** Open on first run, before the user has toggled it. Defaults to closed. */
  defaultOpen?: boolean;
  /** Optional fade-in stagger class (e.g. "anim-fadeUp-2") for the bar itself. */
  animClass?: string;
  children: ReactNode;
}

export default function Section({ id, label, summary, defaultOpen = false, animClass, children }: Props) {
  const m = useIsMobile();
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      writeOpen(id, next);
      return next;
    });
  }, [id]);

  return (
    <div className={animClass} style={card}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          width: "100%",
          padding: m ? "15px 16px" : "17px 22px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#fff",
          textAlign: "left",
          fontFamily: "var(--font-onest, system-ui, sans-serif)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-jetbrains-mono, monospace)",
            fontSize: "11px",
            letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.55)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {label}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0, minWidth: 0 }}>
          {summary != null && (
            <span
              style={{
                fontSize: m ? "12px" : "13px",
                fontWeight: 600,
                color: "rgba(255,255,255,0.85)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {summary}
            </span>
          )}
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "22px",
              height: "22px",
              borderRadius: "7px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.55)",
              fontSize: "10px",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .22s ease",
              flexShrink: 0,
            }}
          >
            ▾
          </span>
        </span>
      </button>
      {open && (
        <div
          className="anim-fadeUp-0"
          style={{ padding: m ? "0 16px 16px" : "0 22px 20px", borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div style={{ marginTop: m ? "14px" : "16px" }}>{children}</div>
        </div>
      )}
    </div>
  );
}
