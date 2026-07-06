/**
 * Worker (alihankkija) onboarding — agreements + profile questionnaire.
 *
 * These are the documents a gig worker signs BEFORE the worker dashboard opens
 * ("the intro is the signing"). The set is designed to do two things at once:
 *   • PROTECT THE BRAND firmly — independent-contractor status, own taxes &
 *     insurance, own liability, customer/site non-circumvention, non-compete,
 *     non-solicitation and a contractual penalty, so an alihankkija can never
 *     take the work, the client or the brand for themselves; and
 *   • MOTIVATE PEOPLE TO STAY — a clear, fair, performance-based growth path so
 *     good workers want to keep going with Puuhapatet long-term.
 *
 * The model:
 *   1. Alihankkijasopimus — the binding subcontractor agreement (independent
 *      contractor, own Y-tunnus, own taxes/insurance/liability, per-window pay).
 *   2. Tietosuoja & turvallisuus — data-protection + key & safety acknowledgement.
 *   3. Asiakassuoja & kilpailukielto — customers/sites belong to the brand,
 *      non-compete, non-solicitation, trade secrets, contractual penalty.
 *   4. Tiimi, jatkuvuus & kasvu — the positive, mutual "you're part of the brand"
 *      commitment: more & better work for good performance, fair treatment.
 *
 * The per-window pay RATE is intentionally NOT written into the text — it is set
 * per worker (shared/crew.ts `perWindowCents`) and shown live on the worker's
 * dashboard and on the signed contract document, so the agreement never states a
 * number that could conflict with an individually-agreed rate.
 *
 * ⚠️  LEGAL REVIEW REQUIRED. This is a carefully-written Finnish template, but it
 * has NOT been reviewed by a lawyer. In Finland a post-term non-compete on an
 * independent contractor must be reasonable in scope and duration to be
 * enforceable, and a contractual penalty can be adjusted by a court. Have a
 * Finnish lawyer review the alihankkija + non-compete + penalty clauses before
 * relying on them. Bump WORKER_AGREEMENT_VERSION to force everyone to re-sign.
 */

export const WORKER_AGREEMENT_VERSION = "2026-06";

/**
 * Rollout switch for the FR8 alihankkija contract.
 *
 *   false → SOFT START: a worker opens their link and goes straight to the
 *           dashboard. No questionnaire and no signing yet.
 *
 *   true  → GATED (now — the official Alihankkijasopimus v2026-06 is finalised):
 *           before the dashboard opens the worker fills their profile, confirms
 *           insurance status + accepts the risk, reads & accepts every agreement,
 *           and signs once. Already-entered workers must complete this before they
 *           can keep marking windows (server also blocks marking until signed).
 */
export const WORKER_AGREEMENTS_GATED = true;

export interface AgreementClause {
  id: string;
  text: string;
}

export interface AgreementSection {
  no: string;        // "01", "02", …
  title: string;
  body: string[];    // paragraphs / bullet lines
}

export interface WorkerAgreement {
  id: string;        // "alihankinta" | "tietoturva" | "asiakassuoja" | "tiimi"
  title: string;
  tagline: string;   // one-line summary shown on the card
  intro: string;
  sections: AgreementSection[];
  /** Tick-boxes the worker must accept; all required. */
  clauses: AgreementClause[];
  /** Final acceptance line shown above the signature pad. */
  accept: string;
}

// ─── 1. Alihankkijasopimus ──────────────────────────────────────────────────

