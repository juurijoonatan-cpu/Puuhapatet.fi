/**
 * LoadingOrb — the app-wide "we're spinning up" loader.
 *
 * The backend can cold-start after an idle period (tens of seconds), and a bare
 * "Ladataan…" makes people think the app is broken. This loader makes the wait
 * feel intentional and premium: a breathing orb with an orbiting spark, a live
 * elapsed counter, and staged copy that after a few seconds reassures the user
 * the system is starting up (never that anything is wrong). Used on every entry
 * view (customer live link, worker dashboard, admin project) in a light or dark
 * variant.
 */
import { useEffect, useState } from "react";

const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const THEMES = {
  light: {
    bg: "#F6F4EE",
    ink: "#1A1A1A",
    muted: "#8C8A82",
    orb: "#1F3B57",          // navy core
    ring: "rgba(31,59,87,0.16)",
    spark: "#E0A800",
    card: "rgba(255,255,255,0.7)",
    hair: "#E4E1D7",
  },
  dark: {
    bg: "transparent",       // fr8 pages paint their own dark backdrop
    ink: "#FFFFFF",
    muted: "rgba(255,255,255,0.45)",
    orb: "#7CE0A6",          // fr8 green core
    ring: "rgba(124,224,166,0.16)",
    spark: "#FFCD28",
    card: "rgba(255,255,255,0.04)",
    hair: "rgba(255,255,255,0.09)",
  },
} as const;

/** Staged copy: a quick load shows only the label; a longer wait reassures the
 *  user the system is starting up (premium, confident — never apologetic, never
 *  "it's the cheap server"), so nobody refreshes out of the queue. */
function stageText(sec: number): string | null {
  if (sec < 4) return null;
  if (sec < 12) return "Käynnistetään Puuhapatet…";
  if (sec < 30) return "Muodostetaan suojattua yhteyttä — vain hetki.";
  return "Melkein valmista — kiitos hetkestä. Kaikki toimii normaalisti.";
}

export default function LoadingOrb({
  label = "Ladataan",
  theme = "light",
  fullScreen = true,
}: {
  label?: string;
  theme?: "light" | "dark";
  /** false = fill the parent instead of the viewport (embedded loaders). */
  fullScreen?: boolean;
}) {
  const t = THEMES[theme];
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const stage = stageText(sec);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: fullScreen ? "100vh" : "100%",
        width: "100%",
        background: t.bg,
        fontFamily: FONT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        padding: 24,
        textAlign: "center",
      }}
    >
      <style>{`
        @keyframes ppOrbBreathe {
          0%, 100% { transform: scale(1);    filter: brightness(1); }
          50%      { transform: scale(1.12); filter: brightness(1.25); }
        }
        @keyframes ppOrbRing {
          0%   { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(1.9); opacity: 0; }
        }
        @keyframes ppOrbSpin { to { transform: rotate(360deg); } }
        @keyframes ppOrbFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .pp-orb-anim, .pp-orb-anim * { animation-duration: 0.01s !important; animation-iteration-count: 1 !important; }
        }
      `}</style>

      {/* The orb: breathing core + two expanding halo rings + an orbiting spark */}
      <div className="pp-orb-anim" style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
        {/* Halo rings */}
        {[0, 1].map((i) => (
          <span key={i} aria-hidden style={{
            position: "absolute", inset: 14, borderRadius: "50%",
            border: `2px solid ${t.orb}`,
            animation: `ppOrbRing 2.6s ease-out ${i * 1.3}s infinite`,
          }} />
        ))}
        {/* Static soft ring */}
        <span aria-hidden style={{ position: "absolute", inset: 8, borderRadius: "50%", border: `10px solid ${t.ring}` }} />
        {/* Core */}
        <span aria-hidden style={{
          position: "absolute", inset: 30, borderRadius: "50%",
          background: `radial-gradient(circle at 34% 30%, #ffffff, ${t.orb} 58%)`,
          boxShadow: `0 0 22px ${t.ring}, 0 0 44px ${t.ring}`,
          animation: "ppOrbBreathe 2.6s ease-in-out infinite",
        }} />
        {/* Orbiting spark */}
        <span aria-hidden style={{ position: "absolute", inset: 2, animation: "ppOrbSpin 2.2s linear infinite" }}>
          <span style={{
            position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
            width: 8, height: 8, borderRadius: "50%",
            background: t.spark, boxShadow: `0 0 10px ${t.spark}`,
          }} />
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, maxWidth: 340 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: t.ink, letterSpacing: "-0.01em" }}>
          {label}
          <span aria-hidden style={{ display: "inline-block", width: 18, textAlign: "left" }}>
            {".".repeat((sec % 3) + 1)}
          </span>
        </p>
        {/* Elapsed counter — the "odotuslaskin": proof that time is moving. */}
        <p style={{ margin: 0, fontSize: 12, color: t.muted, fontVariantNumeric: "tabular-nums" }}>
          {sec} s
        </p>
        {stage && (
          <p key={stage} style={{
            margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.6, color: t.muted,
            padding: "10px 14px", borderRadius: 12, background: t.card, border: `1px solid ${t.hair}`,
            animation: "ppOrbFadeIn .5s ease both",
          }}>
            {stage}
          </p>
        )}
      </div>
    </div>
  );
}
