/**
 * Puuhapatet member agreement & policies — single source of truth.
 *
 * Two variants, both signed inside the admin before the tools open:
 *   • "founder" — for the founders (HOST). Co-ownership / stewardship tone.
 *   • "worker"  — for current and upcoming workers (STAFF). Membership tone with
 *                 balanced non-circumvention so customers stay with the brand.
 *
 * The text is personalised with the member's name, role, Y-tunnus and their
 * real service-fee rate (shared/team.ts). Bump AGREEMENT_VERSION to require
 * everyone to read the changes and re-sign.
 *
 * Legal note: some members are minors (alle 18 v). The worker variant therefore
 * relies on customer non-circumvention + confidentiality rather than a heavy
 * post-term non-compete, and asks for a guardian's name when the signer is a
 * minor. Have a professional review before relying on it in a dispute.
 */

import { HOST_SERVICE_FEE_PCT, type TeamRole } from "./team";

/** Bump this (e.g. add "-2") whenever the agreement text materially changes. */
export const AGREEMENT_VERSION = "2026-06";

export type AgreementType = "founder" | "worker";

export interface AgreementParty {
  userId: string;
  name: string;
  role: TeamRole;
  yTunnus?: string;
  feePct: number;       // this member's service-fee percentage
  isUnder18?: boolean;
}

export interface AgreementSectionDoc {
  no: string;
  title: string;
  body: string[];       // paragraphs; a line starting with "• " renders as a bullet
}

export interface PolicyDoc {
  id: string;
  title: string;
  points: string[];
}

export interface AgreementDoc {
  type: AgreementType;
  version: string;
  title: string;
  subtitle: string;
  intro: string;
  sections: AgreementSectionDoc[];
  policies: PolicyDoc[];
  closing: string;
}

export function agreementTypeForRole(role: TeamRole): AgreementType {
  return role === "HOST" ? "founder" : "worker";
}

// ─── Policies (acknowledged with their own checkboxes) ───────────────────────

export const POLICIES: PolicyDoc[] = [
  {
    id: "tietosuoja",
    title: "Tietosuoja & asiakastiedot",
    points: [
      "Asiakas- ja kohdetiedot ovat luottamuksellisia. Käsittelen niitä vain Puuhapatetin työn tekemiseen ja vain niin kauan kuin se on tarpeen.",
      "En vie, kopioi tai jaa asiakas-, hinta- tai kohdetietoja Puuhapatetin järjestelmien ulkopuolelle enkä kolmansille.",
      "Noudatan tietosuojalainsäädäntöä (GDPR) ja Puuhapatetin tietosuojakäytäntöä (puuhapatet.fi/tietosuoja).",
    ],
  },
  {
    id: "turvallisuus",
    title: "Turvallisuus & avaimet",
    points: [
      "Työskentelen turvallisesti, en ota tarpeettomia riskejä korkealla tai sähkön lähellä, ja keskeytän työn jos sitä ei voi tehdä turvallisesti.",
      "Säilytän kohteiden avaimet huolellisesti ilman tunnistetietoja, en luovuta niitä kolmansille ja palautan ne kuittausta vastaan.",
      "Ilmoitan vahingoista, läheltä piti -tilanteista ja avainten katoamisesta heti.",
    ],
  },
  {
    id: "laatu",
    title: "Laatu & asiakaspalvelu",
    points: [
      "Teen työn huolellisesti ja sovitun laatutason mukaisesti, dokumentoin tarvittaessa ja korjaan aiheelliset reklamaatiot.",
      "Käyttäydyn asiakkaita ja kohteita kohtaan kohteliaasti ja edustan Puuhapatetia hyvin.",
      "Pidän kiinni sovituista aikatauluista tai ilmoitan muutoksista hyvissä ajoin.",
    ],
  },
  {
    id: "some",
    title: "Brändi & sosiaalinen media",
    points: [
      "Käytän Puuhapatet-nimeä, logoa ja materiaaleja vain Puuhapatetin työssä ja brändiohjeiden mukaisesti.",
      "Julkaisen asiakaskohteista sisältöä vain luvalla enkä esiinny Puuhapatetin edustajana tavalla, jota ei ole sovittu.",
    ],
  },
  {
    id: "raha",
    title: "Rahaliikenne & rehellisyys",
    points: [
      "Laskutan asiakkaita vain Puuhapatetin sovitun mallin kautta enkä ota maksuja ohi sovitun.",
      "Kirjaan tunnit, kulut ja työt totuudenmukaisesti ja vastaan omista veroistani ja Y-tunnukseni velvoitteista.",
      "Toimin rehellisesti rahaan ja sopimuksiin liittyvissä asioissa.",
    ],
  },
];

