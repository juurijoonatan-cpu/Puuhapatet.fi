# Talous ja verotus — kahdenkertainen kirjanpito (Osa 1)

Tämä dokumentti kuvaa admin-puolen **"Talous ja verotus"** -osion uudistuksen
(Osa 1): FAS-mukaisen kahdenkertaisen kirjanpidon, joka muodostuu
automaattisesti laskutuksesta, kuluista ja yrittäjien välisistä laskuista —
jotta kuka tahansa (ihminen tai agentti) voi jatkaa työtä ilman, että konteksti
katoaa. Päivitä tätä, kun logiikka muuttuu. Ks. myös `docs/fr8-vero-ja-maksut.md`
(alihankkijan vero/maksulogiikka — ei muutettu tässä) ja `docs/fr8-tyo-logiikka.md`.

## Tausta ja lähtökohta

Puuhapatetia pyörittää kaksi 4H-yrittäjää, joilla on omat Y-tunnukset —
**Joonatan Juuri** (3598782-9) ja **Matias Pitkänen** (3609912-9) —
ks. `shared/billers.ts` (`BRAND_BILLERS`). Ennen tätä muutosta järjestelmässä
ei ollut mitään kahdenkertaista kirjanpitoa: kaikki "talousluvut" laskettiin
ad hoc suoraan `jobs`/`expenses`/`investments`/`founder_settlements`-tauluista
joka näyttökerta (ks. `client/src/pages/admin/tax-export.tsx`,
`server/routes.ts` — `/api/admin/biller-turnover`, `/api/admin/founder-settlement`).
Tämä toimi hyvin OmaVero-täyttöä varten, mutta ei ollut oikeaa kirjanpitoa:
ei tilikarttaa, ei päiväkirjaa/pääkirjaa, ei tuloslaskelmaa/tasetta.

**Tätä EI poistettu.** "Oma tulos" -kortti ja kaikki sen alla olevat
dropdownit (Bossien velka, ALV-raja, Omat asiakaslaskut, Verotuloste,
Tiimi, Aloitustuki, OmaVero-ohjeet) toimivat täysin ennallaan — ne ovat
edelleen se paikka, mistä katsotaan mitä OmaVeroon ilmoitetaan. Uusi
kirjanpito on **lisätty rinnalle**, omana "Kirjanpito"-osionaan.

## Kaksi tarkoituksellisesti eri lukua

`client/src/pages/admin/tax-export.tsx` näyttää nyt KAKSI eri lukua, ja niiden
**ei ole tarkoitus täsmätä** tänään:

1. **"Oma tulos"** (yläosa, ennallaan) — nopea OmaVero-täyttöluku. Founderin
   kate-osuus FR8-urakoista luetaan tuloksi SAMANA vuonna kuin erä laskutettiin,
   riippumatta siitä, onko toinen founder vielä tilittänyt osuuttaan. Palvelumaksu
   on jo vähennetty.
2. **"Kirjanpito"** (`client/src/pages/admin/talous/kirjanpito-section.tsx`) —
   aito tapahtumaperusteinen kahdenkertainen kirjanpito. Joka asiakaslasku
   kirjataan KOKONAAN sen laskuttaneen founderin kirjanpitoon (koko erä, ei
   kate-osuus) — hän kun todella keräsi koko summan omalle Y-tunnukselleen.
   Toisen founderin osuus siitä näkyy kirjanpidossa vasta kun se **oikeasti
   tilitetään** (ks. alla, `founder_settlements`-taulu) — silloin se on
   yrittäjien välinen lasku (myynti/osto), ei ennakoitu saatava.

Molemmat ovat oikein, eri tarkastelutavoilla. Jos näistä halutaan yksi totuus,
se on jatkokehitystä (ks. "Avoimet jatkokehitysehdotukset").

## Tietomalli (`shared/schema.ts`)

Yksi täysin erillinen, itse täsmäävä kirjanpito per **ledger**
(kirjanpitovelvollinen). Tänään kaksi ledgeriä: `"joonatan"`, `"matias"`
(sama id kuin `BRAND_BILLERS`). Myöhempi Oy on vain kolmas `ledgers`-rivi
(`entityType: "oy"`) — skeema ei muutu.

- **`ledgers`** — id, name, yTunnus, entityType (`toiminimi`/`oy`).
- **`fiscal_years`** — tilikaudet per ledger. Kalenterivuosi oletuksena,
  luodaan automaattisesti ensimmäisen kirjauksen yhteydessä. `isClosed`
  suojaa tilikauden uudelleenkirjoitukselta (ks. alla).
- **`accounts`** — tilikartta per ledger. `isSystemAccount` = automaattikirjaajan
  käyttämä tili (ks. `server/finance/account-codes.ts` → `STANDARD_ACCOUNTS`).
- **`journal_entries`** + **`journal_lines`** — päiväkirja (tapahtumat) ja
  niiden debet/kredit-viennit. `sourceKey` on vakaa deduplikointiavain
  (esim. `"job:123:era:2"`, `"job:123:tekijalasku:45"`, `"expense:55"`,
  `"settlement:9:payer"`) — tekee uudelleenkirjauksesta idempotentin. Pääkirja EI ole erillinen taulu — se on
  `journal_lines` liitettynä `accounts`-tauluun ja ryhmiteltynä tilin mukaan
  (`server/finance/reports.ts` → `getGeneralLedger`), jotta se ei voi koskaan
  ajautua eri linjalle päiväkirjan kanssa.
- **`forecast_entries`** — ennustelaskelman rivit (ks. alla). Ei koske
  varsinaista kirjanpitoa.

## Tilikartta (`server/finance/account-codes.ts`)

Tilinumerot ja tilien nimet ovat omassa, kannasta riippumattomassa
tiedostossaan (`account-codes.ts`), jotta kirjaussääntöjä voi testata ilman
tietokantaa. `accounts.ts` re-exporttaa ne ja hoitaa kantapuolen
(`ensureLedger` luo puuttuvat tilit myös jo olemassa oleviin kirjanpitoihin).


FAS-mukainen, minimaalinen mutta täydellinen tuloslaskelman + taseen
muodostamiseen. Muutama tili on tarkoituksella varattu tulevaan käyttöön
(Oy, ALV-rekisteröinti, poistot) — ne näkyvät tilikartassa nollasaldolla
kunnes niitä tarvitaan:

| Koodi | Nimi | Tyyppi | Käytössä nyt? |
|---|---|---|---|
| 1090 | Koneet ja kalusto | asset | ei (varattu, ks. "Pienhankinnat" alla) |
| 1700 | Myyntisaamiset | asset | ei (varattu, suoriteperuste/Oy) |
| 1910 | Pankkitili | asset | **kyllä** |
| 2000 | Yksityissijoitukset | equity | ei (varattu) |
| 2010 | Yksityisotot | equity | ei (varattu) |
| 2020 | Edellisten tilikausien voitto/tappio | equity | ei (tase laskee kumulatiivisen tuloksen dynaamisesti, ks. alla) |
| 2800 | Ostovelat | liability | ei (varattu) |
| 2820 | Ostovelka toiselle yrittäjälle | liability | ei (varattu) |
| 2900 | ALV-velka | liability | ei (varattu, ALV-rekisteröinnin jälkeen) |
| 3000 | Myynnit | revenue | **kyllä** — asiakaslaskut |
| 3010 | Myynnit toiselle yrittäjälle | revenue | **kyllä** — yrittäjien väliset laskut (saatu) |
| 4000 | Ostot ja ulkopuoliset palvelut | expense | **kyllä** — tekijöiden (alihankkijoiden) erälaskut |
| 4010 | Ostot toiselta yrittäjältä | expense | **kyllä** — yrittäjien väliset laskut (maksettu) |
| 4900 | Kalusto ja välineet | expense | **kyllä** — investoinnit (kertapoisto) |
| 4990 | Muut kulut | expense | **kyllä** — `expenses`-taulun kuitit |
| 5000 | Henkilöstökulut | expense | ei (varattu, Oy + palkat) |
| 6000 | Poistot | expense | ei (varattu) |
| 8000 | Rahoitustuotot ja -kulut | expense | ei (varattu) |

