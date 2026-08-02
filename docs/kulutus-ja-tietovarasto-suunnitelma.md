# Kulutus ja tietovarasto — toimintasuunnitelma

Tämä dokumentti on suunnitelma sille, **mihin data säilötään ja miten
järjestelmä lakkaa lukemasta turhaa**. Se syntyi 2.8.2026, kun Neonin
siirtokiintiö loppui kesken ja kirjautuminen meni kiinni.

Tavoite on kaksiosainen eikä kumpaakaan saa uhrata toisen vuoksi:

1. **Kulutus alas** niin että ilmaistaso riittäisi normaalikäytössä, ja
   maksullisella tasolla lasku on pieni.
2. **Toiminnallisuus säilyy täytenä** — laskutus, tositteet, tekoäly,
   navigointi ja seuranta toimivat kuten tänään tai paremmin.

Sivutuotteena syntyy se mitä on erikseen toivottu: **selkeä
asiakirjavarasto**, jossa jokainen tosite on yhdessä loogisessa paikassa.

---

## 1. Tilannekuva (2.8.2026)

Neon Free, projekti `Puuhapatet.fi`, laskutuskausi alkoi **1.8.2026**:

| Mittari | Käytössä | Katto | Tila |
|---|---|---|---|
| **Network transfer** | **5,54 GB** | 5 GB | **100 % — kiintiö loppu, kanta kiinni** |
| Compute | 33,37 CU-hrs | 100 | 33 % — loppuisi ~5.8. |
| Storage | 0,03 GB | 0,5 GB | 6 % |
| History | 0 GB | — | tyhjä |

Kaksi asiaa on luettava tästä tarkkaan:

- **Muisti ei ole täynnä.** Storage 6 %, history 0. Aiempi arvaus että vika
  olisi kertyneessä historiassa oli **väärä**.
- **Kiintiö nollautui 1.8. ja paloi loppuun noin puolessatoista
  vuorokaudessa.** Polttonopeus on ~3,5 GB/vrk eli **~105 GB/kk — noin
  21-kertainen ilmaistason kattoon nähden.** Odottaminen ei siis ole
  ratkaisu: se ostaa vuorokauden.

---

## 2. Miksi — mekanismi

**Neon laskee liikenteeksi datan joka lähtee Neonista ulos**, eli
kyselytulokset kannasta sovellukselle (Render). Se ei ole sama asia kuin
liikenne Renderiltä selaimeen — se on Renderin oma kaista, jossa on 100 GB
ja käytössä alle prosentti.

Tämä on tärkeä ero, koska aiemmat korjaukset osuivat osin väärään
mittariin:

| Korjaus | Auttoi Renderin kaistaan | Auttoi Neonin kiintiöön |
|---|---|---|
| PR #399 — sarakeprojektiot (`CREW_JOB_COLS`, `MONEY_JOB_COLS`) | kyllä | **kyllä** |
| PR #400 — `stripObservationImages` | kyllä | ei — blobi tulee silti kannasta kokonaisena |
| PR #400 — tyhjän kirjoituksen esto | vähän | epäsuorasti (vähemmän WAL:ia) |
| PR #400 — pollin pysäytys piilossa | kyllä | **kyllä** |

Ratkaiseva rakenteellinen ongelma on tämä:

> **Kaikki iso data asuu `jobs`-rivin sisällä, ja jokainen kartan
> vuorovaikutus lukee koko rivin ulos kannasta.**

Yksi tekijän ikkunanapautus lukee `projectData`-blobin kokonaan — kaikkine
havaintokuvineen, kuitteineen ja dokumentteineen. Jos blobi on 3 MB ja
tekijä merkkaa sata ikkunaa tunnissa, se on **300 MB tunnissa yhdestä
puhelimesta**. Kaksi tekijää työpäivän ajan selittää havaitun 5,5 GB:n.

