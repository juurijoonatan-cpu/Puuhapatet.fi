# FR8 — järjestelmän yleiskuva (agenttien perehdytys)

> Tämä on **hakemisto ja perehdytys** koko FR8-keikan järjestelmään: mistä osista
> se koostuu, miten raha ja työ liikkuvat, mitkä ovat kriittiset invariantit, ja
> mistä löytyy tarkempi dokumentti. Jos jatkat tätä työtä (ihminen tai agentti),
> **lue tämä ensin.** Päivitä tätä kun rakenne muuttuu.

## Mikä FR8 on

FR8 = Puuhapatet.fi:n lippulaivakeikka: **VANHA TKK, Bulevardi 31**, asiakas
**FR8 FAFO Oy** (yhteyshenkilö Niilo). Ikkunanpesu-urakka, jota hallitaan
karttapohjaisella työkalulla (kerroskartat + pisteet + statukset + attribuutio).

Osapuolet ja pääsy:

| Rooli | Kuka | Näkymä | Reitti |
|---|---|---|---|
| Perustaja / johtaja | Joonatan, Matias | admin-projektinäkymä | `/admin` → keikka → projekti |
| Työntekijä / alihankkija | Jani, Oona, … | oma työpöytä (linkki-avattu) | `/tyo/:token` |
| Asiakas | Niilo / FR8 FAFO Oy | julkinen seuranta (linkki-avattu) | `/seuranta/:token` |

## Arkkitehtuuri

- **Client**: Vite + React + Wouter (reititys) + TanStack Query. `client/src/`.
- **Server**: Express. `server/routes.ts` (iso, kaikki reitit) + `server/*.ts`.
- **DB**: PostgreSQL + Drizzle (`shared/schema.ts`). MUTTA FR8:n keikkatila ei ole
  normalisoituna tauluina vaan **JSON-blobeina**: `jobs.project_data` (ProjectData)
  ja `jobs.gig_data` (GigData). Tämä on tarkoituksellista — koko karttatila
  matkaa yhtenä objektina.
- **`shared/`** on **ainoa totuuden lähde** logiikalle: puhtaat moottorit + tyypit
  + sanitoijat, jotka sekä client että server importtaavat (`@shared/*`). Älä
  duplikoi laskentaa clienttiin tai serveriin — lisää se `shared/`iin ja importtaa.

### `shared/`-moduulit (ydin)

| Moduuli | Vastuu |
|---|---|
| `project.ts` | `ProjectData`, kartta/pisteet (`allPoints`), kiinteä diili (`fixedDealFor`, `computeDealBilling`), erä-attribuutio, sanitointi. |
| `p2.ts` | Priority 2 -moottori: tilakone (`p2Transition`), raha (`computeP2Billing`, `p2WorkerPayoutCents`), `pointPriority`, `isP2Washable`, sanitointi. |
| `guided.ts` | Ohjattu eteneminen: `computeGuided`, `isGuidedBlocked`, sanitointi. |
| `crew.ts` | `CrewMember`, `crewMemberStats` (p2-tietoinen), sessiot, sanitointi. |
| `gig.ts` | `GigData`/`GigSector`/`GigPayment` (`scope?: "p1"|"p2"`), julkisen näkymän totalsit. |
| `era-billing.ts` | Erälaskutuksen (arvomääräiset maksuerät) laskentamoottori. |
| `payprogress.ts`, `tax.ts`, `team.ts`, `trainees.ts`, `billers.ts` | Paydate/verot/tiimi/harjoittelijat/laskuttajat. |

## Ikkunan identiteetti (window key)

Avain on `"<krs>#<index>"` seedatulle merkille tai `"<krs>#c<rand>"` käsin
lisätylle (custom). Sama avain toimii kaikkialla: `statuses`, `washedBy`,
`p2.offers`, observaatiot. Prioriteetti (1 punainen / 2 keltainen) luetaan
**AINA kartasta** (`pointPriority`), ei koskaan clientin lähettämästä `p`:stä.
Status: `"ei" | "kesken" | "pesty"`.

## Kolme rinnakkaista raha-/työjärjestelmää

FR8:ssa on kolme erillistä, tarkoituksella eroteltua järjestelmää. **Älä sekoita
niitä.**

### 1. Priority 1 (punaiset) — kiinteä urakka

