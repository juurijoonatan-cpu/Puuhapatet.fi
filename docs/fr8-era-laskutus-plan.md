# FR8-laskutus — alkuperäinen speksi + toteutuksen seuranta

> Tämä tiedosto on **pysyvä varmuuskopio** käyttäjän alkuperäisestä tehtävänannosta
> ja sen 5-vaiheisesta toteutussuunnitelmasta. Tarkoitus: jos toteuttava
> agentti/sessio loppuu kesken (esim. loppuu credit), toinen agentti/tili voi
> jatkaa työtä tästä tiedostosta 100%:sti kontekstin säilyessä — ei tarvitse
> arvailla mitä alun perin pyydettiin.
>
> **Prosessi (koskee kaikkia vaiheita):** jokainen vaihe tehdään kokonaan
> valmiiksi (koodi + testit/verifiointi + commit + push), sen jälkeen
> raportoidaan tila käyttäjälle ja **odotetaan nimenomaista lupaa** ennen
> seuraavaan vaiheeseen siirtymistä. Ei koskaan aloiteta seuraavaa vaihetta
> ilman lupaa.

## Tilanne / seuranta

| Vaihe | Kuvaus | Tila |
|---|---|---|
| 0 | Speksi + suunnitelma talteen, PR auki | ☑ tehty (tämä commit) |
| 1 | Datamalli + puhdas laskentamoottori + yksikkötesti (kohdat 2, 5, 7) | ☐ |
| 2 | Johtajan näkymät: laskun luonti ja lähetys (kohdat 3A, 3C) | ☐ |
| 3 | Vastaanottajan näkymät + kokonaistilanne-sivu (kohdat 3B, 3D) | ☐ |
| 4 | Lailliset vaatimukset: lukitus, laskumerkinnät, PDF, sähköposti (kohta 4) | ☐ |
| 5 | Bugikorjaus (kohta 6.1) + kokonaisvaltainen validointi (kohta 6) | ☐ |

Yksityiskohtainen tekninen suunnitelma (mitä tiedostoja koskettaa, mitä
olemassa olevaa koodia hyödynnetään, poistumiskriteerit per vaihe) on kirjoitettu
Claude Code -ajon suunnitelmatiedostoon toteutuksen alussa; tiivistelmä
alla olevan speksin jälkeen ei ole tarpeen toistaa täällä — **tämä tiedosto on
ensisijaisesti alkuperäisen speksin sana sanalta -tallennus**, jota vasten
toteutusta verrataan. Päivitä yllä oleva taulukko jokaisen vaiheen jälkeen.

### Mitä koodikannasta löytyi ennen vaihetta 1 (tärkeä konteksti jatkajalle)

FR8-keikalla on jo **osittainen** erä/kate-toteutus ennen tätä työtä, joka EI
vastaa alla olevaa speksiä täysin ja jota sovitetaan/korvataan matkan varrella:

- `shared/project.ts`: `FR8_PRICE_PER_WINDOW` (37,50 €, kiinteä), `computeDealBilling`,
  `computeEraDebts` (~rivi 410) — jakaa pestyt ikkunat automaattisesti erin
  **pesujärjestyksen** (aktiviteettiloki) perusteella, EI käsin syötettynä per
  tekijä. `marginCents = instalmentCents - earnedCents` — ei huomioi johtajien
  omia pesuja eikä laske muuttuvaa x:ää S:n mukaan. Ei erota sovittua muutosta
  ennakosta.
- `shared/payprogress.ts`: `PAY_PERIODS=4`, `computePayProgress`, `eraWindowCounts`
  — ikkunamäärä-pohjainen (ei arvopohjainen) erien koko.
- `client/src/pages/admin/crew.tsx`: `EraKateDialog`/`EraKatePanel` (~rivi 680) +
  `FounderSettlementView` ("Bossien tulot & jako", ~rivi 726) — nykyinen UI
  kate-arvion näyttämiseen. **Pelkkä raportointi**, ei lähetettäviä/lukittavia
  laskuja.
- `server/routes.ts`: founder-settlement-reitit (~1437–1689),
  `generateWorkerInvoicePdf` (~665), sähköpostilähetys Resendillä (useita
  kohtia), `workerPayments`-taulu (`shared/schema.ts`) tekijä-maksuille,
  `payout.invoiceNo`-käytäntö laskunumeroinnille.