const ALIHANKINTA: WorkerAgreement = {
  id: "alihankinta",
  title: "Alihankkijasopimus",
  tagline: "Itsenäinen alihankkija · oma Y-tunnus, verot & vakuutukset · urakkaperusteinen korvaus",
  intro:
    "Tämä sopimus solmitaan Puuhapatet-brändin (jäljempänä “Brändi”, jota edustavat sen perustajat " +
    "Joonatan Juuri ja Matias Pitkänen) ja allekirjoittavan tekijän (jäljempänä “Alihankkija”) välillä. " +
    "Alihankkija tekee työn itsenäisenä yrittäjänä omaan lukuunsa ja laskuttaa työstään Brändiä alla " +
    "kuvatun mallin mukaisesti. Kyseessä EI ole työsuhde, virkasuhde eikä toimeksiantosuhde, joka " +
    "synnyttäisi työnantajavelvoitteita. Brändi tuo asiakkaat, kohteet, työkalut ja maineen; Alihankkija " +
    "tuo oman työpanoksensa ja vastaa omasta yritystoiminnastaan.",
  sections: [
    {
      no: "01",
      title: "Asema ja itsenäisyys",
      body: [
        "Toimin itsenäisenä alihankkijana (kevytyrittäjä, toiminimi tai yhtiö) enkä työsuhteessa Brändiin. Minulle ei synny työsuhteen oikeuksia, kuten palkkaa, lomakorvausta, sairausajan palkkaa, työterveyttä tai irtisanomissuojaa.",
        "Hankin ja minulla on oman toimintani edellyttämä Y-tunnus ja laskutuskanava ennen ensimmäistä laskua. Voin hankkia Y-tunnuksen myös laskutuspalvelun kautta.",
        "Päätän itse työni tekotavasta, työvälineistä ja työjärjestyksestä sovittujen laatu-, aikataulu- ja turvallisuusvaatimusten rajoissa.",
        "Voin lähtökohtaisesti tehdä työtä myös muille toimeksiantajille, kunhan se ei ole ristiriidassa tämän sopimuksen kilpailukielto- ja asiakassuojaehtojen kanssa (ks. erillinen sopimusosa).",
      ],
    },
    {
      no: "02",
      title: "Verot, vakuutukset ja omat maksut — omalla vastuulla",
      body: [
        "Vastaan itse KAIKISTA omaan yritystoimintaani liittyvistä veroista ja maksuista: tuloverosta, ennakkoverosta/ennakonpidätyksestä, mahdollisesta arvonlisäverosta sekä YEL-eläkevakuutuksesta. Brändi ei pidätä veroja eikä tilitä niitä puolestani.",
        "Huolehdin itse riittävästä vakuutusturvasta toimintani edellyttämässä laajuudessa, vähintään toiminnan vastuuvakuutuksesta ja tarkoituksenmukaisesta tapaturmavakuutuksesta. Vakuutusturvani ei saa olla puutteellinen työn aikana.",
        "Ymmärrän, että teen työn omalla riskilläni: en saa palkkaa ajalta jolloin en tee työtä, enkä sairausajan tai loman korvausta. Korvaukseni perustuu yksinomaan tekemääni ja hyväksyttyyn työhön.",
        "Vastaan itse omasta kirjanpidostani ja viranomaisilmoituksistani. Brändi voi pyytää todistuksen Y-tunnuksesta, ennakkoperintärekisteristä tai vakuutuksesta.",
      ],
    },
    {
      no: "03",
      title: "Korvaus ja laskutus",
      body: [
        "Korvaus on urakkaperusteinen ikkunakohtainen suoriteveloitus: jokainen hyväksytysti ja huolellisesti pesty ikkuna kerryttää korvaustani sovitulla ikkunakohtaisella hinnalla. Henkilökohtainen hintani näkyy aina työpöydälläni ja maksuissani.",
        "Vain todellisuudessa ja huolellisesti pestyt ikkunat kerryttävät korvausta. Huonokuntoiset, ohitetut tai virheellisesti “pestyksi” merkityt ikkunat eivät kerrytä korvausta, ja Brändillä on oikeus oikaista virheelliset merkinnät.",
        "Laskutan korvaukseni Brändiltä sovituin väliajoin oman Y-tunnukseni kautta. En peri maksuja suoraan asiakkaalta enkä laskuta Brändin asiakkaita omaan lukuuni.",
        "Korvaukset ovat arvonlisäverottomia, ellei toisin sovita. Vastaan itse oman toimintani mahdollisesta arvonlisäverovelvollisuudesta ja sen ilmoittamisesta laskullani.",
        "Maksut Brändiltä minulle hoidetaan seurannan kautta: hyväksyn maksuilmoituksen omilla laskutustiedoillani, minkä jälkeen suoritus maksetaan ja siitä muodostuu laskuni.",
      ],
    },
    {
      no: "04",
      title: "Vastuu, vakuutus ja vahingot",
      body: [
        "Vastaan oman työni laadusta ja huolellisuudesta sekä tuottamuksella aiheuttamistani vahingoista oman toimintani ja vakuutusteni mukaisesti.",
        "Jos rikon tai vahingoitan jotain, olen vastuussa siitä: huolehdin ja maksan vahingosta aiheutuvat korvaukset, vaikka vakuutusta ei olisi voimassa.",
        "Ilmoitan vahingoista, rikkoutumisista ja vaaratilanteista välittömästi Brändin edustajille.",
        "Ennen työtä valokuvadokumentoidut vauriot sekä huonokuntoisista tai hauraista rakenteista huolellisesta työstä huolimatta aiheutuvat seuraukset (esim. hilseilevän maalin irtoaminen) eivät ole vastuullani.",
        "Käytän työvälineitä, avaimia ja kulkuoikeuksia huolellisesti ja palautan kaiken minulle uskotun omaisuuden pyydettäessä ja viimeistään yhteistyön päättyessä.",
      ],
    },
    {
      no: "05",
      title: "Laatu, turvallisuus ja työmaa",
      body: [
        "Teen työn sovitun laatutason mukaisesti ja noudatan työmaan sääntöjä sekä turvallisuusohjeita. Edustan työmaalla Brändiä asiallisesti ja siististi.",
        "Turvallisuus on aina etusijalla. En ota tarpeettomia riskejä korkealla työskennellessäni enkä työskentele päihteiden vaikutuksen alaisena.",
        "Aloitan ajanseurannan työmaalle saapuessani ja merkitsen tekemäni ikkunat rehellisesti ja reaaliaikaisesti karttaan.",
        "Minulla on oikeus ja velvollisuus jättää huonokuntoinen tai vaarallinen ikkuna pesemättä (kuntovaraus) ilman seuraamuksia ja ilmoittaa siitä.",
      ],
    },
    {
      no: "06",
      title: "Luottamuksellisuus",
      body: [
        "Käsittelen asiakas- ja kohdetietoja luottamuksellisesti enkä luovuta niitä ulkopuolisille. Luottamuksellisuus jatkuu myös yhteistyön päätyttyä.",
      ],
    },
    {
      no: "07",
      title: "Sopimuksen kesto ja päättyminen",
      body: [
        "Sopimus on voimassa toistaiseksi. Yhteistyö jatkuu niin kauan kuin se on molemmille osapuolille toimiva — käytännössä työtä on tarjolla ja teen sen sovitulla laadulla ja luotettavuudella.",
        "Kumpi tahansa osapuoli voi päättää yhteistyön ilmoittamalla siitä toiselle. Kesken sovitun työmaan pyrimme saattamaan aloitetun kokonaisuuden hallitusti loppuun.",
        "Yhteistyön päättyminen ei vaikuta jo kertyneeseen korvaukseeni tehdystä työstä. Asiakassuoja-, kilpailukielto-, luottamuksellisuus- ja vastuuehdot jäävät voimaan päättymisestä riippumatta.",
      ],
    },
    {
      no: "08",
      title: "Sovellettava laki ja erimielisyydet",
      body: [
        "Sopimukseen sovelletaan Suomen lakia.",
        "Erimielisyydet pyritään ensisijaisesti ratkaisemaan neuvottelemalla; muutoin asia käsitellään tekijän kotipaikan käräjäoikeudessa.",
      ],
    },
  ],
  clauses: [
    { id: "itsenainen", text: "Ymmärrän toimivani itsenäisenä alihankkijana, en työsuhteessa, eikä minulle synny työsuhteen oikeuksia (palkka, loma, sairausajan korvaus, irtisanomissuoja)." },
    { id: "verot", text: "Vastaan itse veroistani, ennakkoperinnästä, mahdollisesta YEL:stä ja arvonlisäverosta. Brändi ei pidätä veroja puolestani." },
    { id: "vakuutus", text: "Vastaan itse vakuutusturvastani ja teen työn omalla riskilläni. Ymmärrän, että vastaan aiheuttamistani vahingoista myös silloin, kun vakuutusta ei ole voimassa." },
    { id: "korvaus", text: "Hyväksyn urakkaperusteisen, ikkunakohtaisen korvausmallin ja laskutan korvaukseni oman Y-tunnukseni kautta — en laskuta asiakasta suoraan." },
  ],
  accept:
    "Olen lukenut alihankkijasopimuksen ja hyväksyn sen sisällön. Allekirjoitukseni sitoo minua sopimukseen.",
};

