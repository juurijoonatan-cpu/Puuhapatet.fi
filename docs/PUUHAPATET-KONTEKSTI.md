# PUUHAPATET — TÄYDELLINEN KONTEKSTI

> Tämä dokumentti on itsenäinen, kattava kuvaus Puuhapatet-yrityksestä ja sen
> järjestelmästä. Se on tarkoitettu liitettäväksi sellaisenaan kenelle tahansa
> agentille tai ihmiselle, jotta he ymmärtävät kokonaisuuden heti ilman muuta
> taustatietoa. Lähde: koko Puuhapatet.fi-repositorio (asiakassivusto, admin,
> backend, jaetut datamallit, sopimukset ja sisäiset ohjeet).
>
> **Tilannekuva:** kesäkuu 2026. Auktoritatiiviset luvut on poimittu koodista
> (mm. `shared/team.ts`, `shared/tax.ts`, `shared/billers.ts`, `lib/admin-profile.ts`).

---

## OSA 1 — PERUSTIEDOT JA TOIMINTA

### 1(a) Mikä Puuhapatet on ja miten se toimii

**Puuhapatet** on espoolainen palveluyritys / brändi, jonka ydinpalvelu on
**ammattitaitoinen ikkunanpesu ja lasipintojen huolto**. Sen ovat perustaneet
vuonna 2026 kaksi Otaniemen lukiolaista, **Joonatan Juuri** ja **Matias Pitkänen**.
Toimintaa täydentävät piha- ja puutarhatyöt, lumityöt, maalaus sekä auton
sisäpuhdistus (kumppanuus KJ Cardetailingin kanssa).

- **Slogan / henki:** *"Ei säätöä. Puuhapatet hoitaa."*
- **Tagline:** *"Ammattitaitoista ikkunanpesua sinun tarpeisiisi."*
- **Verkkotunnus:** puuhapatet.fi
- **Kielet:** suomi (oletus) + englanti (FI/EN-toggle koko sivustolla)
- **Toiminta-alue:** Etelä- ja Länsi-Espoo (Westend, Haukilahti, Suvisaaristo,
  Nuottaniemi, Tapiola, Saunalahti, Otaniemi), myös Helsinki ja Kauniainen;
  muut alueet sopimuksen mukaan.

**Arvolupaus:**
- Huolellinen, raidaton ja viimeistelty työnjälki
- Joustava aikataulu, nopea vaste (usein vastaus saman päivän aikana, esim. WhatsApp)
- Selkeä hinta etukäteen — ei yllätyslaskuja
- Vastuuvakuutus kaikissa töissä (kattaa vastuun ja tuotevastuun koko Euroopassa)
- Kotitalousvähennyskelpoinen palvelu

**Miten se toimii käytännössä (asiakkaan polku):**
1. Asiakas ottaa yhteyttä verkkosivun lomakkeella, WhatsAppilla, Instagramissa
   tai sähköpostilla (info@puuhapatet.fi).
2. Lomakkeesta syntyy liidi ja asiakkaalle näytetään **Puuha-ID** (muoto
   `PP-{timestamp}-{random}`, esim. `PP-M1XYZ123-AB12`), jonka avulla pyyntö
   yhdistetään myöhemmin keikkaan.
3. Tekijä (perustaja tai työntekijä) hoitaa keikan iPad-ensisijaisella
   admin-työkalulla: hinnoittelu, kohteen arviointi, sopimus + allekirjoitukset,
   työn suoritus ja kuitti/lasku.
4. Maksu: MobilePay (for Business), tilisiirto tai käteinen. Kuitti automaattisesti.

### 1(b) Yrityksen toimintamalli

Puuhapatet **ei ole vielä juridinen yhtiö**, vaan **brändi**, jota pyörittää
kaksi perustajaa **omilla Y-tunnuksillaan**. Jokainen tekijä toimii itsenäisenä
yrittäjänä (4H-/kevytyrittäjä) omalla Y-tunnuksellaan — kyseessä **ei ole
työsuhde**.

**Roolihierarkia ja palvelumaksut** (auktoritatiivinen lähde `shared/team.ts`).
Palvelumaksu lasketaan **nettotuloksesta** (oma osuus keikan tuotosta − kulut)
ja se kattaa brändin, asiakashankinnan, järjestelmät, työkalut ja yhteiset kulut:

| Rooli | Henkilöt | Palvelumaksu |
|------|----------|--------------|
| **HOST (perustaja)** | Joonatan Juuri, Matias Pitkänen | **10 %** |
| **STAFF — grandfathered** | Petrus Aalto | **30 %** (vanha sovittu, säilyy) |
| **STAFF — uudet/tulevat** | kaikki muut | **35 %** (vakiotaso) |

> Huom: admin-oppaan (guide.tsx) numeroesimerkeissä saattaa esiintyä vanha
> 25 % — koodin todellinen vakio on **35 %** (`STAFF_SERVICE_FEE_RATE = 0.35`),
> grandfathered Petrus **30 %**, HOST **10 %**.

**Laskutusmalli (brändi, ei yhtiö):**
- **Asiakas → johtaja:** iso keikka laskutetaan **useassa erässä, jaettuna
  kahden johtajan kesken**, jottei kummankaan liikevaihto ylitä rajoja (mm. ALV:n
  vähäisen toiminnan **15 000 €/12 kk** -raja). Jokainen asiakaslasku tallentaa,
  kuka johtaja sen lähetti.
- **Alihankkija → johtaja:** alihankkija laskuttaa sitä johtajaa, joka laskutti
  asiakkaan kyseisestä erästä. Laskun **ostaja** = kyseinen johtaja (nimi +
  Y-tunnus + osoite).
- **Yhtiöityminen myöhemmin:** kun brändi yhtiöitetään, riittää ympäristömuuttujat
  `COMPANY_NAME` + `COMPANY_Y_TUNNUS` (+ `COMPANY_ADDRESS`, `COMPANY_EMAIL`), niin
  yhtiö tulee valittavaksi laskun ostajaksi ilman koodimuutoksia.

**Kotitalousvähennys:** Palvelu on kotitalousvähennyskelpoinen. Asiakkaalle
näytetään arvio ~35 % vähennyksellä (asiakas hakee itse OmaVerossa; max 2 250 €
/ henkilö / vuosi). Esim. omakotitalo 100–120 m²: 229 € → n. 149 € vähennyksen
jälkeen.

### 1(c) Nykyiset ja voimassa olevat tiedostot sekä sopimukset

**Sopimusversio kaikilla: `2026-06`.** Sopimukset ovat koodissa jaettuina
moduuleina ja ne allekirjoitetaan sovelluksessa (signature PNG + nimi + paikka;
alle 18-v. allekirjoittajalle huoltajan nimi).

**A) Jäsensopimus — `shared/member-agreement.ts`** (Puuhapatet-tiimin jäsenet):
- **Perustajan sopimus (founder):** yhteinen brändi, asiakkaat ja järjestelmät
  yhteistä omaisuutta; yhdessä päättäminen; **palvelumaksu 10 % oman osuuden
  nettotulosta**; 12 kk kilpailukielto; Suomen laki.
- **Tekijän sopimus (worker):** itsenäinen kevytyrittäjä, **ei työsuhde**, oma
  Y-tunnus ja omat verot; **palvelumaksu 35 % (tai grandfathered %)**; laskutus
  vain brändin mallin kautta, **ei suoria asiakasmaksuja**; asiakkaat kuuluvat
  Puuhapatetille (12 kk kilpailukielto, 24 kk asiakassuoja).
- Yhteiset käytännöt: tietosuoja, turvallisuus & avaimet, laatu & asiakaspalvelu,
  brändi & some, rahaliikenne & rehellisyys.

**B) Alihankkijasopimukset (4 osaa) — `shared/worker-agreements.ts`**
(`WORKER_AGREEMENTS_GATED = true`: profiili + sopimukset + vakuutus on
hyväksyttävä ennen kuin tekijä voi merkitä ikkunoita):
1. **Alihankinta:** itsenäinen alihankkija, ei työsuhde; **verot/ALV/YEL/vakuutus
   omalla vastuulla**; urakkaperusteinen, ikkunakohtainen korvaus omalla
   Y-tunnuksella; oikeus kuntovaraukseen huonokuntoisesta ikkunasta. Pakolliset
   kuittaukset: itsenäisyys, verot, vakuutus, korvausmalli.
