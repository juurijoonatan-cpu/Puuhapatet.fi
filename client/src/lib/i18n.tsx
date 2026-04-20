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
    "nav.calculator": "Laskuri",
    
    "hero.pill": "Kevät on täällä!",
    "hero.title": "Ammattitaitoista ikkunanpesua",
    "hero.titleAccent": "sinun tarpeisiisi!",
    "hero.subtitle": "Kaksi reipasta nuorta yrittäjää Espoon Otaniemestä — täydellä sydämellä töissä. Ikkunanpesu, pihatyöt ja käytännön kotitalouspalvelut oikeasti hyvin tehtyinä positiivisella ja intohimoisella asenteella! Ole rohkeasti yhteydessä!",
    "hero.cta": "Pyydä yhteydenotto",
    "hero.ctaSecondary": "Palvelut",
    "hero.tagline": "Ei säätöä. Puuhapatet hoitaa.",
    
    "typewriter.1": "Kirkkaat ikkunat, ilman säätöä.",
    "typewriter.2": "Sisältä ja ulkoa. Siististi. Ajallaan.",
    "typewriter.3": "Talvellakin: Talvikiilto™.",
    
    "trust.1.title": "Huolellinen ja viimeistelty jälki.",
    "trust.1.desc": "Kunnolliset työvälineet yhdistettynä aitoon panostukseen ja tekijöiden tarkkaan työsilmään jättävät siistin lopputuloksen, niin sisältä kuin ulkoa!",
    "trust.2.title": "Joustava aikataulu.",
    "trust.2.desc": "Sovitaan yhdessä sinulle sopiva aika! Laita ihmeessä viestiä tulemaan, vastaamme saman päivän aikana. Nopein tapa: WhatsApp.",
    "trust.3.title": "Selkeä hinta.",
    "trust.3.desc": "Hinta sovitaan ennen työn aloittamista. Ei yllätyslaskuja, ei epäselvyyksiä!",
    
    "talvikiilto.title": "Talvikiilto™",
    "talvikiilto.subtitle": "Talvikauden ikkunahuolto",
    "talvikiilto.desc": "Talvikiilto™ yhdistää sisäpuolen täyspesun ja ulkopintojen kuivapuhdistuksen ilman jäätymisriskiä. Ikkunat, jotka eivät tunne vuodenaikoja.",
    "talvikiilto.cta": "Lue lisää",
    
    "contact.whatsapp": "WhatsApp",
    "contact.instagram": "Instagram",
    "contact.email": "Sähköposti",
    
    "services.title": "Palvelut",
    "services.subtitle": "Mitä tarjoamme",
    "services.promise": "Jokainen työmme tehdään vastuuvakuutuksen alaisena ja lainmukaisesti. Meille tärkeintä on se, että asiakas on oikeasti tyytyväinen — ei se, kuinka nopeasti saamme työn alta pois. Jos homma ottaa kauemmin kuin arvioitu, teemme sen silti kunnolla loppuun. Siitä ei tule lisälaskua. Hinta sovitaan aina etukäteen — ei yllätyksiä.",

    "service.gardening.title": "Piha & puutarhapalvelut",
    "service.gardening.desc": "Pidetään pihasi kunnossa nurmikoista puihin!",
    "service.gardening.1": "Nurmikon leikkuu",
    "service.gardening.2": "Pensaiden ja puiden kevyt siistiminen asiakkaan toiveiden ja ohjeiden mukaisesti",
    "service.gardening.3": "Piha-alueen siistiminen ja haravointi",
    "service.gardening.4": "Kausihuolto sopimuksen mukaan",

    "service.painting.title": "Maalaus",
    "service.painting.desc": "Kevyet maalausurakat – mm. karmit, listat, terassit ja aidat.",
    "service.painting.1": "Ikkunoiden ja ovien karmit",
    "service.painting.2": "Listat ja kaiteet",
    "service.painting.3": "Aidat ja terassit",
    "service.painting.4": "Pyydä tarjous – arvioidaan yhdessä",

    "service.lumityot.title": "Lumityöt",
    "service.lumityot.desc": "Piha- ja kulkuväylät auki koko talven.",
    "service.lumityot.1": "Auraus ja luonti pihasta ja kulkuväyliltä",
    "service.lumityot.2": "Hiekoitus liukkauden torjuntaan",
    "service.lumityot.3": "Kausihuolto sopimuksella tai tarvittaessa",

    "featured.title": "Ajankohtaiset palvelut",
    "featured.cta": "Katso kaikki palvelut",
    
    "service.basic.title": "Ikkunanpesu",
    "service.basic.popular": "Suosittu",
    "service.basic.desc": "Käytämme ammattilaisten välineitä ja hyväksi havaittuja pesuaineita. Ikkunat, parvekelasit ja lasiterassit pestyinä — kirkkaina ja raidattomina.",
    "service.basic.1": "Talon ikkunat sisältä ja ulkoa",
    "service.basic.2": "Parvekelasit ja lasiterassit",
    "service.basic.3": "Puitteet ja karmit kevyt pyyhintä",
    
    "service.talvikiilto.title": "Talvikiilto™",
    "service.talvikiilto.desc": "Sisäpuolen täyspesu sekä ulkopintojen kuivapuhdistus ilman jäätymisriskiä. Näkymä kirkastuu vaikka pakkasta olisi.",
    "service.talvikiilto.why": "Puhtaat näkymät myös pakkaskaudella",
    "service.talvikiilto.1": "Sisäpuoli: lämminvesipesu, lasta ja mikrokuitu",
    "service.talvikiilto.2": "Ulkopuoli: kuivalla tai kevyesti kostutetulla mikrokuidulla, pöly ja sään jäljet lähtevät",
    "service.talvikiilto.3": "Lisä: parvekelasit sisäpinnat ja lasiterassit",
    
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
    "faq.q1": "Missä alueilla toimitte?",
    "faq.a1": "Toimimme Espoon ja Helsingin alueella. Ydinaluettamme on Etelä-Espoo: mm. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola ja Westend. Muut alueet onnistuvat myös, kysy rohkeasti!",
    "faq.q2": "Mitä ikkunanpesuun kuuluu?",
    "faq.a2": "Pesemme ikkunat sisältä ja ulkoa sovitun mukaan, parvekelasit ja lasiterassit mukaan lukien. Tavoitteena on aina siisti, raidaton jälki.",
    "faq.q3": "Mistä hinta muodostuu?",
    "faq.a3": "Hinta sovitaan etukäteen kohteen koon ja ikkunoiden määrän perusteella. Ei yllätyksiä — tiedät hinnan ennen kuin aloitamme. Voit myös kokeilla sivuiltamme löytyvää laskuria suuntaa-antavaan arvioon.",
    "faq.q4": "Miten valmistaudun käyntiin?",
    "faq.a4": "Tyhjennä ikkunalaudat ja varmista vapaa kulku ikkunoille. Muuta ei tarvita.",
    "faq.q5": "Miten maksu onnistuu?",
    "faq.a5": "Hyväksymme MobilePayn, tilisiirron ja käteisen. Lasku tulee aina sinulle, joten kaikki on dokumentoitua.",
    "faq.q6": "Peseekö Puuhapatet talvella?",
    "faq.a6": "Kyllä. Talvella suosittelemme Talvikiilto-huoltopuhdistusta, joka on suunniteltu nimenomaan pakkassäähän.",
    "faq.q7": "Kuinka nopeasti vastaatte yhteydenottoihin?",
    "faq.a7": "Pyrimme vastaamaan saman päivän aikana. Nopein tapa tavoittaa meidät on WhatsApp — siellä olemme yleensä todella nopeasti. Viimeistään seuraavana arkipäivänä.",
    "faq.q8": "Teettekö töitä taloyhtiöille tai liiketiloihin?",
    "faq.a8": "Kyllä. Teemme ikkunanpesua taloyhtiöille, kerrostaloihin ja liiketiloihin sopimuksen mukaan. Meillä on varusteet jopa 10 metrin korkuisiin kohteisiin.",
    "faq.q9": "Onko työnne vakuutettua ja riskitöntä tilaajalle?",
    "faq.a9": "Toimimme vastuuvakuutuksen alaisena ja kaikki työmme on lainmukaista. Työskentelemme aina huolellisesti ja turvallisuus edellä. Jos työn aikana syntyy vahinkoa, meillä on vakuutusturva sen varalle — ja käsittelemme mahdolliset tilanteet aina asiallisesti yhdessä.",
    "faq.q10": "Onko palvelunne kotitalousvähennyskelpoinen?",
    "faq.a10": "Kyllä. Esimerkiksi ikkunanpesu on kotitalousvähennyskelpoinen palvelu. Lasku tulee aina sinulle, joten vähennyksen hakeminen verotuksessa on suoraviivaista.",
    
    "about.title": "Keitä olemme?",
    "about.desc": "Kaksi otaniemeläistä yrittäjää, jotka tekevät hommansa tosissaan.",
    "about.story.1": "Puuhapatet on espoolainen palveluyritys, jonka takana on kaksi lukiolaista — Joonatan ja Matias. Teemme ikkunanpesua, pihatöitä ja muita käytännön kotitalouspalveluja.",
    "about.story.2": "Yrittäjyys ei meille tarkoita sivubisnestä tai kesätöitä. Haluamme rakentaa jotain oikeaa — ja se näkyy tavassa, jolla teemme töitä. Työ tehdään kunnolla, sovittuun aikaan ja siististi. Ei yllätys-laskuja.",
    "about.story.3": "Toimimme Espoon ja Helsingin alueella. Ydinaluettamme on Etelä-Espoo: mm. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola ja Westend. Muut alueet onnistuvat myös, kysy rohkeasti!",
    "about.team.title": "Tekijät",
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
    "form.needs.glass": "Lasiterassi / ulkolasipinnat",
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
    "nav.calculator": "Calculator",
    
    "hero.pill": "Professional Window Cleaning",
    "hero.title": "Professional window cleaning",
    "hero.titleAccent": "for your needs!",
    "hero.subtitle": "Two young entrepreneurs from Otaniemi, Espoo — putting real effort in. Window cleaning, yard work and home services done properly. Streak-free finish, price agreed before we start.",
    "hero.cta": "Request Contact",
    "hero.ctaSecondary": "Services",
    "hero.tagline": "No hassle. Puuhapatet handles it.",
    
    "typewriter.1": "Crystal-clear windows, no hassle.",
    "typewriter.2": "Inside and out. Clean. On time.",
    "typewriter.3": "Even in winter: Talvikiilto™.",
    
    "trust.1.title": "Careful and polished results.",
    "trust.1.desc": "Proper tools combined with genuine effort and a sharp eye for detail leave a clean result — inside and out!",
    "trust.2.title": "Flexible Scheduling.",
    "trust.2.desc": "We'll find a time that works for you! Drop us a message — we respond the same day. Fastest via WhatsApp.",
    "trust.3.title": "Clear Pricing.",
    "trust.3.desc": "Price agreed before work starts. No surprise invoices, no confusion!",
    
    "talvikiilto.title": "Talvikiilto™",
    "talvikiilto.subtitle": "Winter Window Care",
    "talvikiilto.desc": "Talvikiilto™ combines interior full wash with exterior dry cleaning without freezing risk. Windows that don't know seasons.",
    "talvikiilto.cta": "Learn more",
    
    "contact.whatsapp": "WhatsApp",
    "contact.instagram": "Instagram",
    "contact.email": "Email",
    
    "services.title": "Services",
    "services.subtitle": "What we offer",
    "services.promise": "Every job we do is covered by liability insurance and fully compliant with Finnish law. What matters most to us is that the customer is genuinely happy — not how quickly we can move on. If a job takes longer than expected, we finish it properly regardless. No extra charge. Price is always agreed in advance — no surprises.",

    "service.gardening.title": "Yard & Garden Services",
    "service.gardening.desc": "Keeping your yard in shape — from lawns to trees!",
    "service.gardening.1": "Lawn mowing",
    "service.gardening.2": "Light tidying of shrubs and trees according to the customer's wishes and instructions",
    "service.gardening.3": "Yard tidying and raking",
    "service.gardening.4": "Seasonal maintenance by agreement",

    "service.painting.title": "Painting",
    "service.painting.desc": "Light painting jobs – e.g. frames, trim, terraces and fences.",
    "service.painting.1": "Window and door frames",
    "service.painting.2": "Trim and railings",
    "service.painting.3": "Fences and terraces",
    "service.painting.4": "Request a quote – we'll assess together",

    "service.lumityot.title": "Snow Removal",
    "service.lumityot.desc": "Yard and pathways clear all winter.",
    "service.lumityot.1": "Plowing and shoveling yards and walkways",
    "service.lumityot.2": "Sanding for ice prevention",
    "service.lumityot.3": "Seasonal contract or on-demand",

    "featured.title": "Current Services",
    "featured.cta": "See all services",
    
    "service.basic.title": "Window Cleaning",
    "service.basic.popular": "Popular",
    "service.basic.desc": "Professional equipment and proven cleaning products. The result is a clear, streak-free surface — windows, balcony glass and glass terraces.",
    "service.basic.1": "House windows interior and exterior",
    "service.basic.2": "Balcony glass and glass terraces",
    "service.basic.3": "Light wipe of frames",
    
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
    "faq.q1": "Which areas do you cover?",
    "faq.a1": "We operate in the Espoo and Helsinki area. Our core area is South Espoo: e.g. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola and Westend. Other areas work too — just ask!",
    "faq.q2": "What does window cleaning include?",
    "faq.a2": "We clean windows inside and out as agreed, including balcony glass and glass terraces. The goal is always a clean, streak-free finish.",
    "faq.q3": "How is pricing determined?",
    "faq.a3": "Pricing is agreed in advance based on property size and number of windows. No surprises — you know the price before we start.",
    "faq.q4": "How do I prepare for the visit?",
    "faq.a4": "Clear the windowsills and make sure there's free access to the windows. That's all.",
    "faq.q5": "How does payment work?",
    "faq.a5": "We accept MobilePay, bank transfer and cash. You always receive an invoice, so everything is documented.",
    "faq.q6": "Do you clean windows in winter?",
    "faq.a6": "Yes. In winter we recommend our Talvikiilto service, which is designed specifically for cold weather.",
    "faq.q7": "How quickly do you respond?",
    "faq.a7": "We aim to respond the same day. The fastest way to reach us is WhatsApp — we're usually very quick there. Latest the next working day.",
    "faq.q8": "Do you work for housing companies or commercial spaces?",
    "faq.a8": "Yes. We clean windows for housing companies, apartment buildings and commercial premises by agreement. We have equipment for targets up to 10 metres high.",
    "faq.q9": "Is your work insured and risk-free for the customer?",
    "faq.a9": "We operate under liability insurance and everything we do is legally compliant. We always work carefully and with safety first. If damage occurs during a job, we have insurance cover for that — and we handle any situations professionally together.",
    "faq.q10": "Is your service eligible for the Finnish household tax deduction?",
    "faq.a10": "Yes. Services like window cleaning qualify for the kotitalousvähennys household deduction. You always receive an invoice from us, which makes claiming the deduction straightforward.",
    
    "about.title": "Who We Are",
    "about.desc": "Two students from Otaniemi who take their work seriously.",
    "about.story.1": "Puuhapatet is an Espoo-based service company run by two secondary school students — Joonatan and Matias. We do window cleaning, yard work and other practical household services.",
    "about.story.2": "For us, entrepreneurship isn't a side project or a summer job. We want to build something real — and that shows in how we work. Everything gets done properly, on time and cleanly. No surprise invoices.",
    "about.story.3": "We operate in the Espoo and Helsinki area. Our core area is South Espoo: e.g. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola and Westend. Other areas work too — just ask!",
    "about.team.title": "The Team",
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
    "form.needs.glass": "Glass terrace / exterior glass",
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