// ─── 2. Tietosuoja & turvallisuus ─────────────────────────────────────────────

const TIETOTURVA: WorkerAgreement = {
  id: "tietoturva",
  title: "Tietosuoja & turvallisuus",
  tagline: "Asiakastietojen suoja, avainturva ja työturvallisuus",
  intro:
    "Vahvistan noudattavani Puuhapatetin tietosuoja- ja turvallisuuskäytäntöjä koko yhteistyön ajan. " +
    "Asiakkaiden koteihin ja toimitiloihin pääsy on luottamustehtävä, jota kohtelen sen mukaisesti.",
  sections: [
    {
      no: "01",
      title: "Asiakastiedot ja tietosuoja",
      body: [
        "Käytän asiakas- ja kohdetietoja vain työn tekemiseen enkä kopioi niitä Brändin järjestelmien ulkopuolelle.",
        "En jaa kuvia, osoitteita, asiakkaiden nimiä tai muita kohdetietoja somessa tai ulkopuolisille ilman Brändin lupaa.",
        "En käytä asiakas- tai kohdetietoja omiin tarkoituksiini enkä yhteydenpitoon asiakkaiden kanssa Brändin ohi.",
      ],
    },
    {
      no: "02",
      title: "Avaimet ja kulkuoikeudet",
      body: [
        "Säilytän avaimia ja kulkulupia huolellisesti ja ilman kohteen tunnistetietoja, enkä luovuta niitä ulkopuolisille.",
        "Ilmoitan heti, jos avain katoaa tai kulkuoikeuksissa on ongelma, ja palautan avaimet kuittausta vastaan pyydettäessä.",
      ],
    },
    {
      no: "03",
      title: "Työturvallisuus",
      body: [
        "Noudatan turvallisia työtapoja ja keskeytän työn, jos tilanne on vaarallinen.",
        "Ilmoitan tapaturmista ja läheltä piti -tilanteista välittömästi.",
      ],
    },
  ],
  clauses: [
    { id: "tietosuoja", text: "Sitoudun käsittelemään asiakas- ja kohdetietoja luottamuksellisesti enkä jaa niitä ulkopuolisille." },
    { id: "turvallisuus", text: "Sitoudun turvallisiin työtapoihin ja huolelliseen avainten- ja kulkulupien käsittelyyn." },
  ],
  accept: "Hyväksyn tietosuoja- ja turvallisuuskäytännöt.",
};

