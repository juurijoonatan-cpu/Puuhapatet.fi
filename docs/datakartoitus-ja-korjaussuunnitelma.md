# Datakartoitus ja korjaussuunnitelma

Koko järjestelmän läpikäynti 2.8.2026: **mitä dataa on, missä se on, mikä on
turhaa, mikä on väärässä muodossa ja mitä sille tehdään.**

Tämä jatkaa `docs/kulutus-ja-tietovarasto-suunnitelma.md`:tä. Se dokumentti
vastasi kysymykseen "miksi siirtokiintiö loppui". Tämä vastaa laajempaan
kysymykseen "onko datamme kunnossa" — ja vastaus on, että **kiintiö ei ollut
pahin ongelma.**

## Kartoituksen kattavuus ja luotettavuus

Kahdeksan rinnakkaista tarkastusta, jotka lukivat oikeaa koodia:
`jobs`-blobi, tekijät ja tositteet, kirjanpito, chat ja tekoäly, asiakkaat
ja tarjoukset, selainpuoli, ulkoiset varastot, admin-käyttöliittymä.

**Rehellisyyden vuoksi kaksi rajoitusta:**

1. **Admin-käyttöliittymän oma tarkastus ei valmistunut** (istuntoraja tuli
   vastaan). Admin-havainnot alla ovat muiden tarkastusten sivutuotteita, eivät
   järjestelmällistä UI-läpikäyntiä.
2. **Yksikään automaattinen varmennus ei ehtinyt ajoon** samasta syystä.
   Siksi olen **lukenut itse koodista** jokaisen P0-löydöksen ja merkinnyt ne
   erikseen varmistetuiksi. Loput ovat yhden tarkastajan havaintoja ja ne
   pitää varmistaa ennen korjausta — ne on merkitty *(varmistamaton)*.

Tarkastukset tuottivat 112 säilytyspaikkaa, 99 hukkakohtaa ja 54
rakenneongelmaa. Alla on olennainen; koko aineisto on kartoituksen tuloksissa.

---

# OSA 1 — P0: Datan tuhoutuminen ja tietoturva

**Nämä ovat tärkeämpiä kuin siirtokiintiö.** Kiintiö aiheutti katkoksen josta
toivuttiin. Nämä tuhoavat dataa hiljaa ja peruuttamattomasti, eikä mikään
kerro siitä.

## P0-1 · Vanhin tosite tuhoutuu kun henkilölle kertyy 200 dokumenttia
**Varmistettu itse.** `shared/crew.ts:615-616`

```ts
documents: (Array.isArray(input.documents) ? input.documents : [])
  .slice(0, 200)
```

`attachPersonDocument` lisää uuden dokumentin listan **alkuun**
(`server/routes.ts:7783`), joten lista on uusin-ensin. `.slice(0, 200)` pitää
200 uusinta ja **heittää vanhimmat pois** — seuraavassa tallennuksessa,
ilman virhettä tai lokimerkintää.

Nämä ovat tositteita. Jokaisella on `retentionUntil` = päivä + 6 vuotta
(`shared/crew.ts:629`). Perustajalle kertyy noin 2 dokumenttia per kirjattu
tasaus, 2 per vastalasku ja 1 per laskutettu keikka. **Muutamassa sadassa
keikassa raja tulee vastaan, ja sen jälkeen jokainen uusi tosite tuhoaa
vanhimman.**

Huomaa ristiriita: maksujen (`payouts`) kohdalla sama ongelma on jo korjattu
huolellisesti kommentteineen rivillä 596–614 — dokumentit vain jäivät siitä
korjauksesta pois.

**Korjaus:** ei kattoa tositteille. Metadata on ~250 tavua, joten 10 000
dokumenttia on 2,5 MB. Kun dokumentit siirtyvät omaan tauluunsa (OSA 3),
katto voi koskea vain blobissa olevaa viitelistaa, ei koskaan rivejä.