## Mitä kirjataan automaattisesti (`server/finance/post.ts`)

`rebuildLedgers()` on koko automaattikirjaajan ydin. Se **poistaa** kaikki
edelliset automaattikirjaukset (paitsi suljetuilta tilikausilta) ja **kirjaa
ne uudelleen** nykyisen lähdedatan pohjalta — kirjanpito on siis aina puhdas
funktio `jobs`/`expenses`/`investments`/`founder_settlements`/`era_invoices`
-tauluista, eikä voi koskaan ajautua niistä eri linjalle. Kutsutaan
automaattisesti JOKA `/api/finance/*`-pyynnön alussa
(`server/finance/reports.ts`) — erillistä "synkronoi"-nappia ei ole eikä
tarvita.

Itse kirjaussäännöt (`buildDraftEntries`) asuvat
`server/finance/draft-entries.ts`:ssä: puhdas funktio lähderiveistä vienteihin,
ilman kantaa, jotta koko sääntökirja on yksikkötestattavissa
(`server/finance/post.test.ts`). `post.ts` on kantapuoli.

1. **Asiakaslaskut** — joka `jobs`-rivi (tai FR8-erä `gigData.payments`-listasta),
   jolla on TÄSMÄLLEEN YKSI tunnistettu founder-laskuttaja
   (`inferBillerId`, `shared/billers.ts` — sama sääntö kuin ALV-seurannassa
   ja bossien tilityksessä). Koko laskutettu summa → Pankkitili (debet) /
   Myynnit (kredit) sen founderin kirjanpitoon.
2. **Kulut** — `expenses`-taulun rivit, kohdistettu samalla säännöllä
   (job → founder). Muut kulut (debet) / Pankkitili (kredit).
3. **Hankinnat** — `investments`-taulun rivit, kohdistettu `boughtBy`
   (+ `splitWith` 50/50, jos asetettu). Kalusto ja välineet (debet) /
   Pankkitili (kredit). **Kirjataan kokonaan kuluksi ostohetkellä**
   (pienhankinnan kertapoisto), ei poisteta — FAS sallii tämän pienille
   välineille (alle n. 850 €/kpl); isommat hankinnat kannattaa tarkistuttaa
   kirjanpitäjällä ennen mahdollista poistokäytäntöä (tili 6000 on varattu tätä varten).
4. **Yrittäjien väliset laskut** — `founder_settlements`-taulun rivit
   (sama data kuin "Bossien velka" -kortin "Kirjaa maksu"/"Vastalasku").
   Maksajan kirjanpitoon: Ostot toiselta yrittäjältä (debet) / Pankkitili
   (kredit). Saajan kirjanpitoon: Pankkitili (debet) / Myynnit toiselle
   yrittäjälle (kredit). **HUOM**: näiden ei tarvitse olla eriteltyjä
   FR8-kate-osuuksia — mikä tahansa `founder_settlements`-rivi (myös
   "MobilePay — pikkukeikat kuitattu" -merkinnät) kirjautuu näin.
5. **Alihankkijakulu (tekijöiden erälaskut)** — `era_invoices`-taulun rivit
   joilla `kind = "tekija"` ja tila `lähetetty`/`hyväksytty`
   (`isEraInvoiceSettled`, `shared/worker-payouts.ts`). Ostot ja ulkopuoliset
   palvelut **4000** (debet) / Pankkitili (kredit) sen johtajan kirjanpitoon
   jonka lasku nimeää OSTAJAKSI (`recipientId`). Summa on **BRUTTO**
   (`eraInvoiceGrossCents` = `rivit.computed.ansaittuCents`), ei `totalCents`,
   koska `totalCents` on "maksettava nyt" = ansaittu − ennakko. Päivä on laskun
   päivä (`sentAt`), samalla perusteella kuin myyntipuolen erä laskutuspäivältä.

   **Miksi 4000 eikä 4010:** 4010 on yrittäjien VÄLISILLE laskuille. Tekijä on
   ulkopuolinen alihankkija, ja jos molemmat menisivät samalle tilille,
   tuloslaskelmasta ei enää näkisi erikseen ulos maksettua työkorvausta ja
   johtajien keskinäistä siirtoa (joka brändin tasolla kuittaa itsensä).
   **Miksi ei 5000 Henkilöstökulut:** maksu on työkorvausta eikä palkkaa
   (`docs/fr8-vero-ja-maksut.md`) — työnantajavelvoitteita ei synny.

   **Miksi tämä lisättiin:** ennen tätä koko erä kirjattiin myyntinä eikä
   tekijäkulua veloitettu lainkaan, joten laskuttavan johtajan tuloslaskelma
   näytti urakkasumman tuloksena. Punaiset ja keltaiset ovat eri laskuja eri
   riveillä (`eraNumbers`, sentinel-erä 0 = keltaiset), joten kaksi rahavirtaa
   eivät voi kaksinkertaistua.

### Mitä EI kirjata automaattisesti (tarkoituksella)

- **Palvelumaksu (palkkio "brändille")** — `worker_payments`-taulun data.
  Kenen kirjanpitoon tämä lopulta kuuluisi (jaettu founderien kesken? erillinen
  "brändi"-tili?) ei ole yksiselitteinen nykyisestä koodista — päätä tämä
  ennen kuin lisäät sen kirjanpitoon.
- **Tekijöiden LASKUTTAMATON velka** (`reserveCents`) — se osa tekijöiden
  ansaitsemasta palkasta josta ei ole vielä erälaskua. Kohta 5 kirjaa
  tositteelliset erälaskut; loppu jää kirjaamatta kahdesta syystä: (a) siitä ei
  ole tositetta, ja (b) sen ainoa lähde on karttablobi (`projectData`), jota
  uudelleenrakennus **ei tarkoituksella lue** — se ajetaan joka
  `/api/finance/*`-pyynnöllä ja blobi on kymmeniä megatavuja per urakkakeikka.
  Luku on nähtävissä keikan tasausnäkymässä (`reserveCents`,
  `shared/founder-settlement.ts`) ja etusivun urakkakortissa. Tilinpäätöksessä
  tämä on jaksotuskysymys (siirtovelka) — ks. "Mitä tässä on YHÄ auki".
  **HUOM:** aiemmin tässä luki että alihankkijakorvaukset on "jo netotettu pois
  katteessa". Se ei pitänyt paikkaansa: kirjaussääntö kirjasi bruton erän, ei
  katetta. Ks. kohta 5.
- **Käsin kirjatut tekijämaksut** (`CrewMember.payouts`, vanha kanava) — raha on
  liikkunut, mutta kanava ei tallenna maksajaa eikä ostajaa, joten kulua ei voi
  kohdistaa kenenkään kirjanpitoon (invariantti 18: ei arvata). Nämä näkyvät
  varoituksena tasauksessa (`unattributedPaidCents`). Kirjanpitoon ne saa
  mukaan tekemällä maksusta erälaskun.
- **Aloitustuki/yritysseteli** (`startup_bonus_usages`) — 4H-yhdistyksen tuki,
  ei Puuhapatetin liiketoiminnan tuloa/menoa tässä muodossa; näkyy edelleen
  "Aloitustuki"-dropdownissa ennallaan.

