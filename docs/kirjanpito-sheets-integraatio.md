# Kirjanpito → Google Sheets + Drive -integraatio

Suunnitelma sille, miten tekijöiden laskut (aluksi yksityiskeikkojen
CrewPayout-laskut) tallentuvat automaattisesti ja luotettavasti Google
Sheetsiin (lokina) ja Google Driveen (PDF-tiedostoina), yhdelle Google-tilille
(Matias), suoralla Sheets/Drive-API:lla ilman Apps Scriptiä tai OneDrivea.

## Päätökset (käyttäjän vahvistamat)

- **Ei OneDrivea / Microsoftia.** Käytössä on Google-tilit, joten Google
  Drive + Sheets korvaa sen suoraan — sama idea, oikea ekosysteemi.
- **Yksi Google-tili aluksi** (Matias). Ei per-tekijä-OAuth:ia — se olisi
  paljon enemmän ylläpidettävää (kirjautuminen jokaiselta tekijältä, tokenien
  uusinta, seuranta kuka ei ole liittynyt). Ks. alla "Per-tekijä-näkyvyys
  ilman OAuthia" — saadaan silti tekijäkohtainen näkyvyys halvalla.
- **Suora Google Sheets + Drive API palvelimelta** (`googleapis`-kirjasto,
  palvelutili), ei Apps Script Web Appia. Ei suoritusaikarajoja, ei erillistä
  deploy-prosessia, sama koodikanta/lokitus kuin muussakin backendissä.
- **Aloituslaajuus: yksityiskeikkojen tekijälaskut** (`CrewPayout`,
  tila `"maksettu"`) — ei FR8-erälaskuja tässä vaiheessa. FR8 lisätään
  myöhemmin samalla moottorilla (ks. "Vaiheistus").

## Miksi Sheets JA Drive yhdessä

Sheets ei voi sisältää PDF-binääriä — solut ovat vain tekstiä/arvoja.
"Kaikki Sheetsiin" tarkoittaa käytännössä: **PDF:t Driveen** (Googlen oma
tiedostovarasto — täsmälleen se mitä OneDrive olisi ollut), **ja Sheets
toimii rakenteisena lokina/indeksinä**, jossa jokainen rivi linkittää
vastaavaan Drive-tiedostoon. Molemmat samalla yhdellä palvelutilillä.

## Nykytila — mihin kohtaan koodia tämä kiinnittyy

Yksityiskeikan tekijän lasku syntyy täällä:
`server/routes.ts` → `POST /api/jobs/:id/crew/:memberId/payout/:payoutId/paid`
(rivi ~6884). Kun johtaja merkitsee maksun maksetuksi:
1. `payout.status = "maksettu"`, `invoiceNo` annetaan, `tax`/`buyer`
   lasketaan/lukitaan (rivit 6939-6944).
2. `saveProject(job, project)` tallentaa tämän `jobs.projectData`-JSON:iin
   (rivi 6947) — **tämä pysyy edelleen totuuden lähteenä**, Sheets/Drive on
   lisäkopio, ei korvaa mitään.
3. `generateWorkerInvoicePdf(...)` (rivi 6953) rakentaa PDF:n muistiin
   (`pdfkit`, ei koskaan levylle).
4. Resend lähettää sen sähköpostitse tiimille + tekijälle (best-effort,
   `if (resend) { ... try/catch ... }`).

**Tähän samaan kohtaan, heti PDF:n synnyn jälkeen**, lisätään uusi
fire-and-forget-kutsu joka tekee Sheets+Drive-synkan — täsmälleen samalla
"ei koskaan kaada kutsujan pyyntöä" -periaatteella kuin Resend-lähetys jo
tekee.

Tyyppi `CrewPayout` (`shared/crew.ts` rivi 103) ja tekijän profiili
(`CrewProfile.email`, rivi 30) antavat kaiken tarvittavan datan riville ja
mahdolliselle jaolle (ks. alla).

## Arkkitehtuuri

### 1. Google Cloud -pohja (Matias tekee kertaluontoisesti — en pysty tekemään tätä puolestasi)

1. Google Cloud -projekti (uusi tai olemassa oleva).
2. Ota käyttöön: **Google Sheets API** ja **Google Drive API**.
3. Luo **palvelutili** (service account), lataa sen JSON-avain.
4. Luo kohteet:
   - Google Drive -juurikansio, esim. **"Puuhapatet — Laskutus"**.
   - Google Sheet, esim. **"Puuhapatet — Laskutusloki"** (kannattaa laittaa
     samaan juurikansioon).
5. Jaa **molemmat** palvelutilin sähköpostille (näyttää `xxx@<projekti>
   .iam.gserviceaccount.com`, löytyy JSON-avaimesta) muokkausoikeuksin.
6. (Suositeltu lisä) Jaa juurikansio myös omalle oikealle Google-tilillesi,
   jolloin se näkyy normaalisti omassa Drivessasi ("Jaettu kanssani" tai
   pikakuvakkeena omaan Driveen).
7. Vie kolme arvoa tuotantoympäristön (Render) muuttujiin:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — koko JSON-avaimen sisältö yhdellä rivillä.
   - `GOOGLE_SHEETS_LASKUTUS_ID` — Sheetin ID (URL:sta).
   - `GOOGLE_DRIVE_LASKUTUS_FOLDER_ID` — juurikansion ID (URL:sta).

   Annan tarkat askel-askeleelta-ohjeet erikseen kun tähän kohtaan tullaan —
   tämä on ainoa vaihe joka vaatii sinun omaa käsin tekemistä.

### 2. Koodi (teen tämän)

Uusi moduuli, esim. `server/sheets-sync.ts`:

- **Laiska alustus samalla kaavalla kuin `resend`:**
  ```ts
  const sheetsAuth = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes: [...] })
    : null;
  ```
  Jos muuttujaa ei ole (esim. paikallinen kehitys), kaikki no-oppaa hiljaa —
  ei kaada mitään, ei vaadi kenenkään asentavan mitään dev-käytössä.

- **`ensureWorkerFolder(workerId, workerName)`** — hakee tai luo
  `{juurikansio}/{workerName} ({workerId})/`-alikansion. Kansio-ID
  välimuistitetaan uuteen pieneen tauluun (`driveWorkerFolders`), jotta
  jokainen lasku ei tee ylimääräistä Drive-hakua.

- **`syncPayoutToSheetsAndDrive(payout, member, pdfBuffer, buyer, tax)`**:
  1. Lataa PDF-tavut tekijän kansioon, tiedostonimi `Lasku-{invoiceNo}.pdf`.
  2. Lisää yksi rivi lokitaulukkoon (sarakkeet alla).
  3. Jos tämä on tekijän ensimmäinen synkattu lasku ja `member.profile.email`
     on tiedossa: jaa kansio hänelle lukuoikeuksin (best-effort, ei kaada
     mitään jos epäonnistuu — esim. osoite ei ole Google-tili).
  4. Kaikki try/catch:ssa, kirjaa tulos uuteen `externalSyncLog`-tauluun
     (`recordType`, `recordId`, `target`, `success`, `error`, `syncedAt`) —
     sama malli kuin `eraInvoiceEmails`.

- **Kutsupaikka:** `/paid`-reitissä, heti `generateWorkerInvoicePdf(...)`:n
  jälkeen: `void syncPayoutToSheetsAndDrive(payout, member, pdf, buyer, tax)`
  — ei koskaan `await`, ei koskaan voi hidastaa tai kaataa vastausta.

### 3. Per-tekijä-näkyvyys ilman OAuthia

Koska jokaisella tekijällä on kansio JA (jos sähköposti tiedossa) jako-oikeus
siihen, tekijä näkee **omat laskunsa omassa Drivessaan** ("Jaettu kanssani"),
kunhan hänellä on Google-tili samalla osoitteella kuin profiilissa. Tämä
antaa käytännössä saman lopputuloksen kuin "oma OneDrive per tekijä" —ilman
että kenenkään tarvitsee kirjautua mihinkään erikseen tai meidän tarvitsee
hallita tokeneita. Jos tekijällä ei ole Google-tiliä tuolla osoitteella, jako
epäonnistuu hiljaisesti eikä vaikuta mihinkään muuhun — hän saa laskunsa
edelleen sähköpostiliitteenä niin kuin nytkin.

### 4. Bulletproof-vaatimukset

1. **Idempotenssi:** ennen Drive-lataus/Sheets-lisäystä tarkistetaan
   `externalSyncLog`:sta onko `(recordType='payout', recordId=payout.id)`
   jo onnistuneesti synkattu — uusintayritys ei koskaan tuota
   kaksoiskappaleita.
2. **Retry:** Drive/Sheets-kutsut 2-3 uudelleenyritystä eksponentiaalisella
   viiveellä (Google-API:t heittävät ajoittain ohimeneviä 429/500-virheitä)
   ennen lopullista epäonnistumisen kirjaamista.
3. **Täsmäytysajo:** kevyt ajastettu tehtävä (tai admin-nappi "Synkkaa
   puuttuvat") joka etsii `maksettu`-tilaiset payoutit ilman onnistunutta
   `externalSyncLog`-riviä ja yrittää ne uudelleen — nappaa senkin, jos
   Google-palvelu on poikki pidempään kuin retryjen aikaikkuna.
4. **Näkyvyys:** pieni tila-osio `tax-export.tsx`:ään ("Talous & verotus")
   näyttämään synkan tilan + manuaalinen "Synkkaa nyt" -nappi epäonnistuneille
   — ei tarvitse luottaa sokeasti, näet että se toimii.
5. **Ei koskaan estä:** mikään olemassa oleva reitti ei muutu toiminnallisesti
   — synkka on puhtaasti lisäävä/tarkkaileva kerros.

### Sheetin sarakkeet (lokirivi per lasku)

```
Pvm | Laskun nro | Tekijä | Y-tunnus | Ostaja (johtaja) | Ikkunat |
Työkorvaus € | ALV € | Ennakonpidätys € | Maksettava/netto € | Tila |
Keikka (jobId) | Drive-linkki
```

(Sama looginen jaottelu kuin `tax-export.tsx`:n nykyisessä "Omat
asiakaslaskut" CSV-viennissä, jotta tyyli pysyy yhtenäisenä.)

## Vaiheistus

1. **Vaihe 1 (nyt):** yksityiskeikkojen tekijälaskut (`CrewPayout`,
   `/paid`-reitti). Tämä on pyydetty aloituslaajuus.
2. **Vaihe 2 (myöhemmin):** sama synkka-moottori laajennetaan FR8-erälaskuihin
   (`eraInvoices`) — moottori on jo laskutyyppi-agnostinen, joten tämä on
   halpa lisäys kun vaihe 1 on todistetusti toiminnassa.
3. **Vaihe 3 (myöhemmin, valinnainen):** kotitalousvähennystositteet,
   johtaja-väliset settlementit, kulut.

## Mitä tarvitaan sinulta ennen koodausta

Vain kohta "1. Google Cloud -pohja" yllä — loput teen suoraan koodissa.
Voit tehdä sen milloin tahansa; annan tarkat klikkiohjeet kun aloitetaan.