// ─── Shared clauses ──────────────────────────────────────────────────────────

function brandSection(): AgreementSectionDoc {
  return {
    no: "01",
    title: "Puuhapatet-ekosysteemi",
    body: [
      "Puuhapatet on yhteinen brändi ja toimintaympäristö, jonka kautta teemme palvelukeikkoja (mm. ikkunanpesua) yhdessä. Ekosysteemiin kuuluu yhteinen nimi, maine, asiakkaat, järjestelmät, työvälineet, ohjeet ja hinnoittelumalli.",
      "Tämä sopimus määrittää, miten toimin osana Puuhapatetia: miten työ tehdään, miten raha liikkuu ja miten pidämme yhdessä huolta asiakkaista ja brändistä.",
    ],
  };
}

function dataConfidentialitySection(no: string): AgreementSectionDoc {
  return {
    no,
    title: "Luottamuksellisuus ja tietosuoja",
    body: [
      "Asiakastiedot, hinnoittelu, kohdetiedot, sopimukset ja Puuhapatetin sisäiset tiedot ovat luottamuksellisia. Käytän niitä vain Puuhapatetin työhön.",
      "En luovuta enkä vie näitä tietoja brändin ulkopuolelle. Velvoite jatkuu myös sen jälkeen, kun en enää toimi Puuhapatetissa.",
      "Noudatan tietosuojalainsäädäntöä ja Puuhapatetin tietosuojakäytäntöä.",
    ],
  };
}

function insuranceSection(no: string): AgreementSectionDoc {
  return {
    no,
    title: "Vastuu, vakuutus ja työvälineet",
    body: [
      "Teen työn huolellisesti ja vastaan oman työni laadusta. Ilmoitan vahingoista heti, ja vahingot käsitellään Puuhapatetin toiminnan vastuuvakuutuksen ja sovittujen käytäntöjen mukaisesti.",
      "Käytän työvälineitä ja avaimia huolellisesti ja palautan brändin omaisuuden pyydettäessä.",
    ],
  };
}

function minorSection(no: string): AgreementSectionDoc {
  return {
    no,
    title: "Alaikäinen allekirjoittaja",
    body: [
      "Jos olen alle 18-vuotias, vahvistan, että huoltajani on tietoinen tästä sopimuksesta ja hyväksyy osallistumiseni. Huoltajan nimi merkitään allekirjoituksen yhteyteen.",
      "Verotukseen ja OmaVeroon liittyvät asiat hoidetaan tarvittaessa huoltajan myötävaikutuksella.",
    ],
  };
}

function lawSection(no: string): AgreementSectionDoc {
  return {
    no,
    title: "Sovellettava laki ja erimielisyydet",
    body: [
      "Sopimukseen sovelletaan Suomen lakia. Erimielisyydet pyritään ratkaisemaan ensisijaisesti keskustelemalla. Tämä sopimus täydentää, ei korvaa, pakottavaa lainsäädäntöä.",
    ],
  };
}

// ─── Worker variant ──────────────────────────────────────────────────────────

