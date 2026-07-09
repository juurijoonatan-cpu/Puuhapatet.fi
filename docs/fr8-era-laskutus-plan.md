# FR8-laskutus — alkuperäinen speksi + toteutuksen seuranta

> Tämä tiedosto on **pysyvä varmuuskopio** käyttäjän alkuperäisestä tehtävänannosta
> ja sen 5-vaiheisesta toteutussuunnitelmasta. Tarkoitus: jos toteuttava
> agentti/sessio loppuu kesken (esim. loppuu credit), toinen agentti/tili voi
> jatkaa työtä tästä tiedostosta 100%:sti kontekstin säilyessä — ei tarvitse
> arvailla mitä alun perin pyydettiin.
>
> **Prosessi (koskee kaikkia vaiheita):** jokainen vaihe tehdään kokonaan
> valmiiksi (koodi + testit/verifiointi + commit + push), sen jälkeen
> raportoidaan tila käyttäjälle ja **odotetaan nimenomaista lupaa** ennen
> seuraavaan vaiheeseen siirtymistä. Ei koskaan aloiteta seuraavaa vaihetta
> ilman lupaa.

## Tilanne / seuranta

| Vaihe | Kuvaus | Tila |
|---|---|---|
| 0 | Speksi + suunnitelma talteen, PR auki | ☑ tehty |
| 1 | Datamalli + puhdas laskentamoottori + yksikkötesti (kohdat 2, 5, 7) | ☑ tehty — ks. alla |
| 2 | Johtajan näkymät: laskun luonti ja lähetys (kohdat 3A, 3C) | ☑ tehty — ks. alla |
| 3 | Vastaanottajan näkymät + kokonaistilanne-sivu (kohdat 3B, 3D) | ☑ tehty — ks. alla |
| 4 | Lailliset vaatimukset: lukitus, laskumerkinnät, PDF, sähköposti (kohta 4) | ☑ tehty — ks. alla |
| 5 | Bugikorjaus (kohta 6.1) + kokonaisvaltainen validointi (kohta 6) | ☑ tehty — ks. alla |

Yksityiskohtainen tekninen suunnitelma (mitä tiedostoja koskettaa, mitä
olemassa olevaa koodia hyödynnetään, poistumiskriteerit per vaihe) on kirjoitettu
Claude Code -ajon suunnitelmatiedostoon toteutuksen alussa; tiivistelmä
alla olevan speksin jälkeen ei ole tarpeen toistaa täällä — **tämä tiedosto on
ensisijaisesti alkuperäisen speksin sana sanalta -tallennus**, jota vasten
toteutusta verrataan. Päivitä yllä oleva taulukko jokaisen vaiheen jälkeen.

### Vaihe 1 — valmis (commit `27fc018`)

- `shared/era-billing.ts`: `computeEraBilling()` toteuttaa spekin kohdan 2
  kaavat 1–8 täsmälleen (sentteinä, x pyöristetty 2 desimaaliin, kate
  jäännöksenä, 50/50-jako niin että pariton sentti ei riko täsmäytystä).
  `sumWindows()` on tarkka (ei rivikohtaista pyöristystä) — tämä otetaan
  käyttöön myös kohdan 6.1 bugikorjaukseen vaiheessa 5.
- `shared/schema.ts`: uudet Drizzle-taulut `era_invoices` (lasku, ks. kohta 5)
  ja `era_invoice_emails` (sähköposti_loki). **Additiivinen migraatio** (ei
  koske olemassa olevia tauluja).
- `shared/era-billing.test.ts` (vitest, uusi devDependency): toistaa kohdan 7
  testitapauksen täsmälleen (x=37,20; tekijät 1800,00; Jani 240,00; J
  502,20/1257,90; M 911,40/1667,10; kate 1511,40; tarkistus 4725,00 ero 0;
  ikkunat 127) + reunatapaukset (desimaali-ikkunoiden summaus, nolla ikkunaa,
  negatiivinen sovittu muutos, pariton kate-senttimäärä).
- **`npm run check`** ja **`npm run test`**: molemmat vihreät; typecheck-diffi
  ajon aikaiseen baseline-tilaan on identtinen (ei uusia virheitä — 6
  esiolemassaolevaa, tähän työhön liittymätöntä virhettä muissa tiedostoissa
  ennallaan).
- **HUOM jatkajalle:** `npm run db:push` EI ole ajettu oikeaa kantaa vastaan —
  uudet taulut on vain määritelty skeemassa. Tämä pitää ajaa (tai migraatio
  ajaa muuten) ennen kuin vaiheen 2 backend-reitit voivat toimia oikeasti;
  kysy/vahvista tämä käyttäjältä ennen ajoa jos et ole varma ympäristöstä.

### Vaihe 2 — valmis (commit `d4a8abc`)

- **Reititys-avoin-kysymys ratkaistu käyttäjän kanssa:** erävalinta on VAPAA
  (ei sidottu klikattuun riviin); vastaanottaja määräytyy AINA erän numerosta.
  Itsensälaskutus estetään sekä UI:ssa (dialogi tarjoaa vain sen yhden eränsä
  joka johtaa toiseen johtajaan) että serverillä (nimenomainen tarkistus).
- `server/routes.ts`: `POST /api/jobs/:id/era-invoice/worker-batch` (johtaja →
  tekijä, jää "luonnos"-tilaan odottamaan tekijän hyväksyntää vaiheessa 3),
  `POST /api/jobs/:id/era-invoice/founder` (johtaja → johtaja, lukitaan heti),
  `GET /api/jobs/:id/era-invoices`. Johtaja-välinen lasku laskee tekijöiden
  ansaitun summan automaattisesti jo luoduista tekijä-laskuista (EI uudelleen
  käsin syötettynä) ja päättelee vastaanottajan omat pesut jäännöksenä
  (kokonaisikkunat − tekijät − lähettäjän omat) — ks. koodikommentit reitissä.
- `shared/era-billing.ts`: `normalizeEraNumbers()` (vain [1,2,3] tai [4]
  kelpaavat), `eraRecipientFounderId()`, `EraInvoiceKind`/`EraInvoiceTila`-
  tyypit. 4 uutta testiä (yhteensä 19/19 vihreää).
- Frontend: `WorkerEraInvoiceDialog.tsx` (johtajan "Maksu"-painike FR8-
  dashboardin nurkassa, project.tsx), `FounderEraInvoiceDialog.tsx` ("Maksut"-
  painike vain toisen johtajan rivillä, crew.tsx) — molemmissa elävä
  esikatselu `computeEraBilling()`-funktiolla ennen lähetystä.
