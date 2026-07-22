# FR8 — työ-, ansio- ja näkymälogiikka

Tämä dokumentti kuvaa FR8-keikan (ja yleisesti alihankkijakeikkojen) ansio-,
työaika- ja näkymälogiikan, jotta kuka tahansa (ihminen tai agentti) voi jatkaa
työtä ilman, että konteksti katoaa. Päivitä tätä kun logiikka muuttuu.

> **Uusi täällä?** Lue ensin **`docs/fr8-jarjestelma-yleiskuva.md`** — koko FR8:n
> yleiskuva, kriittiset invariantit ja dokumenttihakemisto.

## Osapuolet ja näkymät

- **Työntekijä / alihankkija** (esim. Jani): yksityinen linkki `/tyo/:token`
  (`client/src/pages/worker.tsx`). Näkee VAIN omat tietonsa.
- **Johtaja / perustaja** (Joonatan, Matias): admin → FR8-keikka
  (`client/src/pages/admin/project.tsx` + `client/src/components/fr8/Dashboard.tsx`).
  Näkee kaikki tekijät, keikan kokonaisuuden ja per-henkilö-ansiot.

## Ansiomalli (per ikkuna)

- **Keikan kokonaishinta / ikkuna** = `deal.pricePerWindow` (FR8: **37,50 €**,
  näkyy adminissa joskus pyöristettynä 38 €, mutta laskenta käyttää tarkkaa
  37,50:tä). Vain "punaiset" (prioriteetti 1) kerryttävät dealissa, katto 6 300 €.
- **Työntekijän ansio** = pestyt ikkunat × hänen oma €/ikkuna (crew-jäsenen
  `perWindowCents`, esim. Jani 20 €). Asetetaan adminin Työntekijät-näkymästä
  ("Palkka €/ikkuna").
- **Perustajien ansio** (`client/src/pages/admin/project.tsx` → `earningsFor`):
  - **37,50 € jokaisesta ITSE pesemästään ikkunasta** (koko ikkunan hinta, ei
    alihankkijaa jakamassa).
  - **+ tuotto-osuus työntekijöiden ikkunoista**: jokaisesta työntekijän pesemästä
    ikkunasta `(37,50 € − työntekijän rate)` jaetaan perustajien kesken. FR8:
    `(37,50 − 20) / 2 = 8,75 € / perustaja / työntekijän ikkuna`.
  - Summa: `omat × 37,50 € + (tuotto-pooli / perustajien lkm)`. Tämä täsmää keikan
    kokonaisliikevaihtoon (jokainen ikkuna = 37,50 €, joko perustajalle kokonaan tai
    työntekijä + perustajien marginaali).
  - Perustajat näkyvät TEKIJÄT-listalla vaikka eivät olisi itse pesseet (tuotto-osuus).
- **Iso liikevaihto-/prioriteettikortti** johtajien dashboardissa = keikan deal
  (37,50 × punaiset, katto) — tämä on yrityksen luku, EI per-henkilö.

### Johtajien manuaalinen muokkaus (TOTEUTETTU)
Johtajat voivat asettaa oman ansionsa käsin TEKIJÄT-kortista ("Muokkaa ansiota") —
ohittaa lasketun summan (esim. "tehdään päivä yhdessä, jaetaan 50/50": aseta molemmille
sama €). Tallennetaan `member.manualEarningsCents`; "↺" palauttaa lasketun. Näkyy vain
johtajien dashboardissa, EI vaikuta työntekijän omaan näkymään. Editointi sallittu vain
`role === "host"` -jäsenille. (Jatko: hienojakoisempi per-päivä, jos keikka on monipäiväinen.)