Pahinta on että se **kasvaa itsestään**: jokainen lähetetty lasku lisää
tositteen samaan blobiin, joten jokainen napautus maksaa ensi kuussa
enemmän kuin tänään. Tämä on eksponentiaalinen polku, ei tasainen.

---

## 3. Missä painot ovat

Kaikki alla oleva asuu tänään **`jobs`-taulun kahdessa tekstisarakkeessa**
(`project_data`, `gig_data`) tai `jobs`-rivin omissa sarakkeissa.

### `projectData` (ProjectData, `shared/project.ts`)

| Sisältö | Kattokoko / kpl | Määrä | Kasvaa? |
|---|---|---|---|
| `crew[].documents[]` — tositteet, laskut, vastalaskut | **1,5 MB** | rajaton | **kyllä, pysyvästi (6 v säilytys)** |
| `observations[].imageDataUrl` — havaintokuvat | 700 kB | ≤ 5000 | kyllä |
| `expenses[].receipt` — kulukuitit | 700 kB | — | kyllä |
| `crew[].payouts[].receipt` — maksukuitit | 700 kB | ≤ 100 | kyllä |
| `crew[].profile.photoUrl` | 150 kB | per tekijä | ei juuri |
| marks / statuses / washedBy / notes — **varsinainen työdata** | pieni | — | hitaasti |

### `gigData` (GigData, `shared/gig.ts`)

| Sisältö | Kattokoko |
|---|---|
| asiakkaan allekirjoitus-PNG | 300 kB |

### `jobs`-rivin omat sarakkeet

| Sarake | Kattokoko |
|---|---|
| `customer_signature` | 300 kB |
| `staff_signature` | 300 kB |
| `property_image_url` | 1 MB |
| `quote_video_url` | URL |

**Havainto:** varsinainen työdata — se mitä kartta oikeasti tarvitsee
piirtyäkseen — on murto-osa blobista. Loput on arkistoa, jota luetaan
käytännössä kerran.

---

## 4. Kuumat polut — mitä ne lukevat tänään

| Polku | Taajuus | Lukee | Tila |
|---|---|---|---|
| Tekijän ikkunanapautus (13 reittiä) | joka napautus | `projectData` + `gigData` | **kuuma, korjaamaton** |
| Asiakkaan `/seuranta` | 120 s, näkyvänä | `projectData` + `gigData` | **kuuma, korjaamaton** |
| Adminin karttatallennus | 700 ms debounce | koko `jobs`-rivi | **kuuma, korjaamaton** |
| **Tekoälyavustaja** (`buildAdminContext`) | joka viesti | **`db.select().from(jobs)` ilman projektiota × 200 riviä** | **korjaamaton — löydetty 2.8.** |
| Asiakkaan keikkalista (`routes.ts:1505`, `1771`) | sivulataus | koko `jobs`-rivi × n | korjaamaton |
| Täsmäytysajastin (30 min) | 48 / vrk | `{id, projectData}`, vain FR8 | korjattu #399 |
| Crew-token-haku | välimuistista | `CREW_JOB_COLS` | korjattu #399 |
| `/api/health` (keep-warm) | 5 min | ei mitään | ok |

`buildAdminContext` on oma lukunsa: se hakee 200 riviä **kaikkine
sarakkeineen** — molemmat allekirjoitus-PNG:t, kohdekuvan, videon,
molemmat blobit — vaikka se käyttää niistä murto-osaa. Yksi keskustelu
tekoälyn kanssa voi maksaa satoja megatavuja.

---

## 5. Tavoitearkkitehtuuri — mihin mikäkin kuuluu

Periaate: **kolme tasoa, ja kuuma taso ei koskaan koske kylmään.**

### Taso 1 — Kuuma työdata (Postgres, aina projektoitu)

Se mitä kartta ja näkymät tarvitsevat joka pyynnöllä: ikkunamerkinnät,
tilat, tekijät, hinnat, tunnit. Pysyy `projectData`ssa, mutta blobista
tulee **kevyt** — arviolta kymmeniä kilotavuja megatavujen sijaan.

