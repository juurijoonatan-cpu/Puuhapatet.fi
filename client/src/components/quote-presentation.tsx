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

const BRAND = {
  dark:    "#1a2e0a",
  mid:     "#2d5016",
  accent:  "#b8e07a",
  light:   "#e8f5d0",
  muted:   "#6b8f3a",
  white:   "#ffffff",
  offWhite:"#f4f9ec",
};

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
  const videoRef = useRef<HTMLVideoElement>(null);

  const firstName = customerName.split(" ")[0] || customerName;
  const kotitalous = Math.round(total * 0.6);
  const savings = total - kotitalous;
  const savingsPct = total > 0 ? Math.round((savings / total) * 100) : 0;

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
      className="fixed inset-0 z-[9999] flex flex-col select-none overflow-hidden"
      style={{ background: BRAND.dark, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{ height: 52, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", position: "relative", zIndex: 10 }}
      >
        <span style={{ color: BRAND.accent, fontWeight: 800, fontSize: 17, letterSpacing: "-0.3px" }}>
          Puuhapatet.
        </span>
        {/* Dots */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              style={{
                width: slide === i ? 18 : 6,
                height: 6,
                borderRadius: 99,
                background: slide === i ? BRAND.accent : "rgba(255,255,255,0.25)",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "all 0.25s",
              }}
            />
          ))}
        </div>
        <button onClick={onClose} style={{ color: "rgba(255,255,255,0.5)", padding: 6, lineHeight: 0 }}>
          <X size={20} />
        </button>
      </div>

      {/* Slide area */}
      <div className="flex-1 relative overflow-hidden">

        {/* ── Slide 0: Intro with video background ─────────────────────────── */}
        {slide === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-16 text-center">
            {/* Video fill */}
            <video
              ref={videoRef}
              src="/pres-video.mp4"
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: "brightness(0.45)" }}
            />
            {/* Gradient overlay bottom */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to top, rgba(10,22,4,0.92) 0%, rgba(10,22,4,0.2) 50%, transparent 100%)" }}
            />

            <div className="relative z-10 px-8 text-center">
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.2em", color: BRAND.accent, textTransform: "uppercase", marginBottom: 14 }}>
                Tarjous
              </p>
              <h1 style={{ fontSize: "clamp(36px,10vw,64px)", fontWeight: 900, color: BRAND.white, letterSpacing: "-1.5px", lineHeight: 1.0, marginBottom: 16 }}>
                {firstName ? `Hei,\n${firstName}!` : "Tervetuloa!"}
              </h1>
              {customerAddress && (
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", fontWeight: 500, marginBottom: 6 }}>
                  {customerAddress}
                </p>
              )}
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 20 }}>
                {new Date().toLocaleDateString("fi-FI", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>
        )}

        {/* ── Slide 1: Services ────────────────────────────────────────────── */}
        {slide === 1 && (
          <div className="absolute inset-0 flex flex-col" style={{ background: BRAND.offWhite }}>
            <div className="px-6 pt-8 pb-4">
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: BRAND.muted, textTransform: "uppercase", marginBottom: 6 }}>
                02 / Palvelut
              </p>
              <h2 style={{ fontSize: "clamp(22px,5vw,36px)", fontWeight: 900, color: BRAND.dark, letterSpacing: "-0.5px", lineHeight: 1.1 }}>
                Mitä teemme
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {serviceItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    background: BRAND.white,
                    borderRadius: 16,
                    padding: "18px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 16,
                    boxShadow: "0 1px 8px rgba(0,0,0,0.07)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: "clamp(14px,2.8vw,16px)", color: BRAND.dark, marginBottom: 4, lineHeight: 1.3 }}>
                      {item.title}
                    </p>
                    {item.detail && (
                      <p style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.4 }}>{item.detail}</p>
                    )}
                  </div>
                  <p style={{ fontWeight: 800, fontSize: "clamp(17px,3.5vw,21px)", color: BRAND.mid, whiteSpace: "nowrap" }}>
                    {item.price} €
                  </p>
                </div>
              ))}
            </div>

            <div
              style={{
                margin: "0 16px 16px",
                padding: "14px 20px",
                background: BRAND.mid,
                borderRadius: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <p style={{ fontWeight: 700, fontSize: 15, color: BRAND.accent }}>Yhteensä</p>
              <p style={{ fontWeight: 900, fontSize: "clamp(24px,6vw,32px)", color: BRAND.white }}>{total} €</p>
            </div>
          </div>
        )}

        {/* ── Slide 2: Price & Savings ─────────────────────────────────────── */}
        {slide === 2 && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center px-6"
            style={{ background: BRAND.dark }}
          >
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: BRAND.muted, textTransform: "uppercase", marginBottom: 20 }}>
              03 / Hinta
            </p>

            {/* Big price */}
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <p style={{ fontSize: "clamp(72px,20vw,110px)", fontWeight: 900, color: BRAND.white, letterSpacing: "-3px", lineHeight: 1, marginBottom: 4 }}>
                {total}
              </p>
              <p style={{ fontSize: 28, fontWeight: 700, color: BRAND.accent, letterSpacing: "-0.5px" }}>euroa</p>
            </div>

            {/* Savings card */}
            <div
              style={{
                width: "100%",
                maxWidth: 380,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 20,
                padding: "22px 24px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <p style={{ fontWeight: 700, color: BRAND.accent, fontSize: 14, marginBottom: 14 }}>
                💡 Kotitalousvähennyksellä maksat vain
              </p>

              {/* Progress bar */}
              <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.12)", overflow: "hidden", marginBottom: 10 }}>
                <div style={{ height: "100%", width: `${savingsPct}%`, background: `linear-gradient(90deg, ${BRAND.accent}, #7fc72e)`, borderRadius: 99, transition: "width 0.8s ease" }} />
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>
                ~{savingsPct} % takaisin verotuksessa — säästät ~{savings} €
              </p>

              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <div style={{ flex: 1, background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>Normaali hinta</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.3)", textDecoration: "line-through" }}>{total} €</p>
                </div>
                <div style={{ flex: 1, background: BRAND.mid, borderRadius: 12, padding: "12px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: BRAND.accent, marginBottom: 6 }}>Maksat vain</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: BRAND.white }}>~{kotitalous} €</p>
                </div>
              </div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 12, textAlign: "center" }}>
                Työn osuudesta 40 % verovähennys — enintään 2 250 € / hlö / vuosi
              </p>
            </div>
          </div>
        )}

        {/* ── Slide 3: Why Puuhapatet — photo background ───────────────────── */}
        {slide === 3 && (
          <div className="absolute inset-0 flex flex-col">
            {/* Photo top half */}
            <div style={{ position: "relative", height: "38%", overflow: "hidden", flexShrink: 0 }}>
              <img
                src="/work-hero.jpg"
                alt="Puuhapatet työssä"
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%", filter: "brightness(0.7)" }}
              />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(26,46,10,0.3) 0%, rgba(26,46,10,0.85) 100%)" }} />
              <div style={{ position: "absolute", bottom: 16, left: 20, right: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: BRAND.accent, textTransform: "uppercase", marginBottom: 4 }}>
                  04 / Miksi me
                </p>
                <h2 style={{ fontSize: "clamp(20px,5vw,30px)", fontWeight: 900, color: BRAND.white, letterSpacing: "-0.5px", lineHeight: 1.1 }}>
                  Miksi Puuhapatet?
                </h2>
              </div>
            </div>

            {/* Benefits */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                background: BRAND.offWhite,
                padding: "16px 16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {[
                { icon: "✅", title: "Kotitalousvähennyskelpoinen", desc: "40 % työn osuudesta takaisin verotuksessa" },
                { icon: "⭐", title: "Tyytyväisyystakuu", desc: "Jos et ole tyytyväinen, teemme työn uudelleen — ilmaiseksi" },
                { icon: "🔒", title: "Vakuutettu", desc: "Kaikki työmme on vastuuvakuutettu — ei riskiä teille" },
                { icon: "📋", title: "Selkeä hinta", desc: "Tarjouksen hinta on lopullinen. Ei yllätyksiä laskulla" },
              ].map((p, i) => (
                <div
                  key={i}
                  style={{
                    background: BRAND.white,
                    borderRadius: 14,
                    padding: "13px 16px",
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                    boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{p.icon}</span>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14, color: BRAND.dark, marginBottom: 2 }}>{p.title}</p>
                    <p style={{ fontSize: 12, color: BRAND.muted, lineHeight: 1.4 }}>{p.desc}</p>
                  </div>
                </div>
              ))}

              {workerName && (
                <p style={{ fontSize: 12, color: BRAND.muted, textAlign: "center", paddingTop: 4 }}>
                  {workerName}{workerPhone ? ` · ${workerPhone}` : ""}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Slide 4: Next steps + send ────────────────────────────────────── */}
        {slide === 4 && (
          <div className="absolute inset-0 flex flex-col" style={{ background: BRAND.offWhite }}>
            <div className="px-6 pt-8 pb-5">
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: BRAND.muted, textTransform: "uppercase", marginBottom: 6 }}>
                05 / Seuraavat askeleet
              </p>
              <h2 style={{ fontSize: "clamp(22px,5vw,34px)", fontWeight: 900, color: BRAND.dark, letterSpacing: "-0.5px", lineHeight: 1.1 }}>
                Miten edetään?
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6">
              <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 28 }}>
                {[
                  { num: "1", label: "Hyväksy tarjous",  sub: "Nyt tai sähköpostilinkistä" },
                  { num: "2", label: "Sovitaan aika",     sub: "Otamme yhteyttä 24 h kuluessa" },
                  { num: "3", label: "Palvelu",           sub: "Ammattilaiset hoitavat kaiken" },
                  { num: "4", label: "Lasku",             sub: "Selkeä lasku kotitalousvähennystä varten" },
                ].map((step, i, arr) => (
                  <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: "50%",
                          background: BRAND.mid,
                          color: BRAND.white,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 800,
                          fontSize: 15,
                          flexShrink: 0,
                        }}
                      >
                        {step.num}
                      </div>
                      {i < arr.length - 1 && (
                        <div style={{ width: 2, height: 28, background: BRAND.light, margin: "4px 0" }} />
                      )}
                    </div>
                    <div style={{ paddingTop: 7 }}>
                      <p style={{ fontWeight: 700, fontSize: 15, color: BRAND.dark }}>{step.label}</p>
                      <p style={{ fontSize: 13, color: BRAND.muted, marginBottom: i < arr.length - 1 ? 4 : 0 }}>{step.sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Price summary */}
              <div
                style={{
                  background: BRAND.dark,
                  borderRadius: 16,
                  padding: "16px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <div>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 2 }}>Kokonaishinta</p>
                  <p style={{ fontSize: 26, fontWeight: 900, color: BRAND.white }}>{total} €</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 11, color: BRAND.accent, marginBottom: 2 }}>Kotital. jälkeen</p>
                  <p style={{ fontSize: 18, fontWeight: 800, color: BRAND.accent }}>~{kotitalous} €</p>
                </div>
              </div>

              {/* Send button */}
              <button
                onClick={onSend}
                disabled={sending}
                style={{
                  width: "100%",
                  background: sending ? BRAND.muted : BRAND.mid,
                  color: BRAND.white,
                  border: "none",
                  borderRadius: 16,
                  padding: "16px 24px",
                  fontSize: 16,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  cursor: sending ? "not-allowed" : "pointer",
                  marginBottom: 10,
                  transition: "background 0.2s",
                }}
              >
                <Send size={18} />
                {sending ? "Lähetetään…" : "Lähetä tarjous sähköpostiin"}
              </button>
              <p style={{ fontSize: 11, color: BRAND.muted, textAlign: "center", marginBottom: 24 }}>
                Asiakas saa linkin, josta voi hyväksyä tarjouksen
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Bottom nav */}
      <div
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setSlide(s => Math.max(s - 1, 0))}
          disabled={slide === 0}
          style={{
            padding: "9px 18px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: slide === 0 ? "rgba(255,255,255,0.2)" : BRAND.white,
            cursor: slide === 0 ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          <ChevronLeft size={16} /> Edellinen
        </button>

        <button
          onClick={() => slide < SLIDE_COUNT - 1 ? setSlide(s => s + 1) : onSend()}
          disabled={slide === SLIDE_COUNT - 1 && sending}
          style={{
            padding: "9px 18px",
            borderRadius: 12,
            background: slide === SLIDE_COUNT - 1 ? BRAND.mid : "rgba(255,255,255,0.1)",
            color: BRAND.white,
            border: slide === SLIDE_COUNT - 1 ? "none" : "1px solid rgba(255,255,255,0.12)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {slide === SLIDE_COUNT - 1
            ? (sending ? "Lähetetään…" : "Lähetä")
            : (<>Seuraava <ChevronRight size={16} /></>)
          }
        </button>
      </div>
    </div>
  );
}
