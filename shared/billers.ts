/**
 * FR8 — laskuttajat (billers / "the brand side").
 *
 * Puuhapatet ei ole vielä juridinen yhtiö, vaan BRÄNDI, jota pyörittää kaksi
 * johtajaa, joilla on omat Y-tunnukset (toiminimet). Iso keikka laskutetaan
 * asiakkaalta useassa erässä JAETTUNA kahden johtajan kesken, jotta kummankaan
 * liikevaihto ei ylitä rajoja (mm. ALV:n vähäisen toiminnan 20 000 € raja,
 * voimassa 1.1.2025 alkaen — tarkista vero.fi).
 *
 * SÄÄNTÖ: se johtaja, joka laskutti asiakasta tästä erästä, on myös se, jolle
 * alihankkija (esim. Jani) laskuttaa oman työnsä. Eli alihankkijan laskun OSTAJA
 * = kyseinen johtaja (nimi + Y-tunnus + osoite), ei abstrakti "Puuhapatet".
 *
 * TULEVAISUUS: kun brändi yhtiöitetään, lisätään yhtiö laskuttajaksi (ks. server-
 * puolen COMPANY_*-env tai uusi merkintä tähän) ja valitaan se ostajaksi. Malli
 * on tehty niin, että ostaja on aina "Biller"-objekti — johtaja tänään, yhtiö
 * huomenna — ilman muutoksia laskulogiikkaan.
 *
 * HUOM: nämä ovat laskuilla näkyviä julkisia tietoja (ei salaisuuksia).
 */

export interface Biller {
  id: string;
  name: string;
  yTunnus?: string;
  address?: string;
  iban?: string;
  email?: string;
  kind: "person" | "company";
}

/** Brändin johtajat — laskutusidentiteetit. Sama data kuin admin-profile HOSTit. */
export const BRAND_BILLERS: Biller[] = [
  {
    id: "joonatan",
    name: "Joonatan Juuri",
    yTunnus: "3598782-9",
    address: "Braskarna 8, 02380 Espoo",
    iban: "FI49 5780 2420 5091 79",
    email: "joonatan@puuhapatet.fi",
    kind: "person",
  },
  {
    id: "matias",
    name: "Matias Pitkänen",
    yTunnus: "3609912-9",
    address: "Haapaniemenrinne 5A, 02940 Espoo",
    iban: "FI49 5780 2420 5091 79",
    email: "matias@puuhapatet.fi",
    kind: "person",
  },
];

/** Oletuslaskuttaja, kun mitään ei ole valittu. */
export const DEFAULT_BILLER_ID = BRAND_BILLERS[0].id;

/** Laskuttajan (ostajan) tilannekuva, joka tallennetaan maksulle / laskulle. */
export interface BuyerSnapshot {
  billerId?: string;
  name: string;
  yTunnus?: string;
  address?: string;
  email?: string;
}

/** Etsii brändin johtajan id:llä (vain BRAND_BILLERS; serveri lisää yhtiön). */
export function resolveBrandBiller(id?: string | null): Biller | undefined {
  if (!id) return undefined;
  return BRAND_BILLERS.find((b) => b.id === id);
}

/** Tekee Biller-objektista laskulle tallennettavan ostajan tilannekuvan. */
export function billerToBuyer(b: Biller): BuyerSnapshot {
  return { billerId: b.id, name: b.name, yTunnus: b.yTunnus, address: b.address, email: b.email };
}
