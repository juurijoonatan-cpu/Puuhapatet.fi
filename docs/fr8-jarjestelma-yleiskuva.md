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
| `project.ts` | `ProjectData`, kartta/pisteet (`allPoints`), kiinteä diili (`fixedDealFor`, `computeDealBilling`, `dealBillableScope`, `dealAgreedTotalCents`), erä-attribuutio, sanitointi. |
| `p2.ts` | Priority 2 -moottori: tilakone (`p2Transition`), raha (`computeP2Billing` — myös `pending*` = pesty mutta hyväksymätön), `p2WorkerPayoutCents` + palkkiotaulukko, `pointPriority`, `isP2Priced`, sanitointi. |
| `guided.ts` | Kerrosten lukitus: `computeGuided` (`activeFloors`), `isGuidedBlocked`, `openFloors`-valinta, sanitointi. Piiri = KAIKKI kartan ikkunat. |
| `crew.ts` | `CrewMember`, `crewMemberStats` (p2-tietoinen), sessiot, sanitointi. |
| `gig.ts` | `GigData`/`GigSector`/`GigPayment` (`scope?: "p1"|"p2"`), julkisen näkymän totalsit. |
| `era-billing.ts` | Erälaskutuksen (arvomääräiset maksuerät) laskentamoottori + keltaisten maksupotti (`P2_ERA_NUMBER`, `ansaittuOverrideCents`). |
| `worker-payouts.ts` | **Tekijöiden maksettava — yksi totuuden lähde.** `computeWorkerSettlements`/`settleWorker` (punaiset vs. keltaiset erikseen), `eraSettlementByWorker`, `p2InvoiceState`. Ks. "Rahan kaksi virtaa" alla. |
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

Allekirjoitettu **37,50 €/punainen ikkuna, katto €6300** (= 168 ikkunaa).
Efektiivinen sopimussumma = `min(6300 €, punaisten määrä × 37,50 €)`
(`dealAgreedTotalCents`): kun punaisia on **vähemmän kuin sovitut 168**, jokainen
poistettu ikkuna vähentää 37,50 € summasta; lisäys ei ylitä kattoa. `computeDealBilling`:
kertymä seuraa tätä efektiivistä summaa. **Erälaskutuksessa vähennys osuu VIIMEISEEN
erään** (erät 1–3 = 1575 €, erä 4 = efektiivinen summa − aiemmat) — `computeEraDebts`
ja laskureitti. 4 × ~1575 € erälaskutus on oma järjestelmänsä (`era-billing.ts`,
`docs/fr8-era-laskutus-plan.md`). Kaikki P1-matikka suodattaa `p === 1`, joten
keltaiset eivät koskaan vaikuta siihen.

### 2. Priority 2 (keltaiset) — ikkunakohtainen hinnoittelu + neuvottelu

Hinta **per ikkuna**, neuvotellaan asiakkaan kanssa seurantalinkissä (proposed →
accept/counter → locked). Asiakkaan summa kasvaa lukituista hinnoista. Tekijän
palkkio = **palkkiotaulukko** (34 €→18, 37,50 €→20, 50 €→27), %-osuus varakäytäntönä.
Laskutus erikseen `scope:"p2"`; dashboard näyttää sovittu/kertynyt/laskutettu/
laskuttamatta. **Täysi speksi: `docs/fr8-p2-hinnoittelu.md`.**

**EI PESUPORTTIA.** Tekijät pesevät kaikki keltaiset riippumatta siitä onko
asiakas hyväksynyt hinnan — hyväksyntä on rahakysymys, ei työkysymys. Hinnan tila
näkyy vain perustajalle (kartalla keltainen = sovittu, **sininen** = odottaa
hyväksyntää) ja rahassa:

| Tila | Asiakkaalta | Tekijälle |
|---|---|---|
| locked | laskutetaan (`earnedCents`) | maksetaan (`p2EarnedCents` → `openP2Cents`) |
| proposed / countered | ei laskuteta (`pendingEarnedCents` = arvio) | ei maksuun (`p2PendingCents` = arvio) |
| ei hintaa | — | — (`unpricedWashedCount`: hinnoittele) |

