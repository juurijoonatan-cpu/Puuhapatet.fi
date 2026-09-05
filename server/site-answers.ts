/**
 * Vastauskone ilman tekoälyä.
 *
 * MIKSI. Julkinen chat-botti nojasi kokonaan AI_API_KEY:hyn. Kun avainta ei
 * ollut (tai palveluntarjoaja nikotteli), jokainen kysymys sai saman
 * vastauksen: "En juuri nyt pysty vastaamaan automaattisesti." Kävijän
 * näkökulmasta botti oli rikki, vaikka vastaus hänen kysymykseensä luki
 * sanasta sanaan sivun UKK:ssa. Tuotannossa juuri näin oli käynyt: botti ei
 * vastannut mitään ja kertoi vain ettei päivystystä ole.
 *
 * Tämä moduuli vastaa kysymyksiin joihin sivustolla ON jo vastaus, ilman
 * mallia, verkkoyhteyttä tai avainta. Se ei arvaa: jos mikään aihe ei osu
 * riittävän varmasti, se palauttaa nullin ja kutsuja hoitaa viestin ihmiselle.
 *
 * KÄYTETÄÄN KAHDESSA KOHTAA:
 *  1. Kun AI-avainta ei ole → tämä on vastaus.
 *  2. Kun AI-kutsu epäonnistuu (429, katkos) → tämä on turvaverkko.
 * Kun malli vastaa normaalisti, tätä ei käytetä lainkaan.
 *
 * TIETOJEN ALKUPERÄ. Jokainen vastaus on kopio sivuston omasta sisällöstä:
 * UKK (client/src/lib/i18n.tsx, avaimet faq.*) ja sopimusehdot
 * (client/src/pages/ehdot.tsx). Tänne EI kirjoiteta uutta politiikkaa. Jos
 * ehdot muuttuvat, ne muuttuvat siellä ensin ja tänne sen jälkeen.
 */

import { HOUSEHOLD_DEDUCTION_RATE, fmtHouseholdCap, fmtPct } from "@shared/tax";

export type AnswerLang = "fi" | "en";

export interface SiteAnswer {
  /** Aiheen tunniste, näkyy vain lokissa ja testeissä. */
  id: string;
  reply: string;
  /** Kannattaako samalla tarjota viestin jättämistä ihmiselle. */
  offerHandoff: boolean;
}

interface Topic {
  id: string;
  /** Sanat joista aihe tunnistetaan. Kaikki pienellä, ilman taivutuspäätteitä. */
  keywords: string[];
  /** Vahvistavat sanat: osuma näihin nostaa pisteitä mutta ei yksin riitä. */
  hints?: string[];
  fi: string;
  en: string;
  offerHandoff?: boolean;
}

const PHONE = "Joonatan +358 40 0389999, Matias +358 44 2350881";

/**
 * Aiheet. Järjestyksellä ei ole väliä — voittaja valitaan pisteillä.
 *
 * Avainsanat ovat VARTALOITA, koska suomea taivutetaan: "hinta", "hinnan",
 * "hinnat", "hinnoittelu" osuvat kaikki vartaloon "hin". Liian lyhyt vartalo
 * osuu vääriin sanoihin, joten pituus on tässä harkittu eikä sattumaa.
 */
