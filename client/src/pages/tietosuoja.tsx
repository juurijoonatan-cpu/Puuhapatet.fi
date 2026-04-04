import { Link } from "wouter";
import { Lock } from "lucide-react";

export default function TietosuojaPage() {
  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="text-center mb-10">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold text-foreground mb-2">Tietosuojaseloste</h1>
          <p className="text-muted-foreground text-sm">Puuhapatet. — päivitetty 2025</p>
        </div>

        <div className="space-y-8 text-sm">

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Rekisterinpitäjä</h2>
            <p className="text-muted-foreground leading-relaxed">
              Puuhapatet (4H-yrittäjät)<br />
              Espoo / Helsinki<br />
              Sähköposti: <a href="mailto:info@puuhapatet.fi" className="text-primary hover:underline">info@puuhapatet.fi</a><br />
              Puhelin: <a href="tel:+358400389999" className="text-primary hover:underline">0400 389 999</a>
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Rekisterin käyttötarkoitus</h2>
            <p className="text-muted-foreground leading-relaxed">
              Kerättyjä henkilötietoja käytetään yhteydenottaneiden tai tarjouspyynnön tehneiden
              henkilöiden kontaktointiin sekä asiakassuhteen hoitamiseen.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Tietojen keräämisen peruste</h2>
            <p className="text-muted-foreground leading-relaxed">
              Asiakkaan tietoja kerätään ja käsitellään joko asiakkaan antaman suostumuksen perusteella
              tai sopimuksen täytäntöönpanemiseksi.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Rekisterin tietosisältö</h2>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Nimi</li>
              <li>Puhelinnumero</li>
              <li>Sähköpostiosoite (vapaaehtoinen)</li>
              <li>Osoite tai alue</li>
              <li>Asiakkaan vapaaehtoisesti antama lisätieto</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Tietojen säilytysaika</h2>
            <p className="text-muted-foreground leading-relaxed">
              Henkilötietoja säilytetään niin kauan kuin ne ovat tarpeellisia asiakassuhteen
              hoitamiseksi. Tietoja ei luovuteta kolmansille osapuolille eikä siirretä ETA-maiden
              ulkopuolelle.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Säännönmukaiset tietolähteet</h2>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Yhteydenottolomake verkkosivuilla</li>
              <li>Puhelimitse annettavat tiedot</li>
              <li>Asiakkaan luovuttamat tiedot henkilökohtaisessa tapaamisessa</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Evästeet</h2>
            <p className="text-muted-foreground leading-relaxed">
              Verkkosivustollamme ei käytetä seurantaevästeitä eikä kolmansien osapuolten
              analytiikkapalveluja.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Rekisterin suojaus</h2>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Tiedot siirretään SSL-suojatun yhteyden kautta</li>
              <li>Tietojen käyttöoikeus on vain palvelusta vastaavilla henkilöillä</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Rekisteröidyn oikeudet</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              Jokaisella rekisteröidyllä on oikeus:
            </p>
            <ul className="text-muted-foreground space-y-1 list-disc list-inside">
              <li>Tarkistaa rekisteriin tallennetut tiedot</li>
              <li>Pyytää virheellisten tietojen korjaamista</li>
              <li>Pyytää tietojensa poistamista</li>
              <li>Vastustaa tietojensa käsittelyä</li>
              <li>Siirtää tietonsa järjestelmästä toiseen</li>
              <li>Tehdä valitus tietosuojavaltuutetulle</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Oikeuksien käyttämiseen liittyvät pyynnöt lähetetään osoitteeseen{" "}
              <a href="mailto:info@puuhapatet.fi" className="text-primary hover:underline">info@puuhapatet.fi</a>.
            </p>
          </section>

        </div>

        <div className="mt-10 border-t border-border pt-6 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Link href="/ehdot">
            <span className="hover:text-foreground transition-colors cursor-pointer underline underline-offset-2">Sopimusehdot</span>
          </Link>
          <Link href="/">
            <span className="hover:text-foreground transition-colors cursor-pointer underline underline-offset-2">Etusivu</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
