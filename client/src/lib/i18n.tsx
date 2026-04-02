import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Language = "fi" | "en";

interface I18nContextType {
  lang: Language;
  toggleLang: () => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  fi: {
    "nav.home": "Etusivu",
    "nav.services": "Palvelut",
    "nav.faq": "UKK",
    "nav.about": "Meistä",
    
    "hero.pill": "Ikkunanpesu & lasipinnat",
    "hero.title": "Ammattitaitoista ikkunanpesua",
    "hero.titleAccent": "sinun tarpeisiisi",
    "hero.subtitle": "Tilaa laadukas ikkunanpesu helposti. Sisä- ja ulkopinnat, parvekelasit ja lasipinnat. Siisti työnjälki, selkeä hinnoittelu.",
    "hero.cta": "Pyydä yhteydenotto",
    "hero.ctaSecondary": "Palvelut",
    "hero.tagline": "Ei säätöä – Puuhapatet hoitaa.",
    
    "typewriter.1": "Kirkkaat ikkunat, ilman säätöä.",
    "typewriter.2": "Sisältä ja ulkoa. Siististi. Ajallaan.",
    "typewriter.3": "Talvellakin: Talvikiilto™.",
    
    "trust.1.title": "Ammattitaitoinen työnjälki",
    "trust.1.desc": "Kokeneet tekijät, siisti lopputulos, ei raitoja.",
    "trust.2.title": "Joustava aikataulu",
    "trust.2.desc": "Sovitaan aika helposti. Nopea vaste.",
    "trust.3.title": "Luotettava kumppani",
    "trust.3.desc": "Selkeä toimintatapa. Asiakas tietää, mitä saa.",
    
    "talvikiilto.title": "Talvikiilto™",
    "talvikiilto.subtitle": "Talvikauden ikkunahuolto",
    "talvikiilto.desc": "Talvikiilto™ yhdistää sisäpuolen täyspesun ja ulkopintojen kuivapuhdistuksen ilman jäätymisriskiä. Ikkunat, jotka eivät tunne vuodenaikoja.",
    "talvikiilto.cta": "Lue lisää",
    
    "contact.whatsapp": "WhatsApp",
    "contact.instagram": "Instagram",
    "contact.email": "Sähköposti",
    
    "services.title": "Palvelut",
    "services.subtitle": "Mitä tarjoamme",
    "services.promise": "Jokaisessa palvelussamme toimimme vakuutuksen alaisena ja täysin lainmukaisesti. Asiakkaan etu on meille ykkösprioriteetti — ei nopeus eikä raha. Jos työ kestää kauemmin kuin arvioitu, teemme sen silti huolellisesti loppuun. Siitä ei lisälaskuteta.",

    "service.gardening.title": "Piha & puutarhapalvelut",
    "service.gardening.desc": "Nurmikosta puihin — pidetään pihasi kunnossa.",
    "service.gardening.1": "Nurmikon leikkuu",
    "service.gardening.2": "Pensaiden ja puiden kevyt leikkaus",
    "service.gardening.3": "Piha-alueen siistiminen ja haravointi",
    "service.gardening.4": "Kausihuolto sopimuksen mukaan",

    "service.painting.title": "Maalaus",
    "service.painting.desc": "Kevyet maalausurakat – karmit, listat, parvekkeet ja pienet sisätyöt.",
    "service.painting.1": "Ikkunankarmit ja ovienkarmit",
    "service.painting.2": "Listat, parvekkeet ja pienet puuosat",
    "service.painting.3": "Pienet sisäseinätyöt",
    "service.painting.4": "Pyydä tarjous – arvioidaan yhdessä",

    "service.lumityot.title": "Lumityöt",
    "service.lumityot.desc": "Piha- ja kulkuväylät auki koko talven.",
    "service.lumityot.1": "Auraus ja luonti pihasta ja kulkuväyliltä",
    "service.lumityot.2": "Hiekoitus liukkauden torjuntaan",
    "service.lumityot.3": "Kausihuolto sopimuksella tai tarvittaessa",

    "featured.title": "Ajankohtaiset palvelut",
    "featured.cta": "Katso kaikki palvelut",
    
    "service.basic.title": "Perusikkunanpesu",
    "service.basic.1": "Sisä- ja ulkopinnat",
    "service.basic.2": "Parvekelasit",
    "service.basic.3": "Puitteet/karmit kevyt pyyhintä",
    
    "service.talvikiilto.title": "Talvikiilto™",
    "service.talvikiilto.desc": "Sisäpuolen täyspesu + ulkopintojen kuivapuhdistus, ei jäätymisriskiä",
    "service.talvikiilto.why": "Puhtaat näkymät myös pakkaskaudella",
    "service.talvikiilto.1": "Sisäpuoli: lämminvesipesu, lasta, mikrokuitu",
    "service.talvikiilto.2": "Ulkopuoli: kuiva/kevyesti kostutettu mikrokuitu, poistaa pölyn ja sään jäljet",
    "service.talvikiilto.3": "Lisä: parvekelasit sisäpinnat, peilit, muut sisätilojen lasit",
    
    "service.cardetailing.title": "Sisäfreesaus",
    "service.cardetailing.partner": "Puuhapatet × KJ Cardetailing",
    "service.cardetailing.price": "40 € / auto",
    "service.cardetailing.desc": "Kevyt ja vaivaton auton sisäpuhdistus. 20–30 min, kuivapesu – ei kosteutta sisätiloihin.",
    "service.cardetailing.1": "Imurointi",
    "service.cardetailing.2": "Kojelaudan ja pintojen puhdistus",
    "service.cardetailing.3": "Ovien sisäpinnat",
    "service.cardetailing.4": "Keskikonsoli",
    "service.cardetailing.5": "Auton sisäikkunoiden kevyt putsaus",

    "service.special.title": "Erikoistyöt",
    "service.special.desc": "Taloyhtiöiden ja liikehuoneistojen ikkunanpesu sopimuksen mukaan.",
    "service.special.1": "Taloyhtiöt, kerrostalot ja liiketilat",
    "service.special.2": "Varusteet 10 m korkuisiin kohteisiin asti",
    "service.special.3": "Turvavarusteet ja -käytännöt aina käytössä",
    "service.special.cta": "Ota yhteyttä – sovitaan kokonaisuus",
    
    "packages.title": "Paketit",
    "packages.coming": "Tulossa",
    "packages.note": "Pyydä yhteydenotto, sovitaan paras kokonaisuus.",
    "package.single.title": "Kertakäynti",
    "package.single.desc": "Selkeä käynti sovitulle kokonaisuudelle.",
    "package.recurring.title": "Toistuva huolto",
    "package.recurring.desc": "Säännöllinen pesu, pysyvä kirkkaus.",
    "package.kiilto.title": "3x Kiilto-setti",
    "package.kiilto.desc": "Säästä merkittävästi ensimmäisestä käynnistä ja lukitse huoltoaikataulu.",
    
    "faq.title": "Usein kysytyt kysymykset",
    "faq.q1": "Missä alueilla palvelette?",
    "faq.a1": "Espoon länsialueet, erityisesti Westend, Haukilahti, Saunalahti ja Suvisaaristo. Tarvittaessa sovitaan erikseen.",
    "faq.q2": "Mitä ikkunanpesuun kuuluu?",
    "faq.a2": "Sisä- ja ulkopinnat sovitun mukaan, parvekelasit ja lasipinnat. Tavoite on siisti, raitaton lopputulos.",
    "faq.q3": "Miten hinta määräytyy?",
    "faq.a3": "Selkeä kokonaisuus kohteen koon ja ikkunoiden määrän mukaan. Sovitaan etukäteen tai arvioidaan nopeasti paikan päällä.",
    "faq.q4": "Miten valmistaudun käyntiin?",
    "faq.a4": "Vapauta ikkunalaudat, siirrä herkät esineet ja varmista kulku ikkunoille.",
    "faq.q5": "Miten maksu toimii?",
    "faq.a5": "MobilePay for Business. Kuitti automaattisesti, kotitalousvähennys hyödynnettävissä.",
    "faq.q6": "Peseekö Puuhapatet talvella?",
    "faq.a6": "Kyllä. Talvella suosittelemme Talvikiilto™-huoltopuhdistusta.",
    "faq.q7": "Kuinka nopeasti vastaatte?",
    "faq.a7": "Tyypillisesti saman päivän aikana, viimeistään seuraavana.",
    "faq.q8": "Teettekö liikehuoneistot?",
    "faq.a8": "Kyllä sopimuksen mukaan.",
    
    "about.title": "Keitä olemme",
    "about.desc": "Espoolainen palveluyritys, nuori ja ammattimainen. Selkeä toimintatapa ja viimeistelty työnjälki.",
    "about.story.1": "Puuhapatet on espoolainen palveluyritys, joka tarjoaa laadukasta ikkunanpesua ja lasipintojen huoltoa.",
    "about.story.2": "Toimintamme perustuu selkeään palvelulupaukseen: ammattitaitoinen työ, sovittu aikataulu, siisti lopputulos.",
    "about.story.3": "Palvelemme erityisesti Espoon länsialueita: Westend, Haukilahti, Saunalahti ja Suvisaaristo.",
    "about.team.title": "Työntekijämme",
    "about.team.coming": "Esittelemme tekijät ja referenssit pian.",
    "about.contact.title": "Yhteystiedot",
    
    "form.title": "Pyydä yhteydenotto",
    "form.subtitle": "Täytä tiedot ja otamme sinuun yhteyttä",
    "form.name": "Nimi",
    "form.phone": "Puhelin",
    "form.email": "Sähköposti",
    "form.address": "Osoite / alue",
    "form.addressHint": "Kaupunginosa tai postinumero riittää",
    "form.estimate": "Onko sinulla jo alustava näkemys?",
    "form.estimateHint": "Tämä ei sido mihinkään. Sovimme kokonaisuuden yhteydenoton jälkeen.",
    "form.estimate.none": "En vielä",
    "form.estimate.single": "Kertakäynti (arvio)",
    "form.estimate.recurring": "Toistuva huolto (arvio)",
    "form.estimate.talvikiilto": "Talvikiilto™ (arvio)",
    "form.estimate.kiilto": "3x Kiilto-setti (tulossa)",
    "form.needs": "Mitä tarvitset?",
    "form.needs.inside": "Ikkunat (sisä)",
    "form.needs.outside": "Ikkunat (ulko)",
    "form.needs.balcony": "Parvekelasit",
    "form.needs.glass": "Lasipinnat/peilit",
    "form.needs.talvikiilto": "Talvikiilto™",
    "form.needs.special": "Erikoistyö / liikehuoneisto",
    "form.time": "Aikatoive",
    "form.time.asap": "Mahdollisimman pian",
    "form.time.thisWeek": "Tällä viikolla",
    "form.time.nextWeek": "Ensi viikolla",
    "form.time.later": "Sovitaan erikseen",
    "form.notes": "Lisätiedot",
    "form.submit": "Lähetä pyyntö",
    "form.submitting": "Lähetetään...",
    
    "success.title": "Kiitos yhteydenotostasi!",
    "success.subtitle": "Olemme vastaanottaneet pyyntösi ja otamme sinuun yhteyttä pian.",
    "success.id.label": "Puuha-ID",
    "success.id.hint": "Säästä tämä koodi. Tarvitset sitä, jos palaat asiaan tai kun yhdistämme pyynnön käsittelyyn.",
    "success.copied": "Kopioitu!",
    "success.home": "Palaa etusivulle",
    "success.new": "Tee uusi pyyntö",
    
    "footer.rights": "Kaikki oikeudet pidätetään.",
    "footer.admin": "Ylläpito",
    
    "reviews.title": "Mitä asiakkaamme sanovat",
    "reviews.subtitle": "Asiakaskokemuksia",
    "reviews.stats.recommend": "asiakkaistamme suosittelee meitä",
    "reviews.stats.google": "Google-arvio",
    "reviews.stats.total": "arvostelua",
    "reviews.google.badge": "Google-arvostelut",
    "reviews.google.prompt": "Oletko tyytyväinen palveluumme? Arvostelusi auttaa muita löytämään meidät.",
    "reviews.google.cta": "Jätä arvostelu Googleen",
  },
  en: {
    "nav.home": "Home",
    "nav.services": "Services",
    "nav.faq": "FAQ",
    "nav.about": "About Us",
    
    "hero.pill": "Window Cleaning & Glass Surfaces",
    "hero.title": "Professional window cleaning",
    "hero.titleAccent": "for your needs",
    "hero.subtitle": "Order quality window cleaning easily. Interior and exterior, balcony glass and glass surfaces. Clean results, clear pricing.",
    "hero.cta": "Request Contact",
    "hero.ctaSecondary": "Services",
    "hero.tagline": "No hassle – Puuhapatet handles it.",
    
    "typewriter.1": "Crystal-clear windows, no hassle.",
    "typewriter.2": "Inside and out. Clean. On time.",
    "typewriter.3": "Even in winter: Talvikiilto™.",
    
    "trust.1.title": "Professional Results",
    "trust.1.desc": "Experienced team, clean finish, no streaks.",
    "trust.2.title": "Flexible Scheduling",
    "trust.2.desc": "Easy to arrange times. Quick response.",
    "trust.3.title": "Reliable Partner",
    "trust.3.desc": "Clear process. Customer knows what to expect.",
    
    "talvikiilto.title": "Talvikiilto™",
    "talvikiilto.subtitle": "Winter Window Care",
    "talvikiilto.desc": "Talvikiilto™ combines interior full wash with exterior dry cleaning without freezing risk. Windows that don't know seasons.",
    "talvikiilto.cta": "Learn more",
    
    "contact.whatsapp": "WhatsApp",
    "contact.instagram": "Instagram",
    "contact.email": "Email",
    
    "services.title": "Services",
    "services.subtitle": "What we offer",
    "services.promise": "All our services are covered by insurance and fully comply with Finnish law. The customer's interest comes first — not speed, not money. If a job takes longer than estimated, we finish it properly anyway. No extra charge for that.",

    "service.gardening.title": "Yard & Garden Services",
    "service.gardening.desc": "From lawns to trees — we keep your yard in shape.",
    "service.gardening.1": "Lawn mowing",
    "service.gardening.2": "Light trimming of shrubs and trees",
    "service.gardening.3": "Yard tidying and raking",
    "service.gardening.4": "Seasonal maintenance by agreement",

    "service.painting.title": "Painting",
    "service.painting.desc": "Light painting jobs – frames, trim, balconies and small interior work.",
    "service.painting.1": "Window frames and door frames",
    "service.painting.2": "Trim, balconies and small wooden parts",
    "service.painting.3": "Small interior wall jobs",
    "service.painting.4": "Request a quote – we'll assess together",

    "service.lumityot.title": "Snow Removal",
    "service.lumityot.desc": "Yard and pathways clear all winter.",
    "service.lumityot.1": "Plowing and shoveling yards and walkways",
    "service.lumityot.2": "Sanding for ice prevention",
    "service.lumityot.3": "Seasonal contract or on-demand",

    "featured.title": "Current Services",
    "featured.cta": "See all services",
    
    "service.basic.title": "Basic Window Cleaning",
    "service.basic.1": "Interior and exterior surfaces",
    "service.basic.2": "Balcony glass",
    "service.basic.3": "Light frame wiping",
    
    "service.talvikiilto.title": "Talvikiilto™",
    "service.talvikiilto.desc": "Interior full wash + exterior dry cleaning, no freezing risk",
    "service.talvikiilto.why": "Clear views even in freezing weather",
    "service.talvikiilto.1": "Interior: warm water wash, squeegee, microfiber",
    "service.talvikiilto.2": "Exterior: dry/lightly dampened microfiber, removes dust and weather marks",
    "service.talvikiilto.3": "Extra: balcony glass interiors, mirrors, other indoor glass",
    
    "service.cardetailing.title": "Interior Detailing",
    "service.cardetailing.partner": "Puuhapatet × KJ Cardetailing",
    "service.cardetailing.price": "40 € / car",
    "service.cardetailing.desc": "Light and effortless car interior cleaning. 20–30 min, dry clean – no moisture inside.",
    "service.cardetailing.1": "Vacuuming",
    "service.cardetailing.2": "Dashboard and surface cleaning",
    "service.cardetailing.3": "Door interior panels",
    "service.cardetailing.4": "Center console",
    "service.cardetailing.5": "Light cleaning of interior windows",

    "service.special.title": "Special Services",
    "service.special.desc": "Window cleaning for housing companies and commercial premises by agreement.",
    "service.special.1": "Housing companies, apartment buildings and commercial spaces",
    "service.special.2": "Equipment for targets up to 10 m height",
    "service.special.3": "Safety equipment and practices always in use",
    "service.special.cta": "Contact us – let's arrange the scope",
    
    "packages.title": "Packages",
    "packages.coming": "Coming soon",
    "packages.note": "Request contact, we'll arrange the best solution.",
    "package.single.title": "Single Visit",
    "package.single.desc": "Clear visit for agreed scope.",
    "package.recurring.title": "Recurring Service",
    "package.recurring.desc": "Regular cleaning, lasting clarity.",
    "package.kiilto.title": "3x Kiilto Set",
    "package.kiilto.desc": "Save significantly from the first visit and lock in your service schedule.",
    
    "faq.title": "Frequently Asked Questions",
    "faq.q1": "Which areas do you serve?",
    "faq.a1": "Western Espoo areas, especially Westend, Haukilahti, Saunalahti and Suvisaaristo. Other areas by arrangement.",
    "faq.q2": "What does window cleaning include?",
    "faq.a2": "Interior and exterior surfaces as agreed, balcony glass and glass surfaces. Goal is a clean, streak-free result.",
    "faq.q3": "How is pricing determined?",
    "faq.a3": "Clear package based on property size and number of windows. Agreed in advance or quickly assessed on-site.",
    "faq.q4": "How do I prepare for the visit?",
    "faq.a4": "Clear windowsills, move delicate items and ensure access to windows.",
    "faq.q5": "How does payment work?",
    "faq.a5": "MobilePay for Business. Receipt automatically, household deduction applicable.",
    "faq.q6": "Does Puuhapatet clean windows in winter?",
    "faq.a6": "Yes. In winter we recommend Talvikiilto™ maintenance cleaning.",
    "faq.q7": "How quickly do you respond?",
    "faq.a7": "Typically same day, next day at latest.",
    "faq.q8": "Do you service commercial premises?",
    "faq.a8": "Yes, by agreement.",
    
    "about.title": "Who We Are",
    "about.desc": "An Espoo-based service company, young and professional. Clear approach and polished results.",
    "about.story.1": "Puuhapatet is an Espoo-based service company offering quality window cleaning and glass surface maintenance.",
    "about.story.2": "Our operation is based on a clear service promise: professional work, agreed schedule, clean results.",
    "about.story.3": "We serve especially Western Espoo: Westend, Haukilahti, Saunalahti and Suvisaaristo.",
    "about.team.title": "Our Team",
    "about.team.coming": "We'll introduce our team and references soon.",
    "about.contact.title": "Contact",
    
    "form.title": "Request Contact",
    "form.subtitle": "Fill in your details and we'll get in touch",
    "form.name": "Name",
    "form.phone": "Phone",
    "form.email": "Email",
    "form.address": "Address / Area",
    "form.addressHint": "District or postal code is enough",
    "form.estimate": "Do you have an initial preference?",
    "form.estimateHint": "This is not binding. We'll agree on the details after contact.",
    "form.estimate.none": "Not yet",
    "form.estimate.single": "Single visit (estimate)",
    "form.estimate.recurring": "Recurring service (estimate)",
    "form.estimate.talvikiilto": "Talvikiilto™ (estimate)",
    "form.estimate.kiilto": "3x Kiilto set (coming soon)",
    "form.needs": "What do you need?",
    "form.needs.inside": "Windows (interior)",
    "form.needs.outside": "Windows (exterior)",
    "form.needs.balcony": "Balcony glass",
    "form.needs.glass": "Glass surfaces/mirrors",
    "form.needs.talvikiilto": "Talvikiilto™",
    "form.needs.special": "Special / commercial",
    "form.time": "Preferred time",
    "form.time.asap": "As soon as possible",
    "form.time.thisWeek": "This week",
    "form.time.nextWeek": "Next week",
    "form.time.later": "To be agreed",
    "form.notes": "Additional info",
    "form.submit": "Send Request",
    "form.submitting": "Sending...",
    
    "success.title": "Thank you for your request!",
    "success.subtitle": "We've received your request and will contact you soon.",
    "success.id.label": "Puuha-ID",
    "success.id.hint": "Save this code. You'll need it if you follow up or when we process your request.",
    "success.copied": "Copied!",
    "success.home": "Back to home",
    "success.new": "New request",
    
    "footer.rights": "All rights reserved.",
    "footer.admin": "Admin",
    
    "reviews.title": "What Our Clients Say",
    "reviews.subtitle": "Customer experiences",
    "reviews.stats.recommend": "of customers recommend us",
    "reviews.stats.google": "Google rating",
    "reviews.stats.total": "reviews",
    "reviews.google.badge": "Google Reviews",
    "reviews.google.prompt": "Happy with our service? Your review helps others find us.",
    "reviews.google.cta": "Leave a Review on Google",
  },
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("puuhapatet-lang");
      if (stored === "en" || stored === "fi") return stored;
    }
    return "fi";
  });

  useEffect(() => {
    localStorage.setItem("puuhapatet-lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const toggleLang = () => {
    setLang((prev) => (prev === "fi" ? "en" : "fi"));
  };

  const t = (key: string): string => {
    return translations[lang][key] || key;
  };

  return (
    <I18nContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