const TOPICS: Topic[] = [
  {
    id: "hinta",
    keywords: ["hinta", "hinna", "hinnoit", "maksaa", "paljonko", "kustann", "price", "cost", "how much", "quote", "tarjous"],
    hints: ["ikkuna", "pesu", "window"],
    fi:
      "Hinta sovitaan aina etukäteen kohteen koon ja ikkunamäärän mukaan, eikä yllätyslaskuja tule. " +
      "Suuntaa-antavia lähtöhintoja ikkunanpesulle (kaikki pinnat): **rivi- tai kerrostalohuoneisto alkaen n. 99 €**, " +
      "**omakotitalo alkaen n. 139 €**. Pelkät ulkopinnat ovat edullisemmat, ja lisäpalvelut ovat 19–89 €.\n\n" +
      "Tarkan arvion saat laskurista: **puuhapatet.fi/laskuri**. Haluatko että katsomme juuri sinun kohteesi ja annamme tarkan hinnan?",
    en:
      "The price is always agreed in advance based on the size of the property and the number of windows, with no surprise invoices. " +
      "Indicative starting prices for window cleaning (all surfaces): **flat or terraced house from ~€99**, **detached house from ~€139**. " +
      "Exterior-only is cheaper, and add-ons run €19–89.\n\n" +
      "For a closer estimate, use the calculator at **puuhapatet.fi/laskuri**. Would you like us to look at your property and give an exact price?",
    offerHandoff: true,
  },
  {
    id: "alue",
    keywords: ["alue", "alueel", "espoo", "helsin", "tapiola", "westend", "haukilah", "suvisaar", "nuottaniem", "kauniai", "vantaa", "area", "where do you", "do you cover", "toimitteko"],
    fi:
      "Toimimme **Espoossa ja Helsingissä**. Ydinaluettamme on Etelä-Espoo: mm. Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola ja Westend. " +
      "Muutkin alueet onnistuvat usein — kysy rohkeasti, niin katsotaan.",
    en:
      "We operate in **Espoo and Helsinki**. Our core area is South Espoo: Suvisaaristo, Haukilahti, Nuottaniemi, Tapiola and Westend. " +
      "Other areas are often possible too — just ask.",
  },
  {
    id: "palvelut",
    keywords: ["mitä teette", "mitä palvelu", "palvelut", "what do you do", "what services", "palveluita"],
    fi:
      "Teemme **ikkunanpesua** (sisältä ja ulkoa, myös parvekelasit ja lasiterassit), **Talvikiillon** talvihuoltopesua, " +
      "**pihatöitä** kuten nurmikonleikkuuta, **auton sisäpuhdistusta** sekä lisäpalveluita: parveke- ja terassilasit, " +
      "lasikaiteet, peilit, terassin lasikate ja rännien puhdistus.\n\n" +
      "Teemme työtä myös taloyhtiöille, kerrostaloihin ja liiketiloihin. Varusteemme yltävät jopa 10 metrin korkeuteen.",
    en:
      "We do **window cleaning** (inside and out, including balcony glass and glass terraces), our **Talvikiilto** winter service, " +
      "**garden work** such as lawn mowing, **car interior cleaning**, plus add-ons: balcony and terrace glass, glass railings, " +
      "mirrors, terrace glass roofs and gutter cleaning.\n\n" +
      "We also work for housing companies, apartment blocks and business premises, with equipment reaching up to 10 metres.",
  },
  {
    id: "ikkunanpesu",
    keywords: ["ikkunanpes", "ikkunoiden pes", "sisältä ja ulkoa", "window clean", "what does it include", "raidat"],
    fi:
      "Pesemme ikkunat **sisältä ja ulkoa** sovitun mukaan, parvekelasit ja lasiterassit mukaan lukien. Tavoitteena on siisti, raidaton jälki. " +
      "Karmit ja vesipellit kuuluvat samaan käyntiin.",
    en:
      "We clean the windows **inside and out** as agreed, including balcony glass and glass terraces, aiming for a clean, streak-free finish. " +
      "Frames and sills are part of the same visit.",
  },
  {
    id: "talvi",
    keywords: ["talvel", "talvi", "pakkas", "lumi", "talvikiilto", "winter", "frost", "snow"],
    fi:
      "Kyllä, pesemme talvellakin. Talvella suosittelemme **Talvikiiltoa**, joka on suunniteltu nimenomaan pakkassäähän: " +
      "sisäpuolen täyspesu ja ulkopintojen huoltopuhdistus ilman jäätymisriskiä.",
    en:
      "Yes, we work in winter too. We recommend **Talvikiilto**, designed for freezing weather: a full interior wash plus " +
      "maintenance cleaning of the exterior surfaces without the risk of freezing.",
  },
  {
    id: "kotitalousvahennys",
    keywords: ["kotitalousvähenn", "kotitalous vähenn", "verovähenn", "omavero", "vähennyskelpo", "tax deduction", "household deduction"],
    fi:
      `Kyllä. Ikkunanpesu ja pihatyöt ovat kotitalousvähennyskelpoisia. Vähennys on n. ${fmtPct(HOUSEHOLD_DEDUCTION_RATE)} työn osuudesta, ` +
      `enintään ${fmtHouseholdCap()} € henkilöä kohden vuodessa. Saat työstä aina laskun, joten vähennyksen hakeminen OmaVerossa on suoraviivaista. ` +
      "Vähennyksen myöntää Verohallinto, joten emme vastaa sen lopullisesta määrästä.",
    en:
      `Yes. Window cleaning and garden work qualify for the Finnish household tax deduction: about ${fmtPct(HOUSEHOLD_DEDUCTION_RATE)} of the labour, ` +
      `up to €${fmtHouseholdCap()} per person per year. You always get an invoice, so claiming it in OmaVero is straightforward. ` +
      "The deduction is granted by the Tax Administration, so we can't guarantee the final amount.",
  },
  {
    id: "maksu",
    keywords: ["maksu", "maksa", "mobilepay", "lasku", "tilisiirto", "käteinen", "payment", "invoice", "pay"],
    fi:
      "Hyväksymme **MobilePayn, tilisiirron ja käteisen**. Saat työstä aina laskun, joten kaikki on dokumentoitua. " +
      "Maksuehto sovitaan tilauksen yhteydessä. Maksumuistutus on 5 € ja viivästyskorko lain mukainen.",
    en:
      "We accept **MobilePay, bank transfer and cash**. You always get an invoice, so everything is documented. " +
      "Payment terms are agreed when ordering. A payment reminder is €5 and late interest follows Finnish law.",
  },
  {
    id: "peruutus",
    keywords: ["peruut", "peruu", "perua", "siirtää aikaa", "cancel", "reschedul", "no-show"],
    fi:
      "Tilauksen voi peruuttaa **maksutta viimeistään 48 tuntia** ennen sovittua aikaa.\n\n" +
      "- Alle 48 h ennen: 50 % palvelun hinnasta\n" +
      "- Alle 24 h ennen tai jos emme pääse paikalle: 100 % palvelun hinnasta\n\n" +
      "Jos aika ei sovi, kerro mahdollisimman ajoissa niin etsitään uusi.",
    en:
      "You can cancel **free of charge at least 48 hours** before the agreed time.\n\n" +
      "- Less than 48 h before: 50 % of the price\n" +
      "- Less than 24 h before, or a no-show: 100 % of the price\n\n" +
      "If the time doesn't suit, tell us as early as you can and we'll find a new one.",
  },
  {
    id: "takuu",
    keywords: ["takuu", "tyytyväi", "reklamaat", "valitus", "jäi huono", "korjaa", "guarantee", "complain", "not satisfied", "unhappy"],
    fi:
      "Meillä on **tyytyväisyystakuu**: jos lopputuloksessa on huomautettavaa, korjaamme sen veloituksetta. " +
      "Ilmoita asiasta kirjallisesti **info@puuhapatet.fi** kahden vuorokauden kuluessa työn valmistumisesta. " +
      "Emme hyvitä suoraan laskussa vaan teemme korjauskäynnin veloituksetta, jos reklamaatio todetaan aiheelliseksi.",
    en:
      "We have a **satisfaction guarantee**: if something isn't right, we fix it free of charge. " +
      "Report it in writing to **info@puuhapatet.fi** within two days of the work being completed. " +
      "We don't credit the invoice — we make a free corrective visit if the complaint is justified.",
  },
  {
    id: "vakuutus",
    keywords: ["vakuut", "vahinko", "rikko", "särky", "turvalli", "insur", "damage", "break"],
    fi:
      "Toimimme **vastuuvakuutuksen alaisena** ja vakuutus on voimassa koko Euroopassa. Se kattaa sekä toiminnan vastuun että tuotevastuun. " +
      "Työskentelemme aina turvallisuus edellä. Pyydämme siirtämään arvoesineet ja herkästi rikkoutuvat tavarat pois työkohteen läheltä ennen aloitusta.",
    en:
      "We work under **liability insurance**, valid across Europe, covering both operational and product liability. " +
      "We always work safety first. Please move valuables and fragile items away from the work area before we start.",
  },
  {
    id: "valmistautuminen",
    keywords: ["valmistau", "pitääkö minun", "ennen käyntiä", "mitä pitää tehdä", "prepare", "do i need to"],
    fi:
      "Tyhjennä **ikkunalaudat** ja varmista **vapaa kulku ikkunoille**. Muuta ei tarvita — me tuomme välineet ja veden. " +
      "Arvoesineet kannattaa siirtää sivuun ennen aloitusta.",
    en:
      "Clear the **windowsills** and make sure there's **free access to the windows**. That's all — we bring the equipment and water. " +
      "It's worth moving valuables aside before we start.",
  },
  {
    id: "aikataulu",
    keywords: ["kuinka nopeas", "milloin pääset", "vapaita aikoja", "aikatau", "kauanko kestää", "how quickly", "how soon", "availab", "when can you"],
    fi:
      "Vastaamme yhteydenottoihin yleensä **saman päivän aikana**, viimeistään seuraavana arkipäivänä. Nopein tapa on WhatsApp. " +
      "Sopiva aika sovitaan yhdessä — kerro toiveesi, niin katsotaan lähin sopiva ajankohta.",
    en:
      "We usually reply **the same day**, at the latest the next working day. The fastest way to reach us is WhatsApp. " +
      "We agree the time together — tell us what suits and we'll find the nearest slot.",
    offerHandoff: true,
  },
  {
    id: "taloyhtio",
    keywords: ["taloyhti", "isännöi", "kerrostalo", "liiketil", "yrityksel", "toimisto", "housing company", "commercial", "office", "business"],
    fi:
      "Kyllä. Teemme ikkunanpesua **taloyhtiöille, kerrostaloihin ja liiketiloihin** sopimuksen mukaan, ja varusteemme yltävät jopa 10 metrin korkeuteen. " +
      "Isommista kohteista teemme aina erillisen tarjouksen — kerro kohteen osoite ja koko, niin palaamme asiaan.",
    en:
      "Yes. We clean windows for **housing companies, apartment blocks and business premises** by agreement, with equipment reaching up to 10 metres. " +
      "Larger sites always get a separate quote — tell us the address and size and we'll come back to you.",
    offerHandoff: true,
  },
  {
    id: "siivous",
    keywords: ["siivo", "kotisiivo", "siivouspalvel", "cleaning service", "house clean", "home clean"],
    fi:
      "Siivouspalvelu on **työn alla, eikä sitä voi vielä tilata** — avauspäivää ei ole lyöty lukkoon, joten emme lupaa sellaista. " +
      "Laskurin Siivous-välilehdeltä (**puuhapatet.fi/laskuri**) saat ennakkoarvion ja voit jättää yhteystietosi, niin ilmoitamme heti kun palvelu avautuu. " +
      "Ikkunanpesun ja pihatyöt voit tilata normaalisti jo nyt.",
    en:
      "Our cleaning service is **in the works and can't be ordered yet** — the opening date isn't fixed, so we won't promise one. " +
      "The Cleaning tab in the calculator (**puuhapatet.fi/laskuri**) gives an advance estimate and lets you leave your details so we can tell you the moment it opens. " +
      "Window cleaning and garden work can be ordered as normal right now.",
  },
  {
    id: "yhteystiedot",
    keywords: ["yhteystie", "puhelinnum", "soitta", "sähköpost", "whatsapp", "contact", "phone", "email", "reach you"],
    fi:
      `Tavoitat meidät parhaiten näin:\n\n- **WhatsApp / puhelin:** ${PHONE}\n- **Sähköposti:** info@puuhapatet.fi\n- **Lomake:** puuhapatet.fi/tilaus\n\n` +
      "Vastaamme yleensä saman päivän aikana.",
    en:
      `The best ways to reach us:\n\n- **WhatsApp / phone:** ${PHONE}\n- **Email:** info@puuhapatet.fi\n- **Form:** puuhapatet.fi/tilaus\n\n` +
      "We usually reply the same day.",
  },
  {
    id: "tilaus",
    keywords: ["miten tila", "haluan tilat", "varata", "varaus", "tilaisin", "how do i order", "book", "order"],
    fi:
      "Helpoiten näin: jätä yhteydenottopyyntö osoitteessa **puuhapatet.fi/tilaus** tai laita WhatsAppia. " +
      "Tulemme tarvittaessa katsomaan kohteen **veloituksetta**, annamme tarkan hinnan, ja vasta sitten sovitaan aika. Mikään vaihe ei sido sinua.",
    en:
      "The easiest way: leave a request at **puuhapatet.fi/tilaus** or message us on WhatsApp. " +
      "If needed we'll come and look at the property **free of charge**, give you an exact price, and only then agree a time. Nothing commits you.",
    offerHandoff: true,
  },
  {
    id: "kartoitus",
    keywords: ["kartoit", "ilmainen käynti", "arvio paikan päällä", "site visit", "assessment", "free visit"],
    fi:
      "Kartoituskäynti on **täysin maksuton eikä sido mihinkään**. Tulemme katsomaan kohteen, käymme toiveet läpi ja annamme tarkan hinnan. " +
      "Voit varata sen osoitteessa **puuhapatet.fi/tilaus**.",
    en:
      "The assessment visit is **completely free and commits you to nothing**. We look at the property, go through what you want and give an exact price. " +
      "Book it at **puuhapatet.fi/tilaus**.",
    offerHandoff: true,
  },
  {
    id: "keita",
    keywords: ["keitä te", "kuka teistä", "kuka olette", "yritys", "who are you", "about you", "4h"],
    fi:
      "Puuhapatet on espoolainen palveluyritys, jota pyörittää kaksi otaniemeläistä nuorta yrittäjää: **Joonatan Juuri** ja **Matias Pitkänen**. " +
      "Puuhapatet on yhteinen brändi, jonka sisällä jokainen tekijä on itsenäinen 4H-yrittäjä omalla vastuuvakuutuksellaan.",
    en:
      "Puuhapatet is an Espoo-based service company run by two young entrepreneurs from Otaniemi: **Joonatan Juuri** and **Matias Pitkänen**. " +
      "Puuhapatet is a shared brand, and each operator within it is an independent 4H entrepreneur with their own liability insurance.",
  },
];

