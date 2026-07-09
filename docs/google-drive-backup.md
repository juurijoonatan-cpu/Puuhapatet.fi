# Google Drive -varmuuskopiointi (Osa 2)

Tämä dokumentti kuvaa admin-puolen "Talous ja verotus" -osion **Osa 2**:
kaikkien tärkeiden talousdokumenttien automaattisen (tai muutaman klikkauksen)
varmuuskopioinnin Google Driveen — jotta yhden serverin (Render) vikaantuminen
ei vaaranna kirjanpitoa. Jatkaa suoraan `docs/talous-kirjanpito.md` (Osa 1)
päälle. Päivitä tätä, kun logiikka muuttuu.

## Miksi tämä oli tarpeen

Ennen tätä muutosta KAIKKI talousdata — laskut, dokumentit, kuitit — asui
ainoastaan Postgres-tietokannassa yhdellä Render-palvelimella. Esimerkiksi
alihankkijoiden ja bossien laskut/tositteet (`CrewDocument`, ks.
`shared/crew.ts`) tallennetaan base64-datana suoraan JSON-sarakkeeseen —
ei mitään erillistä, palvelimesta riippumatonta kopiota ollut olemassa.

## Miten se toimii

### Asennus (SINUN pitää tehdä tämä — agentti ei voi luoda Google Cloud
### -projektia tai jakaa Drive-kansiota puolestasi)

