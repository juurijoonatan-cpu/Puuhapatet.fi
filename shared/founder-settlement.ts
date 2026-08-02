/**
 * FR8 — JOHTAJIEN TASAUS: paljonko toisen johtajan pitää oikeasti siirtää toiselle.
 *
 * MIKSI TÄMÄ MODUULI ON OLEMASSA
 *
 * Paperilla erät 1–3 laskutetaan Joonatanin ja erä 4 Matiaksen Y-tunnuksella
 * (`eraRecipientFounderId`). Käytännössä raha liikkui toisin: Matias sai erän 1
 * rahat ja maksoi niistä tekijöitä, Joonatan laskutti ja sai erät 2–4 ja maksoi
 * niistä tekijöitä. Kumpikaan ei ole väärin — mutta silloin *kumpi tahansa*
 * johtaja voi istua toisen rahojen päällä, eikä sitä näe mistään.
 *
 * Vanha `server/finance/settlement.ts` (`computeFounderSettlement`) vastaa eri
 * kysymykseen ja kahdella yksinkertaistuksella jotka eivät päde tähän:
 *
 *   1. Se olettaa että erän laskuttaja MYÖS maksoi sen erän tekijät
 *      (`founders[bj].palkatPaidCents += e.earnedCents`). Täällä maksaja luetaan
 *      siitä kenelle tekijän erälasku oikeasti osoitettiin.
 *   2. Se jakaa koko (erä − tekijöiden palkat) tasan 50/50 eikä anna kummallekaan
 *      johtajalle mitään hänen OMASTA pesutyöstään. Kun toinen on pessyt 24,5 ja
 *      toinen 13,5 ikkunaa, se on satojen eurojen virhe. Speksi
 *      (`docs/fr8-era-laskutus-plan.md` kohta 2) sanoo toisin: johtaja saa
 *      `x × omat ikkunat` ja vasta jäännöskate jaetaan tasan.
 *
 * Tämä moduuli laskee molemmat puolet erikseen ja vertaa niitä:
 *
 *   ANSAINTA  (mikä kuuluu johtajalle)  = x × omat punaiset + omat keltaiset
 *                                         + tasajako jäännöskatteesta
 *   KASSA     (mitä johtaja pitää nyt)  = asiakkaalta saatu − tekijöille maksettu
 *                                         − omasta pussista maksetut kulut
 *   NETTO                               = kassa − ansainta
 *
 * Siirto on se summa joka tekee molempien netosta yhtä suuren. Se on aina
 * hyvin määritelty, myös kun tekijöille on vielä maksamatta tai asiakkaalta
 * keräämättä — silloin molemmille jää yhtä suuri osuus siitä varauksesta
 * (`reserveCents`) eikä kumpikaan joudu rahoittamaan sitä yksin.
 *
 * Puhdas laskenta: ei I/O:ta, ei Reactia, kaikki sentteinä. Sekä client että
 * server importtaavat tämän — älä kirjoita kaavaa uudelleen kumpaankaan.
 */

// ─── Tallennettu tila (ProjectData.settlement) ────────────────────────────────
//
// Johtajien KÄSIN kirjaamat korjaukset siihen, mitä data itsessään väittää.
// Tallennetaan `ProjectData`-blobiin optionaalisena kenttänä — ei DB-migraatiota,
// ja ilman kenttää vanhat keikat round-trippaavat identtisesti.
//
// MIKSI OMANA TILANAAN eikä suoraan laskuriveille: lähetetty erälasku on
// laillinen tosite ja **muuttumaton** (`docs/fr8-era-laskutus-plan.md` kohta 4).
// Sen `recipientId` on laskun OSTAJA, eikä sitä saa muuttaa jälkikäteen. Kun
// todellinen maksaja oli joku muu, se kirjataan tänne — lasku pysyy koskemattomana
// ja tasaus näkee silti totuuden.

/** Yksi kirjattu johtajien välinen siirto. */
export interface TasausTransferRecord {
  id: string;
  fromId: string;
  toId: string;
  cents: number;
  /** Kirjaushetki (epoch ms). */
  ts: number;
  note?: string;
}