/** Yleiset tervehdykset: näihin vastataan, mutta ne eivät ole aihe. */
const GREETING = /^(moi|hei|terve|moro|heippa|morjens|hello|hi|hey|yo)\b[\s!.,?]*$/i;

function detectLang(text: string): AnswerLang {
  // Suomen kielen tunnusmerkit ovat luotettavampia kuin englannin: englantia
  // kirjoitetaan suomeksikin, mutta ä/ö ja nämä sanat eivät esiinny englannissa.
  if (/[äö]/i.test(text)) return "fi";
  if (/\b(mitä|miten|paljonko|onko|voiko|kuinka|milloin|missä|teettekö|hinta|kiitos)\b/i.test(text)) return "fi";
  if (/\b(the|what|how|much|do you|can you|is it|price|when|where|hello|thanks)\b/i.test(text)) return "en";
  return "fi";
}

/**
 * Pisteytys.
 *
 * Kolme sääntöä, ja jokaisen takana on testi joka kaatui ilman sitä:
 *
 *  1. VÄHINTÄÄN YKSI AVAINSANA. Vihjeet eivät yksin riitä. Ilman tätä
 *     "Mitä ikkunanpesuun kuuluu?" sai hintavastauksen, koska hinta-aiheen
 *     vihjeet "ikkuna" ja "pesu" osuivat molemmat.
 *  2. USEAMPI OSUMA VOITTAA. "Paljonko maksaa omakotitalon ikkunanpesu?"
 *     osuu hintaan kahdesti ja ikkunanpesuun kerran, joten se on
 *     hintakysymys.
 *  3. TASAPELIN RATKAISEE JÄRJESTYS. TOPICS on kirjoitettu aikomus ennen
 *     aihetta: "Mitä maksaa window cleaning?" osuu kumpaankin kerran, ja
 *     kysyjä haluaa hinnan, ei kuvausta pesun sisällöstä. Jos lisäät aiheen,
 *     mieti mihin kohtaan listaa se kuuluu — se on osa logiikkaa.
 *
 * Sanan pituudella EI pisteytetä. Kokeiltiin, ja se teki juuri päinvastoin:
 * pitkä "window clean" jyräsi lyhyen mutta ratkaisevan "maksaa"-sanan.
 */
