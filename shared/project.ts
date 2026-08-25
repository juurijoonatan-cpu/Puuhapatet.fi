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
 * Lamput (lamppupisteet) — sama logiikka kuin ikkunoilla mutta oma, kevyempi
 * järjestelmä: EI hintaa, EI seedattuja pisteitä. Jokainen lamppu on käsin
 * lisätty (`"<krs>#lamp<rand>"`). Poisto on aina lopullinen (ei
 * `deleted`-hautakiveä kuten ikkunoilla), koska lampuilla ei ole laskutusta
 * joka tarvitsisi historiaa.
 *
 * Lampulla on KOLME toisistaan riippumatonta tietoa:
 *   1. `LampStatus`    — onko se vaihdettu (+ `lampChangedBy`: kuka, milloin)
 *   2. `LampCondition` — toimiiko se (puuttuva = ei vielä tarkastettu)
 *   3. huomautus       — vapaa teksti (`lampNotes`), esim. "kupu rikki"
 *
 * Ne ovat erillisiä koska ne vastaavat eri kysymykseen: rikkinäinen lamppu voi
 * olla vaihtamatta, ja vaihdettu lamppu voi silti kaivata huomautuksen.
 */
export type LampStatus = "ei" | "vaihdettu";

/**
 * Toimiiko lamppu. PUUTTUVA merkintä ei tarkoita "toimii" vaan "ei tarkastettu"
 * — siksi tälle ei ole kolmatta arvoa: tarkastamaton lamppu jätetään pois
 * `lampConditions`ista täsmälleen kuten pesemätön ikkuna jätetään pois
 * `statuses`ista.
 */
export type LampCondition = "toimiva" | "rikki";

export function toLampCondition(v: any): LampCondition | undefined {
  return v === "toimiva" || v === "rikki" ? v : undefined;
}

export interface ProjLampMark { key: string; x: number; y: number; }

/** Kuka ja milloin teki merkinnän (lampun vaihto, oven kuittaus, pisteen lisäys). */
export interface ProjMarkBy { by: string; ts: number; }

/** Kuka ja milloin merkitsi lampun vaihdetuksi. */
export type ProjLampChange = ProjMarkBy;

/**
 * Huomautus yhdestä lampusta tai ovesta: teksti, kirjoittaja ja aikaleima.
 *
 * MIKSI OMA TYYPPI EIKÄ `ProjWindowObservation`: havainnolla on kuva, ja kuva
 * on se mikä kerran söi siirtokiintiön (ks. `stripObservationImages`).
 * Kalustehuomautus on tarkoituksella pelkkää tekstiä, joten se saa kulkea
 * jokaisessa vastauksessa ilman erillistä laiskaa latausta.
 */
export interface ProjFixtureNote { text: string; by?: string; ts: number; }

/** Kalustehuomautuksen enimmäispituus. */
export const MAX_FIXTURE_NOTE_LEN = 400;

/**
 * LASKUTUSTILA — kaksi tapaa tehdä keikkaa, ja ne eivät saa sekoittua.
 *
 *   "targeted" — KOHDENNETTU HINNOITTELU. Kaikki mitä tähän asti on ollut:
 *                ikkunapisteet, hinta per ikkuna, urakka, erät, keltaisten
 *                neuvottelu. FR8 on tämä.
 *   "hourly"   — TUNTIHINNOITTELU. Vain tehdyt tunnit. Ei ikkunahintaa, ei
 *                urakkaa, ei per-kohde-hinnoittelua.
 *
 * PUUTTUVA ARVO ON "targeted", eikä sitä kirjoiteta talteen. Se on ainoa tapa
 * jolla FR8:n ja jokaisen olemassa olevan keikan käytös pysyy tavu tavulta
 * entisellään: mitään ei ole valittu, joten mikään ei muutu. Tila kirjoitetaan
 * vasta kun joku valitsee sen.
 */
export type BillingMode = "targeted" | "hourly";

export function toBillingMode(v: any): BillingMode | undefined {
  return v === "targeted" || v === "hourly" ? v : undefined;
}

/** Keikan laskutustila. Puuttuva = "targeted" (ks. yllä). */
export function billingModeOf(data: ProjectData | null | undefined): BillingMode {
  return toBillingMode(data?.billingMode) ?? "targeted";
}

/** Onko keikka tuntitilassa? Lyhenne luettavuuden vuoksi. */
export function isHourlyGig(data: ProjectData | null | undefined): boolean {
  return billingModeOf(data) === "hourly";
}

/**
 * TUNTITILAN PYÖRISTYS — lähimpään täyteen tuntiin, puolikas ylös.
 *
 * 30 min → 1 h, 20 min → 0 h. Jälkimmäinen on tarkoitus eikä sivuvaikutus:
 * lyhyt piipahdus ei kerrytä tuntia, joten työaikaa ei kannata aloittaa ja
 * lopettaa saman tien. Johtaja voi aina korjata luvun käsin, joten pyöristys
 * ei ole viimeinen sana vaan lähtökohta.
 *
 * Koskee VAIN tuntitilaa. Kohdennetussa tilassa tunnit ovat tarkkoja kuten
 * ennenkin — siellä ne ovat seurantatietoa, eivät laskutuksen perusta.
 */
export function roundWorkHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours);
}

/** Sama pyöristys minuuteista, jottei kutsupaikoissa jaeta kuudellakymmenellä. */
export function roundWorkHoursFromMinutes(minutes: number): number {
  return roundWorkHours((Number(minutes) || 0) / 60);
}

/**
 * Ovipisteet — kartalle merkittyjä ovia, joista jokainen on TEHTÄVÄ: se on joko
 * tekemättä tai tehty, sillä voi olla lyhyt tehtävänimi (`label`, esim.
 * "karmit + lasi") ja huomautus.
 *
 * Sama kevyt malli kuin lampuilla: ei rahaa, ei seedattuja pisteitä, ei
 * hautakiveä. Ikkunalaskenta, hinnoittelu ja edistymä eivät näe näitä
 * lainkaan — ovi ei ole ikkuna.
 */
export type DoorStatus = "ei" | "tehty";

export interface ProjDoorMark { key: string; x: number; y: number; label?: string; }

/** Oven tehtävänimen enimmäispituus. */
export const MAX_DOOR_LABEL_LEN = 60;

/**
 * TILAUS — mitä pitää ostaa, ja mitä asiakas siitä maksaisi.
 *
 * Tämä on jaettu KAHTEEN objektiin, ja jako on tarkoituksellinen: ne ovat eri
 * ihmisten kirjoittamia, ja niillä on siksi eri omistaja tallennuspolussa.
 *
 *   `fixtureOrder` — JOHTAJAN. Malli ja määrä. Kulkee tavallisen blob-
 *                    tallennuksen mukana kuten muukin karttadata.
 *   `fixtureQuote` — ASIAKKAAN. Hintaehdotus. SERVERIN OMISTAMA kuten `scope`
 *                    ja `p2`: sitä mutatoidaan vain omalta reitiltään, ja
 *                    jokainen blob-tallennus palauttaa kannan tuoreimman
 *                    arvon. Ilman tätä johtajan yksi pistesiirto pyyhkisi
 *                    asiakkaan juuri antaman hinnan — sama vika joka `scope`illa
 *                    kerran oli.
 */