## P0-2 · Sadan maksetun maksun jälkeen jokainen uusi maksu katoaa
**Varmistettu itse.** `shared/crew.ts:602-614`

```ts
const rest = all.filter((p) => p.status !== "maksettu")
  .slice(0, Math.max(0, MAX_PAYOUTS_KEPT - paid.length));
```

Kun `paid.length >= 100`, `Math.max(0, 100 - paid.length)` on **0** — eli
`rest` on tyhjä ja **kaikki maksamattomat maksut pudotetaan tallennuksessa.**
Tekijä jolla on 100 maksettua maksua ei voi enää koskaan saada uutta maksua
kirjatuksi sille keikalle.

Tämä on virhe **omassa aiemmassa korjauksessani**: suojasin maksetut
oikein, mutta en huomannut että katto kääntyy silloin maksamattomia vastaan.

**Korjaus:** kattoa ei sovelleta lainkaan maksuun jolla on `approvedAt`,
`billing`, `tax` tai `expenses` asetettuna. Jos katto halutaan pitää, se
koskee vain koskemattomia `ilmoitettu`-rivejä ja **varoittaa** poiston sijaan.

## P0-3 · Liian iso tosite katkaistaan hiljaa avautumattomaksi
**Varmistettu itse.** `shared/crew.ts:627`

```ts
? d.fileDataUrl.slice(0, MAX_CREW_DOC_LEN) : undefined,
```

Yli 1,5 MB:n PDF ei tule hylätyksi — se **katkaistaan** 1,5 megatavuun.
Tuloksena on rikkinäinen base64, tiedosto joka ei avaudu. Käyttäjälle ei
kerrota mitään; hän luulee tositteen tallentuneen.

Sama kuvio on kuiteissa (`shared/crew.ts` maksukuitit) ja se on myös siinä
kokokatossa jonka itse lisäsin `server/routes.ts`:ään (`capDataUrl`).
Allekirjoituksissa katkaisu on vaaraton — tositteissa se on datan tuhoamista.

**Korjaus:** tositteille ja kuiteille **hylkäys virheilmoituksella**, ei
katkaisu. Käyttäjä saa tietää että tiedosto on liian iso ja voi pakata sen.

## P0-4 · Tekoälyavustajan oikeustaso tulee pyynnön rungosta, ei tokenista
**Varmistettu itse.** `server/routes.ts:9390` ja `9400`

```ts
const { message, userId, userName, role } = req.body ?? {};
...
const effectiveRole: "HOST" | "STAFF" = role === "HOST" ? "HOST" : "STAFF";
```

Autentikaatioportti rivillä 1319–1329 tarkistaa tokenin ja asettaa todellisen
identiteetin `(req as any).admin`iin allekirjoitettuine rooleineen. **Tämä
reitti ei käytä sitä lainkaan** — se uskoo mitä pyynnössä lukee.

Kuka tahansa kirjautunut käyttäjä (mikä tahansa tekijä) voi lähettää
`{"role":"HOST","userId":"joonatan"}` ja saada perustajatason kontekstin:
kaikki keikat, kaikki asiakkaat, koko talousyhteenveto — ja sen
henkilökohtaisen ansioerittelyn joka on nimenomaan tarkoitettu vain
omistajalleen (`server/routes.ts:10344-10349` kuvaa tuon suojauksen
aikomuksen).

Reitti on kirjautumisen takana, joten ulkopuolinen ei pääse siihen. Mutta
tiimin sisällä se poistaa rooli- ja yksityisyysrajan kokonaan.

**Korjaus:** kolme riviä. Lue `userId`, `userName` ja `role` `req.admin`ista.
Pyynnön rungon vastaavat kentät jätetään huomiotta.

## P0-5 · Sopimuksen uudelleenallekirjoitus tuhoaa edellisen version todisteen
*(varmistamaton)* `server/routes.ts:6902-6903`

Kun `WORKER_AGREEMENT_VERSION` nousee, kaikki allekirjoittavat uudelleen ja
**vanha allekirjoitus poistetaan**. Todiste siitä mihin ehtoihin henkilö
sitoutui aiemmin katoaa — juuri se mitä allekirjoituksella todistetaan.

