import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Leaf, Clock, Shield, Star } from "lucide-react";

const features = [
  {
    icon: Leaf,
    title: "Ammattitaitoinen palvelu",
    description: "Kokeneet ammattilaiset huolehtivat pihasi kunnosta laadukkaasti.",
  },
  {
    icon: Clock,
    title: "Joustava aikataulutus",
    description: "Valitse sinulle sopiva ajankohta helposti verkossa.",
  },
  {
    icon: Shield,
    title: "Luotettava kumppani",
    description: "Vakuutettu ja vastuullinen palveluntarjoaja.",
  },
  {
    icon: Star,
    title: "Tyytyväisyystakuu",
    description: "Tavoitteemme on tyytyväinen asiakas, aina.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <section className="relative pt-24 md:pt-32 pb-16 md:pb-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3 pointer-events-none" />
        
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Leaf className="w-4 h-4" />
              <span>Piha- ja puutarhapalvelut</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-foreground leading-tight mb-6 text-balance">
              Ammattitaitoista pihanhoitoa
              <span className="text-primary"> sinun tarpeisiisi</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl mx-auto text-balance">
              Tilaa laadukkaat pihapalvelut helposti verkossa. Nurmikon leikkuusta puutarhan kunnostukseen – hoidamme kaiken puolestasi.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/tilaus">
                <Button size="lg" className="w-full sm:w-auto text-base px-8" data-testid="cta-booking">
                  Tilaa palvelu
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href="/tietoja">
                <Button variant="outline" size="lg" className="w-full sm:w-auto text-base px-8" data-testid="cta-info">
                  Lue lisää
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-2xl md:text-3xl font-semibold text-foreground mb-4">
              Miksi valita Puuhapatet?
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Tarjoamme luotettavaa ja laadukasta palvelua jokaiseen projektiin.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card 
                  key={index} 
                  className="p-6 bg-card border-0 premium-shadow hover:premium-shadow-hover hover:-translate-y-0.5 transition-all duration-200"
                  data-testid={`feature-card-${index}`}
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-6">
          <Card className="p-8 md:p-12 bg-primary text-primary-foreground border-0 text-center">
            <h2 className="text-2xl md:text-3xl font-semibold mb-4">
              Valmis aloittamaan?
            </h2>
            <p className="text-primary-foreground/80 text-lg mb-8 max-w-lg mx-auto">
              Täytä tilauslomake ja saat tarjouksen nopeasti. Ei sitoumuksia.
            </p>
            <Link href="/tilaus">
              <Button 
                size="lg" 
                variant="secondary" 
                className="text-base px-8 bg-white text-primary hover:bg-white/90"
                data-testid="cta-booking-footer"
              >
                Tee tilaus nyt
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
              &copy; {new Date().getFullYear()} Puuhapatet. Kaikki oikeudet pidätetään.
            </p>
            <div className="flex items-center gap-6">
              <Link href="/tietoja">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  Tietoja
                </span>
              </Link>
              <Link href="/admin/login">
                <span className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  Ylläpito
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