export interface FixtureOrder {
  /** Lampun malli, esim. "E27 LED 9W 2700K". */
  lampModel?: string;
  /** Käsin asetettu ostettava määrä. Puuttuva = laskettu rikkinäisten määrä. */
  bulbsNeeded?: number;
  /** Mitä oviin menee, esim. "EPDM D-tiiviste, valkoinen". Saatetieto: kertoo
   *  mitä kohteeseen asennetaan, ei vaikuta hintaan. */
  doorMaterial?: string;
  /** Käsin asetettu ovimäärä. Puuttuva = laskettu tekemättömien ovien määrä. */
  doorsNeeded?: number;
  /** Johtajan huomio tilauksesta — näkyy asiakkaalle. */
  note?: string;
}

/**
 * Asiakkaan hintaehdotus. Ei sitova tarjous, vaan asiakkaan oma ehdotus.
 *
 * HINTA ON TYÖSTÄ, EI TARVIKKEESTA. Asiakas ei osta meiltä polttimoa vaan sen
 * vaihtamisen, eikä tiivistettä vaan sen vaihtamisen — molemmat per kohde.
 * Tarvikkeen malli (`lampModel`, `doorMaterial`) on saatetieto siitä mitä
 * kohteeseen menee, eikä se vaikuta hintaan lainkaan.
 */
export interface FixtureQuote {
  /** Asiakkaan ehdotus yhden lampun VAIHTAMISESTA (senttiä). */
  lampWorkPriceCents?: number;
  /** Asiakkaan ehdotus yhden oven TIIVISTEEN VAIHTAMISESTA (senttiä). */
  doorWorkPriceCents?: number;
  /** Vapaa viesti hinnoista. */
  note?: string;
  /** Milloin asiakas viimeksi tallensi ehdotuksen. */
  at: number;
}

/**
 * LAMPPUMALLIT — kaikki lamput eivät ole samaa mallia.
 *
 * Yksi `fixtureOrder.lampModel` riitti kun keikalla oli yhtä lamppua; oikeassa
 * kiinteistössä on E27:ää, G9:ää ja loisteputkea samassa portaikossa, ja
 * ostoslista on väärä jos se sanoo pelkän kokonaismäärän. Malli on siis LISTA
 * jota johtaja ylläpitää (lisää/poistaa), ja jokainen lamppu voi osoittaa
 * yhteen niistä (`lampModelOf`).
 *
 * MALLITON LAMPPU ON SALLITTU TILA eikä virhe: kartoitus on nopeaa ja malli
 * katsotaan usein vasta jälkikäteen. Malliton putoaa omaan "Ei mallia"
 * -riviinsä, jotta se näkyy eikä katoa summaan.
 */
export interface LampModel {
  /** Vakaa tunnus, `"m<rand>"`. Nimi voi muuttua, tunnus ei. */
  id: string;
  name: string;
}

/** Kuinka monta mallia yhdellä keikalla — käytännön yläraja, ei tekninen. */
export const MAX_LAMP_MODELS = 24;

export const MAX_FIXTURE_MODEL_LEN = 80;
export const MAX_FIXTURE_ORDER_NOTE_LEN = 300;
export const MAX_FIXTURE_QUOTE_NOTE_LEN = 500;
/** Yläraja yhden vaihtotyön hinnalle (2 000 €), jottei kirjoitusvirhe tee
 *  miljoonatarjousta. */
export const MAX_FIXTURE_UNIT_PRICE_CENTS = 200_000;

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
  /**
   * Näytetäänkö tämä kulu ASIAKKAALLE hänen seurantasivullaan.
   *
   * OLETUS ON EI, ja se on tarkoituksellinen. Valtaosa kuluista on meidän
   * sisäisiä — tekijän bussilippu, oma kalusto, polttoaine — eivätkä ne kuulu
   * asiakkaalle. Asiakkaalle näytetään vain se mitä on ostettu HÄNTÄ VARTEN:
   * polttimot, tiivisteet, tarvikkeet. Siksi tämä on merkintä jonka johtaja
   * tekee kululle erikseen, ei suodatin jonka voi unohtaa väärin päin.
   *
   * Kuitti EI seuraa mukana asiakkaalle missään tapauksessa: se on
   * kirjanpitomme tosite, ei asiakkaan asiakirja.
   */
  forCustomer?: boolean;
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
  /** Lamput: floor → käsin lisätyt lamppupisteet (tähtinä kartalla). Ei
   *  seedattuja — kaikki lisätään manuaalisesti, samaan tapaan kuin `customMarks`. */
  lamps?: Record<string, ProjLampMark[]>;
  /** Lampun avain → tila ("ei" jätetään pois, kuten `statuses`). */
  lampStatuses?: Record<string, LampStatus>;
  /** Lampun avain → kuka ja milloin merkitsi sen vaihdetuksi. */
  lampChangedBy?: Record<string, ProjLampChange>;
  /** Lampun avain → toimiiko se. Puuttuva = ei tarkastettu (ks. `LampCondition`). */
  lampConditions?: Record<string, LampCondition>;
  /** Lampun avain → vapaa huomautus (kuka kirjoitti, milloin). */
  lampNotes?: Record<string, ProjFixtureNote>;
  /** Lampun avain → kuka lisäsi pisteen kartalle ja milloin. Pelkkä jälki:
   *  lisääminen ei ole työsuoritus eikä se näy asiakkaalle (ks. `lampIsPublic`). */
  lampAddedBy?: Record<string, ProjMarkBy>;
  /** Ovet: floor → käsin lisätyt ovipisteet. Sama kevyt malli kuin lampuilla. */
  doors?: Record<string, ProjDoorMark[]>;
  /** Oven avain → tehtävätila ("ei" jätetään pois, kuten `statuses`). */
  doorStatuses?: Record<string, DoorStatus>;
  /** Oven avain → kuka merkitsi tehdyksi ja milloin. */
  doorDoneBy?: Record<string, ProjMarkBy>;
  /** Oven avain → vapaa huomautus. */
  doorNotes?: Record<string, ProjFixtureNote>;
  /** Oven avain → kuka lisäsi pisteen kartalle ja milloin. */
  doorAddedBy?: Record<string, ProjMarkBy>;
  /** Keikan laskutustila (`BillingMode`). Puuttuva = "targeted" — ks. tyypin
   *  dokumentaatio siitä miksi sitä ei kirjoiteta oletuksena. */
  billingMode?: BillingMode;
  /** Johtajan ostotieto: malli ja määrä (`FixtureOrder`). */
  fixtureOrder?: FixtureOrder;
  /** Keikan lamppumallit (`LampModel`). Johtaja ylläpitää listaa. */
  lampModels?: LampModel[];
  /** Lampun avain → mallin id. Puuttuva = malli katsomatta. */
  lampModelOf?: Record<string, string>;
  /** Asiakkaan hintaehdotus (`FixtureQuote`). SERVERIN OMISTAMA — mutatoidaan
   *  vain /fixture-quote-reitiltä, geneerinen blob-tallennus säilyttää talletetun
   *  kopion kuten `p2`/`guided`/`scope`. */
  fixtureQuote?: FixtureQuote;
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
  /**
   * LAAJUUSKYSELY — asiakkaan kyllä/ei per keltainen ikkuna, ilman hintoja.
   *
   * MIKSI TÄMÄ EI OLE P2. `p2` on hintaneuvottelu: sen tilakone, sanitoija ja
   * laskutus pyörivät sentteinä, `validPrice` vaatii hinnan olevan yli nollan,
   * ja `sanitizeP2State` PUDOTTAA tarjouksen jonka hinta on 0. Vastikkeettomalla
   * keikalla nolla on oikea hinta, joten P2:ta ei voi käyttää — ja sen
   * taivuttaminen tarkoittaisi rahan tilakoneen muuttamista, jota FR8:n maksava
   * urakka käyttää samaan aikaan.
   *
   * Kysymys on myös eri: P2 kysyy "kelpaako tämä hinta", tämä kysyy "pestäänkö
   * tämä". Siksi tässä ei ole versioita, lukituksia eikä tapahtumalogia — yksi
   * vastaus per ikkuna, jonka asiakas voi vaihtaa.
   *
   * SERVERIN OMISTAMA kuten `p2`/`guided`/`settlement`: asiakas kirjoittaa tähän
   * omalta reitiltään, joten tekijän ikkunamerkintä ei saa yliajaa sitä.
   * Geneerinen blob-tallennus säilyttää talletetun kopion.
   */
  scope?: ProjScopeState;
  updatedAt: number;                                // epoch ms
}

