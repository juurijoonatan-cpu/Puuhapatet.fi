# Maksut — jatkotyöt ja tiedossa olevat rajoitukset

Tämä on PR #503:n (kolme rahavirtaa + siirtoraportti + Maksut-alueen uudistus)
jälkeen jäänyt lista. Kaikki alla oleva on **tiedossa ja tarkoituksellisesti
rajattu ulos** siitä muutoksesta — ei mitään rikki, mutta nämä ovat ne kohdat
joissa rahan siirtäminen ei vielä ole niin sujuvaa kuin se voisi olla.

Järjestys on tärkeysjärjestys: 1 on se joka oikeasti haittaa päivittäistä
rahansiirtoa, loput ovat tarkennuksia.

---

## 1. "Siirsin jo" -kuittaus puuttuu tekijämaksuilta ⚠️ tärkein

**Nykytila.** Tekijän erälaskulla on kaksi tilaa jotka merkitsevät rahaa:
`luonnos` (johtaja loi maksun) ja `hyväksytty` (tekijä kuittasi sen omalta
työpöydältään). Malli kohtelee **hyväksyttyä laskua maksettuna**
(`isEraInvoiceSettled`), koska pankkisiirtoa ei kirjata mihinkään.

**Mitä siitä seuraa.** Sillä hetkellä kun tekijä hyväksyy laskunsa, rivi
katoaa "Siirrä nämä" -listalta ja siirtyy "hoidettuihin" — vaikka johtaja ei
ole vielä tehnyt itse pankkisiirtoa. Juuri se hetki on se jolloin raha pitäisi
siirtää, eikä lista kerro sitä enää. Siirtoraportin sähköpostin otsikossa voi
lukea "siirrettävää 0,00 €" ennen kuin senttiäkään on liikkunut.

**Nykyinen paikkaus.** Hyväksytty lasku lähtee PDF:nä sähköpostilla molemmille
johtajille — se on käytännön "maksa tämä nyt" -signaali, ja Siirrot-välilehti
sanoo sen ääneen. Se ei silti ole lista jota voi kuitata.

**Ehdotus.** Erälaskulle oma `paidAt`-merkintä (tai `settlement.transfers`
-tyylinen kirjaus myös tekijämaksuille), jolloin:
- hyväksytty mutta maksamaton lasku näkyy siirtolistalla tilassa `valmis`
  ("siirrä nyt") — tämä on ainoa tila jota `TransferStatus` ei tällä hetkellä
  koskaan saa arvokseen tekijäriville,
- kuittaus poistaa rivin listalta,
- `settledCents` erottaa "laskutettu" ja "maksettu".

Huom: tämä on tietomallin laajennus (DB-sarake tai blob-kenttä). Katso
`shared/worker-payouts.ts` (`isEraInvoiceSettled`) ja
`shared/transfer-report.ts` (`TransferStatus`, `instructions`).

---

## 2. Johtajien keskinäiset muutokset

### 2a. Laskun voi tehdä vain se joka on saamassa rahaa
`server/routes.ts` `POST /api/jobs/:id/era-invoice/founder` vaatii
`senderId === kirjautunut johtaja` ("Et voi lähettää laskua toisen puolesta").
Tasauslaskun myyjä on velkoja, joten **maksava osapuoli ei voi luoda laskua** —
näkymä kertoo "Laskun lähettää Matias." ja siihen se jää.

Sääntö on tarkoituksellinen (kukaan ei kirjoita laskuja toisen nimissä), mutta
käytännössä se pysäyttää tilanteen jossa maksaja haluaisi hoitaa asian loppuun.

**Ehdotus (valitse yksi):**
- maksaja voi lähettää velkojalle **pyynnön** tehdä lasku (ilmoitus/sähköposti), tai
- tasauslaskulle oma poikkeus: kumpi tahansa johtaja saa luoda sen, ja laskulle
  kirjataan kuka sen loi (`rivit.input.createdBy`).

### 2b. Johtajasiirron kuittaus vain "Minä & Matias" -välilehdeltä
Siirrot-välilehdellä on nappi joka vie tasausnäkymään, mutta itse "Merkitse
siirretyksi" on siellä. Yksi napautus vähemmän: kuittaus suoraan siirtoriviltä.

### 2c. Varauksen kantaja pääteltävissä
Kun tekijöille on maksamatta, tasaus jakaa varauksen (`reserveCents`) tasan ja
johtajasiirto on siihen asti liian iso. Rivi varoittaa tästä nyt
(`status: "maksa_tekijat_ensin"`), ja `reserveOwnerId` on asetettavissa käsin.

**Ehdotus.** Siirtoraportti tietää jo `payerFor`-funktiossa kuka kunkin tekijän
maksaa. Jos kaikki avoin tekijäraha osuu samalle johtajalle, `reserveOwnerId`
voisi ehdottaa häntä automaattisesti (ehdotuksena, ei pakotettuna).