// ─── 3. Asiakassuoja & kilpailukielto ──────────────────────────────────────────

const ASIAKASSUOJA: WorkerAgreement = {
  id: "asiakassuoja",
  title: "Asiakassuoja & kilpailukielto",
  tagline: "Asiakkaat & kohteet kuuluvat Brändille · kilpailukielto · houkuttelukielto · sopimussakko",
  intro:
    "Tämä on sitova sopimusosa, joka suojaa Puuhapatet-brändiä. Brändi tuo asiakkaat, kohteet, " +
    "hinnoittelumallin, työkalut ja maineen — Alihankkija pääsee näihin käsiksi vain yhteistyön kautta. " +
    "Siksi sitoudut alla oleviin ehtoihin sekä yhteistyön aikana että määräajan sen jälkeen. Ehdot ovat " +
    "tarkoituksella selkeät ja velvoittavat: et voi ottaa Brändin työtä, asiakasta tai kohdetta itsellesi " +
    "etkä ryhtyä niissä omaksi toimijaksi Brändin ohi.",
  sections: [
    {
      no: "01",
      title: "Asiakkaat ja kohteet kuuluvat Brändille",
      body: [
        "Kaikki Brändin kautta syntyneet tai Brändin osoittamat asiakkaat, tilaajat, loppuasiakkaat, kohteet, yhteystiedot ja liidit kuuluvat yksinomaan Puuhapatetille — myös ne, jotka kohtaan keikalla tai joiden tiloissa työskentelen.",
        "En ota näihin asiakkaisiin tai kohteisiin yhteyttä omaan lukuuni, en sovi heidän kanssaan töistä Brändin ohi, en laskuta heitä suoraan enkä ryhdy heidän omaksi toimittajakseen tai työntekijäkseen — en yhteistyön aikana enkä 24 kuukauteen sen päättymisestä.",
        "En jatka saman kohteen tai asiakkaan työtä omaan lukuuni tai kilpailijan lukuun yhteistyön ohi tai sen jälkeen edellä mainittuna aikana. Ohjaan kaikki uudet tilaukset ja jatkotyöpyynnöt Brändille.",
      ],
    },
    {
      no: "02",
      title: "Kilpailukielto",
      body: [
        "En tarjoa enkä tuota Brändin kanssa kilpailevaa ikkunanpesu- tai vastaavaa palvelua Brändin asiakkaille tai kohteille omaan lukuuni tai kilpailijan lukuun yhteistyön aikana enkä 12 kuukauteen sen päättymisestä.",
        "En perusta enkä toimi kilpailevassa toiminnassa, joka kohdistuu Brändin asiakaskuntaan tai Brändin osoittamiin kohteisiin edellä mainittuna aikana.",
        "Kielto ei estä minua tekemästä alan työtä yleisesti muille kuin Brändin asiakkaille tai Brändin kautta syntyneissä kohteissa, eikä estä opiskelua tai muuta työtä.",
      ],
    },
    {
      no: "03",
      title: "Houkuttelukielto, brändi ja liikesalaisuudet",
      body: [
        "En houkuttele enkä värvää Brändin muita tekijöitä, asiakkaita tai yhteistyökumppaneita pois Brändiltä yhteistyön aikana enkä 12 kuukauteen sen päättymisestä.",
        "En esiinny Puuhapatetina enkä käytä Brändin nimeä, tunnuksia, työkaluja tai mainetta yhteistyön päätyttyä.",
        "Brändin asiakaslistat, hinnoittelu, sopimusmallit, työkalut ja muu liiketoimintatieto ovat liikesalaisuuksia. En käytä niitä Brändin ulkopuolella enkä luovuta niitä kenellekään.",
      ],
    },
    {
      no: "04",
      title: "Sopimussakko ja seuraukset",
      body: [
        "Jos rikon tämän sopimusosan ehtoja, Brändillä on oikeus sopimussakkoon, jonka määrä on 2 000 € kutakin rikkomusta kohden, sekä jatkuvan rikkomuksen osalta 500 € jokaiselta alkavalta viikolta.",
        "Sopimussakon lisäksi Brändillä on oikeus vaatia korvausta sakon ylittävästä todellisesta vahingosta sekä vaatia rikkomuksen lopettamista.",
        "Ehdot jäävät voimaan yhteistyön päättymisestä riippumatta sen syystä.",
      ],
    },
  ],
  clauses: [
    { id: "asiakkaat", text: "Ymmärrän, että Brändin kautta syntyneet asiakkaat ja kohteet kuuluvat Puuhapatetille, enkä vie, jatka tai hoida heitä Brändin ohi enkä ryhdy heidän omaksi toimittajakseen (24 kk)." },
    { id: "kilpailu", text: "Sitoudun kilpailukieltoon Brändin asiakkaisiin ja kohteisiin nähden (12 kk yhteistyön jälkeen)." },
    { id: "houkuttelu", text: "Sitoudun houkuttelukieltoon, en esiinny Brändinä jälkikäteen enkä käytä Brändin liikesalaisuuksia (12 kk)." },
    { id: "sakko", text: "Hyväksyn, että ehtojen rikkomisesta voi seurata 2 000 €:n sopimussakko rikkomusta kohden sekä vahingonkorvaus." },
  ],
  accept: "Olen lukenut asiakassuoja- ja kilpailukieltoehdot ja hyväksyn ne sitovasti. Allekirjoitukseni sitoo minua näihin ehtoihin.",
};

