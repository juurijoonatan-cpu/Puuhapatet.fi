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

`/admin/new-gig` (AdminNewGigPage) on **ainoa** näkymä joka luo urakkakeikan
(`isCustomGig: true`). Yhdellä lähetyksellä syntyy neljä asiaa:

1. **asiakas** (`customers`-rivi, `customerType` = yritys tai ry)
2. **keikka** (`jobs`-rivi + `gigData`-blobi + `quoteToken`)
3. **karttablobi** (`projectData`, leimattuna `dealKind: "none"`)
4. **asiakaslinkki** `/seuranta/<token>`

Asiakkaan yhteyshenkilö tallentuu `customers.name`iin ja organisaation nimi
`customers.companyName`iin. Huomaa että laskutus- ja sopimuspolut lukevat
**`GigData.company`-objektia**, eivät `customers`-taulun yrityskenttiä — ne
kaksi eivät ole kytköksissä toisiinsa.

#### Lomake kenttä kentältä

Lomake on kolmessa osassa: ensin **valinnat** jotka ratkaisevat muun muodon,
sitten **tiedot**. Jokaisen kentän alla on sama selite myös käyttöliittymässä.

| Kohta | Kenttä | Mitä siihen laitetaan | Vaikutus |
|---|---|---|---|
| Keikan laji | **Korvaus** \* | `Maksullinen` tai `Yhteisökeikka` | Yhteisökeikalla kaikki hinnat ovat 0 €, `agreedPrice` = 0, eikä asiakas näe euroja missään. |
| ” | **Tilaaja** \* | `Yritys` tai `Yhdistys (ry)` | `customers.customerType` + `GigData.company.entityType`. `isYritys` on tosi molemmilla. |
| ” | **Asiakasnäkymän ilme** | `Vaalea` / `Tekninen` | `GigData.customerTheme`. Vaihdettavissa myöhemmin. |
| Laajuus | **Malli** \* | `Pohjakuva & ikkunat` tai `Sektorit käsin` | Ks. "Kaksi hinnoittelumallia" alla — tämä ei ole makuasia. |
| Pohjakuvamalli | **Kerrokset / tilat** \* | pilkkulista, esim. `K, 1, 2` tai `Tila` | `building.floors`. Yksi nimi = yksi pohjakuva = yksi laskutussektori. |
| ” | **Yksikön nimi** | `tila`, `siipi`, tyhjä = kerros | `building.unitWord`. Ohjaa sekä kartan otsikkoa että laskutussektorin nimeä. |
| ” | **Ikkunoita arviolta** \* | kokonaisluku | Etenemän nimittäjä ennen kuin kartta on piirretty; tarkentuu itsestään. |
| ” | **Hinta / ikkuna** \* | € (piilossa yhteisökeikalla) | `pricePerWindow`. Keikan **ainoa** ikkunahinta. |
| ” | **Tuntia / ikkuna** | esim. `1,5`, vapaaehtoinen | `estimatedHoursPerWindow` → tehokkuusnäkymän ETA. |
| Sektorimalli | **Sektorin nimi / väri** | laskun rivin nimi | Näkyy asiakkaalle. |
| ” | **Määrä** \* | sovittu laajuus | Asiakas maksaa vain tehdyistä. |
| ” | **Hinta / yksikkö** \* | € (piilossa yhteisökeikalla) | |
| Laskutus | **Laskuta n. joka** | yksikkömäärä | Muistutus, ei automatiikkaa. Piilossa yhteisökeikalla. |
| Tilaaja | **Nimi** \* | virallinen nimi | Sopimus, lasku, asiakaslinkki, keikkalista. |
| ” | **Yhteyshenkilö** | ihminen | `customers.name`. Eri asia kuin organisaation nimi. |
| ” | **Y-tunnus** | `1234567-8` | Myös yhdistyksellä on Y-tunnus. |
| ” | **Sähköposti / puhelin** | | Tyhjä puhelin tallentuu muodossa `-`. |
| ” | **Osoite / kohde** | työn tekopaikka | Myös `building.address`. |
| ” | **Laskutustiedot** | verkkolaskuosoite, viite | Vain sisäinen. |
| Sopimus | **Sopimustunnus** | esim. `PT-2026-02` | Sopimusdokumentti + lasku. |
| ” | **Työn kuvaus** | keikan nimi listoissa | Tyhjä = `"<nimi> — sopimuskeikka"`. |
| ” | **Sopimusteksti** | koko teksti sellaisenaan | Tiimille, ei asiakkaan seurantaan. |
| ” | **Allekirjoitus** \* | `Ensin sopimus` tai `Sopimus myöhemmin` | Ks. "Milloin asiakas allekirjoittaa" alla. |
| ” | **ALV-huomautus** | oletus = vähäisen liiketoiminnan lauseke | Vaihtuu automaattisesti yhteisökeikan tekstiin jos sitä ei ole itse muokattu. |
| ” | **Asiakkaalle näkyvä viesti** | | Seurantalinkin yläosa. |
| Tekijät | **Tekijät** | ketkä pääsevät keikalle | `assignedTo` + asiakkaan `ownedBy`. |