Allekirjoitettu **FLAT-TOTAL €6300** (ei count × unit). `fixedDealFor` +
`computeDealBilling` (`project.ts`): kertymä = valmistumis­osuus × kiinteä katto.
4 × 1575 € **erälaskutus** on oma järjestelmänsä (`era-billing.ts`,
`docs/fr8-era-laskutus-plan.md`). Kaikki P1-matikka suodattaa `p === 1`, joten
keltaiset eivät koskaan vaikuta siihen. **Tätä ei muuteta.**

### 2. Priority 2 (keltaiset) — ikkunakohtainen hinnoittelu + neuvottelu

Hinta **per ikkuna**, neuvotellaan asiakkaan kanssa seurantalinkissä (proposed →
accept/counter → locked). Asiakkaan summa kasvaa lukituista hinnoista. Tekijän
palkkio = %-osuus ikkunan lukitusta hinnasta. **Täysi speksi:
`docs/fr8-p2-hinnoittelu.md`.**

### 3. Ohjattu eteneminen (guided) — työjärjestys, ei raha

Opt-in per keikka (oletus pois): yks kerros kerrallaa, muut lukossa, dashboard
ohjaa seuraavaan ikkunaan. Ei rahaa — pelkkä reiluuttava työjärjestys. **Täysi
speksi: `docs/fr8-ohjattu-eteneminen.md`.**

Erälaskutus (varsinainen lähetettävä laskutus) on neljäs, erillinen järjestelmä:
`docs/fr8-era-laskutus-plan.md`. Ansio-/työaikamalli (dashboard-arviot):
`docs/fr8-tyo-logiikka.md`.

## Reittikartta (server/routes.ts)

**Admin** (`/api/jobs/:id/*`, admin-auth):
- `GET|PATCH /project` — karttablobin luku/tallennus. Vastaus sisältää `totals`,
  `workerStats`, `p2Billing`, `guidedState`.
- `POST /p2/phase | propose | respond` — P2-vaihe/hinnoittelu/neuvottelu.
- `POST /guided` — ohjatun etenemisen kytkin + kerroksen ohitus.
- `POST /gig/invoice` (`scope:"p1"|"p2"`), era-laskutus­reitit, `/gig/report` ym.

**Asiakas** (`/api/gig/:token/*`, quoteToken-avattu, PUBLIC_API-whitelistissä):
- `GET /api/gig/:token` — julkinen näkymä; `p2` mukana vain kun `p2.enabled`.
- `POST /p2/terms | accept | counter | decline | add-point | remove-point` —
  rate-limit 60/min/IP, vaatii vaiheen + allekirjoituksen + termsin.

**Työntekijä** (`/api/crew/:token/*`, crewToken-avattu):
- `GET /api/crew/:token` — `workerView` (kartta + omat tiedot, EI keikan hintaa;
  `p2` = vain omat palkkiot; `guided` = ohjaustila).
- `POST /window` — merkintä; **kaksi pesuporttia** (P2-lukko + guided-kerroslukko),
  prioriteetti kartasta.
- `POST /shift | hours | note | map-note | window-observation | expense | …`.

## Kolme näkymää (client)

- **Admin**: `pages/admin/project.tsx` (sivukehys, autosave, callbackit) +
  `components/fr8/Dashboard.tsx` (yleiskatsaus + TEKIJÄT + P2AdminPanel +
  GuidedAdminPanel) + `components/fr8/FloorView.tsx` (kartta, jaettu komponentti).
- **Asiakas**: `pages/gig-live.tsx` + `components/CustomerFloorMap.tsx`
  (interaktiivinen VAIN P2-pisteille kun vaihe päällä).
- **Työntekijä**: `pages/worker.tsx` (intro/sopimukset/kartta/ansiot/tunnit) +
  jaettu `FloorView` (`hideMoney`, `canEdit=false`).

`FloorView` on jaettu admin/tekijä välillä; propsit `canEdit`/`hideMoney`/`p2`/
`guided`/`deal` ohjaavat mitä milläkin näkyy.

## KRIITTISET INVARIANTIT (älä riko)

1. **Rahan yksityisyys**: työntekijä EI näe keikan hintaa/kattoa/liikevaihtoa
   eikä muiden ansioita — vain oman taksansa ja omat euronsa. P2:sta tekijälle
   lähetetään VAIN oma palkkio per lukittu ikkuna (ei asiakashintaa, ei
   `workerSharePct`iä). Älä koskaan välitä `deal`ia tai keikan hintaa tekijän
   komponenteille. (`docs/fr8-tyo-logiikka.md`.)