// ─── 4. Tiimi, jatkuvuus & kasvu (positiivinen, molemminpuolinen) ───────────────

const TIIMI: WorkerAgreement = {
  id: "tiimi",
  title: "Tiimi, jatkuvuus & kasvu",
  tagline: "Olet osa Brändiä · hyvästä työstä lisää töitä ja parempi korvaus · reilusti molempiin suuntiin",
  intro:
    "Edelliset osat suojaavat Brändiä — tämä osa kertoo, mitä sinä saat. Haluamme pitkäaikaisia tekijöitä, " +
    "emme kertakäyttöisiä. Kun teet hyvää ja luotettavaa työtä, haluamme että jatkat kanssamme ja kasvat " +
    "Brändin mukana. Yhteistyö on reilua molempiin suuntiin: me tuomme työn, työkalut ja maksamme " +
    "ajallaan; sinä tuot laadun ja luotettavuuden.",
  sections: [
    {
      no: "01",
      title: "Olet osa Puuhapatet-brändiä",
      body: [
        "Et ole nimetön alihankkija vaan osa tiimiä. Edustat Brändiä työmaalla, ja Brändi seisoo sinun takanasi: hyvä työsi näkyy, ja saat siitä tunnustusta ja suosituksia.",
        "Saat käyttöösi samat työkalut kuin koko tiimi: reaaliaikaisen seurannan, läpinäkyvän ansionäkymän ja selkeät ohjeet.",
      ],
    },
    {
      no: "02",
      title: "Hyvästä työstä palkitaan — jatkuvuus on ansaittua",
      body: [
        "Jatko perustuu tekoihin: kun teet työn laadukkaasti, luotettavasti ja sovitusti, saat lisää töitä, etusijan tulevissa keikoissa ja mahdollisuuden korkeampaan ikkunakohtaiseen korvaukseen.",
        "Jos työn laatu, luotettavuus tai turvallisuus eivät täytä sovittua, yhteistyö voi vähentyä tai päättyä. Tämä on reilua molemmille: hyvä työ palkitaan, eikä kenenkään tarvitse kantaa heikkoa jälkeä.",
        "Korvauksen ja vastuun kasvu sovitaan aina avoimesti ja etukäteen — ei yllätyksiä kumpaankaan suuntaan.",
      ],
    },
    {
      no: "03",
      title: "Mitä saat meiltä",
      body: [
        "Läpinäkyvä, ikkunakohtainen korvaus, jonka näet kertyvän reaaliajassa omalta työpöydältäsi.",
        "Maksut hoidetaan sovitusti ja ajallaan, omilla laskutustiedoillasi — ei kikkailua.",
        "Joustava työ: teet sovitut keikat oman aikataulusi ja jaksamisesi mukaan turvallisuus edellä.",
        "Suosittelu ja referenssi hyvästä työstä, kun sitä tarvitset, sekä tuki ja opastus työn tekemiseen.",
      ],
    },
    {
      no: "04",
      title: "Mitä odotamme sinulta",
      body: [
        "Laadukasta ja huolellista jälkeä, rehellistä merkintää tehdystä työstä ja sovitun aikataulun kunnioittamista.",
        "Avointa viestintää: kerrot ajoissa, jos jokin ei onnistu, viivästyy tai kohteessa on ongelma.",
        "Brändin hyvää edustamista asiakkaan tiloissa — siisti, ystävällinen ja luotettava ote.",
      ],
    },
  ],
  clauses: [
    { id: "osa", text: "Haluan olla osa Puuhapatet-tiimiä ja edustaa Brändiä hyvin asiakkaan tiloissa." },
    { id: "jatko", text: "Ymmärrän, että yhteistyön jatko ja korvauksen kasvu perustuvat hyvään, luotettavaan työhön — ja että ne sovitaan avoimesti." },
    { id: "viestinta", text: "Sitoudun laadukkaaseen jälkeen, rehelliseen merkintään ja avoimeen viestintään." },
  ],
  accept: "Haluan jatkaa Puuhapatetin kanssa pitkäjänteisesti ja sitoudun yllä oleviin yhteisiin pelisääntöihin.",
};