Jos joku näistä pitäisi kirjata automaattisesti, se on selkeä, rajattu
jatkokehitystehtävä `server/finance/post.ts:buildDraftEntries`-funktioon.

## Rinnakkaisuus ja idempotenssi

`rebuildLedgers()` on serialisoitu yhden in-flight-promisen takana
(`server/finance/post.ts`) — yksi sivulataus ampuu useita `/api/finance/*`-
pyyntöjä rinnakkain, ja jokainen kutsuisi `rebuildLedgers()`; ilman lukkoa
kaksi samanaikaista ajoa törmäisi `(ledgerId, sourceKey)`-uniikkirajoitteeseen.
Tämä on riittävä ratkaisu, koska sovellus pyörii yhtenä Express-prosessina
(ei useita palvelininstansseja) — ks. käyttäjän oma vaatimus koko talousosion
palautuvuudesta yhden serverin vikaantuessa (Osa 2, Google Drive -varmuuskopiointi).

## Raportit (`server/finance/reports.ts`)

- **Tuloslaskelma** — tulot/kulut TILIKAUDEN (kalenterivuoden) ajalta.
- **Tase** — KAIKEN historian kumulatiivinen saldo per tili asti annettuun
  päivään. Vastaavaa = Vastattavaa **rakenteellisesti** (ei erillistä
  täsmäytystä): joka vienti täsmää debet=kredit, joten tilien normaalisaldojen
  summa on aina nolla. Oma pääoma = "kumulatiivinen tulos" (kaikkien
  tilikausien Tuotot − Kulut) — toiminimellä KOKO voitto kuuluu suoraan
  omistajalle, joten erillistä tilinpäätöksen päätösvientiä ei (vielä)
  tarvita. Kun/jos Oy perustetaan, tämä on kohta, joka pitää muuttaa
  (osakepääoma, tilikauden ja edellisten tilikausien tulos eroteltuna,
  mahdollinen osingonjako).
- **Päiväkirja/Pääkirja** — `getJournal` (aikajärjestys) ja `getGeneralLedger`
  (tileittäin, juokseva saldo).

## Ennustelaskelma (`server/finance/forecast.ts`)

Täysin erillinen suunnittelutyökalu — EI koskaan kirjaa journal_entries-riviä.
Yksi `forecast_entries`-rivi on yksi kertaluonteinen tai kuukausittain
toistuva ennustettu tulo/kulu (nimi, summa/kk, alkukuukausi, valinnainen
loppukuukausi). `projectMonths()` laajentaa nämä kuukausitaulukoksi. UI:
"Ennuste"-välilehti `kirjanpito-section.tsx`:ssä.

## API (`server/finance/routes.ts`)

Kaikki `/api/finance/*`-reitit vaativat `role === "host"` (samalla
periaatteella kuin muutkin rahaa käsittelevät admin-reitit,
ks. `server/routes.ts` — laskutuserien hallinta). GET-reitit kutsuvat
`rebuildLedgers()` ensin, joten data on aina ajantasaista.

| Reitti | Kuvaus |
|---|---|
| `GET /api/finance/ledgers` | Ledger-lista (id, nimi, Y-tunnus) |
| `GET /api/finance/chart-of-accounts?ledgerId=` | Tilikartta |
| `GET /api/finance/journal?ledgerId=&year=` | Päiväkirja |
| `GET /api/finance/general-ledger?ledgerId=&year=` | Pääkirja |
| `GET /api/finance/income-statement?ledgerId=&year=` | Tuloslaskelma |
| `GET /api/finance/balance-sheet?ledgerId=&asOf=` | Tase |
| `GET /api/finance/summary?ledgerId=&year=` | Yhteenveto (4 lukua) |
| `GET/POST /api/finance/forecast?ledgerId=` | Ennusterivit |
| `PATCH/DELETE /api/finance/forecast/:id` | Muokkaa/poista ennusterivi |
| `GET /api/finance/forecast/projection?ledgerId=&start=&end=` | Kuukausiprojektio |
| `GET /api/finance/backup/status?ledgerId=&year=` | Google Drive -varmuuskopion tila (ks. Osa 2 alla) |
| `POST /api/finance/backup` | Varmuuskopioi tilikartta/päiväkirja/pääkirja/tuloslaskelma/tase/ennuste Driveen |

Client-puolen tyypitetyt kutsut: `client/src/lib/api.ts` (`api.finance*`).

## Frontend

- `client/src/pages/admin/tax-export.tsx` — pääsivu (reitit `/admin/talous`
  ja `/admin/tax-export`, jälkimmäinen alias). Ennallaan ylä- ja alaosa; uusi
  `<KirjanpitoSection>` upotettu "Oma tulos" + "Bossien velka" + "ALV-raja"
  -korttien JÄLKEEN, ennen "Yksityiskohdat & dokumentit" -osiota. **(Tämä
  sivurakenne on uudistuksen kohteena, ks. "Osa 3" alla — säilytä tämä kuvaus
  vain historiallisena kontekstina kunnes uudistus on viety läpi.)**
- `client/src/pages/admin/talous/kirjanpito-section.tsx` — koko uusi
  kirjanpito-UI: founder-valitsin, vuosivalitsin, `<DriveBackupBar>`
  (ks. Osa 2), ja 5 välilehteä (Yhteenveto, Tuloslaskelma, Tase,
  Tilit & pääkirja, Ennuste).

## Migraatio / käyttöönotto

Ei erillisiä migraatiotiedostoja — tämä projekti käyttää
`npm run db:push` (drizzle-kit push suoraan skeemasta, ei versioituja SQL-
migraatioita, ks. `drizzle.config.ts`). **Uusien taulujen käyttöönotto
vaatii `npm run db:push` ajamisen tuotanto-/kehitystietokantaa vasten**
(Render/Supabase) ennen kuin uudet `/api/finance/*`-reitit toimivat. Muutos
on täysin additiivinen — ei poista/muuta yhtään olemassa olevaa taulua tai
saraketta, ei riskiä olemassa olevalle datalle.

Testattu paikallisesti: Postgres 16, siemendata (2 asiakasta, 2 valmista
keikkaa eri laskuttajilla, 1 kulu, 1 investointi 50/50-jaolla, 1 yrittäjien
välinen tilitys) → tuloslaskelma, tase (täsmää: vastaavaa = vastattavaa) ja
pääkirja tarkistettu käsin oikeiksi sekä selaimessa (Playwright) että API:sta.

## Avoimet jatkokehitysehdotukset

1. **Palvelumaksun (palvelumaksu/"brändin kassa") kirjanpitokohde** — päätä
   kuuluuko se founderien kirjanpitoon (ja millä jaolla), ja lisää postaus
   `buildDraftEntries`-funktioon jos kyllä. (Ei vielä päätetty — ei osa Osa 3:a.)
2. **"Oma tulos" ↔ "Kirjanpito"-luvun yhdistäminen** — **päätetty 10.7.2026:
   EI yhdistetä.** Molemmat luvut säilyvät tarkoituksella erillisinä (kate-osuus
   heti vs. koko-erä-sitten-tilitys palvelevat eri tarkoitusta), mutta Osa 3
   (ks. alla) siivoaa pois sen, että "Oma tulos" -luku toistui 4 kertaa
   samalla sivulla — jatkossa se näytetään kerran, selkeästi nimettynä, sen
   viereen selittäen miksi se voi poiketa Kirjanpidon tuloksesta.
3. **Tilikauden päätösvienti** — kun tilikausi halutaan virallisesti sulkea
   (`fiscal_years.isClosed = true`), lisää UI-toiminto sille + päätösvienti
   joka siirtää tilikauden tuloksen "Edellisten tilikausien voitto/tappio"
   -tilille (2020). Skeema tukee tätä jo (`isClosed`), toteutus puuttuu.
   Ei kiireellinen niin kauan kuin molemmat ovat toiminimiä.