2. **Tietoturva:** asiakastiedot luottamuksellisia ja vain työhön; avaimet
   huolellisesti ilman tunnistetietoja; työturvallisuus.
3. **Asiakassuoja & kilpailukielto:** asiakkaat ja kohteet kuuluvat brändille (ei
   suoria maksuja, ei 24 kk jälkeenkään); **kilpailukielto yhteistyön ajan + 12 kk**;
   houkuttelukielto; **sopimussakko 2 000 € / rikkomus + 500 € / alkava viikko**
   jatkuville rikkomuksille.
4. **Tiimi, jatkuvuus & kasvu:** hyvästä työstä palkitaan (lisää töitä, etusija,
   korkeampi ikkunakohtainen korvaus); läpinäkyvä reaaliaikainen ansionäkymä;
   maksut sovitusti.

**C) Asiakassopimukset / dokumentit:**
- **Käyttöehdot** (`client/src/pages/ehdot.tsx`)
- **Tietosuojaseloste** (`client/src/pages/tietosuoja.tsx`)
- **Keikan sopimus** allekirjoituksineen (asiakas + tekijä) — luodaan keikan
  yhteydessä.
- **Yritys-/sopimuskeikan sopimus** (custom gig, FR8-tyyli): signeerattu sopimus,
  asiakkaan allekirjoitus + yritystiedot.

**D) Tekniset ja sisäiset dokumentit (repo):**
- `README.md`, `replit.md` — projektin yleiskuvaus ja tila
- `design_guidelines.md` — visuaalinen ohjeisto
- `docs/fr8-tyo-logiikka.md` — ansio-/työaika-/näkymälogiikka
- `docs/fr8-vero-ja-maksut.md` — alihankkijan vero- ja maksulogiikka
- `client/src/pages/admin/guide.tsx` — sisäinen opaskirja (10 osaa)

**Käyttöehtojen (ehdot.tsx) ydinkohdat:**
- Lisätyöt: **45 €/h** + matkakulut (sovitaan etukäteen)
- Maksutavat: tilisiirto, MobilePay, käteinen; maksumuistutus 5 €; lain mukainen
  viivästyskorko
- Reklamaatio kirjallisesti (info@puuhapatet.fi) **2 vrk** sisällä → veloitukseton
  korjauskäynti
- Peruutus: maksutta ≥ 48 h ennen; < 48 h = 50 %; < 24 h tai no-show = 100 %
- Jokaisella tekijällä oma vastuuvakuutus

**Tietosuojaselosteen (tietosuoja.tsx) ydinkohdat:**
- Rekisterinpitäjä: Puuhapatet (4H-yrittäjät), Espoo/Helsinki, info@puuhapatet.fi
- Tiedot: nimi, puhelin, sähköposti (valinn.), osoite/alue, lisätiedot
- Ei luovuteta kolmansille, ei siirretä ETA:n ulkopuolelle, **ei seurantaevästeitä**
- SSL-suojaus; rekisteröidyn GDPR-oikeudet (tarkastus, korjaus, poisto, valitus)

---

## OSA 2 — PROSESSIT JA RAKENTEET

### 2(a) Työnkulku ja järjestelmän toiminta

**Sovellus koostuu kahdesta osasta:**
1. **Asiakassivusto (PUBLIC)** — markkinointi ja liidien keruu. *Valmis ja
   "lukittu"*: ei muuteta ilman erityistä syytä.
2. **Admin Ops (INTERNAL)** — iPad-ensisijainen työkalu ovimyyntiin ja keikkojen
   operointiin. *Tämä on ydintuote.*

**Tekninen stack:**
- **Frontend:** Vite + React 18 + TypeScript, TailwindCSS + shadcn/ui (Radix),
  Wouter (reititys), TanStack Query, Zod. PWA-tuki (manifest + service worker).
- **Backend:** Express.js + TypeScript, **PostgreSQL** + Drizzle ORM.
  *(Huom: alkuperäinen MVP käytti Google Apps Script + Sheets -backendiä; nykyinen
  toteutus on Express + Postgres.)*
- **Sähköposti:** Resend (kuitit, laskut, yhteenvedot, yhteydenotot)
- **PDF/viivakoodi:** PDFKit (laskut/kuitit/sopimukset), bwip-js (suomalainen
  pankkiviivakoodi)
