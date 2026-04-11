/**
 * Työntekijän opas — Puuhapatet
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronDown, ChevronUp, Phone, Mail, AlertTriangle, Star, ClipboardList, Euro, Users, Shield, Laptop, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Section {
  id: string;
  icon: typeof Phone;
  title: string;
  color: string;
  bg: string;
  content: React.ReactNode;
}

function Accordion({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const Icon = section.icon;
  return (
    <Card className="bg-card border-0 premium-shadow overflow-hidden mb-3">
      <button
        className="w-full flex items-center justify-between p-5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl ${section.bg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-4 h-4 ${section.color}`} />
          </div>
          <span className="font-semibold text-foreground">{section.title}</span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-border pt-4">
          {section.content}
        </div>
      )}
    </Card>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-foreground leading-relaxed mb-3 last:mb-0">{children}</p>
);

const H = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 mt-4 first:mt-0">{children}</p>
);

const Li = ({ children }: { children: React.ReactNode }) => (
  <li className="text-sm text-foreground leading-relaxed flex gap-2">
    <span className="text-primary mt-0.5 shrink-0">•</span>
    <span>{children}</span>
  </li>
);

const sections: Section[] = [
  {
    id: "welcome",
    icon: Star,
    title: "Tervetuloa Puuhapatet-tiimiin",
    color: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    content: (
      <div>
        <P>
          Puuhapatet on kasvava ikkunanpesu- ja kotitalouspalvelubrändi. Teemme laadukasta työtä,
          pidämme lupauksemme ja rakennamme pitkiä asiakassuhteita.
        </P>
        <P>
          Olet osa pientä, luotettavaa tiimiä. Jokainen keikka on Puuhapatetin mainos —
          hyvä työ tuo lisää asiakkaita kaikille.
        </P>
        <H>Arvomme</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Laatu ennen nopeutta — tee työ huolella</Li>
          <Li>Rehellisyys asiakkaalle ja tiimille</Li>
          <Li>Täsmällisyys — ole ajoissa tai ilmoita etukäteen</Li>
          <Li>Ammattimainen olemus (siistit vaatteet, asiallinen käytös)</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "customer",
    icon: Users,
    title: "Asiakkaan kohtaaminen",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    content: (
      <div>
        <H>Ennen keikkaa</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Soita tai lähetä viesti edellisenä päivänä: "Huomenna klo [X] — sopiko?"</Li>
          <Li>Varmista osoite ja mahdollinen porttipuhelin / avain</Li>
          <Li>Jos asiakas ei vastaa, yritä uudelleen kerran — sitten ilmoita Joonatanille</Li>
        </ul>
        <H>Ensimmäinen kontakti</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Esittele itsesi nimellä: "Hei, olen [nimi] Puuhapatateilta"</Li>
          <Li>Kysy lupaa ennen kuin menet pihaan tai sisälle</Li>
          <Li>Näytä sovittu hinta selkeästi ennen työn aloitusta</Li>
        </ul>
        <H>Lisämyynti — tarjoa luontevasti</H>
        <ul className="space-y-1.5 mb-3">
          <Li>"Huomasin parvekkeella ristikon — haluatteko sen samalla puhdistettua? (+39 €)"</Li>
          <Li>"Olisiko teillä pihassa myös muuta mikä kaipaisi huoltoa?"</Li>
          <Li>Älä painosta — ehdota kerran, hyväksy ei</Li>
        </ul>
        <H>Työn jälkeen</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Näytä tulos asiakkaalle (kierretään talon ympäri)</Li>
          <Li>Kysy onko he tyytyväisiä ennen lähtöä</Li>
          <Li>Kerro kuittiprosessista: "Lähetän sähköpostin kuitin"</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "services",
    icon: ClipboardList,
    title: "Palvelut ja hinnoittelu",
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-900/30",
    content: (
      <div>
        <H>Palvelutasot (ikkunapesu)</H>
        <ul className="space-y-1.5 mb-3">
          <Li><strong>Kaikki pinnat (sisä + ulko):</strong> perus hinta × 1.0</Li>
          <Li><strong>Vain ulkopuoli:</strong> hinta × 0.58</Li>
          <Li><strong>Vuosisopimus (2× vuodessa):</strong> hinta × 1.8 (molemmat kerrat yht.)</Li>
        </ul>
        <H>Hintaluokat</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Omakotitalo ≤ 100 m²: ~180 €</Li>
          <Li>Omakotitalo 101–150 m²: ~220 €</Li>
          <Li>Omakotitalo 151–200 m²: ~260 €</Li>
          <Li>Paritalo / rivitalo: omat taulukkonsa järjestelmässä</Li>
          <Li>Kerrostalo: huoneistokohtainen</Li>
        </ul>
        <H>Lisäpalvelut</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Parvekkeen lasi + ristikko: +39 €</Li>
          <Li>Porrashuoneen ristikko: +39 €</Li>
          <Li>Peili: +19 €</Li>
          <Li>Lippa/markiisi: +89 €</Li>
          <Li>Syöksytorvi: +69 €</Li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Hinnat ovat suuntaa-antavia. Käytä aina järjestelmän hintalaskuria tai sovi Joonatanin kanssa.
        </p>
      </div>
    ),
  },
  {
    id: "finance",
    icon: Euro,
    title: "Tilitys ja palvelumaksu",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-100 dark:bg-green-900/30",
    content: (
      <div>
        <H>Miten tilitys toimii</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Sovittu hinta − kulut = nettotulo</Li>
          <Li>Palvelumaksu on 10 % nettotulosta per tekijä</Li>
          <Li>Jos kaksi tekijää, kulut ja palvelumaksu jaetaan tasan</Li>
          <Li>Loput ovat sinun / tiimin ansioita</Li>
        </ul>
        <H>Esimerkki</H>
        <div className="bg-muted/30 rounded-xl p-3 text-sm mb-3">
          <p className="text-foreground">Keikka: 220 €</p>
          <p className="text-foreground">Kulut (pesuaine, km): −20 €</p>
          <p className="text-foreground">Nettotulo: 200 €</p>
          <p className="text-foreground">Palvelumaksu (10 %): −20 €</p>
          <p className="font-semibold text-green-600 dark:text-green-400 mt-1">Sinulle: 180 €</p>
        </div>
        <H>Maksutavat</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Käteinen, MobilePay, tilisiirto tai kortti — kaikki OK</Li>
          <Li>Merkitse maksutapa kuittiin ennen lähettämistä</Li>
          <Li>Rahat sinulle heti — palvelumaksu tilitetään Joonatanille</Li>
        </ul>
        <H>Palvelumaksun tilitys</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Maksa kertyneet palvelumaksut sovitusti (yleensä kuukausittain)</Li>
          <Li>Joonatan tai Matias nollaa saldon asetuksista maksun jälkeen</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "policies",
    icon: Shield,
    title: "Ehdot ja käytännöt",
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-100 dark:bg-orange-900/30",
    content: (
      <div>
        <H>Peruutukset</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Asiakasperuutus alle 24h ennen: veloitetaan 50 % hinnasta</Li>
          <Li>Ilmoita asiakkaalle muutos heti ja merkitse keikka järjestelmään</Li>
          <Li>Omat poissaolot: ilmoita Joonatanille niin pian kuin mahdollista</Li>
        </ul>
        <H>Vahinko kohteessa</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Ilmoita heti Joonatanille — älä lupaa mitään asiakkaalle</Li>
          <Li>Dokumentoi vaurio kuvalla</Li>
          <Li>Ei panikointia — asiat hoituvat</Li>
        </ul>
        <H>Salassapito</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Asiakkaiden tiedot pysyvät tiimin sisällä</Li>
          <Li>Ei kuvia asiakkaiden omaisuudesta sosiaaliseen mediaan ilman lupaa</Li>
        </ul>
        <H>Brändikäyttäytyminen</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Siistit, mieluiten Puuhapatet-logolliset vaatteet</Li>
          <Li>Älä tupakoi asiakkaan pihalla</Li>
          <Li>Ei negatiivista puhetta kilpailijoista</Li>
          <Li>Puhelimet pois näkyvistä työn aikana (paitsi musiikki kuulokkeilla)</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "adminpanel",
    icon: Laptop,
    title: "Hallintapaneelin käyttö",
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-100 dark:bg-indigo-900/30",
    content: (
      <div>
        <H>Uusi keikka</H>
        <ul className="space-y-1.5 mb-3">
          <Li><strong>Dashboard → Uusi keikka:</strong> avaa ohjattu 4-vaiheinen wizard</Li>
          <Li><strong>Vaihe 1 — Asiakas:</strong> nimi, puhelin, osoite. Järjestelmä luo asiakasprofiilin automaattisesti.</Li>
          <Li><strong>Vaihe 2 — Arviointi:</strong> muistiinpanot kohteesta (valinnainen)</Li>
          <Li><strong>Vaihe 3 — Hinnoittelu:</strong> valitse palvelutyyppi (ikkunapesu → käytä laskuria; muut → syötä hinta käsin)</Li>
          <Li><strong>Vaihe 4 — Sopimus:</strong> allekirjoitukset. Valmis!</Li>
        </ul>

        <H>Keikka-näkymä (Keikat)</H>
        <ul className="space-y-1.5 mb-3">
          <Li><strong>Status:</strong> vaihda napautuksella: Liidi → Ajoitettu → Käynnissä → Valmis</Li>
          <Li><strong>Ajankohta:</strong> aseta päivämäärä ja kellonaika — näkyy kalenterissa</Li>
          <Li><strong>Tekijät:</strong> valitse kuka tai ketkä tekee keikan (jaetaan tasan)</Li>
          <Li><strong>Kulut:</strong> lisää materiaali- ym. kulut euroa/kpl — vähentää automaattisesti netosta</Li>
          <Li><strong>Tilitys-kortti:</strong> näyttää jokaisen tekijän netto-osuuden automaattisesti</Li>
          <Li><strong>Kuitti:</strong> valitse maksutapa → "Avaa kuitti sähköpostiin" — avautuu sähköpostiohjelma valmiilla viestillä</Li>
        </ul>

        <H>Kalenteri</H>
        <ul className="space-y-1.5 mb-3">
          <Li><strong>Lista-näkymä (oletus):</strong> kaikki tulevat aikataulutetut keikat aikajärjestyksessä</Li>
          <Li><strong>Viikko-näkymä:</strong> 7 päivää vierekkäin, keikat näkyvät omassa solussa</Li>
          <Li><strong>Päivä-näkymä:</strong> yksittäisen päivän keikat</Li>
          <Li>Näkyy vain keikat joilla on ajankohta — aseta se keikkasivulta</Li>
        </ul>

        <H>Asiakkaat</H>
        <ul className="space-y-1.5 mb-3">
          <Li>Kaikki asiakkaat listalla. Naputa asiakasta nähdäksesi kaikki heidän keikkansa.</Li>
          <Li>Voit muokata nimeä, puhelinta, osoitetta ja sähköpostia</Li>
        </ul>

        <H>Asetukset</H>
        <ul className="space-y-1.5 mb-3">
          <Li><strong>Vaihda salasana:</strong> vaihda oma henkilökohtainen kirjautumissalasanasi</Li>
          <Li><strong>Verotuloste:</strong> lataa CSV tai tulosta keikat verotusta varten (ks. alla)</Li>
          <Li><strong>Investoinnit &amp; välineet:</strong> kirjaa hankinnat (oma tai 50/50 toisen kanssa)</Li>
          <Li><strong>Palvelumaksuvelat (vain HOST):</strong> näet kertyneet velat per tekijä — paina "Maksettu" kun on maksettu</Li>
        </ul>
      </div>
    ),
  },
  {
    id: "tax",
    icon: FileText,
    title: "Veroilmoitus — 4H-yrittäjä (OmaVero)",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    content: (
      <div>
        <P>
          4H-yrittäjänä ilmoitat tulot OmaVerossa kohdassa <strong>Muut ansiotulot</strong>.
          Käytä Verotuloste-sivua saadaksesi oikeat luvut helposti. Alla vaihe vaiheelta.
        </P>

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 mb-4">
          <p className="text-xs font-bold text-blue-800 dark:text-blue-300 mb-2">
            Ohje huoltajalle — kirjautuminen alaikäisen puolesta
          </p>
          <ol className="text-xs text-blue-700 dark:text-blue-400 space-y-1 list-decimal list-inside">
            <li>Kirjaudu <strong>OmaVeroon</strong> omilla pankkitunnuksilla</li>
            <li>Valitse <strong>Asioi toisen puolesta</strong></li>
            <li>Valitse <strong>Siirry Valtuudet-palveluun</strong></li>
            <li>Valitse <strong>kenen puolesta asioit</strong> (nuori yrittäjä)</li>
          </ol>
        </div>

        <H>Esitäytetty veroilmoitus</H>
        <ol className="space-y-1.5 mb-4 list-decimal list-inside">
          <li className="text-sm text-foreground leading-relaxed">Avaa <strong>Esitäytetty veroilmoitus</strong> -laatikko</li>
          <li className="text-sm text-foreground leading-relaxed">Valitse <strong>Korjaa esitäytetyn veroilmoituksen tietoja</strong> (ohjeet oikeassa laidassa)</li>
          <li className="text-sm text-foreground leading-relaxed">Jos vuosi on jo esivalittu → valitse alhaalta <strong>Tulojen ja vähennysten ilmoittaminen</strong> (henkilökohtainen veroilmoitus)</li>
          <li className="text-sm text-foreground leading-relaxed">Tarkista taustatiedot</li>
        </ol>

        <H>Tulot — tärkein kohta</H>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 mb-4">
          <ol className="text-sm text-green-800 dark:text-green-300 space-y-1.5 list-decimal list-inside">
            <li>Siirry <strong>Tuotot</strong>-sivulle</li>
            <li>Lisää <strong>Muut tulot → Muut ansiotulot</strong></li>
            <li>Kuvaus: <em>"4H-toiminnan tulot"</em></li>
            <li>Summa: <strong>nettoansio</strong> (se mitä jäi käteen tulojen ja menojen jälkeen — löytyy Verotulosteesta)</li>
          </ol>
        </div>

        <H>Matkakulut (lisävähennys)</H>
        <ol className="space-y-1.5 mb-4 list-decimal list-inside">
          <li className="text-sm text-foreground leading-relaxed">Muut vähennykset → <strong>Matkakulut</strong></li>
          <li className="text-sm text-foreground leading-relaxed">Valitse: <em>Muu kuin asunnon ja työpaikan välinen matka</em></li>
          <li className="text-sm text-foreground leading-relaxed">Valitse: <em>Tilapäiset työmatkat ja erityisalan matkat</em></li>
          <li className="text-sm text-foreground leading-relaxed">Kulkuneuvo: valitse käyttämäsi</li>
          <li className="text-sm text-foreground leading-relaxed">Säännöllinen sama matka: <strong>Ei</strong></li>
          <li className="text-sm text-foreground leading-relaxed">Työpaikan osoite: kirjoita <em>"useita kohteita"</em></li>
          <li className="text-sm text-foreground leading-relaxed">Yhden päivän matkan keskipituus: kokonaiskilometrit ÷ työpäivien määrä</li>
          <li className="text-sm text-foreground leading-relaxed">Matkapäivien lukumäärä: sama jakaja</li>
        </ol>

        <H>Muut tulonhankkimismenot</H>
        <ul className="space-y-1.5 mb-4">
          <Li>Muut vähennykset → <strong>Tulonhankkimismenot</strong></Li>
          <Li>→ Muiden kuin palkkatulojen tulonhankkimismenot</Li>
          <Li>Vähennyskelpoisia: 4H-jäsenmaksu, 4H-yrittäjän vakuutus, pesuaineet ja välineet (jos ei kirjattu jo Investoinnit-osioon)</Li>
        </ul>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-3 border border-yellow-200 dark:border-yellow-800">
          <p className="text-xs font-bold text-yellow-800 dark:text-yellow-300 mb-1">
            Muista säilyttää kuitit!
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-400">
            Kaikista vähennetyistä kuluista täytyy olla kuitti mahdollista verotarkastusta varten.
            Tämän sovelluksen Verotuloste-sivu toimii kirjanpitona keikkatuloista.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "contact",
    icon: Phone,
    title: "Yhteystiedot — apua ongelmiin",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-100 dark:bg-red-900/30",
    content: (
      <div>
        <P>Jos tulee ongelmia, ota yhteys heti — ei kannata jäädä yksin miettimään.</P>
        <div className="space-y-3 mt-2">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">JJ</span>
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Joonatan Juuri</p>
              <p className="text-xs text-muted-foreground mb-1.5">Perustaja · päävastuuhenkilö</p>
              <a href="tel:+358451234567" className="flex items-center gap-1.5 text-sm text-primary">
                <Phone className="w-3.5 h-3.5" /> +358 45 123 4567
              </a>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30">
            <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">MP</span>
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Matias Pitkänen</p>
              <p className="text-xs text-muted-foreground mb-1.5">Perustaja · operatiivinen</p>
              <a href="tel:+358457654321" className="flex items-center gap-1.5 text-sm text-primary">
                <Phone className="w-3.5 h-3.5" /> +358 45 765 4321
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Sähköposti</p>
              <a href="mailto:info@puuhapatet.fi" className="text-sm text-primary">
                info@puuhapatet.fi
              </a>
            </div>
          </div>
        </div>
        <div className="mt-4 p-3 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
          <div className="flex gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-800 dark:text-yellow-300">
              Kiireellisissä tilanteissa (vahinko, asiakaskriisi) soita heti — älä lähetä viestiä.
            </p>
          </div>
        </div>
      </div>
    ),
  },
];

export default function AdminGuidePage() {
  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Opas</h1>
            <p className="text-sm text-muted-foreground">Puuhapatet · käyttöohjeet ja ehdot</p>
          </div>
        </div>

        <Card className="p-4 bg-primary/5 border-0 mb-6">
          <p className="text-sm text-foreground">
            Tässä oppaassa kaikki mitä tarvitset onnistuneeseen keikkaan.
            Avaa osio napauttamalla otsikkoa.
          </p>
        </Card>

        {sections.map((s) => (
          <Accordion key={s.id} section={s} />
        ))}
      </div>
    </div>
  );
}