- `shared/billers.ts` (`BRAND_BILLERS`, Joonatan/Matias Y-tunnukset+IBAN),
  `shared/tax.ts` (ALV_RATE, ennakonpidätys-vakiot).
- `docs/fr8-tyo-logiikka.md` ja `docs/fr8-vero-ja-maksut.md` — ylläpidetyt,
  ajantasaiset taustadokumentit; päivitetään kun uusi logiikka on valmis
  (vaihe 5).

**Päätös:** uusi speksi (käsin syötetyt pestyt_ikkunat per tekijä/johtaja per
erä, sovittu_muutos vs. ennakko erillään, x = S/kokonaisikkunat, kate
jäännöksenä, lukittavat laskut, PDF+email) on tarkempi ja auktoritatiivinen.
Se rakennetaan **uutena, rinnakkaisena laskuvirtana** (uudet taulut/funktiot),
josta tulee totuuden lähde varsinaiselle laskutukselle. Nykyinen
`EraKateDialog`/`FounderSettlementView` jää toistaiseksi arvioivaksi
dashboard-näkymäksi, ja korvataan/piilotetaan vasta kun uusi virta kattaa
saman tarpeen (päätös tehdään viimeistään vaiheessa 5).

---

## Alkuperäinen speksi (sana sanalta)

# Claude Code -tehtävä: Puuhapätet-järjestelmän FR8-laskutusosuus

## Tavoite
Toteuta Puuhapätet-järjestelmään FR8-keikan (TKK / Bulevardi 31) **laskutus- ja maksuosuus** kokonaisuudessaan. Kaikki laskut ja tositteet on saatava lakisääteisesti oikein, tallennettava muuttumattomasti ja säilytettävä oikeaoppisesti. Alla on tarkka laskentalogiikka, näkymät, käyttäjäpolut ja hyväksymiskriteerit. **Noudata näitä täsmälleen.**
---
## 1. Konteksti ja termistö
- **Johtajat:** Matias (**M**, sähköposti `matiaspit88@gmail.com`) ja Joonatan (**J**, sähköposti = `joonatan@puuhapatet.fi`). Molemmilla oma Y-tunnus (ei toiminimeä) → keskinäiset laskut ovat aitoja yritysten välisiä laskuja.
- **Tekijät:** työntekijät jotka pesevät ikkunoita kiinteään **20 €/ikkuna** -hintaan.
- **Erät:** keikka laskutetaan neljässä erässä, **jokainen erä = 1575 €** (arvon mukaan, ei ikkunamäärän). Yhteensä 6300 €.
  - **Erät 1–3** (yht. 4725 €) → raha tulee **Joonatanin** tilille → tämän erävaihtoehdon vastaanottaja on Joontan, eli kun tekijä lähettää laskun eristä 1-3, laskun saajana on joonatan.**.
  - **Erä 4** (1575 €) → raha tulee **Matiaksen** tilille → erä 4:n johtaja-välisen laskun **tämän erävaihtoehdon vastaanottaja on Matias, eli kun tekijä lähettää laskun erästä, laskun saajana on matias.