- **AI:** OpenAI-yhteensopiva rajapinta (oletus Groq `llama-3.3-70b-versatile`;
  vaihtoehdot OpenRouter, Gemini)
- **Autentikointi:** HMAC-allekirjoitetut tilattomat tokenit (7 vrk), scrypt-hashatut
  salasanat. *Admin-gate on kevyt UI-portti, ei kova turvaraja.*

**Tietokantataulut (PostgreSQL / Drizzle):**
`customers`, `jobs`, `expenses`, `worker_payments`, `investments`,
`startup_bonus_usages`, `users`, `chat_conversations`, `chat_messages`.

**Keikan statuskulku:** `lead → scheduled → in_progress → done / cancelled`.

**Tärkeimmät API-endpointit (Express, `server/routes.ts`):**
- *Julkiset:* `/api/health`, `/api/contact`, `/api/chat` (+ `/handoff`),
  `/api/quote/:token` (+ `/respond`), `/api/gig/:token` (+ `/sign`),
  `/api/crew/:token` (+ `/auth`, `/onboard`, `/window`, `/shift`, `/hours`,
  `/note`, `/map-note`, `/payout/:id/approve`), `/api/calendar.ics`,
  `/api/admin/login`.
- *Admin (Bearer-token):* `/api/customers`, `/api/jobs` (+ `/:id`,
  `/expenses`, `/invite`, `/gig`, `/gig/approve`, `/gig/invoice`, `/project`,
  `/crew`…), `/api/stats`, `/api/workers/stats`, `/api/workers/:id/mark-paid`,
  `/api/investments`, `/api/startup-bonus-usages`, `/api/send-receipt`,
  `/api/send-job-summary`, `/api/send-progress-update`, `/api/send-quote`,
  `/api/admin/my-dashboard`, `/api/admin/chats…`, `/api/admin/assistant`.

**Admin-sivut ja reitit:**

| Sivu | Reitti | Käyttötarkoitus |
|------|--------|-----------------|
| Welcome | `/admin/tervetuloa` | Sopimuksen allekirjoitus + käytäntöjen hyväksyntä |
| Login | `/admin/login` | Kirjautuminen profiililla (kovakoodattu käyttäjälista) |
| Dashboard | `/admin/dashboard` | Yhteenvetokortit (tulot, keikat, palvelumaksuvelka) |
| New Job | `/admin/new` | 4-vaiheinen keikan wizard |
| New Gig | `/admin/new-gig` | Yritys-/sopimuskeikka (cap-pricing, FR8-tyyli) |
| Jobs | `/admin/jobs` | Keikkalista, muokkaus, status, kuitit |
| Customers | `/admin/customers` | Asiakasrekisteri |
| Calendar | `/admin/calendar` | Lista/viikko/päivä + iCal-tilaus |
| Crew | `/admin/gig/{id}/tiimi` | Työntekijöiden hallinta, maksut, sopimukset |
| Gig Tracker | `/admin/gig/{id}` | Sopimuskeikan live-seuranta + laskutus |
| Project | `/admin/gig/{id}/projekti` | FR8 lattiakaavio, ikkunoiden merkintä |
| Tax Export | `/admin/tax-export` | Verotuloste + CSV |
| Investments | `/admin/investments` | Hankinnat, 50/50-jaot, startup-bonus |
| Settings | `/admin/settings` | Salasana, teema, opas, palvelumaksuvelat (HOST) |
| Guide | `settings → Opas` | Sisäinen opaskirja (10 osaa) |
| Inbox | `/admin/inbox` | Julkisen lomakkeen viestit |

**"Uusi keikka" -wizard (new-job.tsx), 4 vaihetta:**
- **Vaihe 0 – Hinnoittelu:** palvelutyyppi (ikkunanpesu / piha / siivous / autopesu
  / piharakenne / muu). Ikkunanpesulle laskuri: talotyyppi + neliöalue +
  palvelutaso (sisä+ulko 1.0×, vain ulko 0.58×, vuosipaketti 2× = 1.8×) +
  lisäpalvelut → alennus → loppuhinta (pyöristys 5 €).
