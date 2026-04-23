import { useState, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Send } from "lucide-react";

interface ServiceItem {
  title: string;
  detail: string;
  price: number;
}

interface QuotePresentationProps {
  customerName: string;
  customerAddress: string;
  serviceItems: ServiceItem[];
  total: number;
  workerName: string;
  workerPhone: string;
  onClose: () => void;
  onSend: () => void;
  sending: boolean;
}

const SLIDE_COUNT = 5;

export function QuotePresentation({
  customerName,
  customerAddress,
  serviceItems,
  total,
  workerName,
  workerPhone,
  onClose,
  onSend,
  sending,
}: QuotePresentationProps) {
  const [slide, setSlide] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const firstName = customerName.split(" ")[0] || customerName;
  const kotitalous = Math.round(total * 0.6);
  const savings = total - kotitalous;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") setSlide(s => Math.min(s + 1, SLIDE_COUNT - 1));
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   setSlide(s => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -50) setSlide(s => Math.min(s + 1, SLIDE_COUNT - 1));
    if (dx >  50) setSlide(s => Math.max(s - 1, 0));
    touchStartX.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col select-none"
      style={{ background: "#f8faf5", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ background: "#2d5016" }}>
        <span style={{ color: "#b8e07a", fontWeight: 800, fontSize: 20, letterSpacing: "-0.5px" }}>
          Puuhapatet.
        </span>
        <button onClick={onClose} style={{ color: "rgba(184,224,122,0.7)", padding: 4 }}>
          <X size={22} />
        </button>
      </div>

      {/* Slide content */}
      <div className="flex-1 overflow-hidden relative">

        {/* ── Dia 1: Tervetuloa ── */}
        {slide === 0 && (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#2d5016", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24, fontSize: 32 }}>
              🌿
            </div>
            <h1 style={{ fontSize: "clamp(28px,7vw,52px)", fontWeight: 900, color: "#1a2e0a", letterSpacing: "-1px", marginBottom: 12 }}>
              Hei, {firstName}!
            </h1>
            <p style={{ fontSize: "clamp(15px,3vw,20px)", color: "#4a6c22", marginBottom: 8, fontWeight: 500 }}>
              Olemme koonneet teille tarjouksen
            </p>
            {customerAddress && (
              <p style={{ fontSize: 14, color: "#7a9a52", marginTop: 4 }}>{customerAddress}</p>
            )}
            <p style={{ fontSize: 13, color: "#aab88a", marginTop: 24 }}>
              {new Date().toLocaleDateString("fi-FI", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        )}

        {/* ── Dia 2: Palvelut ── */}
        {slide === 1 && (
          <div className="h-full flex flex-col px-6 py-8 max-w-2xl mx-auto w-full">
            <h2 style={{ fontSize: "clamp(18px,4vw,28px)", fontWeight: 800, color: "#1a2e0a", marginBottom: 24, letterSpacing: "-0.5px" }}>
              Mitä teemme
            </h2>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {serviceItems.map((item, i) => (
                <div key={i} style={{ background: "white", borderRadius: 16, padding: "16px 20px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: "clamp(14px,2.5vw,17px)", color: "#1a2e0a", marginBottom: 4 }}>{item.title}</p>
                    {item.detail && <p style={{ fontSize: 13, color: "#7a9a52" }}>{item.detail}</p>}
                  </div>
                  <p style={{ fontWeight: 800, fontSize: "clamp(16px,3vw,20px)", color: "#2d5016", whiteSpace: "nowrap" }}>
                    {item.price} €
                  </p>
                </div>
              ))}
            </div>
            <div style={{ borderTop: "2px solid #e8f0da", marginTop: 16, paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontWeight: 700, fontSize: 16, color: "#4a6c22" }}>Yhteensä</p>
              <p style={{ fontWeight: 900, fontSize: "clamp(22px,5vw,32px)", color: "#1a2e0a" }}>{total} €</p>
            </div>
          </div>
        )}

        {/* ── Dia 3: Hinta & Säästöt ── */}
        {slide === 2 && (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center max-w-lg mx-auto w-full">
            <p style={{ fontSize: 13, color: "#7a9a52", fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, marginBottom: 16 }}>
              Kokonaishinta
            </p>
            <p style={{ fontSize: "clamp(52px,15vw,96px)", fontWeight: 900, color: "#1a2e0a", letterSpacing: "-2px", lineHeight: 1 }}>
              {total} €
            </p>

            <div style={{ marginTop: 40, width: "100%", background: "white", borderRadius: 20, padding: "24px 28px", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
              <p style={{ fontWeight: 700, color: "#2d5016", fontSize: 15, marginBottom: 16 }}>
                💡 Kotitalousvähennyksellä
              </p>

              {/* Visuaalinen palkki */}
              <div style={{ height: 10, borderRadius: 99, background: "#e8f0da", overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${Math.round((savings / total) * 100)}%`, background: "#2d5016", borderRadius: 99 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#7a9a52", marginBottom: 20 }}>
                <span>Vähennys ~{Math.round((savings / total) * 100)} %</span>
                <span>säästät ~{savings} €</span>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "#aab88a", marginBottom: 4 }}>Normaali hinta</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: "#9ca3af", textDecoration: "line-through" }}>{total} €</p>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "#2d5016", marginBottom: 4 }}>Maksat vain</p>
                  <p style={{ fontSize: 28, fontWeight: 900, color: "#2d5016" }}>~{kotitalous} €</p>
                </div>
              </div>
              <p style={{ fontSize: 11, color: "#aab88a", marginTop: 12 }}>
                Työn osuudesta 40 % verovähennys — enintään 2 250 € / hlö / vuosi
              </p>
            </div>
          </div>
        )}

        {/* ── Dia 4: Miksi Puuhapatet ── */}
        {slide === 3 && (
          <div className="h-full flex flex-col px-6 py-8 max-w-lg mx-auto w-full">
            <h2 style={{ fontSize: "clamp(18px,4vw,28px)", fontWeight: 800, color: "#1a2e0a", marginBottom: 28, letterSpacing: "-0.5px" }}>
              Miksi Puuhapatet?
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
              {[
                { emoji: "✅", title: "Kotitalousvähennyskelpoinen", desc: "Saat 40 % työn osuudesta takaisin verotuksessa" },
                { emoji: "⭐", title: "Tyytyväisyystakuu", desc: "Jos et ole tyytyväinen, teemme työn uudelleen — ilmaiseksi" },
                { emoji: "🔒", title: "Vakuutettu työ", desc: "Kaikki työmme on vastuuvakuutettu. Ei riskiä teille" },
                { emoji: "📋", title: "Selkeä hinta, ei piilokuluita", desc: "Tarjouksen hinta on lopullinen. Ei yllätyksiä laskulla" },
              ].map((p, i) => (
                <div key={i} style={{ background: "white", borderRadius: 16, padding: "16px 20px", display: "flex", gap: 16, alignItems: "flex-start", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                  <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{p.emoji}</span>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 15, color: "#1a2e0a", marginBottom: 3 }}>{p.title}</p>
                    <p style={{ fontSize: 13, color: "#7a9a52" }}>{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            {workerName && (
              <p style={{ fontSize: 13, color: "#aab88a", marginTop: 20, textAlign: "center" }}>
                {workerName}{workerPhone ? ` · ${workerPhone}` : ""}
              </p>
            )}
          </div>
        )}

        {/* ── Dia 5: Seuraavat askeleet ── */}
        {slide === 4 && (
          <div className="h-full flex flex-col items-center justify-center px-6 py-8 max-w-lg mx-auto w-full">
            <h2 style={{ fontSize: "clamp(18px,4vw,28px)", fontWeight: 800, color: "#1a2e0a", marginBottom: 32, letterSpacing: "-0.5px", textAlign: "center" }}>
              Seuraavat askeleet
            </h2>

            {/* Timeline */}
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 0 }}>
              {[
                { num: "1", label: "Hyväksy tarjous", sub: "Nyt tai sähköpostilinkistä" },
                { num: "2", label: "Sovitaan aika",   sub: "Otamme yhteyttä 24h kuluessa" },
                { num: "3", label: "Palvelu",          sub: "Ammattilaiset hoitavat kaiken" },
                { num: "4", label: "Lasku",            sub: "Selkeä lasku kotitalousvähennystä varten" },
              ].map((step, i, arr) => (
                <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#2d5016", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>
                      {step.num}
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ width: 2, height: 28, background: "#c9dfa3", margin: "4px 0" }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: i < arr.length - 1 ? 0 : 0, paddingTop: 6 }}>
                    <p style={{ fontWeight: 700, fontSize: 15, color: "#1a2e0a" }}>{step.label}</p>
                    <p style={{ fontSize: 13, color: "#7a9a52", marginBottom: i < arr.length - 1 ? 8 : 0 }}>{step.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Send button */}
            <button
              onClick={onSend}
              disabled={sending}
              style={{
                marginTop: 36, width: "100%", background: "#2d5016", color: "white",
                border: "none", borderRadius: 16, padding: "16px 24px",
                fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center",
                justifyContent: "center", gap: 10, cursor: sending ? "not-allowed" : "pointer",
                opacity: sending ? 0.6 : 1,
              }}
            >
              <Send size={18} />
              {sending ? "Lähetetään…" : "Lähetä tarjous sähköpostiin"}
            </button>
            <p style={{ fontSize: 12, color: "#aab88a", marginTop: 10, textAlign: "center" }}>
              Asiakas saa linkin, josta voi hyväksyä tarjouksen
            </p>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ background: "white", borderTop: "1px solid #e8f0da", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", shrink: 0 }}>
        <button
          onClick={() => setSlide(s => Math.max(s - 1, 0))}
          disabled={slide === 0}
          style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #e8f0da", background: slide === 0 ? "#f5f5f5" : "white", color: slide === 0 ? "#ccc" : "#1a2e0a", cursor: slide === 0 ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14 }}
        >
          <ChevronLeft size={16} /> Edellinen
        </button>

        {/* Dots */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              style={{
                width: slide === i ? 20 : 8,
                height: 8,
                borderRadius: 99,
                background: slide === i ? "#2d5016" : "#d4e8b0",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            />
          ))}
        </div>

        <button
          onClick={() => slide < SLIDE_COUNT - 1 ? setSlide(s => s + 1) : onSend()}
          disabled={slide === SLIDE_COUNT - 1 && sending}
          style={{
            padding: "8px 16px", borderRadius: 10,
            background: slide === SLIDE_COUNT - 1 ? "#2d5016" : "white",
            color: slide === SLIDE_COUNT - 1 ? "white" : "#1a2e0a",
            border: slide === SLIDE_COUNT - 1 ? "none" : "1px solid #e8f0da",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14,
          }}
        >
          {slide === SLIDE_COUNT - 1 ? (sending ? "Lähetetään…" : "Lähetä") : "Seuraava"}
          {slide < SLIDE_COUNT - 1 && <ChevronRight size={16} />}
        </button>
      </div>
    </div>
  );
}
