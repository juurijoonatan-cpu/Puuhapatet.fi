# Uusi asiakas ja uusi keikka — mitä tehdään ja missä järjestyksessä

> Tämä dokumentti on **käytännön ohje** uuden keikan perustamiseen ja samalla
> kirjaus siitä, **mikä järjestelmässä on FR8-kohtaista ja mikä yleistä**. Jos
> jatkat tätä työtä (ihminen tai agentti), lue ensin
> `docs/fr8-jarjestelma-yleiskuva.md` — se on koko FR8:n yleiskuva. Tämä
> dokumentti kertoo mitä tapahtuu kun keikkoja on **enemmän kuin yksi**.

## Lähtökohta: FR8 on yksi keikka, ei järjestelmä

Rakenne kesti tämän jo ennen kuin toista keikkaa oli:

- Keikka on **`jobs`-rivi** jolla on `is_custom_gig = true` ja kaksi
  JSON-blobia (`project_data`, `gig_data`). Ei singleton-riviä, ei "sen FR8:n
  id:tä" missään vakiona.
- Reitit ovat jo keikkakohtaisia: `/admin/gig/:id`, `/admin/gig/:id/projekti`,
  `/admin/gig/:id/tiimi`, `/seuranta/:token` (asiakas), `/tyo/:token` (tekijä).
- Laskenta on `shared/`issa puhtaina funktioina jotka saavat projektin
  parametrina.

Mitä **ei** kestänyt, ja mikä on nyt korjattu, on lueteltu alempana kohdassa
"Mikä oli FR8-kohtaista".

## Keikan perustaminen — vaiheet

### 1. Asiakas ja keikka

`/admin/new-gig` (AdminNewGigPage) luo asiakkaan ja keikan samalla kertaa. Se
on **ainoa** näkymä joka asettaa `isCustomGig: true` clientistä. Se vaatii
tällä hetkellä yrityksen nimen ja että joka sektorilla on `total > 0` ja
`unitPriceCents > 0` — eli **maksullisen keikan muodon**. Yhteisökeikka
(alla) asetetaan sen jälkeen keikan asetuksista.

Asiakkaan yhteyshenkilö tallentuu `customers.name`iin ja yrityksen nimi
`customers.companyName`iin. Huomaa että laskutus- ja sopimuspolut lukevat
**`GigData.company`-objektia**, eivät `customers`-taulun yrityskenttiä — ne
kaksi eivät ole kytköksissä toisiinsa.

### 2. Projekti ja pohjakartta

Avaa keikka → **Asetukset** (`GigToolsOverlay` → "Pohjakartat & asetukset").
Täältä asetetaan:

| Asetus | Kenttä | Huom |
|---|---|---|
| Rakennuksen nimi ja osoite | `building.name`, `building.address` | |
| Kerrokset / tilat | `building.floors` | Yhden huoneen keikka = yksi alkio |
| Tilan nimi | `building.unitWord` | Esim. `"tila"`, jottei lue "1. kerros" |
| Pohjakuva per kerros | `building.planImages[kerros]` | **Ladataan kuvana**, ks. alla |
| Kuvan esitystapa | `building.planRender` | `"photo"` ruudunkaappaukselle |
| Hinta / ikkuna | `pricePerWindow` | 0 vain yhteisökeikalla |
| Korvaustapa | `compensation` | `"community"` = ei rahaa |
| Tuntiarvio / ikkuna | `estimatedHoursPerWindow` | Esim. `1.5` |

Projekti (`project_data`) syntyy laiskasti: se luodaan kun
`/admin/gig/:id/projekti` avataan ensimmäisen kerran. Silloin siihen leimataan
`dealKind: "none"` (`newGigProjectData()`), ks. alla.

### 3. Ikkunapisteet kartalle

Projektinäkymä → **Kartta**-välilehti → `+` → "Punainen piste" / "Keltainen
piste" → klikkaa pohjakuvaa. Lisäystila jää päälle, joten jokainen seuraava
piste on yksi klikkaus. Pisteitä siirretään "Siirrä pisteitä" -tilassa ja
poistetaan "Poista piste" -tilassa.