- **Vaihe 1 – Arviointi:** saavutettavuus, sää, sisäiset muistiinpanot.
- **Vaihe 2 – Asiakas:** nimi*, puhelin*, osoite*, sähköposti, kieli, huomiot;
  visuaalinen tarjousnäkymä asiakkaalle.
- **Vaihe 3 – Sopimus:** asiakkaan + tekijän allekirjoitus (canvas), hyväksyntä.
- **Vaihe 4 – Valmis:** vahvistus, navigointi keikkalistaan.

**"Uusi sopimuskeikka" -wizard (new-gig.tsx):** tilaaja/yritys → sopimus & kuvaus
→ hinnoittelusektorit → työntekijöiden valinta → tallennus (`isCustomGig: true`,
`gigData` JSON, jaettava `quoteToken`). Asiakkaalle live-seurantalinkki
`/seuranta/{token}`.

**FR8-keikan logiikka (esimerkki suuresta sopimuskeikasta):**
hinta/ikkuna **37,50 €**, vain prioriteetti-1 ("punaiset") ikkunat laskutetaan,
katto **6 300 €** (168 punaista ikkunaa). Lattiakaaviossa ikkunat: status
`ei → kesken → pesty`; tekijä saa oman €/ikkuna-korvauksensa (esim. 20 €),
perustajat saavat marginaalin `(37,50 − tekijän rate)` jaettuna keskenään.
Tärkeää: **työntekijä ei näe keikan kokonaishintoja, kattoa eikä muiden ansioita**
— vain omat ikkunat ja oma ansionsa.

### 2(b) Työroolien jakautuminen

**Kovakoodatut käyttäjät (`client/src/lib/admin-profile.ts`):**

| ID | Nimi | Rooli | Y-tunnus | Huom. |
|----|------|-------|----------|-------|
| `joonatan` | **Joonatan Juuri** | HOST | 3598782-9 | perustaja, päävastuuhenkilö, startup-bonus 300 € |
| `matias` | **Matias Pitkänen** | HOST | 3609912-9 | perustaja, operatiivinen, startup-bonus 300 € |
| `petrus` | **Petrus Aalto** | STAFF | 3620983-4 | grandfathered 30 %, startup-bonus 300 € |
| `jani` | **Jani Ihalainen** | STAFF | — | `dashboardOnly: true` (vain oma `/tyo/:token`) |

**HOST (perustaja):** näkee kaiken — kaikki asiakkaat, keikat, työntekijät,
talous-erittelyt ja palvelumaksuvelat per henkilö; voi luoda/hinnoitella keikat,
hallita crewiä, merkitä palvelumaksut maksetuiksi, käyttää FR8-projektinäkymiä.
Palvelumaksu 10 %.

**STAFF (työntekijä/alihankkija):** näkee vain omat keikkansa ja tietonsa; kirjaa
omat tulot verotulosteeseen ja investoinnit; näkee oman palvelumaksuvelkansa;
**ei** näe toisten keikkoja tai tiimin kokonaistuloja. Palvelumaksu 35 %
(grandfathered Petrus 30 %).

**Dashboard-only (esim. Jani):** kirjautuu admin-loginilla, mutta ohjataan suoraan
omaan työpöytäänsä `/tyo/:token`; merkitsee pestyt ikkunat ja näkee omat
tilastonsa. Linkitys crew-jäseneen `linkedUserId`-kentällä.

**Gig-crew (token-pohjaiset alihankkijat, `shared/crew.ts`):** asuvat keikan
`projectData.crew`-listassa; jokaisella salainen linkki (`token`), PIN
(`pinHash`), `perWindowCents` (oletus 20 €), profiili, allekirjoitetut sopimukset,
työvuorot (`sessions`), muistiinpanot ja maksut (`payouts`). Rooli `worker` tai `host`.

### 2(c) Alihankkijoiden hoitaminen

**Onboarding (gated):** alihankkijan on ennen töiden merkintää (1) täytettävä
profiili (nimi, puhelin, sähköposti, osoite, Y-tunnus, IBAN, kokemus, kuljetus,
korkeatyöskentely, saatavuus, vakuutustila + riskikuittaus) ja (2) allekirjoitettava
kaikki 4 alihankkijasopimusta.

