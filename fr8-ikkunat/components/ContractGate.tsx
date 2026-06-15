"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONTRACT_ATTACHMENT,
  CONTRACT_INTRO,
  CONTRACT_META,
  CONTRACT_SECTIONS,
  CustomerInfo,
  ORDER_CHECKS,
  ORDER_OPTIONS,
  PRICE_ROWS,
  SignedContract,
} from "@/lib/contract";

interface Props {
  onSigned: (signed: SignedContract) => void;
}

const PROVIDER_SIGNERS = "Joonatan Juuri · Matias Pitkänen (Puuhapatet)";

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};
const mono: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  fontSize: "11px",
  letterSpacing: "0.14em",
  color: "rgba(255,255,255,0.4)",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: "11px",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  color: "#fff",
  fontSize: "14px",
  outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  color: "rgba(255,255,255,0.55)",
  marginBottom: "6px",
};

function todayStr() {
  return new Date().toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });
}

/** Piirrettävä allekirjoituskenttä (hiiri + kosketus). */
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  const ctx = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return null;
    return c.getContext("2d");
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // Resoluutio näytön mukaan terävän viivan vuoksi.
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
      g.strokeStyle = "#ffffff";
    }
  }, []);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const g = ctx();
    if (!g || !last.current) return;
    const p = pos(e);
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
  const clear = () => {
    const c = canvasRef.current;
    const g = ctx();
    if (c && g) g.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange("");
  };

  return (
    <div>
      <div style={{ position: "relative", borderRadius: "13px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ display: "block", width: "100%", height: "150px", touchAction: "none", cursor: "crosshair" }}
        />
        {empty && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", color: "rgba(255,255,255,0.25)", fontSize: "13px" }}>
            Piirrä allekirjoitus tähän
          </div>
        )}
      </div>
      <button type="button" onClick={clear} style={{ marginTop: "8px", background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}>
        Tyhjennä
      </button>
    </div>
  );
}

export default function ContractGate({ onSigned }: Props) {
  const [order, setOrder] = useState<"A" | "B">("A");
  const [checks, setChecks] = useState<boolean[]>([true, false]);
  const [customer, setCustomer] = useState<CustomerInfo>({
    legalName: "",
    businessId: "",
    billingAddress: "",
    eInvoice: "",
    contactPerson: CONTRACT_META.customerContact,
  });
  const [signerName, setSignerName] = useState("");
  const [place, setPlace] = useState("Helsinki");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // B-vaihtoehto rastittaa myös sektori 2 -tavoitteen.
  const chooseOrder = (id: "A" | "B") => {
    setOrder(id);
    setChecks([true, id === "B"]);
  };

  const set = (k: keyof CustomerInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCustomer((c) => ({ ...c, [k]: e.target.value }));

  const handleSubmit = async () => {
    setError("");
    if (!customer.legalName.trim()) return setError("Täytä tilaajan virallinen nimi.");
    if (!signerName.trim()) return setError("Täytä allekirjoittajan nimenselvennys.");
    if (!signatureDataUrl) return setError("Piirrä allekirjoitus allekirjoituskenttään.");
    if (!agreed) return setError("Vahvista hyväksyntä rastittamalla suostumus.");

    const signed: SignedContract = {
      contractId: CONTRACT_META.contractId,
      signedAt: Date.now(),
      order,
      checks,
      customer,
      signerName: signerName.trim(),
      place: place.trim(),
      signatureDataUrl,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    };

    setSubmitting(true);
    // Tallennetaan adminille parhaan kyvyn mukaan (palvelin), ei estä jatkoa jos ei käytettävissä.
    try {
      await fetch("/api/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
      });
    } catch {
      /* offline / staattinen hosting — paikallinen tallennus + lataus riittää */
    }
    setSubmitting(false);
    onSigned(signed);
  };

  const chosen = ORDER_OPTIONS.find((o) => o.id === order)!;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", color: "#fff", overflowY: "auto", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
      <div className="anim-drift" style={{ position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)", width: "1100px", height: "700px", background: "radial-gradient(ellipse at center, rgba(120,120,160,0.10), transparent 65%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 10, maxWidth: "860px", margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* Otsikko */}
        <div className="anim-fadeUp-0" style={{ textAlign: "center", marginBottom: "30px" }}>
          <div style={{ ...mono, letterSpacing: "0.2em", marginBottom: "10px" }}>PUUHAPATET · {CONTRACT_META.contractId}</div>
          <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 800, letterSpacing: "-0.02em" }}>{CONTRACT_META.heading}</h1>
          <div style={{ fontSize: "15px", color: "rgba(255,255,255,0.55)", marginTop: "8px" }}>{CONTRACT_META.tagline}</div>
          <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.7)", marginTop: "16px" }}>{CONTRACT_META.service}</div>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)" }}>{CONTRACT_META.address}</div>
        </div>

        {/* Metatiedot */}
        <div className="anim-fadeUp-1" style={{ ...card, padding: "20px 24px", marginBottom: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
          {[
            ["Päiväys", CONTRACT_META.date],
            ["Voimassa", `${CONTRACT_META.validUntil} saakka`],
            ["Tilaaja", CONTRACT_META.customer],
            ["Yhteyshenkilö", CONTRACT_META.customerContact],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={mono}>{k.toUpperCase()}</div>
              <div style={{ fontSize: "14px", fontWeight: 600, marginTop: "5px" }}>{v}</div>
            </div>
          ))}
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={mono}>PALVELUNTARJOAJAT</div>
            <div style={{ fontSize: "13px", marginTop: "5px", color: "rgba(255,255,255,0.8)" }}>{CONTRACT_META.providers}</div>
            <div style={{ fontSize: "12px", marginTop: "6px", color: "rgba(255,255,255,0.45)" }}>{CONTRACT_META.contactInfo}</div>
          </div>
        </div>

        {/* Johdanto */}
        <div className="anim-fadeUp-2" style={{ ...card, padding: "22px 24px", marginBottom: "16px" }}>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>{CONTRACT_INTRO}</p>
        </div>

        {/* Hinnoittelutaulukko */}
        <div className="anim-fadeUp-3" style={{ ...card, padding: "22px 24px", marginBottom: "16px" }}>
          <div style={{ ...mono, marginBottom: "14px" }}>HINNOITTELU · HINTAKATTO</div>
          {PRICE_ROWS.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: "13.5px" }}>{r.label}</span>
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{r.accrual}</span>
              <span style={{ fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap" }}>{r.cap}</span>
            </div>
          ))}
        </div>

        {/* Sopimusehdot */}
        <div className="anim-fadeUp-4" style={{ ...card, padding: "8px 24px 18px", marginBottom: "16px" }}>
          {CONTRACT_SECTIONS.map((s) => (
            <section key={s.no} style={{ padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <h2 style={{ margin: "0 0 10px", fontSize: "15px", fontWeight: 700 }}>
                <span style={{ color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px", marginRight: "10px" }}>{s.no}</span>
                {s.title}
              </h2>
              {s.body.map((p, i) =>
                p.startsWith("• ") ? (
                  <div key={i} style={{ display: "flex", gap: "9px", fontSize: "13.5px", lineHeight: 1.6, color: "rgba(255,255,255,0.78)", marginBottom: "5px" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>•</span>
                    <span>{p.slice(2)}</span>
                  </div>
                ) : (
                  <p key={i} style={{ margin: "0 0 9px", fontSize: "13.5px", lineHeight: 1.65, color: "rgba(255,255,255,0.78)" }}>{p}</p>
                )
              )}
            </section>
          ))}
          <p style={{ margin: "14px 0 0", fontSize: "12.5px", color: "rgba(255,255,255,0.45)" }}>{CONTRACT_ATTACHMENT}</p>
        </div>

        {/* Esikysely / tilaus */}
        <div className="anim-fadeUp-5" style={{ ...card, padding: "24px", marginBottom: "16px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>TILAUS · VALITSE LAAJUUS</div>
          <div style={{ display: "grid", gap: "10px", marginBottom: "22px" }}>
            {ORDER_OPTIONS.map((o) => {
              const active = order === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => chooseOrder(o.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px", textAlign: "left", cursor: "pointer",
                    padding: "16px 18px", borderRadius: "14px",
                    border: `1px solid ${active ? "rgba(95,224,138,0.6)" : "rgba(255,255,255,0.12)"}`,
                    background: active ? "rgba(95,224,138,0.08)" : "rgba(255,255,255,0.03)",
                    color: "#fff", transition: "all .15s",
                  }}
                >
                  <span style={{ width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, border: `2px solid ${active ? "#5fe08a" : "rgba(255,255,255,0.4)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {active && <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#5fe08a" }} />}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontSize: "11px", fontFamily: "var(--font-jetbrains-mono, monospace)", color: "rgba(255,255,255,0.45)" }}>VAIHTOEHTO {o.id}</span>
                    <span style={{ display: "block", fontSize: "14px", fontWeight: 600, marginTop: "2px" }}>{o.label}</span>
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap" }}>{o.max}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            {ORDER_CHECKS.map((label, i) => (
              <label key={i} style={{ display: "flex", gap: "11px", alignItems: "flex-start", fontSize: "13px", color: "rgba(255,255,255,0.78)", cursor: "pointer", lineHeight: 1.5 }}>
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                  style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#5fe08a", flexShrink: 0 }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Tilaajan tiedot */}
        <div className="anim-fadeUp-6" style={{ ...card, padding: "24px", marginBottom: "16px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>TILAAJAN TIEDOT</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Tilaajan virallinen nimi *</label>
              <input style={inputStyle} value={customer.legalName} onChange={set("legalName")} placeholder="Esim. Fr8 Oy" />
            </div>
            <div>
              <label style={labelStyle}>Y-tunnus</label>
              <input style={inputStyle} value={customer.businessId} onChange={set("businessId")} placeholder="0000000-0" />
            </div>
            <div>
              <label style={labelStyle}>Yhteyshenkilö ja puhelin</label>
              <input style={inputStyle} value={customer.contactPerson} onChange={set("contactPerson")} placeholder="Nimi, +358…" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Laskutusosoite</label>
              <input style={inputStyle} value={customer.billingAddress} onChange={set("billingAddress")} placeholder="Katuosoite, postinumero ja -toimipaikka" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Verkkolaskuosoite / sähköposti</label>
              <input style={inputStyle} value={customer.eInvoice} onChange={set("eInvoice")} placeholder="verkkolaskuosoite tai lasku@…" />
            </div>
          </div>
        </div>

        {/* Allekirjoitus */}
        <div className="anim-fadeUp-7" style={{ ...card, padding: "24px", marginBottom: "16px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>ALLEKIRJOITUS</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "16px" }}>
            <div>
              <label style={labelStyle}>Nimenselvennys *</label>
              <input style={inputStyle} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Allekirjoittajan nimi" />
            </div>
            <div>
              <label style={labelStyle}>Paikka</label>
              <input style={inputStyle} value={place} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </div>
          <label style={labelStyle}>Allekirjoitus *</label>
          <SignaturePad onChange={setSignatureDataUrl} />
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginTop: "10px" }}>
            Aika: {todayStr()} · Palveluntarjoaja: {PROVIDER_SIGNERS}
          </div>

          <label style={{ display: "flex", gap: "11px", alignItems: "flex-start", fontSize: "13px", color: "rgba(255,255,255,0.85)", cursor: "pointer", marginTop: "18px", lineHeight: 1.5 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#5fe08a", flexShrink: 0 }} />
            <span>Hyväksyn tämän tarjouksen ja sopimuksen ({CONTRACT_META.contractId}) sisällön ja vahvistan tilauksen vaihtoehdon mukaisesti: <b>{chosen.label} ({chosen.max})</b>. Hyväksyntä muodostaa osapuolia sitovan sopimuksen.</span>
          </label>
        </div>

        {error && (
          <div style={{ ...card, padding: "13px 18px", marginBottom: "14px", border: "1px solid rgba(255,120,120,0.4)", background: "rgba(255,80,80,0.08)", fontSize: "13px", color: "#ffb4b4" }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: "100%", padding: "17px", borderRadius: "15px", border: "none", cursor: submitting ? "default" : "pointer",
            background: "#ffffff", color: "#0a0a0c", fontSize: "16px", fontWeight: 700, letterSpacing: "0.01em",
            boxShadow: "0 0 26px rgba(255,255,255,0.18)", opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Tallennetaan…" : "Hyväksy ja allekirjoita → avaa seurantapaneeli"}
        </button>
        <div style={{ textAlign: "center", fontSize: "12px", color: "rgba(255,255,255,0.4)", marginTop: "12px" }}>
          Allekirjoitettu sopimus tallentuu Puuhapatetin adminiin ja ladataan tiedostona itsellesi.
        </div>
      </div>
    </div>
  );
}
