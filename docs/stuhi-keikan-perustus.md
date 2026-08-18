# Stuhi — keikan perustus alusta loppuun

> Konkreettinen tarkistuslista tälle yhdelle keikalle. Yleinen ohje on
> `docs/uusi-keikka-ja-asiakas.md`; tämä kertoo mitkä arvot juuri Stuhille
> asetetaan ja **miksi**, jotta niitä ei tarvitse päätellä uudelleen.

## Mikä Stuhi on

Rekisteröity yhdistys (**ry**), vapaaehtoispohjainen tekninen yhteisö samassa
rakennuksessa kuin FR8-lippulaivakeikka. Yhteyshenkilö **Akseli**.

Korvaus **ei ole rahaa** vaan näkyvyyttä ja vastavuoroisuutta. Tämä ei ole
alennus eikä nollattu lasku: keikka on tyyppiä *yhteisökeikka*, jolloin euroja
ei lasketa eikä näytetä missään.

Työn laajuus: **noin 15 ikkunaa**, mutta ne ovat isoja monilohkoisia ikkunoita
— arvio **noin 1,5 h per ikkuna**, eli koko keikka ~22,5 h.

## Pohjakuva

Stuhin osuus on pohjapiirroksen **korostettu keskikaista**: kaksi huonetta
(14,5 m² ja 15,0 m²), VAR 3,5 m², ET 12,0 m² ja käytävä 42,0 m². Muut huoneet
(48,5 / 25,0 / 69,5 m²) näkyvät kuvassa mutta **eivät kuulu tähän keikkaan** —
ne ovat kuvassa mukana, koska ne auttavat hahmottamaan missä ollaan.

### Kuvan esitystapa: **Viivapiirros**, ei "valokuva"

Tämä on vastoin ensimmäistä arvausta, joten se kirjataan tähän.

Pohjakuva on **valkoista taustaa ja lähes mustia huoneita**. Kun se näytetään
sellaisenaan tummalla teemalla, valkoinen tausta on iso kirkas laatta keskellä
tummaa sivua — häiritsevä. `planRender: "plan"` (oletus) kääntää värit, jolloin
tausta menee mustaksi ja sulautuu sivuun, huoneet muuttuvat vaaleiksi ja
vihreät pisteet erottuvat niiltä hyvin.

Vertailu on ajettu ja katsottu (kolme käsittelyä rinnakkain) — käännetty voitti
selvästi. **Älä siis valitse "Valokuva / ruudunkaappaus"** vain siksi että kuva
on kaapattu jostain: ratkaisevaa on kuvan SÄVY, ei sen alkuperä.

`"photo"` on oikea valinta silloin kun kuva on aito valokuva tai valmiiksi
tummapohjainen kaappaus, jolloin kääntäminen tekisi siitä negatiivin.

Sivuhuomio: kääntäminen kääntää myös korostuksen — Stuhin kaista on
alkuperäisessä musta ja kääntyy vaaleaksi. Korostus säilyy, se vain vaihtaa
suuntaa.

## Asetukset järjestyksessä

Kaikki muu paitsi pohjakuva ja pisteet asetetaan **yhdellä kertaa**
`/admin/new-gig`issä: se luo asiakkaan, keikan ja karttablobin samalla
lähetyksellä. Erillistä asiakkaan luontia `/admin/customers`issa **ei tarvita**.

| # | Missä | Kohta | Arvo | Miksi |
|---|---|---|---|---|
| 1 | `/admin/new-gig` | Korvaus | **Yhteisökeikka** | Hinta aidosti 0, `agreedPrice` ei kirjaudu, asiakas ei näe euroja. Hintakentät katoavat lomakkeelta. |
| 2 | ” | Tilaaja | **Yhdistys (ry)** | Kertoo miksi keikasta ei makseta. Ei "yritys, jonka hinta on 0". |
| 3 | ” | Asiakasnäkymän ilme | **Tekninen** | Tumma mittarinäkymä. Tekniselle yhteisölle luontevampi kieli. |
| 4 | ” | Malli | **Pohjakuva & ikkunat** | Sektorit johdetaan kartasta. Käsin syötetyt korvautuisivat silti. |
| 5 | ” | Kerrokset / tilat | **`Tila`** | Yksi kuva = yksi "kerros". Huoneet erottuvat kuvasta itsestään. |
| 6 | ” | Yksikön nimi | **`tila`** | Muuten lukee "1. kerros" yhden huoneen keikalla — sekä kartalla että laskutussektorissa. |
| 7 | ” | Ikkunoita arviolta | **15** | Antaa etenemälle nimittäjän ennen kuin pisteet on merkitty. Tarkentuu kartasta. |
| 8 | ” | Tuntia / ikkuna | **`1,5`** | Antaa kokonaisarvion (~22,5 h) ja tuntipohjaisen ETA:n. |
| 8b | ” | Allekirjoitus | **Sopimus myöhemmin** | Työ alkaa ennen paperia: asiakkaan linkki avautuu suoraan seurantaan. Kun sopimus valmistuu, liitä se keikan Sopimus-kortista — se nousee asiakkaalle popuppina luettavaksi ja allekirjoitettavaksi eikä sulje seurantaa. |
| 9 | ” | Yhdistyksen nimi | yhdistyksen virallinen nimi | Sopimus, asiakaslinkki, keikkalista. |
| 10 | ” | Yhteyshenkilö | **Akseli Kettunen** | Eri kenttä kuin yhdistyksen nimi — molemmat näkyvät keikkalistalla. |
| 11 | ” | Y-tunnus | yhdistyksen Y-tunnus | Yhdistyksellä on Y-tunnus kuten yrityksellä. |
| 12 | ” | Osoite / kohde | rakennuksen osoite | Menee myös kartan otsikkoon (`building.address`). |
| 13 | keikka → **Asetukset** | Pohjakuva | lataa kuva | Menee liitetauluun, ei karttablobiin. |
| 14 | ” | Kuvan esitys | **Viivapiirros** | Ks. yllä — tämä on mitattu, ei arvattu. |
| 15 | projektinäkymä → Kartta | Pisteet | ~15 kpl | `+` → "Punainen piste" → klikkaa kohtaa. Tila jää päälle. |

