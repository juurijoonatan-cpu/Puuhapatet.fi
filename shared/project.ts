/**
 * Project / floor-plan window-washing tool — shared by client and server.
 *
 * This is the persistent model behind the FR8 "projektinäkymä" (the floor-plan
 * mapping, dashboard and work-hours tool that used to live as a localStorage-only
 * Next.js prototype in `fr8-ikkunat/`). It is stored as JSON in `jobs.projectData`
 * so nothing gets lost, and it adds worker attribution on top of the original
 * prototype so we can show per-worker window counts and €/h optimisation.
 *
 * Window identity: a key is `"<floor>#<index>"` for a seeded mark, or
 * `"<floor>#c<rand>"` for a custom (manually added) mark — same scheme the
 * prototype used, so the dot positions and logic stay identical.
 */

import type { GigData, GigSector } from "./gig";
import { sanitizeCrew, DEFAULT_WORKER_PER_WINDOW_CENTS, type CrewMember } from "./crew";
import { PAY_PERIODS, eraWindowCounts } from "./payprogress";
import { sanitizeP2State, type P2State } from "./p2";
import { sanitizeGuidedWork, type GuidedWork } from "./guided";
import { sanitizeFounderSettlementState, type FounderSettlementState } from "./founder-settlement";

// ─── Data shapes ───────────────────────────────────────────────────────────────

export type WindowStatus = "ei" | "kesken" | "pesty";

export interface ProjMark { p: 1 | 2; x: number; y: number; }
export interface ProjFloorData { marks: ProjMark[]; }
export type ProjMarksData = Record<string, ProjFloorData>;

export interface ProjCustomMark { key: string; p: 1 | 2; x: number; y: number; }

/**
 * A non-window map marker: important rooms / navigation aids the crew place on a
 * floor plan so the building is easier to move around (ladder location, entrance,
 * water point, a hazard, or a free-text note). Kept separate from window marks so
 * they never affect window counts, pricing or progress.
 */
export type ProjNoteKind = "ladder" | "entrance" | "water" | "wc" | "warning" | "info";

export interface ProjMapNote {
  key: string;           // unique id, "<floor>#n<rand>"
  x: number;             // 0..100 (% of plan width)
  y: number;             // 0..100 (% of plan height)
  kind: ProjNoteKind;
  text?: string;         // optional free-text note
  ts: number;            // epoch ms
  by?: string;           // worker id who placed it
}

/** Display metadata for each note kind (label + emoji glyph). */
export const NOTE_KINDS: Record<ProjNoteKind, { label: string; glyph: string }> = {
  ladder:   { label: "Tikkaat",       glyph: "🪜" },
  entrance: { label: "Sisäänkäynti",  glyph: "🚪" },
  water:    { label: "Vesipiste",     glyph: "🚰" },
  wc:       { label: "WC",            glyph: "🚻" },
  warning:  { label: "Varoitus",      glyph: "⚠️" },
  info:     { label: "Huomio",        glyph: "📍" },
};

export function toNoteKind(v: any): ProjNoteKind {
  return (v === "ladder" || v === "entrance" || v === "water" || v === "wc" || v === "warning" || v === "info") ? v : "info";
}

/**
 * The single "work happening here now" highlight: a coloured, pulsing marker the
 * crew drops on the floor plan so anyone (incl. the customer's live view) can see
 * where work is currently being done. Only one per project — moving it relocates.
 */
export interface ProjActiveZone {
  floor: string;
  x: number;             // 0..100 (% of plan width)
  y: number;             // 0..100 (% of plan height)
  label?: string;        // optional short label, e.g. "Sali 3"
  ts: number;            // epoch ms (when set/moved)
}

/**
 * A worker's observation about ONE specific window (keyed by the window key, same
 * as statuses/washedBy). Text is the point; an optional photo is extra. Shown to
 * the customer as a small dismissible popup on that window's dot.
 */
export interface ProjWindowObservation {
  text: string;          // free-text note about the window
  imageDataUrl?: string; // optional photo (downscaled data URL)
  by?: string;           // worker id who wrote it
  ts: number;            // epoch ms
  /**
   * Vain siirtoa varten, EI tallenneta. Kun palvelin lähettää havainnon ilman
   * kuvaa (ks. `stripObservationImages`), tämä kertoo että kuva on olemassa —
   * niin käyttöliittymä osaa hakea sen vasta kun pistettä napautetaan.
   */
  hasImage?: boolean;
  /**
   * Viite `job_assets`-tauluun. Kun tämä on asetettu, kuva EI ole blobissa
   * vaan omassa taulussaan, eikä `imageDataUrl` ole enää mukana. Vanhat
   * havainnot kantavat kuvan yhä inline — lukupolut osaavat molemmat.
   */
  imageAssetId?: number;
}

/** Max stored size for an observation photo data URL (~0.5 MB base64). */
export const MAX_OBSERVATION_IMAGE_LEN = 700_000;

/**
 * Havainnot ilman kuvadataa, laiskaa latausta varten.
 *
 * Havaintokuva on jopa 0,5 MB base64. Ne lähtivät joka vastauksessa: tekijän
 * näkymä palautetaan 13 eri reitiltä (jokainen ikkunanapautus on yksi), ja
 * asiakkaan seurantasivu pollaa omansa itsekseen. Kymmenen havaintokuvaa = 5 MB
 * jokaista napautusta kohden, vaikka kuvaa katsotaan käytännössä kerran.
 *
 * Teksti, tekijä ja aikaleima jäävät mukaan, joten 💬-merkki ja havainnon
 * sisältö näkyvät kartalla heti kuten ennenkin. `hasImage` kertoo että kuva on
 * haettavissa erillisestä osoitteesta.
 */
export function stripObservationImages(
  obs: Record<string, ProjWindowObservation> | undefined | null,
): Record<string, ProjWindowObservation> {
  const out: Record<string, ProjWindowObservation> = {};
  for (const [k, o] of Object.entries(obs ?? {})) {
    if (!o) continue;
    const base = { text: o.text, by: o.by, ts: o.ts };
    // `imageAssetId` kulkee mukana, jotta selain voi pyytää kuvan suoraan
    // avaimella — silloin palvelimen ei tarvitse lukea koko karttablobia
    // yhden kuvan palauttamiseksi. `hasImage` yksin jätti sen tekemättä.
    if (o.imageAssetId) out[k] = { ...base, hasImage: true, imageAssetId: o.imageAssetId };
    else if (o.imageDataUrl) out[k] = { ...base, hasImage: true };
    else out[k] = base;
  }
  return out;
}

export interface ProjLogEntry {
  floor: string;
  key: string;
  p: 1 | 2;
  status: WindowStatus;
  ts: number;            // epoch ms
  by?: string;           // worker id who logged it
}

export interface ProjHourEntry {
  worker: string;        // worker id ("matias" | "joonatan" | …)
  delta: number;         // hours added (may be negative)
  ts: number;            // epoch ms
  by?: string;           // who recorded it
}

export type ProjExpenseKind = "transport" | "materials" | "equipment" | "other";

/** Max stored size for an expense receipt photo data URL (~0.5 MB base64). */
export const MAX_EXPENSE_RECEIPT_LEN = 700_000;

export interface ProjExpense {
  id: string;
  by: string;            // worker/manager id who logged it
  kind: ProjExpenseKind;
  desc: string;
  amountCents: number;
  ts: number;            // epoch ms — automatic timestamp (kirjanpidon tosite)
  /** Which person's company (Y-tunnus) bears this cost for accounting purposes.
   *  Separate from `by` (who paid): e.g. Joonatan might pay but it's Matias's cost. */
  forWhom?: string;
  /** Optional photo of the receipt (kuitti), downscaled data URL. Kirjanpitoa
   *  varten: jokaisesta kulusta talletetaan kuitti + aikaleima. */
  receiptDataUrl?: string;
}

