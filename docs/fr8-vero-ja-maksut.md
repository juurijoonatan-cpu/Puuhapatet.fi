# FR8 — Alihankkijan vero- ja maksulogiikka

Tämä dokumentti kuvaa, miten Puuhapatet maksaa itsenäiselle alihankkijalle
(ikkunanpesijälle) ja miten alihankkijan lasku Puuhapatetille muodostuu —
**oikein Suomen lain mukaan, mahdollisimman yksinkertaisesti.**

> ⚠️ Tämä on huolellisesti laadittu malli, mutta **tarkistuta lopullinen toteutus
> kirjanpitäjällä / verotoimistolla** ennen suuria volyymejä. Logiikka on koodattu
> yhteen paikkaan: [`shared/tax.ts`](../shared/tax.ts).

## Kuka laskuttaa kenet — brändi, ei (vielä) yhtiö

Puuhapatet **ei ole vielä juridinen yhtiö**, vaan brändi, jota pyörittää **kaksi
johtajaa, joilla on omat Y-tunnukset** (Joonatan 3598782-9, Matias 3609912-9).

- **Asiakas → johtaja:** iso keikka laskutetaan asiakkaalta **useassa erässä,
  jaettuna kahden johtajan kesken**, jotta kummankaan liikevaihto ei ylitä rajoja
  (mm. ALV:n vähäisen toiminnan 15 000 €). Kukin asiakaslasku tallentaa, **kuka
  johtaja** sen lähetti (`GigPayment.biller`).
- **Alihankkija → johtaja:** alihankkija (esim. Jani) laskuttaa **sitä johtajaa,
  joka laskutti asiakkaan tästä erästä**. Eli alihankkijan laskun **OSTAJA** =
  kyseinen johtaja (nimi + Y-tunnus + osoite), ei abstrakti "Puuhapatet".

Tekninen toteutus: laskuttajat ovat [`shared/billers.ts`](../shared/billers.ts)
(`BRAND_BILLERS`). Maksua luotaessa admin valitsee ostajan (oletus: kirjautunut
johtaja). Valinta tallentuu `CrewPayout.buyer`-tilannekuvaan ja päätyy laskun
ostajatietoihin. Lasku lähetetään automaattisesti **sekä tiimille että
alihankkijalle itselleen** (hänen tositteensa).

**Yhtiöityminen myöhemmin:** aseta `COMPANY_NAME` + `COMPANY_Y_TUNNUS` (+
`COMPANY_ADDRESS`, `COMPANY_EMAIL`) → yhtiö tulee valittavaksi ostajaksi ilman
muutoksia laskulogiikkaan. Ostaja on aina `Biller`-objekti (johtaja tänään, yhtiö
huomenna).

## Lähtökohta: työkorvaus, ei palkka

Alihankkija toimii itsenäisenä yrittäjänä (kevytyrittäjä, toiminimi tai yhtiö) ja
laskuttaa työstään omalla Y-tunnuksellaan. Maksu on **työkorvausta**, ei palkkaa,
joten Puuhapatetille ei synny työnantajavelvoitteita (ei TyEL:iä, ei
sairausajan palkkaa jne.). Tämä on kirjattu sitovasti
[`Alihankkijasopimukseen`](../shared/worker-agreements.ts).

`payout.amountCents` = **työkorvaus ilman ALV:tä** (pestyt ikkunat × ikkunahinta).

## Kaksi veroasiaa, jotka ratkaisevat maksun

### 1. Ennakkoperintärekisteri → ennakonpidätys (tärkein!)

Ennakkoperintälain mukaan, kun yritys maksaa työkorvausta toiselle:

| Saajan tila | Maksaja toimii näin |
|---|---|
| **ON ennakkoperintärekisterissä** | Maksaa **bruttona**, ei pidätä mitään. Saaja hoitaa verot itse. |
| **EI OLE rekisterissä** (luonnollinen henkilö / toiminimi) | **Pidättää ennakonpidätyksen**: verokortin % tai **60 %** ilman korttia. |
| **EI OLE rekisterissä** (Oy, Ky, Ay…) | Pidättää **13 %**. |

