import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, MapPin, Phone, Mail, Clock } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background pt-8 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-3xl">
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            Tietoa Puuhapatesta
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Olemme luotettava kumppani kaikissa piha- ja puutarhatöissä. 
            Ammattitaidolla ja intohimolla.
          </p>
        </div>

        <Card className="p-8 bg-card border-0 premium-shadow mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">Tarinamme</h2>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Puuhapatet syntyi halusta tarjota laadukkaita ja luotettavia pihapalveluita. 
              Uskomme, että jokainen piha ansaitsee huolenpitoa ja ammattitaitoista hoitoa.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Tiimimme koostuu kokeneista ammattilaisista, jotka rakastavat työtään. 
              Käytämme nykyaikaisia menetelmiä ja työkaluja varmistaaksemme parhaan mahdollisen 
              lopputuloksen jokaisessa projektissa.
            </p>
          </div>
        </Card>

        <Card className="p-8 bg-card border-0 premium-shadow mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-6">Yhteystiedot</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Sijainti</h3>
                <p className="text-muted-foreground text-sm">
                  Palvelemme Etelä-Suomen alueella
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Phone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Puhelin</h3>
                <p className="text-muted-foreground text-sm">
                  Yhteystiedot tilausvahvistuksessa
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Sähköposti</h3>
                <p className="text-muted-foreground text-sm">
                  Yhteydenottolomakkeen kautta
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">Aukioloajat</h3>
                <p className="text-muted-foreground text-sm">
                  Ma-Pe 8:00-18:00<br />
                  La sopimuksen mukaan
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="text-center">
          <p className="text-muted-foreground mb-6">
            Haluatko tilata palvelun? Siirry tilauslomakkeelle.
          </p>
          <Link href="/tilaus">
            <Button size="lg" data-testid="about-cta">
              Tee tilaus
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