**Korjaus:** älä poista. Säilytä versiohistoria; nykyinen versio on vain
uusin rivi.

## P0-6 · 61. tekijä katoaa kaikkine tietoineen
*(varmistamaton)* `shared/crew.ts:651` — `input.slice(0, 60)`

Ei todennäköisesti osu tänään, mutta pudotus vie mukanaan sen henkilön
maksut, tositteet ja allekirjoitukset ilman virhettä.

---

# OSA 2 — P1: Siirtokiintiö, korjattavissa heti

Nämä ovat pelkkiä sarakerajauksia. **Ei skeemamuutoksia, ei datan siirtoa, ei
toiminnallisia muutoksia.** Tarkastus laski että `projectData`-blobista
**0,1 % on sitä mitä kartta tarvitsee** piirtyäkseen: rakenteellinen osa on
195 kB, kartan tarvitsema ydin 31 kB, ja liitteet 30,9 MB.

| # | Missä | Mitä nyt | Vaikutus | Korjaus |
|---|---|---|---|---|
| 1 | `routes.ts:10151` tekoälykonteksti | 200 riviä ilman rajausta | **~130 MB / viesti**, 10 viestiä = 1,3 GB | rajaa 9 kenttään |
| 2 | `routes.ts:5731` adminin autosave | koko rivi joka 700 ms | **32,8 MB / tallennus**, 20 pistettä = 656 MB | rajaa 5 kenttään |
| 3 | `routes.ts:7584` `loadJobProject` | koko rivi, 10 kutsupaikkaa | +1,6 MB / kutsu | yksi rivi korjaa kaikki 10 |
| 4 | `routes.ts:9718` tasaustyökalu | koko taulu | 30–50 MB / kutsu | `MONEY_JOB_COLS` |
| 5 | `routes.ts:6494` `/api/team-roster` | koko blobi | **30,9 MB** kirjautumissivun latauksesta | SQL-poiminta + pidempi TTL |
| 6 | `routes.ts:6459` `/my-dashboard` | koko blobi | 30,9 MB joka kirjautumisella | hae token SQL:ssä |
| 7 | `routes.ts:1505`, `1771` asiakaskortti | koko rivi × n | 30,9 MB kortin avauksesta | rajaa, pudota blobit |
| 8 | `routes.ts:1628`, `1685` keikkakortti | molemmat allekirjoitukset | +1,6 MB / avaus | rajaa |
| 9 | `routes.ts:6135` asiakkaan P2 | koko rivi | +1,6 MB / hinnan hyväksyntä | rajaa |
| 10 | `routes.ts:6417` + `6567` | **blobi luetaan kahdesti per napautus** | 2× kaikki yllä | lue kerran, välitä eteenpäin |

Lisäksi kaksi asiaa jotka pitää tarkistaa tuotannosta:

- **`reconcileMissingPayoutSyncs`** (`routes.ts:8891`, ajastin `9120`) lukee
  jokaisen FR8-keikan blobin **48 kertaa vuorokaudessa ilman käyttäjää** — noin
  1,5 GB/vrk/keikka. Se on `isSheetsSyncEnabled()`-ehdon takana, eli **nolla jos
  Sheets-synkka on pois päältä.** *Tarkista Renderistä onko se päällä.*
- **`/api/admin/worker/:workerId`** lukee koko taulun molemmat blobit yhden
  henkilön sivun piirtämiseen.

## Oma virheeni jonka kartoitus paljasti

Ne kaksi laiskan latauksen reittiä jotka lisäsin PR #400:ssa
(`routes.ts:7038` ja `4965`) **lukevat koko blobin palauttaakseen yhden
kuvan** — arviolta 124-kertainen vahvistus per katselu. Ne keventävät
Renderiltä puhelimeen menevää liikennettä, mutta tekevät Neonin puolella
yhden kuvan katsomisesta kalliimpaa kuin ennen. Ne korjaantuvat itsestään
OSA 3:n myötä, mutta on rehellistä sanoa ettei se muutos ollut pelkkä voitto.