**Työpöytä (`/tyo/:token`, worker.tsx):** intro → sopimukset → kartta/ikkunat →
ansiot → tunnit/sessio → info. Tekijä merkitsee ikkunat `pesty`/`kesken`, voi
kirjata kuntovarauksen, aloittaa/lopettaa vuoron (tauot eivät kerrytä tunteja).
"Päätä päivä" laskee session ja lähettää yhteenvedon sähköpostiin (ikkunat,
ansio, työaika, €/h). **Rahan yksityisyys:** ei keikan kokonaishintoja, kattoa
eikä muiden euroja — vain oma rate × omat ikkunat; leaderboard näyttää vain
ikkunamääriä.

**Admin-hallinta (crew.tsx, vain HOST):** lisää/poista työntekijä, muokkaa nimeä/
roolia/€-per-ikkuna, kopioi yksityinen linkki, näe profiili + sopimukset (ladattava
allekirjoitus-PNG), seuraa reaaliaikaista vuoroa, luo ja merkitse maksuerät.

**Maksuprosessi (`shared/crew.ts` payouts):**
`ilmoitettu` (Puuhapatet loi maksuilmoituksen) → `hyvaksytty` (tekijä vahvistaa
summan ja laskutustiedot) → `maksettu` (pankkisiirto + automaattinen lasku-PDF).
Maksuun tallennetaan snapshotit: tekijän laskutustiedot, vero-erittely
(`TaxBreakdown`) ja ostaja (kumpi johtaja).

**Maksut jaksoissa (`shared/payprogress.ts`):** iso keikka jaetaan **4 maksuerään**;
mittari näyttää tekijälle vain ikkunamääriä (ei euroja).

### 2(d) Laskutusprosessi

**Asiakaslaskutus:**
- Keikka merkitään valmiiksi → kuitti/lasku sähköpostilla (`/api/send-job-summary`,
  Resend). HTML-lasku sisältää laskunumeron, asiakastiedot, laskuttajan (johtaja),
  palvelukuvauksen, maksuehdon ja suomalaisen **pankkiviivakoodin** (IBAN, summa,
  viite). Maksutavat: MobilePay, tilisiirto, käteinen, kortti.
- Iso keikka jaetaan eriin kahden johtajan kesken (ALV-rajan hallinta).

**Alihankkijan vero- ja maksulogiikka (`shared/tax.ts`, `docs/fr8-vero-ja-maksut.md`):**
Maksu alihankkijalle on **työkorvausta, ei palkkaa** (ei työnantajavelvoitteita).
Kaksi ratkaisevaa tekijää:

1. **Ennakkoperintärekisteri → ennakonpidätys:**
   - ON rekisterissä → maksetaan **bruttona** (ei pidätystä).
   - EI rekisterissä, luonnollinen henkilö/toiminimi → **ennakonpidätys 60 %**
     (ilman verokorttia).
   - EI rekisterissä, oikeushenkilö (Oy/Ky/Ay) → **13 %**.
   - Varovainen oletus: pidätetään 60 % kunnes tekijä ilmoittautuu rekisteriin
     (ytj.fi).
2. **Arvonlisävero (ALV):**
   - ALV-rekisterissä → lisätään **25,5 %** työkorvauksen päälle.
   - Vähäinen toiminta (AVL 3 §, alle ~15 000 €/12 kk) → ei ALV:tä.

**Laskentajärjestys:**
```
työkorvaus (ilman ALV:tä)
+ ALV (jos ALV-rekisterissä, 25,5 %)
= laskun loppusumma
− ennakonpidätys (jos EI ennakkoperintärekisterissä)
= maksetaan tilille
```
*Esimerkki:* 11 ikkunaa × 20 € = 220 € työkorvaus; ei ALV:tä eikä rekisteröitymistä
→ 60 % × 220 = 132 € pidätetään Verolle → **tilille 88 €**. Rekisteröitymisen
jälkeen tilille koko 220 €.

**Verovakiot (`shared/tax.ts`):** `ALV_RATE = 0.255`,
`WITHHOLDING_NATURAL_PERSON = 0.60`, `WITHHOLDING_COMPANY = 0.13`,
`VAT_SMALL_BUSINESS_LIMIT_EUR = 15000`.

