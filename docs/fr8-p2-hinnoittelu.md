# FR8 P2 — keltaisten ikkunoiden ikkunakohtainen hinnoittelu & asiakasneuvottelu

## Miksi

P1 (punaiset) on kiinteä, allekirjoitettu €6300-urakka (`shared/project.ts`:
`fixedDealFor`, `computeDealBilling`, 4 × 1575 € erälaskutus) ja se viedään
loppuun sellaisenaan. P2 (keltaiset) toimii PÄINVASTAISELLA mallilla: ei
urakkahintaa, vaan **hinta per ikkuna**, joka **neuvotellaan asiakkaan kanssa
seurantalinkissä** — ja asiakkaalle näkyvä P2-summa kasvaa vain molemmin puolin
hyväksytyistä (lukituista) hinnoista.

## Datamalli (`shared/p2.ts`, tila `ProjectData.p2`)

- `P2State { enabled, workerSharePct, offers, events, terms, termsText }`
- `P2Offer { status, priceCents, counterCents?, version, lockedCents?, lockedAt?, lockedBy? }`
  avaimenä sama window key kuin `statuses`/`washedBy` (`"<krs>#<i>"` / `"<krs>#c<rand>"`).
- Keltainen piste ILMAN offer-tietuetta = "ei hinnoiteltu".
- `events` = auditloki (max 500, uusin ensin): kuka teki mitä, mihin hintaan,
  millä versiolla, asiakastoimista ip. Tämä + `terms` (nimi + aikaleima + ip)
  muodostavat P2-sopimuksen. Valmis sopimusteksti voidaan liittää `termsText`iin.

## Tilakone (`p2Transition`)

```
(ei offeria) --propose(admin)--> proposed --accept(asiakas)--> locked
proposed --counter(asiakas)--> countered --accept_counter(admin)--> locked
countered --propose(admin)--> proposed        (uusi ehdotus kumoaa counterin)
proposed/countered --decline(asiakas)/cancel(admin)--> declined --propose--> …
locked --unlock(admin, vain jos EI pesty)--> proposed
```