- `npm run check` + `npm run test`: molemmat vihreät, ei uusia typecheck-
  virheitä.
- **HUOM jatkajalle:** täysi selainpohjainen E2E-testaus on YHÄ estynyt samasta
  syystä kuin vaiheessa 1 — `era_invoices`-taulua ei ole vielä oikeassa
  kannassa. Kysyin käyttäjältä lupaa ajaa `db:push` (additiivinen, ei koske
  olemassa olevia tauluja) jotta vaiheen 2 ja 3 selainverifiointi olisi
  mahdollista — ks. vastaus keskustelussa / seuraava commit.

### Vaihe 3 — valmis

- **Kohta 3B (tekijän näkymä):** `server/routes.ts` uudet reitit
  `POST /api/crew/:token/era-invoice/:invoiceId/send` ja `.../reject`
  (lisätty PUBLIC_API-allowlistiin — tekijän tunnistus on polun token, kuten
  muissakin crew-reiteissä). "Send" siirtää laskun `luonnos → hyväksytty`,
  lukitsee sen (`sentAt`), antaa juoksevan laskunumeron (esim. `JAN-0001`,
  count per laskuttaja) ja viitenumeron (`finnishRefWithCheckDigit(2_000_000 +
  laskun id)` — id-pohjainen, joten ei voi törmätä johtajareitin viitteisiin).
  "Reject" siirtää `luonnos → hylätty` (lopullinen; johtaja voi luoda uuden,
  kohta 3B.4). Molemmat toimivat TASAN kerran: siirtymä sallitaan vain
  luonnoksesta (`eraInvoiceRespondTransition`, shared/era-billing.ts) JA
  UPDATE on ehdollinen `tila='luonnos'`-riviin → kilpailevista pyynnöistä vain
  ensimmäinen voittaa, muut saavat 409. Vieras/väärä lasku → aina 404.
  Harjoittelija ei voi lähettää (sama sääntö kuin payout-hyväksynnässä).
- `workerView()` muutettiin async-muotoon ja se palauttaa nyt `eraInvoices`-
  kentän (VAIN tekijän omat rivit, suodatus `senderId`). **Defensiivinen
  try/catch:** jos `era_invoices`-taulua ei ole vielä kannassa (db:push
  ajamatta), tekijän dashboard EI kaadu — lista on tyhjä. Tämän ansiosta tämä
  koodi voidaan deployata ennen migraatiota turvallisesti.
- Tekijän UI: `client/src/pages/worker.tsx` → `EraInvoiceSection` Maksut-
  alanäkymän kärkeen: erittely (ikkunat × 20 € ± sovittu muutos − ennakko),
  "Lähetä lasku" + "Hylkää" kaksivaiheisella vahvistuksella; lähetyksen
  jälkeen lukittu kortti laskunumeroineen, painikkeet poissa. Kotinäkymän
  "maksua hyväksyttävänä" -laskuri sisältää nyt myös erälaskuluonnokset.
- **Kohta 3D (Maksut-kokonaistilanne):** uusi `maksut`-välilehti FR8-
  projektinäkymään (`Navbar.tsx` `showMaksutTab`, vain johtajille) →
  `client/src/components/fr8/MaksutView.tsx`: yhteenvetotiilet + kolme
  osiota spekin mukaan (johtajien väliset laskut erittelyineen ja
  sähköpostikopio-tiloineen; kaikki tekijöille lähetetyt maksut tilachipein;
  tekijöiden kuittaamat laskunumeroineen). `GET /api/jobs/:id/era-invoices`
  palauttaa nyt myös `emails`-lokin per lasku (rivit syntyvät vaiheessa 4 —
  UI näyttää siihen asti "ei kopioita vielä") ja on rajattu johtajille
  (`role === "host" || FOUNDER_IDS`) — koko keikan listaus sisältää kaikkien
  tekijöiden maksut, joten staff-token saa 403.
- **Vaiheen 2 virhe löydetty ja korjattu:** FounderEraInvoiceDialog oli
  kiinnitetty crew.tsx:n host-riveille, mutta `/api/jobs/:id/crew` suodattaa
  host-jäsenet pois → painike ei voinut KOSKAAN renderöityä (kuollutta
  koodia; vaihe 2 ei voinut huomata tätä koska selain-E2E oli estynyt).
  Siirretty projektinäkymän "Perustajien ansiot" -kortteihin
  (`Dashboard.founderInvoiceSlot`, project.tsx) — spekin 3C.1 mukaisesti
  painike on vain TOISEN johtajan kortilla, ei koskaan omalla (kriteeri 6.5).
- Testit: 25/25 vihreää (6 uutta: tilasiirtymät + 3D-ryhmittely).
  `npm run check`: sama 6 esiolemassaolevan virheen baseline, ei uusia.
- **Täysi E2E-verifiointi TEHTY paikallista kertakäyttö-Postgresia vasten**
  (kontissa pystytetty PG16 + `npm run db:push` + siemendata): 33 API-tason
  tarkistusta ja 33 selaintarkistusta (Playwright) vihreinä — mm. kohdan 7
  luvut täsmälleen selaimen esikatselussa ja tallennetussa laskussa (x 37,20;
  kate 1511,40; M loppusumma 1667,10; ero 0), kertakäyttölukitus (409),
  vieras lasku (404), itsensälaskutus (400), staff-rajaus (403), Maksut-
  välilehti piilossa ei-johtajalta. `db:push` todettiin additiiviseksi
  puhtaaseen kantaan — **tuotannon kantaan sitä EI edelleenkään ole ajettu**
  (tässä ympäristössä ei ole tuotanto-DATABASE_URLia); aja se deployn
  yhteydessä, koodi on turvallinen kummassakin järjestyksessä.
- **HUOM jatkajalle:** (1) Milja on kovakoodattu harjoittelijaksi
  (`shared/trainees.ts`) → hän ei näy Maksu-dialogissa eikä voi lähettää
  laskua — spekin kohdan 7 testitapaus Miljan riveillä toimii silti
  serverissä/testeissä. Jos Miljan pitää oikeasti laskuttaa, harjoittelija-
  status pitää purkaa erikseen. (2) ~~Johtajareitin viitenumerokaava voi
  törmätä~~ **korjattu, ks. alla.** (3) Kirjautumisen ensimmäinen
  oletussalasanakirjautuminen luo users-rivin roolilla "staff" myös
  johtajille — kaikki johtaja-rajaukset käyttävät siksi
  `role === "host" || FOUNDER_IDS.includes(sub)` -muotoa.

