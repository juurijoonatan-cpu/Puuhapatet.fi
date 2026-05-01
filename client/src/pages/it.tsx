import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Globe, Code2, Search, Server, Zap, CheckCircle2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

// ─── Framer-style design tokens ──────────────────────────────────────────────
// Canvas: #090909 | Surface-1: #141414 | Surface-2: #1c1c1c
// Ink: #ffffff | Ink-muted: #999999 | Accent-blue: #0099ff
// Gradient: violet #6a4cf5, magenta #d44df0, orange #ff7a3d, coral #ff5577

const services = [
  {
    icon: Globe,
    title: "Verkkosivuston luonti",
    desc: "Rakennamme modernit, nopeat sivut alusta asti — koodipohjainen, ei raskaita sivustorakentajia.",
    gradient: null,
  },
  {
    icon: Search,
    title: "SEO & GEO-optimointi",
    desc: "Paikallinen hakukonenäkyvyys kuntoon. Löydät asiakkaita juuri silloin kun he etsivät sinua.",
    gradient: "from-[#6a4cf5] to-[#d44df0]",
  },
  {
    icon: Server,
    title: "Hosting & ylläpito",
    desc: "Hoidamme hostingin — halvempaa sinulle, nopeampaa kaikille. Päivitykset ja tietoturva meidän vastuulla.",
    gradient: null,
  },
  {
    icon: Code2,
    title: "Vanhan sivuston uudistus",
    desc: "WordPress tai vanha rakentaja painaa? Muutamme sen kevyeksi koodisivustoksi — nopeampi, halvempi ylläpitää.",
    gradient: "from-[#ff7a3d] to-[#ff5577]",
  },
  {
    icon: Zap,
    title: "ERP & CRM pienyrityksille",
    desc: "Kevyet hallintaratkaisut — tarjouslaskuri, asiakashallinta, tilaukset. Rakennettu juuri sinun tarpeisiisi.",
    gradient: null,
  },
];

const faqs = [
  {
    q: "Miksi koodipohjainen sivu on parempi kuin WordPress?",
    a: "Koodipohjainen sivu on nopeampi, halvempi hostata ja parempi hakukoneoptimoinnissa. WordPress-sivustot ovat usein ylipainoisia lisäosien takia — me teemme juuri sen mitä tarvitaan, ei enempää.",
  },
  {
    q: "Kuinka kauan sivuston tekeminen kestää?",
    a: "Yksinkertainen esittelysivu valmistuu 1–2 viikossa. Laajempi sivusto tai ERP-ratkaisu 3–6 viikkoa projektin laajuudesta riippuen.",
  },
  {
    q: "Mitä hosting maksaa?",
    a: "Hostingkustannukset ovat selvästi alhaisemmat kuin perinteisillä sivustorakentajilla. Käydään läpi yhdessä — hinnoittelu räätälöidään projektikohtaisesti.",
  },
  {
    q: "Voitteko uudistaa olemassa olevan sivustoni?",
    a: "Kyllä. Analysoimme nykyisen sivustosi, muutamme sen koodipohjaiseksi ja optimoimme samalla SEO:n ja latausnopeuden.",
  },
  {
    q: "Mitä ERP ja CRM tarkoittaa pienyrittäjälle?",
    a: "Yksinkertaisesti: työkalu jolla hallitset asiakkaita, tarjouksia ja tilauksia — ilman turhia ominaisuuksia tai kalliita kuukausimaksuja.",
  },
];

const whyUs = [
  "Koodipohjainen = nopea ja halvempi ylläpitää",
  "SEO ja paikallinen näkyvyys heti alusta",
  "Hosting edullisempaa kuin kilpailijoilla",
  "Rakennetaan juuri sinulle — ei valmispohjia",
  "Sama tiimi hoitaa sekä ulkoasun että tekniikan",
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border-b border-[#1a1a1a] cursor-pointer"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center justify-between py-6 gap-4">
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.3,
            letterSpacing: "-0.15px",
            color: "#ffffff",
          }}
        >
          {q}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-[#999999] flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#999999] flex-shrink-0" />
        )}
      </div>
      {open && (
        <p
          className="pb-6"
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 15,
            fontWeight: 400,
            lineHeight: 1.3,
            letterSpacing: "-0.15px",
            color: "#999999",
          }}
        >
          {a}
        </p>
      )}
    </div>
  );
}

