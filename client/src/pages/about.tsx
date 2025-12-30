import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MapPin, Mail, Users } from "lucide-react";
import { SiWhatsapp, SiInstagram } from "react-icons/si";
import { useI18n } from "@/lib/i18n";

export default function AboutPage() {
  const { t } = useI18n();
  
  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {t("about.title")}
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("about.desc")}
          </p>
        </div>

        <Card className="p-8 bg-card border-0 premium-shadow mb-8">
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>{t("about.story.1")}</p>
            <p>{t("about.story.2")}</p>
            <p>{t("about.story.3")}</p>
          </div>
        </Card>

        <Card className="p-8 bg-card border-0 premium-shadow mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {t("about.team.title")}
              </h2>
              <Badge variant="outline" className="mt-1">
                {t("packages.coming")}
              </Badge>
            </div>
          </div>
          <p className="text-muted-foreground">
            {t("about.team.coming")}
          </p>
        </Card>

        <Card className="p-8 bg-card border-0 premium-shadow mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-6">
            {t("about.contact.title")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">
                  {t("faq.q1").replace("?", "")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  Espoo: Westend, Haukilahti, Saunalahti, Suvisaaristo
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">
                  {t("contact.email")}
                </h3>
                <a 
                  href="mailto:info@puuhapatet.fi" 
                  className="text-muted-foreground text-sm hover:text-foreground transition-colors"
                >
                  info@puuhapatet.fi
                </a>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-border">
            <a 
              href="https://wa.me/358000000000" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-2" data-testid="about-whatsapp">
                <SiWhatsapp className="w-4 h-4" />
                {t("contact.whatsapp")}
              </Button>
            </a>
            <a 
              href="https://instagram.com/puuhapatet" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-2" data-testid="about-instagram">
                <SiInstagram className="w-4 h-4" />
                {t("contact.instagram")}
              </Button>
            </a>
          </div>
        </Card>

        <div className="text-center">
          <p className="text-muted-foreground mb-6">
            {t("hero.tagline")}
          </p>
          <Link href="/tilaus">
            <Button size="lg" data-testid="about-cta">
              {t("hero.cta")}
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
