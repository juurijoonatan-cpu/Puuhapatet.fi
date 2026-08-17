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
6. **Tuloslaskelma yliarvioi katetta.** `post.ts` kirjaa koko erän tilille 3000
   Myynnit eikä veloita alihankkijakulua lainkaan. Näillä luvuilla se
   yliarvioi laskuttajan tulosta vähintään jo maksetun 1 940 €:n verran. Eri
   vika kuin ALV-kortti; ei korjattu tässä.
