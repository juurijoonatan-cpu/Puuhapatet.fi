import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import {
  FileText, Paintbrush, Layers, Globe, TrendingUp,
  Search, RefreshCw, Link2, Sparkles, ArrowRight,
} from "lucide-react";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { RadialOrbitalTimeline } from "@/components/ui/radial-orbital-timeline";
import { cn } from "@/lib/utils";
import { postJson, warmBackend } from "@/lib/api";

// ─── Local layout helpers ────────────────────────────────────────────────────

function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = (e.clientX - left) / width  - 0.5;
    const y = (e.clientY - top)  / height - 0.5;
    el.style.transform = `perspective(700px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) scale(1.015)`;
  }, []);

  const onLeave = useCallback(() => {
    if (ref.current)
      ref.current.style.transform = "perspective(700px) rotateY(0deg) rotateX(0deg) scale(1)";
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn("transition-transform duration-200 ease-out", className)}
    >
      {children}
    </div>
  );
}

function GridBackground() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden
      style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0)",
        backgroundSize: "32px 32px",
      }}
    />
  );
}

// ─── Timeline data ───────────────────────────────────────────────────────────

const CV_TIMELINE = [
  {
    id: 1, title: "Intake", date: "Day 1", icon: FileText,
    status: "completed"   as const, energy: 100,
    content: "Share your LinkedIn URL or CV. We extract your story and career highlights.",
    category: "Intake", relatedIds: [2],
  },
  {
    id: 2, title: "Design", date: "Day 1–2", icon: Paintbrush,
    status: "completed"   as const, energy: 90,
    content: "Claude generates your copy and brand direction. You review and approve.",
    category: "Design", relatedIds: [1, 3],
  },
  {
    id: 3, title: "Build", date: "Day 2–3", icon: Layers,
    status: "in-progress" as const, energy: 60,
    content: "Your site is assembled in Framer — responsive, fast, and beautifully typeset.",
    category: "Build", relatedIds: [2, 4],
  },
  {
    id: 4, title: "Launch", date: "Day 3–4", icon: Globe,
    status: "pending"     as const, energy: 30,
    content: "Connected to your custom domain. Live, indexed by Google, shareable the same day.",
    category: "Launch", relatedIds: [3, 5],
  },
  {
    id: 5, title: "Grow", date: "Ongoing", icon: TrendingUp,
    status: "pending"     as const, energy: 10,
    content: "New roles, projects, and achievements added over time. Your site evolves with you.",
    category: "Grow", relatedIds: [4],
  },
];

// ─── Feature cards data ──────────────────────────────────────────────────────

const FEATURES = [
  { icon: Search,    title: "SEO-indexed",        desc: "Google finds you by name. A PDF never ranks." },
  { icon: RefreshCw, title: "Always current",     desc: "Update your experience without resending files." },
  { icon: Link2,     title: "One shareable link", desc: "Paste it in emails, bios, and applications." },
  { icon: Globe,     title: "Your own domain",    desc: "yourname.com — not a subdomain of anything." },
  { icon: Sparkles,  title: "AI-written copy",    desc: "Claude crafts your narrative from your raw material." },
];

// ─── Packages ────────────────────────────────────────────────────────────────

const PACKAGES = [
  { value: "starter",      label: "Starter",     price: "€299"    },
  { value: "professional", label: "Professional", price: "€599"    },
  { value: "growth",       label: "Growth",       price: "€999/yr" },
];

// ─── Order form ──────────────────────────────────────────────────────────────

type Phase = "idle" | "sending" | "done" | "error";

