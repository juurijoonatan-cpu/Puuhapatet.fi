/**
 * Työntekijän opas — Puuhapatet
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronDown, ChevronUp, Phone, Mail, AlertTriangle, Star, ClipboardList, Euro, Users, Shield } from "lucide-react";
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
            <h1 className="text-2xl font-semibold text-foreground">Työntekijän opas</h1>
            <p className="text-sm text-muted-foreground">Puuhapatet · versio 1.0</p>
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
