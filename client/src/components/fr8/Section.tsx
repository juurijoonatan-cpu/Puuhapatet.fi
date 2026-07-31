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
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, card as tokenCard, mono } from "./tokens";

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

/** Sama kortti kuin dashissa — tämä oli aiemmin tavu tavulta identtinen
 *  kopio `Dashboard.tsx`:n omasta `card`ista. */
const card: React.CSSProperties = { ...tokenCard, overflow: "hidden" };

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
          gap: T.space.md,
          width: "100%",
          padding: m ? `${T.space.lg}px ${T.space.lg}px` : `${T.space.lg + 2}px ${T.space.xl - 2}px`,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#fff",
          textAlign: "left",
          fontFamily: T.font,
        }}
      >
        <span
          style={{
            ...mono,
            color: T.text.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {label}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: T.space.md, flexShrink: 0, minWidth: 0 }}>
          {summary != null && (
            <span
              style={{
                fontFamily: T.font,
                fontSize: T.size.sm,
                fontWeight: 700,
                color: T.text.secondary,
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
              width: 22,
              height: 22,
              borderRadius: T.radius.xs + 1,
              background: T.surface.raised,
              border: T.border.subtle,
              color: T.text.muted,
              fontSize: T.size.label,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .22s ease",
              flexShrink: 0,
            }}
          >
            ▾
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: m ? `0 ${T.space.lg}px ${T.space.lg}px` : `0 ${T.space.xl - 2}px ${T.space.lg + 4}px`, borderTop: T.border.divider }}>
              <div style={{ marginTop: T.space.lg }}>{children}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