### Vaihe 3 — adversariaalinen katselmointi + korjaukset (commit `51a6744`)

Ennen vaiheeseen 4 siirtymistä ajettiin 5-kulmainen adversariaalinen
koodikatselmointi (`/code-review --effort high`) merge-committiin `3314768`,
ristiin-vahvistettuna suoralla koodin lukemisella. Löydöt ja korjaukset:

- **Korjattu — laskunumeroinnin race-condition (raha-tarkkuusvirhe):**
  `count(*)`-sitten-kirjoita -kaava ei ollut atominen: sama tekijä/johtaja
  saattoi lähettää kaksi eri laskua lähes yhtäaikaa (esim. erä 1-3 ja erä 4)
  ja saada molemmille saman juoksevan numeron. **4/5 katselmointikulmaa
  löysi tämän itsenäisesti.** Korjattu `withNextInvoiceNumber()`-funktiolla
  (`server/routes.ts`), joka sarjoittaa saman lähettäjän numeroinnin Postgresin
  `pg_advisory_xact_lock`-lukolla transaktion sisällä.
- **Korjattu — viitenumerotörmäys johtajien välillä:** vanha kaava
  (`1_000_000 + jobId*100 + seq`) ei sisältänyt lähettäjän tunnistetta, joten
  Joonatanin ja Matiaksen ensimmäinen ristiinlasku samalla keikalla saivat
  saman viitteen. Molemmat laskutyypit käyttävät nyt yhtenäistä,
  törmäysvapaata kaavaa `1_000_000 + laskun_id` (id on globaalisti uniikki).
- **Korjattu — onnistunut lähetys saattoi raportoitua virheenä:**
  `respondToEraInvoice` rakensi vastauksen `workerView()`-kutsulla SAMAN
  try/catchin sisällä kuin varsinaisen tilamuutoksen — jos näkymän
  uudelleenrakennus epäonnistui mistä tahansa siihen liittymättömästä syystä,
  koko pyyntö palautti 500:n vaikka lasku oli jo lukittu ja numeroitu.
  Eristetty omaan try/catchiin; asiakas käsittelee nyt myös tapauksen jossa
  `invoice` palautuu mutta `view` puuttuu (worker.tsx päivittää rivin
  paikallisesti sen sijaan että näyttäisi virheen onnistuneelle toiminnolle).
- **Korjattu — migraatiovarmuuden epäsymmetria:** `GET
  /api/jobs/:id/era-invoices` puuttui sama "taulua ei ole vielä" -suoja kuin
  `workerView()`:ssä → Maksut-sivu olisi 500:annut ennen `db:push`-ajoa.
  Molemmat käyttävät nyt `isMissingTableError()`-tarkistusta (Postgres 42P01)
  joka erottaa "taulu puuttuu" (turvallinen) muista virheistä (nyt lokittuvat).
- **Korjattu — harjoittelija näki toimimattoman "Lähetä lasku" -napin:**
  `EraInvoiceSection` piilottaa nyt lähetyspainikkeen (tarjoaa vain Hylkää)
  jos `view.worker.trainee` on asetettu, koska serveri hylkää sen aina 400:lla.
- **Korjattu — kaksi eri johtajanimi-toteutusta:** `worker.tsx` haki nimet
  kovakoodatusta id-mäpistä; nyt käyttää samaa `BRAND_BILLERS`-lähdettä kuin
  `MaksutView.tsx`.
- **Korjattu — Maksut-välilehden client-side portti epäjohdonmukainen:**
  `project.tsx` käytti pelkkää `FOUNDER_IDS`-tarkistusta kun palvelin ja
  muut portit samassa diffissä käyttivät `role==='host'||FOUNDER_IDS`-mallia.
  Yhtenäistetty.
- **Tunnistettu, EI korjattu (dokumentoitu, matala prioriteetti):**
  3-kirjaiminen laskunumeroprefiksi (`id.slice(0,3)`) voi periaatteessa
  törmätä kahden samalla alulla alkavan tekijä-id:n välillä (esim.
  "milja"/"milla") — kosmeettinen, ei vaikuta laskun juoksevan numeron
  yksilöllisyyteen per lähettäjä, vain visuaaliseen prefiksiin.
  `founderInvoiceSlot` (project.tsx) renderöityy vain jos johtaja on jo
  kyseisen keikan `project.crew`-taulukossa — ei voitu vahvistaa/korjata
  ilman pääsyä oikeaan tuotantokantaan, jossa FR8:n crew-data jo on.
- `npm run check`: sama 6 esiolemassaolevan virheen baseline. `npm run test`:
  25/25 vihreää. Transaktio/advisory-lock-muutoksia ei ole voitu ajaa
  tietokantaa vasten tässä ympäristössä (db:push tuotantoon yhä ajamatta) —
  varmistettu suoralla koodikatselmoinnilla, ei integraatiotestillä.

### Vaihe 4 — valmis (commit `9e59019`)

- **PDF (kohta 4):** uusi `generateEraInvoicePdf()` (server/routes.ts) kattaa
  molemmat laskutyypit ja sisältää kaikki pakolliset kentät: päiväys,
  juokseva laskunumero, myyjän+ostajan nimi ja Y-tunnus, suoritteen kuvaus
  ("Ikkunanpesu, N ikkunaa — Erä X"), veloitusperuste/summa, eräpäivä,
  viitenumero, ALV-merkintä. `buildEraInvoicePdfParams()` kokoaa kentät
  tallennetusta, lukitusta rivistä. **Kaksi tulkintapäätöstä, jotka
  kirjanpitäjän pitää vahvistaa** (sama huomautus kuin spekissä):
  1. Eräpäivä = 14 vrk laskun lähetyksestä — spekissä ei annettu maksuehtoa,
     tämä on suomalainen yleiskäytäntö-oletus.
  2. Tekijä-laskuille lasketaan sama ALV+ennakonpidätys-erittely kuin
     tavallisille alihankkijan laskuille (`shared/tax.ts`, sama kuin
     olemassa oleva payout-järjestelmä) — **KOKO** ansaitusta summasta, ei
     vain "maksettava nyt" -jäännöksestä; jo maksettu ennakko vähennetään
     vasta verolaskennan jälkeen omana rivinään (muuten ennakko jäisi
     kokonaan verottamatta). Johtaja-välisille laskuille EI lasketa
     ennakonpidätystä (ei työkorvausta ennakkoperintälain mielessä) — vain
     ALV-vapaa-merkintä.