### Taso 2 — Liitteet ja tositteet (uusi `job_assets`-taulu)

Uusi taulu, jota **ei koskaan lueta karttapyynnön yhteydessä**:

```
job_assets
  id            serial pk
  job_id        int  → jobs.id
  kind          text  'observation' | 'expense_receipt' | 'payout_receipt'
                    | 'crew_document' | 'crew_photo' | 'signature'
  ref_key       text  esim. 'K#12' (ikkuna) tai crew-jäsenen id
  mime          text
  bytes         int   koko, jotta UI osaa näyttää sen lataamatta
  data          text  base64 data URL
  created_at    timestamptz
  unique (job_id, kind, ref_key)
```

`projectData` säilyttää vain viitteen ja metatiedon (`hasImage`, koko,
aikaleima), ei itse dataa. Kuva haetaan avaimella vasta kun sitä
katsotaan — sama kuvio kuin PR #400:n `/observation-image`-reitti, mutta
nyt myös **kannan puolella**, ei vain selaimeen päin.

Storage ei ole ongelma (0,03/0,5 GB), joten binäärit saavat jäädä
Postgresiin. Ratkaisevaa on vain **ettei niitä lueta turhaan.**

### Taso 3 — Arkisto (Google Drive, olemassa jo)

Drive-varmuuskopiointi on jo rakennettu ja toimii
(`docs/google-drive-backup.md`, `drive_files`-taulu, idempotentit
kansiot). Se kattaa tänään asiakaslaskut, alihankkijalaskut, sisäiset
laskut ja kirjanpitoraportit.

**Tähän tulee se toivottu asiakirjavarasto.** Laajennetaan kattamaan
myös `crew_document`-tositteet ja kuitit, jolloin Drive-kansio on yksi
paikka josta tilintarkastaja löytää kaiken ilman sovellusta:

```
<juuri>/
  Laskut/2026/{Asiakaslaskut,Alihankkijalaskut,Sisäiset laskut}/
  Tositteet/2026/<tekijä>/            ← UUSI: crew_documents
  Kuitit/2026/<keikka>/               ← UUSI: kulu- ja maksukuitit
  Kirjanpito/<founder>/…
  Ennustelaskelmat/<founder>/…
```

Postgres on palveleva varasto (nopea, transaktionaalinen), Drive on
riippumaton arkisto. Kumpikaan ei ole toisen varassa.

---

## 6. Vaiheet

Järjestys on valittu niin että **suurin hyöty tulee ensin ja pienimmällä
riskillä.**

### Vaihe 0 — Pikavoitot ilman migraatiota (½ pv)

Ei skeemamuutoksia, ei datan siirtoa. Puhtaita projektioita.

1. `buildAdminContext` — projektio täyden rivin sijaan. Pudottaa
   allekirjoitukset, kohdekuvan ja videon 200 rivistä.
2. `routes.ts:1505` ja `1771` — asiakkaan keikkalistat projektioon.
3. Adminin karttatallennuksen luku projektioon.
4. Asiakkaan `/seuranta` — `gigData`sta vain se mitä seuranta näyttää.

**Arvioitu vaikutus: −40…60 % Neon-liikenteestä.** Ei toiminnallisia
muutoksia, ei riskiä.

### Vaihe 1 — `job_assets`-taulu ja kirjoituspolut (1 pv)

5. Taulu + auto-migraatio `server/index.ts`:ään (sama kuvio kuin
   `drive_files`).
6. Uudet liitteet kirjoitetaan `job_assets`iin, `projectData`an vain viite.
7. Lukupolut osaavat molemmat: viite → uusi taulu, vanha inline-data →
   blobista. Näin mikään ei hajoa ennen siirtoa.

### Vaihe 2 — Olemassa olevan datan siirto (½ pv)

