import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Globe, Code2, Search, Server, Zap,
  CheckCircle2, ChevronDown, ChevronUp, ExternalLink,
  Gauge, Lock, BarChart3, Layers, X
} from "lucide-react";

// ─── Design tokens (Framer spec) ─────────────────────────────────────────────
const C = {
  canvas:   "#090909",
  s1:       "#141414",
  s2:       "#1c1c1c",
  ink:      "#ffffff",
  muted:    "#999999",
  hairline: "#1a1a1a",
  blue:     "#0099ff",
  violet:   "#6a4cf5",
  magenta:  "#d44df0",
  orange:   "#ff7a3d",
  coral:    "#ff5577",
  green:    "#22c55e",
};

const font = (size: number, weight = 400, ls?: number, lh?: number): React.CSSProperties => ({
  fontFamily: "Inter, -apple-system, sans-serif",
  fontSize: size,
  fontWeight: weight,
  letterSpacing: ls ?? -(size * 0.01),
  lineHeight: lh ?? 1.3,
  color: C.ink,
});

// ─── Animated counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        let start = 0;
        const step = Math.ceil(to / 60);
        const t = setInterval(() => {
          start = Math.min(start + step, to);
          setVal(start);
          if (start >= to) clearInterval(t);
        }, 16);
        obs.disconnect();
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ─── FAQ accordion ───────────────────────────────────────────────────────────
function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ borderBottom: `1px solid ${C.hairline}`, cursor: "pointer" }}
      onClick={() => setOpen(!open)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", gap: 16 }}>
        <span style={{ ...font(15, 400), color: C.ink }}>{q}</span>
        {open
          ? <ChevronUp size={16} color={C.muted} style={{ flexShrink: 0 }} />
          : <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0 }} />}
      </div>
      {open && (
        <p style={{ ...font(15, 400), color: C.muted, paddingBottom: 20, margin: 0 }}>{a}</p>
      )}
    </div>
  );
}