---

# OSA 3 — P2: Liitteet pois blobista

Vasta tämä korjaa juurisyyn. Sarakerajaukset auttavat siellä missä blobia ei
tarvita lainkaan; tämä tekee blobista pienen myös siellä missä sitä tarvitaan.

## Uusi taulu

```sql
CREATE TABLE job_assets (
  id          serial PRIMARY KEY,
  job_id      integer NOT NULL REFERENCES jobs(id),
  kind        text NOT NULL,   -- observation | expense_receipt | payout_receipt
                               -- | crew_document | crew_photo | signature
  ref_key     text NOT NULL,   -- 'K#12' (ikkuna) tai crew-jäsenen id
  mime        text NOT NULL,
  bytes       integer NOT NULL,
  sha256      text,            -- duplikaattien tunnistus
  data        text NOT NULL,   -- base64 data URL
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, kind, ref_key)
);
CREATE INDEX job_assets_job_kind ON job_assets (job_id, kind);
```

Auto-migraatio `server/index.ts`:ään samalla `CREATE TABLE IF NOT EXISTS`
-kuviolla kuin `drive_files` ja `founder_settlements`.

`projectData` säilyttää vain viitteen ja metatiedon (`hasImage`, `bytes`,
`mime`, aikaleima). **Kartta ei koskaan lue `job_assets`-taulua.**

## Vaiheistus jossa mikään ei hajoa kesken

1. Taulu + migraatio. Ei lukijoita vielä.
2. **Kirjoituspolut** ohjataan uuteen tauluun; blobiin jää viite.
3. **Lukupolut** osaavat molemmat muodot: viite → taulu, vanha inline-data →
   blobista. Tässä vaiheessa vanha ja uusi data toimivat rinnakkain.
4. **Kertasiirto**: `projectData`n inline-kuvat → `job_assets`, blobiin
   viite tilalle. Idempotentti, ajettavissa uudestaan, peruutettavissa.
5. Vasta kun siirto on todettu onnistuneeksi, vanhan muodon lukija poistetaan.

## Kokokatto joka estää toistumisen

Kun liitteet ovat poissa, `sanitizeProjectData` **hylkää** kirjoituksen jos
sarjallistettu blobi ylittää esimerkiksi 512 kB. Se tekee siirrosta
peruuttamattoman oikeaan suuntaan: kukaan ei voi vahingossa palauttaa kuvia
blobiin.

---

# OSA 4 — P3: Asiakirjavarasto

Tässä on se **selkeä asiakirjavarasto** jota toivoit. Puolet on jo rakennettu:
`drive_files`-taulu, idempotentti kansioiden luonti ja automaattinen
laskujen varmuuskopiointi toimivat (`docs/google-drive-backup.md`).

**Merkittävä puute jonka kartoitus paljasti:** tekijöiden tositteista
(`CrewDocument`) **ei ole Drive-kopiota lainkaan**. `project_data` on
niiden ainoa kappale. Yhdistettynä P0-1:n 200-kattoon ja P0-3:n katkaisuun
se tarkoittaa että tosite voi kadota ilman mitään varmuuskopiota.

Tavoiterakenne:

```
<juuri>/
  Laskut/2026/{Asiakaslaskut,Alihankkijalaskut,Sisäiset laskut}/   ← on jo
  Tositteet/2026/<tekijä>/                                        ← UUSI
  Kuitit/2026/<keikka>/                                           ← UUSI
  Kirjanpito/<founder>/…                                          ← on jo
  Ennustelaskelmat/<founder>/…                                    ← on jo
```

Lisäksi kaksi rakenteellista puutetta *(varmistamattomia)*:

- **Kirjanpitoraporttien Drive-kopio on yksi muuttuva tiedosto per
  tilikausi**, ei tilannekuvasarja — jokainen varmuuskopio ylikirjoittaa
  edellisen, joten aikapisteitä ei ole.