- PDF-lataus: `GET /api/jobs/:id/era-invoice/:invoiceId/pdf` (johtajille) ja
  `GET /api/crew/:token/era-invoice/:invoiceId/pdf` (tekijän oma). Regeneroitu
  aina deterministisesti tallennetusta rivistä — ei erillistä
  tiedostotallennusta (kohdan 4 "säilytys"-vaatimus täyttyy DB-tietueella).
- **Sähköposti (kohta 3C.4 + 4):** `sendEraInvoiceEmail()` liipaisee heti kun
  lasku lukittuu (sekä johtaja-välinen luonti että tekijän "Lähetä lasku"),
  PDF liitteenä, lokitetaan `era_invoice_emails`-tauluun. Vastaanottajat
  koottu OLEMASSA OLEVISTA vakioista `WORKER_NOTIFICATION_EMAILS` +
  `INVOICE_BCC_EMAILS` — jälkimmäinen on jo valmiiksi `["matiaspit88@gmail.com"]`
  — täsmää spekin kohdan 3C.4 vaatimukseen ilman uutta konfiguraatiota.
  Best-effort, ei koskaan kaada pyyntöä.
- **Muuttumattomuus (kohta 4):** todennettu, ei vain oletettu — jokainen
  `db.update`/`db.delete`-kutsu `era_invoices`-tauluun grepattiin läpi.
  Löytyi täsmälleen ne 4 kutsua jotka kuuluvat kahteen jo vaiheissa 2-3
  rakennettuun lukitusvaihtoon (molemmat `WHERE tila='luonnos'` -ehdollisia).
  Ei yhtään reittiä joka voisi muokata lukittua riviä — korjaus vaatii aina
  uuden rivin (append-only täyttyy rakenteellisesti, ei tarvinnut lisätä
  erillistä estoa).
- Tekijän oma näkymä (`worker.tsx`): erittely näyttää nyt saman ALV/
  ennakonpidätys-laskelman kuin PDF (aiemmin näytti verottoman
  `maksettavaCents`-luvun sellaisenaan, mikä olisi poikennut PDF:n
  lopullisesta summasta) + "Lataa lasku (PDF)" -linkki lukitulle laskulle.
  `MaksutView.tsx`: "Lataa PDF" -painike jokaiselle johtaja-väliselle ja
  hyväksytylle tekijä-laskulle.
- `npm run check`: sama 6 virheen baseline. `npm run test`: 25/25 vihreää.
  **PDF/sähköposti/transaktiokoodia ei ole ajettu oikeaa tietokantaa/Resend-
  avainta vasten tässä ympäristössä** — varmistettu koodikatselmoinnilla.
  Kun db:push on ajettu, testaa käytännössä: lähetä testilasku → PDF avautuu
  → sähköposti saapuu (tai lokittuu best-effort jos RESEND_API_KEY puuttuu)
  → yritä muokata lukittua riviä suoraan kannasta ja vahvista ettei mikään
  reitti tarjoa tähän tapaa.

**Sivuhuomio Vaihe 4:sta:** käyttäjä (Matias) vahvisti erikseen, että EI
Puuhapatet (Joonatan/Matias) EIKÄ mikään FR8-tekijä ole ALV-rekisterissä —
`vatStatus` pakotettu `"vahainen_toiminta"`-arvoon era-laskujen PDF:ssä ja
tekijän omassa näkymässä (commit `a5493d7`), ei enää luettu tekijän
`profile.answers`-itseilmoituksesta kuten tavallisessa alihankkijan payout-
järjestelmässä. Ennakonpidätys on eri asia ja luetaan edelleen normaalisti.

### Vaihe 5 — valmis (commit `a89f4b5`)

- **Kohta 6.1 (ikkunamäärän off-by-one) — tutkittu perusteellisesti, ei
  löytynyt aktiivista bugia:** kaksi riippumatonta läpikäyntiä (oma +
  alitehtävän agentti) kävivät läpi `computeWorkerStats`, `computeProjectTotals`,
  `computeEraDebts`, `Dashboard.tsx`, `crew.tsx` ja `project.tsx` — ei
  löytynyt rivikohtaista pyöristystä ennen summausta missään. Todennäköinen
  selitys: sukulaisbugi (kiinteä sopimusikkunamäärä `capCents/pricePerWindow`
  näytettynä elävän punaisten pisteiden määrän sijaan) on JO korjattu
  aiemmalla, jo mergatulla commitilla — sama korjaus jota vanha, mergaamaton
  PR #273 yritti tehdä, mutta PR #273 on nyt vanhentunut/redundantti.
  `Dashboard.tsx`:n "SOPIMUSIKKUNAT"-luku (`heroWashed`/`heroTotal`) tulee jo
  `grp(deal.billablePriority)`:sta — sama pisteiden laskenta sekä osoittajalle
  että nimittäjälle, ei voi rakenteellisesti heittää.
- **Toteutettu korjauksen sijaan: elävä täsmäytystarkistus** (koska
  kaavat olivat jo oikein, mutta "korjaa ja lisää regressiotesti" -pyyntö
  ansaitsi silti konkreettisen vastineen): `shared/project.ts` →
  `checkWindowAttribution()` vertaa tarkkaa pesty-pisteiden määrää tarkkaan
  `computeWorkerStats().washed`-summaan (ilman pyöristystä). Paljastaisi
  KUMMAN TAHANSA syyn — rivikohtaisen pyöristyksen TAI puuttuvan attribuution
  (pesty ikkuna ilman `washedBy`:tä, joka putoaa pois jokaisesta per-tekijä-
  summasta mutta lasketaan silti piste-kokonaismäärään). `shared/project.test.ts`
  (uusi): täsmäävä tapaus (sis. 6 jaetun ikkunan 13,5/24,5-tyyppinen fixture)
  + regressiotesti puuttuvalle attribuutiolle. `Dashboard.tsx`: tarkistus
  ajetaan elävästi, näyttää hienovaraisen varoituksen johtajille jos joskus
  heittää — ei vain yksikkötesti.
- **Kohta 6 muut kriteerit — uudelleenvarmistettu suoraan koodista** (ei vain
  aiempaa väitettä toistettu): x-pyöristys+jäännöskate+täsmäytys S:ään
  (Vaihe 1 testit, koskematon); kertakäyttölukitus (Vaihe 3, atominen
  ehdollinen UPDATE); rajaton uudelleenlähetys — `worker-batch`-reitti
  luettu uudelleen, vahvistettu ettei mitään uniikkiusrajoitusta ole;
  johtaja ei näe omaa Maksut-painiketta (`founderInvoiceSlot`-suoja);
  erä-reititys + molemmat sähköpostikopiot (Vaihe 2/4); lukitun laskun
  muuttumattomuus (Vaihe 4:n grep-audit jokaisesta `eraInvoices`-kirjoituksesta).