/** Asiakkaan vastaus yhteen keltaiseen ikkunaan. */
export type ProjScopeAnswer = "yes" | "no";

export interface ProjScopeVote {
  answer: ProjScopeAnswer;
  at: number;
  /** Vastaajan nimi jos tiedossa (keikan yhteyshenkilö). Vapaaehtoinen. */
  by?: string;
}

export interface ProjScopeState {
  /** Ikkuna-avain → vastaus. Puuttuva avain = ei vastausta. */
  votes: Record<string, ProjScopeVote>;
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
    lamps: {},
    lampStatuses: {},
    lampChangedBy: {},
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

// ─── Lamput ja ovet (kalustepisteet) ──────────────────────────────────────────
//
// Sama merkintälogiikka kuin ikkunoilla — lisää/poista/merkitse — mutta EI rahaa
// eikä seedattuja pisteitä: kaikki ovat käsin lisättyjä, ja poisto on aina
// lopullinen (ei tarvitse `deleted`-hautakiveä, koska mitään ei lasketa summaan
// jälkikäteen). Kartalla lamput näkyvät tähtinä ja ovet oviliuskoina,
// ikkunoiden pyöreiden pisteiden sijaan.
//
// ASIAKKAAN NÄKYMÄ ON ERI ASIA KUIN JOHTAJAN. Kartoitus — "tässä huoneessa on
// kuusi lamppua" — on meidän työkalumme, ei asiakkaan uutinen: jos jokainen
// lisätty piste ilmestyisi seurantasivulle, kartoituskierros näyttäisi
// asiakkaalle kymmeniä uusia merkkejä joista yksikään ei kerro mitään tehdystä
// työstä. Siksi piste nousee asiakkaan karttaan vasta kun siitä on jotain
// SANOTTAVAA: lamppu on vaihdettu, se on todettu rikkinäiseksi, tai siitä on
// kirjoitettu huomautus (ovella: tehty tai huomautettu). Ks. `lampIsPublic` /
// `doorIsPublic` — ne ovat se yksi paikka jossa raja määritellään.

export interface ProjLampPoint {
  floor: string;
  key: string;
  x: number;
  y: number;
  status: LampStatus;
  changedBy?: string;
  changedAt?: number;
  /** Toimiiko lamppu. Puuttuva = ei tarkastettu. */
  condition?: LampCondition;
  /** Huomautus tästä lampusta. */
  note?: ProjFixtureNote;
  /** Kuka lisäsi pisteen kartalle (ja milloin) — sisäinen jälki. */
  addedBy?: string;
  addedAt?: number;
}

/** Kaikki lamput joka kerrokselta, litistettynä yhdeksi listaksi. */
export function allLampPoints(data: ProjectData): ProjLampPoint[] {
  const out: ProjLampPoint[] = [];
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const lamps = data.lamps ?? {};
  const statuses = data.lampStatuses ?? {};
  const changedBy = data.lampChangedBy ?? {};
  const conditions = data.lampConditions ?? {};
  const notes = data.lampNotes ?? {};
  const addedBy = data.lampAddedBy ?? {};
  for (const f of floors) {
    for (const lm of lamps[f] || []) {
      const change = changedBy[lm.key];
      const added = addedBy[lm.key];
      out.push({
        floor: f,
        key: lm.key,
        x: lm.x,
        y: lm.y,
        status: statuses[lm.key] || "ei",
        changedBy: change?.by,
        changedAt: change?.ts,
        condition: conditions[lm.key],
        note: notes[lm.key],
        addedBy: added?.by,
        addedAt: added?.ts,
      });
    }
  }
  return out;
}

/**
 * Näkyykö tämä lamppu asiakkaalle?
 *
 * Kolme ehtoa, kaikki "meillä on tästä jotain kerrottavaa": vaihdettu, rikki,
 * tai huomautettu. Pelkkä kartoitettu lamppu ei näy — ks. osion alun perustelu.
 */
export function lampIsPublic(p: ProjLampPoint): boolean {
  return p.status === "vaihdettu" || p.condition === "rikki" || !!p.note?.text;
}

/** Lamput jotka asiakkaan seurantakartta saa näyttää. */
export function publicLampPoints(data: ProjectData): ProjLampPoint[] {
  return allLampPoints(data).filter(lampIsPublic);
}

export interface LampTotals {
  total: number;
  changed: number;
  unchanged: number;
  pct: number; // 0..100
  /** Rikkinäiseksi merkityt. */
  broken: number;
  /** Toimivaksi merkityt. */
  working: number;
  /** Ei vielä tarkastetut (ei kunto-merkintää). */
  unchecked: number;
  /** Lamput joilla on huomautus. */
  noted: number;
  /** Montako lamppua näkyy asiakkaalle (`lampIsPublic`). */
  visible: number;
}

/** Kokonaistilanne dashia varten: montako lamppua merkattu, montako vaihdettu. */
export function computeLampTotals(data: ProjectData): LampTotals {
  const pts = allLampPoints(data);
  const total = pts.length;
  const changed = pts.filter((p) => p.status === "vaihdettu").length;
  const broken = pts.filter((p) => p.condition === "rikki").length;
  const working = pts.filter((p) => p.condition === "toimiva").length;
  return {
    total,
    changed,
    unchanged: total - changed,
    pct: total > 0 ? (changed / total) * 100 : 0,
    broken,
    working,
    unchecked: total - broken - working,
    noted: pts.filter((p) => !!p.note?.text).length,
    visible: pts.filter(lampIsPublic).length,
  };
}

export interface LampWorkerStat {
  worker: string;
  changed: number; // montako lamppua tämä tekijä on merkinnyt vaihdetuksi
  /** Montako huomautusta tämä tekijä on kirjoittanut lampuista. */
  noted: number;
}

/** Per-tekijä lamppulaskuri johtajien näkymää varten — puhdas laskuri, ei rahaa. */
export function computeLampWorkerStats(data: ProjectData): LampWorkerStat[] {
  const pts = allLampPoints(data);
  const by = new Map<string, LampWorkerStat>();
  const row = (w: string) => {
    let r = by.get(w);
    if (!r) { r = { worker: w, changed: 0, noted: 0 }; by.set(w, r); }
    return r;
  };
  for (const p of pts) {
    if (p.status === "vaihdettu" && p.changedBy) row(p.changedBy).changed += 1;
    if (p.note?.text && p.note.by) row(p.note.by).noted += 1;
  }
  return Array.from(by.values()).sort((a, b) => (b.changed - a.changed) || (b.noted - a.noted));
}

// ─── Lamppuvarasto: mitä pitää ostaa ja mikä on jo kunnossa ───────────────────
//
// NELJÄ TOISENSA POISSULKEVAA ÄMPÄRIÄ. Lampulla on kaksi erillistä kenttää
// (vaihdettu / kunto), mutta raportti tarvitsee yhden tilan per lamppu — muuten
// summat eivät täsmää ja "rikki" laskettaisiin kahdesti. Järjestys on
// tarkoituksellinen ja ratkaisee päällekkäisyydet:
//
//   1. VAIHDETTU   — me korjasimme sen. Voittaa kunnon: rikkinäinen lamppu joka
//                    on vaihdettu EI enää tarvitse polttimoa.
//   2. RIKKI       — todettu rikkinäiseksi eikä vaihdettu → tähän ostetaan.
//   3. TOIMIVA     — tarkastettu, ei tehtävää.
//   4. EI TARKASTETTU — vielä käymättä.
//
// Neljä ämpäriä summautuu aina lamppujen kokonaismäärään, joten pinopalkki
// kertoo koko kerroksen ilman jäännöstä.

/** Tarvitseeko lamppu uuden polttimon: rikki eikä vielä vaihdettu. */
export function lampNeedsBulb(p: ProjLampPoint): boolean {
  return p.status !== "vaihdettu" && p.condition === "rikki";
}

/** Onko lamppu kunnossa juuri nyt (vaihdettu tai todettu toimivaksi)? */
export function lampIsFunctional(p: ProjLampPoint): boolean {
  return p.status === "vaihdettu" || p.condition === "toimiva";
}

/** Yhden lampun raportointitila — täsmälleen yksi neljästä. */
export type LampBucket = "vaihdettu" | "rikki" | "toimiva" | "tarkastamatta";

export function lampBucket(p: ProjLampPoint): LampBucket {
  if (p.status === "vaihdettu") return "vaihdettu";
  if (p.condition === "rikki") return "rikki";
  if (p.condition === "toimiva") return "toimiva";
  return "tarkastamatta";
}

export interface LampFloorStat {
  floor: string;
  total: number;
  /** Vaihdetut — me korjasimme. */
  changed: number;
  /** Rikki eikä vaihdettu → tälle kerrokselle ostettava määrä. */
  needsBulb: number;
  /** Tarkastettu toimivaksi. */
  working: number;
  /** Ei vielä tarkastettu. */
  unchecked: number;
}

/** Kerroksittainen lamppujakauma — pinopalkin ja ostolistan lähde. */
export function computeLampFloorStats(data: ProjectData): LampFloorStat[] {
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const rows = new Map<string, LampFloorStat>(
    floors.map((f) => [f, { floor: f, total: 0, changed: 0, needsBulb: 0, working: 0, unchecked: 0 }]),
  );
  for (const p of allLampPoints(data)) {
    const row = rows.get(p.floor);
    if (!row) continue;
    row.total += 1;
    const b = lampBucket(p);
    if (b === "vaihdettu") row.changed += 1;
    else if (b === "rikki") row.needsBulb += 1;
    else if (b === "toimiva") row.working += 1;
    else row.unchecked += 1;
  }
  // Kerrokseton kerros ei kuulu raporttiin: tyhjä rivi on kohinaa, ei tietoa.
  return floors.map((f) => rows.get(f)!).filter((r) => r.total > 0);
}

/**
 * Koko keikan lamppuvarasto — se yksi luku josta ostos tehdään, ja se toinen
 * josta asiakas näkee edistymän.
 *
 * `total` ON KARTALLE MERKITTYJEN LAMPPUJEN MÄÄRÄ, EI KIINTEISTÖN LAMPPUJEN
 * MÄÄRÄ. Nämä kaksi eivät ole sama luku eivätkä lähene toisiaan itsestään:
 * kartoitus on käsityötä, ja merkitsemätön lamppu on tälle laskennalle
 * olematon — ei "tarkastamaton" vaan tuntematon. Jos näkymä sanoo "5 lamppua",
 * se tarkoittaa "5 merkittyä", ja asiakas voi lukea sen "talossa on 5 lamppua"
 * ellei sitä sanota ääneen. Siksi jokainen luku esitetään näkymissä sanoin
 * "merkityistä" — ks. `FixturePanel` ja asiakkaan `FixturesPanel`.
 */
export interface LampInventory {
  /** Kartalle MERKITYT lamput. Ei kiinteistön kokonaismäärä — ks. yllä. */
  total: number;
  /** Montako polttimoa pitää ostaa (= rikki, vaihtamatta). */
  needsBulbs: number;
  /** Montako on jo vaihdettu. */
  fixed: number;
  /** Kunnossa juuri nyt: vaihdetut + toimivaksi todetut. */
  functional: number;
  /** Kunnossa olevien osuus tarkastetuista (0..100). Tarkastamattomat eivät ole
   *  nimittäjässä — muuten luku putoaisi joka kerta kun kartalle lisätään piste. */
  functionalPct: number;
  /** Tarkastetut yhteensä (= total - tarkastamattomat). */
  checked: number;
  unchecked: number;
  working: number;
  byFloor: LampFloorStat[];
}

export function computeLampInventory(data: ProjectData): LampInventory {
  const byFloor = computeLampFloorStats(data);
  const sum = (pick: (r: LampFloorStat) => number) => byFloor.reduce((n, r) => n + pick(r), 0);
  const total = sum((r) => r.total);
  const needsBulbs = sum((r) => r.needsBulb);
  const fixed = sum((r) => r.changed);
  const working = sum((r) => r.working);
  const unchecked = sum((r) => r.unchecked);
  const checked = total - unchecked;
  const functional = fixed + working;
  return {
    total, needsBulbs, fixed, working, unchecked, checked, functional,
    functionalPct: checked > 0 ? (functional / checked) * 100 : 0,
    byFloor,
  };
}

/**
 * MALLIKOHTAINEN OSTOSLISTA — se lista jolla rautakaupassa käydään.
 *
 * Kokonaismäärä ei kelpaa ostoksiin: seitsemän rikkinäistä lamppua voi olla
 * neljä E27:ää ja kolme G9:ää, eikä kumpaakaan saa oikean määrän arvaamalla.
 *
 * MALLITTOMAT EIVÄT KATOA. Ne kootaan omaksi riivikseen (`id: null`), koska
 * niistä pitää nimenomaan tietää: ne ovat se osa listaa jota ei voi vielä
 * ostaa. Rivi jätetään pois vain kun mallittomia ei ole yhtään.
 *
 * Järjestys on ostettavien määrä laskevasti — suurin erä ensin.
 */
export interface LampModelStat {
  /** Mallin id, tai null kun mallia ei ole katsottu. */
  id: string | null;
  name: string;
  /** Montako lamppua tällä mallilla on merkitty. */
  total: number;
  /** Montako niistä pitää vaihtaa → ostettava määrä tätä mallia. */
  needsBulb: number;
  /** Montako on jo vaihdettu. */
  changed: number;
}

export function computeLampModelStats(data: ProjectData): LampModelStat[] {
  const models = data.lampModels ?? [];
  const nameById = new Map(models.map((m) => [m.id, m.name]));
  const assigned = data.lampModelOf ?? {};
  const rows = new Map<string, LampModelStat>();
  const row = (id: string | null, name: string) => {
    const k = id ?? "";
    let r = rows.get(k);
    if (!r) { r = { id, name, total: 0, needsBulb: 0, changed: 0 }; rows.set(k, r); }
    return r;
  };
  for (const p of allLampPoints(data)) {
    const id = assigned[p.key];
    // Poistettuun malliin osoittava lamppu kohdellaan mallittomana: viite on
    // vanhentunut, eikä poistettua mallia saa herättää henkiin listalle.
    const known = id && nameById.has(id) ? id : null;
    const r = row(known, known ? nameById.get(known)! : "Ei mallia");
    r.total += 1;
    if (lampNeedsBulb(p)) r.needsBulb += 1;
    if (p.status === "vaihdettu") r.changed += 1;
  }
  // Käyttämätön malli näkyy nollarivinä: johtaja lisäsi sen syystä, ja tyhjä
  // rivi kertoo että sitä ei ole vielä osoitettu yhdellekään lampulle.
  for (const m of models) if (!rows.has(m.id)) row(m.id, m.name);
  return Array.from(rows.values()).sort((a, b) => (b.needsBulb - a.needsBulb) || (b.total - a.total));
}

/** Kerroksittainen ovijakauma — sama muoto kuin lampuilla, kaksi tilaa. */
export interface DoorFloorStat { floor: string; total: number; done: number; open: number; }

export function computeDoorFloorStats(data: ProjectData): DoorFloorStat[] {
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const rows = new Map<string, DoorFloorStat>(floors.map((f) => [f, { floor: f, total: 0, done: 0, open: 0 }]));
  for (const p of allDoorPoints(data)) {
    const row = rows.get(p.floor);
    if (!row) continue;
    row.total += 1;
    if (p.status === "tehty") row.done += 1; else row.open += 1;
  }
  return floors.map((f) => rows.get(f)!).filter((r) => r.total > 0);
}

/**
 * TYÖLISTA — montako kohdetta, mitä niihin menee, ja mitä asiakas maksaisi.
 *
 * YKSI LUKU, KAKSI KÄYTTÖÄ. `bulbs` on samaan aikaan ostettavien polttimoiden
 * määrä JA vaihtotöiden määrä: jokainen rikkinäinen lamppu on yksi polttimo ja
 * yksi vaihto. Sama pätee oviin. Siksi lukuja on yksi eikä kahta — kaksi lukua
 * ehtisi erkaantua, eikä kumpikaan olisi sen jälkeen oikeassa.
 *
 * Määrä on LASKETTU oletuksena eikä käsin syötetty: kartta tietää jo montako
 * lamppua on rikki, ja käsin ylläpidetty luku ehtisi vanhentua joka kerta kun
 * tekijä merkitsee uuden rikkinäisen. Johtaja voi silti korjata sen
 * (varalamppuja, pakkauskoko), ja silloin `bulbsManual` kertoo että luku on
 * hänen — jottei näkymä väitä laskeneensa sitä.
 *
 * `quotedTotalCents` on TYÖN hinta: kohteiden määrä × asiakkaan ehdottama
 * hinta per vaihto. Tarvikkeet eivät ole siinä mukana.
 */
export interface ResolvedFixtureOrder {
  lampModel?: string;
  /** Efektiivinen ostettava lamppumäärä. */
  bulbs: number;
  /** Kartasta laskettu määrä. */
  bulbsAuto: number;
  bulbsManual: boolean;
  doorMaterial?: string;
  /** Efektiivinen ovimäärä. */
  doorCount: number;
  doorCountAuto: number;
  doorCountManual: boolean;
  note?: string;
  quote?: FixtureQuote;
  /** Asiakkaan ehdotuksella laskettu summa (senttiä). Null kun hintaa ei ole. */
  quotedTotalCents: number | null;
  /**
   * Mallikohtainen erittely ostettavista. Mukana VAIN rivit joilla on jotain
   * ostettavaa: nollarivi kuuluu johtajan hallintanäkymään, ei ostoslistaan.
   * Tyhjä kun malleja ei ole määritelty lainkaan — silloin lista on yksi luku.
   */
  byModel: LampModelStat[];
}

export function resolveFixtureOrder(data: ProjectData): ResolvedFixtureOrder {
  const inv = computeLampInventory(data);
  const doorsOpen = computeDoorFloorStats(data).reduce((n, r) => n + r.open, 0);
  const o = data.fixtureOrder ?? {};
  const bulbsManual = Number.isFinite(o.bulbsNeeded as number) && (o.bulbsNeeded as number) >= 0;
  const doorCountManual = Number.isFinite(o.doorsNeeded as number) && (o.doorsNeeded as number) >= 0;
  const bulbs = bulbsManual ? Math.round(o.bulbsNeeded as number) : inv.needsBulbs;
  const doorCount = doorCountManual ? Math.round(o.doorsNeeded as number) : doorsOpen;
  const q = data.fixtureQuote;
  const bulbCents = q?.lampWorkPriceCents ?? 0;
  const doorCents = q?.doorWorkPriceCents ?? 0;
  const hasPrice = !!q && (q.lampWorkPriceCents != null || q.doorWorkPriceCents != null);
  return {
    ...(o.lampModel ? { lampModel: o.lampModel } : {}),
    bulbs, bulbsAuto: inv.needsBulbs, bulbsManual,
    ...(o.doorMaterial ? { doorMaterial: o.doorMaterial } : {}),
    doorCount, doorCountAuto: doorsOpen, doorCountManual,
    ...(o.note ? { note: o.note } : {}),
    ...(q ? { quote: q } : {}),
    quotedTotalCents: hasPrice ? bulbs * bulbCents + doorCount * doorCents : null,
    // Erittely vain kun malleja on MÄÄRITELTY. Ilman niitä ainoa rivi olisi
    // "Ei mallia", joka toistaisi kokonaisluvun eri sanoin — se on kohinaa,
    // ei erittelyä. Mallittomat kuuluvat listalle vasta kun on jotain mistä
    // ne erottuvat.
    byModel: (data.lampModels?.length ?? 0) > 0
      ? computeLampModelStats(data).filter((m) => m.needsBulb > 0)
      : [],
  };
}

// ─── Ovet (ovipisteet) ────────────────────────────────────────────────────────

export interface ProjDoorPoint {
  floor: string;
  key: string;
  x: number;
  y: number;
  /** Lyhyt tehtävänimi, esim. "karmit + lasi". */
  label?: string;
  status: DoorStatus;
  doneBy?: string;
  doneAt?: number;
  note?: ProjFixtureNote;
  addedBy?: string;
  addedAt?: number;
}

/** Kaikki ovet joka kerrokselta, litistettynä yhdeksi listaksi. */
export function allDoorPoints(data: ProjectData): ProjDoorPoint[] {
  const out: ProjDoorPoint[] = [];
  const floors = data.building.floors.length ? data.building.floors : DEFAULT_FLOORS;
  const doors = data.doors ?? {};
  const statuses = data.doorStatuses ?? {};
  const doneBy = data.doorDoneBy ?? {};
  const notes = data.doorNotes ?? {};
  const addedBy = data.doorAddedBy ?? {};
  for (const f of floors) {
    for (const dr of doors[f] || []) {
      const done = doneBy[dr.key];
      const added = addedBy[dr.key];
      out.push({
        floor: f,
        key: dr.key,
        x: dr.x,
        y: dr.y,
        label: dr.label,
        status: statuses[dr.key] || "ei",
        doneBy: done?.by,
        doneAt: done?.ts,
        note: notes[dr.key],
        addedBy: added?.by,
        addedAt: added?.ts,
      });
    }
  }
  return out;
}

/** Näkyykö tämä ovi asiakkaalle? Sama sääntö kuin lampuilla. */
export function doorIsPublic(p: ProjDoorPoint): boolean {
  return p.status === "tehty" || !!p.note?.text;
}

/** Ovet jotka asiakkaan seurantakartta saa näyttää. */
export function publicDoorPoints(data: ProjectData): ProjDoorPoint[] {
  return allDoorPoints(data).filter(doorIsPublic);
}

export interface DoorTotals {
  total: number;
  done: number;
  open: number;
  pct: number; // 0..100
  noted: number;
  visible: number;
}

export function computeDoorTotals(data: ProjectData): DoorTotals {
  const pts = allDoorPoints(data);
  const total = pts.length;
  const done = pts.filter((p) => p.status === "tehty").length;
  return {
    total,
    done,
    open: total - done,
    pct: total > 0 ? (done / total) * 100 : 0,
    noted: pts.filter((p) => !!p.note?.text).length,
    visible: pts.filter(doorIsPublic).length,
  };
}

export interface DoorWorkerStat { worker: string; done: number; noted: number; }

/** Per-tekijä ovilaskuri — kuka on kuitannut mitkä ovet tehdyiksi. */
export function computeDoorWorkerStats(data: ProjectData): DoorWorkerStat[] {
  const pts = allDoorPoints(data);
  const by = new Map<string, DoorWorkerStat>();
  const row = (w: string) => {
    let r = by.get(w);
    if (!r) { r = { worker: w, done: 0, noted: 0 }; by.set(w, r); }
    return r;
  };
  for (const p of pts) {
    if (p.status === "tehty" && p.doneBy) row(p.doneBy).done += 1;
    if (p.note?.text && p.note.by) row(p.note.by).noted += 1;
  }
  return Array.from(by.values()).sort((a, b) => (b.done - a.done) || (b.noted - a.noted));
}

/**
 * Kulut jotka asiakas saa nähdä: vain nimenomaisesti merkityt, ja ilman
 * kuittia (`ProjExpense.forCustomer`). Kuitti on kirjanpitomme tosite eikä
 * asiakkaan asiakirja, joten sitä ei ole tässä muodossa lainkaan.
 */
export interface PublicExpense {
  kind: ProjExpenseKind;
  desc: string;
  amountCents: number;
  ts: number;
}

export function customerExpenses(data: ProjectData): PublicExpense[] {
  return (data.expenses ?? [])
    .filter((e) => e.forCustomer === true)
    .map((e) => ({ kind: e.kind, desc: e.desc, amountCents: e.amountCents, ts: e.ts }))
    .sort((a, b) => b.ts - a.ts);
}

/**
 * TUNTIKEIKAN TILANNE ASIAKKAALLE: kuka on tehnyt montako tuntia, ja mitä
 * hänelle on ostettu.
 *
 * TEKIJÖIDEN NIMET NÄKYVÄT TÄSSÄ, toisin kuin ikkunoiden pesijät tai lamppujen
 * vaihtajat. Ero ei ole epäjohdonmukaisuus vaan laskutustavan seuraus:
 * tuntikeikalla asiakas maksaa nimenomaan näiden ihmisten ajasta, joten hänen
 * kuuluu nähdä kenen. Kohdennetussa tilassa hän maksaa kohteista, ja silloin
 * tekijä on meidän sisäinen asiamme.
 *
 * NOLLATUNTINEN EI OLE RIVI. Nimi jolla ei ole tunteja ei kerro asiakkaalle
 * mitään — se vain kasvattaa listaa nimillä joilla ei ole tekemistä keikan
 * kanssa.
 */
export interface CustomerHourRow { name: string; hours: number; }

export function customerHourRows(data: ProjectData, nameOf: (id: string) => string): CustomerHourRow[] {
  return Object.entries(data.hours ?? {})
    .filter(([, h]) => h > 0)
    .map(([id, hours]) => ({ name: nameOf(id), hours }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * ASIAKKAAN kartalle menevä lamppu/ovi.
 *
 * Kaksi eroa sisäiseen pisteeseen, kummallakin oma syy:
 *   1. TEKIJÄN NIMEÄ EI OLE. Asiakkaan kartta ei kerro kuka pesi minkäkin
 *      ikkunan, eikä sen pidä kertoa kuka vaihtoi minkäkin lampun — sama raja.
 *      Johtajat näkevät tekijän dashista.
 *   2. VAIN JULKISET PISTEET. Suodatus tapahtuu `publicLampView`issä, ei
 *      selaimessa: kartoitetut pisteet eivät saa lähteä verkkoon lainkaan,
 *      muuten "ei näytetä" olisi pelkkä käyttöliittymäsopimus.
 */
export interface PublicLampPoint {
  floor: string;
  key: string;
  x: number;
  y: number;
  status: LampStatus;
  condition?: LampCondition;
  note?: string;
  noteAt?: number;
  changedAt?: number;
}

export function publicLampView(data: ProjectData): PublicLampPoint[] {
  return publicLampPoints(data).map((p) => ({
    floor: p.floor, key: p.key, x: p.x, y: p.y, status: p.status,
    ...(p.condition ? { condition: p.condition } : {}),
    ...(p.note?.text ? { note: p.note.text, noteAt: p.note.ts } : {}),
    ...(p.changedAt ? { changedAt: p.changedAt } : {}),
  }));
}

export interface PublicDoorPoint {
  floor: string;
  key: string;
  x: number;
  y: number;
  label?: string;
  status: DoorStatus;
  note?: string;
  noteAt?: number;
  doneAt?: number;
}

export function publicDoorView(data: ProjectData): PublicDoorPoint[] {
  return publicDoorPoints(data).map((p) => ({
    floor: p.floor, key: p.key, x: p.x, y: p.y, status: p.status,
    ...(p.label ? { label: p.label } : {}),
    ...(p.note?.text ? { note: p.note.text, noteAt: p.note.ts } : {}),
    ...(p.doneAt ? { doneAt: p.doneAt } : {}),
  }));
}

/**
 * Yksi rivi "mistä on huomautettavaa" -paneeliin (dashin ylälaita).
 *
 * Kokoaa lamput ja ovet SAMAAN listaan, koska johtaja ei kysy "mitä lampuille
 * kuuluu" vaan "mistä pitää tietää". Järjestys on kiireellisyys: rikki ennen
 * huomautusta, huomautus ennen tekemätöntä, tehdyt viimeisenä.
 */
export interface FixtureAttentionRow {
  kind: "lamp" | "door";
  floor: string;
  key: string;
  /** Näytettävä nimi, esim. "Lamppu · krs 2" tai oven `label`. */
  label?: string;
  /** Onko tästä pisteestä jotain kerrottavaa asiakkaalle asti. */
  public: boolean;
  status: LampStatus | DoorStatus;
  condition?: LampCondition;
  note?: ProjFixtureNote;
  by?: string;
  at?: number;
}

/** Kiireellisyysjärjestys: pienempi = ylemmäs. */
function attentionRank(r: FixtureAttentionRow): number {
  if (r.condition === "rikki") return 0;
  if (r.note?.text) return 1;
  if (r.status === "ei") return 2;
  return 3;
}

export function fixtureAttentionRows(data: ProjectData): FixtureAttentionRow[] {
  const rows: FixtureAttentionRow[] = [
    ...allLampPoints(data).map((p): FixtureAttentionRow => ({
      kind: "lamp", floor: p.floor, key: p.key, public: lampIsPublic(p),
      status: p.status, condition: p.condition, note: p.note,
      by: p.changedBy, at: p.changedAt,
    })),
    ...allDoorPoints(data).map((p): FixtureAttentionRow => ({
      kind: "door", floor: p.floor, key: p.key, label: p.label, public: doorIsPublic(p),
      status: p.status, note: p.note, by: p.doneBy, at: p.doneAt,
    })),
  ];
  return rows.sort((a, b) => attentionRank(a) - attentionRank(b) || a.floor.localeCompare(b.floor, "fi"));
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
 * Tuntiarvio per ikkuna, siivottuna — tai null jos arviota ei ole.
 *
 * MIKSI OMA FUNKTIO: sama luku luetaan kahdesta paikasta (`computeEfficiency`
 * ja asiakkaan julkinen projektio). Kaksi rinnakkaista `Number.isFinite`-ehtoa
 * olisi kaksi paikkaa jossa nolla, tyhjä merkkijono tai NaN käsitellään eri
 * tavalla, ja asiakkaan sivulle päätyisi "0 h" arvion puuttumisen sijaan.
 */
export function estHoursPerWindowOf(data: Pick<ProjectData, "estimatedHoursPerWindow">): number | null {
  const est = Number(data.estimatedHoursPerWindow);
  return Number.isFinite(est) && est > 0 ? est : null;
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
  const estHoursPerWindow = estHoursPerWindowOf(data);
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
      // Sama nimi kuin kartalla: yhden tilan keikalla "Tila", ei "1. kerros".
      // FR8:lla `unitWord` on tyhjä, joten tämä tuottaa sille tavulleen saman
      // nimen kuin ennen ("Kellari" / "3. kerros").
      name: floorLabel(project.building, f),
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

/** Lampun/oven huomautuskartta: tyhjä teksti = ei huomautusta, joten se putoaa. */
function sanitizeFixtureNotes(input: any): Record<string, ProjFixtureNote> {
  const out: Record<string, ProjFixtureNote> = {};
  if (!input || typeof input !== "object") return out;
  for (const k of Object.keys(input).slice(0, 20000)) {
    const n = input[k];
    if (!n || typeof n !== "object") continue;
    const text = String(n.text ?? "").trim().slice(0, MAX_FIXTURE_NOTE_LEN);
    if (!text) continue;
    out[cleanKey(k)] = {
      text,
      ...(n.by ? { by: String(n.by).slice(0, 40) } : {}),
      ts: Number(n.ts) || Date.now(),
    };
  }
  return out;
}

/** Positiivinen kokonaisluku tai undefined — käsin asetetut kappalemäärät. */
function toCount(v: any): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(100_000, Math.round(n));
}

/** Yksikköhinta sentteinä. Nolla on kelvollinen hinta ("veloituksetta"). */
function toUnitPriceCents(v: any): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(MAX_FIXTURE_UNIT_PRICE_CENTS, Math.round(n));
}

/** Keikan lamppumallit. Nimetön tai tunnukseton malli putoaa. */
export function sanitizeLampModels(input: any): LampModel[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: LampModel[] = [];
  for (const m of input.slice(0, MAX_LAMP_MODELS)) {
    const id = String(m?.id ?? "").trim().slice(0, 40);
    const name = String(m?.name ?? "").trim().slice(0, MAX_FIXTURE_MODEL_LEN);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/** Johtajan ostotieto. Tyhjä objekti pudotetaan kokonaan. */
export function sanitizeFixtureOrder(input: any): FixtureOrder | null {
  if (!input || typeof input !== "object") return null;
  const out: FixtureOrder = {};
  const model = String(input.lampModel ?? "").trim().slice(0, MAX_FIXTURE_MODEL_LEN);
  if (model) out.lampModel = model;
  const doorMat = String(input.doorMaterial ?? "").trim().slice(0, MAX_FIXTURE_MODEL_LEN);
  if (doorMat) out.doorMaterial = doorMat;
  const bulbs = toCount(input.bulbsNeeded);
  if (bulbs !== undefined) out.bulbsNeeded = bulbs;
  const doorsNeeded = toCount(input.doorsNeeded);
  if (doorsNeeded !== undefined) out.doorsNeeded = doorsNeeded;
  const note = String(input.note ?? "").trim().slice(0, MAX_FIXTURE_ORDER_NOTE_LEN);
  if (note) out.note = note;
  return Object.keys(out).length ? out : null;
}

/**
 * Asiakkaan hintaehdotus. Pudotetaan kokonaan jos siinä ei ole yhtään hintaa
 * eikä viestiä — tyhjä ehdotus ei ole ehdotus, ja tyhjä objekti näyttäisi
 * näkymässä siltä kuin asiakas olisi vastannut.
 */
export function sanitizeFixtureQuote(input: any): FixtureQuote | null {
  if (!input || typeof input !== "object") return null;
  const out: FixtureQuote = { at: Number(input.at) || Date.now() };
  const lampWork = toUnitPriceCents(input.lampWorkPriceCents);
  if (lampWork !== undefined) out.lampWorkPriceCents = lampWork;
  const doorWork = toUnitPriceCents(input.doorWorkPriceCents);
  if (doorWork !== undefined) out.doorWorkPriceCents = doorWork;
  const note = String(input.note ?? "").trim().slice(0, MAX_FIXTURE_QUOTE_NOTE_LEN);
  if (note) out.note = note;
  const hasContent = out.lampWorkPriceCents != null || out.doorWorkPriceCents != null || !!out.note;
  return hasContent ? out : null;
}

/** `{ by, ts }` -kartta (kuka lisäsi / kuka kuittasi). Nimetön merkintä putoaa. */
function sanitizeMarkBy(input: any): Record<string, ProjMarkBy> {
  const out: Record<string, ProjMarkBy> = {};
  if (!input || typeof input !== "object") return out;
  for (const k of Object.keys(input).slice(0, 20000)) {
    const c = input[k];
    const by = c && typeof c === "object" ? String(c.by ?? "").slice(0, 40) : "";
    if (by) out[cleanKey(k)] = { by, ts: Number(c.ts) || Date.now() };
  }
  return out;
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

  const lamps: Record<string, ProjLampMark[]> = {};
  if (input.lamps && typeof input.lamps === "object") {
    for (const f of Object.keys(input.lamps).slice(0, 40)) {
      const arr = Array.isArray(input.lamps[f]) ? input.lamps[f] : [];
      lamps[String(f).slice(0, 8)] = arr.slice(0, 2000).map((l: any) => ({
        key: cleanKey(l?.key),
        x: clampPct(Number(l?.x)),
        y: clampPct(Number(l?.y)),
      })).filter((l: ProjLampMark) => l.key);
    }
  }

  const lampStatuses: Record<string, LampStatus> = {};
  if (input.lampStatuses && typeof input.lampStatuses === "object") {
    for (const k of Object.keys(input.lampStatuses).slice(0, 20000)) {
      if (input.lampStatuses[k] === "vaihdettu") lampStatuses[cleanKey(k)] = "vaihdettu";
    }
  }

  // Vain vaihdetuille lampuille: puretulla merkinnällä (status palautettu "ei")
  // ei saa jäädä roikkumaan vanhaa "kuka vaihtoi" -tietoa, samaan tapaan kuin
  // ikkunoiden keskenBy vain kesken-tilaisille.
  const lampChangedBy: Record<string, ProjLampChange> = {};
  if (input.lampChangedBy && typeof input.lampChangedBy === "object") {
    for (const k of Object.keys(input.lampChangedBy).slice(0, 20000)) {
      const key = cleanKey(k);
      const c = input.lampChangedBy[k];
      const by = c && typeof c === "object" ? String(c.by ?? "").slice(0, 40) : "";
      if (by && lampStatuses[key] === "vaihdettu") {
        lampChangedBy[key] = { by, ts: Number(c.ts) || Date.now() };
      }
    }
  }

  const lampConditions: Record<string, LampCondition> = {};
  if (input.lampConditions && typeof input.lampConditions === "object") {
    for (const k of Object.keys(input.lampConditions).slice(0, 20000)) {
      const c = toLampCondition(input.lampConditions[k]);
      if (c) lampConditions[cleanKey(k)] = c;
    }
  }

  const lampModels = sanitizeLampModels(input.lampModels);
  // Viite poistettuun malliin pudotetaan tässä: muuten kartta kantaisi
  // roikkuvia tunnuksia, ja "ei mallia" pääteltäisiin joka lukupaikassa
  // erikseen. Ks. `computeLampModelStats`, joka noudattaa samaa sääntöä.
  const knownModelIds = new Set(lampModels.map((m) => m.id));
  const lampModelOf: Record<string, string> = {};
  if (input.lampModelOf && typeof input.lampModelOf === "object") {
    for (const k of Object.keys(input.lampModelOf).slice(0, 20000)) {
      const id = String(input.lampModelOf[k] ?? "").trim().slice(0, 40);
      if (id && knownModelIds.has(id)) lampModelOf[cleanKey(k)] = id;
    }
  }

  const lampNotes = sanitizeFixtureNotes(input.lampNotes);
  // "Kuka lisäsi" on pelkkä jälki, ei tila: se säilyy vaikka lamppu palautetaan
  // vaihtamattomaksi, toisin kuin `lampChangedBy`.
  const lampAddedBy = sanitizeMarkBy(input.lampAddedBy);

  const doors: Record<string, ProjDoorMark[]> = {};
  if (input.doors && typeof input.doors === "object") {
    for (const f of Object.keys(input.doors).slice(0, 40)) {
      const arr = Array.isArray(input.doors[f]) ? input.doors[f] : [];
      doors[String(f).slice(0, 8)] = arr.slice(0, 2000).map((d: any) => ({
        key: cleanKey(d?.key),
        x: clampPct(Number(d?.x)),
        y: clampPct(Number(d?.y)),
        ...(d?.label ? { label: String(d.label).slice(0, MAX_DOOR_LABEL_LEN) } : {}),
      })).filter((d: ProjDoorMark) => d.key);
    }
  }

  const doorStatuses: Record<string, DoorStatus> = {};
  if (input.doorStatuses && typeof input.doorStatuses === "object") {
    for (const k of Object.keys(input.doorStatuses).slice(0, 20000)) {
      if (input.doorStatuses[k] === "tehty") doorStatuses[cleanKey(k)] = "tehty";
    }
  }

  // Sama sääntö kuin lampuilla: kuittaus puretaan → tekijätieto lähtee mukana.
  const doorDoneBy: Record<string, ProjMarkBy> = {};
  for (const [key, v] of Object.entries(sanitizeMarkBy(input.doorDoneBy))) {
    if (doorStatuses[key] === "tehty") doorDoneBy[key] = v;
  }

  const doorNotes = sanitizeFixtureNotes(input.doorNotes);
  const doorAddedBy = sanitizeMarkBy(input.doorAddedBy);

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
        // Vain nimenomainen `true` näyttää kulun asiakkaalle. Puuttuva,
        // roskainen tai "false" jää sisäiseksi — oletus on aina yksityinen.
        ...(e?.forCustomer === true ? { forCustomer: true as const } : {}),
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
    lamps,
    lampStatuses,
    lampChangedBy,
    // Uudet kalustekentät kirjoitetaan VAIN kun niissä on sisältöä, jotta vanha
    // tallennettu blobi (FR8) pyörähtää läpi tavu tavulta entisellään.
    ...(Object.keys(lampConditions).length ? { lampConditions } : {}),
    ...(Object.keys(lampNotes).length ? { lampNotes } : {}),
    ...(Object.keys(lampAddedBy).length ? { lampAddedBy } : {}),
    ...(Object.keys(doors).length ? { doors } : {}),
    ...(Object.keys(doorStatuses).length ? { doorStatuses } : {}),
    ...(Object.keys(doorDoneBy).length ? { doorDoneBy } : {}),
    ...(Object.keys(doorNotes).length ? { doorNotes } : {}),
    ...(Object.keys(doorAddedBy).length ? { doorAddedBy } : {}),
    // Vain valittu tila kirjoitetaan: puuttuva on "targeted", ja vanha blobi
    // pyörähtää läpi entisellään.
    ...(toBillingMode(input.billingMode) ? { billingMode: toBillingMode(input.billingMode)! } : {}),
    ...(lampModels.length ? { lampModels } : {}),
    ...(Object.keys(lampModelOf).length ? { lampModelOf } : {}),
    ...(input.fixtureOrder !== undefined ? (() => { const o = sanitizeFixtureOrder(input.fixtureOrder); return o ? { fixtureOrder: o } : {}; })() : {}),
    ...(input.fixtureQuote !== undefined ? (() => { const q = sanitizeFixtureQuote(input.fixtureQuote); return q ? { fixtureQuote: q } : {}; })() : {}),
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
    ...(input.scope !== undefined ? (() => { const sc = sanitizeScopeState(input.scope); return sc ? { scope: sc } : {}; })() : {}),
    updatedAt: Date.now(),
  };
}

/**
 * Laajuuskyselyn siivous. Tuntematon vastaus tai kelvoton aikaleima pudottaa
 * koko äänen: "ei vastausta" on turvallinen tila, arvattu vastaus ei ole.
 */
export function sanitizeScopeState(input: any): ProjScopeState | null {
  if (!input || typeof input !== "object") return null;
  const src = input.votes && typeof input.votes === "object" ? input.votes : {};
  const votes: Record<string, ProjScopeVote> = {};
  for (const [rawKey, rawVote] of Object.entries(src).slice(0, 5000)) {
    const key = String(rawKey).slice(0, 64);
    const v: any = rawVote;
    if (!key || !v || typeof v !== "object") continue;
    if (v.answer !== "yes" && v.answer !== "no") continue;
    const at = Number(v.at);
    votes[key] = {
      answer: v.answer,
      at: Number.isFinite(at) && at > 0 ? Math.round(at) : Date.now(),
      ...(typeof v.by === "string" && v.by.trim() ? { by: v.by.trim().slice(0, 80) } : {}),
    };
  }
  return { votes };
}

/**
 * Keltaisten ikkunoiden laajuustilanne: mistä asiakas on sanonut kyllä, mistä
 * ei, ja mikä on vielä avoin.
 *
 * Vastaukset luetaan vain ELÄVISTÄ keltaisista pisteistä: poistetun tai
 * punaiseksi vaihdetun ikkunan vanha vastaus ei saa jäädä lukuihin roikkumaan.
 */
export interface ScopeSummary {
  yes: string[];
  no: string[];
  open: string[];
  /** Eläviä keltaisia ikkunoita yhteensä. */
  total: number;
}

export function scopeSummary(data: ProjectData): ScopeSummary {
  const votes = data.scope?.votes ?? {};
  const out: ScopeSummary = { yes: [], no: [], open: [], total: 0 };
  for (const pt of allPoints(data)) {
    if (pt.p !== 2) continue;
    out.total += 1;
    const a = votes[pt.key]?.answer;
    if (a === "yes") out.yes.push(pt.key);
    else if (a === "no") out.no.push(pt.key);
    else out.open.push(pt.key);
  }
  return out;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function eurFromCents(cents: number): string {
  return (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