### Tekoälyapurin päivän tuottoraportti (TOTEUTETTU)
Puuhapatet-adminin tekoälyapuri (`/api/admin/assistant`) saa perustajille
(`role === "HOST"`) kontekstiin **päivän tuottoraportin** kiinteähintaisilta
keikoilta (FR8). `buildAdminContext` (server/routes.ts) laskee jokaiselle
`fixedDealFor`-keikalle tänään pestyt ikkunat per tekijä (keikan lokista,
billable-prioriteetti, deduplikoitu avaimittain) ja muuntaa ne ansioiksi samalla
mallilla kuin johtajien dashboard: perustaja = omat × 37,50 € + tuotto-osuus,
työntekijä = omat × oma rate. Kun perustaja kysyy "päivän tuotto" / "paljonko
tienattiin tänään", apuri vastaa tästä. Näkyy VAIN perustajille, ei
työntekijöille (HOST-only konteksti).

## Harjoittelijat (esim. Milja) — ei sopimuksia, ansiot ohjaajalle

Harjoittelija (`shared/trainees.ts` → `TRAINEES`, esim. Milja Matiaksen vastuulla) EI
ole alihankkija eikä allekirjoita mitään: palkaton, vapaaehtoinen, ohjaajan
vastuulla.
- **Ei sopimuksia / ei allekirjoituksia**: `workerView` lähettää harjoittelijalle
  `requiredAgreementIds: []`, `agreementsGated: false`, `needsToSign: false`, ja
  `/window`-reitti ei estä merkintää. Harjoittelija pääsee suoraan työpöydälle
  (soft start), merkkaa ikkunoita ja näkee OMAT ikkunansa/tuntinsa omalla
  työpöydällään (motivaatio).
- **Ansiot/tunnit ohjaajalle (Matias)**: kaikki harjoittelijan merkkaamat ikkunat
  ja kirjaamat tunnit lasketaan johtajien näkymässä ohjaajalle. Toteutus:
  - Manageri-FR8 (`client/src/pages/admin/project.tsx`): `leaderOf(id)` mäppää
    harjoittelijan crew-id:n → `responsibleLeaderId`. `workerStats`-laskenta ja
    `managerHours` taittavat harjoittelijan pestyt ikkunat + tunnit ohjaajalle;
    harjoittelija ei ole erillinen TEKIJÄT-/Tunnit-rivi. Ohjaajan ikkunat
    arvotetaan täyteen 37,50 €:oon (kuten omat), EIVÄT työntekijän tuotto-pooliin.
  - Tekoälyn päivän tuottoraportti (`server/routes.ts buildAdminContext`): sama
    `effId`-mäppäys harjoittelija → ohjaaja.
  - Kartan attribuutio (`washedBy`) säilyy harjoittelijalla, joten managerit
    näkevät silti kuka fyysisesti pesi; vain laskenta/ansio menee ohjaajalle.
- **Manuaalinen jako**: ohjaaja (Matias) siirtää tuoton/erotuksen toiselle
  perustajalle ja maksaa harjoittelijalle käsin TEKIJÄT-kortin "Muokkaa ansiota"
  -kentästä (`manualEarningsCents`).

## Rahan yksityisyys (TÄRKEÄ)

Työntekijä EI saa nähdä keikan kokonaishintoja, kattoa, liikevaihtoa eikä muiden
ansioita. Varmistettu:
- `WorkerView` (server `workerView`) lähettää `pricePerWindow = oma rate`, EI keikan
  hintaa; ei `deal`-objektia; ei muiden euroja.
- Työntekijän `FloorView` saa `hideMoney` → kartalla ei näy €-summia.
- Työntekijän ansiot näkyvät vain Ansiot-välilehdellä (oma rate × omat ikkunat).
- Leaderboard näyttää vain ikkunamäärät, ei euroja.
- **Älä koskaan** välitä `deal`-proppia tai keikan hintaa työntekijän komponenteille.
- **P2 (keltaiset, ikkunakohtainen hinnoittelu, shared/p2.ts)**: tekijälle saa
  lähettää VAIN hänen oman palkkionsa per lukittu ikkuna (`workerView` →
  `p2.payoutByKey`) — se on sallittu samalla perusteella kuin oma
  `perWindowCents`-taksa. Asiakashintaa (`lockedCents`) tai tekijän
  prosenttiosuutta (`workerSharePct`) EI koskaan lähetetä tekijälle, joten
  asiakashintaa ei voi rekonstruoida palkkiosta.

