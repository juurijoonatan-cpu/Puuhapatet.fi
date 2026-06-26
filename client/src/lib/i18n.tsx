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
    "hero.subtitle": "Kotitalouspalvelut, jotka oikeasti tehdään hyvin. Ikkunanpesu, pihatyöt ja paljon muuta — pääkaupunkiseudulla.",
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

    "trust.assessment": "Ilmainen kartoituskäynti",
    "trust.deduction": "Kotitalousvähennys −35 %",
    "trust.guarantee": "Tyytyväisyystakuu",

    "trustband.title": "Miksi Puuhapatet?",
    "trustband.assessment.title": "Ilmainen kartoituskäynti",
    "trustband.assessment.desc": "Tulemme katsomaan kohteen veloituksetta ja annamme tarkan hinnan. Et sido itseäsi mihinkään.",
    "trustband.deduction.title": "Kotitalousvähennys",
    "trustband.deduction.desc": "Ikkunanpesu ja pihatyöt ovat kotitalousvähennyskelpoisia — säästät jopa 35 % työn osuudesta. Lasku tulee aina sinulle.",
    "trustband.guarantee.title": "Tyytyväisyystakuu",
    "trustband.guarantee.desc": "Jos jokin jäi vaivaamaan, korjaamme sen veloituksetta. Tärkeintä on, että jälki on kunnossa.",

    "services.title": "Palvelut",
    "services.subtitle": "Mitä tarjoamme?",
    "services.promise": "Jokainen työmme tehdään vastuuvakuutuksen alaisena. Meille tärkeintä on se, että asiakas on oikeasti tyytyväinen — ei se, kuinka nopeasti saamme työn alta pois. Jos homma ottaa kauemmin kuin arvioitu, teemme sen silti kunnolla loppuun. Siitä ei tule lisälaskua. Hinta sovitaan aina etukäteen — ei yllätyksiä.",
    "services.video.caption": "Ammattilaisten välineet, viimeistelty jälki",

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

    "gallery.title": "Työtä, josta näkee laadun",
    "gallery.subtitle": "Oikeaa työtä, oikeat välineet — kentältä",
    "gallery.1.caption": "Korkeatkin kohteet puhtaaksi",
    "gallery.2.caption": "Huolellinen, viimeistelty jälki",
    "gallery.3.caption": "Ammattilaisten välineet",

    "service.basic.title": "Ikkunanpesu",
    "service.basic.popular": "Suosittu",
    "service.basic.desc": "Käytämme ammattilaisten välineitä ja hyväksi havaittuja pesuaineita. Ikkunat, parvekelasit ja lasiterassit pestyinä — kirkkaina ja raidattomina.",
    "service.basic.popup": "Ammattilaisten välineet, lasta ja mikrokuitu — ei raitoja, ei valumia. Pesemme sisältä ja ulkoa, myös parvekelasit ja lasiterassit. Kaikki hinta sovitaan etukäteen.",
    "service.basic.1": "Talon ikkunat sisältä ja ulkoa",
    "service.basic.2": "Parvekelasit ja lasiterassit",
    "service.basic.3": "Puitteet ja karmit kevyt pyyhintä",
    
    "service.talvikiilto.title": "Talvikiilto™",
    "service.talvikiilto.desc": "Sisäpuolen täyspesu sekä ulkopintojen kuivapuhdistus ilman jäätymisriskiä. Maisema kirkastuu vaikka pakkasta olisi.",
    "service.talvikiilto.why": "Puhtaat ikkunat ja kirkkaat maisemat myös talvisin!",
    "service.talvikiilto.1": "Sisäpuoli: lämminvesipesu, lasta ja mikrokuitu",
    "service.talvikiilto.2": "Ulkopuoli: kuivalla tai kevyesti kostutetulla mikrokuidulla, pöly ja sään jäljet lähtevät",
    "service.talvikiilto.3": "Lisä: parvekelasit sisäpinnat ja lasiterassit",
    
    "service.cardetailing.title": "Auton sisäfreesaus",
    "service.cardetailing.partner": "Puuhapatet × KJ Cardetailing",
    "service.cardetailing.price": "40 € / auto",
    "service.cardetailing.desc": "Kevyt ja vaivaton auton sisäpuhdistus. 20–30 min, kuivapesu – ei kosteutta sisätiloihin.",
    "service.cardetailing.1": "Imurointi",
    "service.cardetailing.2": "Kojelaudan ja pintojen puhdistus",
    "service.cardetailing.3": "Ovien sisäpinnat",
    "service.cardetailing.4": "Keskikonsoli",
    "service.cardetailing.5": "Auton sisäikkunoiden kevyt putsaus",

    "service.special.title": "Erikoistyöt",
    "service.special.desc": "Kaipaako liiketilasi tai taloyhtiösi yleisilmeen teroittamista ikkunoiden puhtauden suhteen? Otamme mielellämme tällaisia projekteja vastaan, olethan yhteydessä matalalla kynnyksellä niin katsotaan sopiva paketti kuntoon!",
    "service.special.1": "Taloyhtiöt, kerrostalot ja liiketilat",
    "service.special.2": "Ikkunanpesuvarret jopa 10 metrin korkuisiin kohteisiin",
    "service.special.3": "Pidämme huolen, että kokonaisuus hoituu turvallisesti ja sujuvasti",
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
    "faq.a9": "Toimimme vastuuvakuutuksen alaisena. Työskentelemme aina huolellisesti ja turvallisuus edellä. Jos työn aikana syntyy vahinkoa, meillä on vakuutusturva sen varalle — ja käsittelemme mahdolliset tilanteet aina asiallisesti yhdessä.",
    "faq.q10": "Onko palvelunne kotitalousvähennyskelpoinen?",
    "faq.a10": "Kyllä. Esimerkiksi ikkunanpesu on kotitalousvähennyskelpoinen palvelu. Lasku tulee aina sinulle, joten vähennyksen hakeminen verotuksessa on suoraviivaista.",
    
    "about.title": "Keitä olemme?",
    "about.desc": "Kaksi otaniemeläistä yrittäjää, jotka tekevät hommansa tosissaan.",
    "about.story.1": "Puuhapatet on espoolainen palveluyritys, jonka takana on kaksi lukiolaista: Joonatan ja Matias. Teemme ikkunanpesua, pihatöitä ja muita käytännön kotitalouspalveluja.",
    "about.story.2": "Yrittäjyys ei meille tarkoita sivubisnestä tai kesätöitä. Haluamme rakentaa jotain oikeaa, ja se näkyy tavassa, jolla teemme töitä. Työ tehdään kunnolla, sovittuun aikaan ja siististi. Ei yllätys-laskuja.",
    "about.story.3": "Toimimme Espoon ja Helsingin alueella. Ydinaluettamme on Etelä-Espoo: mm. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola ja Westend. Muut alueet onnistuvat myös, kysy rohkeasti!",
    "about.team.title": "Tekijät",
    "about.team.coming": "Esittelemme tekijät ja referenssit pian.",
    "about.contact.title": "Yhteystiedot",
    "about.founder.role": "Perustaja",
    "about.worker.role": "Tekijä",
    "about.age.suffix": "v",
    "about.area.title": "Toiminta-alue",
    "about.area.desc": "Toimimme Espoon ja Helsingin alueella. Ydinaluettamme on Etelä-Espoo: mm. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola ja Westend.",
    "about.area.other": "Muut alueet sopimuksen mukaan, kysy rohkeasti!",
    "about.story.origin": "Puuhapatet sai alkunsa yksinkertaisesta halusta: tehdä töitä kunnolla ja rakentaa jotain omaa. Meillä molemmilla oli jo pohjaa käytännön töistä, mutta halusimme kanavoida sen johonkin oikeaan — ei pelkästään tienata rahaa kesällä, vaan harjoitella oikeaa yrittämistä ja rakentaa mainetta, joka kestää. Puuhapatet perustettiin vuonna 2026, suunnittelu alkoi jo hyvissä ajoin edellisvuonna. Opiskelemme täysillä lukio-opintoja bisneksen ohella. Pyrimme muodostamaan toimivan kokonaisuuden yrittämisen ja opiskelun kesken. Rehellisesti asiakkaiden aito tyytyväisyys ja yhdessä tekeminen on se, mikä parhaiten motivoi meitä bisneksen pyörittämisessä, mikä heijastuu myös opiskeluun positiivisella tavalla.",
    "about.matias.bio": "Olen 18-vuotias Otaniemen lukion opiskelija. Urheilu on aina ollut lähellä sydäntä. Jalkapalloa olen pelannut kymmenisen vuotta. Nykyään arkeen kuuluu mm. sali ja tennis.\n\nUrheilu on opetannut sen, mitä yrittäjyyskin vaatii: sitoutumista, systemaattisuutta ja halua kehittyä. Olen lähtenyt kehittämään tätä ideaa yhdessä Joonatanin kanssa suurella intohimolla ja reippaalla seikkailumielellä. Puuhapatet on ensimmäinen askeleeni yrittäjyyden maailmaan.\n\nLuonteeltani olen positiivinen, reipas ja rehellinen työntekijä. Pyrin pitämään työnjälkeni mahdollisimman hyvänä keikalla kuin keikalla. Toivottavasti pääsen palvelemaan juuri teitä!",
    "about.joonatan.bio": "Olen 18-vuotias Otaniemen lukion opiskelija. Urheilu on iso osa elämääni; kilpajuoksu, sali ja tennis kuuluvat arkeen.\n\nUrheilutausta on opettanut, että kehittyminen ja sitoutuminen ovat tärkeitä taitoja ja olennaisia taitoja melkein missä tahansa. Olen kasvanut neljässä eri maassa ja matkustellut laajasti ympäri maailmaa, mikä on helpottanut katsomaan asioita uudenlaisista ja erilaisista näkökulmista. Yrittäjyys on kiinnostanut jo pitkään ja kokeiluja on takana useampia. Puuhapatet on projekti, jossa kaikki palaset tuntuivat loksahtavan kohdalleen.\n\nLuonteeltani olen energinen, suora ja kunnianhimoinen tekijä. Ideoita minulta löytyy melkein mihin vain! Laitetaan ikkunat puhtaaksi!",
    "about.petrus.bio": "Vapaa-aika menee rinteessä, vaellusreitillä tai kuntosalilla; ja niille kaikille on yhteistä, että parhaat hetket koetaan silloin, kun näkymä on kirkas. Saman homman hoidan myös teille: pesen ikkunat niin, että maisema pääsee taas oikeuksiinsa.\n\nTämä ei muuten ole ensimmäinen kertani ikkunoiden parissa, joten tiedän tasan tarkkaan, mitä lasta kädessä tapahtuu. Lupaan jättää jälkeeni vain puhtaita laseja ja korkeintaan yhden huonon vitsin.\n\nLaita viestiä, niin laitetaan teidänkin ikkunat sellaiseen kuntoon, että naapuri yrittää kävellä lasin läpi! ;)",
    
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

    "service.signs.title": "Kylttien puhdistus",
    "service.signs.desc": "Liikennemerkit, opasteet ja rakennusten fasadikyltit — puhtaana luovat oikean ensivaikutelman.",
    "service.signs.popup": "Kyltit keräävät likaa, sammaletta ja säärasitusta vuodesta toiseen. Puuhapatet pesee ne ammattitaidolla niin, että ne taas houkuttelevat — eivätkä karkota.",
    "service.signs.1": "Liikennemerkit ja tienvarsikyltit",
    "service.signs.2": "Fasadikyltit ja toimistokyltit",
    "service.signs.3": "Muut julkiset opasteet ja nimikyltit",

    "service.gutters.title": "Rännit & aurinkopaneelit",
    "service.gutters.desc": "Rännien tyhjennys ja aurinkopaneelien pesu — huollettu kohde toimii parhaiten.",
    "service.gutters.popup": "Tukkoinen räntä tai likainen aurinkopaneeli maksaa enemmän kuin luulisi. Puhdistettu paneeli voi tuottaa jopa 30 % enemmän sähköä. Rännit pidetään virtaavina koko sateen ajan.",
    "service.gutters.1": "Rännien tyhjennys lehtikaadosta ja roskaantumisesta",
    "service.gutters.2": "Syöksytorvet auki ja virtaaviksi",
    "service.gutters.3": "Aurinkopaneelien puhdistus — maksimituotto",

    "services.main.title": "Pääpalvelumme",
    "services.more.label": "Lisää palveluita",
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
    "hero.subtitle": "Home services done properly. Window cleaning, yard work and more — serving the Helsinki region.",
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

    "trust.assessment": "Free assessment visit",
    "trust.deduction": "Household deduction −35%",
    "trust.guarantee": "Satisfaction guarantee",

    "trustband.title": "Why Puuhapatet?",
    "trustband.assessment.title": "Free assessment visit",
    "trustband.assessment.desc": "We come and look at the site at no cost and give you an exact price. No commitment.",
    "trustband.deduction.title": "Household tax deduction",
    "trustband.deduction.desc": "Window cleaning and yard work qualify for the kotitalousvähennys — save up to 35% of the labour. You always get an invoice.",
    "trustband.guarantee.title": "Satisfaction guarantee",
    "trustband.guarantee.desc": "If something's not right, we fix it at no charge. What matters is that the result is spotless.",

    "services.title": "Services",
    "services.subtitle": "What we offer",
    "services.promise": "Every job we do is covered by liability insurance and fully compliant with Finnish law. What matters most to us is that the customer is genuinely happy — not how quickly we can move on. If a job takes longer than expected, we finish it properly regardless. No extra charge. Price is always agreed in advance — no surprises.",
    "services.video.caption": "Professional tools, a flawless finish",

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

    "gallery.title": "Work that shows its quality",
    "gallery.subtitle": "Real work, the right tools — from the field",
    "gallery.1.caption": "Even high windows, spotless",
    "gallery.2.caption": "Careful, polished results",
    "gallery.3.caption": "Professional-grade tools",
    
    "service.basic.title": "Window Cleaning",
    "service.basic.popular": "Popular",
    "service.basic.desc": "Professional equipment and proven cleaning products. The result is a clear, streak-free surface — windows, balcony glass and glass terraces.",
    "service.basic.popup": "Professional squeegee, microfiber and tools — no streaks, no drips. We clean inside and out, including balcony glass and glass terraces. Price always agreed upfront.",
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
    
    "about.title": "Who We Are?",
    "about.desc": "Two students from Otaniemi who take their work seriously.",
    "about.story.1": "Puuhapatet is an Espoo-based service company run by two secondary school students: Joonatan and Matias. We do window cleaning, yard work and other practical household services.",
    "about.story.2": "For us, entrepreneurship isn't a side project or a summer job. We want to build something real, and that shows in how we work. Everything gets done properly, on time and cleanly. No surprise invoices.",
    "about.story.3": "We operate in the Espoo and Helsinki area. Our core area is South Espoo: e.g. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola and Westend. Other areas work too — just ask!",
    "about.team.title": "The Team",
    "about.team.coming": "We'll introduce our team and references soon.",
    "about.contact.title": "Contact",
    "about.founder.role": "Founder",
    "about.worker.role": "Team member",
    "about.age.suffix": "y.o.",
    "about.area.title": "Service Area",
    "about.area.desc": "We cover the Espoo and Helsinki area. Our core area is southern Espoo: Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola and Westend.",
    "about.area.other": "Other areas by arrangement — feel free to ask!",
    "about.story.origin": "Puuhapatet started from a simple desire: to do work properly and build something of our own. We both already had a foundation in hands-on work, but we wanted to channel it into something real — not just earn money over the summer, but practise real entrepreneurship and build a reputation that lasts. Puuhapatet was founded in 2026, with planning well underway the previous year. We both study full-time alongside this, but honestly, genuine customer satisfaction and working together is what motivates us most. Nothing else comes close.",
    "about.matias.bio": "I'm 18 and a student at Otaniemi High School. Sport has always been close to my heart — I've played football for about ten years, and these days the gym and tennis are part of my routine.\n\nSport has taught me exactly what entrepreneurship demands too: commitment, discipline and a drive to improve. I set out to develop this idea together with Joonatan, with real passion and an adventurous mindset. Puuhapatet is my first real step into the world of entrepreneurship.\n\nBy nature I'm positive, energetic and an honest worker. I aim to keep the quality of my work as high as possible, job after job. I hope to have the pleasure of serving you!",
    "about.joonatan.bio": "I'm 18 and a student at Otaniemi High School. Sport is a big part of my life — competitive running, the gym and tennis are all part of everyday life.\n\nMy sports background has taught me that growth and commitment are essential skills in almost any field. I've grown up in four different countries and travelled extensively around the world, which has helped me look at things from new and different perspectives. Entrepreneurship has interested me for a long time, and I've had several ventures along the way. Puuhapatet is the project where everything finally clicked into place.\n\nBy nature I'm energetic, direct and an ambitious doer. I've got ideas for almost anything! Let's get those windows sparkling clean.",
    "about.petrus.bio": "My free time goes to the slopes, the trails or the gym — and what they all have in common is that the best moments happen when the view is clear. I do the same thing for you: I clean windows so the view can shine through again.\n\nThis isn't my first time with a squeegee in hand, by the way, so I know exactly what I'm doing. I promise to leave behind nothing but spotless glass and, at most, one bad joke.\n\nDrop me a message, and we'll get your windows into such good shape the neighbours will try to walk through the glass! ;)",
    
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

    "service.signs.title": "Sign Cleaning",
    "service.signs.desc": "Road signs, directory signs and facade signage — clean and welcoming to everyone who passes.",
    "service.signs.popup": "Signs accumulate dirt, moss and weather damage year after year. Puuhapatet cleans them professionally so they attract rather than deter.",
    "service.signs.1": "Road and traffic signs",
    "service.signs.2": "Facade and office signage",
    "service.signs.3": "Other public signs and nameplates",

    "service.gutters.title": "Gutters & Solar Panels",
    "service.gutters.desc": "Gutter clearing and solar panel washing — a well-maintained property performs better.",
    "service.gutters.popup": "A blocked gutter or dirty solar panel costs more than you'd think. Clean panels can produce up to 30% more power. Gutters kept flowing all season.",
    "service.gutters.1": "Gutter clearing of leaves and debris",
    "service.gutters.2": "Downpipes flushed and flowing",
    "service.gutters.3": "Solar panel cleaning — maximum output",

    "services.main.title": "Our main services",
    "services.more.label": "More services",
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