**Zoom ja panorointi ovat pois päältä lisäystilassa** (`FloorView`:
`onSceneWheel`/`onSceneTouchStart`/`onSceneTouchMove` palaavat heti kun
`editMode` on päällä). Asiakaskartalla ne on tarkoituksella jätetty päälle;
adminin kartalla tätä ei ole vielä muutettu.

### 4. Linkit

- **Asiakas**: `quoteToken` → `/seuranta/:token`. Kopioidaan keikkanäkymästä.
- **Tekijä**: crew-token per tekijä → `/tyo/:token`. Luodaan Tiimi-näkymästä.

Huom: `jobs.quoteToken`illa **ei ole unique-indeksiä**, ja `GET /api/gig/:token`
ottaa ensimmäisen osuman. Tokenit generoidaan selaimessa (8–10 merkkiä
`Math.random`ia), joten törmäys näyttäisi yhdelle asiakkaalle toisen keikan.
Tätä ei ole vielä korjattu.

## Pohjakuvan lataus

Ennen tätä pohjakuvan sai järjestelmään **vain committaamalla PNG:n
`client/public/`iin ja julkaisemalla frontendin uudelleen**: `planBase` on
polkuetuliite ja kuva haettiin muodossa `<planBase><kerros>.png`.

Nyt kuva ladataan asetuksista. Toteutus:

| Osa | Missä |
|---|---|
| Liitelaji `floor_plan` | `server/assets.ts` (`AssetKind`, `MAX_PLAN_IMAGE_LEN`) |
| Talletus / poisto / luku | `putAsset`, `deletePlanImage`, `getPlanImage` |
| Viite blobissa | `ProjBuilding.planImages[kerros]` = `job_assets`-rivin id |
| Osoitteen muodostus | `planImageUrl(building, floor, urlBase)` — **jaettu** |
| Admin-reitit | `POST`/`DELETE`/`GET /api/jobs/:id/plan/:floor` |
| Asiakas | `GET /api/gig/:token/plan/:floor` |
| Tekijä | `GET /api/crew/:token/plan/:floor` |

Kolme lukureittiä, koska kolme yleisöä tunnistautuu eri tavalla. Kaikki
palauttavat **raa'an kuvan** oikealla `Content-Type`illa + ETagilla (304
uusintapyynnöille), jotta `<img src>` toimii ja selain välimuistittaa kuvan.

**Kaksi sääntöä joita ei saa rikkoa:**

