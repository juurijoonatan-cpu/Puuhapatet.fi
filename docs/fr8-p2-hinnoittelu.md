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
  - Asiakas (quoteToken, rate-limit 60/min/IP, vaatii `enabled` + allekirjoituksen
    + terms): `POST /api/gig/:token/p2/terms | accept | counter | decline | add-point | remove-point`
    (remove-point sallii vain asiakkaan ITSE lisäämän, hinnoittelemattoman/
    ei-lukitun pisteen poiston; `customerAddedKeys` erottaa asiakkaan pisteet
    auditlokista).

## Raha

- `computeP2Billing(project)` (`shared/p2.ts`): lukitut/pestyt/kertymä/tekijäkulu/
  kate — join eläviin `p===2`-pisteisiin, poistetut putoavat pois. `p2` puuttuu →
  kaikki nollia (vanhat keikat ennallaan).
- **Tekijän palkkio**: `p2WorkerPayoutCents(lockedCents, workerSharePct)` —
  osuus (oletus 53 % ≈ 20 €/37,50 €) IKKUNAN lukitusta hinnasta. Halvempi ikkuna
  → pienempi palkkio. `crewMemberStats` (`shared/crew.ts`) maksaa p1:stä oman
  taksan ja p2:sta osuuden; `washed`-LUKUMÄÄRÄ laskee silti kaikki pestyt, joten
  `checkWindowAttribution` täsmää.
- **Pesuportti**: `POST /api/crew/:token/window` estää (403) keltaisen
  merkkaamisen, jos hintaa ei ole lukittu (prioriteetti katsotaan AINA kartasta
  `pointPriority`llä, ei clientin `p`:stä). Ilman `p2`:ta ei porttia.
- `jobs.agreedPrice` = P1-katto + lukittu P2-summa.
- **Laskutus**: P2 laskutetaan erillään eristä `POST /api/jobs/:id/gig/invoice`
  + `scope:"p2"` — ei koske `invoicedThrough`/sektoreihin/4 erän rajaan (ne
  lasketaan vain maksuista joilla `scope !== "p2"`). Maksu kirjataan
  `GigPayment { scope:"p2" }`; P2 laskuttamatta = kertymä − Σ p2-maksut.

## Näkymät

- **Admin** (`admin/project.tsx` P2AdminPanel + `fr8/FloorView.tsx`):
  vaihekytkin, tekijän %-osuus, "€ Hinnoittele" -monivalinta kartalla
  (presetit 25/37,50/50 €), hintabadget, vastatarjous-inbox, anomaliavaroitus
  ("pesty ilman lukittua hintaa" → palkkio 0), auditloki, P2-laskun lähetys.
- **Asiakas** (`gig-live.tsx` + `CustomerFloorMap.tsx`): kun vaihe 2 on aktiivinen,
  näkymä pivotoi keltaisiin — 1. vaihe (kiinteä urakka) tiivistyy "✓ valmis"
  -kortiksi ja **"Priority 2"** -paneeli nousee pääfokukseksi (kasvava summa).
  Kartalla punaiset himmennetään ja tarjolla on "Vain Priority 2" -suodatin.
  Hintapillerit keltaisissa (pop-in-animaatio, lukituille celebrate-pulse),
  napautus → Hyväksy / Vastatarjous / Ei kiitos, kerroskohtainen massahyväksyntä.
  Näkyvä, "odottava" lisäys-nudge ("Lisää ikkunoita Priority 2:seen") kutsuu
  asiakasta ehdottamaan lisää ikkunoita; asiakkaan itse lisäämät pisteet saavat
  oman halo-merkin ja hän voi poistaa ne ennen hinnoittelua. Kevyt ehtomodaali
  ("Priority 2 -tilausehdot", josta löytyy **valmis sopimus PDF:nä**, ks. alla)
  ennen ensimmäistä toimintoa + kertaluonteinen vaihe-2-kutsupopup.
- **Tekijä** (`worker.tsx`): lukitsemattomat keltaiset himmeinä + 🔒 (merkintä
  estetty myös serverillä), lukituista popoverissa "Sinulle tästä ikkunasta: X €"
  (vain oma palkkio — ks. rahan yksityisyys `fr8-tyo-logiikka.md`), Ansioissa
  "sis. Priority 2" -erittely (`stats.p2EarnedCents`).

## Tekijöiden hinta-arviot (hinnoittelun apu)