4. **Oy-muutos** — lisää kolmas `ledgers`-rivi (`entityType: "oy"`), tarkista
   oma pääoma -tilien nimet (Osakepääoma vs. Yksityissijoitukset), harkitse
   ALV-tilien (2900) käyttöönottoa jos Oy rekisteröityy ALV-velvolliseksi,
   ja päätä miten vanhat toiminimi-ledgerit suhtautuvat uuteen Oy-ledgeriin
   (esim. apporttina, tai rinnakkain historian ajan).
5. ~~**Osa 2** (odottaa erillistä lupaa): Google Drive -integraatio kaikkien
   näiden raporttien + laskujen automaattiseen varmuuskopiointiin.~~ **VALMIS**
   (`server/finance/backup.ts`, `/api/finance/backup*`, `<DriveBackupBar>`
   — ks. `docs/google-drive-backup.md`). Tämä kohta jäi aiemmin merkitsemättä
   valmiiksi vaikka toteutus oli jo tehty — korjattu 10.7.2026.

## Osa 3 — käyttöliittymän uudistus kahdelle kevytyrittäjälle (2026-07-10 →)

Käyttäjäpalaute: sivu on ammattimaisen kirjanpidon (yllä kuvattu) ympärillä
edelleen liian sekava — 13 päällekkäistä osaa, sama tulos toistuu 4 kertaa,
"kuka laskutti" on 4 erillistä kontrollia, ja admin-tekoälyllä ei ole
pääsyä yhteenkään näistä luvuista. Uudistus (ei muuta yllä kuvattua
kirjanpitomoottoria — vain sen ympärillä olevaa näkymää ja tekoälyn
pääsyä siihen):

- **Vaihe A** (tämä commit) — perusta: kotitalousvähennysvakiot koottu
  `shared/tax.ts`:ään, kuollut koodi siivottu, tämä dokumentti päivitetty.
- **Vaihe B** — Talous-sivu rakennetaan uudelleen 5 välilehden ympärille
  (Yhteenveto / Laskut / Tuloslaskelma / Tase / Ennuste) + piilotettu
  Lisäasetukset-osio ("Urakkaerien hallinta" ym. korjaustyökalut). Molemmat
  founderit näkevät oletuksena toistensa laskutetut keikat.
- **Vaihe C** — tilikartan ja pääkirjan esitys: tilin nimi edellä, koodi
  pienenä/himmeänä lisätietona.
- **Vaihe D** — admin-tekoäly saa uudet työkalut tuloslaskelman, taseen,
  ALV-tilanteen ja verolaskurin lukemiseen samasta datasta kuin tämä sivu.

Ks. myös haaran `claude/puuha-paten-accounting-redesign-iuokbj` PR-kuvaus
tarkemmalle vaihe-erittelylle.

## Tositteiden säilytys — mitä EI voi poistaa

Kirjanpitolaki vaatii tositteiden säilyttämisen **6 vuotta**. Järjestelmä
estää nyt poistot jotka veisivät tositteen mukanaan. Sääntö on aina sama:
*tosite ei katoa, se merkitään mitätöidyksi ja jää riviksi historiaan.*

| Toiminto | Mitä tapahtuu |
|---|---|
| Erälaskun mitätöinti | Rivi säilyy (`tila: "hylätty"`), PDF regeneroituu ja on ladattavissa Maksut-välilehdeltä ja tekijän omasta näkymästä. Laskunumero jää käyttöön — numerosarjaan ei tule aukkoa. |
| Asiakkaan laskutuserän poisto | Lähetetty erä **mitätöidään** (`GigPayment.voided`), ei poisteta. Kaikki summat ohittavat sen (`livePayments`), myös kirjanpidon myyntikirjaus. Vain lähettämätön haamuerä poistetaan oikeasti. |
| Tekijän poisto keikalta | Jos hänellä on maksettuja maksuja, dokumentteja tai allekirjoitettuja sopimuksia, hänet **deaktivoidaan** eikä poisteta. Vastaus kertoo syyn. |
| Keikan tai asiakkaan poisto | **Estetty** (409) kun keikalla on maksettuja tekijämaksuja, kuluja, lähetettyjä laskutuseriä tai erälaskuja. Merkitse keikka peruutetuksi sen sijaan. |
| Palvelumaksuhistorian nollaus | Vaatii perustajan roolin JA `{"confirm":"NOLLAA"}`. Poistettu rivimäärä kirjataan lokiin. |
| Tekijän 101. payout | Ei putoa enää katosta jos se on **maksettu** — katto koskee vain maksamattomia (`MAX_PAYOUTS_KEPT`). |

**Yhä auki:** tilikauden sulkeminen (`fiscalYears.isClosed`) on skeemassa mutta
toteuttamatta. Kunnes se on tehty, `rebuildLedgers()` rakentaa päiväkirjan
uudelleen joka haulla, eli poisto avoimelta tilikaudelta ei jätä vastakirjausta.

---

# Kolme korjattua lukua etusivulla ja ALV-kortissa (17.8.2026)

Perustaja huomasi kolme lukua jotka eivät vastanneet todellisuutta. Kaikki
kolme olivat aitoja vikoja, eivät väärinlukemisia. Tämä osio kirjaa mitä ne
olivat ja miksi — jotta samoja ei rakenneta takaisin.

## 1. "Pitää liikaa" näytti TEKIJÖIDEN rahat johtajien velkana

Etusivun **Urakkakeikat — raha** -kortti näytti per johtaja `netByFounder`in eli
`holdsCents − entitledCents` (`shared/founder-settlement.ts`). Rivien nettojen
summa on **määritelmällisesti `reserveCents`** — raha jota johtajat pitävät
mutta joka kuuluu vielä tekijöille. Invariantti 17 sanoo nimenomaisesti ettei
sitä jaeta eikä se ole kummankaan katetta.

Seuraus: **molemmat** johtajat lukivat yhtä aikaa "pitää liikaa", mikä on
velkalukemana mahdotonta — kaksi osapuolta ei voi olla toisilleen
nettovelallisia. Se oli oire, ei paradoksi: mittatikku oli kummankin oma
ansainta, ei toinen johtaja.

Todellinen tilanne kortin omilla luvuilla:

| | |
|---|---|
| Kortin väite | J pitää liikaa 2 728,25 € · M pitää liikaa 1 288,25 € |
| Σ = tekijöiden varaus | 4 016,50 € |
| Kummankin osuus varauksesta | 2 008,25 € |
| **Oikea johtajien välinen epätasapaino** | **720,00 €** (J → M) |

Eli 2 728,25 = 2 008,25 + 720 ja 1 288,25 = 2 008,25 − 720.

**Korjaus:** kortti näyttää nyt `dueByFounder`in ("maksaa" / "saa"), yhden
lauseen siitä mitä pankissa oikeasti liikkuu **suuntineen**, ja tekijöiden
varauksen erikseen omana rivinään. Luvut olivat jo laskettuna moottorissa —
`/api/admin/gig-money` vain ei palauttanut niitä.

**Sivulöydös:** 380,00 € tekijöille maksettua on kirjattu ilman maksajaa, joten
moottori ei voi vähentää sitä keneltäkään (invariantti 18: se ei arvaa).
Se paisutti molempia lukuja yhteensä 380 €. Keikan oma tasausnäkymä varoitti
tästä; etusivu ei varoittanut lainkaan. Nyt varoittaa.

## 2. "Oma tulo" ei sisältänyt urakkakeikoista senttiä