1. **Kuva ei koskaan asu karttablobissa.** Blobi luetaan joka
   ikkunanapautuksella ja joka asiakkaan pollauskierroksella — juuri se poltti
   Neonin siirtokiintiön kertaalleen (ks. yleiskuvan "Säilytys ja
   siirtokiintiö"). Blobiin jää vain id.
2. **`planImages` on serverin omistama** kuten `p2`/`guided`/`settlement`:
   geneerinen blob-tallennus säilyttää talletetun kopion. Ilman tätä
   asetusnäkymän vanhentunut luonnos pyyhkisi juuri ladatun kuvan.
   `saveProject` poimii sen samasta `jsonb`-projektiosta kuin muut kolme, joten
   kuumalle polulle ei tule ylimääräistä blobin lukua.

Julkiset reitit ovat `PUBLIC_API`-listalla. **Tämä ei ole valinnaista:** ilman
riviä portti vastaa 401, selain tulkitsee sen vanhentuneeksi admin-sessioksi ja
heittää asiakkaan meidän kirjautumisruudullemme. Sama aukko oli aiemmin
`observation-image`illa. Vartija: `server/public-api-coverage.test.ts`.

## Yhteisökeikka (0 €)

Nolla **ei ollut esitettävissä**: sanitoija muutti sen takaisin oletushinnaksi
(`clampNonNeg(...) || DEFAULT_PRICE_PER_WINDOW`) ja neljä laskentakohtaa toisti
saman maskin. Vastikkeeton keikka näytti siis 35 €/ikkuna -keikalta, ja
`PATCH /project` kirjoitti siitä johdetun summan `jobs.agreedPrice`iin.

Nyt `ProjectData.compensation = "community"`:

- hinta on aidosti **0**, eikä varakäytäntöä sovelleta
  (`pricePerWindowOf` — **yksi** paikka, korvasi neljä `|| DEFAULT`-riviä);
- gig-sektorit ovat 0 €, eikä `agreedPrice`ia kirjata lainkaan;
- asiakas **ei näe euroja missään muodossa**: sektorikortit ja P2:n
  "Kertynyt"-tiili ovat `isCommunity`-lipun takana, ja oletusteksti kertoo
  yhteisökeikasta eikä "sovitusta kiinteästä kokonaishinnasta";
- tekijälle ei luvata ikkunakohtaista korvausta.

**Tavallisen keikan nollahinta putoaa yhä oletukseen** — vahinkonollaa ei saa
syntyä pelkästä tyhjästä kentästä.

### Mitä yhteisökeikka EI vielä tee

- `CrewMember.perWindowCents` **ei voi olla 0** (`clampCents` hylkää nollan ja
  palauttaa 20 €). Tekijän taksa on siis olemassa vaikka keikasta ei liiku
  rahaa; näkymä ei näytä sitä, mutta luku on blobissa.
- `expenses`-tauluun kirjattu kulu **päätyy kirjanpitoon** myös
  yhteisökeikalta (`server/finance/post.ts` ei suodata keikkatyypillä). Jos
  yhteisökeikalle kirjataan kuitti, se pienentää laskuttajan verotettavaa
  tulosta.
- `/api/stats` ja `/api/workers/stats` eivät suodata `isCustomGig`ia. Ne
  lukevat `agreedPrice`ia, joka on yhteisökeikalla 0, joten liikevaihtoon ei
  tule mitään — mutta rivi näkyy verotulosteen listassa 0,00 €:na jos keikka
  merkitään valmiiksi.

## Tuntiarvio

`ProjectData.estimatedHoursPerWindow` (esim. `1.5` isolle monilohkoiselle
ikkunalle) → `computeEfficiency` palauttaa:

| Kenttä | Merkitys |
|---|---|
| `estHoursPerWindow` | annettu arvio |
| `estTotalHours` | kaikki ikkunat × arvio |
| `estRemainingHours` | pesemättömät × arvio |
| `actualHoursPerWindow` | **toteutuma** kirjatuista tunneista (`tunnit / pestyt`) |

Ilman arviota kaikki neljä ovat `null` — mikään näkymä ei keksi lukua tyhjästä.
Pelkkä suunnittelutieto: ei vaikuta rahaan eikä palkkoihin.

## Mikä oli FR8-kohtaista — ja mikä siitä on korjattu

| Asia | Ennen | Nyt |
|---|---|---|
| Allekirjoitettu 6300 €:n urakka | kiinnittyi keikkaan jos `planBase` sisälsi `"/fr8/"` (vapaa tekstikenttä, paikkamerkki `/fr8/plans/bp-`) | `ProjectData.dealKind`: `"fr8"` / `"none"` / puuttuva = vanha polkuhaku |
| Keikan asetukset | `FloorSetupTool` oli valmis mutta **kuollutta koodia** — mikään ei importannut sitä | keikkanäkymän **Asetukset**-nappi |
| Pohjakuva | vain staattinen tiedosto + uudelleenjulkaisu | lataus per kerros |
| P2-sopimus-PDF | globaali vakio, näkyi **jokaisen** keikan asiakkaalle | vain FR8:lle, jonka sopimus se on |
| "Maksuerä 1/4 · 1 575 €" | näkyi jokaisen keikan tekijälle | vain kun keikalla on erälaskutus |
| "FR8 on ensimmäinen yhteinen keikkamme" | jokaisen keikan tekijälle | keikkaneutraali |
| Kerroksen nimi | `"K" → "Kellari"`, muuten `"N. kerros"`, kopioituna moneen paikkaan | jaettu `floorLabel(building, floor)` + `unitWord` |
| Kuvan esitys | `invert(1)` + 2 % rajaus aina | `planRender: "plan" \| "photo"` |

### `dealKind` — miksi puuttuva arvo on tarkoituksellinen

```
"fr8"   → allekirjoitettu urakka, polusta riippumatta
"none"  → ei kiinteää urakkaa
puuttuu → vanha polkuhaku (isFr8Plans)
```

FR8:n talletettu blobi **ei sisällä kenttää**, joten se round-trippaa
identtisesti eikä migraatiota tarvita (invariantti 7). Uusi keikka leimataan
`"none"`ksi kun sen ensimmäinen projekti luodaan.

`emptyProjectData()` **ei leimaa** `dealKind`iä, koska sitä käytetään myös
latausvirheen varakopiona (`GigToolsOverlay`) — `"none"` siellä olisi voinut
riisua FR8:n urakan jos varakopio tallennetaan olemassa olevan päälle. Uusille
keikoille on erillinen `newGigProjectData()`.

## Mitä on vielä tekemättä (tiedossa olevat aukot)

Nämä eivät estä keikan perustamista, mutta ne kannattaa tietää:

1. **`quoteToken`illa ei ole unique-indeksiä** eikä palvelinpuolen generointia
   (`POST /api/jobs`). Törmäys näyttäisi väärän keikan.
2. **`GET /api/admin/my-dashboard`** käy läpi kaikki keikat ilman
   järjestystä ja palauttaa **ensimmäisen** osuman. Kun perustaja on tekijänä
   kahdella keikalla, admin-kirjautuminen voi ohjata satunnaisesti väärään
   työpöytään.
3. **Julkinen tiimilista** (`/api/team-roster`) yhdistää tekijät **kaikilta**
   keikoilta ja dedupoi `linkedUserId || etunimi` -parilla. Uuden keikan
   tekijät ilmestyisivät julkiselle /meistä-sivulle, ja saman henkilön
   uudelleen-onboardaus toisella keikalla ylikirjoittaisi rosteririvin.
4. **Kaikki "kaikki keikat" -kyselyt** (`routes.ts`: crew-tokenit,
   my-dashboard, tiimilista, `reconcileMissingPayoutSyncs` 30 min välein)
   lukevat yhden `project_data`-blobin **per keikka**. Jokainen uusi keikka
   kasvattaa niiden siirtokustannusta lineaarisesti.
5. **Ei keikkalistaa eikä keikanvalitsinta.** Keikat löytyvät vain
   `/admin/jobs`-listalta. `Section.tsx`:n kokoontilat (`fr8.section.<id>`)
   eivät ole keikkakohtaisia, joten osion sulkeminen yhdellä keikalla sulkee
   sen myös toisella samassa selaimessa.
6. **`eraRecipientFounderId`** palauttaa kovakoodatut `"joonatan"`/`"matias"`
   ja haarautuu erän numerolla 4 — mikä tahansa toinen keikka joka käyttäisi
   erälaskutusta reitittyisi FR8:n laskutusjärjestelyyn.
7. **`FOUNDER_IDS`** ohjaa oikeuksia suoraan, ei keikan crew-listan kautta.
8. **Tekijän kovakoodattu ovikoodi ja apunumerot** (`worker.tsx`) näkyvät joka
   keikalla. Sattuu olemaan oikein niin kauan kuin keikat ovat samassa
   rakennuksessa.

## Verifiointi

```
npm run check   # tsc — pitää olla täysin puhdas
npm test        # vitest (shared/*.test.ts + server-vartijat)
npm run build   # vite + esbuild (import.meta-varoitus server/static.ts on vanha)
```

Repossa **ei ole CI:tä PR-tasolla** (`deploy.yml` ajaa vain main-pushilla), joten
nämä ajetaan käsin ennen PR:ää.
