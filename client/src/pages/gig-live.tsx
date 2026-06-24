/**
 * Public live progress view for a custom gig (read-only, shareable link).
 *
 * Styled to match the Puuhapatet contract document (PT-…): Poppins, airy,
 * minimalist, thin hairlines, tabular numbers. Independent of the admin theme
 * so it always reads like the contract. Auto-refreshes every ~30 s.
 */

import { useCallback, useEffect, useState } from "react";
import { useRoute } from "wouter";
import { api, type GigPublicView } from "@/lib/api";
import { eur } from "@shared/gig";
import GigContractSign from "@/components/GigContractSign";
import CustomerFloorMap from "@/components/CustomerFloorMap";
import { downloadGigContract } from "@/lib/gig-contract-doc";

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

  const reload = useCallback(async () => {
    const res = await api.getGig(token);
    if (res.ok && res.data) { setData(res.data); setStatus("ok"); }
  }, [token]);

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

  if (status === "loading") return <Centered>Ladataan…</Centered>;
  if (status === "error" || !data) return <Centered>Seurantaa ei löytynyt.</Centered>;

  // The intro is the signing: gate the live view until the contract is signed.
  if (data.requireSignature && !data.signed) {
    return <GigContractSign token={token} view={data} onSigned={reload} />;
  }

  const t = data.totals;
  // For fixed-price contracts: percentage and accumulated amount track invoices
  // (25 % increments per instalment), not actual window counts.
  const pct = data.isFixedDeal
    ? Math.min(100, data.paymentsCount * 25)
    : Math.round(t.percentByCap * 100);
  const displayedAccruedCents = data.isFixedDeal
    ? data.paymentsCount * Math.round(t.capCents / 4)
    : t.accruedCents;
  const updated = new Date(data.updatedAt).toLocaleString("fi-FI", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "28px 16px 48px" }}>
      <style>{`@keyframes ppPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>Puuhapatet</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
              {data.contractId ? `${data.contractId} · ` : ""}{data.companyName}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: "0.08em", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "5px 10px", background: T.card }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "#3E7C59", animation: "ppPulse 1.8s ease-in-out infinite" }} />
              LIVE
            </span>
            {data.approved
              ? <StatusBadge color="#1F3B57" label={`Hyväksytty${data.approvedAt ? " " + fmtDate(data.approvedAt) : ""}`} />
              : data.signed
                ? <StatusBadge color="#3E7C59" label={`Allekirjoitettu${data.signedAt ? " " + fmtDate(data.signedAt) : ""}`} />
                : null}
          </div>
        </div>

        {/* Hero: radial gauge + headline figures */}
        <Panel>
          <p style={{ margin: "0 0 4px", fontSize: 13, color: T.muted }}>{data.description}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginTop: 8 }}>
            <Gauge sectors={data.sectors} capCents={t.capCents} pct={pct} isFixedDeal={data.isFixedDeal} />
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <p style={label}>Kertynyt summa</p>
              <p style={{ margin: "2px 0 0", fontSize: 40, fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{eur(displayedAccruedCents)}</p>
              <p style={{ margin: "6px 0 0", fontSize: 14, color: T.muted }}>
                Sovittu kokonaishinta <span style={{ fontWeight: 600, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{eur(t.capCents)}</span>
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                Tälle sopimukselle on sovittu kiinteä kokonaishinta. Työ tehdään sopimuksen mukaisten ehtojen mukaisesti.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <Chip label="Edistyminen" value={`${pct} %`} />
              </div>
            </div>
          </div>

          {/* Progress bar: invoice-based (fixed deal) or window-based (standard gig) */}
          <div style={{ height: 10, width: "100%", borderRadius: 999, background: T.paper, overflow: "hidden", display: "flex", marginTop: 20 }}>
            {data.isFixedDeal ? (
              <div style={{ width: `${pct}%`, background: T.navy, height: "100%", borderRadius: 999 }} />
            ) : (
              data.sectors.map((s) => {
                const w = t.capCents > 0 ? (s.washed * s.unitPriceCents) / t.capCents * 100 : 0;
                return <div key={s.id} style={{ width: `${w}%`, background: s.color, height: "100%" }} />;
              })
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${T.hair}` }}>
            <div>
              <p style={label}>Sovittu kokonaishinta</p>
              <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{eur(t.capCents)}</p>
            </div>
            {!data.isFixedDeal && t.creditCents > 0 && (
              <div style={{ textAlign: "right" }}>
                <p style={label}>Hyvitykset</p>
                <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>−{eur(t.creditCents)}</p>
              </div>
            )}
          </div>
        </Panel>

        {/* Sector cards — hidden for fixed-price deals (flat rate, no per-sector billing). */}
        {!data.isFixedDeal && data.sectors.map((s) => {
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                <span>Pesty <strong style={{ fontVariantNumeric: "tabular-nums" }}>{sp} %</strong></span>
                {s.skipped > 0 && (
                  <span style={{ color: T.muted, fontSize: 13 }}>Kuntovaraus {s.skipped} kpl · hyvitys −{eur(credit)}</span>
                )}
              </div>
            </Panel>
          );
        })}

        {/* Read-only floor-plan map — customer watches washed windows live. */}
        {data.map && (
          <Panel>
            <p style={{ margin: "0 0 4px", ...label }}>Pohjapiirros</p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: T.muted }}>
              Näet reaaliaikaisesti mitkä ikkunat on pesty. Kartta päivittyy työn edetessä.
            </p>
            <CustomerFloorMap map={data.map} />
            <p style={{ margin: "14px 0 0", fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              Keltaisella merkityt ikkunat eivät kuulu tähän sopimukseen — niiden tilanne
              katsotaan seuraavassa sopimuksessa.
            </p>
          </Panel>
        )}

        {/* Boss bulletins — short notes the team posts about the work (newest first). */}
        {data.updates && data.updates.length > 0 && (
          <Panel>
            <p style={{ margin: "0 0 4px", ...label }}>Tiedotteet</p>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: T.muted }}>Huomioita työn etenemisestä.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.updates.map((u) => (
                <div key={u.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 6, width: 7, height: 7, borderRadius: 999, background: T.navy }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: T.ink, whiteSpace: "pre-wrap" }}>{u.text}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 11.5, color: T.muted }}>
                      {new Date(u.ts).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Two-way info / contact note — keep it simple: WhatsApp for anything urgent. */}
        <Panel>
          <p style={{ margin: "0 0 4px", ...label }}>Tiedotus</p>
          <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.7 }}>
            Jos rakennuksessa on jotain työhön vaikuttavaa (esim. kulku, hälytykset, telineet
            tai ajankohtaiset huomiot), laita meille viestiä — vastaamme nopeasti. Ilmoitamme
            myös itse tästä näkymästä, jos jotain huomioitavaa tulee.
          </p>
          <a
            href="https://wa.me/358400389999"
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "none", background: "#25D366", color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            💬 Laita WhatsApp-viesti
          </a>
        </Panel>

        {/* Reassurance note */}
        <Panel>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
            {data.customerNote || "Tälle sopimukselle on sovittu kiinteä kokonaishinta, ja työ tehdään sopimuksen mukaisten ehtojen mukaisesti. Voit seurata edistymistä reaaliaikaisesti tästä näkymästä."}
          </p>
          {data.vatNote && <p style={{ margin: "10px 0 0", fontSize: 12, color: T.muted }}>{data.vatNote}</p>}
          {data.signature && (
            <button
              type="button"
              onClick={() => downloadGigContract({
                contractId: data.contractId,
                companyName: data.companyName,
                description: data.description,
                vatNote: data.vatNote,
                customerNote: data.customerNote,
                contractText: data.contractText,
                sectors: data.sectors,
                capCents: data.totals.capCents,
                signature: {
                  signerName: data.signature!.signerName,
                  place: data.signature!.place ?? undefined,
                  signedAt: data.signature!.signedAt,
                  customer: data.signature!.customer,
                  signatureDataUrl: data.signature!.signatureDataUrl,
                },
                approvedAt: data.approvedAt,
              })}
              style={{ marginTop: 14, width: "100%", padding: "11px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.ink, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
            >
              Lataa allekirjoitettu sopimus
            </button>
          )}
        </Panel>

        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 8 }}>
          Viimeksi päivitetty {updated} · päivittyy automaattisesti · puuhapatet.fi
        </p>
      </div>
    </div>
  );
}