/**
 * How a plan image should be presented.
 *
 * FR8:n pohjakuvat ovat vaaleaa viivapiirrosta, joten asiakaskartta kääntää
 * värit (`invert(1)`) ja rajaa 2 % reunoista pois. Valokuvalle tai
 * ruudunkaappaukselle molemmat ovat väärin: kuva näkyisi negatiivina ja sen
 * reunat leikkautuisivat. Tämä kertoo kummasta on kyse.
 *
 *   "plan"  → viivapiirros: käännä värit, rajaa reunat (FR8:n vanha käytös)
 *   "photo" → kuva/kaappaus: näytä sellaisenaan
 */
export type PlanRender = "plan" | "photo";

export function toPlanRender(v: any): PlanRender | undefined {
  return v === "plan" || v === "photo" ? v : undefined;
}

/** Efektiivinen esitystapa: puuttuva = "plan", eli FR8:n vanha käytös. */
export function planRenderOf(b: ProjBuilding | undefined | null): PlanRender {
  return toPlanRender(b?.planRender) ?? "plan";
}

/**
 * Kerroksen pohjakuvan osoite — YKSI paikka jota kaikki kolme näkymää käyttävät.
 *
 * Kaksi lähdettä, tässä järjestyksessä:
 *   1. LADATTU kuva (`building.planImages[floor]`) → `<urlBase><floor>?v=<id>`.
 *      `urlBase` on yleisökohtainen, koska tunnistus on eri: admin
 *      `/api/jobs/:id/plan/`, asiakas `/api/gig/:token/plan/`, tekijä
 *      `/api/crew/:token/plan/`. `?v=<id>` vaihtuu kun kuva korvataan, joten
 *      selaimen välimuisti ei jää näyttämään vanhaa.
 *   2. STAATTINEN polku (`planBase`) → `<planBase><floor>.png` (FR8).
 *
 * Palauttaa null kun kumpaakaan ei ole — silloin näkymä näyttää "ei pohjakuvaa"
 * -tilan sen sijaan että piirtäisi rikkinäisen kuvan.
 */
export function planImageUrl(
  building: ProjBuilding | undefined | null,
  floor: string,
  urlBase?: string | null,
): string | null {
  const assetId = building?.planImages?.[floor];
  if (assetId && urlBase) {
    return `${urlBase}${encodeURIComponent(floor)}?v=${assetId}`;
  }
  const base = building?.planBase;
  return base ? `${base}${floor}.png` : null;
}

/** True kun keikalla on jokin pohjakuva (ladattu tai staattinen). */
export function hasAnyPlan(building: ProjBuilding | undefined | null): boolean {
  if (building?.planBase) return true;
  return Object.keys(building?.planImages ?? {}).length > 0;
}

export interface ProjBuilding {
  name?: string;         // "FR8 — VANHA TKK"
  address?: string;      // "Bulevardi 31"
  floors: string[];      // ["K","1","2","3","4","5"]
  planBase?: string;     // image base path, e.g. "/fr8/plans/bp-" → bp-K.png
  /**
   * Ladatut pohjakuvat: kerros → `job_assets`-rivin id.
   *
   * MIKSI VIITE EIKÄ KUVA: kuva EI saa asua tässä blobissa. Blobi luetaan
   * jokaisella ikkunanapautuksella ja jokaisella asiakkaan seurantakierroksella
   * — juuri se kaatoi Neonin siirtokiintiön kertaalleen. Tässä on vain id;
   * kuva haetaan omasta reitistään vasta kun kartta piirretään, ja selain
   * välimuistittaa sen.
   *
   * Kun kerroksella on tässä id, sitä käytetään; muuten palataan
   * `planBase`+kerros+".png"-polkuun (FR8).
   *
   * SERVERIN OMISTAMA kuten `p2`/`guided`: geneerinen blob-tallennus säilyttää
   * talletetun kopion, jottei vanhentunut asetusluonnos pyyhi juuri ladattua
   * kuvaa. Mutaatiot vain omien reittiensä kautta.
   */
  planImages?: Record<string, number>;
  /** Miten pohjakuva esitetään (`PlanRender`). Puuttuva = "plan" (FR8). */
  planRender?: PlanRender;
  /**
   * Yksikön nimi monikossa/yksikössä kun "kerros" on väärä sana — esim. yhden
   * huoneen keikalla "tila". Puuttuva = "kerros" (FR8). Ks. `floorLabel`.
   */
  unitWord?: string;
}

