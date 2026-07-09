/**
 * FR8 — erälaskutuksen (arvomääräiset maksuerät) puhdas laskentamoottori.
 *
 * Yksi keikka laskutetaan asiakkaalta neljässä ARVOMÄÄRÄISESSÄ erässä (ei
 * ikkunamäärän mukaan) — ks. `docs/fr8-era-laskutus-plan.md` kohta 2 täydelle
 * speksille ja kohta 7 tälle moduulille kirjoitetulle yksikkötestille.
 *
 * Rahaa käsitellään AINA sentteinä (kokonaislukuina) pyöristysvirheiden
 * välttämiseksi — sama käytäntö kuin `shared/tax.ts`:ssä ja Drizzle-skeemassa.
 */

/** Tekijän kiinteä hinta, senttiä per ikkuna (20 €). */
export const TEKIJA_HINTA_CENTS = 2000;

/** Lasku tyyppi: tekijän johtajalle laskuttama työkorvaus, tai kahden johtajan
 *  välinen ristiinlasku. */
export const ERA_INVOICE_KINDS = ["tekija", "johtaja_valinen"] as const;
export type EraInvoiceKind = (typeof ERA_INVOICE_KINDS)[number];

/** Laskun tila — append-only: kun tila on muu kuin "luonnos", lasku on lukittu
 *  eikä sitä saa enää muokata tai lähettää uudelleen (ks. speksin kohta 4). */
export const ERA_INVOICE_TILAT = ["luonnos", "lähetetty", "hyväksytty", "hylätty"] as const;
export type EraInvoiceTila = (typeof ERA_INVOICE_TILAT)[number];

/** Erät 1–3 laskutetaan Joonatanille, erä 4 Matiakselle (kohta 1). */
export function eraRecipientFounderId(eraNumbers: number[]): "joonatan" | "matias" {
  return eraNumbers.includes(4) ? "matias" : "joonatan";
}

/** Ainoat sallitut erävalinnat: [1,2,3] yhdessä tai [4] yksin (kohta 3A.1: johtaja
 *  valitsee "erät 1-3" tai "erä 4" — ei mielivaltaisia osajoukkoja). */
export function normalizeEraNumbers(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const nums = raw.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n));
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  if (sorted.length === 3 && sorted[0] === 1 && sorted[1] === 2 && sorted[2] === 3) return [1, 2, 3];
  if (sorted.length === 1 && sorted[0] === 4) return [4];
  return null;
}

export interface TekijaPesu {
  workerId: string;
  name: string;
  /** Pestyt ikkunat tässä erässä. Voi olla desimaali (esim. jaettu ikkuna 0.5). */
  pestytIkkunat: number;
  /** Bonus/alennus, senttiä, +/-. VAIKUTTAA katteeseen. */
  sovittuMuutosCents: number;
  /** Jo maksettu ennakko, senttiä. EI vaikuta katteeseen, vähentää vain "maksettava nyt". */
  ennakkoCents: number;
}

export interface JohtajaPesu {
  founderId: string;
  name: string;
  /** Pestyt ikkunat tässä erässä. Voi olla desimaali (esim. 13.5 / 24.5). */
  pestytIkkunat: number;
}

export interface TekijaLaskuRivi {
  workerId: string;
  name: string;
  pestytIkkunat: number;
  /** ansaittu = pestytIkkunat × 20 € + sovittuMuutos. Käytetään katteeseen. */
  ansaittuCents: number;
  /** maksettava = ansaittu − ennakko. Tekijän lasku "nyt". */
  maksettavaCents: number;
}

export interface JohtajaLaskuRivi {
  founderId: string;
  name: string;
  pestytIkkunat: number;
  /** omat = x × pestytIkkunat (johtajan oma osuus, ei kate). */
  omatCents: number;
  /** Tämän johtajan osuus katteesta (kate jaetaan tasan; pariton sentti menee
   *  ensimmäiselle `founders`-listan johtajalle, jotta summa täsmää S:ään). */
  katePerJohtajaCents: number;
  /** loppusumma = omat + katePerJohtaja. */
  loppusummaCents: number;
}