- **Erän ikkunamäärä** = kuinka monta ikkunaa on pesty sen erän/erien arvon täyttämiseksi (erä on arvomääräinen, joten ikkunamäärä täytetään käsin per erä).
---
## 2. Laskentalogiikka (YDINLOGIIKKA — toteuta tämä tarkalleen)
### Syötteet
- `S` = valitun erän/erien **kokonaissumma** (€), johtaja täyttää.
- `tekijän_hinta` = **20 €** / ikkuna (kiinteä).
- Per tekijä: `pestyt_ikkunat`, `sovittu_muutos` (€, +/−), `ennakko` (€, jo maksettu).
- Per johtaja (J ja M): `pestyt_ikkunat` (voi olla desimaali, esim. 13,5 / 24,5).
- `kokonaisikkunat` = KAIKKIEN pesemien ikkunoiden summa erässä (tekijät + J + M).
### ⚠️ TÄRKEÄ TARKENNUS: erota "sovittu muutos" ja "ennakko"
Käyttäjän alkuperäisessä kuvauksessa nämä olivat samassa laatikossa. **Ne ovat eri asioita ja pidettävä erillään, muuten kate laskee väärin:**
- **Sovittu muutos** (bonus/alennus, esim. Miljan +20 €): muuttaa tekijän **ansaittua kokonaissummaa** → **vaikuttaa katteeseen**.
- **Ennakko** (jo maksettu, esim. Matias maksoi Janille 380 € etukäteen): EI muuta ansaittua summaa, ainoastaan "maksettava nyt" -riviä → **EI vaikuta katteeseen** (raha on jo lähtenyt, se on silti erän kustannus).
Jos haluatte silti yhden yhteislaatikon UI:ssa, pidä silti **kaksi erillistä kenttää datassa** (`sovittu_muutos`, `ennakko`). Katelaskenta käyttää vain `sovittu_muutos`ta.
### Laskukaavat (järjestyksessä)
```
1. Per tekijä:
   ansaittu   = pestyt_ikkunat * 20 + sovittu_muutos      // käytetään katteeseen
   maksettava = ansaittu - ennakko                         // tekijän lasku "nyt"
2. tekijät_ansaittu_yht = SUMMA(kaikkien tekijöiden ansaittu)
3. x = S / kokonaisikkunat                                 // PYÖRISTÄ 2 desimaaliin
4. Per johtaja:
   johtaja_omat = ROUND(x, 2) * pestyt_ikkunat
5. KATE = S - tekijät_ansaittu_yht - J_omat - M_omat       // JÄÄNNÖS
   // Laske kate AINA jäännöksenä, älä kaavalla n*(x-20).
   // Näin 2 desimaalin pyöristys ei aiheuta senttiheittoa ja summa täsmää S:ään.
6. kate_per_johtaja = KATE / 2
7. J_loppusumma = J_omat + kate_per_johtaja
   M_loppusumma = M_omat + kate_per_johtaja
8. TARKISTUS: tekijät_ansaittu_yht + J_loppusumma + M_loppusumma  ==  S   (ero = 0)
```
### Miksi kate jäännöksenä
Kate = "mitä johtajat tienaavat siitä että tekijät pesevät" = S miinus tekijöiden kustannukset miinus johtajien omat pesut. Koska `x` pyöristetään 2 desimaaliin, jäännöslaskenta imee pyöristyksen ja loppusumma täsmää sentilleen kokonaissummaan `S`. Kate jaetaan **tasan 50/50** riippumatta siitä kumpi johtaja pesi enemmän (näin on sovittu).
---
## 3. Näkymät ja käyttäjäpolut
### 3A. Tekijä-maksut (johtaja → tekijä)
1. Johtajan **projektinäkymässä (FR8)** on **"Maksu"**-toiminto. Johtaja valitsee **erät 1–3** tai **erä 4**.
2. Avautuu **laskunäkymä**, jossa jokaiselle tekijälle on **valmiiksi täytetty** `pestyt_ikkunat * 20 €`.
3. Näkymässä on kentät **"Sovittu muutos (€)"** ja **"Ennakko / jo maksettu (€)"** joilla laskun summaa voi plussata/miinustaa (ks. kohta 2).
4. Johtaja **lähettää maksun/laskun** tekijän näkymään.
### 3B. Tekijän näkymä — maksut
1. Tekijän näkymän **"Maksut"**-kohtaan ilmestyy johtajan lähettämä lasku ja **"Lähetä lasku"** -painike.
2. Tekijä voi **hyväksyä/lähettää** tai **hylätä** laskun.
3. **Kun lasku on lähetetty, sitä ei voi lähettää enää uudelleen** (painike toimii vain kerran, lasku lukittuu).
4. Johtaja voi lähettää tekijän näkymään **uusia maksuja vapaasti (rajattomasti)** virheiden varalta; tekijä voi hylätä väärän.
### 3C. Johtajien välinen laskutus (J ↔ M)
1. Samassa projektinäkymässä, **"Tekijät"-osiossa** J ja M näkyvät riveinä. Kummankin **omalla rivillä ei ole "Maksut"-painiketta**, mutta **toisen johtajan rivillä on** (M näkee painikkeen Joonatanin rivillä, J näkee sen Matiaksen rivillä).
2. Painikkeesta avautuu **laskun lähetysvalikko** (samanlainen kuin tekijöillä). Sisältö järjestyksessä:
   - **Itsepestyt ikkunat** (laskun **lähettäjän** omat pestyt ikkunat).
   - Kenttä: **erän/erien ikkunamäärä** (= `kokonaisikkunat`).
   - Kenttä: **erän/erien kokonaissumma** (= `S`).
   - Järjestelmä laskee **ikkunakohtaisen hinnan `x` (2 desimaalia)** → **omat ansiot** = `x * itsepestyt_ikkunat`.
   - **Kate** = jäännös (S − tekijöiden **maksut sovitut muutokset huomioiden** − johtajien pesemät) → näytä.
   - **Kate / 2** → näytä.
   - **Yhteenlaskettu summa** (= omat ansiot + kate/2) → näytä.
   - **Vapaa muokkauskenttä** jolla loppusummaa voi vielä muuttaa käsin.