export const WORKER_AGREEMENTS: WorkerAgreement[] = [ALIHANKINTA, TIETOTURVA, ASIAKASSUOJA, TIIMI];

/** Every agreement — used to resolve an id to its document. */
export const ALL_AGREEMENTS: WorkerAgreement[] = [...WORKER_AGREEMENTS];

export function agreementById(id: string): WorkerAgreement | undefined {
  return ALL_AGREEMENTS.find((a) => a.id === id);
}

/** All agreement ids a worker must have signed (current version) to pass the gate. */
export const REQUIRED_AGREEMENT_IDS = WORKER_AGREEMENTS.map((a) => a.id);

// ─── Per-worker agreement sets ──────────────────────────────────────────────────
// A worker can be placed on a LIGHTER set per person WITHOUT changing any agreement
// text and WITHOUT bumping WORKER_AGREEMENT_VERSION — so nobody who already signed
// is ever forced to re-sign. This mirrors the trainee mechanism (which requires an
// empty set), but for full alihankkijat who just need a lighter package.
//
//   • "standard" — the full package (default): subcontractor + data/safety +
//     customer-protection/non-compete + long-term team commitment. For career hires.
//   • "kevyt"    — a short-term / external entrepreneur who runs his own book:
//     ONLY the subcontractor agreement + data/key/safety. NO post-term kilpailukielto,
//     NO 24 kk asiakassuoja + 2 000 € sopimussakko, NO long-term (TIIMI) commitment.
//     Tietoturva still forbids using customer/site data behind the brand, so basic
//     confidentiality is kept while the heavy covenants are dropped.