**Miksi tämä on kriittistä:** jos Puuhapatet maksaa bruttona rekisteröimättömälle,
**Puuhapatet on itse vastuussa pidättämättä jääneestä verosta.** Siksi
oletuksena pidätetään 60 %, kunnes työntekijä ilmoittaa olevansa rekisterissä.

Ennakonpidätys lasketaan **työkorvauksesta ilman ALV:tä**. ALV:stä ei koskaan pidätetä.
Pidätetty määrä tilitetään Verolle ja luetaan työntekijän hyväksi hänen verotuksessaan.

➡️ Tuote ohjaa jokaisen työntekijän rekisteröitymään maksutta osoitteessa **ytj.fi**
— silloin hän saa koko summan tilille.

### 2. Arvonlisävero (ALV)

| Saajan ALV-asema | Lasku |
|---|---|
| **ALV-rekisterissä** | Lisää yleisen kannan **25,5 %** (voimassa 1.9.2024 alkaen). |
| **Vähäinen toiminta** (AVL 3 §, alv. ~15 000 € / 12 kk) | Ei ALV:tä; laskuun merkitään verottomuuden peruste. |

ALV lisätään työkorvauksen **päälle**.

## Lopullinen maksu

```
laskun loppusumma = työkorvaus + ALV
maksetaan tilille = työkorvaus + ALV − ennakonpidätys
```

Esimerkki: 11 ikkunaa × 20 € = **220 € työkorvaus**, työntekijä ei ALV-velvollinen
eikä ennakkoperintärekisterissä → ennakonpidätys 60 % × 220 € = 132 €,
**tilille 88 €**, ja 132 € tilitetään Verolle. Kun työntekijä rekisteröityy,
tilille maksetaan koko 220 €.

## Miten tämä näkyy järjestelmässä

- **Työntekijän työpöytä → Info → Verotiedot:** työntekijä ilmoittaa itse ALV-aseman
  ja ennakkoperintärekisteritilan. Varovainen oletus: ei ALV:tä, ei rekisterissä.
- **Työntekijän työpöytä → Maksut:** jokainen maksu näyttää erittelyn (työkorvaus,
  ALV, ennakonpidätys, **maksetaan tilillesi**). Rekisteröitymiskehotus näkyy, jos pidätys osuu.
- **Admin → tiimi → Maksut:** näyttää tilille maksettavan nettosumman ja erittelyn.
- **Alihankkijan lasku (PDF):** muodostuu automaattisesti maksun yhteydessä oikein
  — veroton rivi, ALV (tai verottomuuden peruste), ennakonpidätys, toimituspäivä,
  ostajan (Puuhapatet) Y-tunnus. Erittely tallennetaan `payout.tax`-tilannekuvaan.

## Konfiguraatio

| Env-muuttuja | Tarkoitus |
|---|---|
| `COMPANY_NAME` | Yhtiön nimi (kun brändi yhtiöityy) → valittava ostaja. |
| `COMPANY_Y_TUNNUS` | Yhtiön Y-tunnus laskun ostaja-tietoihin. |
| `COMPANY_ADDRESS`, `COMPANY_EMAIL` | Yhtiön osoite/sähköposti laskulle. |

Ennen yhtiöitymistä ostaja on aina toinen johtajista (`shared/billers.ts`).

## Vakiot (`shared/tax.ts`)

- `ALV_RATE = 0.255`
- `WITHHOLDING_NATURAL_PERSON = 0.60`, `WITHHOLDING_COMPANY = 0.13`
- `VAT_SMALL_BUSINESS_LIMIT_EUR = 15000` (tarkista vero.fi)

Päivitä nämä yhdestä paikasta, jos verokannat muuttuvat.