export interface FounderSettlementState {
  /** Erän indeksi (`gig.payments[i]`) merkkijonona → johtaja joka OIKEASTI sai
   *  rahat. Ohittaa `payment.biller`in vain niiden erien osalta jotka tässä on. */
  receivedBy?: Record<string, string>;
  /** Erälaskun id merkkijonona → johtaja joka OIKEASTI maksoi tekijälle.
   *  Ohittaa laskun `recipientId`in koskematta itse laskuun. */
  paidBy?: Record<string, string>;
  /** Johtaja → hänen omasta pussistaan maksamat, potista korvattavat kulut. */
  expensesCents?: Record<string, number>;
  /** Käsin asetettu lopullinen siirtosumma (senttiä). null/puuttuu = laskettu. */
  overrideCents?: number | null;
  /** Käsin asetetun siirron maksaja. */
  overrideFromId?: string | null;
  /** Miksi summa on käsin asetettu — näkyy tasausnäkymässä. */
  note?: string;
  /** Jo tehdyt/laskutetut johtajien väliset siirrot. */
  transfers?: TasausTransferRecord[];
  /**
   * KÄSINSYÖTETYT LÄHTÖTIEDOT.
   *
   * Laskenta johtaa normaalisti kaiken kartasta ja laskuista, ja se on oikein
   * niin kauan kuin kartta kertoo totuuden. Mutta kartta voidaan nollata
   * maksujen jälkeen, keikka voidaan tehdä osin ennen järjestelmän käyttöönottoa,
   * tai johtajat voivat vain tietää luvun paremmin kuin kartta. Silloin
   * automatiikka ei ole apu vaan este: se kertoo itsevarmasti nollaa.
   *
   * Nämä kentät ohittavat johdetun arvon YKSI KERRALLAAN. Tyhjä kenttä
   * tarkoittaa "laske tämä kartasta kuten ennenkin", joten käsinsyöttö voi olla
   * osittainen — esimerkiksi vain johtajien ikkunamäärät, muu kartasta.
   */
  manual?: FounderSettlementManual;
  updatedAt?: number;
}

/** Käsin annetut lähtöluvut. Kaikki valinnaisia; puuttuva = johda kartasta. */
export interface FounderSettlementManual {
  /** Punaisten potti = asiakkaalta laskutettu yhteensä (senttiä). */
  p1PotCents?: number | null;
  /** Punaiset ikkunat yhteensä — `x`:n nimittäjä. */
  p1WindowsTotal?: number | null;
  /** Tekijöiden punaisista ansaitsema BRUTTO yhteensä (ei johtajia). */
  workerP1EarnedCents?: number | null;
  /** Johtaja → hänen itse pesemänsä punaiset ikkunat. */
  p1WindowsByFounder?: Record<string, number>;
}

const MAX_TRANSFERS = 100;
const MAX_MAP_KEYS = 500;

function cleanId(v: unknown): string {
  return String(v ?? "").slice(0, 40).toLowerCase().trim();
}

function cleanCents(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  // Yksi keikka ei koskaan liikuta miljoonia — raja pitää roskasyötteen poissa
  // rahakaavoista ilman että mikään aito summa osuu siihen.
  return Math.max(-1_000_000_00, Math.min(1_000_000_00, n));
}