- **Vanhan `EraKateDialog`/`FounderSettlementView`-UI:n kohtalo päätetty:**
  jätetty paikalleen (poistaminen ei ollut pyydetty eikä toimivan koodin
  poistaminen ilman pyyntöä ole hyvä oletus), mutta lisätty selkeä huomautus
  dialogin yläreunaan: se on karkea pesujärjestykseen perustuva ennakkoarvio,
  EI enää totuuden lähde varsinaiselle laskutukselle — viralliset laskut
  lähetetään uudesta järjestelmästä ja näkyvät "Maksut"-välilehdellä.
- `docs/fr8-tyo-logiikka.md` ja `docs/fr8-vero-ja-maksut.md` päivitetty
  viittaamaan uuteen erälaskutusjärjestelmään ja dokumentoimaan ALV-säännön.
- **HUOM ympäristöstä:** tämän vaiheen aikana Bash-työkalun turvaluokittelija
  oli pidemmän aikaa poissa käytöstä (ei vaikuttanut lukuoperaatioihin, vain
  kirjoitus/suoritustoimintoihin kuten commit/npm run) — kaikki muutokset
  tehtiin ja tarkistettiin manuaalisesti koodia lukemalla ennen kuin commit
  onnistui. Kun se onnistui: `npm run check` täsmälleen sama 6 virheen
  baseline; `npm run test` **28/28 vihreää** (25 aiempaa + 3 uutta).
- **Kaikki 5 vaihetta valmiit.** PR #357 valmis käyttäjän katselmoitavaksi ja
  merge-päätökseen. `npm run db:push` on yhä ajamatta oikeaa tietokantaa
  vastaan — tämä on viimeinen askel ennen tuotantokäyttöä.

### Jälkikäteinen lisäys: eräpäivä aina johtajan valittavissa (2026-07-09)

- Käyttäjän pyynnöstä: eräpäivä ei ole enää kiinteä 14 vrk lähetyshetkestä,
  vaan johtaja **valitsee sen aina itse** laskua lähettäessä (oletusehdotus
  yhä +14 vrk, mutta täysin muokattavissa) — sekä tekijä-maksuille
  (`WorkerEraInvoiceDialog.tsx`) että johtaja-välisille laskuille
  (`FounderEraInvoiceDialog.tsx`).
- `shared/schema.ts`: `eraInvoices.dueDate` (text, `YYYY-MM-DD`, nullable —
  vanhat rivit ilman arvoa käyttävät yhä 14 vrk -laskentaa fallbackina).
  `server/routes.ts`: `normalizeDueDate()` validoi/parsii syötteen; molemmat
  luontireitit (`worker-batch`, `founder`) tallentavat sen; `buildEraInvoicePdfParams`
  käyttää tallennettua arvoa PDF:n eräpäivänä kun se on asetettu.
  `client/src/lib/api.ts`: `dueDate?: string` molempiin lähetysfunktioihin +
  `EraInvoiceClient.dueDate`.
- Verifioitu: `npm run check` sama 6 virheen baseline (ei uusia), `npm run test`
  28/28 vihreää (tämä muutos ei koske testattua puhdasta laskentalogiikkaa).
  Committed & pushed (`b60b339`).
- **`npm run db:push` yritetty käyttäjän luvalla** — tässä etäsuoritusympäristössä
  (kertakäyttöinen kontti) ei ole `DATABASE_URL`-ympäristömuuttujaa eikä
  `.env`-tiedostoa lainkaan, joten migraatiota ei voitu ajaa täältä oikeaa
  kantaa vastaan. Tämä pitää ajaa ympäristössä jossa `DATABASE_URL` on
  konfiguroitu (esim. tuotantoympäristö tai kehittäjän oma kone) —
  muutos on additiivinen (uusi nullable-sarake), ei riko olemassa olevaa dataa.

### Jälkikäteinen korjaus: ennakonpidätyksen oletus käännetty varovaiseksi (2026-07-09)

Käyttäjä kysyi mitä PR:n avoimissa kohdissa mainittu "tekijä-laskujen
ennakonpidätyskäsittely" tarkoittaa. Selvitettäessä löytyi todellinen
ristiriita koodin ja `docs/fr8-vero-ja-maksut.md`:n välillä:
- Dokumentti väitti: "Varovainen oletus: ei ALV:tä, ei rekisterissä" (eli
  pitäisi pidättää 60 %/13 %, kunnes tekijä nimenomaan vahvistaa olevansa
  ennakkoperintärekisterissä).
- Mutta `shared/tax.ts`:n `readInPrepaymentRegister()` teki päinvastoin:
  palautti `true` (= EI pidätystä) aina paitsi kun tekijä nimenomaan valitsi
  "En / en tiedä". Sama oletus toisti myös `client/src/pages/worker.tsx`:n
  onboarding-lomakkeen esivalinta ("Kyllä" pre-valittuna).
- Käytännön riski: jos tekijälle luodaan maksu (tavallinen payout TAI FR8
  erälasku) ennen kuin hän on ikinä käynyt omissa asetuksissaan, järjestelmä
  oletti hiljaa "rekisterissä" ja maksoi bruttona ilman pidätystä — vastuu
  pidättämättä jääneestä verosta olisi jäänyt Puuhapatetille/johtajalle.

Kysyin käyttäjältä `AskUserQuestion`-työkalulla miten oletus pitäisi
korjata; **käyttäjä valitsi: "Käännä oletus varovaiseksi"** (suositeltu
vaihtoehto). Toteutettu:
- `shared/tax.ts`: `readInPrepaymentRegister()` palauttaa nyt `true`
  (ei pidätystä) **vain** kun tekijä on nimenomaisesti merkinnyt `"kylla"`;
  kaikki muu (tyhjä, puuttuva, `"ei"`) → pidätetään 60 %/13 %.
- `client/src/pages/worker.tsx`: onboarding-lomakkeen oletusvalinta
  käännetty `"kylla"` → `"ei"` (kolme kohtaa: alkuarvo, aktiivisen napin
  laskenta, selitystekstin ehto) — tekijä näkee nyt "En / en tiedä"
  esivalittuna, kunnes hän itse vahvistaa "Kyllä".