function OrderForm() {
  const [form, setForm] = useState({ name: "", email: "", linkedinUrl: "", pkg: "starter" });
  const [phase, setPhase] = useState<Phase>("idle");

  // Wake the free-tier backend on mount to avoid a cold-start delay on submit.
  useEffect(() => {
    warmBackend();
  }, []);

  const inp = cn(
    "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white",
    "placeholder:text-zinc-600 transition-all",
    "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhase("sending");
    const res = await postJson("/api/it-contact", {
      name:    form.name,
      email:   form.email,
      service: "cv",
      message: `Package: ${form.pkg}\nLinkedIn/CV: ${form.linkedinUrl}`,
    });
    setPhase(res.ok ? "done" : "error");
  };

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <ArrowRight size={18} className="text-white" />
        </div>
        <h3 className="mb-2 text-xl font-bold text-white">Request received</h3>
        <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
          We'll be in touch within 24 hours with your personalised brief.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Your name
          </label>
          <input
            className={inp}
            required
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Email address
          </label>
          <input
            className={inp}
            type="email"
            required
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="jane@example.com"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          LinkedIn URL or paste your CV text
        </label>
        <textarea
          className={cn(inp, "min-h-[80px] resize-y")}
          value={form.linkedinUrl}
          onChange={e => setForm({ ...form, linkedinUrl: e.target.value })}
          placeholder="linkedin.com/in/yourname  or paste CV text…"
        />
      </div>

      <div>
        <label className="mb-3 block text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Package
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-2">
          {PACKAGES.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => setForm({ ...form, pkg: p.value })}
              className={cn(
                "rounded-lg border px-4 py-4 sm:px-3 sm:py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 flex sm:flex-col justify-between sm:justify-start items-center sm:items-start gap-3 sm:gap-0",
                form.pkg === p.value
                  ? "border-white/25 bg-white/8 text-white"
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
              )}
            >
              <div className="mb-1 text-[9px] font-mono uppercase tracking-widest">{p.label}</div>
              <div className="text-base font-bold">{p.price}</div>
            </button>
          ))}
        </div>
      </div>

      {phase === "error" && (
        <p className="text-xs text-red-400/80">
          Something went wrong. Try emailing{" "}
          <a href="mailto:info@puuhapatet.fi" className="underline">info@puuhapatet.fi</a>.
        </p>
      )}

      <button
        type="submit"
        disabled={phase === "sending"}
        className="w-full rounded-full bg-white py-3.5 text-sm font-semibold text-black transition-all hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
      >
        {phase === "sending" ? "Sending…" : "Get started →"}
      </button>
    </form>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ITPage() {
  const scrollToOrder = () =>
    document.getElementById("order")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Link href="/">
            <span className="cursor-pointer text-sm text-zinc-500 transition-colors hover:text-white">
              ← puuhapatet.fi
            </span>
          </Link>
          <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            CV Websites
          </span>
          <button
            onClick={scrollToOrder}
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            Get started
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 pb-16 pt-20">
        <GridBackground />
        {/* Subtle radial glow */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(ellipse, rgba(255,255,255,0.025) 0%, transparent 65%)" }}
          aria-hidden
        />

        <div className="relative z-10 mx-auto grid max-w-5xl grid-cols-1 items-center gap-14 lg:grid-cols-2">
          {/* Text */}
          <div>
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-1.5">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-300">
                CV Websites · Custom Domain
              </span>
            </div>
            <h1 className="mb-6 text-5xl font-bold leading-[1.02] tracking-tight text-white sm:text-6xl">
              Your CV as a<br />living website
            </h1>
            <p className="mb-8 max-w-md text-lg leading-relaxed text-zinc-400">
              One link. Your own domain. Grows with your career — not a PDF that ends up in a trash folder.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <LiquidButton onClick={scrollToOrder}>
                Get started <ArrowRight size={14} />
              </LiquidButton>
              <Link href="/cv">
                <span className="cursor-pointer text-sm font-medium text-zinc-400 underline-offset-4 hover:text-white hover:underline transition-colors">
                  See a live demo →
                </span>
              </Link>
            </div>
          </div>

          {/* Browser mockup */}
          <TiltCard className="hidden lg:block">
            <div className="overflow-hidden rounded-xl border border-white/8 bg-zinc-950">
              {/* Chrome bar */}
              <div className="flex items-center gap-1.5 border-b border-white/5 bg-zinc-900/60 px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <div className="mx-3 flex h-5 flex-1 items-center rounded-md bg-zinc-800/70 px-2">
                  <span className="font-mono text-[10px] text-zinc-600">yourname.com</span>
                </div>
              </div>
              {/* Wireframe content */}
              <div className="space-y-4 p-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 flex-shrink-0 rounded-full bg-zinc-800" />
                  <div className="space-y-2">
                    <div className="h-3 w-28 rounded-sm bg-zinc-700" />
                    <div className="h-2 w-20 rounded-sm bg-zinc-800" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-2 w-full rounded-sm bg-zinc-800" />
                  <div className="h-2 w-4/5 rounded-sm bg-zinc-800" />
                  <div className="h-2 w-3/5 rounded-sm bg-zinc-800" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-16 rounded-lg border border-zinc-800 bg-zinc-900" />
                  <div className="h-16 rounded-lg border border-zinc-800 bg-zinc-900" />
                </div>
                <div className="flex gap-2">
                  <div className="h-7 w-20 rounded-full bg-zinc-700/50" />
                  <div className="h-7 w-16 rounded-full bg-zinc-800/50" />
                </div>
              </div>
            </div>
          </TiltCard>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="border-t border-white/5 px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Process
          </p>
          <h2 className="mb-1 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            From intake to live — in days
          </h2>
          <p className="mb-2 text-sm text-zinc-600">Click any step to learn more.</p>
          <RadialOrbitalTimeline timelineData={CV_TIMELINE} />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="border-t border-white/5 px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Benefits
          </p>
          <h2 className="mb-12 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Why a CV website beats a PDF
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(f => {
              const Icon = f.icon;
              return (
                <TiltCard key={f.title}>
                  <div className="flex h-full flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/5">
                      <Icon size={15} className="text-zinc-300" />
                    </div>
                    <div>
                      <h3 className="mb-1.5 font-semibold text-white">{f.title}</h3>
                      <p className="text-sm leading-relaxed text-zinc-500">{f.desc}</p>
                    </div>
                  </div>
                </TiltCard>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── DEMO PREVIEW ── */}
      <section className="border-t border-white/5 px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Live example
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-8">
            <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              See what yours<br />could look like
            </h2>
            <Link href="/cv">
              <span className="inline-flex items-center gap-2 cursor-pointer rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:bg-white/10 hover:text-white whitespace-nowrap">
                Open full demo <ArrowRight size={13} />
              </span>
            </Link>
          </div>

          {/* Preview card — tappable link to /cv */}
          <Link href="/cv">
            <div className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/8 bg-zinc-950 transition-all duration-300 hover:border-white/20 hover:shadow-[0_0_60px_rgba(255,255,255,0.04)]">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-1.5 border-b border-white/5 bg-zinc-900/60 px-4 py-3">
                <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
                <div className="mx-3 flex h-5 flex-1 items-center rounded-md bg-zinc-800/70 px-2">
                  <span className="font-mono text-[10px] text-zinc-500">puuhapatet.fi/cv</span>
                </div>
              </div>
              {/* Mock CV content preview */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-6">
                {/* Left: photo + name */}
                <div className="flex flex-col items-center gap-3 sm:border-r sm:border-white/5 sm:pr-4">
                  <div className="h-20 w-20 rounded-full bg-zinc-800 border border-white/8 overflow-hidden">
                    <img src="/cv-person.jpg" alt="" className="w-full h-full object-cover object-top"
                      onError={e => { (e.currentTarget as HTMLImageElement).src = "/joonatan.jpg.jpeg"; }} />
                  </div>
                  <div className="text-center">
                    <div className="h-3 w-28 rounded-sm bg-zinc-700 mb-1.5 mx-auto" />
                    <div className="h-2 w-20 rounded-sm bg-zinc-800 mx-auto" />
                  </div>
                </div>
                {/* Centre: career lines */}
                <div className="space-y-2.5">
                  <div className="h-2 w-16 rounded-sm bg-zinc-800" />
                  <div className="h-2 w-full rounded-sm bg-zinc-700/60" />
                  <div className="h-2 w-4/5 rounded-sm bg-zinc-800/60" />
                  <div className="h-2 w-3/5 rounded-sm bg-zinc-800/60" />
                  <div className="mt-4 h-2 w-14 rounded-sm bg-zinc-800" />
                  <div className="h-2 w-full rounded-sm bg-zinc-700/50" />
                  <div className="h-2 w-2/3 rounded-sm bg-zinc-800/50" />
                </div>
                {/* Right: skill pills */}
                <div className="flex flex-wrap gap-1.5 content-start">
                  {["Enterprise Arch", "Cloud AWS", "React / TS", "Strategy", "Leadership"].map(s => (
                    <span key={s} className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] text-zinc-600">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              {/* Hover overlay CTA */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-black/40 backdrop-blur-sm rounded-2xl">
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black">
                  Open demo <ArrowRight size={14} />
                </span>
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* ── ORDER ── */}
      <section id="order" className="border-t border-white/5 px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
            {/* Left: pitch */}
            <div>
              <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                Order
              </p>
              <h2 className="mb-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
                Ready to get started?
              </h2>
              <p className="mb-8 leading-relaxed text-zinc-400">
                Share your LinkedIn or CV and we'll handle the rest. Live within days, not weeks.
              </p>
              <ul className="space-y-3 text-sm text-zinc-500">
                {[
                  "Response within 24 hours",
                  "No commitment until you approve the draft",
                  "Custom domain included in all packages",
                ].map(item => (
                  <li key={item} className="flex items-center gap-2">
                    <div className="h-1 w-1 flex-shrink-0 rounded-full bg-zinc-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: form */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:p-6">
              <OrderForm />
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 px-5 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="font-mono text-xs text-zinc-600">
            puuhapatet.fi/it · CV websites powered by Claude + Framer
          </p>
          <div className="flex gap-5">
            <Link href="/tietosuoja">
              <span className="cursor-pointer text-xs text-zinc-600 transition-colors hover:text-zinc-400">
                Privacy
              </span>
            </Link>
            <Link href="/ehdot">
              <span className="cursor-pointer text-xs text-zinc-600 transition-colors hover:text-zinc-400">
                Terms
              </span>
            </Link>
            <Link href="/">
              <span className="cursor-pointer text-xs text-zinc-600 transition-colors hover:text-zinc-400">
                Puuhapatet.fi
              </span>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