**Laskuttajat (`shared/billers.ts`, BRAND_BILLERS):**

| ID | Nimi | Y-tunnus | Osoite | Sähköposti |
|----|------|----------|--------|-----------|
| joonatan | Joonatan Juuri | 3598782-9 | Braskarna 8, 02380 Espoo | joonatan@puuhapatet.fi |
| matias | Matias Pitkänen | 3609912-9 | Haapaniemenrinne 5A, 02940 Espoo | matias@puuhapatet.fi |

**Palvelumaksun tilitys (sisäinen):** keikka valmis → järjestelmä laskee
palvelumaksun nettotuloksesta → tekijän palvelumaksuvelka kasvaa → HOST merkitsee
maksun → saldo nollautuu ja raha kirjataan brändin kassaan. Verotulosteessa
(`/admin/tax-export`) näkyy bruttotulo, kulut, palvelumaksu ja nettotulo + CSV.

**Verotusohje tekijöille (guide.tsx, "4H-yrittäjä"):** ei ALV-velvollisuutta
pienimuotoisessa toiminnassa; ilman Y-tunnusta tulot ilmoitetaan OmaVerossa
kohtaan "Muut ansiotulot"; Y-tunnuksella elinkeinotoiminnan veroilmoitus
(Lomake 5, deadline 1.4., tehtävä vaikkei toimintaa). Alaikäisen veroasiat
hoitaa huoltaja OmaVerossa. Kuitteja ei liitetä, mutta säilytetään 6 vuotta.

---

## OSA 3 — PALVELUT, HINNAT JA YHTEYSTIEDOT

### Palvelut ja hinnat (esimerkkejä)

**Ikkunanpesu (pääpalvelu):** hinta talotyypin ja neliöalueen mukaan, kerrottuna
alueellisella kertoimella (postinumero).
- Omakotitalo < 60 m²: **139 €** (~90 € vähennyksen jälkeen)
- Omakotitalo 100–120 m²: **229 €** (~149 €)
- Omakotitalo 200–220 m²: **439 €** (~285 €)
- Rivitalo < 40 m²: **99 €** (~64 €)
- Palvelutasot: sisä+ulko 1.0×, vain ulko 0.58×, vuosipaketti (2×/v) 1.8× (−10 %)
- Lisäpalvelut: parveke-/terassilasitus **+39 €**, lasikaide **+39 €**, peilien
  pesu **+19 €**, terassin lasikate **+89 €**, rännien puhdistus **+69 €**
- **Talvikiilto™:** sisäpuolen täyspesu + ulkopintojen kuivapuhdistus (ei
  jäätymisriskiä)

**Hintalaskurin logiikka (laskuri.tsx):**
`hinta = (perushinta × palvelu-kerroin × vaikeuskertoimet) × aluekerroin`.
Aluekertoimia: Westend ×1.22, Suvisaaristo ×1.15, Haukilahti ×1.10, Tapiola/Otaniemi
×1.05, PK-seutu ×1.00, Espoo (oletus) ×0.88. Vaikeuskertoimet: korkeus 1.0–1.65×,
pääsy 1.0–1.25×, ikkunatyyppi 1.0–1.25×, likaisuus 1.0–1.40×.

**Piha & puutarha (nurmikon leikkuu):** < 50 m² 29 €/käynti … > 500 m² 119 €/käynti.
Kausialennukset 5–20 % (4–20 käyntiä; suositus 12 käyntiä = 15 %).

**Muut:** maalaus (tarjous paikan päällä), lumityöt (auraus/hiekoitus),
**auton sisäfreesaus** (Puuhapatet × KJ Cardetailing) **40 €/auto** (20–30 min,
kuivapesu). Lisätyöt 45 €/h + matkakulut.

### Yhteystiedot ja henkilöt

- **Sähköposti (yleinen):** info@puuhapatet.fi
- **Joonatan Juuri** — perustaja (HOST): joonatan@puuhapatet.fi, +358 400 389 999,
  Y-tunnus 3598782-9, IBAN FI49 5780 2420 5091 79 (BIC OKOYFIHH), Braskarna 8,
  02380 Espoo. Otaniemen lukio.
