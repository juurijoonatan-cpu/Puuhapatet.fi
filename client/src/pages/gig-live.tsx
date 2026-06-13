/**
 * Public live progress view for a custom gig (read-only, shareable link).
 *
 * Styled to match the Puuhapatet contract document (PT-…): Poppins, airy,
 * minimalist, thin hairlines, tabular numbers. Independent of the admin theme
 * so it always reads like the contract. Auto-refreshes every ~30 s.
 */

import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { api, type GigPublicView } from "@/lib/api";
import { eur } from "@shared/gig";

const T = {
  ink: "#1A1A1A",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  hair: "#E4E1D7",
  muted: "#8C8A82",
  navy: "#1F3B57",
};

const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

export default function GigLivePage() {
  const [, params] = useRoute("/seuranta/:token");
  const token = params?.token ?? "";
  const [data, setData] = useState<GigPublicView | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    // Load Poppins for contract-faithful typography.
    const id = "poppins-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(link);
    }
    document.title = "Puuhapatet — Edistyminen";
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      const res = await api.getGig(token);
      if (!active) return;
      if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
      else setStatus((s) => (s === "ok" ? "ok" : "error"));
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { active = false; clearInterval(iv); };
  }, [token]);

  if (status === "loading") {
    return <Centered>Ladataan…</Centered>;
  }
  if (status === "error" || !data) {
    return <Centered>Seurantaa ei löytynyt.</Centered>;
  }

  const t = data.totals;
  const pct = Math.round(t.percentByCap * 100);
  const updated = new Date(data.updatedAt).toLocaleString("fi-FI", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "32px 16px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>Puuhapatet</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
            {data.contractId ? `${data.contractId} · ` : ""}{data.companyName} · {data.description}
          </p>
        </div>

        {/* Accrual headline card */}
        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <p style={label}>Kertynyt summa</p>
              <p style={{ margin: 0, fontSize: 44, fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{eur(t.accruedCents)}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={label}>Hintakatto</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 600, color: T.muted, fontVariantNumeric: "tabular-nums" }}>{eur(t.capCents)}</p>
            </div>
          </div>

          {/* Segmented bar */}
          <div style={{ height: 12, width: "100%", borderRadius: 999, background: T.paper, overflow: "hidden", display: "flex", marginTop: 16 }}>
            {data.sectors.map((s) => {
              const w = t.capCents > 0 ? (s.washed * s.unitPriceCents) / t.capCents * 100 : 0;
              return <div key={s.id} style={{ width: `${w}%`, background: s.color, height: "100%" }} />;
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 14 }}>
            <span style={{ color: T.muted }}>{t.washedTotal} / {t.unitTotal} pesty</span>
            <span style={{ fontWeight: 600 }}>{pct} %</span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.hair}` }}>
            <div>
              <p style={label}>Arvioitu loppusumma</p>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{eur(t.estimatedFinalCents)}</p>
            </div>
            {t.creditCents > 0 && (
              <div style={{ textAlign: "right" }}>
                <p style={label}>Hyvitykset</p>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>−{eur(t.creditCents)}</p>
              </div>
            )}
          </div>
        </Panel>

        {/* Sector cards */}
        {data.sectors.map((s) => {
          const accrued = s.washed * s.unitPriceCents;
          const cap = s.total * s.unitPriceCents;
          const credit = s.skipped * s.unitPriceCents;
          const sp = s.total > 0 ? Math.round((s.washed / s.total) * 100) : 0;
          return (
            <Panel key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: s.color, display: "inline-block" }} />
                  {s.name}
                </span>
                <span style={{ fontSize: 14, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                  {eur(accrued)} <span style={{ opacity: 0.6 }}>/ {eur(cap)}</span>
                </span>
              </div>
              <div style={{ height: 8, width: "100%", borderRadius: 999, background: T.paper, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${sp}%`, background: s.color }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{s.washed}</strong> / {s.total} ({sp} %)</span>
                {s.skipped > 0 && (
                  <span style={{ color: T.muted, fontSize: 13 }}>Kuntovaraus {s.skipped} kpl · hyvitys −{eur(credit)}</span>
                )}
              </div>
            </Panel>
          );
        })}

        {/* Reassurance note */}
        <Panel>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
            {data.customerNote || "Maksat vain pestyistä ikkunoista. Hinta ei voi koskaan ylittää sovittua kattoa, ja jokainen pesemättä jäävä ikkuna jää kokonaan pois laskulta."}
          </p>
          {data.vatNote && <p style={{ margin: "10px 0 0", fontSize: 12, color: T.muted }}>{data.vatNote}</p>}
        </Panel>

        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 8 }}>
          Viimeksi päivitetty {updated} · päivittyy automaattisesti · puuhapatet.fi
        </p>
      </div>
    </div>
  );
}

const label: React.CSSProperties = {
  margin: 0, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted,
};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.muted, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      {children}
    </div>
  );
}
