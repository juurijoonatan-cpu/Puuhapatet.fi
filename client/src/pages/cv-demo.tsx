import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  MapPin, Mail, Linkedin, Phone, Briefcase, GraduationCap,
  Globe2, Cpu, Code2, Users, BarChart3, ChevronRight,
} from "lucide-react";
import { GlassFilter } from "@/components/ui/liquid-glass-button";
import { cn } from "@/lib/utils";

// ─── Demo persona ─────────────────────────────────────────────────────────────

const PERSON = {
  photo:    "/cv-person.jpg",
  name:     "Petri Mäkinen",
  title:    "Senior Technology Consultant",
  location: "Helsinki, Finland",
  available: true,
  summary:  "20+ years building scalable digital solutions across Nordic enterprises. Passionate about clean architecture and the humans who use the systems.",
  current: {
    role:    "Independent Technology Consultant",
    period:  "2020 – Present",
    detail:  "Digital strategy & platform architecture for Nordic enterprises.",
  },
  experience: [
    { role: "CTO",             company: "Solita",  period: "2015–2020" },
    { role: "Senior Architect", company: "Tieto",   period: "2010–2015" },
    { role: "Software Engineer", company: "Nokia",  period: "2003–2010" },
  ],
  skills: [
    { label: "Enterprise Architecture", icon: Cpu      },
    { label: "Cloud (AWS · Azure)",      icon: Globe2   },
    { label: "React / TypeScript",       icon: Code2    },
    { label: "Digital Transformation",   icon: BarChart3 },
    { label: "Team Leadership",          icon: Users    },
  ],
  education: {
    degree:  "MSc Computer Science",
    school:  "Aalto University",
    year:    "2003",
    city:    "Helsinki",
  },
  languages: ["Finnish", "English", "Swedish"],
  contact: {
    linkedin: "linkedin.com/in/petrimakinen",
    email:    "petri@example.com",
    phone:    "+358 40 123 4567",
  },
  quote: "Technology is a means, not an end. The goal is always the human experience.",
};

// ─── Widget layout definitions ───────────────────────────────────────────────
// leftPct / topPct = top-left corner of widget as % of container
// widthPx = fixed pixel width of card

interface WidgetDef {
  id:      string;
  leftPct: number;
  topPct:  number;
  widthPx: number;
  heightPx: number; // approximate, for bezier target
  floatAnim: string;
}

const WIDGETS: WidgetDef[] = [
  { id: "name",       leftPct: 33,  topPct: 4,  widthPx: 280, heightPx: 90,  floatAnim: "cvFloatA" },
  { id: "current",    leftPct: 73,  topPct: 16, widthPx: 230, heightPx: 110, floatAnim: "cvFloatB" },
  { id: "skills",     leftPct: 80,  topPct: 42, widthPx: 210, heightPx: 170, floatAnim: "cvFloatC" },
  { id: "education",  leftPct: 68,  topPct: 70, widthPx: 210, heightPx: 100, floatAnim: "cvFloatD" },
  { id: "contact",    leftPct: 35,  topPct: 83, widthPx: 265, heightPx: 100, floatAnim: "cvFloatE" },
  { id: "quote",      leftPct: 6,   topPct: 64, widthPx: 210, heightPx: 110, floatAnim: "cvFloatF" },
  { id: "experience", leftPct: 1,   topPct: 33, widthPx: 215, heightPx: 185, floatAnim: "cvFloatG" },
  { id: "summary",    leftPct: 8,   topPct: 7,  widthPx: 240, heightPx: 120, floatAnim: "cvFloatH" },
];

// ─── Bezier path helper ───────────────────────────────────────────────────────

function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
): string {
  const dx   = x2 - x1;
  const dy   = y2 - y1;
  const perp = 0.18;
  const cpx1 = x1 + dx * 0.35 - dy * perp;
  const cpy1 = y1 + dy * 0.35 + dx * perp;
  const cpx2 = x1 + dx * 0.65 - dy * perp * 0.5;
  const cpy2 = y1 + dy * 0.65 + dx * perp * 0.5;
  return `M ${x1} ${y1} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${x2} ${y2}`;
}

// ─── GlassCard ───────────────────────────────────────────────────────────────

