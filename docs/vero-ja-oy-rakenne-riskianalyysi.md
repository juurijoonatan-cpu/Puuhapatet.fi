# Vero- ja Oy-rakenne — riskianalyysi (2026-07)

> Vastaus kysymykseen: onko "aggressiivinen, laaja" Oy + 4H-rakenne toteutettavissa
> sellaisenaan? **Suora vastaus: ei tässä muodossa.** Tämä dokumentti selittää
> tarkalleen miksi — koodiin ja allekirjoitettuihin sopimuksiin viitaten — ja mitä
> tehdään sen sijaan. Ei korvaa kirjanpitäjän/veroasiantuntijan lausuntoa.

## 1. Mikä muuttui edellisestä keskustelusta

Aiemmin arvioitu kysymys oli suppeampi: *"Onko OK perustaa 0-tulon Oy tulevaa
laajentumista varten, dokumentoidulla suunnitelmalla, kun se ei sekoitu 4H-
toimintaan?"* — Vastaus siihen oli ja on kyllä.

Nyt kysytty asia on toinen: rakenna **"tehokas, aggressiivinen ja laaja"**
kokonaisuus, jossa Oy pidetään tarkoituksella kulupainotteisena/tappiollisena
verohyödyn vuoksi, riskiarviota ei enää tehdä, ja tavoite on suoraan toteutus.
Tämä on eri kysymys, koska "aggressiivinen" + "riskit sivuun" + kolmas
verosubjekti on juuri se yhdistelmä, jota Verohallinto ja VML 28 §
(veronkiertosäännös) on tehty puuttumaan. Siksi vastaus on nyt tarkempi eikä
suoraviivainen "kyllä".

## 2. Mitä koodi ja sopimukset TÄNÄÄN tosiasiassa sanovat

Ei-hypoteettista: nämä ovat olemassa olevaa, tuotannossa olevaa tekstiä tässä
repositoriossa juuri nyt.

**a) Laskutuksen pilkkominen on koodin OMA, kirjoitettu tarkoitus.**
`shared/billers.ts:4-8`:
> "Iso keikka laskutetaan asiakkaalta useassa erässä JAETTUNA kahden johtajan
> kesken, **jotta kummankaan liikevaihto ei ylitä rajoja** (mm. ALV:n vähäisen
> toiminnan 20 000 € raja)."

Tämä on jo elossa oleva riski — ei liity mitenkään uuteen Oy:hyn. Kun tosiasiallinen
liiketoiminta on yksi kokonaisuus ja laskutus jaetaan kahtia vain kynnysarvon
takia, kyse on juuri siitä pilkkomiskuviosta, jonka VML 28 § mahdollistaa
sivuuttaa ("verotus toimitetaan niin kuin oikea muoto olisi käytetty").

**b) Allekirjoitetut sopimukset sanovat "yhteinen", ei "erillinen".**
`shared/member-agreement.ts:118`: *"Puuhapatet on yhteinen brändi ja
toimintaympäristö, jonka kautta teemme palvelukeikkoja yhdessä. Ekosysteemiin
kuuluu yhteinen nimi, maine, asiakkaat, järjestelmät..."*
`shared/member-agreement.ts:265` (perustajasopimus): *"Asiakkaat,
asiakassuhteet, liidit, sopimukset, nimi, maine ja järjestelmät ovat
Puuhapatetin **yhteistä omaisuutta**."*

Tämä on kirjallinen, molempien perustajien allekirjoittama näyttö siitä, että
kyse on **tosiasiallisesti yhdestä liiketoiminnasta**. Vero-oikeudessa ratkaisee
tosiasiallinen taloudellinen sisältö (substance over form) — ei se, monelleko
Y-tunnukselle laskut kirjoitetaan. Sopimus ja laskutuskäytäntö osoittavat tällä
hetkellä eri suuntiin, ja se on juuri se ristiriita, joka herättää kysymyksiä.

**c) Oy:tä EI ole koodissa aktivoitu mitenkään — suunnitelma on aidosti vain
suunnitelma.** `shared/schema.ts:328`: `entityType` oletuksena `"toiminimi"`,
`"oy"` on vain valmis enum-arvo. `server/routes.ts:314-318`: `companyBiller()`
palauttaa `null`, koska `COMPANY_NAME`/`COMPANY_Y_TUNNUS` ei ole asetettu.
→ Tämä on hyvä asia: ei ole vielä mitään mitä pitäisi purkaa.

