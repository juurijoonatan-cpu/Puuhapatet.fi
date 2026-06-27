/**
 * PitchDeck — a fullscreen, swipeable company pitch a marketer shows on an iPad
 * at the door, before building an offer. Standalone (no quote needed); reuses
 * the QuotePresentation look (brand, dot nav, swipe/keyboard) and the existing
 * /public media. The final slide's CTA closes back to the lead-capture form.
 */

import { useState, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { ContribGrid } from "@/components/contrib-grid";

const SLIDE_COUNT = 7;

const BRAND = {
  dark: "#1a2e0a",
  mid: "#2d5016",
  accent: "#b8e07a",
  light: "#e8f5d0",
  muted: "#6b8f3a",
  white: "#ffffff",
};

export function PitchDeck({ onClose }: { onClose: () => void }) {
  const [slide, setSlide] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") setSlide(s => Math.min(s + 1, SLIDE_COUNT - 1));
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") setSlide(s => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (slide === 0 && videoRef.current) videoRef.current.play().catch(() => {});
  }, [slide]);

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -50) setSlide(s => Math.min(s + 1, SLIDE_COUNT - 1));
    if (dx > 50) setSlide(s => Math.max(s - 1, 0));
    touchStartX.current = null;
  };

  const heading: React.CSSProperties = { fontSize: 30, fontWeight: 800, color: BRAND.white, letterSpacing: "-0.5px", lineHeight: 1.1, margin: 0 };
  const sub: React.CSSProperties = { fontSize: 16, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: "12px 0 0" };

  const services = [
    { img: "/work-glass.jpg", title: "Ikkunanpesu", detail: "Sisältä ja ulkoa, parvekelasit ja lasiterassit — raidaton jälki." },
    { img: "/work-highrise.jpg", title: "Korkeat kohteet", detail: "Varusteet jopa 10 m korkeuksiin, taloyhtiöt ja liiketilat." },
    { img: "/work-gutter.jpg", title: "Lisäpalvelut", detail: "Rännit, lasikaiteet, peilit, terassikatteet — sovitaan tarpeen mukaan." },
  ];

  // Researched window-cleaning benefits — each carries a source so it's
  // defensible at the door. Not our own business numbers.
  const stats = [
    { big: "20–40 %", label: "enemmän luonnonvaloa puhtaista ikkunoista", src: "Alan arvio" },
    { big: "78 %", label: "kokee luonnonvalon parantavan hyvinvointia ja onnellisuutta", src: "Työympäristötutkimus" },
    { big: "+46 min", label: "parempaa unta, kun työtilassa on ikkunat ja luonnonvaloa", src: "Unitutkimus" },
    { big: "2× / v", label: "suositeltu ammattipesu suojaa lasia pysyviltä syöpymiltä ja pidentää ikää", src: "Lasihuoltosuositus" },
  ];

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col select-none overflow-hidden"
      style={{ background: BRAND.dark, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 shrink-0" style={{ height: 52, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)", position: "relative", zIndex: 10 }}>
        <span style={{ color: BRAND.accent, fontWeight: 800, fontSize: 17, letterSpacing: "-0.3px" }}>Puuhapatet.</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <button key={i} onClick={() => setSlide(i)} aria-label={`Dia ${i + 1}`}
              style={{ width: slide === i ? 18 : 6, height: 6, borderRadius: 99, background: slide === i ? BRAND.accent : "rgba(255,255,255,0.25)", border: "none", padding: 0, cursor: "pointer", transition: "all 0.25s" }} />
          ))}
        </div>
        <button onClick={onClose} style={{ color: "rgba(255,255,255,0.5)", padding: 6, lineHeight: 0 }} aria-label="Sulje"><X size={20} /></button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {/* Slide 0 — intro video */}
        {slide === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-16 text-center">
            <video ref={videoRef} src="/pres-video.mp4" poster="/work-hero.jpg" muted loop playsInline autoPlay
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(26,46,10,0.25) 0%, rgba(26,46,10,0.85) 100%)" }} />
            <div style={{ position: "relative", zIndex: 2, padding: "0 28px" }}>
              <p style={{ color: BRAND.accent, fontWeight: 700, fontSize: 13, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>Espoolainen ammattitiimi</p>
              <h1 style={{ ...heading, fontSize: 38, marginTop: 10 }}>Kirkkaat ikkunat,<br />ilman vaivaa.</h1>
              <p style={{ ...sub, maxWidth: 340 }}>Huolellista ikkunanpesua ja kotitalouspalveluita — positiivisella asenteella ja vastuuvakuutuksen turvin.</p>
            </div>
          </div>
        )}

        {/* Slide 1 — services */}
        {slide === 1 && (
          <div className="absolute inset-0 overflow-y-auto px-6 py-8" style={{ background: BRAND.dark }}>
            <h2 style={heading}>Mitä teemme</h2>
            <p style={sub}>Yksi luotettava tiimi koko kotisi ulkopinnoille.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
              {services.map(s => (
                <div key={s.title} style={{ display: "flex", gap: 14, alignItems: "center", background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: 12 }}>
                  <img src={s.img} alt={s.title} style={{ width: 84, height: 84, borderRadius: 14, objectFit: "cover", flexShrink: 0 }} />
                  <div>
                    <p style={{ color: BRAND.white, fontWeight: 700, fontSize: 17, margin: 0 }}>{s.title}</p>
                    <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, margin: "4px 0 0", lineHeight: 1.4 }}>{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slide 2 — why clean windows matter (researched industry stats) */}
        {slide === 2 && (
          <div className="absolute inset-0 overflow-y-auto px-6 py-8" style={{ background: BRAND.dark }}>
            <p style={{ color: BRAND.accent, fontWeight: 700, fontSize: 13, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>Tutkittua</p>
            <h2 style={{ ...heading, marginTop: 8 }}>Miksi puhtaat ikkunat kannattaa</h2>
            <p style={sub}>Kirkkaat ikkunat eivät ole pelkkä ulkonäköasia.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 22 }}>
              {stats.map(s => (
                <div key={s.label} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column" }}>
                  <span style={{ color: BRAND.accent, fontWeight: 800, fontSize: 28, letterSpacing: "-0.5px", lineHeight: 1 }}>{s.big}</span>
                  <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 1.35, marginTop: 8, flex: 1 }}>{s.label}</span>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 10 }}>Lähde: {s.src}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slide 3 — momentum / activity grid */}
        {slide === 3 && (
          <div className="absolute inset-0 flex flex-col justify-center px-6 py-8" style={{ background: BRAND.dark }}>
            <p style={{ color: BRAND.accent, fontWeight: 700, fontSize: 13, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>Aktiivinen tiimi</p>
            <h2 style={{ ...heading, marginTop: 8 }}>Töitä joka viikko</h2>
            <p style={{ ...sub, marginBottom: 24 }}>Pesemme ikkunoita ympäri pääkaupunkiseutua läpi vuoden — kokenutta ja tasaista jälkeä.</p>
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 20, padding: 18 }}>
              <ContribGrid />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              {[{ n: "Satoja", l: "pestyjä ikkunoita" }, { n: "10 m", l: "varusteet korkealle" }, { n: "100 %", l: "vastuuvakuutus" }].map(k => (
                <div key={k.l} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "12px 6px" }}>
                  <p style={{ color: BRAND.accent, fontWeight: 800, fontSize: 19, margin: 0 }}>{k.n}</p>
                  <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 11, margin: "4px 0 0", lineHeight: 1.3 }}>{k.l}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slide 4 — the result (streak-free finish) */}
        {slide === 4 && (
          <div className="absolute inset-0 flex flex-col px-6 py-8" style={{ background: BRAND.dark }}>
            <h2 style={heading}>Raidaton jälki, joka kerta</h2>
            <p style={sub}>Huolellinen, kirkas lopputulos — ei raitoja, ei kiirettä.</p>
            <div style={{ flex: 1, marginTop: 20, borderRadius: 20, overflow: "hidden", minHeight: 0 }}>
              <img src="/work-round.jpg" alt="Kirkas, raidaton ikkuna pesun jälkeen" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          </div>
        )}

        {/* Slide 5 — reference gig (FR8) */}
        {slide === 5 && (
          <div className="absolute inset-0 flex flex-col justify-end pb-14" >
            <img src="/work-highrise.jpg" alt="Iso kohde" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(26,46,10,0.2) 0%, rgba(26,46,10,0.9) 100%)" }} />
            <div style={{ position: "relative", zIndex: 2, padding: "0 28px" }}>
              <p style={{ color: BRAND.accent, fontWeight: 700, fontSize: 13, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>Referenssi</p>
              <h2 style={{ ...heading, marginTop: 10 }}>Iso kohde — vanha teknillinen yliopisto</h2>
              <p style={{ ...sub, maxWidth: 360 }}>Hoidamme satojen ikkunoiden kohteita (mm. vanha teknillinen yliopisto / FR8) sopimuksella — sama huolellisuus pätee jokaiseen kotiin.</p>
            </div>
          </div>
        )}

        {/* Slide 6 — vetted team + trust + CTA */}
        {slide === 6 && (
          <div className="absolute inset-0 overflow-y-auto px-6 py-8 flex flex-col" style={{ background: BRAND.dark }}>
            <h2 style={heading}>Koulutettu, vakuutettu tiimi</h2>
            <p style={sub}>Ovellesi tulee aina perehdytetty Puuhapatet-ammattilainen — sama huolellisuus ja vakuutusturva joka kerta.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
              {[
                { img: "/work-team-back.jpg", alt: "Tiimi työn touhussa" },
                { img: "/work-pole.jpg", alt: "Pesua varustein" },
                { img: "/work-sign.jpg", alt: "Brändätty tiimi" },
                { img: "/work-door.jpg", alt: "Ammattilainen ovella" },
              ].map(p => (
                <img key={p.img} src={p.img} alt={p.alt} style={{ width: "100%", aspectRatio: "4/3", borderRadius: 14, objectFit: "cover" }} />
              ))}
            </div>
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {["Hinta sovitaan etukäteen — ei yllätyksiä", "Vastuuvakuutus, turvallisuus edellä", "Kotitalousvähennys (n. 35 %) ikkunanpesusta"].map(t => (
                <div key={t} style={{ display: "flex", gap: 10, alignItems: "center", color: "rgba(255,255,255,0.85)", fontSize: 15 }}>
                  <span style={{ color: BRAND.accent, fontWeight: 800 }}>✓</span> {t}
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: BRAND.accent, color: BRAND.dark, fontWeight: 800, fontSize: 17, border: "none", borderRadius: 16, padding: "16px", cursor: "pointer" }}
            >
              <ClipboardList size={20} /> Tehdään tarjous
            </button>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-between px-5 shrink-0" style={{ height: 60, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(12px)" }}>
        <button onClick={() => setSlide(s => Math.max(s - 1, 0))} disabled={slide === 0}
          style={{ color: slide === 0 ? "rgba(255,255,255,0.2)" : BRAND.white, padding: 8, lineHeight: 0, background: "none", border: "none", cursor: slide === 0 ? "default" : "pointer" }} aria-label="Edellinen">
          <ChevronLeft size={26} />
        </button>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{slide + 1} / {SLIDE_COUNT}</span>
        <button onClick={() => slide < SLIDE_COUNT - 1 ? setSlide(s => s + 1) : onClose()}
          style={{ color: BRAND.white, padding: 8, lineHeight: 0, background: "none", border: "none", cursor: "pointer" }} aria-label="Seuraava">
          <ChevronRight size={26} />
        </button>
      </div>
    </div>
  );
}
