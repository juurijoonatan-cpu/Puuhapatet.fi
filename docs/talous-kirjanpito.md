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
  käyttämä tili (ks. `server/finance/accounts.ts` → `STANDARD_ACCOUNTS`).
- **`journal_entries`** + **`journal_lines`** — päiväkirja (tapahtumat) ja
  niiden debet/kredit-viennit. `sourceKey` on vakaa deduplikointiavain
  (esim. `"job:123:era:2"`, `"expense:55"`, `"settlement:9:payer"`) — tekee
  uudelleenkirjauksesta idempotentin. Pääkirja EI ole erillinen taulu — se on
  `journal_lines` liitettynä `accounts`-tauluun ja ryhmiteltynä tilin mukaan
  (`server/finance/reports.ts` → `getGeneralLedger`), jotta se ei voi koskaan
  ajautua eri linjalle päiväkirjan kanssa.
- **`forecast_entries`** — ennustelaskelman rivit (ks. alla). Ei koske
  varsinaista kirjanpitoa.

## Tilikartta (`server/finance/accounts.ts`)

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
| 4000 | Ostot ja ulkopuoliset palvelut | expense | ei (varattu) |
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
funktio `jobs`/`expenses`/`investments`/`founder_settlements`-tauluista, eikä
voi koskaan ajautua niistä eri linjalle. Kutsutaan automaattisesti JOKA
`/api/finance/*`-pyynnön alussa (`server/finance/reports.ts`) — erillistä
"synkronoi"-nappia ei ole eikä tarvita.

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

### Mitä EI kirjata automaattisesti (tarkoituksella)

- **Palvelumaksu (palkkio "brändille")** — `worker_payments`-taulun data.
  Kenen kirjanpitoon tämä lopulta kuuluisi (jaettu founderien kesken? erillinen
  "brändi"-tili?) ei ole yksiselitteinen nykyisestä koodista — päätä tämä
  ennen kuin lisäät sen kirjanpitoon.
- **Alihankkijoiden (esim. Jani) korvaukset** — nämä on jo netotettu pois
  founderien tuloksesta FR8-kate-laskennassa (`shared/project.ts` →
  `computeEraDebts`, `marginCents` = erä − palkat) ennenkuin mitään kirjataan
  founderin kirjanpitoon. Alihankkijan oma kirjanpito on hänen omansa,
  tämän järjestelmän ulkopuolella.
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

Client-puolen tyypitetyt kutsut: `client/src/lib/api.ts` (`api.finance*`).

## Frontend

- `client/src/pages/admin/tax-export.tsx` — pääsivu (reitit `/admin/talous`
  ja `/admin/tax-export`, jälkimmäinen alias). Ennallaan ylä- ja alaosa; uusi
  `<KirjanpitoSection>` upotettu "Oma tulos" + "Bossien velka" + "ALV-raja"
  -korttien JÄLKEEN, ennen "Yksityiskohdat & dokumentit" -osiota.
- `client/src/pages/admin/talous/kirjanpito-section.tsx` — koko uusi
  kirjanpito-UI: founder-valitsin, vuosivalitsin, ja 5 välilehteä
  (Yhteenveto, Tuloslaskelma, Tase, Tilit & pääkirja, Ennuste).

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
   `buildDraftEntries`-funktioon jos kyllä.
2. **"Oma tulos" ↔ "Kirjanpito"-luvun yhdistäminen** — jos joskus halutaan
   yksi totuus, päätä kumpi malli (kate-osuus vs. koko-erä-sitten-tilitys)
   on se, jota käytetään molempiin, ja poista toinen.
3. **Tilikauden päätösvienti** — kun tilikausi halutaan virallisesti sulkea
   (`fiscal_years.isClosed = true`), lisää UI-toiminto sille + päätösvienti
   joka siirtää tilikauden tuloksen "Edellisten tilikausien voitto/tappio"
   -tilille (2020). Skeema tukee tätä jo (`isClosed`), toteutus puuttuu.
4. **Oy-muutos** — lisää kolmas `ledgers`-rivi (`entityType: "oy"`), tarkista
   oma pääoma -tilien nimet (Osakepääoma vs. Yksityissijoitukset), harkitse
   ALV-tilien (2900) käyttöönottoa jos Oy rekisteröityy ALV-velvolliseksi,
   ja päätä miten vanhat toiminimi-ledgerit suhtautuvat uuteen Oy-ledgeriin
   (esim. apporttina, tai rinnakkain historian ajan).
5. **Osa 2** (odottaa erillistä lupaa): Google Drive -integraatio kaikkien
   näiden raporttien + laskujen automaattiseen varmuuskopiointiin.
