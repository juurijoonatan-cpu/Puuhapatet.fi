/**
 * Sopimuksen sisältö — yksi totuuden lähde.
 *
 * Tätä tiedostoa muokkaamalla muutat sekä asiakkaalle näytettävää
 * allekirjoitusnäkymää (ContractGate) että adminin tallentamaa, allekirjoitettua
 * sopimusta. Teksti on poimittu tarjous- ja sopimusasiakirjasta PT-2026-02.
 */

export interface ContractSection {
  no: string;
  title: string;
  /** Kappaleet. Rivi joka alkaa "• " näytetään luettelona. */
  body: string[];
}

export interface PriceRow {
  label: string;
  accrual: string; // ikkunakohtainen kertymä
  cap: string; // hintakatto
}

export interface OrderOption {
  id: "A" | "B";
  label: string;
  max: string;
}

export interface ContractMeta {
  contractId: string;
  heading: string;
  tagline: string;
  service: string;
  address: string;
  date: string;
  validUntil: string;
  customer: string;
  customerContact: string;
  providers: string;
  contactInfo: string;
}

export const CONTRACT_META: ContractMeta = {
  contractId: "PT-2026-02",
  heading: "Tarjous & sopimus",
  tagline: "Puhdasta jälkeä!",
  service: "Ikkunoiden pesu sisäkautta",
  address: "Bulevardi 31 / Abrahaminkatu 1–5, Helsinki",
  date: "12.6.2026",
  validUntil: "26.6.2026",
  customer: "Fr8",
  customerContact: "Niilo",
  providers:
    "Joonatan Juuri (Y-tunnus 3598782-9) ja Matias Pitkänen (Y-tunnus 3609912-9), itsenäiset 4H-yrittäjät, Puuhapatet",
  contactInfo:
    "info@puuhapatet.fi · puuhapatet.fi · Joonatan +358400389999 · Matias +358442350881",
};

export const CONTRACT_INTRO =
  "Tämä asiakirja on Puuhapatetin ja tilaajan välinen tarjous ja sopimus ikkunoiden pesusta osoitteessa Bulevardi 31 / Abrahaminkatu 1–5, Helsinki. Kohteeseen on tutustuttu paikan päällä yhdessä tilaajan yhteyshenkilön kanssa 12.6.2026, ja kohteen avain on luovutettu palveluntarjoajalle, joten työ voidaan aloittaa heti hyväksynnän jälkeen. Sopimus koskee sektorin 1 (punaisella merkityt ikkunat) pesua. Sektori 2 (keltaisella merkityt ikkunat) on hinnoiteltu valmiiksi tähän asiakirjaan osapuolten yhteisenä tavoitteena, ja sen toteutus täsmennetään sektorin 1 valmistuttua. Olemme paikallinen, samaan yhteisöön kuuluva toimija ja haluamme tehdä työn Fr8:lle reilusti ja laadukkaasti: tilaaja maksaa vain tehdystä työstä, eikä hinta voi ylittää ennalta sovittua kattoa. Tämän asiakirjan hyväksyminen allekirjoituksella tai sähköpostitse tekee siitä molempia osapuolia sitovan sopimuksen.";

export const PRICE_ROWS: PriceRow[] = [
  { label: "Sektori 1, punaiset (198 ikkunaa)", accrual: "45 € / pesty ikkuna", cap: "8 910 €" },
  { label: "Sektori 2, keltaiset (117 ikkunaa)", accrual: "39 € / pesty ikkuna", cap: "4 563 €" },
];

export const ORDER_OPTIONS: OrderOption[] = [
  { id: "A", label: "Sektori 1, punaiset ikkunat", max: "enintään 8 910 €" },
  { id: "B", label: "Sektori 1 + sektori 2, punaiset ja keltaiset", max: "enintään 13 473 €" },
];

/** Tilauksen rastit (kohta 11). */
export const ORDER_CHECKS = [
  "Tilaan sektori 1:n (punaiset ikkunat) tämän sopimuksen mukaisesti.",
  "Tavoitteena on jatkaa sektori 2:een (keltaiset) sektori 1:n jälkeen tähän vahvistetulla hinnalla, olosuhteiden ja aikataulun mukaan täsmennettynä.",
];