function GlassCard({
  children, className, style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("relative rounded-2xl", className)}
      style={style}
    >
      {/* Glass shadow shell */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          boxShadow:
            "0 0 6px rgba(0,0,0,0.03), 0 4px 20px rgba(0,0,0,0.35), " +
            "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.3)",
        }}
      />
      {/* Backdrop distortion layer */}
      <div
        className="absolute inset-0 -z-10 overflow-hidden rounded-2xl"
        style={{ backdropFilter: 'blur(18px) url("#container-glass")' }}
      />
      {/* Subtle fill + border */}
      <div
        className="absolute inset-0 rounded-2xl border border-white/8"
        style={{ background: "rgba(255,255,255,0.04)" }}
      />
      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── Widget content components ────────────────────────────────────────────────

function WidgetName() {
  return (
    <div className="p-5">
      <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
        CV · Portfolio
      </p>
      <h1 className="text-xl font-bold text-white leading-tight">{PERSON.name}</h1>
      <p className="text-sm text-zinc-400 mt-0.5">{PERSON.title}</p>
      <div className="flex items-center gap-1.5 mt-2.5">
        <MapPin size={11} className="text-zinc-600" />
        <span className="text-xs text-zinc-500">{PERSON.location}</span>
        {PERSON.available && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-xs text-emerald-500/80 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/70 animate-pulse inline-block" />
              Available
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function WidgetCurrent() {
  return (
    <div className="p-5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-3 flex items-center gap-1.5">
        <Briefcase size={9} />
        Current
      </p>
      <p className="text-white text-sm font-semibold leading-snug">
        {PERSON.current.role}
      </p>
      <p className="text-zinc-500 text-xs mt-1">{PERSON.current.period}</p>
      <p className="text-zinc-400 text-xs mt-2 leading-relaxed">
        {PERSON.current.detail}
      </p>
    </div>
  );
}

function WidgetSkills() {
  return (
    <div className="p-5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-3">
        Expertise
      </p>
      <ul className="space-y-2">
        {PERSON.skills.map(s => {
          const Icon = s.icon;
          return (
            <li key={s.label} className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
                <Icon size={10} className="text-zinc-400" />
              </div>
              <span className="text-xs text-zinc-300">{s.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WidgetEducation() {
  return (
    <div className="p-5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-3 flex items-center gap-1.5">
        <GraduationCap size={9} />
        Education
      </p>
      <p className="text-white text-sm font-semibold">{PERSON.education.degree}</p>
      <p className="text-zinc-400 text-xs mt-1">{PERSON.education.school}</p>
      <p className="text-zinc-600 text-xs mt-0.5">
        {PERSON.education.city} · {PERSON.education.year}
      </p>
      <div className="flex gap-1.5 mt-3 flex-wrap">
        {PERSON.languages.map(l => (
          <span
            key={l}
            className="text-[9px] font-mono uppercase tracking-widest border border-white/8 rounded-full px-2 py-0.5 text-zinc-500"
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function WidgetContact() {
  return (
    <div className="p-5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-3">
        Contact
      </p>
      <ul className="space-y-2">
        <li className="flex items-center gap-2">
          <Linkedin size={11} className="text-zinc-500 flex-shrink-0" />
          <span className="text-xs text-zinc-300 truncate">{PERSON.contact.linkedin}</span>
        </li>
        <li className="flex items-center gap-2">
          <Mail size={11} className="text-zinc-500 flex-shrink-0" />
          <span className="text-xs text-zinc-300">{PERSON.contact.email}</span>
        </li>
        <li className="flex items-center gap-2">
          <Phone size={11} className="text-zinc-500 flex-shrink-0" />
          <span className="text-xs text-zinc-300">{PERSON.contact.phone}</span>
        </li>
      </ul>
    </div>
  );
}

function WidgetQuote() {
  return (
    <div className="p-5">
      <p className="text-zinc-300 text-xs leading-relaxed italic">
        "{PERSON.quote}"
      </p>
      <p className="text-zinc-600 text-[10px] mt-3 font-mono">— {PERSON.name}</p>
    </div>
  );
}

function WidgetExperience() {
  return (
    <div className="p-5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-3">
        Career
      </p>
      <ul className="space-y-3">
        {[PERSON.current, ...PERSON.experience.map(e => ({
          role:   e.role,
          company: e.company,
          period:  e.period,
          detail: "",
        }))].map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <div className="mt-1.5 w-1 h-1 rounded-full bg-zinc-600 flex-shrink-0" />
            <div>
              <p className="text-xs text-white font-medium leading-snug">
                {item.role}
                {"company" in item && item.company && (
                  <span className="text-zinc-500 font-normal"> · {item.company}</span>
                )}
              </p>
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{item.period}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WidgetSummary() {
  return (
    <div className="p-5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 mb-3">
        About
      </p>
      <p className="text-xs text-zinc-300 leading-relaxed">{PERSON.summary}</p>
    </div>
  );
}

const WIDGET_CONTENT: Record<string, React.ReactNode> = {
  name:       <WidgetName />,
  current:    <WidgetCurrent />,
  skills:     <WidgetSkills />,
  education:  <WidgetEducation />,
  contact:    <WidgetContact />,
  quote:      <WidgetQuote />,
  experience: <WidgetExperience />,
  summary:    <WidgetSummary />,
};

// ─── Grid Background ──────────────────────────────────────────────────────────

function GridBackground() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0)",
        backgroundSize: "28px 28px",
      }}
    />
  );
}

// ─── Desktop mind-map canvas ──────────────────────────────────────────────────

function DesktopCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 1440, h: 900 });

  useLayoutEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDims({
          w: containerRef.current.clientWidth,
          h: containerRef.current.clientHeight,
        });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const photoCX = dims.w * 0.5;
  const photoCY = dims.h * 0.5;

  // Compute each widget's approximate center in px
  const widgetCenters = WIDGETS.map(w => ({
    id: w.id,
    cx: dims.w * (w.leftPct / 100) + w.widthPx / 2,
    cy: dims.h * (w.topPct  / 100) + w.heightPx / 2,
  }));

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: "calc(100vh - 56px)" }}
    >
      <GridBackground />

      {/* GlassFilter – rendered once for the page */}
      <GlassFilter />

      {/* SVG mind-map lines */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 10 }}
        width={dims.w}
        height={dims.h}
      >
        <defs>
          <marker
            id="cv-dot"
            markerWidth="4"
            markerHeight="4"
            refX="2"
            refY="2"
          >
            <circle cx="2" cy="2" r="1.5" fill="rgba(255,255,255,0.25)" />
          </marker>
        </defs>
        {widgetCenters.map(wc => (
          <path
            key={wc.id}
            d={bezierPath(photoCX, photoCY, wc.cx, wc.cy)}
            stroke="rgba(255,255,255,0.11)"
            strokeWidth="1"
            fill="none"
            strokeDasharray="4 9"
            markerEnd="url(#cv-dot)"
            className="cv-line"
          />
        ))}
        {/* Pulsing ring around photo */}
        <circle
          cx={photoCX}
          cy={photoCY}
          r="92"
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="1"
        />
      </svg>

      {/* Person photo — center anchor */}
      <div
        className="absolute z-30"
        style={{
          top:  photoCY,
          left: photoCX,
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Outer glow ring */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            margin: "-6px",
            background:
              "conic-gradient(from 0deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02), rgba(255,255,255,0.1), rgba(255,255,255,0.02), rgba(255,255,255,0.08))",
            animation: "cvSpin 20s linear infinite",
          }}
        />
        {/* Photo circle */}
        <div
          className="relative overflow-hidden rounded-full"
          style={{
            width:  160,
            height: 160,
            border: "1.5px solid rgba(255,255,255,0.14)",
            boxShadow:
              "0 0 40px rgba(0,0,0,0.7), 0 0 0 4px rgba(255,255,255,0.04), inset 0 0 20px rgba(0,0,0,0.4)",
          }}
        >
          <img
            src={PERSON.photo}
            alt={PERSON.name}
            className="w-full h-full object-cover object-top"
            onError={e => {
              (e.currentTarget as HTMLImageElement).src = "/joonatan.jpg.jpeg";
            }}
          />
        </div>
      </div>

      {/* Floating glass widgets */}
      {WIDGETS.map(w => (
        <GlassCard
          key={w.id}
          className="absolute z-20"
          style={{
            top:      `${w.topPct}%`,
            left:     `${w.leftPct}%`,
            width:    w.widthPx,
            animation: `${w.floatAnim} ${4 + WIDGETS.indexOf(w) * 0.4}s ease-in-out infinite`,
          }}
        >
          {WIDGET_CONTENT[w.id]}
        </GlassCard>
      ))}
    </div>
  );
}

// ─── Mobile layout ────────────────────────────────────────────────────────────

function MobileLayout() {
  return (
    <div className="px-4 py-20 space-y-4 max-w-lg mx-auto">
      {/* Photo + name */}
      <div className="flex items-center gap-4 pb-2">
        <div className="w-20 h-20 rounded-full overflow-hidden border border-white/10 flex-shrink-0">
          <img
            src={PERSON.photo}
            alt={PERSON.name}
            className="w-full h-full object-cover object-top"
            onError={e => {
              (e.currentTarget as HTMLImageElement).src = "/joonatan.jpg.jpeg";
            }}
          />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{PERSON.name}</h1>
          <p className="text-sm text-zinc-400">{PERSON.title}</p>
          <p className="text-xs text-zinc-600 mt-0.5 flex items-center gap-1">
            <MapPin size={9} /> {PERSON.location}
          </p>
        </div>
      </div>

      {[
        { label: "About",      content: <WidgetSummary /> },
        { label: "Current",    content: <WidgetCurrent /> },
        { label: "Experience", content: <WidgetExperience /> },
        { label: "Skills",     content: <WidgetSkills /> },
        { label: "Education",  content: <WidgetEducation /> },
        { label: "Contact",    content: <WidgetContact /> },
        { label: "Quote",      content: <WidgetQuote /> },
      ].map(({ label, content }) => (
        <GlassCard key={label}>
          {content}
        </GlassCard>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CVDemoPage() {
  return (
    <div className="min-h-screen bg-[#070707] text-white overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Link href="/">
            <span className="cursor-pointer text-sm text-zinc-500 transition-colors hover:text-white">
              ← puuhapatet.fi
            </span>
          </Link>
          <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            CV Demo
          </span>
          <Link href="/it#order">
            <span className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90 cursor-pointer">
              Get your own
              <ChevronRight size={11} className="inline ml-0.5 -mr-1" />
            </span>
          </Link>
        </div>
      </nav>

      {/* Desktop canvas */}
      <div className="hidden lg:block pt-14">
        <DesktopCanvas />
      </div>

      {/* Mobile stacked layout */}
      <div className="lg:hidden">
        <GlassFilter />
        <MobileLayout />
      </div>

      {/* ── CTA STRIP ── */}
      <div className="border-t border-white/5 px-5 py-10 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-zinc-600 mb-3">
          This is what your CV could look like
        </p>
        <p className="text-zinc-400 text-sm mb-5">
          Live within days · Your own domain · AI-written copy
        </p>
        <Link href="/it#order">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90 cursor-pointer">
            Start your CV website
            <ChevronRight size={14} />
          </span>
        </Link>
      </div>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 px-5 py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="font-mono text-xs text-zinc-700">
            puuhapatet.fi/cv · Demo portfolio powered by Claude + Framer
          </p>
          <div className="flex gap-5">
            <Link href="/it">
              <span className="cursor-pointer text-xs text-zinc-700 transition-colors hover:text-zinc-400">
                CV Websites
              </span>
            </Link>
            <Link href="/">
              <span className="cursor-pointer text-xs text-zinc-700 transition-colors hover:text-zinc-400">
                Puuhapatet.fi
              </span>
            </Link>
          </div>
        </div>
      </footer>

      {/* ── Keyframe animations ── */}
      <style>{`
        @keyframes cvFloatA {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-7px); }
        }
        @keyframes cvFloatB {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes cvFloatC {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
        @keyframes cvFloatD {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
        @keyframes cvFloatE {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-5px); }
        }
        @keyframes cvFloatF {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-9px); }
        }
        @keyframes cvFloatG {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
        @keyframes cvFloatH {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-7px); }
        }
        @keyframes cvSpin {
          from { transform: rotate(0deg);   }
          to   { transform: rotate(360deg); }
        }
        .cv-line {
          animation: cvLineDash 6s linear infinite;
        }
        @keyframes cvLineDash {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -52; }
        }
      `}</style>
    </div>
  );
}
