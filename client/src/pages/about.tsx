import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, MapPin, Mail, Phone } from "lucide-react";
import { SiWhatsapp, SiInstagram, SiLinkedin } from "react-icons/si";
import { useI18n } from "@/lib/i18n";

const founders = [
  {
    name: "Matias Pitkänen",
    age: 18,
    role: "Perustaja",
    photo: "/matias.jpg",
    initials: "MP",
    bio: "Olen 18 ja opiskelen Otaniemen lukiossa toista vuotta. Jalkapallo on vienyt minut pitkälle — olen pelannut kilpatasolla pitkään ja sali kuuluu arkeen. Urheilutausta on opettanut sen, mitä yrittäjyyskin vaatii: sitoutumista, pitkäjänteisyyttä ja halua kehittyä. Puuhapatet on minulle ensimmäinen askel isompaan, ja otan sen vakavasti.",
    linkedin: "https://linkedin.com/in/matias-pitkanen",
    phone: "+358400389999",
  },
  {
    name: "Joonatan Juuri",
    age: 17,
    role: "Perustaja",
    photo: "/joonatan.jpg",
    initials: "JJ",
    bio: "Olen 17 ja Otaniemen lukion toinen vuosi menossa. Taustani on kansainvälinen — olen opiskellut ja asunut ulkomailla, mikä on avannut silmät aika laajasti jo nuorena. Tennis on lajini, kilpaurheilu vie paljon aikaa ja sali täydentää viikon. Yrittäjyys tuntuu luontevalta, koska haluan tehdä asioita itse — ei vain opiskella niitä.",
    linkedin: "https://linkedin.com/in/joonatan-juuri",
    phone: "+358400389999",
  },
];

export default function AboutPage() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background pt-20 md:pt-24 pb-28">
      <div className="container mx-auto px-4 max-w-3xl">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {t("about.title")}
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("about.desc")}
          </p>
        </div>

        {/* Story */}
        <Card className="p-8 bg-card border-0 premium-shadow mb-8">
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>{t("about.story.1")}</p>
            <p>{t("about.story.2")}</p>
            <p>
              Puuhapatet sai alkunsa siitä, että meillä molemmilla oli jo kokemusta käytännön töistä oman perhepiirin kautta.
              Halusimme kanavoida sen johonkin oikeaan — harjoitella yrittämistä, kartuttaa kokemusta ja samalla rahoittaa isompia
              tulevaisuuden suunnitelmia. Perustimme Puuhapatetin vuonna 2026, vaikka suunnittelu alkoi jo hyvissä ajoin edellisvuonna.
              Opiskelemme molemmat täysillä koulun ohella, mutta rehellisesti sanottuna asiakkaiden tyytyväisyys ja yhdessä tekeminen
              on se, mikä todella motivoi. Mikään muu ei vedä vertoja.
            </p>
            <p>{t("about.story.3")}</p>
          </div>
        </Card>

        {/* Team */}
        <h2 className="text-2xl font-semibold text-foreground mb-6">
          {t("about.team.title")}
        </h2>
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          {founders.map((f) => (
            <Card key={f.name} className="p-6 bg-card border-0 premium-shadow flex flex-col gap-5">
              {/* Photo + name row */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 bg-muted">
                  <img
                    src={f.photo}
                    alt={f.name}
                    className="w-full h-full object-cover object-top"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.style.display = "none";
                      el.parentElement!.innerHTML = `<div class="w-full h-full flex items-center justify-center text-xl font-bold text-muted-foreground">${f.initials}</div>`;
                    }}
                  />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{f.name}</h3>
                  <p className="text-sm text-muted-foreground">{f.role} · {f.age} v · Otaniemen lukio</p>
                </div>
              </div>

              {/* Bio */}
              <p className="text-sm text-muted-foreground leading-relaxed">
                {f.bio}
              </p>

              {/* Links */}
              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <a
                  href={f.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                >
                  <Button variant="ghost" size="sm" className="gap-2 px-3 text-muted-foreground hover:text-foreground">
                    <SiLinkedin className="w-4 h-4" />
                    LinkedIn
                  </Button>
                </a>
                <a href={`tel:${f.phone}`} aria-label="Puhelin">
                  <Button variant="ghost" size="sm" className="gap-2 px-3 text-muted-foreground hover:text-foreground">
                    <Phone className="w-4 h-4" />
                    {f.phone}
                  </Button>
                </a>
              </div>
            </Card>
          ))}
        </div>

        {/* Contact */}
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
                <h3 className="font-medium text-foreground mb-1">Toiminta-alue</h3>
                <p className="text-muted-foreground text-sm">
                  Espoo: Westend, Haukilahti, Saunalahti, Suvisaaristo
                </p>
                <p className="text-muted-foreground text-sm">
                  Helsinki: Munkkiniemi, Munkkivuori, Lauttasaari, Kuusisaari
                </p>
                <p className="text-muted-foreground text-sm mt-1 italic">
                  Muut alueet sopimuksen mukaan — kysy vain.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground mb-1">{t("contact.email")}</h3>
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
              href="https://wa.me/358400389999"
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
