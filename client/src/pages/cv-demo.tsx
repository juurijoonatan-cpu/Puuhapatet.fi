import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { motion, useMotionValue, useMotionTemplate, useAnimationFrame } from "framer-motion";
import { Link } from "wouter";
import {
  MapPin, Mail, Linkedin, Phone, Briefcase, GraduationCap,
  Globe2, Cpu, Code2, Users, BarChart3, ChevronRight,
  ArrowUpRight, Sparkle, Figma, Framer, Palette, PenTool,
  Layers, Type, Aperture, Chrome, Camera, Brush, Box, Wand2,
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

// ─── Animated Grid Background ────────────────────────────────────────────────

function GridBackground({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const mouseX = useMotionValue(-9999);
  const mouseY = useMotionValue(-9999);
  const basePatternRef   = useRef<SVGPatternElement>(null);
  const revealPatternRef = useRef<SVGPatternElement>(null);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        mouseX.set(e.clientX - rect.left);
        mouseY.set(e.clientY - rect.top);
      }
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  useAnimationFrame(() => {
    offsetXRef.current = (offsetXRef.current + 0.4) % 40;
    offsetYRef.current = (offsetYRef.current + 0.4) % 40;
    const x = offsetXRef.current.toFixed(2);
    const y = offsetYRef.current.toFixed(2);
    basePatternRef.current?.setAttribute("x", x);
    basePatternRef.current?.setAttribute("y", y);
    revealPatternRef.current?.setAttribute("x", x);
    revealPatternRef.current?.setAttribute("y", y);
  });

  const maskImage = useMotionTemplate`radial-gradient(350px circle at ${mouseX}px ${mouseY}px, black, transparent)`;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {/* Dim base grid — always visible */}
      <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.06 }}>
        <defs>
          <pattern
            ref={basePatternRef}
            id="cv-base-grid"
            x="0" y="0"
            width="40" height="40"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cv-base-grid)" />
      </svg>

      {/* Mouse-revealed bright grid */}
      <motion.div
        className="absolute inset-0"
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.35 }}>
          <defs>
            <pattern
              ref={revealPatternRef}
              id="cv-reveal-grid"
              x="0" y="0"
              width="40" height="40"
              patternUnits="userSpaceOnUse"
            >
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cv-reveal-grid)" />
        </svg>
      </motion.div>

      {/* Ambient colour blobs */}
      <div
        className="absolute top-[-10%] right-[-5%] w-[42%] h-[42%] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(251,146,60,0.14), transparent 70%)",
          filter: "blur(80px)",
        }}
      />
      <div
        className="absolute bottom-[-10%] left-[-5%] w-[42%] h-[42%] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(59,130,246,0.11), transparent 70%)",
          filter: "blur(80px)",
        }}
      />
    </div>
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
      <GridBackground containerRef={containerRef} />

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

// ─── Features section ────────────────────────────────────────────────────────

const CAREER = [
  { period: "2023–Now",  role: "Freelance Creative",  org: "Solo Studio" },
  { period: "2020–2023", role: "Head of Brand Design", org: "Rove Studio" },
  { period: "2017–2020", role: "Visual Stylist",        org: "Ember Works" },
];

const MARQUEE_ROW1 = [Figma, Framer, Palette, PenTool, Layers, Type, Aperture, Chrome];
const MARQUEE_ROW2 = [Camera, Brush, Box, Wand2, Figma, Framer, Type, Layers];

const VIDEO_BG   = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260507_150203_44a5bd32-516a-47ce-a077-8acbf9aa8991.mp4";
const VIDEO_STAT = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260507_154543_d5b83fc1-9cea-44f3-b5e8-8f325935211a.mp4";
const VIDEO_SW   = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260507_153148_d7a3e1dd-e5d0-4ce6-8306-00d7522ecc44.mp4";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-white/70">
      <Sparkle className="h-3 w-3 flex-shrink-0" strokeWidth={1.5} />
      <span className="uppercase tracking-[0.22em] text-[11px]">{children}</span>
      <Sparkle className="h-3 w-3 flex-shrink-0" strokeWidth={1.5} />
    </div>
  );
}

function VideoCard({
  src, children, className,
}: {
  src: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative rounded-2xl bg-black overflow-hidden", className)}>
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="relative z-10 h-full flex flex-col justify-between p-5 md:p-6">
        {children}
      </div>
    </div>
  );
}