Perustaja hinnoittelee keltaisia **pohjakuvasta**; tekijä seisoo talossa ja
**näkee** ikkunan. Siksi loput hinnoittelemattomat kysytään heiltä: työpöydälle
ilmestyy popup, jossa käydään keltaisia läpi yksi kerrallaan.

- **Ei vielä hinnoiteltu** → "Paljonko haluaisit saada tästä ikkunasta?"
  (presetit vertailutason ympäriltä + oma summa). Vastaus on tekijän OMA
  palkkiotoive, ei asiakashinta.
- **Jo hinnoiteltu** → "Tämä ikkuna on jo hinnoiteltu. Sinulle tästä: X €.
  Sopiiko?" → **Kyllä / Ei**; "Ei" saa kantaa mukanaan summan ("mikä olisi
  reilu"). Hylätty (`declined`) tarjous = takaisin hinnoittelemattomiin.

**Realismi on rakennettu sisään.** Jokainen summa mitataan keikan omaa tasoa
vasten: `p2EstimateReferenceCents` = lukittujen keltaisten mediaanipalkkio, tai
ennen ensimmäistä lukitusta tekijän oma €/ikkuna-taksa (viimeinen fallback 20 €).
Yli **2 × vertailutaso** → `flagged`: tekijä näkee varoituksen jo ennen lähetystä
(sama raja clientissä ja serverillä) ja perustaja näkee merkinnän heti
P2-paneelissa. Popupin pelisäännöt sanovat tämän suoraan: arvio on lupaus hinnasta
jolla työ oikeasti tehdään, ja ylihinnoittelu näkyy meille välittömästi.

Datamalli (`shared/p2.ts`, `P2State`):

- `askEstimates?: boolean` — perustajan kytkin. **Erillinen `enabled`istä**:
  arviot kerätään nimenomaan valmisteluvaiheessa, ennen kuin mitään menee
  asiakkaalle.
- `estimates?: Record<key, Record<memberId, P2Estimate>>` — yksi tietue per
  (ikkuna, tekijä), uusi vastaus korvaa vanhan.
  `P2Estimate { memberId, payoutCents?, vote?, note?, ts, flagged? }`.
- Arviot EIVÄT mene `events`-auditlokiin: se on asiakassopimuksen loki (katto 500),
  eivätkä tekijöiden mielipiteet saa työntää neuvottelutapahtumia sieltä ulos.

Laskenta: `p2EstimateSummary` / `p2EstimateSummaries` (hinnoittelemattomat ensin,
sitten vastausmäärä) antavat per ikkuna mediaanin/hajonnan, kyllä-ei-jakauman,
flagged-määrän ja `suggestedPriceCents` = `impliedP2PriceCents(mediaani, share%)`
— eli **tekijöiden mediaanitoiveesta johdettu asiakashinta**, jonka perustaja voi
ehdottaa yhdellä napilla ("Ehdota X €", pyöristys 0,50 €).

Reitit:

- Perustaja: `POST /api/jobs/:id/p2/phase { askEstimates }` (kytkin).
- Tekijä: `POST /api/crew/:token/p2/estimate { key, payoutCents?, vote?, note? }`
  — vaatii `askEstimates`, keltaisen pisteen kartasta (`pointPriority`), ja
  sopimusportti kuten muillakin crew-kirjoituksilla. Hinnoiteltu ikkuna vaatii
  `vote`n, hinnoittelematon summan. Kirjoitus lukee **tuoreimman p2:n juuri ennen
  tallennusta** ja lisää siihen vain oman arvionsa, joten arvio ei voi yliajaa
  asiakkaan samaan aikaan lukitsemaa hintaa.

**Rahan yksityisyys säilyy:** `workerView.p2Ask` lähettää hinnoitellusta ikkunasta
VAIN tekijän oman palkkion (`p2WorkerPayoutCents`) — ei `lockedCents`ia,
`priceCents`iä eikä `workerSharePct`:tä. Asiakashintaa ei voi rekonstruoida.

Näkymät: tekijä `client/src/components/fr8/P2EstimateModal.tsx` (+ nudge ja
kerran/vrk aukeava popup `worker.tsx`:ssä, "Näytä kartalla" vie kerrokselle);
perustaja P2AdminPanelin **"Kysy tekijöiltä hinta-arviot"** -kytkin ja
arviolista erittelyineen (kuka ehdotti mitä, milloin, flagged).

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