export interface ProjectData {
  version: 1;
  building: ProjBuilding;
  pricePerWindow: number;                          // euros per washed window
  marks: ProjMarksData;                            // seeded base marks (persisted)
  statuses: Record<string, WindowStatus>;          // key → status (non-"ei" only)
  washedBy: Record<string, string>;                // key → worker id who last washed it
  /** Optional second washer for a window done together — the window stays one
   *  fully-washed window for progress & billing, but its credit/earnings split
   *  50/50 between washedBy[key] and washedBy2[key]. Manager-set only. */
  washedBy2?: Record<string, string>;
  keskenBy?: Record<string, string>;               // key → worker id who marked it "kesken"
  customMarks: Record<string, ProjCustomMark[]>;   // floor → manually added marks
  notes?: Record<string, ProjMapNote[]>;           // floor → navigation markers / notes
  observations?: Record<string, ProjWindowObservation>; // window key → worker's observation
  activeZone?: ProjActiveZone | null;              // where work is happening right now
  posOverrides: Record<string, { x: number; y: number }>; // key → moved position
  deleted: Record<string, boolean>;                // key → true if seeded mark removed
  log: ProjLogEntry[];                             // newest-first
  hours: Record<string, number>;                   // worker id → total hours
  hourLog: ProjHourEntry[];                         // newest-first
  workers: string[];                                // worker ids shown in hours view
  crew?: CrewMember[];                              // hard-coded gig workers w/ private links (shared/crew.ts)
  expenses?: ProjExpense[];                         // logged job expenses (managers + workers)
  /** Founders' editable per-instalment (erä) window counts for the fixed deal,
   *  e.g. [40,41,42,45]. Drives the per-erä kate on the crew/payroll page; absent
   *  → even split. Display/planning only — does NOT affect worker pay or earnings. */
  eraWindows?: number[];
  /** Which signed deal this gig runs on (`GigDealKind`). Absent = decide from
   *  the plan path, i.e. exactly the old behaviour — so FR8's stored blob is
   *  unchanged. New gigs are created as `"none"` so they can never inherit
   *  FR8's contract by accident. */
  dealKind?: GigDealKind;
  /** Miten keikasta korvataan (`GigCompensation`). Puuttuva = "money". */
  compensation?: GigCompensation;
  /**
   * Arvio yhden ikkunan pesuun kuluvasta ajasta tunteina (esim. 1.5 kun
   * ikkunat ovat isoja monilohkoisia). Vapaaehtoinen; kun asetettu, siitä
   * johdetaan keikan kokonaisarvio ja tuntipohjainen ETA (`computeEfficiency`).
   * Pelkkä suunnittelutieto — ei vaikuta rahaan eikä palkkoihin.
   */
  estimatedHoursPerWindow?: number;
  /** Priority 2 (keltaiset ikkunat): per-window pricing + customer negotiation
   *  (shared/p2.ts). Absent = the gig behaves exactly as before. Mutated ONLY via
   *  the dedicated /p2 endpoints — generic blob saves keep the stored copy. */
  p2?: P2State;
  /** Guided progression (ohjattu eteneminen, shared/guided.ts): one-floor-at-a-time
   *  fairness lock + "next window" guidance. Founder toggle, default OFF — absent or
   *  disabled = no behavioural change. Only the toggle + override are persisted here;
   *  the active floor / next window are DERIVED (computeGuided). */
  guided?: GuidedWork;
  /** Johtajien tasaus (shared/founder-settlement.ts): kuka SAI kunkin erän rahat
   *  ja kuka MAKSOI kunkin tekijälaskun, kun raha liikkui toisin kuin paperilla,
   *  + käsin asetettu siirtosumma ja kirjatut siirrot. Absent = ei korjauksia,
   *  tasaus lukee pelkän laskudatan. Mutatoidaan VAIN /settlement-reitin kautta —
   *  geneerinen blob-tallennus säilyttää talletetun kopion, kuten p2/guided. */
  settlement?: FounderSettlementState;
  updatedAt: number;                                // epoch ms
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_FLOORS = ["K", "1", "2", "3", "4", "5"];
export const DEFAULT_PRICE_PER_WINDOW = 35;
export const PLAN_BASE = "/fr8/plans/bp-";

/** True for the original FR8 gig, whose floor plans ship bundled with the app. */
export function isFr8Plans(planBase: string | undefined | null): boolean {
  return !!planBase && planBase.includes("/fr8/");
}

// ─── Fixed, signed deals ───────────────────────────────────────────────────────
//
// The FR8 (Bulevardi 31) gig is a signed, fixed-price agreement and must NOT be
// editable in the panel: €37.50 per washed RED (priority 1) window, with a total
// agreed cap of €6300 (≈168 windows). Yellow (priority 2) windows stay on the map
// for future work but are NOT part of this deal, so they never accrue money here.

export const FR8_PRICE_PER_WINDOW = 37.5;        // € per washed red window
export const FR8_CONTRACT_CAP_CENTS = 630_000;   // €6300 agreed total (hard cap)
export const FR8_BILLABLE_PRIORITY: 1 | 2 = 1;   // only red windows are in the deal
export const FR8_DEAL_RED_WINDOWS = 168;         // agreed scope: 168 × 37,50 € = 6300 €

export interface FixedDeal {
  pricePerWindow: number;     // € per billable window
  capCents: number;           // agreed total (the bill can never exceed this)
  billablePriority: 1 | 2;    // which window priority the deal covers
}

/**
 * Which signed deal a gig runs on.
 *
 * MIKSI TÄMÄ ON OLEMASSA: ennen tätä FR8:n allekirjoitettu 6300 €:n urakka
 * kiinnittyi keikkaan pelkän MERKKIJONOHAUN perusteella — `planBase`in piti
 * vain sisältää "/fr8/". `planBase` on vapaa tekstikenttä, jonka
 * paikkamerkkiteksti on kirjaimellisesti `/fr8/plans/bp-`, joten uusi keikka
 * peri FR8:n sopimuksen (37,50 €/punainen, katto 6300 €, 4 erälaskua) heti jos
 * joku kopioi polun mallista tai tallensi pohjakuvansa samaan kansioon. Vapaa
 * yhteisökeikka olisi saanut 562,50 €:n haamusopimuksen ilman että mikään
 * kertoo siitä.
 *
 * Nyt keikka voi SANOA kumpi se on, eikä sitä tarvitse arvata polusta:
 *   - `"fr8"`  → FR8:n allekirjoitettu urakka (riippumatta polusta)
 *   - `"none"` → ei kiinteää urakkaa; keikka käyttää omaa hintaansa
 *   - puuttuu  → vanha käyttäytyminen (polkuhaku), jotta FR8:n talletettu
 *                blobi round-trippaa identtisesti ilman migraatiota
 *                (ks. invariantti 7, docs/fr8-jarjestelma-yleiskuva.md).
 */
export type GigDealKind = "fr8" | "none";

export function toDealKind(v: any): GigDealKind | undefined {
  return v === "fr8" || v === "none" ? v : undefined;
}

/**
 * Miten keikasta korvataan.
 *
 *   "money"     → tavallinen maksullinen keikka (oletus, FR8)
 *   "community" → yhteisökeikka: EI rahaa. Korvaus on jotain muuta (näkyvyyttä,
 *                 vastapalvelusta). Hinta on aidosti 0 €, eikä euroja näytetä
 *                 asiakkaalle lainkaan.
 *
 * MIKSI TÄMÄ TARVITTIIN: 0 €/ikkuna ei ollut ESITETTÄVISSÄ. Sanitoija muutti
 * nollan takaisin oletushinnaksi (`clampNonNeg(...) || DEFAULT_PRICE_PER_WINDOW`),
 * ja neljä laskentakohtaa toisti saman maskin. Vastikkeeton keikka näytti siis
 * 35 €/ikkuna -keikalta, ja `PATCH /project` kirjoitti siitä johdetun summan
 * `jobs.agreedPrice`iin — vapaaehtoistyö olisi näkynyt liikevaihtona.
 */
export type GigCompensation = "money" | "community";

export function toCompensation(v: any): GigCompensation | undefined {
  return v === "money" || v === "community" ? v : undefined;
}

/** True kun keikasta ei liiku rahaa — euroja ei lasketa eikä näytetä. */
export function isCommunityGig(data: Pick<ProjectData, "compensation">): boolean {
  return data.compensation === "community";
}

/**
 * Ikkunan hinta euroina — YKSI paikka jossa oletushinnan varakäytäntö asuu.
 *
 * Yhteisökeikalla tämä on aidosti 0 eikä varakäytäntöä sovelleta. Muualla
 * käytös on ennallaan: puuttuva tai kelvoton hinta → `DEFAULT_PRICE_PER_WINDOW`.
 * Tämä korvaa neljä erillistä `data.pricePerWindow || DEFAULT_PRICE_PER_WINDOW`
 * -riviä, jotka olisi pitänyt muistaa muuttaa kaikki yhtä aikaa.
 */
export function pricePerWindowOf(data: ProjectData): number {
  if (isCommunityGig(data)) return 0;
  return data.pricePerWindow || DEFAULT_PRICE_PER_WINDOW;
}

/**
 * Kerroksen näyttönimi. FR8:lla "Kellari" / "3. kerros"; kun `unitWord` on
 * asetettu (esim. "tila"), nimi muodostetaan siitä — yhden huoneen keikalla
 * "3. kerros" olisi väärä sana.
 */
export function floorLabel(building: ProjBuilding | undefined | null, floor: string): string {
  const word = building?.unitWord?.trim();
  if (!word) return floor === "K" ? "Kellari" : `${floor}. kerros`;
  // Yhden yksikön keikalla pelkkä sana riittää ("Tila"), muuten numeroidaan.
  const many = (building?.floors?.length ?? 0) > 1;
  const w = many ? `${floor}. ${word}` : word;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** The locked deal for a gig, or null when the gig uses an editable price. */
export function fixedDealFor(data: ProjectData): FixedDeal | null {
  // An explicit declaration always wins over the legacy path sniff, in BOTH
  // directions: "none" can never be talked into a deal by its plan path, and
  // "fr8" keeps the signed deal even if the plans are ever moved elsewhere.
  const kind = data.dealKind;
  if (kind === "none") return null;
  if (kind !== "fr8" && !isFr8Plans(data.building.planBase)) return null;
  return {
    pricePerWindow: FR8_PRICE_PER_WINDOW,
    capCents: FR8_CONTRACT_CAP_CENTS,
    billablePriority: FR8_BILLABLE_PRIORITY,
  };
}

/**
 * The EFFECTIVE billable scope of a fixed deal: the signed agreed count
 * (e.g. 168 red windows = €6300), but reduced if fewer red windows actually
 * exist on the map. Removing a red window genuinely shrinks the deal — its
 * per-window price (37,50 €) comes off the agreed total — while adding windows
 * never pushes the deal above the agreed cap. Never negative.
 */
export function dealBillableScope(data: ProjectData, deal: FixedDeal): number {
  const redCount = allPoints(data).filter((p) => p.p === deal.billablePriority).length;
  const unit = Math.round(deal.pricePerWindow * 100);
  const agreedCount = unit > 0 ? Math.round(deal.capCents / unit) : 0; // 168 for FR8
  return Math.max(0, Math.min(agreedCount, redCount));
}

/** Effective agreed total in cents = scope × unit price (never above the cap).
 *  When every agreed window exists this equals the signed cap (€6300); each
 *  removed window below the agreed scope lowers it by one unit price. */
export function dealAgreedTotalCents(data: ProjectData, deal: FixedDeal): number {
  const unit = Math.round(deal.pricePerWindow * 100);
  return Math.min(deal.capCents, dealBillableScope(data, deal) * unit);
}

/**
 * Perustajan SISÄINEN kate per ikkuna (senttiä) = efektiivinen sopimussumma ÷
 * punaisten ikkunoiden määrä. Tämä on perustajan oman työn todellinen ansio per
 * ikkuna, EI nimellinen 37,50 € (joka on laskettu sopimuksen 168 ikkunan mukaan).
 *
 * Miksi tämä on oma funktio: sama luku laskettiin aiemmin KAHDELLA eri kaavalla —
 * `project.tsx` käytti raakaa `deal.capCents` (630000) ja `Dashboard.tsx`
 * efektiivistä `computeDealBilling().capCents` (joka pienenee poistetuista
 * punaisista). Ero jakoi perustajille + tekijöille enemmän kuin keikka kertyi.
 * Nyt yksi kaava, efektiivinen summa, molemmissa.
 */
export function dealInternalRateCents(data: ProjectData, deal: FixedDeal): number {
  const redCount = allPoints(data).filter((p) => p.p === deal.billablePriority).length;
  if (redCount <= 0) return dealAgreedTotalCents(data, deal);
  return Math.round(dealAgreedTotalCents(data, deal) / redCount);
}

export interface DealBilling {
  billableTotal: number;   // billable (e.g. red) windows on the whole job
  billableWashed: number;  // billable windows marked "pesty"
  accruedCents: number;    // completion fraction × the fixed agreed total
  capCents: number;        // agreed total (FIXED — a flat price, not count × unit)
  pct: number;             // completion, 0..100
}

/**
 * Money for a fixed-price deal (FR8). The agreed sum is a FLAT TOTAL (`capCents`,
 * e.g. €6300) — it is NOT count × unit price. So the contract value stays locked
 * at the agreed total no matter how the red-window count changes (dots added or
 * removed), and the accrued figure is simply the completion fraction of that fixed
 * total — reaching exactly the agreed price when every live red window is washed.
 */
export function computeDealBilling(data: ProjectData, deal: FixedDeal): DealBilling {
  const pts = allPoints(data).filter((p) => p.p === deal.billablePriority);
  const billableTotal = pts.length;
  const billableWashed = pts.filter((p) => p.status === "pesty").length;
  const frac = billableTotal > 0 ? billableWashed / billableTotal : 0;
  // Effective agreed total shrinks below the cap when fewer than the agreed
  // number of red windows exist (removed windows come off the price); accrued
  // tracks completion toward THIS total, reaching it when every live red is washed.
  const agreedCents = dealAgreedTotalCents(data, deal);
  const accruedCents = Math.min(Math.round(frac * agreedCents), agreedCents);
  return {
    billableTotal,
    billableWashed,
    accruedCents,
    capCents: agreedCents,
    pct: frac * 100,
  };
}

export function emptyProjectData(): ProjectData {
  return {
    version: 1,
    building: {
      // Neutral by default — the FR8 gig keeps its own saved building info, and
      // any new gig is a blank, editable slate (no FR8 name/branding/plans).
      name: undefined,
      address: undefined,
      floors: [...DEFAULT_FLOORS],
      planBase: "",
    },
    pricePerWindow: DEFAULT_PRICE_PER_WINDOW,
    // NOTE: `dealKind` is deliberately NOT set here. `emptyProjectData()` is
    // also used as a load-failure fallback (GigToolsOverlay), and stamping
    // "none" there would strip FR8's signed deal if that fallback were ever
    // saved. New gigs are stamped explicitly at creation instead — see
    // `newGigProjectData()`.
    marks: {},
    statuses: {},
    washedBy: {},
    washedBy2: {},
    customMarks: {},
    notes: {},
    observations: {},
    activeZone: null,
    posOverrides: {},
    deleted: {},
    log: [],
    hours: {},
    hourLog: [],
    workers: ["matias", "joonatan"],
    crew: [],
    expenses: [],
    updatedAt: Date.now(),
  };
}

/**
 * A blank project for a BRAND-NEW gig.
 *
 * Same as `emptyProjectData()` but explicitly declares that this gig is not the
 * FR8 contract. Use this whenever a gig gets its first project; use
 * `emptyProjectData()` only for throwaway/fallback objects that might be
 * written over an existing gig.
 */
export function newGigProjectData(opts?: { community?: boolean }): ProjectData {
  return {
    ...emptyProjectData(),
    dealKind: "none",
    // Yhdistyskeikka on tyypillisesti vastikkeeton, joten se aloitetaan
    // yhteisökeikkana. Tämä on OLETUS, ei kytkös: sama yhdistys voi maksaa
    // toisesta keikasta, ja korvaustapa on vaihdettavissa keikan asetuksista.
    ...(opts?.community ? { compensation: "community" as const, pricePerWindow: 0 } : {}),
  };
}

// ─── Window enumeration ────────────────────────────────────────────────────────

export interface ProjPoint {
  floor: string;
  key: string;
  p: 1 | 2;
  status: WindowStatus;
  washedBy?: string;
}

/** Flatten all live (non-deleted) windows across floors, with current status. */
export function allPoints(data: ProjectData): ProjPoint[] {
  const out: ProjPoint[] = [];
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  for (const f of floors) {
    (data.marks[f]?.marks || []).forEach((mk, idx) => {
      const key = `${f}#${idx}`;
      if (!data.deleted[key]) {
        out.push({ floor: f, key, p: mk.p, status: data.statuses[key] || "ei", washedBy: data.washedBy[key] });
      }
    });
    (data.customMarks[f] || []).forEach((cm) => {
      if (!data.deleted[cm.key]) {
        out.push({ floor: f, key: cm.key, p: cm.p, status: data.statuses[cm.key] || "ei", washedBy: data.washedBy[cm.key] });
      }
    });
  }
  return out;
}

// ─── Calculations ──────────────────────────────────────────────────────────────

export interface ProjTotals {
  total: number;
  washed: number;
  kesken: number;
  unwashed: number;
  pct: number;            // 0..100
  revenueCents: number;   // washed × price
  contractCents: number;  // total × price
}

export function computeProjectTotals(data: ProjectData): ProjTotals {
  const pts = allPoints(data);
  const total = pts.length;
  const washed = pts.filter((p) => p.status === "pesty").length;
  const kesken = pts.filter((p) => p.status === "kesken").length;
  const unwashed = total - washed - kesken;
  const price = pricePerWindowOf(data);
  return {
    total,
    washed,
    kesken,
    unwashed,
    pct: total > 0 ? (washed / total) * 100 : 0,
    revenueCents: Math.round(washed * price * 100),
    contractCents: Math.round(total * price * 100),
  };
}

export interface WorkerStat {
  worker: string;
  washed: number;          // windows washed (attributed) — ALL priorities
  /** Split by priority. The red contract and the yellow (P2) extra work are paid
   *  from different money at different times, so anything that turns windows into
   *  euros MUST pick the right one instead of using the combined `washed`. */
  washedP1: number;
  washedP2: number;
  revenueCents: number;    // washed × price
  hours: number;           // logged hours
  windowsPerHour: number;  // washed / hours (0 if no hours)
  eurPerHour: number;      // euros earned / hours (work-hour optimisation)
}

/**
 * Per-worker optimisation stats: how many windows each worker has washed,
 * how many hours they've logged, and the resulting throughput (windows/h and €/h).
 */
export function computeWorkerStats(data: ProjectData): WorkerStat[] {
  const pts = allPoints(data);
  const price = pricePerWindowOf(data);
  const washedBy2 = data.washedBy2 || {};
  // Union of configured workers + anyone who appears in attribution / hours.
  const ids = new Set<string>(data.workers || []);
  pts.forEach((p) => {
    if (p.status === "pesty" && p.washedBy) ids.add(p.washedBy);
    if (p.status === "pesty" && washedBy2[p.key]) ids.add(washedBy2[p.key]);
  });
  Object.keys(data.hours || {}).forEach((w) => ids.add(w));
  return Array.from(ids).map((worker) => {
    // A window done together (washedBy2 set) splits its credit 50/50, so each of
    // the two washers earns half a window; a solo window earns the full one.
    let washed = 0;
    let washedP1 = 0;
    let washedP2 = 0;
    for (const p of pts) {
      if (p.status !== "pesty") continue;
      const second = washedBy2[p.key];
      let share = 0;
      if (p.washedBy === worker) share = second ? 0.5 : 1;
      else if (second === worker) share = 0.5;
      if (!share) continue;
      washed += share;
      if (p.p === 2) washedP2 += share; else washedP1 += share;
    }
    const hours = Math.max(0, data.hours?.[worker] || 0);
    const revenueCents = Math.round(washed * price * 100);
    return {
      worker,
      washed,
      washedP1,
      washedP2,
      revenueCents,
      hours,
      windowsPerHour: hours > 0 ? washed / hours : 0,
      eurPerHour: hours > 0 ? revenueCents / 100 / hours : 0,
    };
  });
}

/**
 * FR8-speksin kohta 6.1: kokonaistilanteen ikkunamäärän ("Kaikki pesijät
 * yhteensä") pitää täsmätä TARKALLEEN pesty-tilassa olevien ikkunoiden
 * määrään — summattuna tarkoilla desimaaleilla (0.5-jaetut ikkunat), EI
 * pyöristäen jokaista tekijän riviä ennen summausta. Tämä funktio ei itse
 * pyöristä mitään: jos jokin `computeWorkerStats`-kutsuja pyöristäisi
 * `washed`-arvon per rivi ennen summausta, tämä paljastaisi eron.
 *
 * Toinen mahdollinen syy erolle (ei pyöristys vaan puuttuva attribuutio):
 * pesty-ikkuna, jonka `washedBy` ei osu kehenkään `computeWorkerStats`:n
 * tuntemaan tekijään (esim. poistettu/tuntematon id) — silloin ikkuna
 * lasketaan `computeProjectTotals().washed`:iin mutta ei kenenkään omaan
 * summaan, ja `attributedSum` jää `dotCount`:ia pienemmäksi.
 */
export interface WindowAttributionCheck {
  dotCount: number;         // computeProjectTotals().washed — tarkka pesty-pisteiden määrä
  attributedSum: number;    // SUM(computeWorkerStats().washed), tarkoilla desimaaleilla
  diff: number;             // dotCount - attributedSum (0 = täsmää)
  matches: boolean;         // |diff| < 1e-6
}

export function checkWindowAttribution(data: ProjectData): WindowAttributionCheck {
  const dotCount = computeProjectTotals(data).washed;
  const attributedSum = computeWorkerStats(data).reduce((s, w) => s + w.washed, 0);
  const diff = dotCount - attributedSum;
  return { dotCount, attributedSum, diff, matches: Math.abs(diff) < 1e-6 };
}

// ─── Per-erä (instalment) debt attribution ─────────────────────────────────────
//
// "Eräkohtainen velka": when the founders set erä 1 = 40 windows, who washed those
// FIRST 40 windows (in wash order) and how many each — and thus the palkka owed for
// that erä. The wash order is taken from the activity log's `pesty` timestamps; the
// authoritative washer for each window is `washedBy`/`washedBy2` (same attribution
// the earnings model uses everywhere else), so the per-erä split always reconciles
// with each worker's total earnings. Pure reporting: it never changes pay.

export interface EraWorkerShare {
  workerId: string;
  name: string;
  windows: number;      // windows credited to this worker in this erä (0.5 for a shared window)
  earnedCents: number;  // windows × the worker's €/ikkuna rate
}

export interface EraDebtBreakdown {
  era: number;              // 1-based erä number
  size: number;             // target window count for this erä
  washed: number;           // windows of this erä actually washed so far
  complete: boolean;        // the whole erä has been washed
  earnedCents: number;      // total palkka owed for this erä's washed windows (labour)
  /** Windows of this erä the FOUNDERS washed themselves. They cost no palkka —
   *  a founder's own window is pure margin — so they are excluded from `workers`
   *  and `earnedCents` and reported separately here. */
  founderWindows: number;
  /** The fixed instalment this erä is billed at (capCents ÷ erät, e.g. 1575 €). */
  instalmentCents: number;
  /** Founders' passive income for this erä = instalment − labour for its washed
   *  windows. Exact once the erä is fully washed; a running figure before that. */
  marginCents: number;
  /** Which founder billed the customer for this instalment (set server-side from
   *  the sent invoice). Undefined until the instalment has been invoiced. */
  biller?: { id?: string; name?: string } | null;
  workers: EraWorkerShare[];// who washed them, biggest share first
}

/**
 * Attribute the washed billable windows to the founders' erät in wash order, and
 * within each erä break the windows down by washer (+ the palkka that implies).
 * `eraWindows` are the founders' editable per-erä sizes (absent → even split).
 */
export function computeEraDebts(
  data: ProjectData,
  deal: FixedDeal,
  crew: CrewMember[],
  eraWindows: number[] | null,
): EraDebtBreakdown[] {
  const billable = allPoints(data).filter((p) => p.p === deal.billablePriority);
  const totalBillable = billable.length;
  const sizes = eraWindowCounts(totalBillable, PAY_PERIODS, eraWindows);
  const washedBy2 = data.washedBy2 || {};

  // Earliest "pesty" timestamp per window key, from the activity log — the basis
  // for wash order. The log is capped, so some washed windows may have no entry.
  const firstWashTs = new Map<string, number>();
  for (const l of data.log) {
    if (l.status !== "pesty") continue;
    const prev = firstWashTs.get(l.key);
    if (prev === undefined || l.ts < prev) firstWashTs.set(l.key, l.ts);
  }

  // Washed billable windows in wash order. The activity log is capped (newest
  // events kept), so a washed window with NO log entry was marked pesty before
  // the oldest retained event — i.e. it is older than any timestamped window.
  // Order: untimestamped (oldest) first, then timestamped ascending, key as a
  // stable tiebreak — so the earliest washes correctly land in the first erät.
  const ordered = billable
    .filter((p) => p.status === "pesty")
    .sort((a, b) => {
      const ta = firstWashTs.get(a.key);
      const tb = firstWashTs.get(b.key);
      if (ta !== undefined && tb !== undefined) return ta - tb || (a.key < b.key ? -1 : 1);
      if (ta !== undefined) return 1;   // a timestamped, b not → b (older) first
      if (tb !== undefined) return -1;  // b timestamped, a not → a (older) first
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

  const memberOf = (id: string) => crew.find((m) => m.id === id);
  const rateOf = (id: string) => memberOf(id)?.perWindowCents ?? DEFAULT_WORKER_PER_WINDOW_CENTS;
  const nameOf = (id: string) => memberOf(id)?.name ?? id;
  // A founder (role "host") washing a window costs the gig NO palkka — that
  // window is pure margin for the founders. Previously they were credited at
  // their crew row's 20 €/ikkuna (the seeder gives hosts the worker default),
  // which silently ate ~20 € of every erä's kate and skewed the founder
  // settlement. Their windows are now reported separately.
  const isFounderId = (id: string) => memberOf(id)?.role === "host";
  // Each erä is billed at a fixed 25 % of the agreed total (6300 € ÷ 4 = 1575 €).
  // The LAST erä absorbs any deal reduction: if red windows were removed, the
  // final instalment = effective agreed total − the earlier fixed instalments,
  // so the whole reduction lands on the last invoice (earlier erät stay at 25 %).
  const rawInstalmentCents = Math.round(deal.capCents / PAY_PERIODS);
  const agreedCents = dealAgreedTotalCents(data, deal);

  const out: EraDebtBreakdown[] = [];
  let cursor = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const slice = ordered.slice(cursor, cursor + size);
    cursor += slice.length;
    // Credit each window to its washer(s) — a shared window splits 0.5 / 0.5.
    const credit = new Map<string, number>();
    for (const p of slice) {
      const second = washedBy2[p.key];
      if (p.washedBy) credit.set(p.washedBy, (credit.get(p.washedBy) || 0) + (second ? 0.5 : 1));
      if (second) credit.set(second, (credit.get(second) || 0) + 0.5);
    }
    let founderWindows = 0;
    const workers: EraWorkerShare[] = [];
    for (const [workerId, windows] of Array.from(credit.entries())) {
      if (isFounderId(workerId)) { founderWindows += windows; continue; }
      workers.push({
        workerId,
        name: nameOf(workerId),
        windows,
        earnedCents: Math.round(windows * rateOf(workerId)),
      });
    }
    workers.sort((a, b) => b.windows - a.windows);
    const earnedCents = workers.reduce((s, w) => s + w.earnedCents, 0);
    const isLast = i === sizes.length - 1;
    const instalmentCents = isLast
      ? Math.max(0, agreedCents - rawInstalmentCents * (sizes.length - 1))
      : rawInstalmentCents;
    out.push({
      era: i + 1,
      size,
      washed: slice.length,
      complete: size > 0 && slice.length >= size,
      earnedCents,
      founderWindows,
      instalmentCents,
      marginCents: instalmentCents - earnedCents,
      biller: null,
      workers,
    });
  }
  return out;
}

// ─── Efficiency / pace analytics ───────────────────────────────────────────────

export interface GigEfficiency {
  total: number;
  washed: number;
  kesken: number;
  remaining: number;          // total − washed
  pct: number;                // 0..100 by window count
  revenueCents: number;       // washed × price
  contractCents: number;      // total × price
  remainingCents: number;     // remaining × price (still to earn)
  todayWashed: number;        // windows marked pesty today (from log)
  weekWashed: number;         // …in the last 7 days
  activeDays: number;         // distinct calendar days with a pesty event
  loggedWashed: number;       // pesty events retained in the (capped) log — pace basis
  perDay: number;             // average washed per active day
  etaWorkingDays: number | null; // working days left at current pace (null if no pace)
  bestDay: { ts: number; count: number } | null;
  totalHours: number;
  eurPerHour: number;         // revenue / total hours
  windowsPerHour: number;     // washed / total hours
  /** Arvio tunneista per ikkuna (`ProjectData.estimatedHoursPerWindow`), jos asetettu. */
  estHoursPerWindow: number | null;
  /** Koko keikan työmäärä arviolla: kaikki ikkunat × arvio. Null ilman arviota. */
  estTotalHours: number | null;
  /** Jäljellä oleva työmäärä arviolla: pesemättömät × arvio. Null ilman arviota. */
  estRemainingHours: number | null;
  /**
   * Toteutunut tunnit/ikkuna kirjatuista tunneista (`totalHours / washed`).
   * Tämä on se luku jota arvioon verrataan; null jos tunteja tai pesuja ei ole.
   */
  actualHoursPerWindow: number | null;
}

/** Local YYYY-MM-DD key for grouping log events by calendar day. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Derive pace / projection stats for a project so the gig-tools "Tehokkuus"
 * view can show throughput and an ETA. Pace is based on the retained activity
 * log (capped), so it is an estimate — the long-running totals (washed, revenue)
 * come from the authoritative window set.
 */
export function computeEfficiency(data: ProjectData): GigEfficiency {
  const totals = computeProjectTotals(data);
  const price = pricePerWindowOf(data);

  // Group pesty events by calendar day from the activity log.
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86400_000;
  const byDay = new Map<string, { ts: number; count: number }>();
  let todayWashed = 0, weekWashed = 0, loggedWashed = 0;
  const seenKeysPerDay = new Map<string, Set<string>>();

  for (const l of data.log) {
    if (l.status !== "pesty") continue;
    const k = dayKey(l.ts);
    // Count each window once per day to avoid double-counting status flips.
    let seen = seenKeysPerDay.get(k);
    if (!seen) { seen = new Set(); seenKeysPerDay.set(k, seen); }
    if (seen.has(l.key)) continue;
    seen.add(l.key);
    loggedWashed += 1;
    const entry = byDay.get(k) || { ts: l.ts, count: 0 };
    entry.count += 1;
    entry.ts = Math.min(entry.ts, l.ts);
    byDay.set(k, entry);
    if (l.ts >= startToday.getTime()) todayWashed += 1;
    if (l.ts >= weekAgo) weekWashed += 1;
  }

  const activeDays = byDay.size;
  const perDay = activeDays > 0 ? loggedWashed / activeDays : 0;
  const remaining = totals.total - totals.washed;
  const etaWorkingDays = perDay > 0 && remaining > 0 ? Math.ceil(remaining / perDay) : (remaining === 0 ? 0 : null);

  let bestDay: { ts: number; count: number } | null = null;
  Array.from(byDay.values()).forEach((v) => { if (!bestDay || v.count > bestDay.count) bestDay = v; });

  const totalHours = Object.values(data.hours || {}).reduce((a, h) => a + Math.max(0, h || 0), 0);

  // Tuntiarvio (esim. 1,5 h per iso monilohkoinen ikkuna). Puuttuva arvio →
  // kaikki tuntiluvut ovat null, eikä mikään näkymä keksi lukua tyhjästä.
  const est = data.estimatedHoursPerWindow;
  const estHoursPerWindow = Number.isFinite(est) && (est as number) > 0 ? (est as number) : null;
  const estTotalHours = estHoursPerWindow !== null ? round2(estHoursPerWindow * totals.total) : null;
  const estRemainingHours = estHoursPerWindow !== null ? round2(estHoursPerWindow * remaining) : null;
  const actualHoursPerWindow = totalHours > 0 && totals.washed > 0 ? round2(totalHours / totals.washed) : null;

  return {
    total: totals.total,
    washed: totals.washed,
    kesken: totals.kesken,
    remaining,
    pct: totals.pct,
    revenueCents: totals.revenueCents,
    contractCents: totals.contractCents,
    remainingCents: Math.round(remaining * price * 100),
    todayWashed,
    weekWashed,
    activeDays,
    loggedWashed,
    perDay,
    etaWorkingDays,
    bestDay,
    totalHours,
    eurPerHour: totalHours > 0 ? totals.revenueCents / 100 / totalHours : 0,
    windowsPerHour: totalHours > 0 ? totals.washed / totalHours : 0,
    estHoursPerWindow,
    estTotalHours,
    estRemainingHours,
    actualHoursPerWindow,
  };
}

/** Kaksi desimaalia — tuntiluvut eivät saa näyttää liukulukuroskaa. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Gig billing sync (FR8 toolkit = source of truth) ──────────────────────────

const GIG_FLOOR_PALETTE = ["#D9472B", "#DFA614", "#1F3B57", "#3E7C59", "#7A4FA3", "#C2557A"];

function gigFloorName(f: string): string {
  if (f === "K") return "Kellari";
  return `${f}. kerros`;
}

/**
 * Derive a gig's billing sectors from the floor-plan window project so the FR8
 * toolkit is the single source of truth for progress and money. One sector per
 * floor: `total` = live windows on the floor, `washed` = windows marked "pesty",
 * unit price = the project's price per window. Per-floor `invoicedWashed` is
 * preserved (matched by sector id) so the existing invoicing pipeline keeps
 * working unchanged, and gig metadata (company, invoices, notes, log) is left
 * untouched.
 */
export function syncGigSectorsFromProject(gig: GigData, project: ProjectData): GigData {
  // A signed fixed-price deal (FR8) overrides the per-floor model with a single
  // "deal" sector so the customer view, the signed contract doc and invoicing all
  // show exactly the agreed terms: 168 red windows × 37,50 € = 6300 € cap.
  const deal = fixedDealFor(project);
  if (deal) {
    const red = allPoints(project).filter((p) => p.p === deal.billablePriority);
    const redTotal = red.length;
    const redWashed = red.filter((p) => p.status === "pesty").length;
    // Agreed scope = the signed count (168), but reduced if fewer red windows
    // actually exist (removed windows come off the price at 37,50 € each); adding
    // windows never pushes it above the cap. total × unit == the effective agreed
    // total, and "washed" is scaled to that scope so accrued tracks completion.
    const total = dealBillableScope(project, deal);            // ≤ 168 (= €6300 cap)
    const frac = redTotal > 0 ? redWashed / redTotal : 0;
    const washed = Math.min(total, Math.round(frac * total));
    const id = "deal:red";
    const prevInvoiced = Math.max(0, gig.sectors.find((s) => s.id === id)?.invoicedWashed ?? 0);
    const sector: GigSector = {
      id,
      name: "Punaiset ikkunat (sektori 1)",
      color: "#D9472B",
      unitLabel: "ikkuna",
      total,
      unitPriceCents: Math.round(deal.pricePerWindow * 100),
      washed,
      skipped: 0,
      invoicedWashed: Math.min(washed, prevInvoiced),
      priority: 1,
    };
    return { ...gig, sectors: [sector], updatedAt: Date.now() };
  }

  const floors = project.building.floors.length ? project.building.floors : DEFAULT_FLOORS;
  const unitPriceCents = Math.round(pricePerWindowOf(project) * 100);
  const pts = allPoints(project);
  const prevById = new Map(gig.sectors.map((s) => [s.id, s]));

  const sectors: GigSector[] = floors.map((f, i) => {
    const onFloor = pts.filter((p) => p.floor === f);
    const total = onFloor.length;
    const washed = onFloor.filter((p) => p.status === "pesty").length;
    const id = `floor:${f}`;
    const prevInvoiced = Math.max(0, prevById.get(id)?.invoicedWashed ?? 0);
    return {
      id,
      name: gigFloorName(f),
      color: GIG_FLOOR_PALETTE[i % GIG_FLOOR_PALETTE.length],
      unitLabel: "ikkuna",
      total,
      unitPriceCents,
      washed,
      skipped: 0,
      invoicedWashed: Math.min(washed, prevInvoiced),
      priority: i + 1,
    };
  });

  return { ...gig, sectors, updatedAt: Date.now() };
}

// ─── Sanitisation (server-side validation) ─────────────────────────────────────

function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
function toPriority(v: any): 1 | 2 {
  return Number(v) === 2 ? 2 : 1;
}
function toStatus(v: any): WindowStatus {
  return v === "pesty" || v === "kesken" ? v : "ei";
}
function cleanKey(v: any): string {
  return String(v ?? "").slice(0, 64);
}

/** Sanitize an incoming projectData object so a bad client can't corrupt the DB. */
export function sanitizeProjectData(input: any): ProjectData {
  const base = emptyProjectData();
  if (!input || typeof input !== "object") return base;

  const floors: string[] = Array.isArray(input?.building?.floors) && input.building.floors.length
    ? input.building.floors.slice(0, 40).map((f: any) => String(f).slice(0, 8))
    : [...DEFAULT_FLOORS];

  const compensation = toCompensation(input.compensation);

  // Tuntiarvio: positiivinen, järkevästi rajattu (yksi ikkuna ei realistisesti
  // vie yli 24 h), kaksi desimaalia. Nolla/roska → ei arviota lainkaan.
  const estRaw = Number(input.estimatedHoursPerWindow);
  const estimatedHoursPerWindow = Number.isFinite(estRaw) && estRaw > 0
    ? Math.min(24, Math.round(estRaw * 100) / 100)
    : undefined;

  // Ladatut pohjakuvat: kerros → asset-id. Vain positiiviset kokonaisluvut, ja
  // vain kerroksille jotka ovat oikeasti olemassa — muuten poistettu kerros
  // jättäisi roikkuvan viitteen.
  const planImages: Record<string, number> = {};
  if (input?.building?.planImages && typeof input.building.planImages === "object") {
    for (const f of Object.keys(input.building.planImages).slice(0, 40)) {
      const id = Number(input.building.planImages[f]);
      const key = String(f).slice(0, 8);
      if (Number.isSafeInteger(id) && id > 0 && floors.includes(key)) planImages[key] = id;
    }
  }

  const marks: ProjMarksData = {};
  if (input.marks && typeof input.marks === "object") {
    for (const f of Object.keys(input.marks).slice(0, 40)) {
      const arr = Array.isArray(input.marks[f]?.marks) ? input.marks[f].marks : [];
      marks[String(f).slice(0, 8)] = {
        marks: arr.slice(0, 2000).map((m: any) => ({
          p: toPriority(m?.p),
          x: clampPct(Number(m?.x)),
          y: clampPct(Number(m?.y)),
        })),
      };
    }
  }

  const customMarks: Record<string, ProjCustomMark[]> = {};
  if (input.customMarks && typeof input.customMarks === "object") {
    for (const f of Object.keys(input.customMarks).slice(0, 40)) {
      const arr = Array.isArray(input.customMarks[f]) ? input.customMarks[f] : [];
      customMarks[String(f).slice(0, 8)] = arr.slice(0, 2000).map((c: any) => ({
        key: cleanKey(c?.key),
        p: toPriority(c?.p),
        x: clampPct(Number(c?.x)),
        y: clampPct(Number(c?.y)),
      })).filter((c: ProjCustomMark) => c.key);
    }
  }

  const notes: Record<string, ProjMapNote[]> = {};
  if (input.notes && typeof input.notes === "object") {
    for (const f of Object.keys(input.notes).slice(0, 40)) {
      const arr = Array.isArray(input.notes[f]) ? input.notes[f] : [];
      notes[String(f).slice(0, 8)] = arr.slice(0, 500).map((n: any) => ({
        key: cleanKey(n?.key),
        x: clampPct(Number(n?.x)),
        y: clampPct(Number(n?.y)),
        kind: toNoteKind(n?.kind),
        text: n?.text ? String(n.text).slice(0, 400) : undefined,
        ts: Number(n?.ts) || Date.now(),
        by: n?.by ? String(n.by).slice(0, 40) : undefined,
      })).filter((n: ProjMapNote) => n.key);
    }
  }

  let activeZone: ProjActiveZone | null = null;
  if (input.activeZone && typeof input.activeZone === "object" && input.activeZone.floor != null) {
    activeZone = {
      floor: String(input.activeZone.floor).slice(0, 8),
      x: clampPct(Number(input.activeZone.x)),
      y: clampPct(Number(input.activeZone.y)),
      label: input.activeZone.label ? String(input.activeZone.label).slice(0, 80) : undefined,
      ts: Number(input.activeZone.ts) || Date.now(),
    };
  }

  const statuses: Record<string, WindowStatus> = {};
  if (input.statuses && typeof input.statuses === "object") {
    for (const k of Object.keys(input.statuses).slice(0, 20000)) {
      const s = toStatus(input.statuses[k]);
      if (s !== "ei") statuses[cleanKey(k)] = s;
    }
  }

  const washedBy: Record<string, string> = {};
  if (input.washedBy && typeof input.washedBy === "object") {
    for (const k of Object.keys(input.washedBy).slice(0, 20000)) {
      const v = input.washedBy[k];
      if (v) washedBy[cleanKey(k)] = String(v).slice(0, 40);
    }
  }

  // Second washer for a 50/50 split. Only kept when a primary washer exists and
  // the two are different people, so a split always references two real workers.
  const washedBy2: Record<string, string> = {};
  if (input.washedBy2 && typeof input.washedBy2 === "object") {
    for (const k of Object.keys(input.washedBy2).slice(0, 20000)) {
      const key = cleanKey(k);
      const v = input.washedBy2[k] ? String(input.washedBy2[k]).slice(0, 40) : "";
      if (v && washedBy[key] && washedBy[key] !== v) washedBy2[key] = v;
    }
  }

  /**
   * KESKEN JÄTTÄNYT TEKIJÄ.
   *
   * Tämä puuttui sanitoinnista kokonaan, joten tieto katosi joka kerta.
   * Palvelin kirjoitti `project.keskenBy[key] = member.id` aina kun tekijä
   * merkitsi ikkunan keskeneräiseksi, mutta `saveProject` ajaa tallennuksen
   * tämän funktion läpi — ja mitä täällä ei nimetä, sitä ei kirjoiteta.
   * Kartan ikkunavalikossa on valmis rivi "Kesken: <nimi>", joka ei siis
   * voinut koskaan näyttää mitään.
   *
   * Merkinnällä on käyttöä juuri kahden tekijän keikalla: kun ikkuna jää
   * kesken, seuraava näkee kuka sen jätti eikä arvaile. Sama muoto ja sama
   * 20 000 avaimen katto kuin washedBy:llä.
   */
  const keskenBy: Record<string, string> = {};
  if (input.keskenBy && typeof input.keskenBy === "object") {
    for (const k of Object.keys(input.keskenBy).slice(0, 20000)) {
      const key = cleanKey(k);
      const v = input.keskenBy[k] ? String(input.keskenBy[k]).slice(0, 40) : "";
      // Vain oikeasti kesken oleville ikkunoille: pesty tai tyhjä ikkuna ei
      // kanna kesken-merkintää, ja muuten poistetut jäisivät roikkumaan.
      if (v && statuses[key] === "kesken") keskenBy[key] = v;
    }
  }

  const posOverrides: Record<string, { x: number; y: number }> = {};
  if (input.posOverrides && typeof input.posOverrides === "object") {
    for (const k of Object.keys(input.posOverrides).slice(0, 20000)) {
      const o = input.posOverrides[k];
      if (o && typeof o === "object") {
        posOverrides[cleanKey(k)] = { x: clampPct(Number(o.x)), y: clampPct(Number(o.y)) };
      }
    }
  }

  const deleted: Record<string, boolean> = {};
  if (input.deleted && typeof input.deleted === "object") {
    for (const k of Object.keys(input.deleted).slice(0, 20000)) {
      if (input.deleted[k]) deleted[cleanKey(k)] = true;
    }
  }

  const observations: Record<string, ProjWindowObservation> = {};
  if (input.observations && typeof input.observations === "object") {
    for (const k of Object.keys(input.observations).slice(0, 5000)) {
      const o = input.observations[k];
      if (!o || typeof o !== "object") continue;
      const text = String(o.text ?? "").slice(0, 1000).trim();
      const img = typeof o.imageDataUrl === "string" && o.imageDataUrl.startsWith("data:image/")
        ? o.imageDataUrl.slice(0, MAX_OBSERVATION_IMAGE_LEN) : undefined;
      const assetId = Number.isSafeInteger(Number(o.imageAssetId)) && Number(o.imageAssetId) > 0
        ? Number(o.imageAssetId) : undefined;
      // Kuvaton mutta viitteellinen havainto on validi: liite asuu
      // `job_assets`-taulussa eikä blobissa.
      if (!text && !img && !assetId) continue;
      observations[cleanKey(k)] = {
        text, imageDataUrl: img,
        ...(assetId ? { imageAssetId: assetId } : {}),
        by: o.by ? String(o.by).slice(0, 40) : undefined,
        ts: Number(o.ts) || Date.now(),
      };
    }
  }

  const log: ProjLogEntry[] = Array.isArray(input.log)
    ? input.log.slice(0, 200).map((l: any) => ({
        floor: String(l?.floor ?? "").slice(0, 8),
        key: cleanKey(l?.key),
        p: toPriority(l?.p),
        status: toStatus(l?.status),
        ts: Number(l?.ts) || Date.now(),
        by: l?.by ? String(l.by).slice(0, 40) : undefined,
      }))
    : [];

  const hours: Record<string, number> = {};
  if (input.hours && typeof input.hours === "object") {
    for (const w of Object.keys(input.hours).slice(0, 40)) {
      hours[String(w).slice(0, 40)] = Math.round(clampNonNeg(Number(input.hours[w])) * 100) / 100;
    }
  }

  const hourLog: ProjHourEntry[] = Array.isArray(input.hourLog)
    ? input.hourLog.slice(0, 200).map((h: any) => ({
        worker: String(h?.worker ?? "").slice(0, 40),
        delta: Math.round((Number(h?.delta) || 0) * 100) / 100,
        ts: Number(h?.ts) || Date.now(),
        by: h?.by ? String(h.by).slice(0, 40) : undefined,
      })).filter((h: ProjHourEntry) => h.worker)
    : [];

  const workers: string[] = Array.isArray(input.workers) && input.workers.length
    ? Array.from(new Set(input.workers.slice(0, 40).map((w: any) => String(w).slice(0, 40)))) as string[]
    : [...base.workers];

  const VALID_EXPENSE_KINDS: ProjExpenseKind[] = ["transport", "materials", "equipment", "other"];
  const expenses: ProjExpense[] = Array.isArray(input.expenses)
    ? input.expenses.slice(0, 500).map((e: any) => ({
        id: String(e?.id ?? "").slice(0, 80),
        by: String(e?.by ?? "").slice(0, 40),
        kind: VALID_EXPENSE_KINDS.includes(e?.kind) ? e.kind : "other",
        desc: String(e?.desc ?? "").slice(0, 300).trim(),
        amountCents: Math.round(Math.max(0, Number(e?.amountCents) || 0)),
        ts: Number(e?.ts) || Date.now(),
        ...(typeof e?.forWhom === "string" && e.forWhom.trim() ? { forWhom: e.forWhom.trim().slice(0, 40) } : {}),
        receiptDataUrl: typeof e?.receiptDataUrl === "string" && e.receiptDataUrl.startsWith("data:image/")
          ? e.receiptDataUrl.slice(0, MAX_EXPENSE_RECEIPT_LEN) : undefined,
      })).filter((e: ProjExpense) => e.id && e.by)
    : [];

  // Founders' editable per-erä window counts (clamped positive ints, ≤ 24 erää).
  const eraWindows: number[] | undefined = Array.isArray(input.eraWindows) && input.eraWindows.length
    ? input.eraWindows.slice(0, 24).map((n: any) => Math.max(0, Math.min(100000, Math.floor(Number(n) || 0))))
    : undefined;

  return {
    version: 1,
    building: {
      name: input?.building?.name ? String(input.building.name).slice(0, 120) : base.building.name,
      address: input?.building?.address ? String(input.building.address).slice(0, 200) : base.building.address,
      floors,
      // Empty unless the client provides one — keeps new gigs free of the FR8 plans.
      planBase: input?.building?.planBase ? String(input.building.planBase).slice(0, 200) : base.building.planBase,
      ...(Object.keys(planImages).length ? { planImages } : {}),
      ...(toPlanRender(input?.building?.planRender) ? { planRender: toPlanRender(input.building.planRender)! } : {}),
      ...(input?.building?.unitWord ? { unitWord: String(input.building.unitWord).slice(0, 24) } : {}),
    },
    // Yhteisökeikalla nolla on OIKEA hinta, joten varakäytäntöä ei sovelleta.
    // Muualla käytös on ennallaan (kelvoton/puuttuva → oletushinta).
    pricePerWindow: compensation === "community"
      ? clampNonNeg(Number(input.pricePerWindow))
      : clampNonNeg(Number(input.pricePerWindow)) || DEFAULT_PRICE_PER_WINDOW,
    // Only ever stored when the gig actually declared one; an absent value must
    // stay absent so old blobs (FR8) round-trip byte-identically.
    ...(toDealKind(input.dealKind) ? { dealKind: toDealKind(input.dealKind)! } : {}),
    ...(compensation ? { compensation } : {}),
    ...(estimatedHoursPerWindow !== undefined ? { estimatedHoursPerWindow } : {}),
    marks,
    statuses,
    washedBy,
    washedBy2,
    keskenBy,
    customMarks,
    notes,
    observations,
    activeZone,
    posOverrides,
    deleted,
    log,
    hours,
    hourLog,
    workers,
    crew: sanitizeCrew(input.crew),
    expenses,
    ...(eraWindows ? { eraWindows } : {}),
    ...(input.p2 !== undefined ? (() => { const p2 = sanitizeP2State(input.p2); return p2 ? { p2 } : {}; })() : {}),
    ...(input.guided !== undefined ? (() => { const g = sanitizeGuidedWork(input.guided); return g ? { guided: g } : {}; })() : {}),
    ...(input.settlement !== undefined ? (() => { const s = sanitizeFounderSettlementState(input.settlement); return s ? { settlement: s } : {}; })() : {}),
    updatedAt: Date.now(),
  };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function eurFromCents(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