- **Matias Pitkänen** — perustaja (HOST): matias@puuhapatet.fi, +358 44 235 0881,
  Y-tunnus 3609912-9, Haapaniemenrinne 5A, 02940 Espoo. Otaniemen lukio.
- **Petrus Aalto** — tekijä (STAFF, grandfathered 30 %): petrus.aalto@icloud.com,
  +358 44 237 2930, Y-tunnus 3620983-4. Porkkalan lukio.
- **Jani Ihalainen** — tekijä (STAFF, dashboard-only).
- Kanavat: WhatsApp (nopein), Instagram (@puuhapatet), verkkolomake.

### Brändi-ilme (design_guidelines.md)

- **Värit:** pääväri metsänvihreä **#4A5D4F** (light #6B7F6E, dark #3A4D3F),
  tausta #FAFBFA, teksti #1A1F1E / #6B7570.
- **Typografia:** **Poppins** (400/500/600/700), skaala 12–48 px.
- **Tyyli:** "world-class minimalist", pohjoismainen minimalismi + Apple-henki.
  Ydin-identiteetti: **liquid glass -navigaatio** (mobiilissa alapalkki, työpöydällä
  yläheader). Pyöristykset (kortit 16 px, napit 12 px), pehmeät varjot, 8 px
  spacing-grid. "Enterprise-simple": selkeys ennen efektejä.

---

## OSA 4 — YMPÄRISTÖMUUTTUJAT (tarkoitukset, ei salaisuuksia)

| Muuttuja | Tarkoitus |
|----------|-----------|
| `DATABASE_URL` | PostgreSQL-yhteys (pakollinen) |
| `RESEND_API_KEY`, `FROM_EMAIL` | Sähköpostin lähetys (laskut, kuitit, yhteydenotot) |
| `ADMIN_EMAIL` | Yhteydenottojen vastaanottaja (oletus joonatan@puuhapatet.fi) |
| `AUTH_SECRET` | HMAC-allekirjoitus admin-tokeneille (pakollinen tuotannossa) |
| `ADMIN_DEFAULT_PASSWORD` | Starter-salasana (pakottaa vaihdon) |
| `WORKER_EMAILS`, `WORKER_JOONATAN_*`, `WORKER_MATIAS_*` | Ilmoitussähköpostit/nimet |
| `CALENDAR_TOKEN` | iCal-kalenterin suojaus (valinnainen) |
| `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID` | Google-arvostelut (valinnainen) |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | AI-chat (oletus Groq llama-3.3-70b) |
| `COMPANY_NAME`, `COMPANY_Y_TUNNUS`, `COMPANY_ADDRESS`, `COMPANY_EMAIL` | Käytetään kun brändi yhtiöitetään → laskun ostajaksi |
| `VITE_ADMIN_PASSWORD` | Asiakaspuolen kevyt admin-gate (ei turvaraja) |
| `NODE_ENV`, `PORT` | Ympäristö / portti (oletus 5000) |

---

## TIIVISTELMÄ YHDELLÄ SILMÄYKSELLÄ

- **Mikä:** Espoolainen ikkunanpesu- ja lasipinta­palvelu (+ piha, lumi, maalaus,
  autopesu). Brändi "Puuhapatet", slogan *"Ei säätöä. Puuhapatet hoitaa."*
- **Kuka:** Perustajat Joonatan Juuri & Matias Pitkänen (HOST, omat Y-tunnukset);
  tekijät kuten Petrus Aalto ja Jani Ihalainen (STAFF, itsenäisiä alihankkijoita).
- **Malli:** Brändi (ei vielä yhtiö), kaksi johtajaa laskuttavat asiakkaita;
  alihankkijat laskuttavat johtajaa omalla Y-tunnuksella. Palvelumaksu nettotulosta:
  HOST 10 %, uudet STAFF 35 %, grandfathered Petrus 30 %.
- **Järjestelmä:** React + Express + PostgreSQL; asiakassivusto (liidit) + iPad-admin
  (keikat, hinnoittelu, sopimukset+allekirjoitus, crew, laskutus, verotuloste).
- **Verot:** ALV 25,5 % (jos rekisterissä), ennakonpidätys 60 %/13 % (jos ei
  ennakkoperintärekisterissä); ALV-rajan (15 000 €) hallinta jakamalla laskutus.