- **Tositteella ei ole alkuperäkenttää.** Automaattisesti luotu muistio ja
  käsin skannattu kuitti näyttävät tilintarkastajalle samalta.

---

# OSA 5 — P4: Rakenteelliset korjaukset

Nämä eivät ole kiintiöasioita vaan asioita jotka tekevät järjestelmästä
loogisemman — juuri sitä mitä pyysit. Kaikki *(varmistamattomia)*.

## Kuollutta koodia ja puuttuvia toimintoja

| Asia | Missä | Tila |
|---|---|---|
| `keskenBy` kirjoitetaan mutta **sanitoija ei koskaan säilytä sitä** | `shared/project.ts:177`, `routes.ts:6987` | **Varmistettu itse** — ominaisuus ei ole koskaan toiminut. Käyttöliittymä `FloorView.tsx:1141` piirtää jotain mitä ei voi olla olemassa. Päätä: säilytä tai poista, älä jätä puolitiehen. |
| Tilikauden sulkeminen | `fiscalYears.isClosed`, `shared/schema.ts:374` | Vain skeemassa. Koko "suljetut vuodet jäädytetään" -haara `post.ts:230-243` on kuollutta koodia joka ei ole koskaan ajautunut. |
| Korjausvienti | `journalSourceTypeEnum` sisältää `manual` | Ei reittiä joka loisi sellaisen. Kirjanpidolla ei ole omaa auktoritatiivista kerrosta — 100 % päiväkirjasta on välimuistia lähdetauluista. |
| Tositteen poisto tai korjaus | — | **Ei ole olemassa.** Väärälle henkilölle kirjattua tositetta ei voi poistaa eikä siirtää. Automaattinen kohdistus tunnistaa henkilön **pikkukirjaimisen etunimen** perusteella (`routes.ts:3613`). |
| `retentionUntil` | kirjoitetaan neljässä paikassa | Ei kukaan lue sitä muuhun kuin näyttämiseen. Todellinen elinikä on "kunnes 200 uudempaa saapuu". |
| Chat-datan säilytys | `shared/schema.ts:271-295` | Vierailijan nimi, sähköposti, puhelin ja vapaa teksti. **Ei säilytysaikaa, ei poistopolkua, ei anonymisointia.** Tämä on GDPR-asia, ei kulutusasia. |

## Adminin raskaimmat näkymät

- **Tekijäsivu** lataa jokaisen tekijän sopimukset, laskut ja kuitit vain
  näyttääkseen taulukon nimiä ja euroja (`routes.ts:7592-7670`).
- **Tositerekisterissä ei ole lista/detalji-jakoa** — päivämääriä ja summia ei
  voi selata lataamatta jokaista PDF:ää.
- **Tekijän oma työpöytä lataa koko maksuhistorian kuitteineen jokaisen
  ikkunanapautuksen jälkeen** — sadan ikkunan vuorossa sata kertaa samat kuitit.
- **`/admin/talous` lukee koko `jobs`-taulun neljä kertaa yhdellä
  sivulatauksella**, kahdesti täyden blobin kanssa.
- **Adminin tekijäsivu hakee koko datan uudestaan jokaisen muutoksen jälkeen**
  (`crew.tsx:115-130`).
- **Postilaatikko lupaa ettei live-vastaus ole mahdollinen**, vaikka
  vastausreitti on olemassa ja kirjoittaa kantaan — vierailija ei vain koskaan
  näe sitä.

---

# OSA 6 — P5: Ettei tämä toistu

Kartoitus laski että `server/routes.ts`:ssä on **yhä 33 rajaamatonta
`db.select().from(jobs)`-kutsua.** Sääntö on jo kirjattu dokumenttiin, mutta
dokumentti ei estä mitään.

1. **Testi joka kaatuu** jos `jobs`-taulua luetaan ilman sarakelistaa.
2. **Kokomittari**: admin-näkymä joka kertoo `pg_column_size(project_data)`
   ja liitteiden määrän per keikka. Vika oli näkymätön siihen asti kunnes
   kanta meni lukkoon.