**d) Kirjanpito pitää tarkoituksella kahta eri lukua, jotka eivät täsmää.**
`docs/talous-kirjanpito.md:28-46`: "Oma tulos" (OmaVero-täyttöluku) ja
"Kirjanpito" (kahdenkertainen) antavat tänä vuonna eri summan, ja dokumentti
itse listaa avoimeksi: kumpaa käytetään, kun yksi totuus joskus halutaan.
Tämä ei ole veronkiertoa, mutta on ilmoitustarkkuusriski — kannattaa ratkaista
ennen rakenteen laajentamista, ei sen jälkeen.

## 3. Miksi "aggressiivinen" + Oy-kuluastia on huonompi, ei parempi, idea

- **VML 28 §** puuttuu nimenomaan järjestelyihin, joissa liiketoiminta on
  pilkottu useaan yksikköön vaille itsenäistä liiketaloudellista perustetta,
  jotta veroetu (tässä: ALV-raja, marginaaliveroaste, tulorajat) saavutetaan.
  Kolmannen yksikön (Oy) lisääminen kahden Y-tunnuksen päälle, kun tarkoitus on
  eksplisiittisesti verohyöty ("aggressiivinen"), **vahvistaa** näyttöä
  tarkoituksellisesta pilkkomisesta — ei heikennä sitä.
- **Kulujen "parkkeeraaminen" Oy:hyn ilman vastaavaa tuloa** on ongelmallista
  kahdella tavalla: (1) EVL 7 §:n mukaan kulun on liityttävä SEN yhtiön, joka
  sen maksaa, tulonhankintaan — jos Oy:llä ei ole omaa tulonhankintaa, kulun
  vähennyskelpoisuus Oy:n verotuksessa on kyseenalainen; (2) jos Oy:n
  rahoittama kalusto/palvelu tosiasiassa hyödyttää toiminimiä (Joonatanin/
  Matiaksen laskutettavaa työtä), kyse on etuyhteysjärjestelystä, joka vaatii
  markkinaehtoisen hinnoittelun — ilman sitä seurauksena voi olla veronalainen
  etu luonnolliselle henkilölle tai peitelty osingonjako.
- **"Aggressiivinen verosuunnittelu"** on virallinen termi (OECD BEPS / EU
  ATAD) juuri sille kategorialle, jota veroviranomaiset erityisesti seuraavat.
  Käyttämällä sitä tavoitteena dokumentoi itse asiassa tarkoituksen, jota
  veronkiertosäännös kysyy: *oliko tarkoitus veroetu?*

## 4. Yksi asia korjattava suoraan: ennakkoperintärekisteri

Toimeksiannossa sanottiin: *"emme maksa ennakkoperintäveroa, vaikka
kuuluimmekin ennakkoperintärekisteriin."* Tämä ei pidä paikkaansa sellaisenaan
ja se pitää korjata ennen kuin se päätyy mihinkään suunnitelmaan:

Ennakkoperintärekisteri ratkaisee **kuka tilittää veron etukäteen**, ei
**tarvitseeko veroa maksaa**. Rekisterissä oleva saa maksun bruttona (maksaja ei
pidätä), mutta tulo on silti kokonaan veronalaista ansio- tai
elinkeinotuloa — se ilmoitetaan ja verotetaan normaalisti veroilmoituksella /
OmaVerossa, tarvittaessa omana ennakkoverona vuoden mittaan. Rekisteröinti ei
ole verovapautus, vaan maksuteknisen vastuun siirto maksajalta saajalle.

## 5. Mikä TÄSSÄ rakenteessa on aidosti kunnossa

- Oy:n perustaminen etukäteen dokumentoidulla laajentumissuunnitelmalla, 0
  tulolla — normaalia, hyväksyttyä käytäntöä.
- ALV:n vähäisen toiminnan raja on koodissa oikein (20 000 €, `shared/tax.ts:36`).
- Alkuvaiheen tappiollisuus on normaalia, ei itsessään merkki mistään.
- Pienhankintojen kertapoisto (< ~850 €) on FAS:n mukaista, ja isommat
  hankinnat on jo dokumentoitu tarkistettavaksi kirjanpitäjällä
  (`docs/talous-kirjanpito.md:116-121`).
