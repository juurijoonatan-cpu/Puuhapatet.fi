import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Sparkles, Clock, Shield, Snowflake, Leaf, Car, PaintBucket, Shovel } from "lucide-react";
import { SiWhatsapp, SiInstagram } from "react-icons/si";
import { Mail } from "lucide-react";
import { Typewriter } from "@/components/typewriter";
import { ReviewsSection } from "@/components/reviews-section";
import { useI18n } from "@/lib/i18n";

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

  const month = new Date().getMonth(); // 0 = Jan, 11 = Dec
  const isWinter = month >= 10 || month <= 1; // Nov–Feb

  const seasonalServices = isWinter
    ? [
        { icon: Snowflake, titleKey: "service.talvikiilto.title", descKey: "service.talvikiilto.desc", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
        { icon: Shovel, titleKey: "service.lumityot.title", descKey: "service.lumityot.desc", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-500/10" },
      ]
    : [
        { icon: Sparkles, titleKey: "service.basic.title", descKey: "service.basic.1", color: "text-primary", bg: "bg-primary/10" },
        { icon: Leaf, titleKey: "service.gardening.title", descKey: "service.gardening.desc", color: "text-lime-700 dark:text-lime-400", bg: "bg-lime-500/10" },
        { icon: Car, titleKey: "service.cardetailing.title", descKey: "service.cardetailing.desc", color: "text-green-700 dark:text-green-400", bg: "bg-green-500/10" },
        { icon: PaintBucket, titleKey: "service.painting.title", descKey: "service.painting.desc", color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-500/10" },
      ];

  return (
    <div className="min-h-screen bg-background">
      <section className="relative pt-20 md:pt-32 pb-16 md:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3 pointer-events-none" />
        
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" />
              <span>{t("hero.pill")}</span>
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
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {trustCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <Card 
                  key={index} 
                  className="p-6 bg-card border-0 premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5 transition-all duration-200"
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
              href="https://instagram.com/puuhapatet"
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
            <div className="flex items-center gap-6">
              <Link href="/meista">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  {t("nav.about")}
                </span>
              </Link>
              <Link href="/ehdot">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  Sopimusehdot
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
