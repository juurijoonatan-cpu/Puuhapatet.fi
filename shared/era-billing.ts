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

/**
 * KELTAISTEN (2. vaihe) maksupotti. Punaiset maksetaan neljässä arvomääräisessä
 * erässä; keltaiset ovat oma, erillinen rahansa (asiakkaalta `scope:"p2"` -lasku).
 * Ne tarvitsevat oman "erän", jotta tekijän maksu ei sekoitu punaisten eriin eikä
 * kaksoiskappalesuoja luule niitä samaksi maksuksi.
 *
 * Toteutus ilman DB-migraatiota: sentinel-erä 0 tallennetussa `eraNumbers`-
 * listassa. `isP2EraSelection` on AINOA paikka jossa tätä tulkitaan, ja
 * `eraLabel`-tyyppiset näkymät kirjoittavat sen auki ("Keltaiset (2. vaihe)").
 */
export const P2_ERA_NUMBER = 0;
export const P2_ERA_NUMBERS: number[] = [P2_ERA_NUMBER];

/** Onko tämä erävalinta keltaisten (2. vaihe) potti eikä punaisten erä? */
export function isP2EraSelection(eraNumbers: number[] | null | undefined): boolean {
  return Array.isArray(eraNumbers) && eraNumbers.length === 1 && eraNumbers[0] === P2_ERA_NUMBER;
}

/** Erät 1–3 laskutetaan Joonatanille, erä 4 Matiakselle (kohta 1). */
export function eraRecipientFounderId(eraNumbers: number[]): "joonatan" | "matias" {
  return eraNumbers.includes(4) ? "matias" : "joonatan";
}

/** Tekijän vastaus johtajan luonnokseen (kohta 3B): "send" = hyväksy ja lähetä
 *  lasku, "reject" = hylkää. */
export type EraInvoiceRespondAction = "send" | "reject";

/**
 * Tilasiirtymä tekijän vastatessa laskuun. Vain "luonnos"-tilassa olevaan
 * laskuun voi vastata — kaikki muut tilat ovat lukittuja (kohta 3B.3: painike
 * toimii tasan kerran; kohta 4: lähetetty/hyväksytty lasku on muuttumaton).
 * Palauttaa uuden tilan, tai null jos lasku on jo lukittu.
 */
export function eraInvoiceRespondTransition(
  tila: EraInvoiceTila,
  action: EraInvoiceRespondAction,
): EraInvoiceTila | null {
  if (tila !== "luonnos") return null;
  return action === "send" ? "hyväksytty" : "hylätty";
}

/** Minimikentät, jotka kokonaistilanteen ryhmittely tarvitsee laskulta. */
export interface EraInvoiceSummaryRow {
  kind: EraInvoiceKind;
  tila: EraInvoiceTila;
  totalCents: number;
  /** Laskunumero. Syntyy VAIN kun lasku lähetetään — luonnoksella ei ole. */
  invoiceNumber?: string | null;
  /** Lähetysaika. Sama merkitys: lähetetty = kirjanpidon tosite. */
  sentAt?: Date | string | number | null;
  /** Milloin hylättiin/mitätöitiin (respondedAt). Säilytysajan lähtöhetki. */
  respondedAt?: Date | string | number | null;
}

/**
 * Kuinka kauan MITÄTÖITY LUONNOS näkyy "Poistetut"-listalla ennen kuin se
 * häviää lopullisesti. Kaksi vuorokautta: tarpeeksi kauan että virheen näkee ja
 * ehtii tarkistaa, tarpeeksi lyhyt ettei väärien laskujen lista kasva ikuisesti.
 */
export const VOIDED_DRAFT_RETENTION_MS = 48 * 60 * 60 * 1000;