export default function ITPage() {
  return (
    <div
      style={{ backgroundColor: "#090909", minHeight: "100vh", color: "#ffffff" }}
    >
      {/* ── Custom dark nav for this page ── */}
      <nav
        style={{
          backgroundColor: "#090909",
          borderBottom: "1px solid #1a1a1a",
          height: 56,
          display: "flex",
          alignItems: "center",
          padding: "0 32px",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{ maxWidth: 1199, margin: "0 auto", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <Link href="/">
            <span
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 14,
                fontWeight: 500,
                color: "#999999",
                letterSpacing: "-0.14px",
                cursor: "pointer",
              }}
            >
              ← Puuhapatet
            </span>
          </Link>
          <span
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              color: "#ffffff",
              letterSpacing: "-0.14px",
            }}
          >
            Puuhapatet IT
          </span>
          <a
            href="#ota-yhteytta"
            style={{
              backgroundColor: "#ffffff",
              color: "#000000",
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "-0.14px",
              padding: "10px 15px",
              borderRadius: 100,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Ota yhteyttä
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section
        style={{
          padding: "96px 32px",
          maxWidth: 1199,
          margin: "0 auto",
        }}
      >
        {/* Eyebrow */}
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-0.13px",
            color: "#999999",
            marginBottom: 24,
            textTransform: "uppercase",
          }}
        >
          Puuhapatet IT
        </p>

        {/* Hero headline */}
        <h1
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: "clamp(48px, 8vw, 85px)",
            fontWeight: 600,
            lineHeight: 0.95,
            letterSpacing: "clamp(-2.4px, -0.05em, -4.25px)",
            color: "#ffffff",
            maxWidth: 800,
            marginBottom: 32,
          }}
        >
          Nettisivut jotka
          <br />
          <span style={{ color: "#0099ff" }}>oikeasti toimivat.</span>
        </h1>

        {/* Subhead */}
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.3,
            letterSpacing: "-0.18px",
            color: "#999999",
            maxWidth: 520,
            marginBottom: 40,
          }}
        >
          Rakennamme koodipohjaiset, nopeat ja edullisesti hostattavat sivustot — ja optimoimme ne näkymään Googlessa.
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href="#ota-yhteytta"
            style={{
              backgroundColor: "#ffffff",
              color: "#000000",
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "-0.14px",
              padding: "12px 20px",
              borderRadius: 100,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Aloita projekti <ArrowRight size={14} />
          </a>
          <a
            href="#palvelut"
            style={{
              backgroundColor: "#141414",
              color: "#ffffff",
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: "-0.14px",
              padding: "12px 20px",
              borderRadius: 100,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Katso palvelut
          </a>
        </div>
      </section>

      {/* ── Services grid ── */}
      <section
        id="palvelut"
        style={{
          padding: "0 32px 96px",
          maxWidth: 1199,
          margin: "0 auto",
        }}
      >
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "#999999",
            letterSpacing: "-0.13px",
            marginBottom: 40,
            textTransform: "uppercase",
          }}
        >
          Palvelut
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {services.map((s) => {
            const Icon = s.icon;
            const isGradient = !!s.gradient;
            return (
              <div
                key={s.title}
                style={{
                  background: isGradient
                    ? `linear-gradient(135deg, ${s.gradient?.includes("6a4cf5") ? "#6a4cf5, #d44df0" : "#ff7a3d, #ff5577"})`
                    : "#141414",
                  borderRadius: 20,
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9999,
                    backgroundColor: isGradient ? "rgba(0,0,0,0.2)" : "#1c1c1c",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon size={18} color="#ffffff" />
                </div>
                <div>
                  <h3
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 22,
                      fontWeight: 700,
                      lineHeight: 1.2,
                      letterSpacing: "-0.8px",
                      color: "#ffffff",
                      marginBottom: 8,
                    }}
                  >
                    {s.title}
                  </h3>
                  <p
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 15,
                      fontWeight: 400,
                      lineHeight: 1.3,
                      letterSpacing: "-0.15px",
                      color: isGradient ? "rgba(255,255,255,0.85)" : "#999999",
                    }}
                  >
                    {s.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Why us ── */}
      <section
        style={{
          padding: "96px 32px",
          borderTop: "1px solid #1a1a1a",
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <div style={{ maxWidth: 1199, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
          <div>
            <p
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "#999999",
                letterSpacing: "-0.13px",
                marginBottom: 24,
                textTransform: "uppercase",
              }}
            >
              Miksi me
            </p>
            <h2
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: "clamp(40px, 5vw, 62px)",
                fontWeight: 600,
                lineHeight: 1.0,
                letterSpacing: "clamp(-2px, -0.05em, -3.1px)",
                color: "#ffffff",
                marginBottom: 24,
              }}
            >
              Halvempi hostata.
              <br />
              Parempi löytyä.
            </h2>
            <p
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 18,
                fontWeight: 400,
                lineHeight: 1.3,
                letterSpacing: "-0.18px",
                color: "#999999",
              }}
            >
              Perinteinen sivustorakentaja on kallis ylläpitää ja hidas hakukoneille. Me teemme sen paremmin.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {whyUs.map((item) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "16px 20px",
                  backgroundColor: "#141414",
                  borderRadius: 10,
                }}
              >
                <CheckCircle2 size={16} color="#22c55e" style={{ flexShrink: 0 }} />
                <span
                  style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 14,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    letterSpacing: "-0.14px",
                    color: "#ffffff",
                  }}
                >
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Competitor comparison spotlight ── */}
      <section style={{ padding: "96px 32px", maxWidth: 1199, margin: "0 auto" }}>
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "#999999",
            letterSpacing: "-0.13px",
            marginBottom: 40,
            textTransform: "uppercase",
          }}
        >
          Vertailu
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Others card */}
          <div
            style={{
              backgroundColor: "#141414",
              borderRadius: 20,
              padding: 32,
            }}
          >
            <p
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "#999999",
                letterSpacing: "-0.13px",
                marginBottom: 16,
                textTransform: "uppercase",
              }}
            >
              Perinteiset toimistot
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                "WordPress + lisäosat = hidas",
                "Hosting €20–50/kk",
                "SEO erikseen ja kallista",
                "Valmispohjat, ei räätälöintiä",
                "Tukea vaikea saada",
              ].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#ff5577", fontSize: 16, lineHeight: 1 }}>✕</span>
                  <span
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "#999999",
                      letterSpacing: "-0.14px",
                    }}
                  >
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Puuhapatet IT card — gradient */}
          <div
            style={{
              background: "linear-gradient(135deg, #6a4cf5, #d44df0)",
              borderRadius: 20,
              padding: 32,
            }}
          >
            <p
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "rgba(255,255,255,0.7)",
                letterSpacing: "-0.13px",
                marginBottom: 16,
                textTransform: "uppercase",
              }}
            >
              Puuhapatet IT
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                "Koodipohjainen = nopea",
                "Hosting murto-osalla hinnasta",
                "SEO sisältyy aina",
                "Täysin räätälöity sinulle",
                "Suora yhteys tekijöihin",
              ].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CheckCircle2 size={15} color="#ffffff" style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      fontFamily: "Inter, sans-serif",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "#ffffff",
                      letterSpacing: "-0.14px",
                    }}
                  >
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        style={{
          padding: "0 32px 96px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <p
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "#999999",
            letterSpacing: "-0.13px",
            marginBottom: 40,
            textTransform: "uppercase",
          }}
        >
          UKK
        </p>
        <h2
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: "clamp(36px, 5vw, 62px)",
            fontWeight: 600,
            lineHeight: 1.0,
            letterSpacing: "clamp(-1.8px, -0.05em, -3.1px)",
            color: "#ffffff",
            marginBottom: 48,
          }}
        >
          Kysyttyä.
        </h2>
        {faqs.map((f) => (
          <FAQItem key={f.q} q={f.q} a={f.a} />
        ))}
      </section>

      {/* ── CTA / Contact ── */}
      <section
        id="ota-yhteytta"
        style={{
          padding: "96px 32px",
          borderTop: "1px solid #1a1a1a",
        }}
      >
        <div style={{ maxWidth: 1199, margin: "0 auto", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              color: "#999999",
              letterSpacing: "-0.13px",
              marginBottom: 24,
              textTransform: "uppercase",
            }}
          >
            Aloitetaan
          </p>
          <h2
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: "clamp(48px, 7vw, 85px)",
              fontWeight: 600,
              lineHeight: 0.95,
              letterSpacing: "clamp(-2.4px, -0.05em, -4.25px)",
              color: "#ffffff",
              marginBottom: 32,
            }}
          >
            Valmiina?
          </h2>
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 18,
              fontWeight: 400,
              lineHeight: 1.3,
              letterSpacing: "-0.18px",
              color: "#999999",
              maxWidth: 480,
              margin: "0 auto 40px",
            }}
          >
            Kerro projektistasi — vastataan nopeasti ja katsotaan mitä voidaan tehdä.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="mailto:info@puuhapatet.fi"
              style={{
                backgroundColor: "#ffffff",
                color: "#000000",
                fontFamily: "Inter, sans-serif",
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: "-0.14px",
                padding: "12px 20px",
                borderRadius: 100,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              info@puuhapatet.fi <ExternalLink size={13} />
            </a>
            <a
              href="https://wa.me/358000000000"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                backgroundColor: "#141414",
                color: "#ffffff",
                fontFamily: "Inter, sans-serif",
                fontSize: 14,
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: "-0.14px",
                padding: "12px 20px",
                borderRadius: 100,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: "1px solid #1a1a1a",
          padding: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
          maxWidth: 1199,
          margin: "0 auto",
        }}
      >
        <span
          style={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: "#999999",
            letterSpacing: "-0.13px",
          }}
        >
          © 2025 Puuhapatet IT
        </span>
        <div style={{ display: "flex", gap: 24 }}>
          <Link href="/tietosuoja">
            <span
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "#999999",
                letterSpacing: "-0.13px",
                cursor: "pointer",
              }}
            >
              Tietosuoja
            </span>
          </Link>
          <Link href="/ehdot">
            <span
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: "#999999",
                letterSpacing: "-0.13px",
                cursor: "pointer",
              }}
            >
              Ehdot
            </span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