/** Radial gauge: for fixed-price deals one arc at payment-based %; otherwise multi-segment. */
function Gauge({ sectors, capCents, pct, isFixedDeal }: {
  sectors: GigPublicView["sectors"]; capCents: number; pct: number; isFixedDeal: boolean;
}) {
  const size = 132, stroke = 13, r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  const arcs = isFixedDeal
    ? [<circle
        key="fixed"
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={T.navy} strokeWidth={stroke}
        strokeDasharray={`${(pct / 100) * C} ${C - (pct / 100) * C}`}
        strokeDashoffset={0}
        strokeLinecap="butt"
      />]
    : sectors.map((s) => {
        const frac = capCents > 0 ? (s.washed * s.unitPriceCents) / capCents : 0;
        const len = frac * C;
        const arc = (
          <circle
            key={s.id}
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += len;
        return arc;
      });
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.paper} strokeWidth={stroke} />
        {arcs}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
        <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>sovitusta</span>
      </div>
    </div>
  );
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });
}

/** Signed / approved marking shown in the header. */
function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color, letterSpacing: "0.04em", border: `1px solid ${color}33`, borderRadius: 999, padding: "5px 10px", background: `${color}12`, whiteSpace: "nowrap" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      {label}
    </span>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", border: `1px solid ${T.hair}`, borderRadius: 10, padding: "6px 12px", background: T.paper }}>
      <span style={{ fontSize: 10, color: T.muted, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

const label: React.CSSProperties = {
  margin: 0, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted,
};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
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