8. Kertaluontoinen siirtoajo: `projectData`n inline-kuvat → `job_assets`,
   blobiin viite tilalle. Ajetaan kerran, idempotentti, peruutettavissa.
9. Siirron jälkeen `projectData` kutistuu — **tämä on se hetki jolloin
   kuuma polku halpenee.**

### Vaihe 3 — Arkiston täydennys (½ pv)

10. `crew_document`- ja kuittitositteet myös Driveen samalla
    `backupInvoicePdf`-kaavalla. Asiakirjavarasto valmis.

### Vaihe 4 — Ettei tämä toistu (½ pv)

11. **Sääntö:** `jobs`-taulua ei koskaan lueta ilman projektiota.
12. **Valvonta:** testi joka kaatuu jos `db.select().from(jobs)`
    esiintyy ilman sarakelistaa. Sääntö joka ei ole automaattisesti
    valvottu unohtuu — tämä on jo nähty.
13. Kevyt liikennemittari lokiin: mikä reitti luki montako tavua. Ilman
    mittaria seuraava vuoto löydetään taas vasta katosta.

**Kokonaisarvio: 3 työpäivää.**

---

## 7. Kustannusennuste

Nykyisellä rakenteella ~105 GB/kk. Vaiheiden jälkeen arvio:

| Erä | Arvio / kk |
|---|---|
| Karttapyynnöt (kevyt blobi) | 1–3 GB |
| Liitteiden katselu (harvoin, avaimella) | < 0,5 GB |
| Tekoäly (projektoitu konteksti) | < 0,5 GB |
| Kirjanpito ja raportit | < 0,5 GB |
| **Yhteensä** | **~2–4 GB/kk** |

Se mahtuu ilmaistason 5 GB:hen normaalikäytössä, ja maksullisella tasolla
lasku on lähellä perusmaksua ilman ylitemaksuja.

Compute (33 % kahdessa päivässä) laskee samalla, koska pienempi tulos
tarkoittaa lyhyempiä kyselyitä — ja pollin pysäytys piilossa (#400) antaa
computen mennä lepotilaan öisin.

---

## 8. Neon-paketti — vastaus kysymykseen

Ajatus «ostetaan kalliimpi tälle kuukaudelle ja palataan ilmaiseen kun
kuukausi on ohi» on **järkevä**, kolmella tarkennuksella:

1. **Se on ainoa tapa saada järjestelmä auki ennen 1.9.** Kiintiö on
   loppu; koodimuutos ei palauta jo kulutettua.
2. **Maksullisella tasolla ylitys ei estä — se laskutetaan.** Jos vuotoa
   ei korjata, ulos tulee lasku katkoksen sijaan. Siksi vaiheet 0–2 on
   tehtävä sen kuukauden aikana, ei sen jälkeen.
3. **Paluu ilmaiseen onnistuu** kun ollaan ilmaistason rajoissa. Storage
   0,03/0,5 GB ja haarat alle kymmenen, eli se ei ole este. Tarkista
   hinta Billing-näkymästä ennen ostoa — en pysty vahvistamaan
   hinnastoa tästä ympäristöstä.

---

## 9. Mitä EI muuteta

Jotta rajaus on selvä — nämä pysyvät ennallaan:

- Laskutuksen logiikka, laskunumerointi, viitenumerot, eräpäivät.
- Tasauslaskenta (`shared/founder-settlement.ts`) ja sen testit.
- Kirjanpidon kaksoiskirjanpito ja tositteiden 6 vuoden säilytys.
  **Mitään tositetta ei poisteta** — ne vain muuttavat paikkaa
  blobista omaan tauluunsa ja saavat Drive-kopion.
- Tekoälyavustajan kyvyt. Konteksti kevenee, ei kapene: se lukee samat
  kentät kuin ennenkin, ei vain allekirjoituskuvia joita se ei käytä.
- Käyttöliittymä. Havaintokuva näkyy edelleen, se vain latautuu
  napautuksesta.