function workerAgreement(p: AgreementParty): AgreementDoc {
  const fee = p.feePct;
  const sections: AgreementSectionDoc[] = [
    brandSection(),
    {
      no: "02",
      title: "Asemani ja itsenäisyys",
      body: [
        "Toimin Puuhapatetissa itsenäisenä tekijänä (kevytyrittäjä / 4H-yrittäjä) omalla Y-tunnuksellani. En ole työsuhteessa enkä työnantajan alainen, vaan teen sovittuja keikkoja osana brändiä.",
        p.yTunnus ? `Y-tunnukseni: ${p.yTunnus}.` : "Ilmoitan Y-tunnukseni Puuhapatetille ja vastaan sen velvoitteista.",
        "Vastaan itse omista veroistani ja ilmoituksistani.",
      ],
    },
    {
      no: "03",
      title: "Raha, laskutus ja palvelumaksu",
      body: [
        "Asiakkaita laskutetaan Puuhapatetin sovitun mallin kautta. Saan oman osuuteni tehdystä työstä sovitun jaon mukaisesti.",
        `Osuudestani brändille maksettava palvelumaksu on ${fee} % nettotulosta (hinta − kulut). Palvelumaksu kattaa brändin, asiakashankinnan, järjestelmät, ohjeet ja yhteiset kulut.`,
        "Tunnit, kulut ja työt kirjataan totuudenmukaisesti järjestelmään. Maksut ja tilitykset tapahtuvat sovitun aikataulun mukaisesti.",
        "En ota asiakkailta maksuja ohi sovitun mallin enkä laskuta Puuhapatetin asiakkaita omaan lukuuni.",
      ],
    },
    {
      no: "04",
      title: "Asiakkaat kuuluvat Puuhapatetille (kilpailukielto kevyesti)",
      body: [
        "Asiakkaat ja liidit, jotka olen saanut Puuhapatetin kautta tai sen nimissä, kuuluvat Puuhapatetille. Asiakassuhteet, yhteystiedot ja sopimukset ovat brändin omaisuutta.",
        "En tarjoa, myy enkä tee vastaavaa palvelua näille asiakkaille Puuhapatetin ohi — en jäsenyyteni aikana enkä 12 kuukauteen sen päättymisen jälkeen. En myöskään houkuttele Puuhapatetin asiakkaita tai tekijöitä pois brändistä.",
        "Tämä ei estä minua tekemästä muuta työtä tai opiskelemasta. Kyse on vain siitä, etten vie Puuhapatetin kautta syntyneitä asiakkaita itselleni tai kilpailijalle.",
        "Jos asiakas ottaa minuun suoraan yhteyttä uudesta työstä, ohjaan sen Puuhapatetin kautta.",
      ],
    },
    dataConfidentialitySection("05"),
    insuranceSection("06"),
    {
      no: "07",
      title: "Brändi ja käytös",
      body: [
        "Edustan Puuhapatetia hyvin ja noudatan brändi-, laatu- ja some-käytäntöjä. Käytän Puuhapatet-nimeä ja -materiaaleja vain brändin työssä.",
      ],
    },
    minorSection("08"),
    {
      no: "09",
      title: "Voimassaolo ja päättyminen",
      body: [
        "Tämä sopimus on voimassa toistaiseksi. Kumpi tahansa osapuoli voi päättää yhteistyön ilmoittamalla siitä toiselle. Keskeneräiset keikat hoidetaan loppuun tai sovitaan siirrosta.",
        "Päättymisen jälkeenkin jäävät voimaan luottamuksellisuus ja kohdan 04 asiakkaita koskevat ehdot (12 kk).",
        "Olennainen rikkomus (esim. asiakkaiden vieminen, vilppi rahaan liittyen) voi johtaa yhteistyön välittömään päättymiseen.",
      ],
    },
    lawSection("10"),
  ];

  return {
    type: "worker",
    version: AGREEMENT_VERSION,
    title: "Puuhapatet — Tekijän sopimus ja käytännöt",
    subtitle: `${p.name} · palvelumaksu ${fee} %`,
    intro:
      "Tervetuloa Puuhapatetin tiimiin. Tämä sopimus kokoaa yhteen, miten toimimme: itsenäisinä tekijöinä yhteisen brändin alla, reilusti ja laadukkaasti. Lue läpi, hyväksy käytännöt ja allekirjoita — sen jälkeen pääset käyttämään admin-työkaluja.",
    sections,
    policies: POLICIES,
    closing:
      "Hyväksymällä vahvistan lukeneeni ja ymmärtäneeni tämän sopimuksen ja käytännöt ja sitoudun noudattamaan niitä osana Puuhapatetia.",
  };
}

// ─── Founder variant ─────────────────────────────────────────────────────────