Jokainen siirtymä kasvattaa `version`-numeroa. Asiakkaan `accept` viittaa
TÄSMÄLLEEN nähtyyn `{priceCents, version}` -pariin ja adminin `accept_counter`
nähtyyn counteriin — versio- tai hintaero palauttaa **409** ("Hinta ehti
muuttua"), joten juuri muuttunutta hintaa ei voi hyväksyä vahingossa.

## Samanaikaisuus — p2 on serverin omistama

- Geneeriset tallennukset (`PATCH /api/jobs/:id/project`, `saveProject`) EIVÄT
  koskaan ota `p2`:ta clientiltä: serveri liittää talletetun (saveProjectissa
  juuri ennen kirjoitusta uudelleen luetun) kopion takaisin. Adminin
  karttamuokkaus tai tekijän ikkunamerkintä ei siis voi pyyhkiä asiakkaan
  hyväksyntää.
- Kaikki p2-mutaatiot kulkevat dedikoitujen reittien kautta (read-modify-write):
  - Admin: `POST /api/jobs/:id/p2/phase | propose (bulk) | respond`
  - Asiakas (quoteToken, rate-limit 60/min/IP, vaatii `enabled` + allekirjoituksen):
    `POST /api/gig/:token/p2/terms | accept | counter | decline | add-point | remove-point`.
    **Tilausehdot (terms) vaaditaan vain HINTASITOUMUKSISSA** — `accept` ja `counter`.
    **Suunnittelu on vapaata ilman ehtoja**: `add-point`, `remove-point` ja `decline`
    eivät vaadi termsiä, joten asiakas voi ensin tutkia ja valmistella karttaa
    (lisätä/poistaa ehdottamiaan ikkunoita, karsia ehdotuksia) ennen mitään
    sopimuksen tekoa. Client peilaa saman jaon: `runP2` (terms-portti) vs
    `runP2Free` (suunnittelu). (remove-point sallii vain asiakkaan ITSE lisäämän,
    ei-lukitun pisteen poiston; `customerAddedKeys` erottaa asiakkaan pisteet auditlokista.)

## Raha

- `computeP2Billing(project)` (`shared/p2.ts`): lukitut/pestyt/kertymä/tekijäkulu/
  kate — join eläviin `p===2`-pisteisiin, poistetut putoavat pois. `p2` puuttuu →
  kaikki nollia (vanhat keikat ennallaan).
- **Tekijän palkkio**: `p2WorkerPayoutCents(lockedCents, workerSharePct, schedule?)` —
  **kiinteä palkkiotaulukko** voittaa: `DEFAULT_P2_PAYOUT_SCHEDULE` = 34 € → 18 €,
  37,50 € → 20 €, 50 € → 27 € (per ikkunan lukittu hinta). Hinta jota EI ole taulukossa käyttää
  `workerSharePct`-osuutta (oletus 53 %). Taulukko on säädettävissä per keikka
  (`P2State.payoutSchedule`, admin-paneelissa "Tekijän palkkio per ikkuna"). Palkkio
  lasketaan AINA reaaliaikaisesti, joten taulukon muutos re-arvottaa myös jo pestyt
  keltaiset (ei backfilliä). `crewMemberStats` (`shared/crew.ts`) maksaa p1:stä oman
  taksan ja p2:sta taulukon/osuuden; `washed`-LUKUMÄÄRÄ laskee silti kaikki pestyt,
  joten `checkWindowAttribution` täsmää. Pikahinnat `P2_PRICE_PRESETS_CENTS`
  = 34 / 37,50 / 50 €.
- **Pesuportti**: `POST /api/crew/:token/window` estää (403) keltaisen
  merkkaamisen, jos hintaa ei ole lukittu (prioriteetti katsotaan AINA kartasta
  `pointPriority`llä, ei clientin `p`:stä). Ilman `p2`:ta ei porttia.
- `jobs.agreedPrice` = P1-katto + lukittu P2-summa.
- **Laskutus**: P2 laskutetaan erillään eristä `POST /api/jobs/:id/gig/invoice`
  + `scope:"p2"` — ei koske `invoicedThrough`/sektoreihin/4 erän rajaan (ne
  lasketaan vain maksuista joilla `scope !== "p2"`). Maksu kirjataan
  `GigPayment { scope:"p2" }`; P2 laskuttamatta = kertymä − Σ p2-maksut.
  **TÄRKEÄ invariantti**: jokainen P2-maksu KIRJATAAN `scope:"p2"`:lla — muuten se
  laskettaisiin punaiseksi eräksi ja estäisi kiinteän diilin 4. erän (`p1Payments =
  payments.filter(p => p.scope !== "p2")`; portti `p1Payments.length >= 4`). Sama
  `scope !== "p2"` -suodatus on kaikissa kolmessa `invoicedCents`-laskennassa
  (luonti, undo, `recomputeGigInvoiced`) ja sisäisessä maksuraportissa
  (`buildGigReportHtml` erittelee P1/P2), jotta maksun poisto tai P2-lasku ei
  koskaan korruptoi punaista €6300-summaa.

## Näkymät

- **Admin** (`admin/project.tsx` P2AdminPanel + `fr8/FloorView.tsx`):
  vaihekytkin, tekijän %-osuus + **palkkiotaulukon muokkain** (hinta → kiinteä
  palkkio, oletus 34→18 / 37,50→20), "€ Hinnoittele" -monivalinta kartalla
  (presetit 34/37,50/50 €), hintabadget, vastatarjous-inbox, anomaliavaroitus
  ("pesty ilman lukittua hintaa" → palkkio 0), auditloki, P2-laskun lähetys.
- **Asiakas** (`gig-live.tsx` + `CustomerFloorMap.tsx`): kun vaihe 2 on aktiivinen,
  näkymä pivotoi keltaisiin — 1. vaihe (kiinteä urakka) tiivistyy "✓ valmis"
  -kortiksi ja **"Priority 2"** -paneeli nousee pääfokukseksi (kasvava summa).
  Siisti kaksirivinen työkalupalkki (kerrosvalitsin vieritettävänä rivinä +
  suodatin/edistyminen omalla rivillään) pysyy linjassa myös mobiilissa.
  Kartalla punaiset himmennetään ja tarjolla on "Vain Priority 2" -suodatin.
  Kun kaikki keltaiset on hinnoiteltu, kartta ei sotkeennu: **lukitut näyttävät
  vain pienen ✓-merkin** (hinta löytyy listasta), avoimet pitävät luettavan
  pillerin. Kartan alla **organisoitu ehdotuslista KAIKISTA kerroksista** ryhmiteltynä
  ("Odottaa sinua" / "Vastatarjouksesi" / "Sovitut"): jokaisella rivillä ikkunan
  sijainti + hinta + Hyväksy / Vastatarjous / Ei, plus "Hyväksy kaikki (n · X €)".
  Kartan napautus toimii yhä (popup). Näkyvä "odottava" lisäys-nudge ("Lisää
  ikkunoita Priority 2:seen") kutsuu asiakasta ehdottamaan lisää ikkunoita;
  asiakkaan itse lisäämät pisteet saavat oman halo-merkin ja hän voi poistaa ne
  ennen hinnoittelua. Ammattimainen ehtomodaali ("Priority 2 -tilausehdot"): yksi
  vieritysalue (liitetty soppari `pre-wrap`-tyylillä säilyttää kappaleet + **valmis
  sopimus PDF:nä**), pakollinen suostumusrasti + "hyväksyntä kirjataan nimelläni ja
  aikaleimalla", nimi + Escape-sulku; "Hyväksyn ehdot" aktivoituu vasta kun nimi ja
  rasti on täytetty. Kertaluonteinen, brändätty vaihe-2-kutsupopup (X-sulku).
- **Tekijä** (`worker.tsx`): lukitsemattomat keltaiset himmeinä + 🔒 (merkintä
  estetty myös serverillä), lukituista popoverissa "Sinulle tästä ikkunasta: X €"
  (vain oma palkkio — ks. rahan yksityisyys `fr8-tyo-logiikka.md`), Ansioissa
  "sis. Priority 2" -erittely (`stats.p2EarnedCents`).

## Valmis sopimus (PDF)

Valmis, viimeistelty Priority 2 -sopimus on bundlattu staattisena assetina:
`client/public/fr8/priority2-sopimus-2026.pdf` → tarjoillaan osoitteesta
`/fr8/priority2-sopimus-2026.pdf` (samaan tapaan kuin `/fr8/plans/*` ja
`/fr8/marks_data.json`).

- **Asiakas** näkee "Lue koko sopimus (PDF)" -linkin Priority 2 -tilausehtojen
  modaalissa (`gig-live.tsx`, vakio `P2_CONTRACT_PDF_URL`).
- **Perustaja** näkee "Avaa liitetty sopimus (PDF)" -linkin P2AdminPanelin
  sopimusteksti-editorissa (`admin/project.tsx`).
- `termsText` (vapaa liitetty teksti) ja PDF-linkki ovat rinnakkaiset: modaali
  näyttää `termsText`in (tai lyhyen oletustekstin) JA aina PDF-linkin. Uuden
  sopimusversion voi vaihtaa korvaamalla saman­nimisen PDF-tiedoston.

## Ohjattu eteneminen (guided)

Priority 2 kytkeytyy myös **ohjattuun etenemiseen** (yks kerros kerrallaa):
lukittu keltainen tulee mukaan työn piiriin ja voi pitää kerroksen auki, kun taas
hinnoittelematon/lukitsematon keltainen ei ole piirissä. Ks. oma dokumentti
**`docs/fr8-ohjattu-eteneminen.md`**.

## Valmisteluvaihe (enabled = false)

Diili on greenlightattu, mutta hinnoittelua VALMISTELLAAN: Joonatan & Matias
voivat hinnoitella keltaisia kartalla (server alustaa `p2`:n ensimmäisestä
ehdotuksesta) ja liittää sopimustekstin — **mikään ei muutu kenellekään muulle**:

- Asiakas: seurantalinkki toimii täsmälleen kuten ennen (`GET /api/gig/:token`
  ei palauta p2:ta kun enabled=false).
- Tekijät: eivät näe P2:ta, keltaisten merkkaus ja palkkio kuten ennen
  (`crewMemberStats` ja pesuportti kytkeytyvät vasta enabled=true).

Kun "Avaa vaihe 2 asiakkaalle" kytketään, asiakkaalle ponnahtaa samassa
linkissä kertaluonteinen kutsu ("Toinen vaihe voi alkaa") suunnitteluun, ja
tekijöille aukeavat lukitut keltaiset työjonoon.

## Yhteensopivuus

`p2` on valinnainen kenttä: ilman sitä pesuportti, palkkio-, summa- ja UI-logiikka
käyttäytyvät täsmälleen kuten ennen. Ei DB-migraatiota. Testit: `shared/p2.test.ts`
(tilakone + raha + sanitointi + crewMemberStats-yhteensopivuus).