Tekijän näkymässä kaikki keltaiset ovat keltaisia; hyväksymättömän ikkunan oma
palkkio näkyy merkinnällä "(arvio)".

### 3. Kerrosten lukitus — työjärjestys, ei raha

Perustaja valitsee mitkä kerrokset ovat AUKI (`FloorLockPanel`, dashin alalaita).
**Tavalliset tekijät näkevät kartalla vain avoimet kerrokset** (`restrictFloors`),
muut piilossa; **perustajat ohittavat lukon** ja pesevät minkä tahansa kerroksen.
Ei mitään muuta: ei automaattista etenemistä, ei "seuraava ikkuna" -ohjausta, ei
pakotettuja kerroksia, ei ohjauskorttia tekijän kartalla.

Data on entinen `guided`-kenttä: `enabled` + `openFloors`. UI asettaa aina
`openFloors` eksplisiittisesti, ja kaikkien kerrosten poisto kytkee `enabled:
false` (kartta kokonaan auki) — automaattitilaan ei siis päädytä käyttöliittymästä.
`inScopePoints` sisältää nyt KAIKKI ikkunat (myös hinnoittelemattomat keltaiset).
Vanha speksi: `docs/fr8-ohjattu-eteneminen.md` (historiallinen).

Erälaskutus (varsinainen lähetettävä laskutus) on neljäs, erillinen järjestelmä:
`docs/fr8-era-laskutus-plan.md`. Ansio-/työaikamalli (dashboard-arviot):
`docs/fr8-tyo-logiikka.md`.

## Rahan kaksi virtaa — MITÄ EI SAA SEKOITTAA

Tämä on koko FR8:n herkin kohta. Punaiset ja keltaiset ovat kaksi eri rahaa, jotka
liikkuvat eri aikaan, ja kaikki laskenta erottelee ne. Yksi totuuden lähde:
**`shared/worker-payouts.ts`**.

| | PUNAISET (P1) | KELTAISET (P2) |
|---|---|---|
| Asiakkaalta | 4 arvomääräistä erää (`gig.payments`, `scope !== "p2"`) | erillinen lasku (`scope: "p2"`), ei kuluta erälaskuria |
| Tekijälle | tekijän oma €/ikkuna, maksetaan erämaksuina (`era_invoices`) | palkkiotaulukko, maksetaan **vasta kun asiakas on maksanut keltaisten laskun** |
| Perustajalle | sisäinen kate (`dealInternalRateCents`) + tuotto-osuus | `computeP2Billing().marginCents` |

### Jaetut funktiot (käytä näitä, älä kirjoita kaavaa uudelleen)

| Funktio | Vastaa kysymykseen |
|---|---|
| `computeWorkerSettlements(project, {era})` | paljonko kullekin tekijälle on punaisista vielä siirtämättä (`openP1Cents` / `openP1Windows`) ja paljonko keltaisista odottaa (`openP2Cents`) |
| `settleWorker({stats, payouts, era, p2Enabled})` | sama yhdelle tekijälle, kun kutsujalla on valmiit `crewMemberStats` (Tiimi-sivu) |
| `eraSettlementByWorker` / `eraMapsFor` | mitä erälaskuilla on jo hoidettu (lähetetty/hyväksytty) ja mikä odottaa kuittausta (luonnos) |
| `p2InvoiceState(earnedCents, payments)` | keltaisten laskutettu / laskuttamatta + P1-maksujen määrä samasta suodatuksesta |
| `eraSettlementByWorker(inv, "p1"\|"p2")` | kumman rahavirran maksut luetaan — keltaisen maksu ei kuittaa punaista velkaa |
| `isP2EraSelection(eraNumbers)` | onko tämä maksu keltaisten potti (sentinel-erä `P2_ERA_NUMBER = 0`) |
| `isTraineeMember(member)` | harjoittelija → EI tekijöiden maksulistalla (palkka johtajan kautta) |
| `dealInternalRateCents(data, deal)` | perustajan sisäinen kate €/ikkuna (EFEKTIIVINEN sopimussumma ÷ punaiset) |
| `settleWorker({..., adjustmentCents})` | sovittu vähennys/lisä tekijän punaiseen palkkaan (`p1PayableCents`) |

