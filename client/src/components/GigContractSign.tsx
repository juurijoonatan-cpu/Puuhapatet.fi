/**
 * Customer contract signing intro for the public live link.
 *
 * Shown before the live tracking view opens: the customer reads the contract,
 * fills the pre-questionnaire (tilaajan tiedot), draws a signature and accepts.
 * On success the parent reloads the gig and the live view takes over.
 *
 * Styled to match gig-live.tsx (contract paper look — Poppins, airy, hairlines).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type GigPublicView, type GigSignPayload } from "@/lib/api";
import { eur } from "@shared/gig";

const T = {
  ink: "#1A1A1A",
  paper: "#F6F4EE",
  card: "#FFFFFF",
  hair: "#E4E1D7",
  muted: "#8C8A82",
  navy: "#1F3B57",
  green: "#3E7C59",
};
const FONT = "'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

interface Props {
  token: string;
  view: GigPublicView;
  onSigned: () => void;
}

/** Drawable signature field (mouse + touch). */
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const g = c.getContext("2d");
    if (g) {
      g.scale(ratio, ratio);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 2.2;
      g.strokeStyle = T.ink;
    }
  }, []);

  const posOf = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    last.current = posOf(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const g = canvasRef.current?.getContext("2d");
    if (!g || !last.current) return;
    const p = posOf(e);
    g.beginPath();
    g.moveTo(last.current.x, last.current.y);
    g.lineTo(p.x, p.y);
    g.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvasRef.current;
    if (c) onChange(c.toDataURL("image/png"));
  };
  const clear = useCallback(() => {
    const c = canvasRef.current;
    const g = c?.getContext("2d");
    if (c && g) g.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange("");
  }, [onChange]);

  return (
    <div>
      <div style={{ position: "relative", borderRadius: 12, border: `1px solid ${T.hair}`, background: T.paper, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ display: "block", width: "100%", height: 150, touchAction: "none", cursor: "crosshair" }}
        />
        {empty && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", color: T.muted, fontSize: 13 }}>
            Piirrä allekirjoitus tähän
          </div>
        )}
      </div>
      <button type="button" onClick={clear} style={{ marginTop: 8, background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
        Tyhjennä
      </button>
    </div>
  );
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.hair}`, borderRadius: 14, padding: 20, marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

const labelCss: React.CSSProperties = { display: "block", fontSize: 12, color: T.muted, marginBottom: 6 };
const inputCss: React.CSSProperties = {
  width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${T.hair}`,
  background: T.paper, color: T.ink, fontSize: 14, fontFamily: FONT, outline: "none",
};

