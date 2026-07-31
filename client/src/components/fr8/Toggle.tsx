/**
 * FR8 projektinäkymä — small animated switch in the dark glass style.
 *
 * FR8-native (inline styles + framer-motion) so it sits cleanly inside the panel,
 * unlike the Tailwind-themed components/ui/switch.tsx. Reusable wherever a compact
 * on/off control is needed (first use: the workers "Kaikki / Vain aktiiviset" filter).
 */
import { motion } from "framer-motion";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}

export default function Toggle({ checked, onChange, ariaLabel }: Props) {
  return (
    // Kuori antaa 40 px:n osumakorkeuden ILMAN että itse kytkin venyy.
    // Ilman tätä `[data-fr8-pane] button:not([data-fr8-dot]) { min-height: 40px }`
    // (index.css) nosti 24 px:n kytkimen 40 px:iin, jolloin nuppi (`top: 2`) jäi
    // roikkumaan kapselin yläreunaan ja kytkin näytti rikkinäiseltä.
    <span style={{ display: "inline-flex", alignItems: "center", minHeight: 40, flexShrink: 0 }}>
      <button
        type="button"
        role="switch"
        // `data-fr8-dot` on dokumentoitu poikkeus tuosta min-height-säännöstä
        // (ks. docs/fr8-jarjestelma-yleiskuva.md "Nappia pitää painaa…").
        data-fr8-dot
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          width: 42,
          height: 24,
          minHeight: 24,
          flexShrink: 0,
          padding: 0,
          borderRadius: 999,
          cursor: "pointer",
          border: `1px solid ${checked ? "rgba(95,224,138,0.5)" : "rgba(255,255,255,0.14)"}`,
          background: checked ? "rgba(95,224,138,0.22)" : "rgba(255,255,255,0.06)",
          transition: "background .2s ease, border-color .2s ease",
        }}
      >
        <motion.span
          aria-hidden
          animate={{ x: checked ? 21 : 3 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          style={{
            position: "absolute",
            top: 2,
            left: 0,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: checked ? "#5fe08a" : "rgba(255,255,255,0.82)",
            boxShadow: checked ? "0 0 8px rgba(95,224,138,0.8)" : "0 1px 3px rgba(0,0,0,0.45)",
          }}
        />
      </button>
    </span>
  );
}