**Huom kohta 2:** `customer_type`-sarake syntyy palvelimen käynnistyksen
automaattimigraatiossa (`server/index.ts`). Perusta keikka vasta kun muutos on
julkaistu, muuten laji ei tallennu.

**Sopimustunnus:** jätä tyhjäksi jos tunnusta ei ole. Pelkkä viiva ("-") oli
aiemmin arvo kuten mikä tahansa muu, ja se näkyi asiakkaalle otsikkona
"- · Tarjous & sopimus"; viiva tulkitaan nyt tyhjäksi, mutta tyhjä on selvempää.

**Mitä lomakkeelle EI tarvitse laittaa:** hintaa, laskutusväliä eikä
sopimustekstiä. Yhteisökeikalla hintakentät ovat piilossa, ja ALV-huomautus
vaihtuu itse muotoon "Vastikkeeton yhteisötyö — ei laskutusta eikä
arvonlisäveroa."

## Pisteiden lisääminen

Projektinäkymä → **Kartta** → `+` → "Punainen piste" → klikkaa pohjakuvaa.
Lisäystila jää päälle, joten jokainen seuraava ikkuna on yksi klikkaus.

**Karttaa saa nyt zoomata ja liikuttaa myös lisäystilassa.** Se oli aiemmin
jäädytetty juuri silloin kun sitä eniten tarvitsee: 14,5 m²:n huoneeseen ei
osu tarkasti jos siihen ei pääse lähemmäs. Panorointi ei jätä jälkeensä
pistettä — veto on veto, napautus on napautus.

Merkinnät: piste kiertää tiloja **ei → kesken → pesty**. "Kesken" on tarkoitettu
juuri tälle keikalle tyypilliseen tilanteeseen, jossa yksi monilohkoinen ikkuna
jää kesken kahden käynnin väliin.

### Kaikki pisteet punaisia

Keltainen (P2) on FR8:n hinnoitteluneuvottelua varten. Yhteisökeikalla ei ole
hintaa neuvoteltavaksi, joten kaikki ikkunat ovat punaisia (P1) — ne ovat työn
piirissä sellaisenaan.

## Mitä asiakas näkee

`/seuranta/<token>` — tumma tekninen näkymä:

- **Rengasmittari**: edistyminen prosentteina, segmentoituna niin että
  asteikon voi lukea, iso luku keskellä.
- **Avain–arvo-luenta**: tila, pesty, jäljellä.
- **Kartta**: pohjakuva, pisteet ja niiden tilat reaaliaikaisesti.
- **Ei euroja missään.** Ei sektorikortteja, ei "kertynyt", ei laskuja.
  Oletusteksti kertoo että työ tehdään veloituksetta.

Linkki toimii ilman kirjautumista — se on tarkoitettu jaettavaksi yhteisölle.

## Mitä tekijä näkee

`/tyo/<token>` — sama kartta, omat merkinnät, tunnit. Yhteisökeikalla **ei
luvata ikkunakohtaista korvausta**, ja maksuerämittari on piilossa (sitä ei ole).

## Tarkistus ennen kuin linkki lähtee Akselille

- [ ] Asiakkaan laji on **Yhdistys (ry)**, ei Yritys (näkyy `/admin/gigs`-listalla)
- [ ] Korvaustapa on **Yhteisökeikka**; keikkalistassa lukee `Yhteisökeikka · 0 €`
- [ ] `/seuranta/<token>` ei näytä yhtään euromäärää
- [ ] Pohjakuva näkyy **kaikissa kolmessa** näkymässä (admin, tekijä, asiakas)
- [ ] Pisteitä on ~15 ja ne osuvat oikeisiin huoneisiin
- [ ] Tilan nimi lukee "Tila", ei "1. kerros"
- [ ] Keikka **ei** näy FR8:n rahaluvuissa (etusivun urakkakortti, ALV-raja)