export default function GigContractSign({ token, view, onSigned }: Props) {
  const c = view.company;
  const [customer, setCustomer] = useState({
    legalName: c?.name ?? "",
    businessId: c?.businessId ?? "",
    billingAddress: c?.address ?? "",
    eInvoice: c?.email ?? "",
    contactPerson: c?.contact ?? "",
  });
  const [signerName, setSignerName] = useState("");
  const [place, setPlace] = useState("Helsinki");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = "poppins-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(link);
    }
    document.title = "Puuhapatet — Sopimuksen hyväksyntä";
  }, []);

  const totalCap = view.totals.capCents;
  const set = (k: keyof typeof customer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCustomer((v) => ({ ...v, [k]: e.target.value }));

  const submit = async () => {
    setError("");
    if (!customer.legalName.trim()) return setError("Täytä tilaajan virallinen nimi.");
    if (!signerName.trim()) return setError("Täytä allekirjoittajan nimi.");
    if (!signatureDataUrl) return setError("Piirrä allekirjoitus allekirjoituskenttään.");
    if (!agreed) return setError("Vahvista hyväksyntä rastittamalla suostumus.");

    const payload: GigSignPayload = {
      signerName: signerName.trim(),
      place: place.trim() || undefined,
      signatureDataUrl,
      acceptedSectorIds: view.sectors.map((s) => s.id),
      customer: {
        legalName: customer.legalName.trim(),
        businessId: customer.businessId.trim() || undefined,
        billingAddress: customer.billingAddress.trim() || undefined,
        eInvoice: customer.eInvoice.trim() || undefined,
        contactPerson: customer.contactPerson.trim() || undefined,
      },
    };
    setSubmitting(true);
    const res = await api.signGig(token, payload);
    setSubmitting(false);
    if (res.ok) onSigned();
    else setError(res.error || "Allekirjoituksen tallennus epäonnistui. Yritä uudelleen.");
  };

  return (
    <div style={{ minHeight: "100vh", background: T.paper, fontFamily: FONT, color: T.ink, padding: "28px 16px 64px" }}>
      <style>{`@keyframes ppRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.pp-rise{animation:ppRise .45s ease both}`}</style>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div className="pp-rise" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>Puuhapatet</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: T.muted }}>
              {view.contractId ? `${view.contractId} · ` : ""}Tarjous & sopimus
            </p>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: T.navy, letterSpacing: "0.06em", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "5px 10px", background: T.card }}>
            ALLEKIRJOITETTAVANA
          </span>
        </div>

        <Panel style={{ animationDelay: ".04s" }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
            Tervetuloa. Tämä on <strong>{view.companyName}</strong>n ja Puuhapatetin välinen sopimus
            {view.description ? <> — {view.description}</> : null}. Lue sopimus, täytä tilaajan tiedot ja
            allekirjoita alla. Hyväksynnän jälkeen pääset suoraan reaaliaikaiseen seurantapaneeliin, jossa
            näet työn etenemisen ja kertyvän summan suhteessa hintakattoon.
          </p>
        </Panel>

        {/* Pricing summary */}
        <Panel>
          <p style={mono}>HINNOITTELU · HINTAKATTO</p>
          <div style={{ marginTop: 10 }}>
            {view.sectors.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${T.hair}` }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color }} />
                  {s.name} <span style={{ color: T.muted }}>· {s.total} {s.unitLabel}a</span>
                </span>
                <span style={{ fontSize: 13, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                  {eur(s.unitPriceCents)} / {s.unitLabel} · <strong style={{ color: T.ink }}>{eur(s.total * s.unitPriceCents)}</strong>
                </span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 12 }}>
              <span style={{ fontWeight: 600 }}>Hintakatto yhteensä</span>
              <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{eur(totalCap)}</span>
            </div>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
            Maksat vain pestyistä {view.sectors[0]?.unitLabel ?? "ikkun"}oista. Hinta ei voi koskaan ylittää
            kattoa, ja jokainen pesemättä jäävä jää kokonaan pois laskulta.
            {view.vatNote ? ` ${view.vatNote}` : ""}
          </p>
        </Panel>

        {/* Contract text */}
        {view.contractText && (
          <Panel>
            <p style={mono}>SOPIMUSTEKSTI</p>
            <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap", fontFamily: FONT, fontSize: 13.5, lineHeight: 1.7, color: T.ink, maxHeight: 360, overflowY: "auto" }}>
              {view.contractText}
            </pre>
          </Panel>
        )}

        {/* Pre-questionnaire */}
        <Panel>
          <p style={mono}>TILAAJAN TIEDOT</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelCss}>Tilaajan virallinen nimi *</label>
              <input style={inputCss} value={customer.legalName} onChange={set("legalName")} placeholder="Esim. Fr8 Oy" />
            </div>
            <div>
              <label style={labelCss}>Y-tunnus</label>
              <input style={inputCss} value={customer.businessId} onChange={set("businessId")} placeholder="0000000-0" />
            </div>
            <div>
              <label style={labelCss}>Yhteyshenkilö ja puhelin</label>
              <input style={inputCss} value={customer.contactPerson} onChange={set("contactPerson")} placeholder="Nimi, +358…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelCss}>Laskutusosoite</label>
              <input style={inputCss} value={customer.billingAddress} onChange={set("billingAddress")} placeholder="Katuosoite, postinumero ja -toimipaikka" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelCss}>Verkkolaskuosoite / sähköposti</label>
              <input style={inputCss} value={customer.eInvoice} onChange={set("eInvoice")} placeholder="verkkolaskuosoite tai lasku@…" />
            </div>
          </div>
        </Panel>

        {/* Signature */}
        <Panel>
          <p style={mono}>ALLEKIRJOITUS</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, margin: "12px 0 14px" }}>
            <div>
              <label style={labelCss}>Nimenselvennys *</label>
              <input style={inputCss} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Allekirjoittajan nimi" />
            </div>
            <div>
              <label style={labelCss}>Paikka</label>
              <input style={inputCss} value={place} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </div>
          <label style={labelCss}>Allekirjoitus *</label>
          <SignaturePad onChange={setSignatureDataUrl} />
          <div style={{ fontSize: 12, color: T.muted, marginTop: 10 }}>
            Aika: {new Date().toLocaleDateString("fi-FI")} · Palveluntarjoaja: Puuhapatet
          </div>

          <label style={{ display: "flex", gap: 11, alignItems: "flex-start", fontSize: 13.5, color: T.ink, cursor: "pointer", marginTop: 16, lineHeight: 1.5 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: T.green, flexShrink: 0 }} />
            <span>
              Hyväksyn tämän tarjouksen ja sopimuksen{view.contractId ? ` (${view.contractId})` : ""} sisällön.
              Hyväksyntä muodostaa osapuolia sitovan sopimuksen ja valtuuttaa Puuhapatetin tekemään työn
              tämän asiakirjan mukaisesti.
            </span>
          </label>
        </Panel>

        {error && (
          <Panel style={{ border: "1px solid #E2B4B4", background: "#FBEFEF" }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "#9B2C2C" }}>{error}</p>
          </Panel>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{
            width: "100%", padding: 16, borderRadius: 14, border: "none", cursor: submitting ? "default" : "pointer",
            background: T.ink, color: "#fff", fontSize: 16, fontWeight: 700, fontFamily: FONT,
            opacity: submitting ? 0.7 : 1, transition: "opacity .15s",
          }}
        >
          {submitting ? "Tallennetaan…" : "Hyväksy ja allekirjoita → avaa seurantapaneeli"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: T.muted, marginTop: 12 }}>
          Allekirjoitus tallentuu Puuhapatetille aikaleimoineen. puuhapatet.fi
        </p>
      </div>
    </div>
  );
}

const mono: React.CSSProperties = {
  margin: 0, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, fontWeight: 600,
};