- Tämä vaikuttaa keskitetysti sekä tavalliseen payout-järjestelmään että
  FR8-erälaskuihin, koska molemmat kutsuvat samaa jaettua funktiota.
  `docs/fr8-vero-ja-maksut.md` ei tarvinnut muutosta — sen teksti oli jo
  oikein, koodi vain ei vastannut sitä.
- Verifioitu: `npm run check` sama 6 virheen baseline, `npm run test`
  28/28 vihreää (ei olemassa olevaa testiä koskenut tätä oletusarvoa).

### Mitä koodikannasta löytyi ennen vaihetta 1 (tärkeä konteksti jatkajalle)

FR8-keikalla on jo **osittainen** erä/kate-toteutus ennen tätä työtä, joka EI
vastaa alla olevaa speksiä täysin ja jota sovitetaan/korvataan matkan varrella:

- `shared/project.ts`: `FR8_PRICE_PER_WINDOW` (37,50 €, kiinteä), `computeDealBilling`,
  `computeEraDebts` (~rivi 410) — jakaa pestyt ikkunat automaattisesti erin
  **pesujärjestyksen** (aktiviteettiloki) perusteella, EI käsin syötettynä per
  tekijä. `marginCents = instalmentCents - earnedCents` — ei huomioi johtajien
  omia pesuja eikä laske muuttuvaa x:ää S:n mukaan. Ei erota sovittua muutosta
  ennakosta.
- `shared/payprogress.ts`: `PAY_PERIODS=4`, `computePayProgress`, `eraWindowCounts`
  — ikkunamäärä-pohjainen (ei arvopohjainen) erien koko.
- `client/src/pages/admin/crew.tsx`: `EraKateDialog`/`EraKatePanel` (~rivi 680) +
  `FounderSettlementView` ("Bossien tulot & jako", ~rivi 726) — nykyinen UI
  kate-arvion näyttämiseen. **Pelkkä raportointi**, ei lähetettäviä/lukittavia
  laskuja.
- `server/routes.ts`: founder-settlement-reitit (~1437–1689),
  `generateWorkerInvoicePdf` (~665), sähköpostilähetys Resendillä (useita
  kohtia), `workerPayments`-taulu (`shared/schema.ts`) tekijä-maksuille,
  `payout.invoiceNo`-käytäntö laskunumeroinnille.
- `shared/billers.ts` (`BRAND_BILLERS`, Joonatan/Matias Y-tunnukset+IBAN),
  `shared/tax.ts` (ALV_RATE, ennakonpidätys-vakiot).
- `docs/fr8-tyo-logiikka.md` ja `docs/fr8-vero-ja-maksut.md` — ylläpidetyt,
  ajantasaiset taustadokumentit; päivitetään kun uusi logiikka on valmis
  (vaihe 5).

**Päätös:** uusi speksi (käsin syötetyt pestyt_ikkunat per tekijä/johtaja per
erä, sovittu_muutos vs. ennakko erillään, x = S/kokonaisikkunat, kate
jäännöksenä, lukittavat laskut, PDF+email) on tarkempi ja auktoritatiivinen.
Se rakennetaan **uutena, rinnakkaisena laskuvirtana** (uudet taulut/funktiot),
josta tulee totuuden lähde varsinaiselle laskutukselle. Nykyinen
`EraKateDialog`/`FounderSettlementView` jää toistaiseksi arvioivaksi
dashboard-näkymäksi, ja korvataan/piilotetaan vasta kun uusi virta kattaa
saman tarpeen (päätös tehdään viimeistään vaiheessa 5).

---

## Alkuperäinen speksi (sana sanalta)

# Claude Code -tehtävä: Puuhapätet-järjestelmän FR8-laskutusosuus

## Tavoite
Toteuta Puuhapätet-järjestelmään FR8-keikan (TKK / Bulevardi 31) **laskutus- ja maksuosuus** kokonaisuudessaan. Kaikki laskut ja tositteet on saatava lakisääteisesti oikein, tallennettava muuttumattomasti ja säilytettävä oikeaoppisesti. Alla on tarkka laskentalogiikka, näkymät, käyttäjäpolut ja hyväksymiskriteerit. **Noudata näitä täsmälleen.**
---
## 1. Konteksti ja termistö
- **Johtajat:** Matias (**M**, sähköposti `matiaspit88@gmail.com`) ja Joonatan (**J**, sähköposti = `joonatan@puuhapatet.fi`). Molemmilla oma Y-tunnus (ei toiminimeä) → keskinäiset laskut ovat aitoja yritysten välisiä laskuja.
- **Tekijät:** työntekijät jotka pesevät ikkunoita kiinteään **20 €/ikkuna** -hintaan.
- **Erät:** keikka laskutetaan neljässä erässä, **jokainen erä = 1575 €** (arvon mukaan, ei ikkunamäärän). Yhteensä 6300 €.
  - **Erät 1–3** (yht. 4725 €) → raha tulee **Joonatanin** tilille → tämän erävaihtoehdon vastaanottaja on Joontan, eli kun tekijä lähettää laskun eristä 1-3, laskun saajana on joonatan.**.
  - **Erä 4** (1575 €) → raha tulee **Matiaksen** tilille → erä 4:n johtaja-välisen laskun **tämän erävaihtoehdon vastaanottaja on Matias, eli kun tekijä lähettää laskun erästä, laskun saajana on matias.