`client/src/pages/admin/dashboard.tsx` laski luvun selaimessa `/api/jobs`in
riveistä: `assignedTo` + `status === "done"`, summana `agreedPrice`
jaettuna tekijämäärällä. **Urakkakeikka on `in_progress` koko kestonsa ajan**,
joten koko urakkatyö oli näkymätöntä — 572,13 € "omaa tuloa" samalla kun
urakasta oli laskutettu 6 150 €.

Pahempi puoli: suodattimesta puuttui `isCustomGig`. Kaikki muut saman taulun
lukijat rajaavat urakkakeikat pois (`server/finance/settlement.ts`,
`post.ts`, `routes.ts`); tämä oli ainoa joka ei. Jos joku merkitsee
urakkakeikan valmiiksi, luku hyppäisi **sopimuksen kattoon jaettuna
tekijämäärällä** — luku joka ei ole liikevaihtoa eikä katetta, ja joka
laskettaisiin toisen kerran urakkakortissa.

**Korjaus:** urakkakeikat pois naiivista summasta, ja tilalle johtajan **oikea**
ansio moottorista (`entitledCents` = oma pesutyö + omat keltaiset + tasaosuus
katteesta). Kortti näyttää erittelyn "pikkukeikat X + urakat Y − investoinnit Z",
koska yksi luku ilman erittelyä oli juuri se mikä ei täsmännyt millään.

**Huom mikä EI ollut vikaa:** 4 575,00 € ei ole Joonatanin tulo — se on hänen
Y-tunnuksellaan **kerätty kassa**. Siitä 5 576,50 €/6 150 € on tekijöiden
palkkaa; johtajien yhteinen kate koko urakasta on 573,50 €.

## 3. ALV-raja ei nähnyt yrittäjien välisiä laskuja

`computeBillerTurnover` sai **vain `jobs`-rivit**
(`server/routes.ts` → `server/finance/settlement.ts`). Se mittasi siis
"asiakasrahaa jonka tämä johtaja keräsi" eikä "laskuja jotka tämä Y-tunnus
lähetti".

Se on väärä mittari juuri tälle liiketoimintamallille: johtajat **jakavat erät
tarkoituksella keskenään** ettei kummankaan liikevaihto ylitä 20 000 €:n
vähäisen toiminnan rajaa, ja siirtävät rahan oikealle ansaitsijalle
**laskuttamalla toisiaan** omilla Y-tunnuksillaan. Lähetetty lasku on
lähettäjän omaa myyntiä ja kerryttää hänen rajaansa.

Kaksi mekanismia oli täysin näkymättömiä:

| Taulu | Tila ennen |
|---|---|
| `era_invoices`, `kind = "johtaja_valinen"` | numeroitu, viitteellinen, sähköpostitettu, PDF-arkistoitu lasku — **ei missään liikevaihdossa** |
| `founder_settlements` | kirjattu maksu — kirjanpidossa tilillä 3010 (myynti), **ei ALV-kortissa** |

Sama euro oli siis **tuloslaskelmassa myyntiä ja ALV-kortissa ei mitään**,
samalla sivulla.

**Korjaus:** `johtaja_valinen`-laskut (tila `lähetetty` tai `hyväksytty`,
vuosi lähetyshetkestä) lasketaan lähettäjän liikevaihtoon. Maksajalta ei
vähennetä mitään — osto ei ole negatiivista liikevaihtoa, ja nykyinen
vähennyksen puuttuminen oli jo oikein. Kortti näyttää erittelyn
"asiakaslaskut X + yrittäjien väliset Y".

### Kaksoislaskennan esto

`era_invoices` ja `founder_settlements` ovat **kaksi kirjausta samasta
taloudellisesta tapahtumasta**. Niitä ei summata yhteen. Laskurivit voittavat
(lasku on tosite, jolla on numero ja joka on muuttumaton lähetyksen jälkeen), ja
ero raportoidaan omana varoituksenaan (`settledWithoutInvoiceCents`) — muuten
osa myynnistä jäisi hiljaa näkymättä.

Vartija: `server/finance/biller-turnover.test.ts` (10 testiä).

### Mitä näistä on nyt korjattu

Kaikki alla oleva tehtiin samassa työssä; loput ovat edelleen kirjanpitäjän
päätettävää (seuraava osio).

| Asia | Tila |
|---|---|
| Kohdentamaton laskuttaja katosi kortilta | **korjattu** — `billedBy` joka osoitti muuhun kuin brändin laskuttajaan ei ollut kenenkään liikevaihdossa **eikä** kohdentamattomien listalla. Ehto oli `else if (!row.billedBy)`; nyt kaikki kohdentamaton menee listalle. |
| Kohdentamattomien erien vuosisekoitus | **korjattu** — `{vuosi}`-otsikon alla oleva summa laski kaikkien vuosien erät. Nyt suodatetaan valittuun vuoteen; päivämäärätön erä jää mukaan (se on nimenomaan korjattavien joukossa). |
| Lähetetty mutta hylätty sisäinen lasku | **korjattu näkyväksi** — ei liikevaihdossa (hylättyä ei todennäköisesti makseta), mutta lähetetty lasku on `isEraInvoiceReceipt`in mukaan yhä **tosite**, joten sitä ei vaieta: oma varoitusrivi (`rejectedButSentCents`). Oikea käsittely on hyvityslasku, ei poisjättö. |
| Kahden vuoden ehto (1.1.2025) | **osittain** — edellinen vuosi näkyy nyt jokaisen johtajan rivillä ja kortti kertoo että ehto koskee kahta vuotta. Sääntöä **ei valvota automaattisesti**: se vaatii vero.fi-varmistuksen. |
| Kirjauspäivän peruste | **nimetty, ei yhtenäistetty** — `TURNOVER_DATE_BASIS` (`server/finance/settlement.ts`) kirjaa nyt eksplisiittisesti että urakkaerä käyttää laskutushetkeä, sisäinen lasku lähetyshetkeä ja pikkukeikka **työn päivää**. Pikkukeikan laskun päivää ei ole tallennettuna missään (`jobs`illa ei ole laskutuspäivää), joten peruste on yhä epäyhtenäinen — mutta nyt näkyvä valinta yhdessä paikassa eikä vahinko. |
| Alihankkijakulu puuttui tuloslaskelmasta | **korjattu** — ks. oma osio alla. |

### Mitä tässä on YHÄ auki — kirjanpitäjän päätettävää

Näitä ei ratkaistu koodissa, koska ne ovat verotus- eivät ohjelmointikysymyksiä:

1. **Kumpi taulu on kanoninen** yrittäjien välisille myynneille? Nyt
   `era_invoices` voittaa ja `founder_settlements` vain raportoidaan. Pitkällä
   aikavälillä toisen pitäisi **johtua** toisesta, ei elää rinnalla.
2. **Suorite- vai maksuperuste.** Kortti käyttää nyt kolmea eri päivää:
   urakkaerä laskutushetkestä, pikkukeikka **työn päivästä**
   (`scheduledAt ?? createdAt`), sisäinen lasku lähetyshetkestä. Peruste pitäisi
   lyödä lukkoon kertaalleen kaikille kolmelle.
3. **Kahden vuoden ehto.** Vähäisen toiminnan raja riippuu 1.1.2025 alkaen sekä
   kuluvasta että edellisestä kalenterivuodesta. Kortti näyttää yhden vuoden
   kerrallaan. Data on jo olemassa (`turnoverByYear`) — sääntö on
   varmistettava vero.fi:ltä ennen koodaamista.
4. **Mikä `tila` kelpaa.** Nyt `lähetetty` + `hyväksytty`. Lähetetty mutta
   `hylätty` lasku on yhä tosite (`isEraInvoiceReceipt`) ja saattaisi vaatia
   hyvityslaskukäsittelyn eikä pelkkää poissulkemista.