interface Score {
  points: number;
  keywordHits: number;
}

const KEYWORD_WEIGHT = 3;
const HINT_WEIGHT = 1;

function score(haystack: string, topic: Topic): Score {
  let points = 0;
  let keywordHits = 0;
  for (const kw of topic.keywords) {
    if (!haystack.includes(kw)) continue;
    keywordHits++;
    points += KEYWORD_WEIGHT;
  }
  for (const hint of topic.hints ?? []) {
    if (haystack.includes(hint)) points += HINT_WEIGHT;
  }
  return { points, keywordHits };
}

/**
 * Etsi vastaus sivuston omasta sisällöstä. Palauttaa nullin kun mikään aihe ei
 * osu riittävän varmasti — silloin kutsuja ohjaa viestin ihmiselle eikä arvaa.
 */
export function answerFromSite(message: string): SiteAnswer | null {
  const text = String(message ?? "").trim();
  if (!text) return null;

  const lang = detectLang(text);
  const haystack = text.toLowerCase();

  if (GREETING.test(text)) {
    return {
      id: "tervehdys",
      offerHandoff: false,
      reply:
        lang === "fi"
          ? "Moi! Autan mielelläni ikkunanpesuun, hintoihin, alueisiin ja aikatauluihin liittyvissä kysymyksissä. Mitä haluaisit tietää?"
          : "Hi! Happy to help with window cleaning, prices, areas and scheduling. What would you like to know?",
    };
  }

  let best: Topic | null = null;
  let bestPoints = 0;
  for (const topic of TOPICS) {
    const { points, keywordHits } = score(haystack, topic);
    if (keywordHits === 0) continue; // vihjeet eivät yksin kelpaa
    if (points > bestPoints) {
      best = topic;
      bestPoints = points;
    }
  }

  if (!best) return null;

  return {
    id: best.id,
    reply: best[lang],
    offerHandoff: best.offerHandoff ?? false,
  };
}