function tsOf(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/**
 * Onko tämä lasku KIRJANPIDON TOSITE?
 *
 * Ratkaisee saako mitätöityä laskua koskaan poistaa. Lähetetty lasku sai
 * juoksevan laskunumeron, lähti tekijälle sähköpostilla ja on hänen
 * kirjanpidossaan myyntinä — Suomen kirjanpitolaki vaatii tositteiden
 * säilytyksen **6 vuotta** tilikauden päättymisestä, joten sitä ei hävitetä
 * vaikka se mitätöitäisiin. Luonnos jota ei koskaan lähetetty ei ole tosite:
 * se on pelkkä ehdotus, ja sen saa poistaa.
 *
 * Sama periaate kuin asiakkaan maksuerissä (server/routes.ts gig-payment DELETE):
 * lähetetty → mitätöidään ja säilytetään, kirjaamaton haamu → poistetaan.
 */
export function isEraInvoiceReceipt(inv: EraInvoiceSummaryRow): boolean {
  return !!(inv.invoiceNumber && String(inv.invoiceNumber).trim()) || tsOf(inv.sentAt) != null;
}

/**
 * Milloin mitätöity lasku häviää lopullisesti, tai `null` jos se säilyy
 * pysyvästi (tosite) tai ei ole mitätöity lainkaan.
 */
export function voidedEraInvoicePurgeAt(inv: EraInvoiceSummaryRow): number | null {
  if (inv.tila !== "hylätty") return null;
  if (isEraInvoiceReceipt(inv)) return null;      // tosite säilyy
  const at = tsOf(inv.respondedAt);
  if (at == null) return null;                    // ei aikaleimaa → ei poisteta
  return at + VOIDED_DRAFT_RETENTION_MS;
}

/** Onko mitätöidyn luonnoksen säilytysaika umpeutunut (`now` = Date.now())? */
export function isVoidedEraInvoiceExpired(inv: EraInvoiceSummaryRow, now: number): boolean {
  const at = voidedEraInvoicePurgeAt(inv);
  return at != null && now >= at;
}

/**
 * Ryhmittelee keikan erälaskut "Maksut"-kokonaistilannesivua varten (kohta 3D):
 * johtaja-väliset laskut, kaikki tekijöille lähetetyt maksut sekä tekijöiden
 * kuittaamat (hyväksytyt) laskut summineen. Hylättyjä ei lasketa summiin.
 */
export function summarizeEraInvoices<T extends EraInvoiceSummaryRow>(invoices: T[]) {
  const founderInvoices = invoices.filter((i) => i.kind === "johtaja_valinen");
  const workerInvoices = invoices.filter((i) => i.kind === "tekija");
  const workerPending = workerInvoices.filter((i) => i.tila === "luonnos");
  const workerAccepted = workerInvoices.filter((i) => i.tila === "hyväksytty");
  const workerRejected = workerInvoices.filter((i) => i.tila === "hylätty");
  // Mitätöidyt eriteltynä säilytyksen mukaan, jotta ne EIVÄT jää sotkemaan
  // työlistoja: poistuvat pois näkyvistä itsestään, tositteet arkistoon.
  const workerVoidedTemp = workerRejected.filter((i) => voidedEraInvoicePurgeAt(i) != null);
  const workerVoidedKept = workerRejected.filter((i) => voidedEraInvoicePurgeAt(i) == null);
  const sum = (rows: T[]) => rows.reduce((s, i) => s + i.totalCents, 0);
  return {
    founderInvoices,
    workerInvoices,
    workerPending,
    workerAccepted,
    workerRejected,
    /** Mitätöityjä luonnoksia — katoavat 2 vrk:ssa itsestään. */
    workerVoidedTemp,
    /** Mitätöityjä LÄHETETTYJÄ laskuja — säilyvät tositteina pysyvästi. */
    workerVoidedKept,
    founderSumCents: sum(founderInvoices.filter((i) => i.tila !== "hylätty")),
    workerPendingSumCents: sum(workerPending),
    workerAcceptedSumCents: sum(workerAccepted),
  };
}

/** Ainoat sallitut erävalinnat: [1,2,3] yhdessä, [4] yksin, tai [0] = keltaisten
 *  (2. vaihe) potti. Ei mielivaltaisia osajoukkoja. */
export function normalizeEraNumbers(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const nums = raw.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n));
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  if (sorted.length === 3 && sorted[0] === 1 && sorted[1] === 2 && sorted[2] === 3) return [1, 2, 3];
  if (sorted.length === 1 && sorted[0] === 4) return [4];
  if (sorted.length === 1 && sorted[0] === P2_ERA_NUMBER) return [...P2_ERA_NUMBERS];
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
  /**
   * Valmis ansio sentteinä, joka OHITTAA `pestytIkkunat × 20 €` -laskennan.
   * Tarvitaan keltaisille (2. vaihe): niiden palkkio tulee palkkiotaulukosta
   * (34 €→18, 37,50 €→20, 50 €→27) per ikkuna, ei kiinteästä 20 €:sta, joten
   * ikkunamäärä × vakio antaisi väärän summan.
   */
  ansaittuOverrideCents?: number;
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
    const base = typeof w.ansaittuOverrideCents === "number" && Number.isFinite(w.ansaittuOverrideCents)
      ? Math.max(0, roundCents(w.ansaittuOverrideCents))
      : roundCents((w.pestytIkkunat || 0) * TEKIJA_HINTA_CENTS);
    const ansaittuCents = base + (w.sovittuMuutosCents || 0);
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