export type WorkerAgreementSet = "standard" | "kevyt";

export const AGREEMENT_SETS: Record<WorkerAgreementSet, string[]> = {
  standard: [ALIHANKINTA.id, TIETOTURVA.id, ASIAKASSUOJA.id, TIIMI.id],
  kevyt: [ALIHANKINTA.id, TIETOTURVA.id],
};

export function normalizeAgreementSet(set: unknown): WorkerAgreementSet {
  return set === "kevyt" ? "kevyt" : "standard";
}

/** The agreement ids a given set requires at the current version. */
export function requiredAgreementIdsForSet(set: WorkerAgreementSet | undefined | null): string[] {
  return AGREEMENT_SETS[normalizeAgreementSet(set)];
}

// ─── Profile questionnaire (prebaked, "profile-optimizing") ─────────────────────

export interface ProfileQuestion {
  id: string;
  label: string;
  placeholder?: string;
  type: "text" | "tel" | "email" | "textarea";
  required?: boolean;
  help?: string;
}

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  { id: "fullName", label: "Koko nimi", type: "text", required: true, placeholder: "Etunimi Sukunimi" },
  { id: "phone", label: "Puhelinnumero", type: "tel", required: true, placeholder: "+358 40 …" },
  { id: "email", label: "Sähköposti", type: "email", required: true, placeholder: "nimi@esimerkki.fi" },
  { id: "address", label: "Osoite", type: "text", placeholder: "Katuosoite, postinumero ja kaupunki" },
  { id: "yTunnus", label: "Y-tunnus (jos on)", type: "text", placeholder: "1234567-8", help: "Tarvitaan laskutukseen. Voit hankkia sen myös ennen ensimmäistä laskua." },
  { id: "iban", label: "Tilinumero (IBAN)", type: "text", placeholder: "FI…", help: "Korvausten maksua varten." },
  { id: "experience", label: "Aiempi kokemus ikkunanpesusta tai siivouksesta", type: "textarea", placeholder: "Kerro lyhyesti…" },
  { id: "transport", label: "Miten pääset työmaalle? (oma auto / julkiset)", type: "text" },
  { id: "heights", label: "Oletko valmis työskentelemään korkeilla paikoilla / tikkailla?", type: "text", placeholder: "Kyllä / Ei / Riippuu" },
  { id: "availability", label: "Toivotut työajat", type: "textarea", placeholder: "Milloin sinulle parhaiten sopii tehdä töitä? Esim. arkisin, viikonloppuisin, kokopäiväisesti…", help: "Suunnittelemme vuorot näiden mukaan — ei tarkkoja lupauksia, vaan mikä sinulle sopisi." },
  { id: "motivation", label: "Toiveita tai odotuksia työltä?", type: "textarea", placeholder: "Vapaa sana — esim. mihin haluaisit panostaa tai oppia (vapaaehtoinen)" },
];

export const PROFILE_REQUIRED_IDS = PROFILE_QUESTIONS.filter((q) => q.required).map((q) => q.id);

// ─── Insurance status + risk acknowledgement (asked during onboarding) ──────────
// The worker states whether their insurances are in force (they may start without
// and update later), and must explicitly accept that they carry the risk either
// way. Stored in the profile answers under these keys.

export const INSURANCE_ANSWER_KEY = "insuranceValid"; // "kylla" | "ei"
export const RISK_ACK_KEY = "riskAck";                 // "1" once accepted
export const YTUNNUS_STATUS_KEY = "ytunnusStatus";     // "on" (jo) | "tulossa"

export const INSURANCE_QUESTION =
  "Onko sinulla voimassa olevat vakuutukset? (toiminnan vastuuvakuutus ja tapaturmavakuutus)";
export const INSURANCE_LATER_NOTE =
  "Voit aloittaa ilman ja päivittää tiedon myöhemmin työpöydältä, kun hankit vakuutukset.";
export const RISK_ACK_TEXT =
  "Ymmärrän, että teen työn omalla riskilläni ja vastaan aiheuttamistani vahingoista myös silloin, kun vakuutusta ei ole voimassa.";
