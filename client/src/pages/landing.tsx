import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Sparkles, Clock, Shield, Snowflake, Leaf, PaintBucket, Shovel, ClipboardCheck, BadgePercent, ShieldCheck, Tag, Sun, Check } from "lucide-react";
import { SiWhatsapp, SiInstagram } from "react-icons/si";
import { Mail } from "lucide-react";
import { Typewriter } from "@/components/typewriter";
import { ReviewsSection } from "@/components/reviews-section";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { LeafFall } from "@/components/leaf-fall";
import { LightGainStat } from "@/components/light-gain-stat";
import { ReferenceStrip } from "@/components/reference-strip";
import { currentSeason, showsWinterServices } from "@shared/season";
import { useI18n } from "@/lib/i18n";
import { useState } from "react";

export default function LandingPage() {
  const { t, lang } = useI18n();
  
  const typewriterTexts = [
    t("typewriter.1"),
    t("typewriter.2"),
    t("typewriter.3"),
  ];

  const trustCards = [
    { icon: Sparkles, titleKey: "trust.1.title", descKey: "trust.1.desc" },
    { icon: Clock, titleKey: "trust.2.title", descKey: "trust.2.desc" },
    { icon: Shield, titleKey: "trust.3.title", descKey: "trust.3.desc" },
  ];

  // Vuodenaika luetaan @shared/seasonista eikä lasketa täällä. Ennen tätä
  // yläreunan pilleri oli kovakoodattu "Kevät on täällä!" samaan aikaan kun
  // alempi osio kertoi syksystä. Yksi lähde, ei ristiriitaa.
  const season = currentSeason();
  const isWinter = showsWinterServices();

  // Putoavat hiukkaset kuuluvat vain kahteen vuodenaikaan: syksyllä lehdet,
  // talvella lumi. Keväällä ja kesällä ei putoa mitään — kesäkuussa leijuvat
  // syyslehdet olisivat sama virhe kuin kevätpilleri syyskuussa.
  const fallVariant = season === "syksy" ? "leaves" : season === "talvi" ? "snow" : null;

  // Videon poster piilotetaan vasta kun video on oikeasti maalannut ruudulle.
  const [heroVideoReady, setHeroVideoReady] = useState(false);

  const seasonalServices = isWinter
    ? [
        { icon: Snowflake, titleKey: "service.talvikiilto.title", descKey: "service.talvikiilto.desc", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
        { icon: Shovel, titleKey: "service.lumityot.title", descKey: "service.lumityot.desc", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/10" },
      ]
    : [
        { icon: Sparkles, titleKey: "service.basic.title", descKey: "service.basic.1", color: "text-primary", bg: "bg-primary/10" },
        { icon: Tag, titleKey: "service.signs.title", descKey: "service.signs.desc", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
        { icon: Sun, titleKey: "service.gutters.title", descKey: "service.gutters.desc", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-500/10" },
        { icon: Leaf, titleKey: "service.gardening.title", descKey: "service.gardening.desc", color: "text-lime-700 dark:text-lime-400", bg: "bg-lime-500/10" },
      ];

  return (
    <div className="min-h-screen bg-background">
      <section className="relative pt-20 md:pt-28 pb-16 md:pb-24 overflow-hidden">
        {/* Taustavideo + tummennus.
            POSTER OLI ERI KUVA KUIN VIDEO. `hero-workers.jpg` on kuva
            julkisivulla työskentelevistä tekijöistä, kun taas videon
            ensimmäinen ruutu on lähikuva pesuhanskasta lasilla. Jokaisella
            sivunlatauksella välähti siis eri kuva ennen kuin video ehti
            maalata. Nyt poster on videon oma ensimmäinen ruutu
            (scripts/build-hero-poster.mjs), joten vaihdos on näkymätön.
            Varmuuden vuoksi video vielä häivytetään esiin: jos dekoodaus
            tökkii, siirtymä on pehmeä eikä hyppy. */}
        <div className="absolute inset-0">
          <img
            src="/hero-poster.jpg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/hero-poster.jpg"
            onPlaying={() => setHeroVideoReady(true)}
            onLoadedData={() => setHeroVideoReady(true)}
            className={`relative h-full w-full object-cover object-center transition-opacity duration-500 ${
              heroVideoReady ? "opacity-100" : "opacity-0"
            }`}
          >
            <source src="/hero-bg.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-background/82" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background/40" />
          <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>

        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            {/* Frosted glass backdrop for readability */}
            <div className="bg-background/55 backdrop-blur-md rounded-3xl px-6 py-10 md:px-10 shadow-lg">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" />
              <span>{t(`hero.pill.${season}`)}</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground leading-tight mb-4 text-balance">
              {t("hero.title")}
              <span className="text-primary"> {t("hero.titleAccent")}</span>
            </h1>

            <div className="h-8 mb-4">
              <Typewriter
                texts={typewriterTexts}
                className="text-lg md:text-xl text-primary/80 font-medium"
              />
            </div>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl mx-auto text-balance">
              {t("hero.subtitle")}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/tilaus">
                <Button size="lg" className="w-full sm:w-auto text-base px-8" data-testid="cta-booking">
                  {t("hero.cta")}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href="/palvelut">
                <Button variant="outline" size="lg" className="w-full sm:w-auto text-base px-8" data-testid="cta-services">
                  {t("hero.ctaSecondary")}
                </Button>
              </Link>
            </div>

            <p className="text-sm text-muted-foreground mt-6 italic">
              {t("hero.tagline")}
            </p>

            {/* Trust strip — our strongest no-risk signals up front */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              {[
                { icon: ClipboardCheck, label: t("trust.assessment") },
                { icon: BadgePercent, label: t("trust.deduction") },
                { icon: ShieldCheck, label: t("trust.guarantee") },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card/80 border border-border px-3 py-1.5 text-xs font-medium text-foreground premium-shadow"
                >
                  <Icon className="w-3.5 h-3.5 text-primary" />
                  {label}
                </span>
              ))}
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* ENNEN / JÄLKEEN.
          Sama ikkunarivi, sama kulma, sama valo — vain eri päivä. Tämä on
          vahvin todiste mitä meillä on, joten se on heti hero-osion alla eikä
          galleriakuvien joukossa: galleria kertoo että teemme työtä, tämä
          kertoo mitä siitä seuraa. Kuvat ovat rajattu samaan kokoon (3:4)
          jotta pyyhkäisy osuu kohdakkain — jos vaihdat kuvia, rajaa molemmat
          samalla skriptillä. Pystykuva istuu puhelimeen sellaisenaan ja
          työpöydällä teksti menee viereen, ei alle. */}
      <section className="relative overflow-hidden py-16 md:py-24">
        {fallVariant && <LeafFall className="opacity-90" variant={fallVariant} />}
        <div className="container relative mx-auto px-4 md:px-6">
          <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <BeforeAfterSlider
              beforeSrc="/window-before.jpg"
              afterSrc="/window-after.jpg"
              beforeLabel={t("ba.before")}
              afterLabel={t("ba.after")}
              alt={t("ba.alt")}
              handleLabel={t("ba.handle")}
              hint={t("ba.hint")}
              className="mx-auto w-full max-w-[420px] lg:max-w-none"
            />

            <div className="lg:pl-2">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <Leaf className="h-4 w-4" />
                <span>{t(`ba.badge.${season}`)}</span>
              </div>

              <h2 className="mb-4 text-2xl font-semibold leading-tight text-foreground text-balance md:text-3xl">
                {t("ba.title")}
              </h2>

              <p className="mb-5 leading-relaxed text-muted-foreground">
                {t("ba.body")}
              </p>

              {/* Mitattu luku eikä myyntipuhe: lähde on komponentin kommentissa. */}
              <LightGainStat
                label={t("ba.stat.label")}
                source={t("ba.stat.source")}
                className="mb-6"
              />

              <ul className="mb-8 space-y-3">
                {["ba.point.1", "ba.point.2", "ba.point.3"].map((key) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-3 w-3 text-primary" />
                    </span>
                    <span className="text-sm leading-relaxed text-foreground">{t(key)}</span>
                  </li>
                ))}
              </ul>

              <Link href="/tilaus">
                <Button size="lg" className="w-full text-base sm:w-auto" data-testid="cta-before-after">
                  {t("ba.cta")}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6">
          <div className="mb-20">
            <div className="grid grid-cols-1 md:grid-cols-[5fr_6fr] gap-6 md:items-stretch">
              {/* Left: image fills full column height */}
              <div className="rounded-2xl overflow-hidden premium-shadow h-full min-h-[280px]">
                <img
                  src="/work-hero.jpg"
                  alt="Ikkunanpesu"
                  className="w-full h-full object-cover object-center"
                />
              </div>
              {/* Right: all 3 trust cards stacked, same height as image */}
              <div className="flex flex-col gap-3 h-full">
                {trustCards.map((card, index) => {
                  const Icon = card.icon;
                  return (
                    <Card
                      key={index}
                      className="p-6 bg-card border-0 premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5 transition-all duration-200 flex-1 flex flex-col justify-center"
                      data-testid={`trust-card-${index}`}
                    >
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-2">
                        {t(card.titleKey)}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {t(card.descKey)}
                      </p>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
          
          {/* Work gallery — real photos from the field */}
          <div className="mb-20">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
                <Sparkles className="w-4 h-4" />
                <span>{t("gallery.subtitle")}</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-semibold text-foreground">
                {t("gallery.title")}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[6fr_5fr] gap-4 md:gap-5">
              {/* Left: tall hero photo */}
              <div className="group relative rounded-2xl overflow-hidden premium-shadow aspect-[3/2] md:aspect-auto md:min-h-[360px]">
                <img
                  src="/work-pole.jpg"
                  alt={t("gallery.1.caption")}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent" />
                <span className="absolute bottom-4 left-5 text-white font-medium text-sm md:text-base drop-shadow">
                  {t("gallery.1.caption")}
                </span>
              </div>
              {/* Right: two stacked photos — hidden on mobile */}
              <div className="hidden md:grid grid-rows-2 gap-4 md:gap-5">
                <div className="group relative rounded-2xl overflow-hidden premium-shadow">
                  <img
                    src="/work-door.jpg"
                    alt={t("gallery.2.caption")}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent" />
                  <span className="absolute bottom-4 left-5 text-white font-medium text-sm md:text-base drop-shadow">
                    {t("gallery.2.caption")}
                  </span>
                </div>
                <div className="group relative rounded-2xl overflow-hidden premium-shadow">
                  <img
                    src="/work-tools.jpg"
                    alt={t("gallery.3.caption")}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent" />
                  <span className="absolute bottom-4 left-5 text-white font-medium text-sm md:text-base drop-shadow">
                    {t("gallery.3.caption")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-foreground mb-4 text-center">
              {t("featured.title")}
            </h2>
            <div className={`grid gap-4 ${seasonalServices.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-4"}`}>
              {seasonalServices.map((svc, i) => {
                const Icon = svc.icon;
                return (
                  <Link href="/palvelut" key={i}>
                    <Card className="p-5 bg-card border-0 premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5 transition-all duration-200 cursor-pointer h-full">
                      <div className={`w-10 h-10 rounded-xl ${svc.bg} flex items-center justify-center mb-3`}>
                        <Icon className={`w-5 h-5 ${svc.color}`} />
                      </div>
                      <h3 className="font-semibold text-foreground mb-1 text-sm">
                        {t(svc.titleKey as any)}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        {t(svc.descKey as any)}
                      </p>
                    </Card>
                  </Link>
                );
              })}
            </div>
            <div className="text-center mt-4">
              <Link href="/palvelut">
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  {t("featured.cta")}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>

            {/* SIIVOUS — oma nauha, ei kausikorttien joukossa.
                Syy on rehellisyys eikä sommittelu: kausikortit ovat palveluita
                jotka voi tilata tänään, ja siivousta ei voi. Merkintä ja teksti
                sanovat sen suoraan, ja linkki vie laskuriin (arvio +
                ilmoittautuminen) eikä tilauslomakkeelle. */}
            <Link href="/laskuri">
              <Card className="mt-6 p-5 md:p-6 bg-card border-0 premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-sky-500/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-foreground">{t("service.cleaning.title")}</h3>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-sky-950 bg-sky-200 rounded-full px-2 py-0.5">
                        {t("services.soon")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t("service.cleaning.desc")}
                    </p>
                    <span className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-primary">
                      {t("service.cleaning.cta")}
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                  <div className="hidden sm:block w-40 flex-shrink-0 rounded-xl overflow-hidden aspect-[4/3]">
                    <img
                      src="/clean-hero.jpg"
                      alt={t("service.cleaning.title")}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </Card>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-3 gap-3 md:gap-4 max-w-xl mx-auto">
            <a
              href="https://wa.me/358400389999"
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-1"
            >
              <Button variant="outline" size="lg" className="gap-2 w-full" data-testid="contact-whatsapp">
                <SiWhatsapp className="w-5 h-5" />
                <span className="hidden sm:inline">{t("contact.whatsapp")}</span>
                <span className="sm:hidden">WA</span>
              </Button>
            </a>
            <a
              href="https://instagram.com/puuhapatet.fi"
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-1"
            >
              <Button variant="outline" size="lg" className="gap-2 w-full" data-testid="contact-instagram">
                <SiInstagram className="w-5 h-5" />
                <span className="hidden sm:inline">{t("contact.instagram")}</span>
                <span className="sm:hidden">IG</span>
              </Button>
            </a>
            <a
              href="mailto:info@puuhapatet.fi"
              className="col-span-1"
            >
              <Button variant="outline" size="lg" className="gap-2 w-full" data-testid="contact-email">
                <Mail className="w-5 h-5" />
                <span className="hidden sm:inline">{t("contact.email")}</span>
                <span className="sm:hidden">Email</span>
              </Button>
            </a>
          </div>
        </div>
      </section>

      <ReviewsSection />

      <ReferenceStrip />

      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <Card className="p-8 md:p-12 bg-primary text-primary-foreground border-0 text-center">
            <h2 className="text-2xl md:text-3xl font-semibold mb-4">
              {lang === "fi" ? "Valmis aloittamaan?" : "Ready to start?"}
            </h2>
            <p className="text-primary-foreground/80 text-lg mb-8 max-w-lg mx-auto">
              {lang === "fi" 
                ? "Täytä yhteydenottopyyntö ja vastaamme pian. Ei sitoumuksia." 
                : "Fill out the contact form and we'll respond soon. No obligations."
              }
            </p>
            <Link href="/tilaus">
              <Button 
                size="lg" 
                variant="secondary" 
                className="text-base px-8 bg-white text-primary hover:bg-white/90"
                data-testid="cta-booking-footer"
              >
                {t("hero.cta")}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          </Card>
        </div>
      </section>

      <footer className="py-8 border-t border-border">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Puuhapatet. {t("footer.rights")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link href="/meista">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  {t("nav.about")}
                </span>
              </Link>
              <Link href="/toihin">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  {lang === "fi" ? "Töihin meille" : "Work with us"}
                </span>
              </Link>
              <Link href="/ehdot">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  Sopimusehdot
                </span>
              </Link>
              <Link href="/tietosuoja">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  Tietosuoja
                </span>
              </Link>
              <Link href="/admin/login">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  {t("footer.admin")}
                </span>
              </Link>
            </div>
          </div>
        </div>
      </footer>
      
      <div className="h-20 md:hidden" />
    </div>
  );
}