### Säännöt

1. **Keltainen ikkuna ei koskaan päädy punaisten erämaksuun.** Maksun esitäyttö on
   `openP1Windows` = punaiset pestyt − erälaskuilla katetut. `crewMemberStats`
   ja `computeWorkerStats` antavat `p1Washed`/`p2Washed` erikseen juuri tähän.
2. **Luonnos varaa velan.** Luotu mutta kuittaamaton erälasku vähentää
   maksettavaa, ettei sama maksu synny kahdesti. Server torjuu duplikaatin
   (sama tekijä + sama erä) — ohitus vain `force: true`.
3. **Velan kuittaus käyttää BRUTTO ansiota** (`rivit.computed.ansaittuCents`), ei
   `totalCents`iä (= ansaittu − ennakko), muuten ennakko jättäisi velkaa auki.
4. **Perustajan oma ikkuna ei maksa palkkaa** — `computeEraDebts` raportoi ne
   `founderWindows`ina eikä laske niitä `earnedCents`iin (ne ovat katetta).
5. **Tuntemattoman pesijän fallback on `DEFAULT_WORKER_PER_WINDOW_CENTS`** (20 €)
   kaikkialla. Aiemmin sama tapaus maksoi 37,50 € dashissa, 20 € tuottopotissa ja
   0 € erälaskennassa.
6. **Keltaisten maksu on oma potti** (`P2_ERA_NUMBER = 0` sentinel-eränä
   `eraNumbers`-listassa, ei DB-migraatiota). Sen summa tulee palkkiotaulukosta,
   joten `TekijaPesu.ansaittuOverrideCents` ohittaa `ikkunat × 20 €` -laskennan.
   Punaisten ja keltaisten maksut eivät koskaan kuittaa toisiaan.
7. **Harjoittelija on RAHAN kannalta tavallinen tekijä.** Hänen ikkunansa maksavat
   hänen oman taksansa, ja erotus sisäiseen katteeseen menee tuottopottiin joka
   jaetaan perustajien kesken — täsmälleen kuten Janin ikkunat. **Vastuujohtajan
   luvut eivät sisällä harjoittelijan ikkunoita eikä euroja**: hän ei tehnyt sitä
   työtä eikä pidä sitä rahaa. Harjoittelija näkyy johtajan kortilla erikseen,
   koottuna piiloon ("Vastuullasi 1 harjoittelija · tilitä X €").
   Ero tavalliseen tekijään on vain juridinen: harjoittelija ei laskuta meitä eikä
   ole erämaksulistalla (`isTraineeMember`) — vastuujohtaja tilittää ja kirjaa
   maksun Tiimi-sivulla.
8. **Deaktivoitu tekijä** katoaa dashista ja maksuista, ja palaa Tiimi-sivun
   Aktiivinen-kytkimestä.
9. **Keltaisten kate kuuluu perustajien ansioihin.** `computeP2Billing.marginCents`
   (pestyjen sovittujen keltaisten asiakashinta − tekijöiden palkkiot) jaetaan
   perustajien kesken (`p2MarginCents`). Ilman tätä perustajan kortti näytti
   vähemmän kuin dashin ylälaidan KERTYNYT-luku, joka on aina sisältänyt sen.
10. **Teoreettinen tuotto** = vahvistettu + jo PESTY työ jonka hintaa asiakas ei ole
   vielä hyväksynyt (oma palkkio + osuus katteesta). Omalla rivillään, koska se ei
   ole varmaa rahaa — mutta työ on tehty, joten pelkkä vahvistettu luku ei kerro
   koko kuvaa.
