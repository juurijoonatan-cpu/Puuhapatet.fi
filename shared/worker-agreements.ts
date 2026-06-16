/**
 * Worker (alihankkija) onboarding — agreements + profile questionnaire.
 *
 * These are the documents a gig worker signs BEFORE the worker dashboard opens
 * ("the intro is the signing"). The model is a hybrid:
 *   1. Alihankkijasopimus — the binding subcontractor agreement (independent
 *      contractor, own Y-tunnus, own insurance & liability, €/window pay model).
 *   2. Tietosuoja & turvallisuus — data-protection + safety acknowledgement.
 *   3. Yhteistyön jatko — a light "we'd love you to continue with us" commitment
 *      + customer non-circumvention (kept soft on purpose).
 *
 * ⚠️  LEGAL REVIEW REQUIRED. This text is a carefully-written Finnish template
 * modelled on the existing Puuhapatet member-agreement / FR8 contract, but it
 * has NOT been reviewed by a lawyer. Have a Finnish lawyer review the
 * alihankkija + non-circumvention clauses before relying on them in a real
 * engagement. Bump WORKER_AGREEMENT_VERSION to force everyone to re-sign.
 */

export const WORKER_AGREEMENT_VERSION = "2026-06";

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
  id: string;        // "alihankinta" | "tietoturva" | "jatko"
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
  tagline: "Itsenäinen alihankkija · oma Y-tunnus & vakuutus · 20 € / pesty ikkuna",
  intro:
    "Tämä sopimus solmitaan Puuhapatet-brändin (jäljempänä “Brändi”, jota edustavat " +
    "isännät Joonatan Juuri ja Matias Pitkänen) ja allekirjoittavan tekijän (jäljempänä " +
    "“Alihankkija”) välillä. Alihankkija tekee työn itsenäisenä yrittäjänä omaan lukuunsa " +
    "ja laskuttaa työstään Brändiä alla kuvatun mallin mukaisesti. Kyseessä ei ole " +
    "työsuhde eikä virkasuhde.",
  sections: [
    {
      no: "01",
      title: "Asema ja itsenäisyys",
      body: [
        "Toimin itsenäisenä alihankkijana (kevytyrittäjä tai oma toiminimi/yritys) enkä työsuhteessa Brändiin.",
        "Vastaan itse omasta verotuksestani, ennakkoperinnästä, mahdollisesta YEL-vakuutuksesta sekä lakisääteisistä maksuistani.",
        "Minulla on tai hankin oman toimintani edellyttämän Y-tunnuksen ja laskutuskanavan ennen työn aloittamista.",
        "Päätän itse työni tekotavasta ja työvälineistä sovittujen laatu- ja turvallisuusvaatimusten rajoissa.",
      ],
    },
    {
      no: "02",
      title: "Korvaus ja laskutus",
      body: [
        "Korvaus on 20 € jokaisesta hyväksytysti pestystä ikkunasta (urakkaperusteinen suoriteveloitus).",
        "Korvaus perustuu reaaliaikaiseen seurantaan: jokainen kartalle “pesty”-tilaan merkitty ikkuna kerryttää korvaustani.",
        "Vain todellisuudessa ja huolellisesti pestyt ikkunat kerryttävät korvausta. Huonokuntoiset, ohitetut tai virheellisesti merkityt ikkunat eivät kerrytä korvausta, ja Brändillä on oikeus oikaista virheelliset merkinnät.",
        "Laskutan korvaukseni Brändiltä sovituin väliajoin oman Y-tunnukseni kautta. En peri maksuja suoraan asiakkaalta enkä laskuta Brändin asiakkaita omaan lukuuni.",
        "Hinnat ovat arvonlisäverottomia, ellei toisin sovita. Vastaan itse oman toimintani mahdollisesta arvonlisäverovelvollisuudesta.",
      ],
    },
    {
      no: "03",
      title: "Vastuu, vakuutus ja vahingot",
      body: [
        "Vastaan oman työni laadusta ja huolellisuudesta.",
        "Vastaan itse omasta vakuutusturvastani (mm. tapaturma- ja vastuuvakuutus) siltä osin kuin oma toimintani sitä edellyttää, ja huolehdin, ettei vakuutusturvani ole puutteellinen työn aikana.",
        "Ilmoitan vahingoista ja vaaratilanteista välittömästi isännille. Tuottamuksella aiheuttamistani vahingoista vastaan oman toimintani ja vakuutusteni mukaisesti.",
        "Ennen työtä valokuvadokumentoidut vauriot sekä huonokuntoisista rakenteista huolellisesta työstä huolimatta aiheutuvat seuraukset eivät ole vastuullani.",
        "Käytän työvälineitä, avaimia ja kulkuoikeuksia huolellisesti ja palautan kaiken minulle uskotun omaisuuden pyydettäessä.",
      ],
    },
    {
      no: "04",
      title: "Laatu, turvallisuus ja työmaa",
      body: [
        "Teen työn sovitun laatutason mukaisesti ja noudatan työmaan sääntöjä sekä turvallisuusohjeita.",
        "Turvallisuus on aina etusijalla. En ota tarpeettomia riskejä korkealla työskennellessäni enkä työskentele päihteiden vaikutuksen alaisena.",
        "Aloitan ajanseurannan työmaalle saapuessani ja merkitsen tekemäni ikkunat rehellisesti karttaan.",
        "Minulla on oikeus jättää huonokuntoinen tai vaarallinen ikkuna pesemättä (kuntovaraus) ilman seuraamuksia.",
      ],
    },
    {
      no: "05",
      title: "Luottamuksellisuus",
      body: [
        "Käsittelen asiakas- ja kohdetietoja luottamuksellisesti enkä luovuta niitä ulkopuolisille.",
        "Luottamuksellisuus jatkuu myös yhteistyön päätyttyä.",
      ],
    },
    {
      no: "06",
      title: "Sovellettava laki ja erimielisyydet",
      body: [
        "Sopimukseen sovelletaan Suomen lakia.",
        "Erimielisyydet pyritään ensisijaisesti ratkaisemaan neuvottelemalla; muutoin asia käsitellään tekijän kotipaikan käräjäoikeudessa.",
      ],
    },
  ],
  clauses: [
    { id: "itsenainen", text: "Ymmärrän toimivani itsenäisenä alihankkijana, en työsuhteessa, ja vastaavani omista veroistani ja maksuistani." },
    { id: "vakuutus", text: "Vastaan itse omasta vakuutusturvastani ja vastuustani työn aikana." },
    { id: "korvaus", text: "Hyväksyn korvausmallin 20 € / pesty ikkuna ja laskutan korvaukseni oman Y-tunnukseni kautta." },
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
    "Vahvistan noudattavani Puuhapatetin tietosuoja- ja turvallisuuskäytäntöjä koko " +
    "yhteistyön ajan.",
  sections: [
    {
      no: "01",
      title: "Asiakastiedot ja tietosuoja",
      body: [
        "Käytän asiakas- ja kohdetietoja vain työn tekemiseen enkä kopioi niitä Brändin järjestelmien ulkopuolelle.",
        "En jaa kuvia, osoitteita tai muita kohdetietoja somessa tai ulkopuolisille ilman lupaa.",
      ],
    },
    {
      no: "02",
      title: "Avaimet ja kulkuoikeudet",
      body: [
        "Säilytän avaimia ja kulkulupia huolellisesti enkä luovuta niitä ulkopuolisille.",
        "Ilmoitan heti, jos avain katoaa tai kulkuoikeuksissa on ongelma.",
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
    { id: "tietosuoja", text: "Sitoudun käsittelemään asiakas- ja kohdetietoja luottamuksellisesti." },
    { id: "turvallisuus", text: "Sitoudun noudattamaan turvallisia työtapoja ja huolelliseen avaintenkäsittelyyn." },
  ],
  accept: "Hyväksyn tietosuoja- ja turvallisuuskäytännöt.",
};

// ─── 3. Yhteistyön jatko (kevyt sitoumus) ──────────────────────────────────────

const JATKO: WorkerAgreement = {
  id: "jatko",
  title: "Yhteistyön jatko",
  tagline: "Kevyt sitoumus jatkaa Puuhapatetin kautta",
  intro:
    "Tämä on kevyt, hyvässä hengessä tehty sitoumus. Toivomme, että tämän keikan " +
    "jälkeen jatkat tekijänä Puuhapatetin kautta — ja samalla varmistamme, ettei " +
    "Brändin kautta syntyneitä asiakkaita viedä ohi sovitun mallin.",
  sections: [
    {
      no: "01",
      title: "Toive jatkosta",
      body: [
        "Tarkoituksena on, että tämä keikka on alku pidemmälle yhteistyölle: saat lisää keikkoja ja voit myöhemmin liittyä osaksi Brändiä laajemmin.",
        "Sitoumus ei estä sinua opiskelemasta tai tekemästä muuta työtä.",
      ],
    },
    {
      no: "02",
      title: "Asiakkaat kuuluvat Brändille",
      body: [
        "Brändin kautta syntyneet asiakkaat ja kohteet kuuluvat Puuhapatetille.",
        "En tarjoa, myy enkä tee vastaavaa palvelua näille asiakkaille ohi Brändin yhteistyön aikana enkä 12 kuukauteen sen päättymisestä. Kyse on vain siitä, etten vie Brändin kautta syntyneitä asiakkaita itselleni tai kilpailijalle.",
        "En houkuttele Brändin muita tekijöitä tai asiakkaita pois Brändiltä.",
      ],
    },
  ],
  clauses: [
    { id: "jatko", text: "Ymmärrän toiveen jatkaa yhteistyötä Puuhapatetin kautta." },
    { id: "asiakkaat", text: "En vie Brändin kautta syntyneitä asiakkaita itselleni tai kilpailijalle (12 kk)." },
  ],
  accept: "Hyväksyn yhteistyön jatkoa koskevan kevyen sitoumuksen.",
};

export const WORKER_AGREEMENTS: WorkerAgreement[] = [ALIHANKINTA, TIETOTURVA, JATKO];

export function agreementById(id: string): WorkerAgreement | undefined {
  return WORKER_AGREEMENTS.find((a) => a.id === id);
}

/** All agreement ids a worker must have signed (current version) to pass the gate. */
export const REQUIRED_AGREEMENT_IDS = WORKER_AGREEMENTS.map((a) => a.id);

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
  { id: "city", label: "Kotikaupunki", type: "text", placeholder: "Esim. Espoo" },
  { id: "yTunnus", label: "Y-tunnus (jos on)", type: "text", placeholder: "1234567-8", help: "Tarvitaan laskutukseen. Voit hankkia sen myös ennen ensimmäistä laskua." },
  { id: "iban", label: "Tilinumero (IBAN)", type: "text", placeholder: "FI…", help: "Korvausten maksua varten." },
  { id: "experience", label: "Aiempi kokemus ikkunanpesusta tai siivouksesta", type: "textarea", placeholder: "Kerro lyhyesti…" },
  { id: "transport", label: "Miten pääset työmaalle? (oma auto / julkiset)", type: "text" },
  { id: "heights", label: "Oletko valmis työskentelemään korkeilla paikoilla / tikkailla?", type: "text", placeholder: "Kyllä / Ei / Riippuu" },
  { id: "availability", label: "Milloin olet käytettävissä?", type: "textarea", placeholder: "Päivät ja kellonajat…" },
  { id: "motivation", label: "Miksi haluat liittyä — ja haluatko jatkaa jatkossa?", type: "textarea", placeholder: "Vapaa sana…" },
];

export const PROFILE_REQUIRED_IDS = PROFILE_QUESTIONS.filter((q) => q.required).map((q) => q.id);