function cleanIdMap(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const k of Object.keys(input as Record<string, unknown>).slice(0, MAX_MAP_KEYS)) {
    const v = cleanId((input as Record<string, unknown>)[k]);
    const key = String(k).slice(0, 40).trim();
    if (key && v) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Sanitoi tallennetun tasaustilan. Palauttaa `undefined` kun mitään
 *  merkityksellistä ei ole asetettu, jotta tyhjä objekti ei jää blobiin. */
export function sanitizeFounderSettlementState(input: any): FounderSettlementState | undefined {
  if (!input || typeof input !== "object") return undefined;

  const expensesCents: Record<string, number> = {};
  if (input.expensesCents && typeof input.expensesCents === "object") {
    for (const k of Object.keys(input.expensesCents).slice(0, MAX_MAP_KEYS)) {
      const id = cleanId(k);
      const c = cleanCents(input.expensesCents[k]);
      if (id && c !== 0) expensesCents[id] = c;
    }
  }

  const transfers: TasausTransferRecord[] = Array.isArray(input.transfers)
    ? input.transfers.slice(0, MAX_TRANSFERS).map((t: any, i: number) => ({
        id: String(t?.id ?? `tr_${i}`).slice(0, 60),
        fromId: cleanId(t?.fromId),
        toId: cleanId(t?.toId),
        cents: Math.abs(cleanCents(t?.cents)),
        ts: Number(t?.ts) || Date.now(),
        note: t?.note ? String(t.note).slice(0, 240) : undefined,
      })).filter((t: TasausTransferRecord) => t.fromId && t.toId && t.fromId !== t.toId && t.cents > 0)
    : [];

  const rawOverride = input.overrideCents;
  const overrideCents = rawOverride === null || rawOverride === undefined || rawOverride === ""
    ? null
    : Math.abs(cleanCents(rawOverride));

  // Käsinsyötetyt lähtöluvut. Tyhjä/puuttuva kenttä = johda kartasta, joten
  // käsinsyöttö voi olla osittainen. `null` on merkitsevä: se tarkoittaa
  // nimenomaan "ei ohitusta", eikä sitä pidä sekoittaa nollaan.
  const manual = ((): FounderSettlementManual | undefined => {
    const m = input.manual;
    if (!m || typeof m !== "object") return undefined;
    const num = (v: unknown, max: number): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Math.round(Number(v));
      return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
    };
    const byFounder: Record<string, number> = {};
    if (m.p1WindowsByFounder && typeof m.p1WindowsByFounder === "object") {
      for (const k of Object.keys(m.p1WindowsByFounder).slice(0, MAX_MAP_KEYS)) {
        const id = cleanId(k);
        const n = num(m.p1WindowsByFounder[k], 100_000);
        if (id && n !== null) byFounder[id] = n;
      }
    }
    const out: FounderSettlementManual = {
      p1PotCents: num(m.p1PotCents, 100_000_000),
      p1WindowsTotal: num(m.p1WindowsTotal, 1_000_000),
      workerP1EarnedCents: num(m.workerP1EarnedCents, 100_000_000),
      ...(Object.keys(byFounder).length > 0 ? { p1WindowsByFounder: byFounder } : {}),
    };
    const any = out.p1PotCents !== null || out.p1WindowsTotal !== null
      || out.workerP1EarnedCents !== null || !!out.p1WindowsByFounder;
    return any ? out : undefined;
  })();

  const state: FounderSettlementState = {
    receivedBy: cleanIdMap(input.receivedBy),
    paidBy: cleanIdMap(input.paidBy),
    expensesCents: Object.keys(expensesCents).length > 0 ? expensesCents : undefined,
    overrideCents,
    overrideFromId: input.overrideFromId ? cleanId(input.overrideFromId) || null : null,
    note: input.note ? String(input.note).slice(0, 400).trim() || undefined : undefined,
    transfers: transfers.length > 0 ? transfers : undefined,
    ...(manual ? { manual } : {}),
    updatedAt: Number(input.updatedAt) || Date.now(),
  };

  const meaningful = !!(state.receivedBy || state.paidBy || state.expensesCents
    || state.overrideCents != null || state.note || state.transfers || state.manual);
  return meaningful ? state : undefined;
}

/** Yksi johtaja tasauslaskennassa. Kaikki eurot sentteinä, ikkunat voivat olla
 *  desimaalisia (jaettu ikkuna = 0,5). */
export interface TasausFounderInput {
  id: string;
  name: string;
  /** Punaiset ikkunat jotka tämä johtaja on ITSE pessyt. */
  p1Windows: number;
  /** Keltaisista kertynyt oma palkkio (palkkiotaulukko, ei punaisten taksa). */
  p2OwnCents: number;
  /** Asiakkaalta saatu raha: erät joiden laskuttaja/saaja tämä johtaja on. */
  receivedCents: number;
  /** Tekijöille TOSIASSA maksettu: erälaskut joiden maksaja on tämä johtaja
   *  (+ käsin kirjatut maksut jotka on kohdennettu hänelle). */
  paidOutCents: number;
  /** Kulut jotka tämä johtaja on maksanut omasta pussistaan ja jotka korvataan
   *  keikan potista ennen jakoa. */
  expensesCents?: number;
}