- **Erän ikkunamäärä** = kuinka monta ikkunaa on pesty sen erän/erien arvon täyttämiseksi (erä on arvomääräinen, joten ikkunamäärä täytetään käsin per erä).
---
## 2. Laskentalogiikka (YDINLOGIIKKA — toteuta tämä tarkalleen)
### Syötteet
- `S` = valitun erän/erien **kokonaissumma** (€), johtaja täyttää.
- `tekijän_hinta` = **20 €** / ikkuna (kiinteä).
- Per tekijä: `pestyt_ikkunat`, `sovittu_muutos` (€, +/−), `ennakko` (€, jo maksettu).
- Per johtaja (J ja M): `pestyt_ikkunat` (voi olla desimaali, esim. 13,5 / 24,5).
- `kokonaisikkunat` = KAIKKIEN pesemien ikkunoiden summa erässä (tekijät + J + M).
### ⚠️ TÄRKEÄ TARKENNUS: erota "sovittu muutos" ja "ennakko"
Käyttäjän alkuperäisessä kuvauksessa nämä olivat samassa laatikossa. **Ne ovat eri asioita ja pidettävä erillään, muuten kate laskee väärin:**
- **Sovittu muutos** (bonus/alennus, esim. Miljan +20 €): muuttaa tekijän **ansaittua kokonaissummaa** → **vaikuttaa katteeseen**.
- **Ennakko** (jo maksettu, esim. Matias maksoi Janille 380 € etukäteen): EI muuta ansaittua summaa, ainoastaan "maksettava nyt" -riviä → **EI vaikuta katteeseen** (raha on jo lähtenyt, se on silti erän kustannus).
Jos haluatte silti yhden yhteislaatikon UI:ssa, pidä silti **kaksi erillistä kenttää datassa** (`sovittu_muutos`, `ennakko`). Katelaskenta käyttää vain `sovittu_muutos`ta.
### Laskukaavat (järjestyksessä)
```
1. Per tekijä:
   ansaittu   = pestyt_ikkunat * 20 + sovittu_muutos      // käytetään katteeseen
   maksettava = ansaittu - ennakko                         // tekijän lasku "nyt"
2. tekijät_ansaittu_yht = SUMMA(kaikkien tekijöiden ansaittu)
3. x = S / kokonaisikkunat                                 // PYÖRISTÄ 2 desimaaliin
4. Per johtaja:
   johtaja_omat = ROUND(x, 2) * pestyt_ikkunat
5. KATE = S - tekijät_ansaittu_yht - J_omat - M_omat       // JÄÄNNÖS
   // Laske kate AINA jäännöksenä, älä kaavalla n*(x-20).
   // Näin 2 desimaalin pyöristys ei aiheuta senttiheittoa ja summa täsmää S:ään.
6. kate_per_johtaja = KATE / 2
7. J_loppusumma = J_omat + kate_per_johtaja
   M_loppusumma = M_omat + kate_per_johtaja
8. TARKISTUS: tekijät_ansaittu_yht + J_loppusumma + M_loppusumma  ==  S   (ero = 0)
```
### Miksi kate jäännöksenä
Kate = "mitä johtajat tienaavat siitä että tekijät pesevät" = S miinus tekijöiden kustannukset miinus johtajien omat pesut. Koska `x` pyöristetään 2 desimaaliin, jäännöslaskenta imee pyöristyksen ja loppusumma täsmää sentilleen kokonaissummaan `S`. Kate jaetaan **tasan 50/50** riippumatta siitä kumpi johtaja pesi enemmän (näin on sovittu).
---
## 3. Näkymät ja käyttäjäpolut
### 3A. Tekijä-maksut (johtaja → tekijä)
1. Johtajan **projektinäkymässä (FR8)** on **"Maksu"**-toiminto. Johtaja valitsee **erät 1–3** tai **erä 4**.
2. Avautuu **laskunäkymä**, jossa jokaiselle tekijälle on **valmiiksi täytetty** `pestyt_ikkunat * 20 €`.
3. Näkymässä on kentät **"Sovittu muutos (€)"** ja **"Ennakko / jo maksettu (€)"** joilla laskun summaa voi plussata/miinustaa (ks. kohta 2).
4. Johtaja **lähettää maksun/laskun** tekijän näkymään.
### 3B. Tekijän näkymä — maksut
1. Tekijän näkymän **"Maksut"**-kohtaan ilmestyy johtajan lähettämä lasku ja **"Lähetä lasku"** -painike.
2. Tekijä voi **hyväksyä/lähettää** tai **hylätä** laskun.
3. **Kun lasku on lähetetty, sitä ei voi lähettää enää uudelleen** (painike toimii vain kerran, lasku lukittuu).
4. Johtaja voi lähettää tekijän näkymään **uusia maksuja vapaasti (rajattomasti)** virheiden varalta; tekijä voi hylätä väärän.
### 3C. Johtajien välinen laskutus (J ↔ M)
1. Samassa projektinäkymässä, **"Tekijät"-osiossa** J ja M näkyvät riveinä. Kummankin **omalla rivillä ei ole "Maksut"-painiketta**, mutta **toisen johtajan rivillä on** (M näkee painikkeen Joonatanin rivillä, J näkee sen Matiaksen rivillä).
2. Painikkeesta avautuu **laskun lähetysvalikko** (samanlainen kuin tekijöillä). Sisältö järjestyksessä:
   - **Itsepestyt ikkunat** (laskun **lähettäjän** omat pestyt ikkunat).
   - Kenttä: **erän/erien ikkunamäärä** (= `kokonaisikkunat`).
   - Kenttä: **erän/erien kokonaissumma** (= `S`).
   - Järjestelmä laskee **ikkunakohtaisen hinnan `x` (2 desimaalia)** → **omat ansiot** = `x * itsepestyt_ikkunat`.
   - **Kate** = jäännös (S − tekijöiden **maksut sovitut muutokset huomioiden** − johtajien pesemät) → näytä.
   - **Kate / 2** → näytä.
   - **Yhteenlaskettu summa** (= omat ansiot + kate/2) → näytä.
   - **Vapaa muokkauskenttä** jolla loppusummaa voi vielä muuttaa käsin.