function founderAgreement(p: AgreementParty): AgreementDoc {
  const sections: AgreementSectionDoc[] = [
    brandSection(),
    {
      no: "02",
      title: "Perustajan rooli ja sitoutuminen",
      body: [
        "Olen Puuhapatetin perustaja ja yhteinen vastuunkantaja. Rakennan ja hoidan brändiä, asiakkaita ja tiimiä yhdessä toisen perustajan kanssa pitkäjänteisesti ja lojaalisti.",
        "Toimin omalla Y-tunnuksellani itsenäisenä yrittäjänä." + (p.yTunnus ? ` Y-tunnukseni: ${p.yTunnus}.` : ""),
        "Teemme brändiä koskevat olennaiset päätökset (mm. hinnoittelu, rekrytointi, isot hankinnat ja yhteistyöt) yhdessä ja hyvässä yhteisymmärryksessä.",
      ],
    },
    {
      no: "03",
      title: "Raha ja palvelumaksu",
      body: [
        `Perustajan palvelumaksu brändille on ${HOST_SERVICE_FEE_PCT} % oman osuuden nettotulosta. Yhteiset kulut, investoinnit ja brändin kassa hoidetaan yhdessä sovitusti ja läpinäkyvästi.`,
        "Tilitykset, investoinnit ja yhteiset varat kirjataan järjestelmään niin, että molemmat perustajat näkevät tilanteen.",
      ],
    },
    {
      no: "04",
      title: "Asiakkaat ja brändi ovat yhteistä omaisuutta",
      body: [
        "Asiakkaat, asiakassuhteet, liidit, sopimukset, nimi, maine ja järjestelmät ovat Puuhapatetin yhteistä omaisuutta. En ota niitä itselleni enkä vie niitä brändin ulkopuolelle.",
        "En kilpaile Puuhapatetin kanssa sen asiakkaista enkä houkuttele asiakkaita tai tekijöitä pois — en yhteistyön aikana enkä 12 kuukauteen sen jälkeen.",
      ],
    },
    dataConfidentialitySection("05"),
    insuranceSection("06"),
    minorSection("07"),
    {
      no: "08",
      title: "Yhteistyön muutokset ja päättyminen",
      body: [
        "Jos perustaja haluaa irtautua, siitä sovitaan yhdessä reilusti: asiakkaat, brändi ja yhteiset varat pysyvät Puuhapatetilla, ja mahdollinen järjestely sovitaan kirjallisesti.",
        "Luottamuksellisuus ja asiakkaita koskevat ehdot jäävät voimaan myös päättymisen jälkeen.",
      ],
    },
    lawSection("09"),
  ];

  return {
    type: "founder",
    version: AGREEMENT_VERSION,
    title: "Puuhapatet — Perustajasopimus",
    subtitle: `${p.name} · perustaja · palvelumaksu ${HOST_SERVICE_FEE_PCT} %`,
    intro:
      "Tämä on perustajien yhteinen sopimus siitä, miten rakennamme ja hoidamme Puuhapatetia: yhdessä, lojaalisti ja läpinäkyvästi. Lue läpi, hyväksy käytännöt ja allekirjoita.",
    sections,
    policies: POLICIES,
    closing:
      "Hyväksymällä sitoudun rakentamaan ja hoitamaan Puuhapatetia yhteisten sääntöjen ja käytäntöjen mukaisesti.",
  };
}

export function buildAgreement(p: AgreementParty): AgreementDoc {
  return agreementTypeForRole(p.role) === "founder" ? founderAgreement(p) : workerAgreement(p);
}

// ─── Signature record ────────────────────────────────────────────────────────

export interface MemberAgreementSignature {
  version: string;
  type: AgreementType;
  userId: string;
  signedAt: number;            // epoch ms
  signerName: string;
  place?: string;
  guardianName?: string;       // for minors
  snapshot: { name: string; role: TeamRole; yTunnus?: string; feePct: number };
  acceptedPolicyIds: string[];
  signatureDataUrl: string;
  ip?: string;
  userAgent?: string;
}

/** localStorage key (per device) caching the current user's signed agreement. */
export const MEMBER_AGREEMENT_KEY = "puuhapatet_member_agreement_v1";

/** True when the signature exists and matches the current agreement version. */
export function signatureIsCurrent(
  sig: Pick<MemberAgreementSignature, "version"> | null | undefined,
  version: string = AGREEMENT_VERSION,
): boolean {
  return !!sig && sig.version === version;
}

/** Server-side validation of an incoming signature. Returns null if invalid. */
export function sanitizeMemberSignature(input: any): MemberAgreementSignature | null {
  if (!input || typeof input !== "object") return null;
  const str = (v: any, max: number) => (v == null ? undefined : String(v).slice(0, max));
  const signerName = String(input.signerName ?? "").slice(0, 160).trim();
  const dataUrl = String(input.signatureDataUrl ?? "");
  const userId = String(input.userId ?? "").slice(0, 64).trim();
  const type: AgreementType = input.type === "founder" ? "founder" : "worker";
  if (!signerName || !userId || !dataUrl.startsWith("data:image/")) return null;
  const snap = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  return {
    version: String(input.version ?? AGREEMENT_VERSION).slice(0, 32),
    type,
    userId,
    signedAt: Number(input.signedAt) || Date.now(),
    signerName,
    place: str(input.place, 120),
    guardianName: str(input.guardianName, 160),
    snapshot: {
      name: String(snap.name ?? signerName).slice(0, 160),
      role: snap.role === "HOST" ? "HOST" : "STAFF",
      yTunnus: str(snap.yTunnus, 40),
      feePct: Math.max(0, Math.min(100, Math.round(Number(snap.feePct) || 0))),
    },
    acceptedPolicyIds: Array.isArray(input.acceptedPolicyIds)
      ? input.acceptedPolicyIds.slice(0, 24).map((x: any) => String(x).slice(0, 32))
      : [],
    signatureDataUrl: dataUrl.slice(0, 300_000),
    ip: str(input.ip, 64),
    userAgent: str(input.userAgent, 400),
  };
}