## Ohjattu eteneminen (guided) — työjärjestys

Perustaja voi kytkeä keikalle **ohjatun etenemisen** (oletus pois): tekijät pesevät
yks kerros kerrallaa (muut lukossa) ja dashboardin "Seuraavaksi"-kortti ohjaa
seuraavaan yksittäiseen ikkunaan. Tämä on **työjärjestys, ei raha** — ansiomalli
yllä ei muutu. Punainen on aina työn piirissä, keltainen vasta kun sen hinta on
lukittu. Merkintä lukitulla (ei-aktiivisella) kerroksella estetään serverillä
(403). Tekijän `workerView.guided` sisältää vain johdettua ohjaustietoa (aktiivinen
kerros, seuraava ikkuna, lukitut kerrokset) — ei rahaa. Täysi speksi:
**`docs/fr8-ohjattu-eteneminen.md`**.

## Työaika / sessio

Worker-työpöydän Tunnit-välilehti (`HoursTab`):
- **Aloita vuoro** → `POST /api/crew/:token/shift {start:true}` → server tallentaa
  `activeShiftAt` + `shiftStartWashed` (ikkunamäärä alussa).
- **Tauko / Jatka työtä** → tauko pysäyttää kellon (client laskee `breakMs`).
  Tauot eivät kerrytä tunteja.
- **Päätä päivä** → laskee työajan (− tauot), kirjaa tunnit (`POST /hours`) ja
  `POST /shift {start:false, minutes}` → server laskee session (ikkunat =
  nyt − `shiftStartWashed`, ansio = ikkunat × oma rate), lisää `sessions`-lokiin ja
  nollaa tilan. Työntekijälle näytetään päivän **yhteenveto** (ikkunat, €, kesto, €/h).
- **Päiväkirja**: `member.sessions` (uusin ensin) näkyy Tunnit-välilehdellä.
- **Johtajat** näkevät reaaliaikaisen "Vuoro käynnissä · X t Y min" -merkin
  TEKIJÄT-kortissa (`activeShiftAt`).

### Sähköposti (TOTEUTETTU)
"Päätä päivä" lähettää työntekijän `profile.email`-osoitteeseen selkeän yhteenvedon
(ikkunat, ansio, työaika, €/h) — `sendSessionSummaryEmail` (server/routes.ts), Resend,
best-effort (ei kaada vastausta jos sähköposti epäonnistuu / ei API-avainta).

### TODO (seuraavat PR:t)
- **Johtajien sessio-loki näkyviin**: managerien dashboardiin per-tekijä sessio-/
  päivähistoria (`member.sessions` on jo tallessa).
- **Tauon kesto reopen-tilanteessa**: tauko on tällä hetkellä client-tilassa; jos
  työntekijä sulkee sovelluksen tauolla, tauko nollautuu. Harkitse tauon
  tallentamista serverille jos tästä tulee ongelma.

## Tiedostot

- `shared/crew.ts` — CrewMember (`perWindowCents`, `activeShiftAt`,
  `shiftStartWashed`, `sessions`, `linkedUserId`), `CrewSession`, sanitointi.
- `shared/p2.ts` — Priority 2 (keltaisten ikkunakohtainen hinnoittelu). Tekijän
  palkkio p2:sta = `p2WorkerPayoutCents`. Ks. `docs/fr8-p2-hinnoittelu.md`.
- `shared/guided.ts` — ohjattu eteneminen (`computeGuided`, `isGuidedBlocked`).
  Ks. `docs/fr8-ohjattu-eteneminen.md`.
