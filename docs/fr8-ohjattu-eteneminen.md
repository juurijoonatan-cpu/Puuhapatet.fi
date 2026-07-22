# FR8 — ohjattu eteneminen (yks kerros kerrallaa)

## Miksi

Isolla keikalla (paljon ikkunoita, monta kerrosta) tekijöillä on houkutus poimia
helpoimmat/halvimmat ikkunat sieltä täältä. Se on epäreilua muita kohtaan ja
jättää vaikeat ikkunat roikkumaan. **Ohjattu eteneminen** tasapuolistaa työn:
edetään **yks kerros kerrallaa**, muut kerrokset ovat lukossa, ja dashboard ohjaa
jokaisen tekijän **seuraavaan yksittäiseen ikkunaan** aktiivisella kerroksella.

Perustajan päätökset (jotka tämä toteutus lukitsee):

- **Opt-in per keikka, oletuksena POIS.** Ilman kytkintä mikään ei muutu — kartta
  on täysin auki kuten ennen.
- **Ei vaikeustasoja.** Vaikeus luetaan hinnasta: kalliimpi keltainen = vaikeampi =
  isompi palkkio (ks. `docs/fr8-p2-hinnoittelu.md`). Tasoja ei tarvita.
- **Sääntöpohjainen, deterministinen ohjaus** (ei LLM:ää): "seuraava ikkuna" on
  yksinkertaisesti ensimmäinen pesemätön piirissä oleva ikkuna aktiivisella
  kerroksella vakaassa järjestyksessä.
- **Founder saa pakottaa kerroksen** (override), mutta oletuksena kerros etenee
  automaattisesti.

## Datamalli (`shared/guided.ts`, tila `ProjectData.guided`)

Vain kytkin + kerroksen ohitus talletetaan; kaikki muu JOHDETAAN kartasta.

```ts
interface GuidedWork {
  enabled: boolean;                    // founder-kytkin, oletus false
  activeFloorOverride?: string | null; // pakotettu kerros; voimassa vain jos siellä on työtä
}
```

Johdettu tila (`computeGuided(data): GuidedState`) on **puhdas funktio** kartan +
p2-tilan yli — mitään ei tallenneta:

```ts
interface GuidedState {
  enabled: boolean;
  activeFloor: string | null;   // ainoa auki oleva kerros (null = ei työtä / kaikki valmis)
  overrideActive: boolean;      // aktiivinen kerros tuli founderin pakotuksesta
  lockedFloors: string[];       // kerrokset joilla on työtä mutta jotka eivät ole aktiivisia
  openKeys: string[];           // piirissä + aktiivisella kerroksella + pesemättä
  nextKey: string | null;       // yksi seuraava ikkuna ("Seuraavaksi"-kortti)
  next: GuidedNext | null;      // {key,floor,p,x,y,status}
  floorProgress: GuidedFloorProgress[]; // per kerros: inScope/washed/remaining/active/locked/complete
  remainingOnActive: number;
  totalInScope: number; washedInScope: number; allComplete: boolean;
}
```

### Työn piiri (in-scope)

- **Punainen (P1) on AINA piirissä.**
- **Keltainen (P2) on piirissä vain kun sen hinta on lukittu** ja vaihe 2 on
  päällä (`isP2Washable`, `shared/p2.ts`). Hinnoittelematon/lukitsematon keltainen
  ei kuulu piiriin (eikä sitä muutenkaan saa pestä ennen lukitusta).

### Aktiivinen kerros

`activeFloor` = ensimmäinen kerros `building.floors`-järjestyksessä, jolla on vielä
**pesemättömiä piirissä olevia** ikkunoita.

- Etenee automaattisesti: kun kerros valmistuu, seuraava kerros aktivoituu.
- **Hyppää takaisin** jos aiempi kerros saa uutta piirissä olevaa työtä (esim.
  keltainen lukitaan tai jo pesty ikkuna tyhjennetään) — silloin se kerros on
  taas "ensimmäinen kesken oleva".
- **Override**: `activeFloorOverride` voittaa, MUTTA vain jos se nimeää oikean
  kerroksen jolla on pesemätöntä piirissä olevaa työtä; muuten palataan
  automaattiseen valintaan (esim. jos pakotettu kerros on jo valmis).

### Seuraava ikkuna (sweep-järjestys)

`nextKey` = aktiivisen kerroksen pesemättömistä piirissä olevista ikkunoista
ensimmäinen tässä vakaassa järjestyksessä:

1. **kesken ennen ei-aloitettua** — aloitettua ikkunaa ei jätetä roikkumaan,
2. **ylhäältä alas** (`y` nouseva),
3. **vasemmalta oikealle** (`x` nouseva),
4. avain (`key`) tasapelin ratkaisijana → sama kartta antaa aina saman jonon.