export interface TasausInput {
  /** Johtajat vakaassa järjestyksessä. Pariton sentti menee listan
   *  ensimmäiselle, jotta summat täsmäävät sentilleen. */
  founders: TasausFounderInput[];
  /** PUNAISTEN potti: asiakkaalta laskutetut erät yhteensä (S). */
  p1PotCents: number;
  /** KELTAISTEN potti: asiakkaalta laskutettu lisätyö (`scope:"p2"`). */
  p2PotCents: number;
  /** Tekijöiden punaisista ansaitsema BRUTTO yhteensä (ei johtajia). */
  workerP1EarnedCents: number;
  /** Tekijöiden keltaisista ansaitsema BRUTTO yhteensä (ei johtajia). */
  workerP2EarnedCents: number;
  /** Punaiset ikkunat yhteensä (tekijät + johtajat) — x:n nimittäjä. */
  p1WindowsTotal: number;
  /** Jo tehdyt tai lähetetyt johtajien väliset siirrot. Vähennetään lasketusta
   *  siirrosta, ettei samaa rahaa siirretä kahdesti. */
  transfers?: TasausTransfer[];
  /** Käsin asetettu lopullinen siirtosumma (senttiä, aina ei-negatiivinen).
   *  Ohittaa lasketun summan — johtajat ovat voineet sopia toisin. */
  overrideCents?: number | null;
  /** Ohituksen maksaja. Ilman tätä käytetään lasketun siirron suuntaa. */
  overrideFromId?: string | null;
}

/** Yksi johtajien välinen siirto (maksettu tai laskutettu). */
export interface TasausTransfer {
  fromId: string;
  toId: string;
  cents: number;
}

export interface TasausFounderRow {
  id: string;
  name: string;
  p1Windows: number;
  /** x × omat punaiset ikkunat. */
  ownWorkCents: number;
  /** Omat keltaiset palkkiot. */
  p2OwnCents: number;
  /** Tasaosuus jäännöskatteesta. */
  kateShareCents: number;
  /** ownWork + p2Own + kateShare = mitä tälle johtajalle kuuluu. */
  entitledCents: number;
  receivedCents: number;
  paidOutCents: number;
  expensesCents: number;
  /** received − paidOut − expenses = mitä johtaja tosiasiassa pitää käsissään. */
  holdsCents: number;
  /** holds − entitled. Positiivinen = pitää liikaa, negatiivinen = jäi vajaaksi. */
  netCents: number;
  /** Kuinka paljon tämän johtajan pitää maksaa (+) tai saada (−) jotta kaikkien
   *  netto on yhtä suuri. Summa on aina 0. */
  dueCents: number;
}

export interface TasausResult {
  /** €/ikkuna tässä keikassa = p1-potti ÷ punaiset ikkunat yhteensä. */
  xCents: number;
  p1WindowsTotal: number;
  /** Potti josta johtajat jakavat: laskutettu − tekijöiden palkat − kulut. */
  distributableCents: number;
  /** Jäännöskate = jaettava − johtajien oma työ (punainen + keltainen). */
  founderKateCents: number;
  rows: TasausFounderRow[];
  /**
   * Σ kassa − Σ ansainta. Rahaa jota EI ole vielä jaettu kenellekään:
   * positiivinen = johtajien käsissä on rahaa joka kuuluu vielä tekijöille,
   * negatiivinen = asiakkaalta on laskutettu enemmän kuin on saatu tilille (tai
   * johtajat ovat maksaneet tekijöitä etukäteen omasta pussistaan). Ei jaeta —
   * siirto tasaa vain johtajien keskinäisen eron, ja tämä varaus jää molemmille
   * yhtä suurena.
   */
  reserveCents: number;
  /** Laskettu siirto ENNEN jo tehtyjä siirtoja. null = kaikki jo tasan. */
  grossTransfer: TasausTransfer | null;
  /** Jo tehdyt siirrot nettona `grossTransfer`in suuntaan (voi olla negatiivinen
   *  jos on siirretty väärään suuntaan tai liikaa). */
  alreadyTransferredCents: number;
  /** Vielä siirrettävä. Tämä on se luku joka pankissa oikeasti liikkuu. */
  transfer: TasausTransfer | null;
  /** Onko `transfer` käsin asetettu eikä laskettu? */
  overridden: boolean;
  /** Rivien nettojen summa. Pitää AINA olla yhtä suuri kuin `reserveCents` —
   *  palautetaan eksplisiittisesti, jotta täsmäytys on näkyvä askel eikä oletus. */
  checkCents: number;
}