11. **"Siirrettävä" tarkoittaa AINA vain punaisia.** Erän 4 rahoista siirretään
   punaisten palkat; keltaiset odottavat oman laskunsa rahoja ja näkyvät omana,
   pienempänä rivinä (`+ keltaiset X`). Kun nämä summattiin yhteen, johtajan
   näkemä luku ei vastannut sitä mitä pankissa oikeasti siirretään.
12. **Sovittu vähennys/lisä** (`CrewMember.payAdjustmentCents`, etumerkillinen sentti)
   on tapa kuitata pois erotus, josta on tekijän kanssa sovittu (esim. "sovittiin
   että siitä vähennetään 10 €"). Se **ei** muuta ikkunamääriä eikä `p1EarnedCents`iä
   — brutto pysyy näkyvissä ja kirjanpito täsmää — vain
   `p1PayableCents = max(0, p1Earned + adjustment)` ja siitä johdettu `openP1Cents`.
   Kun maksettava menee nollaan, myös `openP1Windows` pakotetaan nollaan, muuten
   maksudialogi esitäyttäisi ikkunoita nollan euron laskulle. Vähennys ei koskaan
   vuoda keltaisiin. Asetetaan Maksut-välilehdellä (`onSetAdjustment`), poistettavissa.
13. **Maksettava ikkunamäärä johdetaan RAHASTA, ei pelkästä ikkunakirjanpidosta.**
   Kaikki maksukanavat eivät kirjaa ikkunoita: käsin kirjattu payout siirtää
   euroja mutta ei ikkunoita, ja erälaskulle voi kirjata ennakon. Silloin
   `payableWindows − invoicedWindows` yliarvioi rajusti. `openP1Windows` on
   `min(ikkunakirjanpito, maksamaton_brutto ÷ €/ikkuna)` — **pienempi voittaa**,
   koska kumpikaan lähde ei saa yksin nostaa maksettavaa. Todellinen tapaus:
   Jani, 34 pestyä (680 € brutto), hoidettu 620 € → jäljellä 60 € = 3 ikkunaa,
   mutta ikkunakirjanpito väitti 22 ja dialogi olisi laskuttanut 440 €.
   Maksudialogi varoittaa lisäksi **euroina** jos rivin loppusumma ylittää
   `openP1Cents`in — pelkkä ikkunavertailu ei olisi tätä pysäyttänyt.

### Missä mikä toiminto asuu (ei duplikaatteja)

| Toiminto | Ainoa paikka |
|---|---|
| Asiakaslaskun lähetys (punaiset erät JA keltaiset) | `admin/gig-tracker.tsx` → **Laskutus**-kortti (punaiset ylhäällä, keltaiset jatkona) |
| Keltaisten tilausehtojen tila + sopimus-PDF | `admin/gig-tracker.tsx` → **Sopimus & asiakasnäkymä** -dropdown |
| Keltaisten hinnoittelu & neuvottelu | mustan dashin `P2AdminPanel` (ei laskun lähetystä) |
| Tekijöiden maksu (erämaksun luonti) | projektinäkymän **Maksut**-välilehti (`MaksutView`) |
| Sovittu vähennys tekijän palkkaan | projektinäkymän **Maksut**-välilehti (Tiimi-sivu vain näyttää sen) |
| Johtaja-välinen ristiinlasku | mustan dashin PERUSTAJIEN ANSIOT → toisen johtajan kortti |
| Rahan tilannekuva | mustan dashin **LASKUTUS & MAKSUT** -statsit + Maksut-välilehti |
| Keltaisten sopimusteksti | keikkanäkymän **Sopimus & asiakasnäkymä** (ei P2-paneelissa) |
| Kerrosten lukitus | mustan dashin **KERROSTEN LUKITUS** (alalaita) |

### Edistymisprosentti

Kun vaihe 2 on päällä, dashin hero-prosentti laskee **punaiset + LUKITUT
keltaiset** (`inScope`) — ei siis näytä 100 % silloin kun sovittuja keltaisia on
pesemättä. Hinnoittelemattomat keltaiset eivät ole piirissä, joten ne eivät voi
jumittaa lukua alas. Punaisten ja keltaisten omat prosentit näkyvät erittelynä
heron sisällä ja PRIORITEETIT-osiossa.

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
  prioriteetti kartasta. **Perustajat (role `host` / `FOUNDER_IDS`) ohittavat
  guided-kerroslukon.** `workerView.guided` sisältää `activeFloors` (kaikki auki).
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
`guided`/`deal`/`restrictFloors` ohjaavat mitä milläkin näkyy. `restrictFloors`
(vain tavallisella tekijällä) piilottaa muut kuin avoimet kerrokset → diskreetti
kartta. Asiakaskartta (`CustomerFloorMap`) on numeroidut pisteet + zoom/pan +
kerroskohtainen lista; hinnat vain listassa, kartan popup on suunnittelua.
Perustajien "uusi luku" -juhla (`FounderCelebration`, project.tsx) laukeaa kerran
kun asiakas on hyväksynyt kaikki keltaiset.

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

## Kartta ja napit

- **Kartalla ei näytetä hintoja.** Sadan pisteen hintakuplat tekivät kartasta
  lukukelvottoman; hinta ja neuvottelutila näkyvät kun pistettä napauttaa.
  Väri kertoo tilan: keltainen = sovittu, sininen = odottaa hyväksyntää.
- **Huomiot (`observations`) näkyvät asiakkaalle myös 2. vaiheen aikana** — sekä
  💬-merkkinä kartalla että hintakuplan sisällä, jos joku on kirjoittanut jotain.
### "Nappia pitää painaa 1 cm yläpuolelta" — kolme mekanismia

Kaikki kolme korjattu; jos oire palaa, tarkista nämä ensin.

1. **Sisääntuloanimaatio jää päälle.** `fr8-fadeUp` on `translateY(12px) → 0` +
   `animation-fill-mode: both`. Ennen animaation alkua (0,05–0,4 s viive) — ja
   pysyvästi jos animaatio ei käynnisty — elementti on 12 px alempana kuin sen
   osumaruutu. Sisäkkäiset animoidut tasot kertyvät ~36 px:ään ≈ 1 cm.
   → Animaatio pois puhelimessa ja reduced-motionilla (`index.css`).
2. **Fixed-kuori + vierittynyt dokumentti.** iOS piirtää `position: fixed`
   visuaalisen viewportin mukaan mutta osumatestaa layout-viewportin mukaan.
   → `html.fr8-lock` lukitsee dokumentin vierityksen niin kauan kuin musta kuori
   on auki (`project.tsx`, `worker.tsx`); vieritys tapahtuu kuoren sisällä.
3. **Kuoren korkeus layout-viewportista.** `inset: 0` antaa selainpalkkien verran
   liian korkean kuoren. → `height: 100dvh` (+ `-webkit-fill-available`-fallback),
   `main` venyy flexillä eikä `calc(100% - 62px)`:llä,
   `-webkit-overflow-scrolling: touch` poistettu (vanha iOS-hack).

Lisäksi fr8-napeille `min-height: 40px` — **mutta vain `[data-fr8-pane]`n sisällä**.
Ilman tuota rajausta sääntö osui myös kartan 9–13 px pyöreisiin pisteisiin ja
venytti ne kapseleiksi; kartan pisteillä on `data-fr8-dot`, joka jättää ne ulos.

## Julkaisu ja "Importing a module script failed"

Frontend on **GitHub Pagesissa** (`.github/workflows/deploy.yml`, joka main-push),
API erillisellä palvelimella (`API_BASE`). Julkaisu **korvaa** `dist/public`in,
joten edellisen buildin hashatut palaset katoavat samalla sekunnilla. Koska
`App.tsx` koodijakaa lähes joka reitin, puhelimessa auki oleva vanha PWA yrittää
seuraavalla reitinvaihdolla importata palasen jota ei enää ole → selain sanoo
*"Importing a module script failed"* ja ErrorBoundary näyttää virhesivun. Jokainen
reitti on oma palasensa, joten virhe toistuu joka näkymässä.

Tämä EI ole sovellusvirhe vaan normaali seuraus julkaisusta. Puolustus on
kerroksittainen — älä poista näitä:

| Kerros | Tiedosto | Tehtävä |
|---|---|---|
| `lazyRetry` | `client/src/lib/stale-build.ts` | uusii kerran 600 ms:n päästä, sitten siivoaa ja lataa |
| globaalit kuuntelijat | `client/src/main.tsx` | `vite:preloadError`, `unhandledrejection`, `error` |
| ErrorBoundary | `client/src/App.tsx` | näyttää "Päivitetään…" eikä virhettä; nollautuu reitinvaihdossa |
| splash-vahti | `client/index.html` | jos React ei mounttaa 6 s:ssa → korjausnappi (ei valkoista sivua) |
| service worker | `client/public/sw.js` | ei tallenna HTML:ää `.js`:n paikalle; navigoinnit aina verkosta |
| SPA-fallback | `server/static.ts` | puuttuva `/assets/*.js` → **404**, ei index.html 200:lla |

Säännöt:

1. **Älä lisää query-parametria uudelleenlataukseen.** GitHub Pagesin SPA-kierrätys
   (`public/404.html` → `/?p=…`) ajetaan joka syvälle osoitteelle; ylimääräinen
   parametri palasi ennen osaksi polkua ja rikkoi reitin. Tuoreus haetaan
   `fetch(url, {cache:"reload"})`illa ennen `location.reload()`ia.
2. **Luuppisuoja on aikaperustainen** (30 s), ei kertalukko. Kertalukko jätti
   saman välilehden toisen julkaisun jälkeen taas raa'an virhesivun ääreen.
3. **Palvelin ei koskaan vastaa staattisen tiedoston pyyntöön HTML:llä.** Se oli
   ainoa reitti jolla service worker saattoi tallentaa HTML:n JS:n nimellä ja
   myrkyttää välimuistin pysyvästi.
4. **`localStorage` aina try/catchiin** juurikomponenteissa (`theme.tsx`,
   `i18n.tsx`): Safarin privaattitilassa se heittää, ja käsittelemätön poikkeus
   sovelluksen juuressa kaataa koko sivun.
5. **Admin-UI:ssa ei `window.prompt`ia** — asennetussa iOS-PWA:ssa se on
   epäluotettava, ja nappi näyttää siltä ettei se tee mitään. Käytä sivun sisäistä
   lomaketta (esim. `AdjustmentControl` MaksutView'ssä).
6. **Tiedostolinkit API:iin täydellä osoitteella** (`${API_BASE}/api/…`):
   juurisuhteellinen `/api/…` osoittaa GitHub Pagesiin, joka vastaa 404:llä.

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
- **Urakka / kiinteä diili** = P1: 37,50 €/ikkuna, katto €6300 (poisto scopen alle vähentää).
- **Erä (erälaskutus)** = arvomääräinen maksuerä (4 × ~1575 €, viimeinen imee vähennyksen), oma järjestelmä.
- **Avoin kerros** = guided-tilassa pestävissä oleva kerros; tavallinen tekijä näkee vain avoimet.
- **Lukittu (locked)** = P2-hinta jonka molemmat hyväksyivät — kuuluu työn piiriin.
- **Piirissä (in-scope)** = pestävissä: P1 aina, P2 vain lukittuna.
- **Vaihe / phase** = `p2.enabled` (näkyykö P2-neuvottelu asiakkaalle).
- **Ohjattu eteneminen** = guided (yks kerros kerrallaa).
- **Aktiivinen kerros** = tekijän ohjauskerros; `activeFloors` = kaikki avoimet.
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