## Pesuportti (server)

`POST /api/crew/:token/window` (server/routes.ts): kun `guided.enabled` ja ikkunan
kerros **ei ole aktiivinen kerros**, merkintä (`pesty`/`kesken`) estetään
**403**:lla selkokielisellä viestillä ("Tämä kerros on vielä lukossa…"). Portti
tulee P2-pesuportin JÄLKEEN, joten molemmat pätevät. Rajat:

- **Tyhjennys (`"ei"`) sallitaan aina** — virheen voi perua. Tyhjennys aiemmalta
  kerrokselta tekee siitä taas aktiivisen (auto-eteneminen), jolloin sen voi pestä
  uudelleen.
- **Ei aktiivista kerrosta** (kaikki valmis / ei työtä) → portti ei estä mitään.
- **Guided pois** → portti ei estä mitään (nykyinen käytös).

`isGuidedBlocked(data, key)` (shared/guided.ts) on tämän portin puhdas ydin — se
palauttaa `false` aina kun guided on pois tai aktiivista kerrosta ei ole.

## Samanaikaisuus — guided on serverin omistama

Kuten p2, `guided` on serverin omistama: geneeriset tallennukset
(`PATCH /api/jobs/:id/project`, `saveProject`) EIVÄT ota `guided`ia clientiltä —
serveri liittää talletetun kopion takaisin. Ainoa mutaatioreitti on
**`POST /api/jobs/:id/guided`** `{enabled?, activeFloorOverride?}` (admin-suojattu,
override validoidaan rakennuksen kerroksia vasten). Näin karttamuokkaus tai
tekijän merkintä ei voi vahingossa muuttaa ohjausasetusta.

## Näkymät

- **Perustaja** (`admin/project.tsx` → `GuidedAdminPanel`, dashboardin P2-osion
  vieressä): kytkin (oletus pois), kerroksen pakotus (dropdown, "Automaattinen"),
  aktiivisen kerroksen kortti ja kerroskohtainen edistymislista (klik → hyppää
  kartalla ko. kerrokseen). Admin-kartta (`FloorView`) näyttää myös lukot +
  seuraavan ikkunan renkaan esikatseluna (admin itse EI ole portin takana —
  perustaja voi aina korjata karttaa).
- **Tekijä** (`worker.tsx` → `GuidedCard` kartan päällä + `FloorView`): "Seuraavaksi"
  -kortti näyttää aktiivisen kerroksen, montako ikkunaa jäljellä ja "Näytä ikkuna"
  -napin (hyppää kerrokselle ja korostaa seuraavan ikkunan sykkivällä renkaalla).
  Lukitut kerrokset floor-selectorissa harmaana 🔒-merkillä (katsominen sallittu,
  merkintä ei). Jos tekijä yrittää merkata lukittua kerrosta, serverin 403-viesti
  näkyy kortissa hetken.
- Data tekijälle: `workerView.guided` (server) = `{enabled, activeFloor,
  lockedFloors, openKeys, nextKey, next, remainingOnActive, allComplete,
  floorProgress}`. Puhtaasti johdettua ohjaustietoa — **ei rahaa** (turvallista
  näyttää tekijälle).

## Yhteensopivuus & testit

`guided` on valinnainen kenttä: ilman sitä (tai `enabled:false`) pesuportti ei
estä mitään, `computeGuided` palauttaa disabloidun tilan, eikä UI:hin tule mitään.
Ei DB-migraatiota. Kattavat testit: **`shared/guided.test.ts`** (aktiivisen
kerroksen valinta + eteneminen + takaisinhyppy, in-scope punainen/lukittu keltainen,
sweep-järjestys + kesken-etusija, override kelpo/valmis/tuntematon, pesuportti,
sanitointi).

## Miten laajentaa myöhemmin

- **Vaikeustasot (jos joskus halutaan)**: hinta koodaa vaikeuden jo nyt. Jos
  eksplisiittiset tasot halutaan, lisää esim. `tier?: 1|2|3` `ProjMark`iin +
  sanitointi, ja käytä sitä `sweepOrder`issa tai erillisessä "reilu jako"
  -raportissa. Nykyinen malli ei sitä tarvitse.
- **Työntekijäkohtainen ohjaus** (eri tekijöille eri ikkunat samalla kerroksella):
  laajenna `computeGuided` ottamaan `workerId` ja jaa `openKeys` tekijöiden kesken.
  Nyt ohjaus on kerroskohtainen ja jaettu (kaikki näkevät saman "seuraavan").
- **Kerroksen sisäinen reititys** (fyysinen kulkujärjestys): korvaa `sweepOrder`
  esim. lähimmän naapurin heuristiikalla `x/y`-koordinaateista.
