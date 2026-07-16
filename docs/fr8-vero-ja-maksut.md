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
  (mm. ALV:n vähäisen toiminnan 20 000 €, voimassa 1.1.2025 alkaen). Kukin asiakaslasku tallentaa, **kuka
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

### 1. Ennakkoperintärekisteri → ei ennakonpidätystä (käyttäjän päätös 2026-07-16)

> ⚠️ **Puuhapatet EI KOSKAAN pidätä ennakonpidätystä** — kaikki työkorvaukset
> maksetaan aina täysimääräisenä (bruttona), riippumatta siitä onko maksunsaaja
> ennakkoperintärekisterissä. Tämä on käyttäjän nimenomainen, tietoinen päätös.
>
> Ennakkoperintälain mukaan maksaja on lähtökohtaisesti vastuussa
> pidättämättä jääneestä verosta, jos maksunsaaja ei tosiasiassa ole
> ennakkoperintärekisterissä. **Tämä vastuu jää nyt Puuhapatetille** — päätös on
> tehty tietoisena tästä riskistä eikä sitä ole muutettu ilman käyttäjän
> nimenomaista pyyntöä. Tarkistuta tarvittaessa kirjanpitäjällä.

Toteutus: `shared/tax.ts` → `computeTax()` palauttaa aina `withheld: false`,
`withholdingCents: 0` — riippumatta työntekijän ilmoittamasta
ennakkoperintärekisteritilasta. Onboarding- ja admin-lomakkeista on poistettu
"Oletko ennakkoperintärekisterissä?" -kysymys, koska vastauksella ei enää ole
vaikutusta maksuun.

### 2. Arvonlisävero (ALV)

| Saajan ALV-asema | Lasku |
|---|---|
| **ALV-rekisterissä** | Lisää yleisen kannan **25,5 %** (voimassa 1.9.2024 alkaen). |
| **Vähäinen toiminta** (AVL 3 §, alle ~20 000 € / kalenterivuosi, 1.1.2025 alkaen) | Ei ALV:tä; laskuun merkitään verottomuuden peruste. |

ALV lisätään työkorvauksen **päälle**.

## Lopullinen maksu

```
laskun loppusumma = työkorvaus + ALV
maksetaan tilille = työkorvaus + ALV   (ei koskaan ennakonpidätystä)
```

Esimerkki: 11 ikkunaa × 20 € = **220 € työkorvaus**, työntekijä ei ALV-velvollinen
→ **tilille 220 €**, aina, riippumatta ennakkoperintärekisteristä.

## Miten tämä näkyy järjestelmässä

- **Työntekijän työpöytä → Info → Verotiedot:** työntekijä ilmoittaa itse ALV-aseman.
  Varovainen oletus: ei ALV:tä.
- **Työntekijän työpöytä → Maksut:** jokainen maksu näyttää erittelyn (työkorvaus,
  ALV, **maksetaan tilillesi** = aina koko summa).
- **Admin → tiimi → Maksut:** näyttää tilille maksettavan summan ja erittelyn.
- **Alihankkijan lasku (PDF):** muodostuu automaattisesti maksun yhteydessä oikein
  — veroton rivi, ALV (tai verottomuuden peruste), toimituspäivä, ostajan
  (Puuhapatet) Y-tunnus. Erittely tallennetaan `payout.tax`-tilannekuvaan.

## Konfiguraatio

| Env-muuttuja | Tarkoitus |
|---|---|
| `COMPANY_NAME` | Yhtiön nimi (kun brändi yhtiöityy) → valittava ostaja. |
| `COMPANY_Y_TUNNUS` | Yhtiön Y-tunnus laskun ostaja-tietoihin. |
| `COMPANY_ADDRESS`, `COMPANY_EMAIL` | Yhtiön osoite/sähköposti laskulle. |

Ennen yhtiöitymistä ostaja on aina toinen johtajista (`shared/billers.ts`).

## Vakiot (`shared/tax.ts`)

- `ALV_RATE = 0.255`
- `VAT_SMALL_BUSINESS_LIMIT_EUR = 20000` (voimassa 1.1.2025 alkaen; tarkista vero.fi)

Päivitä nämä yhdestä paikasta, jos verokannat muuttuvat.

## FR8-erälaskutus (`shared/era-billing.ts`) — ALV AINA pois

Erälaskutuksen (arvomääräiset maksuerät, ks. `docs/fr8-era-laskutus-plan.md`)
laskuille **ALV on aina 0 %** — käyttäjän (Matias) vahvistama liiketoiminnan
tosiasia: **ei Puuhapatet (Joonatan/Matias) eikä yksikään FR8-tekijä ole
ALV-rekisterissä.** Tätä EI lueta tekijän `profile.answers`-itseilmoituksesta
(toisin kuin tavallisessa payout-järjestelmässä yllä) — `vatStatus` on
pakotettu `"vahainen_toiminta"`-arvoon sekä laskun PDF:ssä
(`server/routes.ts` → `buildEraInvoicePdfParams`) että tekijän omassa
näkymässä (`client/src/pages/worker.tsx` → `EraInvoiceSection`).

Johtaja-välisille (johtaja_valinen) laskuille ei koskaan lasketa ALV:tä —
vain "Arvonlisäveroton myynti, vähäinen toiminta" -merkintä. Kummallekaan
laskutyypille ei koskaan lasketa ennakonpidätystä (ks. yllä).
