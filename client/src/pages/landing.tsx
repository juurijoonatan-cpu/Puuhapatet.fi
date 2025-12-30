import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Sparkles, Clock, Shield, Snowflake } from "lucide-react";
import { SiWhatsapp, SiInstagram } from "react-icons/si";
import { Mail } from "lucide-react";
import { Typewriter } from "@/components/typewriter";
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

  return (
    <div className="min-h-screen bg-background">
      <section className="relative pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden">
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
          
          <Card className="p-6 md:p-8 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-0">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
              <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Snowflake className="w-7 h-7 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-xl font-semibold text-foreground">
                    {t("talvikiilto.title")}
                  </h3>
                  <span className="text-sm text-muted-foreground">
                    ({t("talvikiilto.subtitle")})
                  </span>
                </div>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  {t("talvikiilto.desc")}
                </p>
                <Link href="/palvelut#talvikiilto">
                  <Button variant="outline" size="sm" data-testid="talvikiilto-cta">
                    {t("talvikiilto.cta")}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-wrap justify-center gap-3 md:gap-4">
            <a 
              href="https://wa.me/358000000000" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex"
            >
              <Button variant="outline" size="sm" className="gap-2" data-testid="contact-whatsapp">
                <SiWhatsapp className="w-4 h-4" />
                {t("contact.whatsapp")}
              </Button>
            </a>
            <a 
              href="https://instagram.com/puuhapatet" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex"
            >
              <Button variant="outline" size="sm" className="gap-2" data-testid="contact-instagram">
                <SiInstagram className="w-4 h-4" />
                {t("contact.instagram")}
              </Button>
            </a>
            <a 
              href="mailto:info@puuhapatet.fi" 
              className="inline-flex"
            >
              <Button variant="outline" size="sm" className="gap-2" data-testid="contact-email">
                <Mail className="w-4 h-4" />
                {t("contact.email")}
              </Button>
            </a>
          </div>
        </div>
      </section>

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