export const CONTRACT_SECTIONS: ContractSection[] = [
  {
    no: "01",
    title: "Sopimuksen kohde ja laajuus",
    body: [
      "Työn laajuus määräytyy tilaajan pohjapiirroksiinsa (kerrokset K–5) merkitsemien ikkunoiden mukaan. Merkityt pohjapiirrokset ovat tämän sopimuksen erottamaton liite. Yksi ikkuna tarkoittaa yhtä pohjapiirroksiin merkittyä ikkunaa.",
      "• Sektori 1, punaisella merkityt ikkunat: 198 ikkunaa. Tämä on nyt tilattava ja sovittava työ.",
      "• Sektori 2, keltaisella merkityt ikkunat: 117 ikkunaa. Valmiiksi hinnoiteltu jatko-osa, joka on osapuolten yhteinen tavoite ja täsmennetään sektorin 1 valmistuttua (ks. kohta 2).",
      "Ikkunat pestään sisäkautta avaamalla. Telineitä, nostimia tai julkisivutyötä ei tarvita, joten työ ei aiheuta häiriötä rakennuksen julkisivuille, pihalle eikä kulkureiteille.",
    ],
  },
  {
    no: "02",
    title: "Työn eteneminen ja sektori 2",
    body: [
      "Sektori 1:n osalta tämän sopimuksen hyväksyminen valtuuttaa palveluntarjoajan tekemään koko sektorin työn alusta loppuun ilman erillisiä välivahvistuksia tai uusia allekirjoituksia. Palveluntarjoaja saa jatkaa sovittua työtä siihen saakka, kunnes sektori 1 on valmis tai kunnes tilaaja erikseen ilmoittaa työn keskeyttämisestä.",
      "Sektori 2 (keltaiset) on osapuolten yhteinen tavoite ja luonteva jatko sektori 1:lle. Sen hinta on vahvistettu valmiiksi tähän asiakirjaan, joten työtä voidaan jatkaa keltaisiin ilman uutta tarjousta tai neuvottelua. Sektori 2:n laajuus ja toteutus täsmennetään sektori 1:n valmistuttua sen mukaan, miten olosuhteet ja aikataulu sen sallivat. Palveluntarjoaja voi tehdä sektori 2:n kokonaan tai osittain, ja kumpikin osapuoli voi halutessaan luopua sektori 2:sta ilman seuraamuksia. Tilaaja maksaa sektori 2:sta vain todellisuudessa pestyt ikkunat ikkunakohtaisella hinnalla.",
    ],
  },
  {
    no: "03",
    title: "Hinnoittelu: hintakatto ja ikkunakohtainen kertymä",
    body: [
      "Hinnoittelussa on sektorikohtainen hintakatto. Työ etenee ikkuna kerrallaan ja jokainen pesty ikkuna kasvattaa summaa ikkunakohtaisella hinnalla kattoon asti. Hinta ei voi ylittää kattoa, ja jokainen pesemättä jäävä ikkuna jää kokonaan pois laskulta. Tilaaja maksaa siis vain tehdystä työstä.",
      "Hinnan perusteet: ikkunakohtainen hinta perustuu 12.6.2026 tehtyyn kohdekierrokseen ja samalla toteutettuun koepesuun. Koepesu osoitti, että ikkunat ovat poikkeuksellisen työläitä: yksittäinen ikkuna on rakenteeltaan jopa kuusiosainen, pitkään pesemättä ollut ja osin korkealla tai hankalasti avattavissa. Yhden ikkunan huolellinen pesu vie siten huomattavasti tavanomaista enemmän aikaa. Hinta on mitoitettu tämän todennetun työmäärän mukaan niin, että jokainen ikkuna voidaan pestä huolellisesti ja hyvää jälkeä tuottaen, ja se sisältää työn, välineet, suojaukset, siivouksen ja dokumentoinnin. Piilokuluja ei ole.",
      "Kaksi vaihtoehtoa: tilaaja voi valita pelkän sektori 1:n tai sektori 1:n ja sektori 2:n yhdessä. Hintakatto on kummankin sektorin enimmäishinta. Sektori 1 on nyt tilattava työ; sektori 2:n hinta on vahvistettu valmiiksi yhteisenä tavoitteena ja laskutetaan vain todellisuudessa pestyistä ikkunoista, jos ja siltä osin kuin sektori 2 toteutetaan.",
      "Yksikköhinta on keskiarvohinta: kohteessa on hyvin erikokoisia ikkunoita, ja hinta on tasattu niin, että sama hinta kattaa sekä pienemmät että salien suurikokoiset ikkunat.",
      "Hintoihin ei lisätä arvonlisäveroa (AVL 3 §, vähäinen liiketoiminta).",
      "Tarjouksen ulkopuoliset lisätyöt 45 €/h + mahdolliset matkakulut, aina etukäteen sopien.",
      "Mittakaava: pohjapiirrosten perusteella koko rakennuksessa on arviolta noin 500 ikkunaa, ja lähes kaikkien pesu vastaavalla mallilla olisi noin 20 000–22 000 €. Tämä sopimus kattaa teille tärkeimmät 315 ikkunaa selvästi pienemmällä kokonaisuudella, ja loput voidaan lisätä myöhemmin samoilla yksikköhinnoilla.",
    ],
  },
  {
    no: "04",
    title: "Reaaliaikainen seuranta ja laskutus",
    body: [
      "Tilaaja saa käyttöönsä reaaliaikaisen seurantapaneelin, josta näkyy pestyjen ikkunoiden määrä sektoreittain, siihenastinen kertynyt summa suhteessa hintakattoon sekä mahdolliset kuntovaraukset hyvityksineen. Paneeli toimii samalla tilaajan näkymänä työn etenemiseen ja laskun muodostumiseen, joten kustannus on tiedossa koko ajan eikä lopullinen summa tule yllätyksenä.",
      "Laskutus seuraa samaa toteutunutta kertymää. Osalasku muodostetaan noin sadan pestyn ikkunan välein siihen mennessä tehdyn työn mukaan, ja loppulasku kunkin tilatun sektorin valmistuttua tai työn päättyessä.",
    ],
  },
  {
    no: "05",
    title: "Työn sisältö",
    body: [
      "• Perusteellinen ensipesu avaamalla ikkunat ja pesemällä pinnat huolellisesti. Karmien ja puitteiden näkyvä lika sekä ikkunalaudat pyyhitään.",
      "• Pesussa käytetään alkoholipohjaista ikkunanpesuainetta, joka antaa puhtaan ja raitattoman lopputuloksen. Suojeltua rakennusta ja sen ikkunarakenteita käsitellään kunnioittaen ja hellävaraisesti.",
      "• Siirrämme kevyet tavarat ikkunoiden edestä itse ja palautamme ne paikoilleen pesun jälkeen, joten tiloja ei tarvitse valmistella meitä varten. Ainoa poikkeus ovat erikseen sovitut huoneet, joista ilmoitamme etukäteen ja jotka siistitään ennen tuloamme.",
      "• Työpisteet suojataan, irronnut maali ja lika siivotaan ja jätteet viedään mennessä.",
      "• Lähtötilanne ja lopputulos dokumentoidaan valokuvin.",
      "• Työn toteuttaa Puuhapatetin tiimi. Palveluntarjoaja vastaa työntekijöistään ja heidän työnsä laadusta, ja mitoittaa työryhmän koon työn sujuvan etenemisen ja aikataulun mukaan.",
      "• Sektori 1 pestään tiloittain yhteyshenkilön kanssa sovitussa järjestyksessä. Työajat sovitetaan tilojen käyttöön.",
      "• Työ luovutetaan yhteisellä tarkastuskierroksella.",
    ],
  },
  {
    no: "06",
    title: "Joustavuus, kuntovaraus ja työn päättäminen",
    body: [
      "Kyseessä on vanha, suojeltu ja pitkään pesemättä ollut rakennus, jonka ikkunarakenteet ovat paikoin hauraita ja arvaamattomassa kunnossa. Jotta työ voidaan tehdä turvallisesti ja laadukkaasti rakennusta kunnioittaen, sopimukseen sisältyy seuraava jousto, joka on samalla tilaajan etu: tilaaja maksaa joka tilanteessa vain huolellisesti loppuun pestyistä ikkunoista.",
      "Yksittäinen ikkuna: jos ikkuna todetaan työn aikana liian huonokuntoiseksi, juuttuneeksi tai sellaiseksi, ettei sitä voida pestä turvallisesti ja hyvää jälkeä tuottaen, palveluntarjoaja voi jättää sen pesemättä. Ikkuna ei tule laskulle.",
      "Työn päättäminen: jos palveluntarjoaja arvioi, ettei työtä voida kohteen olosuhteiden vuoksi jatkaa laadukkaasti ja vastuullisesti loppuun saakka, palveluntarjoajalla on oikeus päättää työ. Tällöin laskutetaan ainoastaan siihen mennessä valmiiksi pestyt ikkunat ikkunakohtaisella hinnalla, ja sopimus päättyy ilman eri toimenpiteitä.",
      "Edellä kuvatuista tilanteista ei aiheudu kummallekaan osapuolelle sopimussakkoa, vahingonkorvausvelvollisuutta eikä muita seuraamuksia missään tilanteessa. Vaikutus rajoittuu siihen, että lopullinen summa jää hintakattoa pienemmäksi. Tilaaja näkee tehdyn työn ja sitä vastaavan summan seurantapaneelista.",
    ],
  },
  {
    no: "07",
    title: "Vastuut, vakuutus ja avainturva",
    body: [
      "Tilaaja on tietoinen, että ikkunoita ei ole pesty pitkään aikaan ja että osa puitteista, listoista, heloista ja kittauksista on huonokuntoisia, mm. hilseilevää maalia. Normaalista ja huolellisesta avaamisesta ja pesusta huonokuntoisiin rakenteisiin aiheutuvat seuraukset, kuten maalin irtoaminen tai hauraan listan, laudan tai helan rikkoutuminen, eivät ole palveluntarjoajan vastuulla.",
      "Pesu voi irrottaa valmiiksi hilseilevää maalia. Irronnut maali siivotaan pois työn yhteydessä.",
      "Ennen työtä valokuvadokumentoidut vauriot eivät kuulu palveluntarjoajan vastuulle.",
      "Tuottamuksella aiheutetut vahingot korvataan palveluntarjoajan toiminnan vastuuvakuutuksesta vakuutusehtojen mukaisesti (Pohjola Vakuutus).",
      "Avainturva: kohteen avain on luovutettu palveluntarjoajalle 12.6.2026. Avainta säilytetään huolellisesti ilman kohteen tunnistetietoja, sitä ei luovuteta kolmansille ja se palautetaan kuittausta vastaan luovutuksen yhteydessä.",
    ],
  },
  {
    no: "08",
    title: "Aikataulu",
    body: [
      "• Töiden aloitus 2–4 arkipäivän kuluessa hyväksynnästä. Avain on jo meillä, joten eteneminen on joustavaa.",
      "• Tavoiteltu valmistuminen on 1.8.2026, ja etenemistä voi seurata paneelista koko ajan.",
      "• Sairastapaus tai muu ylivoimainen este siirtää työpäiviä ilman sanktioita, tavoiteaikataulu huomioiden. Muutoksista ilmoitetaan heti.",
    ],
  },
  {
    no: "09",
    title: "Tilaajan myötävaikutus",
    body: [
      "• Kulku kaikkiin tiloihin, joissa merkittyjä ikkunoita on, myös lukittuihin huoneisiin sovittuina päivinä.",
      "• Vesipiste käytettävissä.",
      "• Erikseen sovitut huoneet siistitään ennen ilmoitettua pesupäivää. Muut tilat hoidamme sellaisinaan.",
      "• Nimetty yhteyshenkilö, jonka kanssa tilajärjestys ja kuntovaraustapaukset todetaan. Jos sovittu tila ei ole käytettävissä, päivän järjestystä muutetaan joustavasti yhdessä.",
    ],
  },
  {
    no: "10",
    title: "Maksu- ja sopimusehdot",
    body: [
      "• Maksuaika 14 vuorokautta netto laskun päiväyksestä. Viivästyskorko korkolain mukaan, maksumuistutus 5 €.",
      "• Hyväksytyt maksutavat: tilisiirto, MobilePay tai käteinen.",
      "• Laskutus tapahtuu tekijöiden omilla Y-tunnuksilla, ja työ voidaan jakaa kahdelle laskulle.",
      "• Reklamaatiot kirjallisesti osoitteeseen info@puuhapatet.fi kahden vuorokauden kuluessa työn valmistumisesta. Aiheellinen reklamaatio korjataan veloituksettomalla korjauskäynnillä.",
      "• Hinnoittelu perustuu 12.6.2026 tehtyyn kohdekierrokseen ja merkittyihin pohjapiirroksiin. Jos laajuus muuttuu olennaisesti, muutoksista sovitaan kirjallisesti ennen toteutusta.",
      "• Muilta osin sovelletaan Puuhapatetin yleisiä sopimusehtoja (puuhapatet.fi). Ristiriitatilanteessa tämä sopimus on ensisijainen.",
    ],
  },
  {
    no: "11",
    title: "Hyväksyminen ja allekirjoitukset",
    body: [
      "Tarjous on voimassa 26.6.2026 saakka. Hyväksynnäksi riittää sähköposti tai tämän sivun allekirjoitus. Hyväksytty tarjous muodostaa osapuolia sitovan sopimuksen, joka valtuuttaa palveluntarjoajan tekemään työn tämän asiakirjan mukaisesti.",
    ],
  },
];

export const CONTRACT_ATTACHMENT =
  "Liite: tilaajan merkitsemät pohjapiirrokset (kerrokset K–5).";

/** localStorage-avain, jolla allekirjoitettu sopimus muistetaan tällä laitteella. */
export const SIGNED_KEY = "fr8_contract_signed_v1";

export interface CustomerInfo {
  legalName: string;
  businessId: string;
  billingAddress: string;
  eInvoice: string;
  contactPerson: string;
}

export interface SignedContract {
  contractId: string;
  signedAt: number; // epoch ms
  order: "A" | "B";
  checks: boolean[]; // ORDER_CHECKS valinnat
  customer: CustomerInfo;
  signerName: string; // nimenselvennys
  place: string; // paikka
  signatureDataUrl: string; // piirretty allekirjoitus (PNG dataURL)
  userAgent?: string;
}