3. **Liikennemittari lokiin**: mikä reitti luki montako tavua.

---

# OSA 7 — Järjestys ja työmäärä

| Vaihe | Sisältö | Työmäärä | Miksi tässä järjestyksessä |
|---|---|---|---|
| **A** | P0-1…P0-4 | **½ pv** | Estää datan tuhoutumisen ja sulkee tietoturva-aukon. Tehdään ensin riippumatta kaikesta muusta. |
| **B** | OSA 2, kohdat 1–10 | **1 pv** | Suurin kiintiövaikutus pienimmällä riskillä. Ei skeemamuutoksia. |
| **C** | OSA 3 vaiheet 1–3 | **1 pv** | Uusi taulu käyttöön, rinnakkaiskäyttö. |
| **D** | OSA 3 vaiheet 4–5 + kokokatto | **½ pv** | Kertasiirto. Tässä blobi kutistuu oikeasti. |
| **E** | OSA 4 arkisto | **½ pv** | Tositteet Driveen. |
| **F** | OSA 5 valinnat + OSA 6 | **1 pv** | Rakenne ja vartijat. |

**Yhteensä ~4,5 työpäivää.** Vaiheet A ja B kannattaa tehdä heti — ne
yhdessä ovat noin puolitoista päivää ja kattavat sekä vaarallisimmat bugit
että suurimman osan kulutuksesta.

---

# OSA 8 — Mitä sinun pitää tehdä

Nämä ovat asioita joita minä en voi tehdä puolestasi.

## Heti

1. **Neonin paketti.** Osta maksullinen tälle kuukaudelle jos haluat
   järjestelmän auki ennen 1.9. Tarkista hinta Billing-näkymästä. Muista
   että maksullisella ylitys **laskutetaan** eikä estä — eli vaiheet A–D
   pitää tehdä sen kuukauden aikana.
2. **Tarkista Renderistä onko Sheets-synkka päällä** (ympäristömuuttujat).
   Jos on, se 30 minuutin ajastin lukee ~1,5 GB/vrk/keikka ilman että kukaan
   käyttää sovellusta. Kerro minulle kumpi se on.
3. **Kerro käytetäänkö Google Drive -varmuuskopiointia oikeasti** — eli onko
   `GOOGLE_SERVICE_ACCOUNT_KEY` ja `GOOGLE_DRIVE_ROOT_FOLDER_ID` asetettu.
   Dokumentin mukaan integraatiota ei ole koskaan testattu oikeaa Drivea
   vasten. Se on OSA 4:n perusta, joten sen pitää olla toimiva.

## Päätökset joita en tee puolestasi

4. **`keskenBy`** — säilytetäänkö "kesken"-merkinnän tekijä vai poistetaanko
   koko ominaisuus? Se ei ole koskaan toiminut, joten kumpikin on rehellinen
   valinta.
5. **Tositteen poisto/korjaus** — halutaanko mahdollisuus siirtää väärälle
   henkilölle kirjattu tosite? Kirjanpidollisesti oikea tapa on
   korjausvienti, ei poisto. Tämä on iso lisäys.
6. **Tilikauden sulkeminen** — toteutetaanko? Ilman sitä päiväkirja
   kirjoitetaan uusiksi joka kerta kun talousnäkymä avataan, eikä suljettuja
   vuosia ole olemassa.
7. **Chat-datan säilytysaika** — kuinka kauan vierailijoiden yhteystiedot ja
   viestit säilytetään? Nyt ne säilyvät ikuisesti eikä poistopolkua ole.

## Testattava käsin korjausten jälkeen

8. Kirjautuminen, yhden ikkunan merkkaus, yhden tositteen liittäminen, ja
   asiakkaan seurantasivu. Minä en pääse tuotantoon tästä ympäristöstä
   (proxy estää yhteyden Renderiin), joten lopullinen varmistus on sinulla.