3. **Reititys:** erät 1–3 → lasku osoitetaan **Joonatanille**; erä 4 → **Matiakselle**.
4. Kun lasku lähetetään, se tallentuu **molemmille osapuolille** järjestelmään ja **kopiot lähtevät automaattisesti kumpaankin sähköpostiin** (`matiaspit88@gmail.com` JA Joonatanin sähköposti) **riippumatta laskun suunnasta**.
### 3D. "Maksut" / Kokonaistilanne -sivu
Projektinäkymään tulee **"Maksut"**-sivu (kokonaistilanne), josta löytyy:
- **Johtajien väliset laskut** (lähetetyt, edellä kuvatulla tavalla tehdyt).
- **Kaikki tekijöille lähetetyt maksut** (johtajan tekijän näkymään pistämät).
- **Tekijöiden hyväksymät / "lähettämät" laskut** (kuitatut).
- Jokaisesta johtaja-välisestä laskusta on **kopio kummankin johtajan sähköpostissa**.
---
## 4. Lailliset vaatimukset ja tositteet (PAKOLLINEN)
> Huom: en ole lakimies — nämä ovat yleisiä vaatimuksia; **varmista lopullinen ALV-käsittely ja pakolliset kentät kirjanpitäjältä/verottajalta** ennen tuotantokäyttöä.
- **Jokaisen laskun** (sekä johtaja-väliset että tekijä-maksut) tulee sisältää lain vaatimat tiedot: laskun **päiväys**, **juokseva laskunumero**, myyjän ja ostajan **nimi ja Y-tunnus**, suoritteen **määrä ja laji** (esim. "ikkunanpesu, X ikkunaa"), **veloituksen peruste/summa**, **eräpäivä** ja **viitenumero** sekä **ALV-merkintä**.
- **ALV:** 4H-nuorten vähäinen toiminta on todennäköisesti alle ALV-alarajan → lasku on tehtävä **ilman ALV:tä** ja siihen merkitään verottomuuden peruste (esim. "Arvonlisäveroton myynti, vähäinen toiminta"). **Vahvista tämä.**
- **Muuttumattomuus / audit trail:** kun lasku on lähetetty tai tekijä on sen hyväksynyt, lasku **lukitaan** — sitä ei voi muokata eikä lähettää uudelleen. Korjaus tehdään aina **uutena laskuna/hyvityksenä** (append-only historia, kaikki tapahtumat aikaleimoineen).
- **Säilytys:** tositteet ja laskut säilytettävä kirjanpitolain mukaisesti (**tositteet 6 vuotta**). Talleta pysyvästi (esim. PDF + tietokantatietue), älä pelkkänä muokattavana tilana.
- **Molemmilla osapuolilla** oma kopio jokaisesta laskusta järjestelmässä + sähköpostikopiot.
---
## 5. Tietomalli (suositus)
- `erä`: id, numero (1–4), arvo (1575), tila.
- `tekijä_pesu`: erä_id, tekijä_id, pestyt_ikkunat, sovittu_muutos, ennakko.
- `johtaja_pesu`: erä_id, johtaja_id (J/M), pestyt_ikkunat.
- `lasku`: id, tyyppi (`tekijä` | `johtaja_valinen`), lähettäjä, vastaanottaja, erät[], rivit, kokonaissumma, x, kate, kate_per_johtaja, vapaa_muokkaus, tila (`luonnos`|`lähetetty`|`hyväksytty`|`hylätty`), aikaleimat, laskunumero, viitenumero, pdf.
- `sähköposti_loki`: lasku_id, vastaanottajat, aikaleima.
---
## 6. Validoinnit ja hyväksymiskriteerit
1. **Ikkunamäärän täsmäytys (KORJATTAVA BUGI):** Kokonaistilanne-näkymän ikkunamäärän on oltava **täsmälleen** kaikkien pesemien ikkunoiden summa (tekijät + J + M). Nyt heittää yhdellä ikkunalla.
   - **Todennäköinen syy:** desimaali-ikkunat (13,5 / 24,5) pyöristetään riveittäin ennen summausta. **Summaa aina tarkoilla desimaaleilla, älä pyöristä per rivi.** Vertaa: `näytetty_kokonaismäärä === SUMMA(kaikki pestyt, ilman pyöristystä)`.