---

## 3. Hyväksytyt likiarvot (eivät bugeja, mutta hyvä tietää)

### 3a. "Oma tulo" -arvion laskutettu osuus
`buildTasaus().invoicedEntitledCents` skaalaa keltaiset ja tunnit suhteella
`laskutettu / kertynyt`. Tuntilasku ja keltaisten lasku ovat könttäsummia jotka
voivat sisältää myös tarvikkeet, alihankinnan ja laskuttamattomat ikkunat, eikä
maksurivi kanna tietoa siitä mikä osa oli mitäkin. Suhde rajataan yhteen, joten
yliarviota ei synny, ja päätepisteissä (0 % / 100 %) luku on tarkka.

**Tarkka ratkaisu** vaatisi laskun erittelyn tallentamisen maksuriville — sama
kuvio kuin yhdistetyn laskun `parts`-kentässä (`scope: "all"`). Se on pieni
laajennus ja tekisi tästä eksaktin.

### 3b. Tuntien esitäyttö pyöristetään alaspäin
`openHours` pyöristetään alaspäin yhteen desimaaliin, jottei `tunnit ×
tuntipalkka` koskaan ylitä avointa summaa. Täysillä tunneilla (normaali tapaus,
koska vuorot pyöristetään täyteen tuntiin) luku on tarkka; muuten esitäyttö voi
jäädä muutaman kymmenen sentin verran alle, ja loppu jää avoimeksi.

---

## 4. Pienemmät tekniset jäljet

- **Erälaskujen erä ei ole atominen.** `POST /era-invoice/worker-batch`
  kirjoittaa rivi kerrallaan. Kaikki rivit tarkistetaan nyt ennen ensimmäistä
  kirjoitusta, joten validointivirhe ei jätä puolikasta erää, mutta
  kantavirhe kesken silmukan voi yhä. Punaiset ja keltaiset selviävät
  kaksoiskappalesuojan ansiosta; **tuntipotissa suojaa ei ole** (sama keikka saa
  tarkoituksella useita tuntimaksuja). Korjaus: koko erä yhteen transaktioon.
- **`crewMemberStats().hours` on kuollutta painolastia.** Se lukee vanhaa
  `project.hours`-kenttää johon mikään nykyinen näkymä ei kirjoita. Maksut ja
  tasaus lukevat nyt `project.shifts`ista. Kenttä näkyy yhä tekijän työpöydällä
  ja tehokkuusluvuissa — selvitä käyttö ja poista tai dokumentoi.
- **Tiimi-sivun palkkayhteenveto** näyttää "Siirrettävä" = punaiset + tunnit ja
  keltaiset erikseen (koska keltaisia ei makseta ennen asiakkaan maksua). Se on
  tarkoituksellista mutta eroaa Maksut-välilehden yhteissummasta — harkitse
  yhtenäistämistä tai selkeämpää otsikointia.
- **Yhdistetyn laskun p1-jäännös** (`amountCents − parts.hours − parts.p2`) on
  aina 0, koska summa muodostetaan osista. Haara on olemassa varmuuden vuoksi;
  jos yhdistetty lasku joskus saa oman p1-osansa, se toimii jo.

---

## Mitä EI kannata muuttaa (nämä ovat sääntöjä, eivät puutteita)

Nämä tulivat esiin katselmoinneissa ja on tietoisesti pidetty näin. Älä
"korjaa" niitä lukematta perustelua koodissa:

1. **Kolme rahavirtaa eivät kuittaa toisiaan.** Virta luetaan aina
   `eraScopeOf(eraNumbers)`ista. Yksi lasku = yksi virta (server rajaa kentät).
2. **Tuntipalkka on palkkaa vain tuntitilassa.** Kohdennetulla keikalla
   `project.shifts` on seurantaa; palkka tulee ikkunoista. Muuten sama työ
   maksettaisiin kahdesti.
3. **Ikkunapalkka jää voimaan tuntikeikalla.** Ikkunatyö on oma veloituksensa
   tuntien rinnalla (`computeWindowMoney`) — ei tuplaus.
4. **Käsin kirjatun maksun ylivuoto: punaiset → tunnit → keltaiset.**
   Maksettavaa nyt ensin, asiakkaan maksua odottava viimeisenä. Kohdennettu
   (virtaansa merkitty) lasku ei koskaan vuoda toiseen pottiin.
5. **Luonnos varaa velan.** Muuten johtaja loisi saman maksun kahdesti.
6. **Mitätöity lähetetty lasku säilyy tositteena** (kirjanpitolaki, 6 v);
   mitätöity luonnos katoaa 2 vrk:ssa.