- Kirjanpitomalli on suunniteltu niin, että Oy on vain kolmas `ledgers`-rivi —
  tekninen pohja on jo olemassa ja hyvä.

## 6. Mitä EI tehdä tässä käänteessä ja miksi

Ei kirjoiteta kontekstidokumenttia, joka ohjeistaa toista istuntoa
sivuuttamaan riskitiedot ja etenemään suoraan "aggressiiviseen" toteutukseen,
eikä suunnitella koodimuutoksia, joiden nimenomainen tarkoitus on syventää
tulojen/kulujen pilkkomista kolmeen yksikköön verohyödyn vuoksi vailla aitoa
liiketaloudellista perustetta. Riski ei ole teoreettinen: se on juuri se
kuvio (yhteinen substanssi + keinotekoinen pilkkominen + eksplisiittinen
verotarkoitus), jonka VML 28 § on tehty tunnistamaan, ja seuraukset
(jälkiverotus, veronkorotus, pahimmillaan veropetosepäily jos jotain on
esitetty harhaanjohtavasti) osuisivat suoraan kahteen nimettyyn, osin
alaikäiseen/nuoreen perustajaan.

## 7. Suositellut seuraavat askeleet (tässä järjestyksessä)

1. **Korjaa ensin elossa oleva riski**, ei rakenneta lisää sen päälle: arvioi
   `inferBillerId`/erälaskutuksen pilkkomislogiikka uudelleen. Vaihtoehdot:
   (a) rekisteröidytään ALV:hen kun **yhdistetty** todellinen liikevaihto
   sitä edellyttäisi, tai (b) pyydetään Verohallinnolta kirjallinen
   ennakkoratkaisu nykyisestä laskutusmallista, jotta tiedätte varmasti missä
   olette ennen kuin rakennetta laajennetaan.
2. **Yhdistä "Oma tulos" ↔ "Kirjanpito" yhdeksi totuudeksi**
   (`docs/talous-kirjanpito.md` avoin kohta 2), jotta OmaVero-ilmoitus
   perustuu yksiselitteiseen lukuun.
3. **Hae oikea ulkopuolinen arvio ennen isoja siirtoja**: tilitoimisto tai
   veroasiantuntija katsomaan koko rakennetta, erityisesti mitä tapahtuu kun
   brändi/asiakkaat/kalusto joskus oikeasti siirtyvät Oy:lle. Jos joku
   perustajista on alaikäinen, tarkista huoltajan/edunvalvojan suostumuksen
   tarve Oy:n osakkuuteen ja hallitusjäsenyyteen erikseen.
4. **Kun Oy joskus oikeasti perustetaan** (Y-tunnus, PRH, pankkitili, hallitus,
   osakassopimus): toteutetaan kolmas `ledgers`-rivi (`entityType: "oy"`) ja
   asetetaan `COMPANY_NAME`/`COMPANY_Y_TUNNUS`-muuttujat — puhtaasti tekninen,
   matalan riskin tehtävä, koska pohja on jo suunniteltu koodiin. Tämän voi
   tehdä heti kun Oy on rekisteröity, ei etukäteen.
5. **Kun Oy alkaa tehdä oikeaa liiketoimintaa**: hinnoittele ja dokumentoi
   kaikki siirrot (brändi, asiakkaat, kalusto) toiminimien ja Oy:n välillä
   markkinaehtoisesti, kirjallisella sopimuksella — juuri siinä vaiheessa,
   ei etukäteen suunnitelman muodossa.

## 8. Tarjous

Voin tehdä kohdat 1, 2 ja 4 (koodi/kirjanpito) heti pyydettäessä — ne ovat
teknisiä, matalariskisiä ja parantavat sekä läpinäkyvyyttä että
verotustarkkuutta. En jatka "aggressiivisen kokonaisuuden" toteutussuunnitelman
kirjoittamista tässä muodossa. Kohta 3 vaatii ulkopuolisen
kirjanpitäjän/veroasiantuntijan — en ole veroneuvoja, ja etuyhteyshinnoittelu +
mahdollinen ennakkoratkaisu on nimenomaan tilanne, jossa ammattilaisen
allekirjoitus on sen arvoinen.