2. `x` pyöristetään **2 desimaaliin**; kate lasketaan **jäännöksenä**; `tekijät_ansaittu_yht + J_loppusumma + M_loppusumma === S` (ero 0,00 €).
3. Tekijän "Lähetä lasku" -painike toimii **tasan kerran** per lasku; lähetyksen jälkeen lasku lukittu.
4. Johtaja voi lähettää tekijälle **rajattomasti** uusia maksuja; hylätty ei estä uutta.
5. Johtaja **ei näe "Maksut"-painiketta omalla rivillään**, näkee sen toisen johtajan rivillä.
6. Erä-reititys: 1–3 → Joonatan, 4 → Matias. Sähköpostikopiot **aina molemmille**.
7. Lähetetty/hyväksytty lasku on **muuttumaton**; korjaus vain uutena laskuna.
---
## 7. Testitapaus (erät 1–3) — käytä yksikkötestinä
**Syöte:** `S = 4725`
- Tekijät (ikkunat): Jani 31, Milja 16, Oliver 15, Petra 11, Oona 11, Dom 5 (= 89)
- Sovitut muutokset: Milja **+20**; muut 0
- Ennakot: Jani **380** (ei vaikuta katteeseen); muut 0
- Johtajat: J **13,5**, M **24,5** (= 38)
- `kokonaisikkunat = 127`
**Odotettu tulos, ei välttämättä oikein**
| Suure | Arvo |
|---|---|
| x (2 des.) | **37,20 €** |
| Tekijät ansaittu yht. (sis. Milja +20) | **1800,00 €** |
| Jani maksettava nyt (620 − 380) | 240,00 € |
| J omat (37,20 × 13,5) | 502,20 € |
| M omat (37,20 × 24,5) | 911,40 € |
| **Kate** (4725 − 1800 − 502,20 − 911,40) | **1511,40 €** |
| Kate / 2 | 755,70 € |
| **J loppusumma** | **1257,90 €** |
| **M loppusumma** | **1667,10 €** |
| Tarkistus (1800 + 1257,90 + 1667,10) | **4725,00 €** ✓ |
| Ikkunat yhteensä | **127** (ei 128) |
**Reititys:** johtaja-välinen lasku erät 1–3 → vastaanottaja **Joonatan**; kopiot molempien sähköpostiin.
---
## 8. Toteutusohje
Tee muutokset olemassa olevan järjestelmän tyyliin ja arkkitehtuuriin sopien. Aloita: (1) lue nykyinen projektinäkymä + tekijä/johtaja-näkymät ja niiden datamalli, (2) toteuta laskentalogiikka (kohta 2) puhtaana funktiona + yksikkötesti (kohta 7), (3) rakenna näkymät (kohta 3), (4) lisää laskujen muuttumaton tallennus + sähköpostikopiot + PDF (kohdat 4–5), (5) korjaa ikkunamäärän off-by-one (kohta 6.1). Kysy jos jokin datamallin kohta on epäselvä ennen isoja muutoksia.

---

## Käyttäjän jakopyyntö (sana sanalta)

> "devide this plan into 5 stages, and every stage has to be done completely
> before even thinking the next stage, after execution confirm its status and
> request to start the new stage, that way we can do this much better, it is
> important, that you make a new pr or new place of the whole plan where you
> copy the whole plan so if you ran out of credits other agents/accounts can
> run and continue this 100%. [...] ja oikeesti jaat tän viiteen osaan ja
> kerron vasta kun saat jatkaa ja mennä eteenpäin."

Tästä pyynnöstä syntyi tämän tiedoston yllä oleva 5-vaiheinen suunnitelma ja
prosessi (tee vaihe → raportoi → odota lupa → jatka).