1. Mene [Google Cloud Console](https://console.cloud.google.com/) → luo
   projekti (tai käytä olemassa olevaa) → **APIs & Services → Library** →
   ota käyttöön **Google Drive API**.
2. **APIs & Services → Credentials → Create Credentials → Service Account.**
   Anna sille nimi (esim. "puuhapatet-drive-backup"), ei erityisiä rooleja
   tarvita projektin tasolla.
3. Avaa luotu palvelutili → **Keys → Add key → Create new key → JSON**.
   Lataa JSON-tiedosto.
4. Avaa [Google Drive](https://drive.google.com), luo kansio (esim.
   "Puuhapatet"), jaa se (Share) palvelutilin sähköpostiosoitteelle
   (JSON-tiedoston `client_email`-kentästä) **Muokkaaja (Editor)**-oikeuksin.
5. Kopioi kansion ID sen Drive-URL:stä
   (`https://drive.google.com/drive/folders/<TÄMÄ_OSA>`).
6. Aseta palvelimen ympäristömuuttujat (Render → Environment):
   - `GOOGLE_SERVICE_ACCOUNT_KEY` = koko JSON-tiedoston sisältö yhdellä
     rivillä (ei tiedostopolku — itse JSON-teksti).
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` = vaiheen 5 kansion ID.
7. Deploy uudelleen. Ilman näitä kahta muuttujaa kaikki tässä dokumentissa
   kuvattu toimii täysin normaalisti taustalla poissa käytöstä — mikään ei
   hajoa, varmuuskopiointi vain ei tapahdu (ks. "Graceful degradation" alla).

**Agentin huomio:** tätä integraatiota ei ole voitu testata oikeaa Google
Drivea vasten (ei ollut oikeita service account -tunnuksia käytettävissä
kehitysympäristössä) — toteutus seuraa Google Drive API v3:n dokumentoitua
sopimusta (CSV→Sheets-konversio create/update-kutsuilla, kansioiden
idempotentti luonti). **Testaa tämä käsin ensimmäisen käyttöönoton jälkeen**:
paina "Varmuuskopioi Google Driveen" Kirjanpito-osiossa ja tarkista, että
tiedostot ilmestyvät oikeaan kansioon oikeassa muodossa.

### Automaattinen vs. muutaman klikkauksen tallennus

- **Laskut — täysin automaattinen, ei nappia.** Aina kun asiakaslasku
  (kotitalousvähennys-tosite), alihankkijan lasku tai yrittäjien välinen
  lasku (vastalasku) luodaan/lähetetään, sen PDF tallentuu Driveen
  taustalla — best effort, ei koskaan estä tai hidasta itse lähetystä.
  Uudelleenlähetys/-muokkaus PÄIVITTÄÄ saman Drive-tiedoston (ei
  duplikaatteja) — ks. `drive_files`-taulu ja `server/drive/upload.ts`.
- **Kirjanpitoraportit ja ennuste — "Varmuuskopioi Google Driveen" -nappi.**
  Tuloslaskelma/tase/päiväkirja/pääkirja/ennuste muuttuvat jatkuvasti (joka
  uusi kirjaus), joten niitä EI tallenneta joka sivulatauksella — se
  kuormittaisi Drive-rajoja turhaan eikä toisi lisäarvoa. Yksi klikkaus
  Kirjanpito-osiossa (`client/src/pages/admin/talous/kirjanpito-section.tsx`)
  päivittää kaikki senhetkiset luvut Driveen kerralla. Tämä täyttää
  toimeksiannon ehdon: "jos täysin automaattinen synkronointi ei ole
  järkevä ratkaisu, sen tulee onnistua muutamalla napin painalluksella" —
  eikä missään vaiheessa käyttäjä kopioi tai siirrä tiedostoja käsin.

### Graceful degradation

Sama kuvio kuin `RESEND_API_KEY`/`AI_API_KEY`:llä muualla sovelluksessa:
puuttuva konfiguraatio ei koskaan riko mitään. `isDriveConfigured()`
(`server/drive/client.ts`) palauttaa false, jolloin:
- automaattiset upload-kutsut (`uploadPdf`/`uploadAsSheet`) palauttavat
  `null` heti, eivät yritä yhdistää mihinkään;
- "Varmuuskopioi Google Driveen" -nappi näyttää selkeän "ei konfiguroitu"
  -huomautuksen napin sijaan.

## Kansiorakenne Google Drivessa

```
<GOOGLE_DRIVE_ROOT_FOLDER_ID>/
  Laskut/
    2026/
      Asiakaslaskut/            — kotitalousvähennys-tositteet (per keikka)
      Alihankkijalaskut/        — alihankkijan itselaskutettu lasku Puuhapatetille
      Sisäiset laskut/          — yrittäjien väliset laskut (vastalaskut)
  Kirjanpito/
    Joonatan/
      Tilikartta - Joonatan (Sheet)
      Tase - Joonatan (... pvm) (Sheet)
      2026/
        Päiväkirja 2026 - Joonatan (Sheet)
        Pääkirja 2026 - Joonatan (Sheet)
        Tuloslaskelma 2026 - Joonatan (Sheet)
    Matias/
      (sama rakenne)
  Ennustelaskelmat/
    Joonatan/
      Ennustelaskelma - Joonatan (Sheet)
    Matias/
      (sama)
```

Poikkeaa hieman toimeksiannon esimerkistä kahdella tarkoituksellisella
tavalla:
1. **Kirjanpito on eroteltu founderin mukaan** (Joonatan/Matias-alikansiot) —
   koska Osa 1:n koko pointti oli pitää kahden yrittäjän kirjanpidot
   täysin erillään. Yhteinen "Kirjanpito"-kansio sekoittaisi ne takaisin.
2. **Tase ja tilikartta eivät ole vuosikansiossa** — ne ovat aina "tämänhetkinen
   tilanne" (kumulatiivinen kaikista tilikausista), eivät yhden vuoden
   raportti, niin ne elävät suoraan founderin juurikansiossa ja päivittyvät
   paikoillaan.

Tämän ei tarvitse olla juuri tämä — kansiorakenne on helppo muuttaa
`server/drive/folders.ts` + `server/finance/backup.ts`:n `folderPath`-arvoja
säätämällä, koska kansioiden luonti on idempotenttia (nimihaku, ei
tallennettuja ID:itä).

## Tiedostomuodot

| Sisältö | Muoto | Miksi |
|---|---|---|
| Asiakaslaskut, alihankkijalaskut, sisäiset laskut | PDF | Sama muoto kuin jo lähetetyissä sähköposteissa; avautuu missä tahansa. |
| Tilikartta, päiväkirja, pääkirja, tuloslaskelma, tase, ennustelaskelma | Google Sheets | Muodostetaan lataamalla CSV-sisältö Driveen tavoite-mimetyypillä `application/vnd.google-apps.spreadsheet`, jolloin Drive konvertoi sen automaattisesti natiiviksi Sheetiksi (toimii myös olemassa olevan tiedoston SISÄLLÖN päivityksessä, ei vain luonnissa). Avautuu suoraan selaimessa, muokattavissa, viedään Exceliin yhdellä latauksella jos joskus tarvitaan. |

## Mitä varmuuskopioidaan (ja mitä ei — vielä)

Katettu (ks. `server/routes.ts` — `backupInvoicePdf`-kutsut, ja
`server/finance/backup.ts`):
- kaikki lähetetyt asiakaslaskut (kotitalousvähennys-tositteet)
- kaikki alihankkijoiden itselaskuttamat laskut
- kaikki yrittäjien väliset laskut (vastalaskut)
- tilikartta, päiväkirja, pääkirja, tuloslaskelma, tase (per founder, manuaalinapilla)
- ennustelaskelma (per founder, manuaalinapilla)

**Ei (vielä) katettu** — selkeitä, rajattuja jatkokehitystehtäviä:
- Taloyhtiö-laskut per-asunto-tilassa (`jobs.tsx`:n `residents`-haara) — ei
  vielä samaa `backupInvoicePdf`-koukkua kuin `board`-haaralla. Helppo lisätä
  samalla kaavalla.
- FR8-urakkaerien (`GigPayment`) laskut — näillä ei nykyisessä sovelluksessa
  ole omaa PDF-generointia edes tänään (ne laskutetaan asiakkaalle muualla
  kautta); kun/jos sellainen lisätään, sama `backupInvoicePdf`-koukku sopii.
- Ajoitettu (esim. tunneittain/päivittäin) automaattinen raporttien
  varmuuskopiointi ilman nappia — nyt manuaalinen klikkaus riittää
  toimeksiannon mukaan, mutta `server/finance/backup.ts`:n
  `backupLedgerReports`/`backupForecast` on jo valmis kutsuttavaksi myös
  `setInterval`-tyylisestä ajastimesta `server/index.ts`:ssä, jos automaatio
  halutaan tiukemmaksi myöhemmin.

## Verottajaa / tilintarkastajaa varten

Kun kaikki on paikoillaan, jokainen tarvittava asiakirja löytyy **kahdesta**
paikasta riippumattomasti toisistaan:
1. Sovelluksesta itsestään (Talous ja verotus -sivu — Kirjanpito, Laskut,
   Tiimi & dokumentit -osiot).
2. Google Drivesta yllä kuvatusta kansiorakenteesta — PDF-laskut ja
   Sheets-muotoiset raportit, avattavissa millä tahansa laitteella ilman
   kirjautumista sovellukseen.

Näin täyttyy toimeksiannon vaatimus: "mitään ei pitäisi joutua etsimään
useasta eri paikasta" — Drive-kansio ITSESSÄÄN on se yksi paikka, josta
kaikki löytyy, riippumatta sovelluksen/serverin tilasta.

## Tietomallimuutokset

- `shared/schema.ts`: uusi `drive_files`-taulu (kind, sourceKey →
  driveFileId/driveFolderId/webViewLink/updatedAt) — seuraa mikä dokumentti
  on jo Drivessa ja millä tiedostotunnisteella, jotta uudelleenlataus
  päivittää SAMAN tiedoston sisällön eikä luo kopioita.
- `server/index.ts`: auto-migraatio `CREATE TABLE IF NOT EXISTS drive_files`
  (ja retroaktiivisesti myös Osa 1:n taulut) — deploy ei vaadi enää käsin
  ajettavaa `npm run db:push`-komentoa, palvelin luo puuttuvat taulut itse
  käynnistyessään (sama kuvio kuin `founder_settlements`/`chat_*`-tauluilla).

## API

| Reitti | Kuvaus |
|---|---|
| `GET /api/finance/backup/status?ledgerId=&year=` | Onko Drive konfiguroitu + viimeisimmät varmuuskopiot ledgerille/vuodelle |
| `POST /api/finance/backup` `{ledgerId, year}` | Varmuuskopioi tilikartta/päiväkirja/pääkirja/tuloslaskelma/tase/ennuste kerralla |

Kummatkin `role === "host"` -suojattuja, kuten muutkin `/api/finance/*`-reitit.