function r(n: number): number {
  return Math.round(Number.isFinite(n) ? n : 0);
}

/**
 * Jakaa `cents` tasan `n`:lle niin, että osien summa on TÄSMÄLLEEN `cents`.
 * Ylijäävät sentit menevät listan ensimmäisille — sama sääntö kuin
 * `computeEraBilling`issa, jotta kaksi moottoria eivät eroa yhdellä sentillä.
 * Toimii myös negatiiviselle summalle (tappio jaetaan samalla säännöllä).
 */
export function splitEvenCents(cents: number, n: number): number[] {
  if (n <= 0) return [];
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(r(cents));
  const base = Math.floor(abs / n);
  const remainder = abs - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Koko keikan johtajatasaus. Ks. moduulin yläkommentti kaavoista.
 *
 * Huom `xCents`: se lasketaan PUNAISTEN potista ja punaisten ikkunoista, koska
 * se on speksin `x = S / kokonaisikkunat`. Keltaiset eivät koskaan vaikuta
 * siihen — niillä on oma palkkiotaulukkonsa ja oma kate, jotka tulevat sisään
 * `p2OwnCents`in ja jaettavan potin kautta.
 */
export function computeTasaus(input: TasausInput): TasausResult {
  const founders = input.founders ?? [];
  const n = founders.length;
  const expensesTotal = founders.reduce((s, f) => s + r(f.expensesCents ?? 0), 0);

  const p1Pot = r(input.p1PotCents);
  const p2Pot = r(input.p2PotCents);
  const workerCost = r(input.workerP1EarnedCents) + r(input.workerP2EarnedCents);
  const distributableCents = p1Pot + p2Pot - workerCost - expensesTotal;

  const p1WindowsTotal = Number.isFinite(input.p1WindowsTotal) ? input.p1WindowsTotal : 0;
  const xCents = p1WindowsTotal > 0 ? r(p1Pot / p1WindowsTotal) : 0;

  const ownWork = founders.map((f) => r(xCents * (f.p1Windows || 0)));
  const p2Own = founders.map((f) => r(f.p2OwnCents ?? 0));
  const ownSum = ownWork.reduce((s, c) => s + c, 0) + p2Own.reduce((s, c) => s + c, 0);

  // Kate JÄÄNNÖKSENÄ, ei kaavalla — näin x:n senttipyöristys ei koskaan karkaa
  // ja rivien summa täsmää jaettavaan pottiin sentilleen.
  const founderKateCents = distributableCents - ownSum;
  const kateShares = splitEvenCents(founderKateCents, n);

  const rows: TasausFounderRow[] = founders.map((f, i) => {
    const expenses = r(f.expensesCents ?? 0);
    const entitledCents = ownWork[i] + p2Own[i] + kateShares[i];
    const holdsCents = r(f.receivedCents) - r(f.paidOutCents) - expenses;
    return {
      id: f.id,
      name: f.name,
      p1Windows: f.p1Windows || 0,
      ownWorkCents: ownWork[i],
      p2OwnCents: p2Own[i],
      kateShareCents: kateShares[i],
      entitledCents,
      receivedCents: r(f.receivedCents),
      paidOutCents: r(f.paidOutCents),
      expensesCents: expenses,
      holdsCents,
      netCents: holdsCents - entitledCents,
      dueCents: 0, // täytetään alla
    };
  });

  // Tasaus: jokaisen netto viedään samaan lukuun (keskiarvoon). Näin jäljelle
  // jäävä varaus (tekijöiden maksamaton velka / keräämättä oleva lasku) jakautuu
  // molemmille yhtä suurena eikä toinen joudu rahoittamaan sitä yksin.
  const netSum = rows.reduce((s, x) => s + x.netCents, 0);
  const meanShares = splitEvenCents(netSum, n);
  rows.forEach((row, i) => { row.dueCents = row.netCents - meanShares[i]; });

  const grossTransfer = pickTransfer(rows);

  // Jo tehdyt siirrot, projisoituna lasketun siirron suuntaan.
  const transfers = input.transfers ?? [];
  let alreadyTransferredCents = 0;
  if (grossTransfer) {
    for (const t of transfers) {
      if (t.fromId === grossTransfer.fromId && t.toId === grossTransfer.toId) alreadyTransferredCents += r(t.cents);
      else if (t.fromId === grossTransfer.toId && t.toId === grossTransfer.fromId) alreadyTransferredCents -= r(t.cents);
    }
  }

  const override = input.overrideCents;
  const overridden = typeof override === "number" && Number.isFinite(override);
  let transfer: TasausTransfer | null;
  if (overridden) {
    const gross = Math.abs(r(override as number));
    const fromId = input.overrideFromId
      ?? grossTransfer?.fromId
      ?? founders[0]?.id
      ?? "";
    const toId = founders.find((f) => f.id !== fromId)?.id ?? grossTransfer?.toId ?? "";
    // KIRJATUT SIIRROT VÄHENTÄVÄT MYÖS KÄSIN SOVITTUA SUMMAA. Käsin asetettu
    // luku on sovittu KOKONAISsiirto, ei "vielä siirrettävä" — ilman tätä
    // vähennystä iso luku jäi näkymään täytenä vaikka raha oli jo siirretty,
    // eikä tasaus koskaan kuittautunut nollille. Laskettu haara teki tämän jo;
    // käsin asetettu ei.
    let doneForOverride = 0;
    if (fromId && toId) {
      for (const t of transfers) {
        if (t.fromId === fromId && t.toId === toId) doneForOverride += r(t.cents);
        else if (t.fromId === toId && t.toId === fromId) doneForOverride -= r(t.cents);
      }
    }
    const remaining = gross - doneForOverride;
    transfer = !fromId || !toId || remaining === 0
      ? null
      : remaining > 0
        ? { fromId, toId, cents: remaining }
        // Ylisiirretty myös käsin sovitussa: erotus palaa toiseen suuntaan.
        : { fromId: toId, toId: fromId, cents: -remaining };
    if (fromId && toId) alreadyTransferredCents = doneForOverride;
  } else if (grossTransfer) {
    const remaining = grossTransfer.cents - alreadyTransferredCents;
    transfer = remaining > 0
      ? { fromId: grossTransfer.fromId, toId: grossTransfer.toId, cents: remaining }
      : remaining < 0
        // Yli­siirretty: raha on kulkenut liikaa, joten se palaa toiseen suuntaan.
        ? { fromId: grossTransfer.toId, toId: grossTransfer.fromId, cents: -remaining }
        : null;
  } else {
    // Ei laskettua eroa, mutta siirtoja on voitu silti tehdä → ne pitää palauttaa.
    transfer = reverseOf(transfers, founders);
  }

  return {
    xCents,
    p1WindowsTotal,
    distributableCents,
    founderKateCents,
    rows,
    reserveCents: netSum,
    grossTransfer,
    alreadyTransferredCents,
    transfer,
    overridden,
    checkCents: netSum,
  };
}

/** Suurin velallinen maksaa suurimmalle saajalle. Kahdella johtajalla tämä on
 *  aina täsmälleen `(netto A − netto B) / 2`. */
function pickTransfer(rows: TasausFounderRow[]): TasausTransfer | null {
  let payer: TasausFounderRow | null = null;
  let payee: TasausFounderRow | null = null;
  for (const row of rows) {
    if (row.dueCents > 0 && (!payer || row.dueCents > payer.dueCents)) payer = row;
    if (row.dueCents < 0 && (!payee || row.dueCents < payee.dueCents)) payee = row;
  }
  if (!payer || !payee) return null;
  const cents = Math.min(payer.dueCents, -payee.dueCents);
  return cents > 0 ? { fromId: payer.id, toId: payee.id, cents } : null;
}

/** Kun laskettu ero on nolla mutta siirtoja on tehty, oikea liike on palauttaa
 *  ne — muuten näkymä väittäisi "tasan" vaikka raha on väärässä taskussa. */
function reverseOf(transfers: TasausTransfer[], founders: TasausFounderInput[]): TasausTransfer | null {
  if (founders.length < 2 || transfers.length === 0) return null;
  const [a, b] = founders;
  let net = 0; // a → b positiivisena
  for (const t of transfers) {
    if (t.fromId === a.id && t.toId === b.id) net += r(t.cents);
    else if (t.fromId === b.id && t.toId === a.id) net -= r(t.cents);
  }
  if (net === 0) return null;
  return net > 0 ? { fromId: b.id, toId: a.id, cents: net } : { fromId: a.id, toId: b.id, cents: -net };
}