function MarqueeRow({
  icons, direction,
}: {
  icons: React.ComponentType<{ strokeWidth?: number; className?: string }>[];
  direction: "left" | "right";
}) {
  const doubled = [...icons, ...icons];
  return (
    <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <div className={cn("flex gap-3", direction === "left" ? "animate-marquee-left" : "animate-marquee-right")}>
        {doubled.map((Icon, i) => (
          <div
            key={i}
            className="h-14 w-14 md:h-16 md:w-16 rounded-xl flex-shrink-0 flex items-center justify-center liquid-glass"
          >
            <Icon strokeWidth={1.5} className="h-5 w-5 text-white/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section
      className="bg-[#0a0a0a] text-white font-sans antialiased px-4 sm:px-6 md:px-10 lg:px-14 py-6 sm:py-8 md:py-10 lg:h-screen flex flex-col gap-4 md:gap-5"
    >
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h2
            className="text-[28px] sm:text-3xl md:text-4xl lg:text-[44px] font-normal tracking-tight text-white"
            style={{ lineHeight: 1.15 }}
          >
            Hi, I'm Max Reed!
          </h2>
          <p className="mt-3 text-sm md:text-[15px] leading-[1.6] text-white/60 max-w-3xl">
            A London-based independent creator shaping sharp visual systems, web-ready products,
            and story-first campaigns. With a decade of craft behind me, I help ideas move with
            focus and intention.
          </p>
        </div>
        <div className="flex-shrink-0">
          <button className="liquid-glass rounded-full px-5 sm:px-6 py-2.5 sm:py-3 text-sm font-medium text-white whitespace-nowrap">
            Let's Team Up Today
          </button>
        </div>
      </div>

      {/* Bento grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 min-h-0">

        {/* Column 1 — Background video + timeline */}
        <VideoCard src={VIDEO_BG} className="min-h-[360px] lg:min-h-0">
          <SectionLabel>Background</SectionLabel>
          <div className="grid gap-y-3" style={{ gridTemplateColumns: "auto auto 1fr auto" }}>
            {CAREER.map(item => (
              <>
                <span key={item.period + "p"} className="text-[11px] font-mono text-white/50 pr-2">{item.period}</span>
                <Sparkle className="h-3 w-3 text-white/60 self-center mx-1" strokeWidth={1.5} />
                <span key={item.period + "r"} className="text-[12px] text-white/80 px-1">{item.role}</span>
                <span key={item.period + "o"} className="text-[11px] text-white/40 pl-2 text-right">{item.org}</span>
              </>
            ))}
          </div>
        </VideoCard>

        {/* Column 2 — Client voice + stat */}
        <div className="grid grid-rows-[auto_1fr] gap-4 md:gap-5">
          {/* Client voice */}
          <div className="noise-overlay rounded-2xl bg-[#324444] p-5 md:p-6">
            <SectionLabel>Client Voice</SectionLabel>
            <blockquote className="mt-4 text-[13px] sm:text-[13.5px] leading-[1.6] text-white/85">
              "Max reshaped our image with a degree of finesse and vision that surpassed what
              we'd hoped for. The process felt graceful, and the outcomes speak for themselves."
            </blockquote>
            <p className="mt-3 text-[12px] text-white/50">
              <strong className="text-white/80 font-medium">Elena Brooks</strong>, Creative Director — Halcyon
            </p>
          </div>

          {/* 10M+ stat */}
          <VideoCard src={VIDEO_STAT} className="min-h-[200px]">
            <div />
            <div className="text-center">
              <p
                className="text-5xl sm:text-6xl md:text-7xl lg:text-[88px] font-light tracking-tight"
                style={{ textShadow: "0 2px 24px rgba(255,255,255,0.18)" }}
              >
                10M+
              </p>
              <p className="mt-2 text-sm text-white/85">Raised for startups</p>
            </div>
          </VideoCard>
        </div>

        {/* Column 3 — Daily software + reach */}
        <div className="grid grid-rows-[1fr_auto] gap-4 md:gap-5">
          {/* Daily software */}
          <VideoCard src={VIDEO_SW}>
            <SectionLabel>Daily Software</SectionLabel>
            <div className="flex flex-col gap-3">
              <MarqueeRow icons={MARQUEE_ROW1} direction="left" />
              <MarqueeRow icons={MARQUEE_ROW2} direction="right" />
            </div>
          </VideoCard>

          {/* Reach me */}
          <div className="noise-overlay rounded-2xl bg-[#324444] p-5 md:p-6">
            <div className="flex items-start justify-between">
              <SectionLabel>Reach Me</SectionLabel>
              <button className="liquid-glass h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0">
                <ArrowUpRight className="h-4 w-4 text-white/70" strokeWidth={1.5} />
              </button>
            </div>
            <ul className="mt-4 space-y-1.5 text-[13px] text-white/70">
              <li className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-white/40" strokeWidth={1.5} />
                hi@maxreed.com
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-white/40" strokeWidth={1.5} />
                +44 207 81 63
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
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

      {/* ── Features section ── */}
      <FeaturesSection />

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