5. **10 %:n palvelumaksu brändille** — onko se neljäs sisäinen myynti joka
   kuuluu jonkun liikevaihtoon? `post.ts` ei kirjaa sitä lainkaan.
6. **Laskuttamattoman tekijävelan jaksotus.** Alihankkijakulu kirjautuu nyt
   (ks. oma osio alla), mutta vain tositteellisista erälaskuista. Se osa
   tekijöiden ansainnasta josta ei ole vielä laskua (`reserveCents`,
   lippulaivakeikassa ~3 636,50 €) jää kirjaamatta, joten tuloslaskelma
   yliarvioi tulosta yhä sen verran. Kysymykset kirjanpitäjälle:
   **(a)** pitääkö tilinpäätöksessä tehdä jaksotusvienti (4000 debet / 2800
   Ostovelat kredit) tästä velasta, ja jos kyllä, kelpaako karttadatasta
   johdettu luku sen perusteeksi ilman tositetta;
   **(b)** jos jaksotetaan kulu, pitääkö myyntipuoli jaksottaa samalla logiikalla
   (1700 Myyntisaamiset) — nyt molemmat puolet ovat tarkoituksella samalla,
   laskun päivään sidotulla perusteella ja vastatilinä on aina Pankkitili;
   **(c)** kumman johtajan kannettavaa velka on, jos se jaksotetaan — tasaus
   jakaa varauksen oletuksena tasan (invariantti 17), mutta kirjanpito on
   henkilökohtainen.
7. **Käsin kirjatut tekijämaksut ilman maksajaa.** Vanhan kanavan payoutit
   (~380 € lippulaivakeikassa) ovat oikeaa maksettua rahaa, mutta niiltä puuttuu
   sekä ostaja että tosite, joten ne eivät ole kummankaan kirjanpidossa. Pitääkö
   niistä tehdä jälkikäteen erälasku (jolloin ne kirjautuvat kohdan 5 kautta),
   vai riittääkö käsin tehty korjausvienti?

## Alihankkijakulu tuloslaskelmaan (oli: kate yliarvioitu)

`buildDraftEntries` kirjasi urakkakeikan asiakaserän kokonaan myyntinä tilille
3000 **eikä veloittanut alihankkijakulua lainkaan**. Dokumentti perusteli sen
sillä että tekijöiden palkka "netottuu jo katteen kautta" — mutta käytössä oleva
vientisääntö kirjaa BRUTON erän, ei katetta. Laskuttavan johtajan tuloslaskelma
yliarvioi siis tuloksen kaikella tekijöille maksetulla ja maksettavalla.

Mittaluokka oikealla datalla: 6 150 € laskutettua, josta 5 576,50 € on
tekijöiden palkkaa. Todellinen yhteinen kate on 573,50 €.

**Nyt:** jokainen LÄHETETTY tai HYVÄKSYTTY tekijän erälasku kirjautuu

```
4000 Ostot ja ulkopuoliset palvelut   (debet)
1910 Pankkitili                       (kredit)
```

sen johtajan kirjanpitoon jonka lasku nimeää **ostajaksi** — eli oletuksena
saman johtajan, jonka kirjanpitoon erän myynti meni.

Päätökset ja perustelut:

| Kysymys | Valinta | Miksi |
|---|---|---|
| Mikä tili | **4000**, ei 4010 | 4010 on varattu yrittäjien VÄLISILLE laskuille. Jos nämä menisivät samalle tilille, tuloslaskelmasta ei näkisi erikseen ulos maksettua palkkaa ja johtajien keskinäistä siirtoa (joka brändin tasolla kuittaa itsensä). Ei myöskään 5000 Henkilöstökulut: maksu on **työkorvausta eikä palkkaa**. |
| Mistä summa | `eraInvoiceGrossCents` | Sama funktio jota tekijöiden maksettavan yksi totuuden lähde (`shared/worker-payouts.ts`) käyttää — ei uutta kaavaa. **Brutto**, ei ennakolla vähennetty maksettava (invariantti 3). |
| Milloin kirjautuu | laskun päivä (`sentAt`) | Suoriteperuste: vasta lähetetty lasku on tosite. Luonnos ei ole kulu. |
| Kumman kirjanpitoon | laskun **ostaja** | Tosite nimeää ostajan; johtajien keskinäinen oikaisu kulkee `founder_settlements`-vientien kautta (invariantti 16). |
| Tuntematon ostaja | **ei kirjata** | Sama sääntö kuin laskuttajattomalla erällä ja invariantti 18: kohdentamatonta rahaa ei arvata kenellekään. |
| Avain | `job:<id>:tekijalasku:<inv.id>` | Erälaskun id on uniikki, joten uudelleenajo ei tuota duplikaattia — erottuu myös asiakaserästä ja kulukirjauksesta. |

**Mitä tämä EI vielä kirjaa, tiedostetusti:** laskuttamaton tekijävelka
(`reserveCents`). Sillä ei ole tositetta, ja luku on olemassa vain
karttablobissa jota tämä uudelleenrakennus tarkoituksella ei lue (siirtokiintiö).
Tuloslaskelma siis yliarvioi tulosta yhä sen verran mitä tekijöille on
ansaittu mutta ei vielä laskutettu — mutta ero on nyt **tiedossa ja testattu**
(`server/finance/post.test.ts`) eikä hiljainen.

### Sivutuote: vientisäännöt ovat nyt testattavissa ilman kantaa

`buildDraftEntries` asui tiedostossa joka importtaa `server/db.ts`:n, joka
heittää heti ilman `DATABASE_URL`:ia — joten koko kirjanpidon sääntökirjaa ei
voinut testata ilman tietokantaa, vaikka se on puhdas funktio. Nyt:

| Moduuli | Sisältö | Riippuu kannasta |
|---|---|---|
| `server/finance/account-codes.ts` | tilikartan data, `ACCOUNT`, `LEDGER_DEFS` | ei |
| `server/finance/draft-entries.ts` | **vientisäännöt** (`buildDraftEntries`) | ei |
| `server/finance/accounts.ts` | tilien luonti kantaan (re-exportaa datan) | kyllä |
| `server/finance/post.ts` | rivien haku + kirjaus | kyllä |

Vanhat importit toimivat ennallaan, koska `accounts.ts` re-exporttaa datan.

---

## Admin-etusivun yleisnäkymä

`client/src/components/admin/AdminOverview.tsx`, `/admin/dashboard`in ylin
osa. Sama paneeli molemmille rooleille, eri luvuilla.

**Ongelma jota tämä ratkaisee (kaksi):**

1. Kokonaislaskutusta ei ollut MISSÄÄN. Pikkukeikat asuvat `jobs.agreedPrice`issä
   ja tulevat `/api/stats`ista; urakat asuvat `gigData`-blobien maksuissa ja
   tulevat `/api/admin/gig-money`ista. Kaksi eri korttia, eikä niitä ollut
   laskettu yhteen kertaakaan.
2. Etusivu oli **neljä samannäköistä pikkukorttia + kaksi kappaletekstillä
   varustettua rahakorttia**, joissa samat luvut toistuivat kahdesti. "Oma tulo"
   oli merkki merkiltä sama lauseke kahdessa paikassa samalla sivulla.

### Mitä paneelissa on — ja mitä ei

| Osa | Sisältö |
|---|---|
| Kärkiluku | perustaja: laskutettu yhteensä · muu ylläpito: oma bruttotulo |
| Koostumus | pisterivi + kaksi selitettä (urakat / pikkukeikat) — vain perustajalle |
| Mittaluvut | **kaksi**: perustaja oma tulo + tekijöille siirtämättä · muu keikat + palvelumaksuvelka |
| Kehitys | laskutus kuukausittain pylväinä, korkein suoraan merkittynä |
| Huomiorivi | **enintään yksi**, ja vain kun jotain on oikeasti tekemättä |