// ─── Contact modal ───────────────────────────────────────────────────────────
function ContactModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", service: "website", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  const services = [
    { value: "website", label: "Verkkosivuston luonti" },
    { value: "redesign", label: "Vanhan sivuston uudistus" },
    { value: "seo", label: "SEO & GEO-optimointi" },
    { value: "hosting", label: "Hosting & ylläpito" },
    { value: "erp", label: "ERP / CRM -ratkaisu" },
    { value: "other", label: "Muu" },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const r = await fetch("/api/it-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const inp: React.CSSProperties = {
    backgroundColor: C.s1,
    border: `1px solid ${C.hairline}`,
    borderRadius: 10,
    padding: "10px 14px",
    color: C.ink,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    ...font(15),
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        backgroundColor: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: C.s1,
          border: `1px solid ${C.hairline}`,
          borderRadius: 20,
          padding: 32,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          position: "relative",
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 16, right: 16, background: C.s2, border: "none", borderRadius: 9999, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <X size={14} color={C.muted} />
        </button>

        {status === "done" ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
            <h3 style={{ ...font(28, 600, -1), marginBottom: 12 }}>Viesti lähetetty!</h3>
            <p style={{ ...font(15, 400), color: C.muted }}>Vastataan pian. Voit myös WhatsAppata suoraan.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p style={{ ...font(12, 500), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Puuhapatet IT</p>
            <h3 style={{ ...font(28, 600, -1.2), marginBottom: 24 }}>Aloitetaan projekti</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ ...font(12, 500), color: C.muted, display: "block", marginBottom: 6 }}>Nimi *</label>
                <input style={inp} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Matti Meikäläinen" />
              </div>
              <div>
                <label style={{ ...font(12, 500), color: C.muted, display: "block", marginBottom: 6 }}>Sähköposti *</label>
                <input style={inp} type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="matti@yritys.fi" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ ...font(12, 500), color: C.muted, display: "block", marginBottom: 6 }}>Puhelin</label>
                <input style={inp} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0400 123 456" />
              </div>
              <div>
                <label style={{ ...font(12, 500), color: C.muted, display: "block", marginBottom: 6 }}>Yritys</label>
                <input style={inp} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Yritys Oy" />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ ...font(12, 500), color: C.muted, display: "block", marginBottom: 6 }}>Palvelu</label>
              <select
                style={{ ...inp, cursor: "pointer" }}
                value={form.service}
                onChange={e => setForm({ ...form, service: e.target.value })}
              >
                {services.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ ...font(12, 500), color: C.muted, display: "block", marginBottom: 6 }}>Viesti *</label>
              <textarea
                style={{ ...inp, minHeight: 100, resize: "vertical" }}
                required
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
                placeholder="Kerro lyhyesti projektistasi..."
              />
            </div>

            {status === "error" && (
              <p style={{ ...font(13, 500), color: C.coral, marginBottom: 12 }}>Virhe lähetyksessä. Kokeile WhatsAppia.</p>
            )}

            <button
              type="submit"
              disabled={status === "sending"}
              style={{
                backgroundColor: C.ink, color: "#000", border: "none",
                borderRadius: 100, padding: "12px 24px", width: "100%",
                ...font(14, 500), cursor: "pointer", opacity: status === "sending" ? 0.6 : 1,
              }}
            >
              {status === "sending" ? "Lähetetään..." : "Lähetä viesti →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Pill button ─────────────────────────────────────────────────────────────
function Pill({ children, onClick, href, dark }: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  dark?: boolean;
}) {
  const style: React.CSSProperties = {
    backgroundColor: dark ? C.s1 : C.ink,
    color: dark ? C.ink : "#000000",
    borderRadius: 100,
    padding: "11px 20px",
    display: "inline-flex", alignItems: "center", gap: 8,
    textDecoration: "none", border: "none", cursor: "pointer",
    ...font(14, 500),
  };
  if (href) return <a href={href} style={style} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{children}</a>;
  return <button style={style} onClick={onClick}>{children}</button>;
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ITPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const services = [
    {
      icon: Globe,
      title: "Verkkosivuston luonti",
      desc: "Rakennamme modernit, nopeat sivut alusta asti — koodipohjainen, ei raskaita sivustorakentajia. Toimii mobiilissa, tabletilla ja pöytäkoneella.",
      gradient: null,
    },
    {
      icon: Search,
      title: "SEO & GEO-optimointi",
      desc: "Paikallinen hakukonenäkyvyys kuntoon. Löydät asiakkaita juuri silloin kun he etsivät sinua — ilman kallista mainontaa.",
      gradient: [C.violet, C.magenta] as [string, string],
    },
    {
      icon: Server,
      title: "Hosting & ylläpito",
      desc: "Hoidamme hostingin — halvempaa sinulle, nopeampaa kaikille. Päivitykset, varmuuskopiot ja tietoturva meidän vastuulla.",
      gradient: null,
    },
    {
      icon: Code2,
      title: "Vanhan sivuston uudistus",
      desc: "WordPress tai vanha rakentaja painaa? Muutamme sen kevyeksi koodisivustoksi — nopeampi ladata, halvempi ylläpitää, parempi hakukoneille.",
      gradient: [C.orange, C.coral] as [string, string],
    },
    {
      icon: Zap,
      title: "ERP & CRM pienyrityksille",
      desc: "Kevyet hallintaratkaisut — tarjouslaskuri, asiakashallinta, tilaukset. Rakennettu juuri sinun tarpeisiisi. Ei turhia ominaisuuksia.",
      gradient: null,
    },
    {
      icon: Layers,
      title: "Tekninen konsultointi",
      desc: "Ei tiedä mitä tarvitset? Käydään läpi yhdessä — arvioimme tilanteesi ja ehdotamme parhaan ratkaisun budjetillesi.",
      gradient: null,
    },
  ];

  const stats = [
    { value: 3, suffix: "x", label: "Nopeampi kuin WordPress-sivut" },
    { value: 70, suffix: "%", label: "Halvempi hosting" },
    { value: 100, suffix: "%", label: "Mobiilioptimoidut sivut" },
    { value: 48, suffix: "h", label: "Vastausaika tarjoukseen" },
  ];

  const faqs = [
    { q: "Miksi koodipohjainen sivu on parempi kuin WordPress?", a: "Koodipohjainen sivu on nopeampi, halvempi hostata ja parempi hakukoneille. WordPress-sivustot ovat usein ylipainoisia lisäosien takia — me teemme juuri sen mitä tarvitaan, ei enempää." },
    { q: "Kuinka kauan sivuston tekeminen kestää?", a: "Yksinkertainen esittelysivu valmistuu 1–2 viikossa. Laajempi sivusto tai ERP-ratkaisu 3–6 viikkoa projektin laajuudesta riippuen. Sovitaan aikataulu yhdessä." },
    { q: "Mitä hosting maksaa?", a: "Hostingkustannukset ovat selvästi alhaisemmat kuin perinteisillä sivustorakentajilla. Käydään läpi yhdessä — hinnoittelu räätälöidään projektikohtaisesti." },
    { q: "Voitteko uudistaa olemassa olevan sivustoni?", a: "Kyllä. Analysoimme nykyisen sivustosi, muutamme sen koodipohjaiseksi ja optimoimme samalla SEO:n ja latausnopeuden." },
    { q: "Mitä ERP ja CRM tarkoittaa pienyrittäjälle?", a: "Yksinkertaisesti: työkalu jolla hallitset asiakkaita, tarjouksia ja tilauksia — ilman turhia ominaisuuksia tai kalliita kuukausimaksuja. Näet mitä Puuhapatet itse käyttää osoitteessa puuhapatet.fi." },
    { q: "Onko hinnoittelu kiinteä vai tuntipohjainen?", a: "Tarjoamme projektihinnoittelun — sovitaan kiinteä hinta etukäteen, ei yllätyksiä. Ylläpitopalvelut ovat kuukausimaksupohjaisia." },
  ];

  const whyUs = [
    { icon: Gauge, text: "Koodipohjainen = ylivertainen nopeus" },
    { icon: BarChart3, text: "SEO & paikallinen näkyvyys heti alusta" },
    { icon: Server, text: "Hosting murto-osalla kilpailijoiden hinnasta" },
    { icon: Code2, text: "Täysin räätälöity — ei valmispohjia" },
    { icon: Lock, text: "Tietoturva ja varmuuskopiot automaattisesti" },
    { icon: CheckCircle2, text: "Suora yhteys tekijöihin — ei välittäjiä" },
  ];

  return (
    <div style={{ backgroundColor: C.canvas, minHeight: "100vh", color: C.ink, overflowX: "hidden" }}>
      {modalOpen && <ContactModal onClose={() => setModalOpen(false)} />}

      {/* ── Nav ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        height: 56,
        backgroundColor: scrolled ? "rgba(9,9,9,0.92)" : "transparent",
        borderBottom: scrolled ? `1px solid ${C.hairline}` : "1px solid transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        transition: "all 0.2s ease",
        display: "flex", alignItems: "center",
        padding: "0 32px",
      }}>
        <div style={{ maxWidth: 1199, margin: "0 auto", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/">
            <span style={{ ...font(14, 500), color: C.muted, cursor: "pointer" }}>← puuhapatet.fi</span>
          </Link>
          <span style={{ ...font(14, 500), color: C.ink }}>Puuhapatet IT</span>
          <button
            onClick={() => setModalOpen(true)}
            style={{
              backgroundColor: C.ink, color: "#000", border: "none",
              borderRadius: 100, padding: "9px 16px",
              ...font(14, 500), cursor: "pointer",
            }}
          >
            Ota yhteyttä
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ position: "relative", minHeight: "100vh", display: "flex", alignItems: "center", padding: "120px 32px 96px", overflow: "hidden" }}>
        {/* Network BG */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage: "url(/it-network-bg.png)",
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: 0.18,
        }} />
        {/* Gradient blur spots */}
        <div style={{ position: "absolute", top: "10%", right: "5%", width: 480, height: 480, borderRadius: 9999, background: `radial-gradient(circle, ${C.violet}33, transparent 70%)`, zIndex: 0, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "10%", left: "5%", width: 300, height: 300, borderRadius: 9999, background: `radial-gradient(circle, ${C.magenta}22, transparent 70%)`, zIndex: 0, pointerEvents: "none" }} />

        <div style={{ maxWidth: 1199, margin: "0 auto", width: "100%", position: "relative", zIndex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            {/* Left: text */}
            <div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                backgroundColor: `${C.blue}15`, borderRadius: 100,
                padding: "6px 14px", marginBottom: 32,
                border: `1px solid ${C.blue}33`,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: C.blue, animation: "pulse 2s infinite" }} />
                <span style={{ ...font(12, 500), color: C.blue, letterSpacing: 0.5 }}>Puuhapatet IT — digitaaliset palvelut</span>
              </div>

              <h1 style={{
                fontFamily: "Inter, sans-serif",
                fontSize: "clamp(52px, 7vw, 85px)",
                fontWeight: 600,
                lineHeight: 0.95,
                letterSpacing: "clamp(-2.6px, -0.05em, -4.25px)",
                color: C.ink,
                marginBottom: 24,
              }}>
                Nettisivut jotka<br />
                <span style={{ background: `linear-gradient(90deg, ${C.violet}, ${C.magenta})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  oikeasti toimivat.
                </span>
              </h1>

              <p style={{ ...font(18, 400, -0.18), color: C.muted, maxWidth: 480, marginBottom: 36, lineHeight: 1.5 }}>
                Koodipohjainen lähestyminen — ei rakentajia, ei ylimääräisiä kustannuksia. Nopeat sivut, parempi SEO, halvempi hosting.
              </p>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => setModalOpen(true)}
                  style={{
                    backgroundColor: C.ink, color: "#000", border: "none",
                    borderRadius: 100, padding: "12px 22px",
                    display: "inline-flex", alignItems: "center", gap: 8,
                    ...font(14, 500), cursor: "pointer",
                  }}
                >
                  Aloita projekti <ArrowRight size={14} />
                </button>
                <a
                  href="#palvelut"
                  style={{
                    backgroundColor: C.s1, color: C.ink, border: `1px solid ${C.hairline}`,
                    borderRadius: 100, padding: "12px 22px",
                    display: "inline-flex", alignItems: "center", gap: 8,
                    textDecoration: "none", ...font(14, 500),
                  }}
                >
                  Katso palvelut
                </a>
              </div>
            </div>

            {/* Right: 3D mockup */}
            <div style={{ position: "relative" }}>
              <div style={{
                borderRadius: 20, overflow: "hidden",
                boxShadow: `0 0 80px ${C.violet}40, 0 40px 80px rgba(0,0,0,0.8)`,
                border: `1px solid ${C.hairline}`,
              }}>
                <img
                  src="/it-hero-mockup.png"
                  alt="Puuhapatet IT — premium website"
                  style={{ width: "100%", display: "block" }}
                />
              </div>
              {/* Floating badge */}
              <div style={{
                position: "absolute", bottom: -20, left: -20,
                backgroundColor: C.s1, border: `1px solid ${C.hairline}`,
                borderRadius: 16, padding: "14px 18px",
                display: "flex", alignItems: "center", gap: 10,
                boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
              }}>
                <div style={{ width: 36, height: 36, borderRadius: 9999, background: `linear-gradient(135deg, ${C.green}, #16a34a)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Gauge size={16} color="#fff" />
                </div>
                <div>
                  <p style={{ ...font(11, 600), color: C.green, margin: 0 }}>PERFORMANCE</p>
                  <p style={{ ...font(20, 700, -1), margin: 0 }}>100 / 100</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats strip ── */}
      <section style={{ borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}`, padding: "48px 32px" }}>
        <div style={{ maxWidth: 1199, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32 }}>
          {stats.map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <p style={{
                fontFamily: "Inter, sans-serif",
                fontSize: "clamp(36px, 5vw, 56px)",
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: "-2px",
                color: C.ink,
                margin: "0 0 8px",
              }}>
                <Counter to={s.value} suffix={s.suffix} />
              </p>
              <p style={{ ...font(13, 500), color: C.muted, margin: 0 }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Services ── */}
      <section id="palvelut" style={{ padding: "96px 32px", maxWidth: 1199, margin: "0 auto" }}>
        <p style={{ ...font(12, 500), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>Palvelut</p>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(40px, 5vw, 62px)", fontWeight: 600, lineHeight: 1.0, letterSpacing: "clamp(-2px, -0.05em, -3.1px)", color: C.ink, marginBottom: 48, maxWidth: 600 }}>
          Kaikki mitä tarvitset verkossa.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {services.map(s => {
            const Icon = s.icon;
            const isGrad = !!s.gradient;
            const [c1, c2] = s.gradient ?? [];
            return (
              <div
                key={s.title}
                style={{
                  background: isGrad ? `linear-gradient(135deg, ${c1}, ${c2})` : C.s1,
                  borderRadius: 20,
                  padding: 28,
                  border: isGrad ? "none" : `1px solid ${C.hairline}`,
                  display: "flex", flexDirection: "column", gap: 16,
                  transition: "transform 0.2s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; }}
              >
                <div style={{
                  width: 42, height: 42, borderRadius: 9999,
                  backgroundColor: isGrad ? "rgba(0,0,0,0.2)" : C.s2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={18} color={C.ink} />
                </div>
                <div>
                  <h3 style={{ ...font(20, 700, -0.8), marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ ...font(14, 400), color: isGrad ? "rgba(255,255,255,0.8)" : C.muted, margin: 0 }}>{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Before / After ── */}
      <section style={{ padding: "0 32px 96px", maxWidth: 1199, margin: "0 auto" }}>
        <div style={{
          borderRadius: 24, overflow: "hidden",
          position: "relative",
          boxShadow: `0 40px 80px rgba(0,0,0,0.6)`,
          border: `1px solid ${C.hairline}`,
        }}>
          <img src="/it-before-after.png" alt="Ennen ja jälkeen uudistus" style={{ width: "100%", display: "block" }} />
          <div style={{
            position: "absolute", bottom: 24, left: 24, right: 24,
            display: "flex", justifyContent: "space-between",
          }}>
            <div style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", borderRadius: 100, padding: "8px 16px", border: `1px solid ${C.hairline}` }}>
              <span style={{ ...font(12, 600), color: C.coral }}>ENNEN — hidas, kallis</span>
            </div>
            <div style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", borderRadius: 100, padding: "8px 16px", border: `1px solid ${C.hairline}` }}>
              <span style={{ ...font(12, 600), color: C.green }}>JÄLKEEN — nopea, optimoitu</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Devices mockup + why us ── */}
      <section style={{ borderTop: `1px solid ${C.hairline}`, borderBottom: `1px solid ${C.hairline}`, padding: "96px 32px" }}>
        <div style={{ maxWidth: 1199, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
          <div>
            <p style={{ ...font(12, 500), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>Miksi me</p>
            <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(40px, 5vw, 62px)", fontWeight: 600, lineHeight: 1.0, letterSpacing: "clamp(-2px,-0.05em,-3.1px)", color: C.ink, marginBottom: 16 }}>
              Halvempi hostata.
              <br />
              <span style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Parempi löytyä.
              </span>
            </h2>
            <p style={{ ...font(16, 400), color: C.muted, marginBottom: 32, lineHeight: 1.5 }}>
              Perinteiset sivustorakentajat ovat kalliita ylläpitää ja hitaita hakukoneille. Me rakennamme koodipohjaisesti — se tarkoittaa parempaa kaikkialla.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {whyUs.map(w => {
                const Icon = w.icon;
                return (
                  <div key={w.text} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", backgroundColor: C.s1, borderRadius: 10, border: `1px solid ${C.hairline}` }}>
                    <Icon size={15} color={C.green} style={{ flexShrink: 0 }} />
                    <span style={{ ...font(14, 500) }}>{w.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute", inset: -40,
              background: `radial-gradient(circle at center, ${C.blue}15, transparent 70%)`,
              pointerEvents: "none",
            }} />
            <div style={{
              borderRadius: 20, overflow: "hidden",
              boxShadow: `0 0 60px ${C.blue}20, 0 40px 60px rgba(0,0,0,0.7)`,
              border: `1px solid ${C.hairline}`,
              position: "relative",
            }}>
              <img src="/it-devices-mockup.png" alt="Mobiili ja desktop" style={{ width: "100%", display: "block" }} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Comparison table ── */}
      <section style={{ padding: "96px 32px", maxWidth: 860, margin: "0 auto" }}>
        <p style={{ ...font(12, 500), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>Vertailu</p>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 600, lineHeight: 1.0, letterSpacing: "clamp(-1.8px,-0.05em,-2.8px)", color: C.ink, marginBottom: 40 }}>
          Me vs. muut.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Others */}
          <div style={{ backgroundColor: C.s1, borderRadius: 20, padding: 28, border: `1px solid ${C.hairline}` }}>
            <p style={{ ...font(12, 600), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 20 }}>Perinteiset toimistot</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["WordPress + lisäosat = hidas ja haavoittuvainen", "Hosting €20–60/kk erikseen", "SEO lisämaksu tai ei ollenkaan", "Valmispohjat — kaikki näyttää samalta", "Tuki hitaasti tai ei lainkaan", "Ei koodinäkyvyyttä — olet lukittuna"].map(item => (
                <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ color: C.coral, fontSize: 14, flexShrink: 0, marginTop: 1 }}>✕</span>
                  <span style={{ ...font(14, 400), color: C.muted }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Us — gradient */}
          <div style={{ background: `linear-gradient(135deg, ${C.violet}, ${C.magenta})`, borderRadius: 20, padding: 28 }}>
            <p style={{ ...font(12, 600), color: "rgba(255,255,255,0.7)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 20 }}>Puuhapatet IT</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["Koodipohjainen — ylivertainen nopeus", "Hosting pakettiin sisältyy", "SEO optimoitu heti alusta", "Täysin räätälöity sinulle", "Suora yhteys — WhatsApp tai puhelin", "Sinulla on koodi — ei lukittumista"].map(item => (
                <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <CheckCircle2 size={14} color="#fff" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ ...font(14, 400), color: "#fff" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SEO card visual ── */}
      <section style={{ padding: "0 32px 96px", maxWidth: 1199, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "stretch" }}>
          <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${C.hairline}`, boxShadow: `0 0 40px ${C.blue}15` }}>
            <img src="/it-seo-card.png" alt="SEO & performance metrics" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ backgroundColor: C.s1, borderRadius: 20, padding: 36, border: `1px solid ${C.hairline}`, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ width: 42, height: 42, borderRadius: 9999, backgroundColor: `${C.blue}20`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, border: `1px solid ${C.blue}33` }}>
              <Search size={18} color={C.blue} />
            </div>
            <h3 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(28px, 3vw, 40px)", fontWeight: 600, lineHeight: 1.1, letterSpacing: "-1.5px", color: C.ink, marginBottom: 16 }}>
              Google löytää sinut.<br />
              <span style={{ color: C.blue }}>Kilpailijat eivät.</span>
            </h3>
            <p style={{ ...font(15, 400), color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
              Rakennamme jokaiselle sivustolle teknisen SEO-perustan — strukturoitu data, nopeus, paikallinen haku ja mobiilioptimoinit. Ei erillistä SEO-pakettia tarvita.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {["Core Web Vitals kuntoon heti", "Paikallinen haku (GEO) optimoitu", "Strukturoitu data (schema.org)", "Mobiilinopeus ensiluokkainen"].map(item => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CheckCircle2 size={14} color={C.green} />
                  <span style={{ ...font(14, 500), color: C.muted }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ padding: "0 32px 96px", maxWidth: 720, margin: "0 auto" }}>
        <p style={{ ...font(12, 500), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 16 }}>UKK</p>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(40px, 5vw, 62px)", fontWeight: 600, lineHeight: 1.0, letterSpacing: "clamp(-2px,-0.05em,-3.1px)", color: C.ink, marginBottom: 40 }}>Kysyttyä.</h2>
        {faqs.map(f => <FAQ key={f.q} q={f.q} a={f.a} />)}
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "96px 32px", borderTop: `1px solid ${C.hairline}`, textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 400, borderRadius: 9999, background: `radial-gradient(ellipse, ${C.violet}20, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <p style={{ ...font(12, 500), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 20 }}>Aloitetaan</p>
          <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(56px, 8vw, 110px)", fontWeight: 600, lineHeight: 0.9, letterSpacing: "clamp(-2.8px,-0.05em,-5.5px)", color: C.ink, marginBottom: 24 }}>
            Valmiina?
          </h2>
          <p style={{ ...font(18, 400, -0.18), color: C.muted, maxWidth: 440, margin: "0 auto 40px", lineHeight: 1.5 }}>
            Kerro projektistasi — katsotaan mitä voidaan tehdä. Vastataan 48 tunnin sisällä.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => setModalOpen(true)}
              style={{
                backgroundColor: C.ink, color: "#000", border: "none",
                borderRadius: 100, padding: "13px 24px",
                display: "inline-flex", alignItems: "center", gap: 8,
                ...font(15, 600), cursor: "pointer",
              }}
            >
              Lähetä viesti <ArrowRight size={15} />
            </button>
            <a
              href="https://wa.me/358400389999"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                backgroundColor: C.s1, color: C.ink,
                border: `1px solid ${C.hairline}`,
                borderRadius: 100, padding: "13px 24px",
                display: "inline-flex", alignItems: "center", gap: 8,
                textDecoration: "none", ...font(15, 500),
              }}
            >
              WhatsApp <ExternalLink size={13} />
            </a>
            <a
              href="mailto:info@puuhapatet.fi"
              style={{
                backgroundColor: "transparent", color: C.muted,
                border: `1px solid ${C.hairline}`,
                borderRadius: 100, padding: "13px 24px",
                display: "inline-flex", alignItems: "center", gap: 8,
                textDecoration: "none", ...font(15, 500),
              }}
            >
              info@puuhapatet.fi
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: `1px solid ${C.hairline}`, padding: "28px 32px" }}>
        <div style={{ maxWidth: 1199, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ ...font(13, 500), color: C.muted }}>© {new Date().getFullYear()} Puuhapatet IT</span>
          <div style={{ display: "flex", gap: 24 }}>
            <Link href="/tietosuoja"><span style={{ ...font(13, 500), color: C.muted, cursor: "pointer" }}>Tietosuoja</span></Link>
            <Link href="/ehdot"><span style={{ ...font(13, 500), color: C.muted, cursor: "pointer" }}>Ehdot</span></Link>
            <Link href="/"><span style={{ ...font(13, 500), color: C.muted, cursor: "pointer" }}>Puuhapatet.fi</span></Link>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (max-width: 810px) {
          .it-grid-2 { grid-template-columns: 1fr !important; }
          .it-stats { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
