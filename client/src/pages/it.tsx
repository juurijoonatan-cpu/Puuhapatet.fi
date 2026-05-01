import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  ArrowRight, Globe, Code2, Search, Server, Zap,
  CheckCircle2, ChevronDown, ChevronUp, ExternalLink,
  Gauge, Lock, BarChart3, Layers, X, User
} from "lucide-react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  canvas:   "#090909",
  s1:       "#141414",
  s2:       "#1c1c1c",
  ink:      "#ffffff",
  muted:    "#999999",
  hairline: "#1e1e1e",
  blue:     "#0099ff",
  violet:   "#6a4cf5",
  magenta:  "#d44df0",
  orange:   "#ff7a3d",
  coral:    "#ff5577",
  green:    "#22c55e",
};

const inter = (size: number, weight = 400, ls?: number, lh = 1.3): React.CSSProperties => ({
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: size,
  fontWeight: weight,
  letterSpacing: ls ?? -(size * 0.01),
  lineHeight: lh,
  color: C.ink,
  margin: 0,
});

// ─── Animated counter ─────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        let cur = 0;
        const step = Math.max(1, Math.ceil(to / 60));
        const t = setInterval(() => {
          cur = Math.min(cur + step, to);
          setVal(cur);
          if (cur >= to) clearInterval(t);
        }, 16);
        obs.disconnect();
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ─── FAQ row ─────────────────────────────────────────────────────────────────
function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${C.hairline}`, cursor: "pointer" }} onClick={() => setOpen(!open)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", gap: 16 }}>
        <span style={{ ...inter(15, 400), color: C.ink }}>{q}</span>
        {open ? <ChevronUp size={16} color={C.muted} style={{ flexShrink: 0 }} /> : <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0 }} />}
      </div>
      {open && <p style={{ ...inter(15, 400), color: C.muted, paddingBottom: 20, lineHeight: 1.6 }}>{a}</p>}
    </div>
  );
}

// ─── Contact modal ────────────────────────────────────────────────────────────
function ContactModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    name: "", email: "", phone: "", company: "",
    service: "website", currentSite: "", message: ""
  });
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  const services = [
    { value: "website",   label: "Uusi verkkosivusto" },
    { value: "cv",        label: "CV tai henkilökohtainen sivu" },
    { value: "redesign",  label: "Olemassa olevan sivuston uudistus" },
    { value: "seo",       label: "Hakukonenäkyvyys" },
    { value: "hosting",   label: "Hosting ja ylläpito" },
    { value: "erp",       label: "Hallintaratkaisu tai CRM" },
    { value: "other",     label: "Jotain muuta" },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    const serviceLabel = services.find(s => s.value === form.service)?.label ?? form.service;
    try {
      const r = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: "f70be445-1acf-4e5a-87f8-e27056edf67e",
          botcheck:   false,
          subject:    `IT-yhteydenotto: ${form.name}${form.company ? ` (${form.company})` : ""} — ${serviceLabel}`,
          from_name:  "Puuhapatet IT",
          Nimi:       form.name,
          Sähköposti: form.email,
          Puhelin:    form.phone || "—",
          Yritys:     form.company || "—",
          Palvelu:    serviceLabel,
          "Nykyinen sivu": form.currentSite || "—",
          Viesti:     form.message,
        }),
      });
      const data = await r.json();
      if (!data.success) throw new Error(data.message);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const inp: React.CSSProperties = {
    backgroundColor: C.s2,
    border: `1px solid ${C.hairline}`,
    borderRadius: 10,
    padding: "11px 14px",
    color: C.ink,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "Inter, sans-serif",
    fontSize: 15,
    fontWeight: 400,
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px" }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: C.s1, border: `1px solid ${C.hairline}`, borderRadius: 20, padding: "28px 24px", width: "100%", maxWidth: 500, maxHeight: "92vh", overflowY: "auto", position: "relative" }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: C.s2, border: "none", borderRadius: 9999, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={13} color={C.muted} />
        </button>

        {status === "done" ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🚀</div>
            <h3 style={{ ...inter(26, 600, -1), marginBottom: 10 }}>Viesti lähetetty!</h3>
            <p style={{ ...inter(15, 400), color: C.muted, lineHeight: 1.6 }}>Vastataan pian. Voit myös laittaa suoraan WhatsAppiin.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Puuhapatet IT</p>
            <h3 style={{ ...inter(26, 600, -1.2), marginBottom: 22 }}>Aloitetaan projekti</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Nimi *</label>
                <input style={inp} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Matti Meikäläinen" />
              </div>
              <div>
                <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Sähköposti *</label>
                <input style={inp} type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="matti@yritys.fi" />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Puhelin</label>
                <input style={inp} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0400 123 456" />
              </div>
              <div>
                <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Yritys tai oma nimi</label>
                <input style={inp} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Firma Oy" />
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Mitä tarvitset?</label>
              <select style={{ ...inp, cursor: "pointer" }} value={form.service} onChange={e => setForm({ ...form, service: e.target.value })}>
                {services.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Nykyinen verkkosivuosoite (jos on)</label>
              <input style={inp} value={form.currentSite} onChange={e => setForm({ ...form, currentSite: e.target.value })} placeholder="www.sivustosi.fi" />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ ...inter(11, 500), color: C.muted, display: "block", marginBottom: 5 }}>Viesti *</label>
              <textarea style={{ ...inp, minHeight: 90, resize: "vertical" }} required value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Kerro lyhyesti mitä haet..." />
            </div>

            {status === "error" && (
              <p style={{ ...inter(13, 500), color: C.coral, marginBottom: 10 }}>Lähetys epäonnistui. Kokeile WhatsAppia.</p>
            )}

            <button type="submit" disabled={status === "sending"} style={{ backgroundColor: C.ink, color: "#000", border: "none", borderRadius: 100, padding: "13px 0", width: "100%", fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: status === "sending" ? 0.6 : 1 }}>
              {status === "sending" ? "Lähetetään..." : "Lähetä →"}
            </button>

            <p style={{ ...inter(12, 400), color: C.muted, textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
              Tai suoraan WhatsAppissa{" "}
              <a href="https://wa.me/358400389999" target="_blank" rel="noopener noreferrer" style={{ color: C.blue, textDecoration: "none" }}>0400 389 999</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ITPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const services = [
    {
      icon: Globe,
      title: "Uusi verkkosivusto",
      desc: "Rakennamme sivuston alusta asti koodipohjaisesti. Se tarkoittaa nopeampaa latausaikaa, helpompaa hakukonenäkyvyyttä ja halvempaa ylläpitoa verrattuna valmiisiin sivustorakentajiin.",
      gradient: null,
    },
    {
      icon: Search,
      title: "Hakukonenäkyvyys",
      desc: "Laitamme sivuston teknisen perustan kuntoon niin, että hakukoneet löytävät sinut helpommin. Ei ihmelupauksia, vaan kunnollinen pohja johon paikallinen näkyvyys rakentuu.",
      gradient: [C.violet, C.magenta] as [string, string],
    },
    {
      icon: Server,
      title: "Hosting ja ylläpito",
      desc: "Hoidamme hostingin puolestasi. Kustannukset ovat selvästi alhaisemmat kuin tavallisilla sivustorakentajilla, ja kaikki päivitykset sekä varmuuskopioinnit hoituvat automaattisesti.",
      gradient: null,
    },
    {
      icon: Code2,
      title: "Sivuston uudistus",
      desc: "Jos nykyinen sivustosi on hidas tai vanhentunut, muutamme sen koodipohjaiseksi. Samalla optimoidaan rakenne, nopeus ja mobiilitoimivuus.",
      gradient: [C.orange, C.coral] as [string, string],
    },
    {
      icon: User,
      title: "CV ja henkilöbrändi",
      desc: "Oma domain, oma tyyli. Rakennamme sinulle henkilökohtaisen sivuston joka toimii digitaalisena käyntikorttina. Minimalistinen, vaikuttava ja muistettava.",
      gradient: null,
    },
    {
      icon: Zap,
      title: "Hallintaratkaisu",
      desc: "Kevyt oma hallintapaneeli josta muokkaat sivustosi sisältöä itse suoraan. Ei tarvitse pyytää apua joka kerta kun haluat päivittää tekstin tai kuvan.",
      gradient: null,
    },
  ];

  const stats = [
    { value: 3,  suffix: "x",  label: "Nopeampi kuin WordPress" },
    { value: 60, suffix: "%",  label: "Alhaisemmat hosting-kustannukset" },
    { value: 48, suffix: "h",  label: "Vastaus tarjouspyyntöön" },
    { value: 2,  suffix: "vk", label: "Perussivu valmiina" },
  ];

  const faqs = [
    { q: "Miksi koodipohjainen sivu on parempi kuin WordPress?", a: "WordPress toimii hyvin moneen tarkoitukseen, mutta lisäosat ja sivustorakentajat tekevät siitä usein raskaan. Koodipohjainen sivu on huomattavasti nopeampi ladata, yksinkertaisempi ylläpitää ja halvempi hostata. Hakukoneet myös suosivat nopeita sivustoja." },
    { q: "Voiko sisältöä muokata itse?", a: "Kyllä. Rakennamme hallintapaneelin jonka kautta pystyt muokkaamaan sivustosi tekstejä, kuvia ja muita sisältöjä itse. Jaat hallintapaneelin kenelle haluat, ja muutokset näkyvät heti." },
    { q: "Mitä CV-sivusto tarkoittaa käytännössä?", a: "Se on henkilökohtainen verkkosivusto sinun omalla domainillasi, esim. mattimeikalainen.fi. Sivustolla esittelet itsesi, osaamisesi ja yhteystietosi visuaalisesti houkuttelevassa muodossa. Toimii paljon paremmin kuin PDF-ansioluettelo." },
    { q: "Lupaatteko tuloksia hakukoneoptimoinnissa?", a: "Emme lupaa ylioptimointia tai pikavoittoja. Rakennamme teknisesti kunnollisen pohjan, joka antaa hakukonenäkyvyydelle hyvät lähtökohdat. Tulokset riippuvat myös toimialasta, kilpailusta ja sisällöstä." },
    { q: "Kuinka kauan sivuston tekeminen kestää?", a: "Yksinkertainen esittely tai CV-sivu on yleensä valmis 1 tai 2 viikossa. Laajempi sivusto tai hallintaratkaisu 3 tai 6 viikkoa projektin laajuudesta riippuen." },
    { q: "Mitä hosting maksaa?", a: "Hinnoittelu on projektikohtainen. Selvitetään yhdessä mikä ratkaisu sopii tarpeisiisi ja budjettiisi. Perinteisiin sivustorakentajiin verrattuna kustannukset ovat selvästi matalammat." },
  ];

  const s1 = C.s1;
  const hair = C.hairline;

  return (
    <div style={{ backgroundColor: C.canvas, minHeight: "100vh", color: C.ink, overflowX: "hidden" }}>
      {modalOpen && <ContactModal onClose={() => setModalOpen(false)} />}

      {/* ── NAV ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, height: 56,
        backgroundColor: scrolled ? "rgba(9,9,9,0.94)" : "transparent",
        backdropFilter: scrolled ? "blur(14px)" : "none",
        borderBottom: scrolled ? `1px solid ${hair}` : "1px solid transparent",
        transition: "all 0.25s ease",
        display: "flex", alignItems: "center", padding: "0 20px",
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/">
            <span style={{ ...inter(13, 500), color: C.muted, cursor: "pointer" }}>← puuhapatet.fi</span>
          </Link>
          <span style={{ ...inter(14, 600), color: C.ink }}>Puuhapatet IT</span>
          <button
            onClick={() => setModalOpen(true)}
            style={{ backgroundColor: C.ink, color: "#000", border: "none", borderRadius: 100, padding: "8px 16px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Ota yhteyttä
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ position: "relative", minHeight: "100dvh", display: "flex", alignItems: "center", padding: "80px 20px 60px", overflow: "hidden" }}>
        {/* BG network image */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/it-network-bg.png)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.12, zIndex: 0 }} />
        {/* Glow spots */}
        <div style={{ position: "absolute", top: "15%", right: "-5%", width: 360, height: 360, borderRadius: 9999, background: `radial-gradient(circle, ${C.violet}30, transparent 70%)`, zIndex: 0, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "10%", left: "-5%", width: 260, height: 260, borderRadius: 9999, background: `radial-gradient(circle, ${C.magenta}1a, transparent 70%)`, zIndex: 0, pointerEvents: "none" }} />

        <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%", position: "relative", zIndex: 1 }}>
          {/* Mobile: stacked. Desktop: 2-col */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 40 }} className="it-hero-grid">
            {/* Text */}
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, backgroundColor: `${C.blue}12`, borderRadius: 100, padding: "6px 14px", marginBottom: 28, border: `1px solid ${C.blue}28` }}>
                <div style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: C.blue, animation: "itpulse 2s infinite" }} />
                <span style={{ ...inter(12, 500), color: C.blue }}>Puuhapatet IT</span>
              </div>

              <h1 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(46px, 9vw, 82px)", fontWeight: 700, lineHeight: 0.95, letterSpacing: "clamp(-2.3px, -0.05em, -4px)", color: C.ink, marginBottom: 20 }}>
                Nettisivut jotka<br />
                <span style={{ background: `linear-gradient(90deg, ${C.violet}, ${C.magenta})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  oikeasti toimivat.
                </span>
              </h1>

              <p style={{ ...inter(17, 400, -0.17), color: C.muted, maxWidth: 460, marginBottom: 32, lineHeight: 1.6 }}>
                Rakennamme koodipohjaiset sivustot jotka latautuvat nopeasti, löytyvät Googlesta ja ovat selvästi halvempia ylläpitää.
              </p>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={() => setModalOpen(true)} style={{ backgroundColor: C.ink, color: "#000", border: "none", borderRadius: 100, padding: "13px 22px", fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  Aloita projekti <ArrowRight size={15} />
                </button>
                <a href="#palvelut" style={{ backgroundColor: C.s1, color: C.ink, border: `1px solid ${hair}`, borderRadius: 100, padding: "13px 22px", fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                  Katso palvelut
                </a>
              </div>
            </div>

            {/* Mockup image */}
            <div style={{ position: "relative" }}>
              <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${hair}`, boxShadow: `0 0 60px ${C.violet}30, 0 30px 60px rgba(0,0,0,0.7)` }}>
                <img src="/it-hero-mockup.png" alt="" style={{ width: "100%", display: "block" }} />
              </div>
              <div style={{ position: "absolute", bottom: -16, left: -12, backgroundColor: C.s1, border: `1px solid ${hair}`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 16px 32px rgba(0,0,0,0.6)" }}>
                <div style={{ width: 34, height: 34, borderRadius: 9999, background: `linear-gradient(135deg, ${C.green}, #16a34a)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Gauge size={15} color="#fff" />
                </div>
                <div>
                  <p style={{ ...inter(10, 600), color: C.green, letterSpacing: 0.5, textTransform: "uppercase" }}>Performance</p>
                  <p style={{ ...inter(18, 700, -1) }}>100 / 100</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ borderTop: `1px solid ${hair}`, borderBottom: `1px solid ${hair}`, padding: "40px 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "28px 20px" }} className="it-stats-grid">
          {stats.map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <p style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(36px, 8vw, 52px)", fontWeight: 700, lineHeight: 1, letterSpacing: "-2px", color: C.ink, marginBottom: 6 }}>
                <Counter to={s.value} suffix={s.suffix} />
              </p>
              <p style={{ ...inter(13, 400), color: C.muted }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section id="palvelut" style={{ padding: "72px 20px", maxWidth: 1100, margin: "0 auto" }}>
        <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>Palvelut</p>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(34px, 6vw, 58px)", fontWeight: 700, lineHeight: 1.0, letterSpacing: "clamp(-1.7px,-0.05em,-2.9px)", color: C.ink, marginBottom: 40, maxWidth: 560 }}>
          Kaikki mitä tarvitset verkossa.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {services.map(s => {
            const Icon = s.icon;
            const isGrad = !!s.gradient;
            const [c1, c2] = s.gradient ?? [];
            return (
              <div key={s.title}
                style={{ background: isGrad ? `linear-gradient(135deg, ${c1}, ${c2})` : s1, borderRadius: 18, padding: "24px 22px", border: isGrad ? "none" : `1px solid ${hair}`, display: "flex", flexDirection: "column", gap: 14, transition: "transform 0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 9999, backgroundColor: isGrad ? "rgba(0,0,0,0.2)" : C.s2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={17} color={C.ink} />
                </div>
                <div>
                  <h3 style={{ ...inter(18, 700, -0.7), marginBottom: 8 }}>{s.title}</h3>
                  <p style={{ ...inter(14, 400), color: isGrad ? "rgba(255,255,255,0.82)" : C.muted, lineHeight: 1.6 }}>{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CV SPOTLIGHT ── */}
      <section style={{ padding: "0 20px 72px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }} className="it-cv-grid">
          {/* Text card */}
          <div style={{ background: `linear-gradient(135deg, #111 0%, #1a1a2e 100%)`, borderRadius: 20, padding: "36px 28px", border: `1px solid ${hair}`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24 }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, backgroundColor: `${C.blue}15`, borderRadius: 100, padding: "5px 12px", marginBottom: 20, border: `1px solid ${C.blue}30` }}>
                <User size={12} color={C.blue} />
                <span style={{ ...inter(11, 600), color: C.blue, letterSpacing: 0.5 }}>Uusi palvelu</span>
              </div>
              <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 700, lineHeight: 1.05, letterSpacing: "clamp(-1.4px,-0.05em,-2.4px)", color: C.ink, marginBottom: 16 }}>
                Oma domain,<br />
                <span style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>oma tarina.</span>
              </h2>
              <p style={{ ...inter(15, 400), color: C.muted, lineHeight: 1.7, maxWidth: 440 }}>
                Rakennamme henkilökohtaisen sivuston sinun omalla domainillasi. Se toimii digitaalisena käyntikorttina joka kertoo kuka olet, mitä osaat ja miten sinut tavoittaa. Visuaalisesti vaikuttava, mobiilissa täydellisesti toimiva ja helppo jakaa.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {["Oma domain esim. sinunnimesi.fi", "Minimalistinen ja vaikuttava ulkoasu", "Yhteystiedot, portfolio ja CV yhdessä paikassa", "Toimii täydellisesti mobiilissa"].map(item => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CheckCircle2 size={13} color={C.blue} style={{ flexShrink: 0 }} />
                  <span style={{ ...inter(13, 500), color: C.muted }}>{item}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setModalOpen(true)} style={{ backgroundColor: C.ink, color: "#000", border: "none", borderRadius: 100, padding: "13px 22px", fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start" }}>
              Kysy lisää <ArrowRight size={13} />
            </button>
          </div>

          {/* Before/after visual */}
          <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${hair}`, position: "relative", minHeight: 220 }}>
            <img src="/it-before-after.png" alt="Ennen ja jälkeen" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <div style={{ position: "absolute", bottom: 16, left: 16, right: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", borderRadius: 100, padding: "7px 14px", border: `1px solid ${hair}` }}>
                <span style={{ ...inter(11, 600), color: C.coral }}>ENNEN</span>
              </div>
              <div style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", borderRadius: 100, padding: "7px 14px", border: `1px solid ${hair}` }}>
                <span style={{ ...inter(11, 600), color: C.green }}>JÄLKEEN</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── WHY US ── */}
      <section style={{ borderTop: `1px solid ${hair}`, borderBottom: `1px solid ${hair}`, padding: "72px 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 40 }} className="it-why-grid">
            <div>
              <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>Miksi me</p>
              <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(34px, 6vw, 58px)", fontWeight: 700, lineHeight: 1.0, letterSpacing: "clamp(-1.7px,-0.05em,-2.9px)", color: C.ink, marginBottom: 16 }}>
                Halvempi ylläpitää.<br />
                <span style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Parempi löytyä.</span>
              </h2>
              <p style={{ ...inter(16, 400, -0.16), color: C.muted, lineHeight: 1.65, maxWidth: 440 }}>
                Perinteisten sivustorakentajien ongelma on yksinkertainen: ne ovat kalliita, hitaita ja muuttavat sinut riippuvaiseksi heidän järjestelmästään. Me rakennamme sinulle sivuston jonka koodi on sinun.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
              {[
                { icon: Gauge,    text: "Koodipohjainen rakenne on ylivertainen nopeudessa" },
                { icon: BarChart3, text: "Hostingkulut ovat selvästi alhaisemmat" },
                { icon: Search,   text: "Hakukonenäkyvyys rakentuu kunnolliselle pohjalle" },
                { icon: Code2,    text: "Täysin räätälöity tarpeisiisi" },
                { icon: Lock,     text: "Tietoturva ja varmuuskopioinnit automaattisesti" },
                { icon: CheckCircle2, text: "Suora yhteys tekijöihin" },
              ].map(w => {
                const Icon = w.icon;
                return (
                  <div key={w.text} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", backgroundColor: s1, borderRadius: 12, border: `1px solid ${hair}` }}>
                    <Icon size={14} color={C.green} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ ...inter(13, 500), color: C.muted, lineHeight: 1.5 }}>{w.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── SEO + devices ── */}
      <section style={{ padding: "72px 20px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }} className="it-img-grid">
          <div style={{ borderRadius: 18, overflow: "hidden", border: `1px solid ${hair}`, boxShadow: `0 0 40px ${C.blue}12` }}>
            <img src="/it-seo-card.png" alt="SEO ja suorituskyky" style={{ width: "100%", display: "block" }} />
          </div>
          <div style={{ backgroundColor: s1, borderRadius: 18, padding: "32px 24px", border: `1px solid ${hair}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 9999, backgroundColor: `${C.blue}18`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18, border: `1px solid ${C.blue}28` }}>
              <Search size={17} color={C.blue} />
            </div>
            <h3 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(24px, 4vw, 38px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "clamp(-1.2px,-0.05em,-1.9px)", color: C.ink, marginBottom: 14 }}>
              Google löytää sinut.<br />
              <span style={{ color: C.blue }}>Kilpailijat eivät.</span>
            </h3>
            <p style={{ ...inter(15, 400), color: C.muted, lineHeight: 1.7, marginBottom: 20 }}>
              Rakennamme teknisen SEO-perustan valmiiksi jokaiseen sivustoon. Ei erillisiä lisäpaketteja tai ihmelupauksia, vaan kunnollinen toteutus joka antaa näkyvyydelle hyvän lähtökohdan.
            </p>
            {["Tekninen rakenne hakukoneille kunnolla", "Paikallinen haku optimoitu", "Mobiililatausnopeus ensiluokkainen", "Strukturoitu data mukana"].map(item => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <CheckCircle2 size={13} color={C.green} />
                <span style={{ ...inter(13, 500), color: C.muted }}>{item}</span>
              </div>
            ))}
            <button onClick={() => setModalOpen(true)} style={{ marginTop: 12, backgroundColor: "transparent", color: C.blue, border: `1px solid ${C.blue}40`, borderRadius: 100, padding: "10px 20px", fontFamily: "Inter, sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Kysy lisää →
            </button>
          </div>
        </div>
      </section>

      {/* ── COMPARISON ── */}
      <section style={{ padding: "0 20px 72px", maxWidth: 860, margin: "0 auto" }}>
        <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>Vertailu</p>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(34px, 6vw, 52px)", fontWeight: 700, lineHeight: 1.0, letterSpacing: "clamp(-1.7px,-0.05em,-2.6px)", color: C.ink, marginBottom: 36 }}>
          Me vs. perinteiset toimistot.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12 }} className="it-compare-grid">
          <div style={{ backgroundColor: s1, borderRadius: 18, padding: "26px 22px", border: `1px solid ${hair}` }}>
            <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>Perinteinen tapa</p>
            {["WordPress ja lisäosat hidastavat sivuston", "Hosting usein erillinen ja kallis", "SEO jää usein vähälle", "Valmispohjat jotka näyttävät kaikki samanlaisilta", "Tukeen pääsy voi olla hidasta"].map(item => (
              <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                <span style={{ color: C.coral, fontSize: 13, flexShrink: 0, marginTop: 1 }}>✕</span>
                <span style={{ ...inter(14, 400), color: C.muted }}>{item}</span>
              </div>
            ))}
          </div>
          <div style={{ background: `linear-gradient(135deg, ${C.violet}, ${C.magenta})`, borderRadius: 18, padding: "26px 22px" }}>
            <p style={{ ...inter(11, 600), color: "rgba(255,255,255,0.65)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>Puuhapatet IT</p>
            {["Koodipohjainen rakenne latautuu nopeasti", "Hosting sisältyy pakettiin edullisesti", "SEO-perusta mukana alusta asti", "Täysin räätälöity juuri sinulle", "Suora yhteys tekijöihin jatkossakin"].map(item => (
              <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                <CheckCircle2 size={13} color="#fff" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ ...inter(14, 400), color: "#fff" }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ padding: "0 20px 72px", maxWidth: 680, margin: "0 auto" }}>
        <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>UKK</p>
        <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(34px, 6vw, 56px)", fontWeight: 700, lineHeight: 1.0, letterSpacing: "clamp(-1.7px,-0.05em,-2.8px)", color: C.ink, marginBottom: 36 }}>Kysyttyä.</h2>
        {faqs.map(f => <FAQ key={f.q} q={f.q} a={f.a} />)}
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "72px 20px 80px", borderTop: `1px solid ${hair}`, textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 500, height: 320, borderRadius: 9999, background: `radial-gradient(ellipse, ${C.violet}18, transparent 70%)`, pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 560, margin: "0 auto" }}>
          <p style={{ ...inter(11, 600), color: C.muted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 18 }}>Aloitetaan</p>
          <h2 style={{ fontFamily: "Inter, sans-serif", fontSize: "clamp(56px, 14vw, 110px)", fontWeight: 700, lineHeight: 0.9, letterSpacing: "clamp(-2.8px,-0.05em,-5.5px)", color: C.ink, marginBottom: 20 }}>
            Valmiina?
          </h2>
          <p style={{ ...inter(17, 400, -0.17), color: C.muted, lineHeight: 1.6, marginBottom: 32 }}>
            Kerro projektistasi ja katsotaan yhdessä mitä voidaan tehdä. Vastataan 48 tunnin sisällä.
          </p>
          {/* CTA buttons — stacked on mobile, row on desktop */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }} className="it-cta-row">
            <button onClick={() => setModalOpen(true)} style={{ backgroundColor: C.ink, color: "#000", border: "none", borderRadius: 100, padding: "15px 32px", fontFamily: "Inter, sans-serif", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 340, justifyContent: "center" }}>
              Lähetä viesti <ArrowRight size={16} />
            </button>
            <a href="https://wa.me/358400389999" target="_blank" rel="noopener noreferrer" style={{ backgroundColor: C.s1, color: C.ink, border: `1px solid ${hair}`, borderRadius: 100, padding: "15px 32px", fontFamily: "Inter, sans-serif", fontSize: 16, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 340, justifyContent: "center", boxSizing: "border-box" }}>
              WhatsApp 0400 389 999 <ExternalLink size={14} />
            </a>
            <a href="mailto:info@puuhapatet.fi" style={{ backgroundColor: "transparent", color: C.muted, border: `1px solid ${hair}`, borderRadius: 100, padding: "15px 32px", fontFamily: "Inter, sans-serif", fontSize: 15, fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 340, justifyContent: "center", boxSizing: "border-box" }}>
              info@puuhapatet.fi
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: `1px solid ${hair}`, padding: "24px 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ ...inter(12, 500), color: C.muted }}>© {new Date().getFullYear()} Puuhapatet IT</span>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Link href="/tietosuoja"><span style={{ ...inter(12, 500), color: C.muted, cursor: "pointer" }}>Tietosuoja</span></Link>
            <Link href="/ehdot"><span style={{ ...inter(12, 500), color: C.muted, cursor: "pointer" }}>Ehdot</span></Link>
            <Link href="/"><span style={{ ...inter(12, 500), color: C.muted, cursor: "pointer" }}>Puuhapatet.fi</span></Link>
          </div>
        </div>
      </footer>

      {/* ── Responsive styles ── */}
      <style>{`
        @keyframes itpulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* Tablet+ hero 2-col */
        @media (min-width: 720px) {
          .it-hero-grid {
            grid-template-columns: 1fr 1fr !important;
            align-items: center;
          }
          .it-stats-grid {
            grid-template-columns: repeat(4, 1fr) !important;
          }
          .it-cv-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .it-why-grid {
            grid-template-columns: 1fr 1fr !important;
            align-items: start;
          }
          .it-img-grid {
            grid-template-columns: 1fr 1fr !important;
            align-items: center;
          }
          .it-compare-grid {
            grid-template-columns: 1fr 1fr !important;
          }
          .it-cta-row {
            flex-direction: row !important;
            justify-content: center;
            align-items: center;
          }
          .it-cta-row a, .it-cta-row button {
            width: auto !important;
            max-width: none !important;
          }
        }

        /* Make sure nav back link doesn't overflow on tiny screens */
        @media (max-width: 360px) {
          .it-back-link { display: none; }
        }

        /* Prevent image overflow */
        img { max-width: 100%; }
      `}</style>
    </div>
  );
}