Ei toimintoja, ei selittäviä kappaleita, ei kolmatta lukua. Kaikki muu on
alempana pudotusvalikoissa tai omilla sivuillaan.

### Miksi summaa EI oteta `stats.totalRevenue`sta

`/api/stats` laski `totalRevenue`n **kaikista** valmiista keikoista, myös
urakkakeikoista — ja urakan `agreedPrice` on sopimuksen katto, joka on jo mukana
`gigMoney.invoicedCents`issä. Yhteenlasku olisi laskenut urakan kahdesti.

Reitti **suodattaa urakat nyt pois** (`isCustomGig`/`gigData`), samalla ehdolla
kuin `server/finance/settlement.ts`, `post.ts` ja etusivun oma tulo. Sen jälkeen
`stats.totalRevenue` on aidosti pikkukeikkojen liikevaihto, eikä sekään enää
hyppää kattoon kun urakka merkitään valmiiksi. Avauskuvan pikkukeikkaluku
lasketaan silti erikseen `/api/jobs`-riveiltä, koska se tarvitsee myös
kuukausijakauman.

### Aikasarjan päiväperusteet

| Virta | Päivä | Miksi |
|---|---|---|
| Urakat | erämaksun aikaleima (`GigPayment.t`) | Maksu on se tapahtuma joka toi rahan. |
| Pikkukeikat | `jobs.scheduledAt` | Päivä jona työ tehtiin ja lasku annettiin. Ilman aikaa rivi jätetään sarjasta pois — arvattu kuukausi olisi väärä kuukausi. |

Sama huomio kuin `TURNOVER_DATE_BASIS`issa: perusteet ovat eri, ja paneelin
tehtävä on näyttää rytmi — ei olla kirjanpidon jaksotus.

### Muotoiluvalinnat, jotka on mitattu eikä arvattu

- **YKSI iso luku per näkymä.** Kaksi 40 px:n lukua rinnakkain oli kaksi
  kilpailevaa otsikkoa eikä kärkeä.
- **YKSI SÄVY.** Koko paneeli piirretään yhdellä vihreällä rampilla
  (OKLCH L 0,813 → 0,565 → 0,332, sävy 152–156° = aito sekventiaalinen ramppi) ja
  neutraaleilla. Kahden eri sävyn pari (vihreä + sininen) EI läpäissyt tummalla
  pinnalla vaaleusvyötä (L-vyö 0,48–0,67) ja tritan-erottelu jäi 7,4:ään eli
  rajatapaukseksi. Sama sävy kahdessa askeleessa on yksinkertaisempi JA
  mitattavasti turvallisempi.