\* = pakollinen. Nappi kertoo nimeltä mikä puuttuu ("Puuttuu: tilaajan nimi,
hinta / ikkuna") — ei enää yhtä yleistä lausetta joka oli usein väärä.

#### Kaksi hinnoittelumallia

Järjestelmässä on kaksi **aitoa** mallia, ja väärä valinta hukkaa työtä:

- **Pohjakuva & ikkunat.** Palvelin JOHTAA laskutussektorit kartasta
  (`syncGigSectorsFromProject`) heti kun kartalla on yksikin ikkuna: yksi
  sektori per kerros, yksi yhteinen ikkunahinta. Käsin syötetyt sektorit
  **korvataan**, joten niitä ei tässä mallissa edes kysytä. Perustuksessa
  kirjataan yksi arviosektori (arvioitu ikkunamäärä), jotta asiakasnäkymällä on
  etenemän nimittäjä jo ennen kartan piirtämistä.
- **Sektorit käsin.** Ei pohjakuvaa: jokainen sektori on oma määrä ja oma
  yksikköhinta. Jos tällaiselle keikalle myöhemmin merkitään ikkunoita
  kartalle, sektorit korvautuvat kerroskohtaisilla.

#### Milloin asiakas allekirjoittaa

Kolme tilaa, ja ne ovat oikeasti kolme. Aiemmin niitä yritettiin ilmaista yhdellä
rastilla ("Vaadi sähköinen allekirjoitus"), ja kolmas jäi tilaksi jossa asiakas ei
nähnyt sopimusta lainkaan.

| Tila | Asiakkaan linkki | Kentät |
|---|---|---|
| **Ensin sopimus** | avautuu allekirjoitukseen; seuranta vasta sen jälkeen | `requireSignature: true` |
| **Seuranta auki, sopimus popuppina** | seuranta heti; sopimus nousee siihen dialogina | `requireSignature: false`, sopimus olemassa |
| **Sopimus myöhemmin** | seuranta heti; ei sopimusta vielä | `contractLater: true` |

Perustuslomake tarjoaa kaksi ensimmäistä (`Ensin sopimus` / `Sopimus myöhemmin`);
keikan **Sopimus**-kortista pääsee kaikkiin kolmeen, ja sieltä sopimus liitetään
kun se valmistuu.

**Yksi vastaus, ei kolme päättelyä:** `signaturePrompt(gig)` (`shared/gig.ts`)
palauttaa `"none" | "gate" | "popup"`, ja sekä asiakasnäkymä, palvelimen julkinen
projektio (`signPrompt`) että keltaisten porttiehto lukevat sitä. Ennen tätä
jokainen näkymä päätteli tilan itse kahdesta kentästä, ja siitä syntyi kolme vikaa:

1. sopimustekstin liittäminen jälkikäteen käänsi koko sivun portin päälle ja
   heitti seurantaa katsovan asiakkaan takaisin lomakkeelle ilman selitystä,
2. jos portti otettiin pois mutta sopimus oli olemassa, asiakas ei nähnyt
   sopimusta missään eikä voinut allekirjoittaa sitä,
3. keltaisten hyväksyntä ja vastatarjous (rahaan vaikuttavat toiminnot) avautuivat
   heti kun portti oli pois päältä — myös silloin kun sopimus oli
   allekirjoittamatta. Nyt ehto on `signaturePrompt(gig) !== "none"`.

`contractLater` voittaa aina: kun sopimus tehdään myöhemmin, koko sivun portti ei
mene päälle asiakkaan alta missään vaiheessa.

**Popupin käytös:** ponnahtaa kerran (kuittaus muistetaan `localStorage`issa
avaimella `pp.contract.<token>.<contractId>`, joten korjattu sopimus nousee kerran
uudelleen), ja sopimukseen pääsee sen jälkeen aina nappirivin "Lue ja allekirjoita
sopimus" -napista. Sisältönä on sama `GigContractSign` modaalimuodossa — ei toista
toteutusta samasta lomakkeesta. Allekirjoituksen jälkeen palvelin lakkaa
lähettämästä `signPrompt`ia, joten kehote ei voi palata.

#### Sopimusasiakirja: PDF vai teksti

Sopimus voi olla keikalla **kahdessa muodossa**, ja molemmat kelpaavat
allekirjoitettavaksi:

| Muoto | Kenttä | Mihin se tallentuu | Mitä asiakas näkee |
|---|---|---|---|
| **PDF-tiedosto** (suositus) | `GigData.contractFile` | `job_assets`-taulu, viite blobissa | sivut kuvina puhtaassa syvennyksessä + tarkka lukukerros + lataus omalla nimellä |
| **Sopimusteksti** | `GigData.contractText` | gigData-blobi | teksti auki näkymässä + koottu sopimusdokumentti |

**Liittäminen:** keikan **Sopimus & asiakasnäkymä** -kortti → *Sopimus tiedostona
(PDF)* → *Valitse PDF-tiedosto*. Tallentuu heti valittaessa (ei "Tallenna
sopimus" -napin takana, jota painamatta juuri valittu tiedosto olisi hukkunut).
Enintään noin 5 MB.

**Yksi kysymys, yksi vastaus:** `hasContractDoc(gig)` kertoo onko keikalla
asiakirja — tiedosto TAI teksti. `signatureRequired`, `signaturePrompt` ja
`contractPending` lukevat kaikki sitä. Ennen tätä ne kysyivät `contractText`iä
kolmessa paikassa erikseen, ja kolmesta rinnakkaisesta ehdosta se joka jäisi
jälkeen tuottaisi keikan jolla on sopimus mutta jota ei voi allekirjoittaa —
tai asiakkaan joka näkee sopimuksensa ja sen vieressä lupauksen että sopimus
toimitetaan lähipäivinä.

**Liitetty tiedosto sammuttaa "Sopimus valmistelussa" -huomautukset** kaikkialta
kerralla (otsikkorivin tilamerkki, huomautusnauha, "Tiedotteet ja ohjeet"
-kappale, adminin varoitus). Se on koko pointti: sopimus on toimitettu.

**Allekirjoituksen jälkeen tiedostoa ei voi vaihtaa eikä poistaa** (409). Asiakas
allekirjoitti juuri sen asiakirjan, ja toisen pudottaminen sen tilalle olisi
allekirjoitus asiakirjaan jota kukaan ei ole hyväksynyt. Asiakas saa sen
jälkikäteen napista **Lataa sopimus (PDF)**; sen viereinen koottu dokumentti
nimetään silloin **allekirjoitustodistukseksi**, jottei kaksi eri asiakirjaa ole
saman nimen takana.

##### Lukupinta: sivut kuvina, ei selaimen PDF-laatikkoa

Liitetty PDF **rasteroidaan sivukuviksi latausvaiheessa** (pdf.js perustajan
selaimessa), ja asiakas lukee ne `<img>`-sivuina syvennyksessä. Alkuperäinen
tiedosto säilytetään aina — se on se jonka asiakas lataa.

Ensimmäinen toteutus käytti `<object type="application/pdf">` -upotusta, ja sen
oma kommentti myönsi ongelman: *"puhelimessa monisivuinen sopimus on siinä
neulansilmä — moni selain ei myöskään vieritä upotettua PDF:ää lainkaan."*
Kiertotienä oli "Avaa koko näytöllä" -linkki, joka luovuttaa asiakkaan selaimen
omalle näyttäjälle kesken sopimuksen lukemista. Sivukuvilla:

- piirtyvät **joka selaimessa samalla tavalla**, myös iOS Safarissa;
- eivät tarvitse **JS:ää** eivätkä **CORSia** (`<img>` ei tarvitse, `fetch`
  tarvitsisi — ja API on eri origin kuin sivusto);
- ovat sivun **normaalissa virrassa**: asiakas vierittää sopimuksen läpi ja
  allekirjoitus on sen alla, kuten paperilla. Ei sisäkkäistä vieritystä — kaksi
  vieritystä samassa eleessä on juuri se mikä saa upotetun dokumentin tuntumaan
  rikkinäiseltä. Pitkän asiakirjan yli pääsee napista *"Siirry
  allekirjoitukseen ↓"*.

**Asiakkaan nide ei kasva.** Mitattu julkaisusta: `pdf-raster` on oma 372 kB:n
siru (109 kB gzip) jonka importtaa VAIN `gig-tracker`; `gig-live`issä siihen on
nolla viittausta. Rasterointi on kertaluonteinen työ perustajan koneella —
mitattuna 0,8 s ja 1,6 MB nelisivuiselle sopimukselle (JPEG 1400 px, q 0,86).

**Tarkka lukeminen:** sivun napautus avaa sen omaan kerrokseen, oletuksena
ruudulle **sovitettuna** ja yhdellä napautuksella **1:1** (1400 px). 1:1
oletuksena avautui 390 px:n ruudulla noin neljäsosaan sivun leveydestä ilman
mitään vihjettä sivuttaisvierityksestä, ja se luki rikkinäiseltä.

**Sivumäärä on valinnainen** (`contractFile.pages`). Ennen rasterointia
liitetyillä sopimuksilla sitä ei ole, ja ne saavat entisen upotuksen
muuttumattomana — uudelleenliittäminen tuo sivut. Admin näyttää tilan suoraan:
*"4 sivua selattavana"* tai *"ei sivukuvia (liitä uudelleen…)"*.

**Rasterointi ei saa estää liittämistä:** jos se kaatuu (vioittunut tai
salasanasuojattu PDF), sopimus liitetään silti ilman sivuja. Puolittainen
lukupinta on parempi kuin ei sopimusta.

**Sivut kirjoitetaan yhdessä transaktiossa ja ENNEN `contractFile`-viitettä.**
Viite on se joka kytkee sopimuksen päälle (`hasContractDoc`), joten keskeytynyt
lataus ei saa jättää allekirjoitusporttia päälle ilman luettavia sivuja. Ilman
transaktiota katkos kesken kirjoitusta jättäisi kantaan kaksi sopimusta
limittäin: uuden alkusivut ja vanhan loppusivut.

**Vain rasterikuvat kelpaavat sivuiksi** (JPEG/PNG/WebP), ja vastauksissa on
`X-Content-Type-Options: nosniff`. Pelkkä `data:image/` päästäisi läpi myös
`data:image/svg+xml`, ja SVG on skriptattava dokumentti jonka reitti palauttaisi
`image/svg+xml`-otsakkeella.

**Miksi kantaan eikä `client/public/`iin:** `client/public/` on julkinen
verkkosivu ja tämä repo on julkinen. FR8:n vanha `contracts/PT-2026-02.pdf` on
committattu sinne — se on **perintötapaus, ei malli**: kenen tahansa luettavissa
ilman linkkiä eikä poistettavissa versiohistoriasta. Kannassa oleva tiedosto on
asiakkaan oman tokenin takana (`GET /api/gig/:token/contract-file`), ja token
rajaa sen yhteen keikkaan.

**Serverin omistama kenttä:** `contractFile` syntyy ja katoaa vain
`/contract-file`-reiteillä. `PATCH /api/jobs/:id/gig` (sopimuslomakkeen tallennus)
palauttaa talletetun viitteen, koska lomakkeen kopiossa blobista sitä ei ole —
ilman sitä sopimuksen liittäminen olisi kestänyt seuraavaan tallennukseen asti.
Sama sääntö kuin projektin `p2`/`scope`/`planImages`-kentillä; vartija:
`server/server-owned-fields.test.ts`.

#### Sopimusarvon sääntö

`jobs.agreedPrice` on perustettaessa **positiivinen** maksullisella keikalla
(arvio × hinta, tai sektorien katto) ja **nolla** yhteisökeikalla. Keikkalista
`/admin/gigs` lukee nollan yhteisökeikan tunnusmerkiksi, koska se ei lue
raskaita blobeja — jos maksullinen keikka syntyisi nollalla, se näkyisi
listalla vastikkeettomana. Palvelin laskee arvon uudelleen joka
projektitallennuksessa, joten arvio korjautuu itsestään.

### 2. Projekti ja pohjakartta

Avaa keikka → **Asetukset** (`GigToolsOverlay` → "Pohjakartat & asetukset").

> **Pohjakuva ei näkynyt adminille 2026-08 asti.** Adminin API tunnistautuu
> `Authorization: Bearer` -otsakkeella, ja `<img src>` ei voi lähettää
> otsaketta — joten `GET /api/jobs/:id/plan/:floor` palautti 401:n ja juuri
> ladattu pohjakuva näkyi rikkinäisen kuvan merkkinä ("?"). Kuva oli tallessa
> koko ajan; sitä ei vain voinut näyttää. Adminin kuva haetaan nyt fetchillä ja
> tarjoillaan object-URLina (`client/src/lib/authed-image.ts`). Asiakkaan ja
> tekijän reitit ovat julkisia (token polussa) eivätkä koskaan olleet rikki.
> Samalla poistui `<img src="">`: tyhjä osoite lataa nykyisen sivun ja piirtyy
> sekin rikkinäisenä kuvana, joten pohjakuvaton kerros näytti rikkinäiseltä
> vaikka mitään ei ollut ladattu.
>
> **Valkoinen paperitausta.** Talon kuvat ovat vaaleaa viivaa LÄPINÄKYVÄLLÄ
> pohjalla, ja koko ketju on rakennettu sille: adminin tumma kartta näyttää
> kuvan sellaisenaan, asiakkaan vaalea kartta kääntää sen (`invert(1)`, joka ei
> koske läpinäkyvyyteen). Puhelimella kaapattu pohjapiirros on valkoisella
> paperilla ja on tumman kartan päällä iso kirkas arkki. Latauksessa on nyt
> valinta **"Poista valkoinen tausta"** (oletus päällä): tausta poistetaan
> levittämällä kuvan REUNOISTA sisäänpäin, joten huoneiden sisällä olevat
> vaaleat tekstit ja mitat säilyvät — "kaikki valkoinen pois" olisi syönyt ne.
> Tulos tallentuu PNG:nä, koska JPEG ei kanna alfakanavaa.

> **Tämä näkymä oli rikki 2026-08 asti** ja jäi ikuisesti tekstiin "Ladataan…":
> latausefektin `loading` oli sekä varhaisen paluun ehto ETTÄ riippuvuus, joten
> `setLoading(true)` laukaisi efektin siivouksen, joka perui kesken lentävän
> pyynnön. Vastaus heitettiin pois eikä `setLoading(false)` päässyt ajoon. Portti
> on nyt `useRef`, joka ei ole riippuvuus. Samalla korjautui yläpalkki, joka oli
> koko sovelluksen ainoa joka ei varannut `env(safe-area-inset-top)`:ia —
> takaisin-nappi oli puhelimen kellon alla. Vartijat:
> `client/src/fr8-shell-hygiene.test.ts`.
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

Projekti (`project_data`) **syntyy jo perustuksessa**: `/admin/new-gig`
kirjoittaa sen heti keikan luonnin jälkeen, leimattuna `dealKind: "none"`
(`newGigProjectData()`, ks. alla) ja täytettynä niillä tiedoilla jotka lomake
juuri kysyi (nimi, osoite, kerrokset, yksikön nimi, ikkunahinta, tuntiarvio).
Asetuksissa siis **täydennetään** projektia, ei luoda sitä tyhjästä — käytännössä
sinne jää vain pohjakuvien lataus.

Jos projektin kirjoitus epäonnistuu, keikka on silti olemassa ja toimii: näkymä
kertoo siitä ("Keikka luotu, kartan alustus ei") ja kaikki kentät ovat
muokattavissa Asetuksista.

### 3. Ikkunapisteet kartalle

Projektinäkymä → **Kartta**-välilehti → `+` → "Punainen piste" / "Keltainen
piste" → klikkaa pohjakuvaa. Lisäystila jää päälle, joten jokainen seuraava
piste on yksi klikkaus. Pisteitä siirretään "Siirrä pisteitä" -tilassa ja
poistetaan "Poista piste" -tilassa.

**Zoom ja panorointi toimivat myös lisäystilassa.** Ne olivat aiemmin
jäädytettyjä juuri silloin kun niitä eniten tarvitsee (pieneen huoneeseen ei osu
tarkasti jos siihen ei pääse lähemmäs): `FloorView`:n
`onSceneWheel`/`onSceneTouchStart`/`onSceneTouchMove` palasivat heti kun
`editMode` oli päällä. Panorointi ei jätä jälkeensä pistettä — `onPlanClick`
tarkistaa `pannedRef`in ja ohittaa napautuksen jos sormi liikkui.

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

### Asiakkaan työmäärämittari

Asiakkaan seurantanäkymässä arvio näkyy omana mittarina (`WorkloadGauge`):
240°:n segmentoitu kaari, jonka **asteikko on tunteja** (0 h → koko keikan
arvio) eikä prosentteja. Se ei ole toinen prosenttirengas — pääkortti vastaa
"kuinka pitkällä", tämä vastaa "paljonko työtä on jäljellä".

Palvelin lähettää julkiseen näkymään **vain kertoimen**
(`estHoursPerWindow`), ei kokonaistunteja. Syy: selain laskee edistymisensä
`customerProgress`illa, joka jättää laajuuden ulkopuoliset keltaiset pois. Jos
palvelin laskisi kokonaistunnit `computeProjectTotals`in ikkunajoukosta,
mittari ja edistymisluku voisivat olla eri mieltä samasta keikasta. Yksi
kerroin, ja selain kertoo sillä ne ikkunat jotka se itse näyttää.

**Toteutuneita työtunteja ei lähetetä asiakkaalle koskaan** (`totalHours`,
`actualHoursPerWindow`): ne ovat tekijän palkan peruste.

## Laajuuskysely — yhteisökeikan "pestäänkö tämä"

Asiakkaan seurantanäkymässä keltainen ikkuna on **kysymys**, ei piste: asiakas
napauttaa sitä ja vastaa **Pestään** / **Ei tarvitse**. Vastauksen voi vaihtaa,
ja saman napautus peruu sen.

### Miksi tämä ei ole P2

`p2` on hintaneuvottelu. Sen tilakone, sanitoija ja laskutus pyörivät
sentteinä:

- `validPrice` (shared/p2.ts) vaatii `priceCents > 0`;
- `sanitizeP2State` **pudottaa** tarjouksen jonka hinta on ≤ 0 — eli
  nollahintainen tarjous katoaisi joka tallennuksessa.

Vastikkeettomalla keikalla nolla on **oikea** hinta, joten P2:ta ei voi
käyttää, ja sen taivuttaminen tarkoittaisi rahan tilakoneen muuttamista — jota
FR8:n maksava urakka käyttää samaan aikaan. Kysymys on myös eri: P2 kysyy
"kelpaako tämä hinta", laajuuskysely kysyy "pestäänkö tämä". Siksi tässä ei ole
versioita, lukituksia, tapahtumalogia eikä ehtoja.

### Rakenne

| Paikka | Mitä |
|---|---|
| `ProjectData.scope.votes[key]` | `{ answer: "yes" \| "no", at, by? }` |
| `sanitizeScopeState` | tuntematon vastaus → **ääni pudotetaan** (ei arvausta) |
| `scopeSummary(project)` | `yes` / `no` / `open` / `total` — vain **elävistä** keltaisista |
| `POST /api/gig/:token/scope` | asiakkaan vastaus (`{ key, answer }`; `null` peruu) |
| `GigPublicView.scope` | `{ votes }` — vain vastaus, ei aikaleimaa eikä nimeä |
| `CrewWorkerView.scopeVotes` | sama tekijälle → merkki kartalla |

`scope` on **serverin omistama** kenttä kuten `p2`/`guided`/`settlement`:
asiakas kirjoittaa siihen omalta reitiltään, joten geneerinen blob-tallennus
lukee kannan tuoreimman arvon juuri ennen kirjoitusta (`saveProject`,
`scopeMutation`). Ilman sitä tekijän ikkunanapautus pyyhkisi asiakkaan
vastauksen.

### Ehdot

- **Vain yhteisökeikalla** (`isCommunityGig`). Maksavalla keikalla laajuus ja
  hinta sovitaan yhdessä, ja se mekanismi on P2. Kaksi rinnakkaista
  laajuuskanavaa samalla keikalla = kaksi eri vastausta kysymykseen "mitä
  pestään".
- **Ei jos P2 on päällä.** Palvelin ei lähetä `scope`a silloin, ja selain
  varmistaa saman (`scopeOn = !!scope && !p2On`).
- **Ei allekirjoitusporttia eikä tilausehtoja.** Vastaus ei sido asiakasta
  rahaan, joten sen takana ei ole mitään mitä allekirjoitus suojaisi — ja
  sopimus voi olla vielä valmistelussa, jolloin laajuuden kertominen on
  hyödyllisintä.
- Pestyä ikkunaa **ei voi rajata pois** (`answer: "no"` → 409). Työ on tehty.

### Vastaus muuttaa laajuutta

`inCustomerScope` ottaa hyväksytyn keltaisen mukaan työhön. Se on koko kyselyn
tarkoitus: prosentti, ikkunamäärä **ja työmääräarvio** lasketaan samasta
joukosta, joten hyväksyntä näkyy heti kaikissa kolmessa. Ilman `scope`a
funktion käytös on **täsmälleen entinen** (keltaiset laajuuden ulkopuolella) —
sama funktio laskee FR8:n maksavan urakan luvut.

`customerProgress` palauttaa lisäksi `scopeOpen` (montako odottaa vastausta) ja
`scopeYes` (montako hyväksytty). Ne ohjaavat pääkortin ruudut ja
huomautusnauhan.

### Tekijä näkee vastauksen

Merkki pisteen päälle `FloorView`ssä (`scopeVotes`): vihreä ✓ = pestään,
harmaa – = ei pestä. **Merkki, ei uusi väri** — tämä on asiakkaan toive, ei
ikkunan tila, eivätkä ne kaksi saa näyttää samalta. Ilman tätä asiakkaan
vastaus jäisi järjestelmän sisään eikä ohjaisi työtä, mikä on kyselyn ainoa
tarkoitus.

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
2. ~~`GET /api/admin/my-dashboard` palauttaa ensimmäisen osuman.~~
   **KORJATTU:** reitti palauttaa nyt `gigs[]` — kaikki keikat joilla
   kirjautunut on tekijänä — ja etusivu listaa ne erikseen. Yhden osuman
   arvonta on poissa.
3. **Julkinen tiimilista** (`/api/team-roster`) yhdistää tekijät **kaikilta**
   keikoilta ja dedupoi `linkedUserId || etunimi` -parilla. Uuden keikan
   tekijät ilmestyisivät julkiselle /meistä-sivulle, ja saman henkilön
   uudelleen-onboardaus toisella keikalla ylikirjoittaisi rosteririvin.
4. **Kaikki "kaikki keikat" -kyselyt** (`routes.ts`: crew-tokenit,
   my-dashboard, tiimilista, `reconcileMissingPayoutSyncs` 30 min välein)
   lukevat yhden `project_data`-blobin **per keikka**. Jokainen uusi keikka
   kasvattaa niiden siirtokustannusta lineaarisesti.
5. ~~Ei keikkalistaa eikä keikanvalitsinta.~~ **KORJATTU:** `/admin/gigs`
   listaa urakkakeikat (käynnissä auki, valmiit ja peruutetut dropdownien
   takana), rahaluvut liitettynä perustajille. **Jäljellä:** `Section.tsx`:n
   kokoontilat (`fr8.section.<id>`) eivät ole keikkakohtaisia, joten osion
   sulkeminen yhdellä keikalla sulkee sen myös toisella samassa selaimessa.
6. **`eraRecipientFounderId`** palauttaa kovakoodatut `"joonatan"`/`"matias"`
   ja haarautuu erän numerolla 4 — mikä tahansa toinen keikka joka käyttäisi
   erälaskutusta reitittyisi FR8:n laskutusjärjestelyyn.
7. **`FOUNDER_IDS`** ohjaa oikeuksia suoraan, ei keikan crew-listan kautta.
8. **Tekijän kovakoodattu ovikoodi ja apunumerot** (`worker.tsx`) näkyvät joka
   keikalla. Sattuu olemaan oikein niin kauan kuin keikat ovat samassa
   rakennuksessa.
9. **Sopimus-PDF:n sivumäärää ei lueta tiedostosta.** Asiakkaalle näytetään
   tiedoston koko; ainoa "N sivua" -teksti on FR8:n staattisella PDF:llä, jonka
   sivumäärä on tiedossa vakiona.
10. **Upotettu PDF on selaimen varassa.** `<object>` ei vieritä monisivuista
    sopimusta kaikissa mobiiliselaimissa, minkä takia vieressä on aina "Avaa
    koko näytöllä" -linkki. Omaa PDF-näyttäjää (pdf.js) ei ole.

## Verifiointi

```
npm run check   # tsc — pitää olla täysin puhdas
npm test        # vitest (shared/*.test.ts + server-vartijat)
npm run build   # vite + esbuild (import.meta-varoitus server/static.ts on vanha)
```

Repossa **ei ole CI:tä PR-tasolla** (`deploy.yml` ajaa vain main-pushilla), joten
nämä ajetaan käsin ennen PR:ää.