export interface EraBillingResult {
  /** S — erän/erien kokonaissumma, senttiä. */
  totalCents: number;
  /** Kaikkien pesemien ikkunoiden tarkka summa (tekijät + johtajat), EI pyöristetty. */
  kokonaisikkunat: number;
  /** x — €/ikkuna tässä erässä, pyöristetty 2 desimaaliin (senttiä, kokonaisluku). */
  xCents: number;
  workers: TekijaLaskuRivi[];
  /** Kaikkien tekijöiden ansaittujen summa yhteensä. */
  tekijatAnsaittuYhtCents: number;
  founders: JohtajaLaskuRivi[];
  /** KATE = S − tekijät_ansaittu_yht − johtajien omat (jäännöksenä, EI kaavalla n*(x-20)). */
  kateCents: number;
  /** Erotus S:n ja (tekijät_ansaittu_yht + kaikkien johtajien loppusummat) välillä.
   *  Pitää AINA olla 0 — palautetaan silti eksplisiittisesti, koska spec vaatii
   *  tämän tarkistuksen näkyväksi askeleeksi eikä pelkäksi oletukseksi. */
  tarkistusEroCents: number;
}

/**
 * Tarkka ikkunasumma ilman rivikohtaista pyöristystä (korjaa off-by-one-bugin,
 * joka syntyy kun desimaali-ikkunat (13.5 / 24.5) pyöristetään ennen summausta).
 */
export function sumWindows(counts: number[]): number {
  return counts.reduce((sum, n) => sum + (n || 0), 0);
}

function roundCents(cents: number): number {
  return Math.round(cents);
}

/**
 * Laskee koko erän/erien laskutuksen kaavojen 1–8 mukaan (kohta 2). `totalCents`
 * on S sentteinä, `workers`/`founders` ovat käsin syötetyt pesumäärät tälle
 * erälle. Kate jaetaan tasan kahden (tai useamman) `founders`-listan johtajan
 * kesken; jos kate on pariton senttimäärä, ylimääräinen sentti menee listan
 * ensimmäiselle johtajalle — muuten `tekijät_ansaittu_yht + kaikki loppusummat`
 * ei voisi koskaan täsmätä S:ään sentilleen.
 */
export function computeEraBilling(
  totalCents: number,
  workers: TekijaPesu[],
  founders: JohtajaPesu[],
): EraBillingResult {
  const workerWindows = workers.map((w) => w.pestytIkkunat || 0);
  const founderWindows = founders.map((f) => f.pestytIkkunat || 0);
  const kokonaisikkunat = sumWindows([...workerWindows, ...founderWindows]);

  const workerRows: TekijaLaskuRivi[] = workers.map((w) => {
    const ansaittuCents = roundCents((w.pestytIkkunat || 0) * TEKIJA_HINTA_CENTS) + (w.sovittuMuutosCents || 0);
    const maksettavaCents = ansaittuCents - (w.ennakkoCents || 0);
    return { workerId: w.workerId, name: w.name, pestytIkkunat: w.pestytIkkunat, ansaittuCents, maksettavaCents };
  });
  const tekijatAnsaittuYhtCents = workerRows.reduce((sum, r) => sum + r.ansaittuCents, 0);

  // x = S / kokonaisikkunat, pyöristettynä 2 desimaaliin — sentteinä tämä ON
  // pyöristys lähimpään senttiin, koska sentti = 1/100 €.
  const xCents = kokonaisikkunat > 0 ? roundCents(totalCents / kokonaisikkunat) : 0;

  const omatByFounder = founders.map((f) => roundCents(xCents * (f.pestytIkkunat || 0)));
  const omatSumCents = omatByFounder.reduce((sum, c) => sum + c, 0);

  // KATE aina jäännöksenä (EI kaavalla n*(x-20)) — imee x:n pyöristyksen.
  const kateCents = totalCents - tekijatAnsaittuYhtCents - omatSumCents;

  const n = founders.length;
  const kateBase = n > 0 ? Math.floor(kateCents / n) : 0;
  const kateRemainder = kateCents - kateBase * n; // 0..n-1, aina ei-negatiivinen

  const founderRows: JohtajaLaskuRivi[] = founders.map((f, i) => {
    const katePerJohtajaCents = kateBase + (i < kateRemainder ? 1 : 0);
    const omatCents = omatByFounder[i];
    return {
      founderId: f.founderId,
      name: f.name,
      pestytIkkunat: f.pestytIkkunat,
      omatCents,
      katePerJohtajaCents,
      loppusummaCents: omatCents + katePerJohtajaCents,
    };
  });

  const tarkistusEroCents =
    totalCents - (tekijatAnsaittuYhtCents + founderRows.reduce((sum, f) => sum + f.loppusummaCents, 0));

  return {
    totalCents,
    kokonaisikkunat,
    xCents,
    workers: workerRows,
    tekijatAnsaittuYhtCents,
    founders: founderRows,
    kateCents,
    tarkistusEroCents,
  };
}