- `shared/worker-agreements.ts` — sopimukset (v2026-06), `WORKER_AGREEMENTS_GATED`.
- `server/routes.ts` — crew-reitit: `/shift`, `/hours`, `/window`, `/map-note`,
  `workerView` (mitä työntekijälle lähetetään), `/api/admin/my-dashboard`.
- `client/src/pages/worker.tsx` — työntekijän työpöytä (intro, sopimukset, kartta,
  ansiot, tunnit/sessio, info). ÄLÄ riko introa/sopimuksia ilman erillistä pyyntöä.

## Koko ruudun sovellus (PWA-asennus)

Työntekijä, joka avaa `/tyo/:token` selaimessa, näkee selaimen palkit (ylä/ala) —
iOS:ssa ne saa pois VAIN lisäämällä sovelluksen kotinäyttöön. Logiikka:
- `useWorkerInstall(token)` vaihtaa sivulle per-työntekijä-manifestin
  (`display: standalone`, `scope:/tyo/`, tumma teema) → kotinäytön kuvake avaa
  juuri tämän työpöydän, ei adminia.
- `index.html`: `viewport-fit=cover` + `apple-mobile-web-app-capable=yes` +
  `apple-mobile-web-app-status-bar-style=black-translucent` → iOS:ssa asennettu
  sovellus täyttää koko ruudun (turva-alueet hoidetaan `env(safe-area-inset-*)`
  -paddingilla headerissa/navissa). `Dashboard` lukitsee myös zoomin.
- `usePwaInstall()` tunnistaa: onko jo standalone, alusta (iOS/Android/desktop),
  ja sovelluksen sisäinen selain (IG/FB ym. — ei voi asentaa, ohjataan avaamaan
  Safari/Chrome). Android/Chrome: natiivi `beforeinstallprompt` → "Asenna nyt".
- `InstallBanner` (headerin alla) + `InstallModal` (alustakohtaiset ohjeet)
  näkyvät vain kun EI olla standalone-tilassa; asennuksen jälkeen katoavat.
- `client/src/pages/admin/project.tsx` — johtajien FR8-näkymä (ansiolaskenta, nimet).
- `client/src/components/fr8/Dashboard.tsx` — johtajien yleiskatsaus + TEKIJÄT.
- `client/src/components/fr8/FloorView.tsx` — kartta (jaettu; `hideMoney`, `canAddNotes`).

## Erälaskutus (arvomääräiset maksuerät) — ERI JÄRJESTELMÄ kuin yllä

Tämän dokumentin ansiomalli (`earningsFor`, jatkuva €/ikkuna-laskenta) on
**reaaliaikainen dashboard-arvio**, ei laskutus. Varsinainen, lähetettävä
laskutus (erä 1-3 / erä 4, käsin syötetyt pestyt ikkunat per erä, tekijän
hyväksyntä, PDF, sähköpostikopiot, lakisääteiset kentät) on **oma,
rinnakkainen järjestelmänsä**:

- `shared/era-billing.ts` — puhdas laskentamoottori (`computeEraBilling`).
- `shared/schema.ts` — `era_invoices`/`era_invoice_emails`-taulut.
- `client/src/components/fr8/WorkerEraInvoiceDialog.tsx` (johtajan "Maksu"),
  `FounderEraInvoiceDialog.tsx` (johtaja-välinen), `MaksutView.tsx`
  ("Maksut"-kokonaistilanne).
- `client/src/pages/worker.tsx` → `EraInvoiceSection` (tekijän hyväksyntä).
- `server/routes.ts` — `/api/jobs/:id/era-invoice/*`, `/api/crew/:token/era-invoice/*`.

Täysi speksi, laskentakaavat ja toteutuksen tila: **`docs/fr8-era-laskutus-plan.md`**.
Vanha `crew.tsx`:n "Maksuerät & kate" -dialogi (`EraKateDialog`) jää karkeaksi
ennakkoarvioksi (laskee pesujärjestyksen perusteella, ei käsin syötettynä) —
ei enää totuuden lähde varsinaiselle laskutukselle.