3. **Reititys:** erät 1–3 → lasku osoitetaan **Joonatanille**; erä 4 → **Matiakselle**.
4. Kun lasku lähetetään, se tallentuu **molemmille osapuolille** järjestelmään ja **kopiot lähtevät automaattisesti kumpaankin sähköpostiin** (`matiaspit88@gmail.com` JA Joonatanin sähköposti) **riippumatta laskun suunnasta**.
### 3D. "Maksut" / Kokonaistilanne -sivu
Projektinäkymään tulee **"Maksut"**-sivu (kokonaistilanne), josta löytyy:
- **Johtajien väliset laskut** (lähetetyt, edellä kuvatulla tavalla tehdyt).
- **Kaikki tekijöille lähetetyt maksut** (johtajan tekijän näkymään pistämät).
- **Tekijöiden hyväksymät / "lähettämät" laskut** (kuitatut).
- Jokaisesta johtaja-välisestä laskusta on **kopio kummankin johtajan sähköpostissa**.
---
## 4. Lailliset vaatimukset ja tositteet (PAKOLLINEN)
> Huom: en ole lakimies — nämä ovat yleisiä vaatimuksia; **varmista lopullinen ALV-käsittely ja pakolliset kentät kirjanpitäjältä/verottajalta** ennen tuotantokäyttöä.
- **Jokaisen laskun** (sekä johtaja-väliset että tekijä-maksut) tulee sisältää lain vaatimat tiedot: laskun **päiväys**, **juokseva laskunumero**, myyjän ja ostajan **nimi ja Y-tunnus**, suoritteen **määrä ja laji** (esim. "ikkunanpesu, X ikkunaa"), **veloituksen peruste/summa**, **eräpäivä** ja **viitenumero** sekä **ALV-merkintä**.
- **ALV:** 4H-nuorten vähäinen toiminta on todennäköisesti alle ALV-alarajan → lasku on tehtävä **ilman ALV:tä** ja siihen merkitään verottomuuden peruste (esim. "Arvonlisäveroton myynti, vähäinen toiminta"). **Vahvista tämä.**
- **Muuttumattomuus / audit trail:** kun lasku on lähetetty tai tekijä on sen hyväksynyt, lasku **lukitaan** — sitä ei voi muokata eikä lähettää uudelleen. Korjaus tehdään aina **uutena laskuna/hyvityksenä** (append-only historia, kaikki tapahtumat aikaleimoineen).
- **Säilytys:** tositteet ja laskut säilytettävä kirjanpitolain mukaisesti (**tositteet 6 vuotta**). Talleta pysyvästi (esim. PDF + tietokantatietue), älä pelkkänä muokattavana tilana.
- **Molemmilla osapuolilla** oma kopio jokaisesta laskusta järjestelmässä + sähköpostikopiot.
---
## 5. Tietomalli (suositus)
- `erä`: id, numero (1–4), arvo (1575), tila.
- `tekijä_pesu`: erä_id, tekijä_id, pestyt_ikkunat, sovittu_muutos, ennakko.
- `johtaja_pesu`: erä_id, johtaja_id (J/M), pestyt_ikkunat.
- `lasku`: id, tyyppi (`tekijä` | `johtaja_valinen`), lähettäjä, vastaanottaja, erät[], rivit, kokonaissumma, x, kate, kate_per_johtaja, vapaa_muokkaus, tila (`luonnos`|`lähetetty`|`hyväksytty`|`hylätty`), aikaleimat, laskunumero, viitenumero, pdf.
- `sähköposti_loki`: lasku_id, vastaanottajat, aikaleima.
---
## 6. Validoinnit ja hyväksymiskriteerit
1. **Ikkunamäärän täsmäytys (KORJATTAVA BUGI):** Kokonaistilanne-näkymän ikkunamäärän on oltava **täsmälleen** kaikkien pesemien ikkunoiden summa (tekijät + J + M). Nyt heittää yhdellä ikkunalla.
   - **Todennäköinen syy:** desimaali-ikkunat (13,5 / 24,5) pyöristetään riveittäin ennen summausta. **Summaa aina tarkoilla desimaaleilla, älä pyöristä per rivi.** Vertaa: `näytetty_kokonaismäärä === SUMMA(kaikki pestyt, ilman pyöristystä)`.
2. `x` pyöristetään **2 desimaaliin**; kate lasketaan **jäännöksenä**; `tekijät_ansaittu_yht + J_loppusumma + M_loppusumma === S` (ero 0,00 €).
3. Tekijän "Lähetä lasku" -painike toimii **tasan kerran** per lasku; lähetyksen jälkeen lasku lukittu.
4. Johtaja voi lähettää tekijälle **rajattomasti** uusia maksuja; hylätty ei estä uutta.
5. Johtaja **ei näe "Maksut"-painiketta omalla rivillään**, näkee sen toisen johtajan rivillä.
6. Erä-reititys: 1–3 → Joonatan, 4 → Matias. Sähköpostikopiot **aina molemmille**.
7. Lähetetty/hyväksytty lasku on **muuttumaton**; korjaus vain uutena laskuna.
---
## 7. Testitapaus (erät 1–3) — käytä yksikkötestinä
**Syöte:** `S = 4725`
- Tekijät (ikkunat): Jani 31, Milja 16, Oliver 15, Petra 11, Oona 11, Dom 5 (= 89)
- Sovitut muutokset: Milja **+20**; muut 0
- Ennakot: Jani **380** (ei vaikuta katteeseen); muut 0
- Johtajat: J **13,5**, M **24,5** (= 38)
- `kokonaisikkunat = 127`
**Odotettu tulos, ei välttämättä oikein**
| Suure | Arvo |
|---|---|
| x (2 des.) | **37,20 €** |
| Tekijät ansaittu yht. (sis. Milja +20) | **1800,00 €** |
| Jani maksettava nyt (620 − 380) | 240,00 € |
| J omat (37,20 × 13,5) | 502,20 € |
| M omat (37,20 × 24,5) | 911,40 € |
| **Kate** (4725 − 1800 − 502,20 − 911,40) | **1511,40 €** |
| Kate / 2 | 755,70 € |
| **J loppusumma** | **1257,90 €** |
| **M loppusumma** | **1667,10 €** |
| Tarkistus (1800 + 1257,90 + 1667,10) | **4725,00 €** ✓ |
| Ikkunat yhteensä | **127** (ei 128) |
**Reititys:** johtaja-välinen lasku erät 1–3 → vastaanottaja **Joonatan**; kopiot molempien sähköpostiin.
---
## 8. Toteutusohje
Tee muutokset olemassa olevan järjestelmän tyyliin ja arkkitehtuuriin sopien. Aloita: (1) lue nykyinen projektinäkymä + tekijä/johtaja-näkymät ja niiden datamalli, (2) toteuta laskentalogiikka (kohta 2) puhtaana funktiona + yksikkötesti (kohta 7), (3) rakenna näkymät (kohta 3), (4) lisää laskujen muuttumaton tallennus + sähköpostikopiot + PDF (kohdat 4–5), (5) korjaa ikkunamäärän off-by-one (kohta 6.1). Kysy jos jokin datamallin kohta on epäselvä ennen isoja muutoksia.

---

## Käyttäjän jakopyyntö (sana sanalta)

> "devide this plan into 5 stages, and every stage has to be done completely
> before even thinking the next stage, after execution confirm its status and
> request to start the new stage, that way we can do this much better, it is
> important, that you make a new pr or new place of the whole plan where you
> copy the whole plan so if you ran out of credits other agents/accounts can
> run and continue this 100%. [...] ja oikeesti jaat tän viiteen osaan ja
> kerron vasta kun saat jatkaa ja mennä eteenpäin."

Tästä pyynnöstä syntyi tämän tiedoston yllä oleva 5-vaiheinen suunnitelma ja
prosessi (tee vaihe → raportoi → odota lupa → jatka).
