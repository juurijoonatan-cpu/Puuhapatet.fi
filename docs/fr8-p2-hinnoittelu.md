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
  -kortiksi ja "2. VAIHE · LISÄIKKUNAT" -paneeli nousee pääfokukseksi (kasvava
  summa). Kartalla punaiset himmennetään ja tarjolla on "Vain lisäikkunat"
  -suodatin. Hintapillerit keltaisissa (pop-in-animaatio, lukituille
  celebrate-pulse), napautus → Hyväksy / Vastatarjous / Ei kiitos, kerroskohtainen
  massahyväksyntä. Näkyvä, "odottava" lisäys-nudge kutsuu asiakasta ehdottamaan
  lisää ikkunoita; asiakkaan itse lisäämät pisteet saavat oman halo-merkin ja
  hän voi poistaa ne ennen hinnoittelua. Kevyt ehtomodaali ennen ensimmäistä
  toimintoa + kertaluonteinen vaihe-2-kutsupopup.
- **Tekijä** (`worker.tsx`): lukitsemattomat keltaiset himmeinä + 🔒 (merkintä
  estetty myös serverillä), lukituista popoverissa "Sinulle tästä ikkunasta: X €"
  (vain oma palkkio — ks. rahan yksityisyys `fr8-tyo-logiikka.md`), Ansioissa
  "sis. lisäikkunat (P2)" -erittely (`stats.p2EarnedCents`).

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