/** Testien ja lokien käyttöön: montako aihetta koneessa on. */
export const SITE_ANSWER_TOPIC_IDS = TOPICS.map(t => t.id);

/**
 * Julkisen chatin vastauksen valinta yhtenä puhtaana funktiona.
 *
 * Reitti itse on kolme riviä ja tarvitsee tietokannan käynnistyäkseen, joten
 * päätös asuu täällä missä sen voi testata. Järjestys on tärkeysjärjestys:
 *
 *   1. Malli vastasi        → käytä sitä.
 *   2. Malli ei vastannut   → sivuston oma vastaus, jos aihe tunnistuu.
 *   3. Ei kumpaakaan        → ota viesti talteen ihmiselle.
 *
 * Kohta 2 on koko muutoksen ydin: ennen tätä kohdasta 1 pudottiin suoraan
 * kohtaan 3, ja koska tuotannosta puuttui AI-avain, botti oli aina kohdassa 3.
 */
export function resolvePublicReply(opts: {
  /** Mallin vastaus, tai null jos avain puuttuu tai kutsu epäonnistui. */
  aiReply: string | null;
  message: string;
  /** Näyttääkö kysyjä haluavan ihmisen (kutsujan oma tulkinta). */
  wantsHuman: boolean;
  /** Vakiovastaus kun mikään ei osu. */
  fallback: string;
}): { reply: string; offerHandoff: boolean; source: "ai" | "site" | "fallback" } {
  const { aiReply, message, wantsHuman, fallback } = opts;

  if (aiReply) {
    return { reply: aiReply, offerHandoff: wantsHuman, source: "ai" };
  }

  const grounded = answerFromSite(message);
  if (grounded) {
    return {
      reply: grounded.reply,
      offerHandoff: grounded.offerHandoff || wantsHuman,
      source: "site",
    };
  }

  return { reply: fallback, offerHandoff: true, source: "fallback" };
}
