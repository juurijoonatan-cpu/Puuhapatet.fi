import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck } from "lucide-react";

export default function EhdotPage() {
  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="text-center mb-10">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">Sopimusehdot</h1>
          <p className="text-muted-foreground text-sm">Puuhapatet. — voimassa kaikissa palveluissa</p>
        </div>

        <div className="prose prose-sm max-w-none space-y-8 text-foreground">

          <section>
            <h2 className="text-base font-semibold mb-2">Työn sisältö</h2>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Palvelu kattaa tilauksessa sovitun työn ammattimaisesti ja huolellisesti suoritettuna.
              Tuomme mukanamme tarvittavat välineet ja materiaalit, ellei muuta ole sovittu.
              Työ suoritetaan asiakkaan ilmoittamassa kohteessa ja palvelun tarkka sisältö käydään läpi
              tilauksen yhteydessä tai viimeistään työn aloituksessa.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Lisätyöt</h2>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Tilauksen ulkopuoliset lisätyöt — kuten vaikeasti saavutettavat kohteet,
              ennalta ilmoittamattomat lisäalueet tai muut erikseen sovittavat työt — ovat lisäveloitteisia.
              Lisätöistä sovitaan aina etukäteen asiakkaan kanssa. Lisätyön hinta on 45 €/h + mahdolliset matkakulut.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Vastuu ja vakuutukset</h2>
            <p className="text-muted-foreground leading-relaxed text-sm mb-3">
              Puuhapatet on yhteinen brändi, jonka sisällä jokainen toimija on itsenäinen 4H-yrittäjä.
              Jokaisella toimijalla on oma vastuuvakuutus, joka kattaa toiminnan vastuun sekä tuotevastuun.
              Vakuutus on voimassa koko Euroopassa.
            </p>
            <ul className="text-muted-foreground text-sm space-y-1 list-none pl-0">
              <li>Henkilövahingot: enintään <strong className="text-foreground">500 000 €</strong> per vahinko</li>
              <li>Esinevahingot: enintään <strong className="text-foreground">100 000 €</strong> per vahinko</li>
              <li>Käsiteltävänä oleva omaisuus: enintään <strong className="text-foreground">5 000 €</strong> per vahinko</li>
              <li>Vakuutuksen omavastuu: <strong className="text-foreground">300 €</strong></li>
            </ul>
            <p className="text-muted-foreground leading-relaxed text-sm mt-3">
              Arvoesineet ja herkästi rikkoutuvat tavarat pyydämme siirtämään työkohteen läheisyydestä ennen työn aloittamista.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Hinnat ja maksaminen</h2>
            <p className="text-muted-foreground leading-relaxed text-sm mb-3">
              Lopullinen hinta perustuu sovittuun työn laajuuteen. Jos työkohde eroaa merkittävästi
              ennalta ilmoitetusta, tarkistettu hinta sovitaan ennen työn jatkamista.
            </p>
            <p className="text-muted-foreground text-sm mb-1">Hyväksytyt maksutavat: tilisiirto, MobilePay, käteinen.</p>
            <ul className="text-muted-foreground text-sm space-y-1 list-none pl-0">
              <li>Maksuehto: <strong className="text-foreground">14 päivää</strong></li>
              <li>Viivästyskorko lain mukaan</li>
              <li>Maksumuistutus: <strong className="text-foreground">5 €</strong></li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Reklamaatiot</h2>
            <p className="text-muted-foreground leading-relaxed text-sm">
              Reklamaatiot ilmoitetaan kirjallisesti osoitteeseen{" "}
              <a href="mailto:info@puuhapatet.fi" className="text-primary hover:underline">info@puuhapatet.fi</a>{" "}
              kahden (2) vuorokauden kuluessa työn valmistumisesta.
              Emme hyvitä suoraan laskussa — suoritamme korjauskäynnin veloituksetta,
              jos reklamaatio todetaan aiheelliseksi.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Peruutukset</h2>
            <p className="text-muted-foreground text-sm mb-2">
              Tilauksen voi peruuttaa maksutta viimeistään <strong className="text-foreground">48 tuntia</strong> ennen sovittua ajankohtaa.
            </p>
            <ul className="text-muted-foreground text-sm space-y-1 list-none pl-0">
              <li>Alle 48 h ennen: <strong className="text-foreground">50 %</strong> palvelun hinnasta</li>
              <li>Alle 24 h ennen tai no-show: <strong className="text-foreground">100 %</strong> palvelun hinnasta</li>
            </ul>
          </section>

        </div>

        <div className="mt-10 text-center">
          <Link href="/tilaus">
            <Button size="lg">
              Pyydä yhteydenotto
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