- **Kontrastit pintaa (#08090A) vasten, mitattu:** aksentti `#5FE08A` 11,9:1,
  toinen askel `#27714A` 3,4:1 (≥ 3:1 datamerkille), ura `#173F28` 1,7:1 — ura ei
  ole dataa vaan saman rampin sammunut askel.
- **Pylväät, ei pisterivistöjä.** Kuusi 7-pisteen pystyriviä oli sekava eikä
  muoto lukenut kertaakaan ensi silmäyksellä. Pylväs: ≤ 24 px paksu, 3 px
  pyöristys datan päässä, suora perusviivalla, yksi hiusviiva perustana.
- **Yksi suora arvomerkintä** (korkein kuukausi). Luku joka pylväällä olisi
  kaaos ja jäisi lukematta.
- **Nolla on nolla.** Tyhjä kuukausi ei piirrä pylvästä; pienin positiivinen saa
  3 px, jottei olemassa oleva laskutus näytä tyhjältä.
- **Kuukaudet yhtenäisenä jaksona** ensimmäisestä laskutuskuukaudesta tähän
  kuukauteen (enintään 12). Tyhjä kuukausi on tieto.
- **Koostumusnauhan leveys on katolla (300 px).** Levealla ruudulla
  `space-between` venytti 22 pistettä koko paneelin mitalle, jolloin askeleen
  vaihtumiskohta oli 30 px:n välien takana eikä sitä nähnyt.
- **Mittaluvut: `minmax(118px, 1fr)` + ruudukon `maxWidth`.** Sarakemäärä
  lasketaan minimistä, joten yläraja EI kuulu `minmax`iin: `minmax(118px, 220px)`
  pudotti puhelimen yhteen sarakkeeseen. 118 px on mitattu alaraja jolla
  nelinumeroinen euroluku mahtuu 20 px:n leikkauksella.
- **Kokonaisia euroja.** Sentit eivät kuulu avausnäkymään; ne ovat erittelyissä
  ja kirjanpidossa. Ruudunlukijalle annetaan silti tarkka luku (`fmtExact`).
- **Väri ei ole koskaan ainoa erottaja:** kummallakin osuudella on selitteessä
  nimi ja summa, ja jokaisella pylväällä koneluettava arvo.
- **Tumma pinta on tarkoituksellinen**, ei teemavirhe: yksi kiinteäsävyinen
  paneeli samasta paletista kuin asiakkaan tekninen teema (`CT_TECH`).

### Mitä etusivulta poistettiin — ja minne luvut menivät

| Poistettu | Missä luku on nyt |
|---|---|
| Neljä tilastokorttia | Oma tulo ja velka ovat paneelin mittalukuja; keikkamäärä `/admin/jobs`in otsikossa; tulevat `/admin/calendar`issa |
| "Urakkakeikat — raha" -kortti | Laskutettu ja tekijöille paneelissa; per keikka `/admin/gigs`issa; johtajien tilanne keikan omassa tasausnäkymässä |
| Johtajakohtainen kerätty/velka | Keikan tasausnäkymä (`TasausView`) — ainoa paikka jossa se on myös kuitattavissa |
| "Tekijöille kuuluvaa käsissä" | Keikan tasausnäkymä. Invariantti 17 ei ole enää vaarassa etusivulla, koska etusivu ei näytä johtajien käsissä olevaa rahaa lainkaan |
| Merkitsemätön laskutus euroina | `/admin/gigs`, per keikka — summa lisättiin sinne (`unassignedCents`), koska aiemmin siellä oli vain erien kappalemäärä |
| Tervehdys + "Rooli: HOST" | Poistettu. Etunimi on paneelin yläkulmassa |
| "Uusi keikka" -CTA ja "Keikat" -kortti | Navipalkissa sekä puhelimessa että työpöydällä. **Asiakkaat jäi**, koska se EI ole puhelimen navipalkissa |
| Talous- ja tilityserittelyt | Samat luvut, pudotusvalikon takana |

---

## Kaksi vikaa jotka näyttivät "valittavan turhaan"

Käyttäjä oli tehnyt tasauksen pankissa ja kirjannut sen, ja maksanut tekijät —
mutta etusivu väitti yhä `maksaa 720,00 €` ja `380,00 € maksettu ilman
maksajamerkintää`. Kumpikaan ei ollut laskuvirhe: molemmissa **moottori tiesi
vastauksen jo, mutta näkymä luki väärää kenttää.**

### 1. Tasaus 720 € — brutto näytettiin velkana

`TasausFounderRow.dueCents` on laskettu ero **ennen** kirjattuja siirtoja:
`pickTransfer` johtaa siitä `grossTransfer`in, ja `settlement.transfers`
vähennetään vasta siitä (`alreadyTransferredCents` → `result.transfer`).

Keikan oma tasausnäkymä luki `result.transfer`in ja sanoi **"Tasan ✓"**. Samalla
sivulla oleva johtajakortti ja etusivun rahakortti lukivat `dueCents`iä ja
sanoivat **"maksaa 720,00 €"**. Sama luku kahdesta kentästä, kaksi eri vastausta.

`dueCents`iä **ei** korjattu netottamalla siirrot siihen: se olisi vähentänyt
saman rahan kahdesti (`grossTransfer` johdetaan siitä) ja kääntänyt tasatun
keikan päinvastaiseen haamusiirtoon. Sen sijaan moottori vastaa nyt itse:

| Kenttä | Merkitys |
|---|---|
| `dueCents` | laskettu ero, BRUTTO — `pickTransfer`in syöte |
| `remainingDueCents` | **vielä maksamatta**, johdettu `result.transfer`ista |

`remainingDueCents` on nolla kaikilla kun `transfer` on null, ja se perii
oikein myös käsin sovitun summan (`overrideCents`), ylisiirron ja väärään
suuntaan tehdyn siirron — koska se johdetaan `transfer`ista eikä
`grossTransfer`ista. `TasausView`n johtajakortti ja `/api/admin/gig-money`in
`dueByFounder` lukevat nyt sitä.

**Kolmas, itsenäinen vika samassa lohkossa:** `transferHint` muodostettiin
summaamalla `dueByFounder` KAIKKIEN keikkojen yli ja valitsemalla suunta vasta
sen jälkeen. Kaksi tasattua keikkaa saattoi siis ristiin netottuen synnyttää
siirron jota kummallakaan keikalla ei ole. Nyt summataan keikkakohtaiset
`result.transfer`it yhdessä suunnassa (etumerkki kiinnitetty `founders[0]`:aan).

Testit: `shared/founder-settlement.test.ts` — kuittautuminen nollille, osasiirto,
ylisiirto, käsin sovittu summa, ja invariantti `Σ remainingDueCents === 0`.

### 2. "380 € ilman maksajamerkintää" — kysyttiin tietoa joka oli jo tallessa

`buildTasaus` laski jokaisen maksetun `CrewPayout`in kohdentamattomaksi rahaksi
perustelulla *"vanha kanava ei tallenna maksajaa"*. Se ei ollut totta:
`CrewPayout.buyer.billerId` on tallentanut maksajan maksun luonnista asti, ja
hallintanäkymä pakottaa valitsemaan sen (`BRAND_BILLERS`-valitsin). Etusivu siis
vaati kirjaamaan saman tiedon **toiseen** kenttään (`settlement.paidBy`) ja
valitti siihen asti.

Etusijajärjestys on nyt sama kuin erälaskuilla:

1. käsin kirjattu ohitus (`settlement.paidBy`)
2. **tallennettu ostaja** (`payout.buyer.billerId`)
3. vasta sitten kohdentamaton

**Invariantti 18 ei löysty:** se kieltää arvaamisen, ei tallennetun tiedon
lukemista. Hyväksytään vain johtajan id — `"company"`-ostaja ja puuttuva `buyer`
(payout vanhemmasta ajasta) jäävät kohdentamattomiksi ja varoittavat edelleen.
`resolveBuyer` voi palauttaa oletuksena `DEFAULT_BILLER_ID`:n, joten kenttä
luetaan vain `founderIds`-portin läpi.

**Rivi on nyt per MAKSU, ei per tekijä.** Vanha avain `manual:<workerId>` kattoi
tekijän kaikki maksut yhtenä summana, joten kahden johtajan maksamaa tekijää ei
voinut kohdentaa oikein kummallekaan — koko summa oli pakko antaa toiselle. Uusi
avain on `manual:<workerId>:<payoutId>`, ja vanha avain luetaan yhä, jottei jo
tehty kohdennus katoa.

Testit: `shared/fr8-tasaus.test.ts` — tallennettu ostaja, puuttuva ostaja,
yritysostaja, ohituksen etusija, vanha avain, kaksi maksajaa samalle tekijälle,
maksamaton maksu, ja se että kirjattu siirto EI muuta tätä lukua.

**Jäljellä tiedostettuna:** docs-ohje "tee payoutista erälasku" tuottaa
kaksoislaskennan, koska `era_invoices`illa ei ole viitettä payoutiin eikä mikään
mitätöi payoutia — `workerPaidCents` summaa molemmat. Sitä ei korjattu tässä.


---

## "Oma tulo" laskee LASKUTETTUA, ei kertynyttä

Etusivun mittaluku näytti tulevan pelkistä pikkukeikoista, vaikka urakkakeikan
osuus oli mukana kaavassa. Syy oli kahdessa asiassa yhtä aikaa:

1. `entitledCents` (moottorin ansaintaluku) on **kertymäperusteinen**. Punaisten
   osuus on sidottu laskutettuun pottiin — `x = p1-potti / punaiset ikkunat`, ja
   potti syntyy vasta kun erälasku lähtee. Keltaiset EIVÄT ole: `p2OwnCents` ja
   `workerP2EarnedCents` luetaan suoraan kartalta heti kun ikkuna on pesty ja
   hinta lukittu. Kun keltaisista ei ole vielä laskutettu senttiäkään,
   keltaisten **tekijäkulu vähennetään ilman vastaavaa tuloa** ja johtajan luku
   painuu alas — usein miinukselle.
2. `Math.max(0, …)` etusivulla **piilotti sen kokonaisuudessaan**. Negatiivinen
   urakkaosuus leikkautui nollaan, jolloin jäljelle jäi täsmälleen
   pikkukeikkojen summa. Luku ei ollut väärä laskutoimitus vaan väärä kysymys.

`buildTasaus` palauttaa nyt myös `invoicedEntitledCents`: sama laskenta niin,
että keltaisten puoli on skaalattu laskutetulla osuudella
(`p2-potti / keltaisten kertymä`). Päätepisteissä se on tarkka — nolla
laskutettua → keltaiset eivät vaikuta mitenkään, kaikki laskutettu → sama luku
kuin `entitledCents`. Väliltä se on suhteellinen arvio, koska keltaisten lasku
on könttäsumma eikä kanna tietoa siitä mitkä ikkunat se kattoi.

| Luku | Perusta | Kuka lukee |
|---|---|---|
| `entitledByFounder` | kertymä (sis. laskuttamattoman keltaisen työn) | keikan tasausnäkymä — tasaus koskee myös laskuttamatonta työtä |
| `invoicedEntitledByFounder` | vain laskutettu | etusivun "Oma tulo" |

**VAIN tämä kenttä paljastetaan toisesta laskennasta, ei koko tulosta.** Toinen
`transfer`/`reserveCents` olisi toinen vastaus kysymykseen "kuka on velkaa
kummalle" — invariantti 19 kieltää sen, ja repo on kaatunut siihen kerran.

Tiili sanoo alleen **"laskutetusta"**. Ei "saatu" eikä "tilillä": mikään kenttä
ei tiedä onko asiakas oikeasti maksanut — `GigPayment`illa ei ole
maksettu-lippua, ja `settlement.receivedBy` kertoo vain kummalle johtajalle erä
on ohjattu.

### Kuukausipylväät ovat valittavia

Kärkiluku oli ainoa jonka arvon näki. Pylväät ovat nyt nappeja: napautus siirtää
korostuksen ja arvomerkinnän siihen kuukauteen, napautus valittuun palauttaa
kärjen. Merkintä **siirtyy eikä monistu** — luku joka pylväällä olisi kaaos ja
jäisi lukematta. Merkinnässä on nyt myös kuukausi ("07 · 4 575 €"), koska
korostus voi olla missä tahansa. Koko sarake on kosketusalue, ei pelkkä pylväs:
pieni kuukausi on 3 px korkea eikä siihen muuten osu.