2. **p2 ja guided ovat serverin omistamia**: geneeriset blob-tallennukset
   (`PATCH /project`, `saveProject`) EIVÄT ota niitä clientiltä — serveri liittää
   talletetun kopion takaisin. Mutaatiot vain dedikoitujen reittien kautta
   (versiotarkistettu read-modify-write). Näin samanaikainen karttamuokkaus ei
   pyyhi asiakkaan hyväksyntää tai ohjausasetusta.
3. **Prioriteetti aina kartasta** (`pointPriority`), ei clientin `p`:stä — muuten
   pesuportin voisi kiertää valehtelemalla prioriteetin.
4. **Hookit ennen early returneja** (React #310): kaikki `useCallback`/`useState`/
   `useEffect` ennen ehdollisia `return`eja komponenteissa. `AdminProjectPage`
   kaatui tähän kerran (PR #367) — applyP2/onP2Propose/onGuidedSet ovat nyt
   ennen `if (loading) …` -returneja.
5. **Valmisteluvaihe (prep)**: `p2.enabled=false` (ja guided pois) = mikään ei
   vaikuta asiakkaaseen/tekijöihin. Perustajat voivat hinnoitella ja liittää
   sopparin ilman että kentällä oleva työ häiriintyy.
6. **prefers-reduced-motion**: kaikki animaatiot kunnioittavat sitä (esim.
   `.fr8-guided-next` on luokka + reduced-motion-guard `index.css`:ssä).
7. **Taaksepäin-yhteensopivuus**: `p2`, `guided`, `eraWindows` ovat valinnaisia
   kenttiä. Ilman niitä vanhat keikat round-trippaavat identtisesti. Ei
   DB-migraatioita näihin.

## Verifiointi

```
npm run check   # tsc. HUOM: 3 ENNESTÄÄN rikkinäistä tiedostoa (lucide/TeamRole),
                # jotka EIVÄT liity tähän työhön: client/src/pages/it.tsx,
                # cv-demo.tsx, admin/welcome.tsx. Muualla pitää olla puhdas.
npm test        # vitest (shared/*.test.ts). Kaikkien pitää mennä läpi.
npm run build   # vite + esbuild. (import.meta-varoitus server/static.ts on vanha.)
```

Repossa EI ole CI:tä — aja nämä käsin ennen PR:ää.

## Sanasto (FI)

- **Punainen / keltainen** = prioriteetti 1 / 2 (P1 / P2).
- **Urakka / kiinteä diili** = P1:n allekirjoitettu €6300 flat-total.
- **Erä (erälaskutus)** = arvomääräinen maksuerä (4 × 1575 €), oma järjestelmä.
- **Lukittu (locked)** = P2-hinta jonka molemmat hyväksyivät — kuuluu työn piiriin.
- **Piirissä (in-scope)** = pestävissä: P1 aina, P2 vain lukittuna.
- **Vaihe / phase** = `p2.enabled` (näkyykö P2-neuvottelu asiakkaalle).
- **Ohjattu eteneminen** = guided (yks kerros kerrallaa).
- **Aktiivinen kerros** = ainoa auki oleva kerros guided-tilassa.
- **Valmistelu (prep)** = kytkin pois; perustajat valmistelevat, muut eivät näe.
- **Attribuutio** = kuka pesi (`washedBy`/`washedBy2`), ajaa ansiot + erät.

## Dokumenttihakemisto

| Dokumentti | Sisältö |
|---|---|
| **`fr8-jarjestelma-yleiskuva.md`** (tämä) | Yleiskuva + invariantit + hakemisto. |
| `fr8-p2-hinnoittelu.md` | Priority 2: hinnoittelu, neuvottelu, sopimus-PDF, raha. |
| `fr8-ohjattu-eteneminen.md` | Ohjattu eteneminen (yks kerros kerrallaa). |
| `fr8-tyo-logiikka.md` | Ansio-, työaika- ja näkymälogiikka + rahan yksityisyys. |
| `fr8-era-laskutus-plan.md` | Erälaskutuksen täysi speksi (maksuerät). |
| `fr8-vero-ja-maksut.md` | Verot & maksut. |
| `talous-kirjanpito.md`, `kirjanpito-sheets-integraatio.md`, `google-drive-backup.md` | Talous/kirjanpito/backup. |
