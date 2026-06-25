import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { SiWhatsapp } from "react-icons/si";
import {
  Banknote,
  CalendarClock,
  Zap,
  Users,
  ArrowRight,
  X,
  CheckCircle2,
  MapPin,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Matias Pitkänen's WhatsApp — leads go straight here, no pre-filled message. */
const WHATSAPP_URL = "https://wa.me/358442350881";

/** Reveal-on-scroll wrapper. Adds .rk-in once the element enters the viewport. */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("rk-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`rk-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** The single, unmissable WhatsApp call-to-action. */
function WhatsAppButton({
  label,
  pulse = false,
  className = "",
  testId,
}: {
  label: string;
  pulse?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={`group inline-flex items-center justify-center gap-3 rounded-full bg-[#25D366] px-8 py-4 text-base md:text-lg font-semibold text-white shadow-[0_10px_30px_rgba(37,211,102,0.35)] transition-all duration-200 hover:bg-[#1ebe5b] hover:-translate-y-0.5 active:scale-[0.98] ${
        pulse ? "rk-wa-pulse" : ""
      } ${className}`}
    >
      <SiWhatsapp className="w-6 h-6 shrink-0" />
      <span>{label}</span>
      <ArrowRight className="w-5 h-5 shrink-0 transition-transform duration-200 group-hover:translate-x-1" />
    </a>
  );
}

export default function RecruitmentPage() {
  const { lang } = useI18n();
  const fi = lang === "fi";
  const [bannerOpen, setBannerOpen] = useState(false);

  // Page title for the dedicated recruitment URL (shared from media posts).
  useEffect(() => {
    const prev = document.title;
    document.title = fi
      ? "Töihin Puuhapateille — ikkunanpesijöitä haetaan"
      : "Work at Puuhapatet — window cleaners wanted";
    return () => {
      document.title = prev;
    };
  }, [fi]);

  // Limited-opportunity banner: show once per session, after a short delay.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("rk-banner-dismissed") === "1") return;
    const timer = window.setTimeout(() => setBannerOpen(true), 2200);
    return () => window.clearTimeout(timer);
  }, []);

  const dismissBanner = () => {
    setBannerOpen(false);
    try {
      sessionStorage.setItem("rk-banner-dismissed", "1");
    } catch {
      /* ignore */
    }
  };

  const perks = [
    {
      icon: Banknote,
      title: fi ? "Palkka ~40 % yli keskiverron" : "~40% above average pay",
      desc: fi
        ? "Aloituspalkka on noin 40 % tavallista korkeampi. Ahkeruus näkyy suoraan tilillä."
        : "Starting pay is roughly 40% higher than usual. Hard work shows up directly in your account.",
    },
    {
      icon: CalendarClock,
      title: fi ? "Joustava aikataulu" : "Flexible schedule",
      desc: fi
        ? "Osa-aikaista tai pidempää määräaikaista. Sovitaan sinulle sopiva rytmi."
        : "Part-time or longer fixed-term. We agree on a rhythm that fits your life.",
    },
    {
      icon: Zap,
      title: fi ? "Nopea perehdytys" : "Fast onboarding",
      desc: fi
        ? "Lyhyt perehdytys ja pääset hommiin lähes heti. Ei kuukausien odottelua."
        : "A short onboarding and you're working almost right away. No months of waiting.",
    },
    {
      icon: Users,
      title: fi ? "Hyvä porukka & välineet" : "Great team & gear",
      desc: fi
        ? "Nuori, motivoitunut tiimi ja ammattilaisten välineet. Töissä on myös kiva olla."
        : "A young, motivated team and professional tools. Work that's actually good to show up to.",
    },
  ];

  const gallery = [
    { src: "/rekry-2.jpg", alt: fi ? "Ikkunanpesua kirkkaassa säässä" : "Window cleaning on a bright day" },
    { src: "/rekry-3.jpg", alt: fi ? "Työkohde keskustassa" : "A job site downtown" },
    { src: "/rekry-4.jpg", alt: fi ? "Tiimi työn touhussa" : "The team at work" },
    { src: "/rekry-5.jpg", alt: fi ? "Hyvää fiilistä keikalla" : "Good vibes on the job" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section className="relative min-h-[92vh] flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="/rekry-hero.jpg"
            alt={fi ? "Ikkunanpesijä työssä" : "Window cleaner at work"}
            className="w-full h-full object-cover object-center"
          />
          {/* Forest-green brand wash + bottom fade for legible white text */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#1f2a22]/85 via-[#2d3b30]/70 to-[#1a2019]/80" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        </div>

        <div className="container mx-auto px-4 md:px-6 relative z-10 pt-24 pb-20 md:pt-28">
          <div className="rk-hero-content max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#25D366]/15 border border-[#25D366]/30 text-[#7cf0a8] text-sm font-medium backdrop-blur-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#25D366]" />
              </span>
              {fi ? "Paikkoja auki nyt — rajoitettu määrä" : "Positions open now — limited spots"}
            </div>

            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-semibold text-white leading-[1.08] text-balance">
              {fi ? "Hyvä palkka. Joustava arki." : "Great pay. A flexible week."}
              <span className="block text-[#7cf0a8]">
                {fi ? "Pääset hommiin heti." : "Start working right away."}
              </span>
            </h1>

            <p className="mt-6 text-lg md:text-xl text-white/85 leading-relaxed max-w-2xl text-balance">
              {fi
                ? "Haemme reippaita ikkunanpesijöitä pääkaupunkiseudulle. Palkka on noin 40 % keskimääräistä aloituspalkkaa korkeampi, aikataulu joustaa ja perehdytys on nopea — pääset tienaamaan lähes saman tien."
                : "We're hiring energetic window cleaners in the Helsinki region. Pay is around 40% above the average starting wage, the schedule is flexible and onboarding is fast — you'll be earning almost right away."}
            </p>

            <div className="mt-9 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <WhatsAppButton
                label={fi ? "Hae WhatsAppilla" : "Apply on WhatsApp"}
                pulse
                testId="rekry-hero-whatsapp"
              />
              <p className="text-sm text-white/70 leading-relaxed">
                {fi
                  ? "Yksi viesti riittää — vastaamme yleensä saman päivän aikana."
                  : "One message is enough — we usually reply the same day."}
                <br />
                <span className="text-white/55">{fi ? "18+ · Ei sitoumuksia" : "18+ · No commitment"}</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────── PERKS ───────────────────────── */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
              {fi ? "Miksi me?" : "Why us?"}
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold text-foreground text-balance">
              {fi ? "Työ, joka oikeasti kannattaa" : "Work that's actually worth it"}
            </h2>
            <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
              {fi
                ? "Ei turhaa byrokratiaa. Reilu palkka, selkeät hommat ja porukka, jonka kanssa on hyvä tehdä töitä."
                : "No needless bureaucracy. Fair pay, clear work, and a team that's good to work with."}
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {perks.map((perk, i) => {
              const Icon = perk.icon;
              return (
                <Reveal key={i} delay={i * 90}>
                  <div className="h-full rounded-2xl bg-card border border-card-border/60 p-6 premium-shadow hover:premium-shadow-hover hover:-translate-y-1 transition-all duration-200">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2 leading-snug">
                      {perk.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{perk.desc}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ───────────────────────── SHOWCASE ───────────────────────── */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-semibold text-foreground text-balance">
              {fi ? "Tältä työ näyttää" : "What the work looks like"}
            </h2>
            <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
              {fi
                ? "Oikeita keikkoja, oikealla porukalla. Hienoja kohteita ja näkyvää jälkeä."
                : "Real jobs, with a real team. Great sites and visible results."}
            </p>
          </Reveal>

          {/* Photo gallery — real jobs, real team */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {gallery.map((img, i) => (
              <Reveal key={img.src} delay={i * 80}>
                <div className="group relative rounded-2xl overflow-hidden premium-shadow aspect-[3/4]">
                  <img
                    src={img.src}
                    alt={img.alt}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                  <span className="absolute bottom-3 left-4 right-4 text-white text-sm font-medium drop-shadow leading-snug">
                    {img.alt}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────── WHO ───────────────────────── */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <div className="max-w-4xl mx-auto grid md:grid-cols-[1.1fr_1fr] gap-8 md:gap-12 items-center">
            <Reveal>
              <div className="rounded-3xl overflow-hidden premium-shadow aspect-[4/5]">
                <img
                  src="/rekry-4.jpg"
                  alt={fi ? "Puuhapatet-tiimi töissä" : "The Puuhapatet team at work"}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div>
                <h2 className="text-3xl md:text-4xl font-semibold text-foreground text-balance">
                  {fi ? "Ketä etsimme?" : "Who we're looking for"}
                </h2>
                <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
                  {fi
                    ? "Tärkeintä on oikea asenne. Loput opetamme."
                    : "Attitude matters most. We'll teach you the rest."}
                </p>
                <ul className="mt-6 space-y-3">
                  {(fi
                    ? [
                        "Motivoitunut ja ahkera tekijä",
                        "Aikaisemmasta ikkunanpesukokemuksesta on hyötyä — ei pakollinen",
                        "Täysi-ikäinen (18+)",
                        "Reilu meininki ja halu tehdä siistiä jälkeä",
                      ]
                    : [
                        "Motivated and hard-working",
                        "Prior window-cleaning experience is a plus — not required",
                        "18 or over",
                        "A good attitude and pride in clean results",
                      ]
                  ).map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-7 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4 text-primary" />
                  {fi ? "Pääkaupunkiseutu" : "Helsinki metropolitan area"}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───────────────────────── FINAL CTA ───────────────────────── */}
      <section className="pb-24 md:pb-28">
        <div className="container mx-auto px-4 md:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground px-6 py-14 md:px-12 md:py-20 text-center">
              <div className="absolute inset-0 opacity-15">
                <img src="/rekry-2.jpg" alt="" className="w-full h-full object-cover" />
              </div>
              <div className="relative z-10 max-w-2xl mx-auto">
                <h2 className="text-3xl md:text-4xl font-semibold text-balance">
                  {fi ? "Kiinnostuitko? Laita viesti." : "Interested? Send a message."}
                </h2>
                <p className="mt-4 text-primary-foreground/85 text-lg leading-relaxed">
                  {fi
                    ? "Paikkoja on rajoitettu määrä ja rekry etenee nopeasti. Yksi WhatsApp-viesti riittää — kerromme loput."
                    : "Spots are limited and we move fast. One WhatsApp message is all it takes — we'll tell you the rest."}
                </p>
                <div className="mt-9 flex justify-center">
                  <WhatsAppButton
                    label={fi ? "Avaa WhatsApp" : "Open WhatsApp"}
                    pulse
                    testId="rekry-final-whatsapp"
                  />
                </div>
                <p className="mt-5 text-sm text-primary-foreground/70">
                  {fi ? "Vastaamme yleensä saman päivän aikana." : "We usually reply the same day."}
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ───────────────────────── FOOTER ───────────────────────── */}
      <footer className="py-8 border-t border-border">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Puuhapatet.
            </p>
            <Link href="/">
              <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                {fi ? "Takaisin etusivulle" : "Back to home"}
              </span>
            </Link>
          </div>
        </div>
      </footer>

      {/* ───────────────────────── FLOATING WHATSAPP FAB ───────────────────────── */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="rekry-fab-whatsapp"
        aria-label="WhatsApp"
        className="fixed right-4 bottom-24 md:right-8 md:bottom-8 z-40 inline-flex items-center gap-2.5 rounded-full bg-[#25D366] pl-4 pr-5 py-3.5 text-white font-semibold shadow-[0_10px_30px_rgba(37,211,102,0.4)] transition-all duration-200 hover:bg-[#1ebe5b] hover:-translate-y-0.5 active:scale-[0.98]"
      >
        <SiWhatsapp className="w-6 h-6 shrink-0" />
        <span className="hidden sm:inline">{fi ? "Hae töihin" : "Apply now"}</span>
      </a>

      {/* ───────────────────────── LIMITED-OPPORTUNITY BANNER ───────────────────────── */}
      {bannerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm rk-backdrop-in"
            onClick={dismissBanner}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="rk-banner-in relative w-full max-w-md rounded-3xl bg-card border border-card-border overflow-hidden shadow-2xl"
          >
            <button
              onClick={dismissBanner}
              aria-label={fi ? "Sulje" : "Close"}
              className="absolute top-3.5 right-3.5 z-10 w-9 h-9 rounded-full bg-black/10 hover:bg-black/20 text-foreground flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="rk-shine relative h-28 bg-gradient-to-br from-primary to-[#2d3b30] flex items-center px-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 text-white text-xs font-semibold tracking-wide uppercase">
                <Zap className="w-3.5 h-3.5" />
                {fi ? "Rajoitettu mahdollisuus" : "Limited opportunity"}
              </div>
            </div>

            <div className="p-6">
              <h3 className="text-2xl font-semibold text-foreground leading-snug">
                {fi ? "Pikarekry käynnissä nyt" : "Fast-track hiring is open now"}
              </h3>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                {fi
                  ? "Pääset hommiin lähes heti, palkka on noin 40 % keskimääräistä aloituspalkkaa korkeampi ja perehdytys on nopea. Paikkoja on rajoitettu määrä — tätä ei ole tarjolla aina."
                  : "Start almost immediately, with pay around 40% above the average starting wage and fast onboarding. Spots are limited — this isn't open all the time."}
              </p>
              <div className="mt-6">
                <WhatsAppButton
                  label={fi ? "Hae heti WhatsAppilla" : "Apply now on WhatsApp"}
                  className="w-full"
                  testId="rekry-banner-whatsapp"
                />
              </div>
              <button
                onClick={dismissBanner}
                className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {fi ? "Katson ensin lisää" : "Let me look around first"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
