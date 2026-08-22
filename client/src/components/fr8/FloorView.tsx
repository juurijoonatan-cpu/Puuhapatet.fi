/**
 * FR8 projektinäkymä — per-floor window map (ported from fr8-ikkunat prototype).
 * The dot positions, drag/add/delete and status logic are kept identical to the
 * prototype; only persistence (handled by the parent) and the plan image base
 * path differ.
 */
import { useState, useRef, useEffect, useMemo } from "react";
import type { ProjMarksData, WindowStatus, ProjCustomMark, ProjMapNote, ProjNoteKind, ProjActiveZone, ProjWindowObservation, FixedDeal, ProjBuilding, LampStatus, LampCondition, ProjLampMark, ProjFixtureNote, DoorStatus, ProjDoorMark } from "@shared/project";
import { NOTE_KINDS, planImageUrl, planRenderOf, hasAnyPlan, floorLabel, lampBucket, MAX_FIXTURE_NOTE_LEN, MAX_DOOR_LABEL_LEN } from "@shared/project";
import type { P2Offer, P2NumberingInput } from "@shared/p2";
import { P2_PRICE_PRESETS_CENTS, MAX_P2_NOTE_LEN, p2NumbersByFloor } from "@shared/p2";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuthedImage } from "@/lib/authed-image";
import { STAR_CLIP } from "@/lib/fixture-marks";

const CIRC_S = 2 * Math.PI * 17; // mini ring

// Hard-crop the plan's outer edges so the stray white structure lines that bleed
// off the floor-plan image's sides are simply cut off (no fade). Applied to the
// plan image only, never the dots layer, so interior markers stay fully visible.
const PLAN_CROP = "inset(2%)";


/**
 * Lampun väri — NELJÄ tilaa, sama järjestys kuin raportin ämpärit
 * (`lampBucket`): vaihdettu voittaa kunnon, rikki voittaa loput.
 *
 * "Toimiva" on tarkoituksella HARMAA eikä vihreä: se tarkoittaa "käyty,
 * ei tehtävää", ja kartan pitää nostaa esiin se mikä vaatii työtä. Kolme
 * kirkasta väriä kolmelle toimenpiteelle ja yksi vaimea "ei mitään" lukee
 * yhdellä silmäyksellä; neljä kirkasta ei lukisi.
 */
function lampRgb(status: LampStatus, condition?: LampCondition): string {
  if (status === "vaihdettu") return "124,224,166";  // vaihdettu — me korjasimme
  if (condition === "rikki") return "255,116,116";   // rikki — ostettava
  if (condition === "toimiva") return "150,155,165"; // toimiva — ei tehtävää
  return "255,196,90";                                // ei tarkastettu
}

/** Lampun tila sanoina. Väri ei kanna merkitystä yksin — ks. `LampFloorChart`. */
function lampStateLabel(status: LampStatus, condition?: LampCondition): string {
  if (status === "vaihdettu") return "Vaihdettu";
  if (condition === "rikki") return "Ei toimi";
  if (condition === "toimiva") return "Toimii";
  return "Ei tarkastettu";
}

/** Oven väri: tehty = vihreä, tekemättä = sininen (ei amber, jottei sekoitu
 *  vaihtamattomaan lamppuun samalla kartalla). */
function doorRgb(status: DoorStatus): string {
  return status === "tehty" ? "124,224,166" : "156,193,255";
}

/**
 * Ovimerkki — kapea oviliuska ja ripa.
 *
 * Kartalla on kolme merkkilajia: ikkuna on ympyrä, lamppu on tähti, ovi on
 * tämä. Muoto eikä väri erottaa ne, koska värit kertovat jo tilan.
 */
function DoorGlyph({ rgb, size = 18, glow = true }: { rgb: string; size?: number; glow?: boolean }) {
  const r = Math.max(2, Math.round(size * 0.16));
  const knob = Math.max(2, Math.round(size * 0.14));
  return (
    <span aria-hidden style={{
      display: "inline-flex", alignItems: "center", justifyContent: "flex-end", boxSizing: "border-box",
      width: Math.round(size * 0.72), height: size, paddingRight: Math.max(1, Math.round(size * 0.12)),
      borderRadius: `${r}px ${r}px 2px 2px`,
      background: `linear-gradient(135deg, rgba(255,255,255,0.92), rgba(${rgb},0.95) 55%, rgba(${rgb},0.85))`,
      border: `1px solid rgba(${rgb},0.9)`,
      ...(glow ? { filter: `drop-shadow(0 0 5px rgba(${rgb},0.6))` } : {}),
    }}>
      <span style={{ width: knob, height: knob, borderRadius: "50%", background: "rgba(18,18,24,0.72)" }} />
    </span>
  );
}

/** "2 min sitten" -tyylinen lyhyt aikaleima kalustehuomautuksille. */
function fixtureAgo(ts?: number): string {
  if (!ts) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "juuri nyt";
  if (s < 3600) return `${Math.floor(s / 60)} min sitten`;
  if (s < 86400) return `${Math.floor(s / 3600)} h sitten`;
  return `${Math.floor(s / 86400)} pv sitten`;
}

interface Point { key: string; p: 1 | 2; x: number; y: number; }

interface Props {
  floors: string[];
  planBase: string;
  /**
   * Koko rakennusobjekti. Tästä luetaan LADATUT pohjakuvat
   * (`planImages`), kuvan esitystapa (`planRender`) ja tilan nimi
   * (`unitWord`). Valinnainen: ilman sitä käytös on ennallaan
   * (`planBase` + kerros + ".png", FR8:n rajaus ja "N. kerros").
   */
  building?: ProjBuilding;
  /**
   * Pohjakuvareitin etuliite tälle yleisölle — admin `/api/jobs/:id/plan/`,
   * tekijä `/api/crew/:token/plan/`. Tarvitaan vain kun kerroksella on
   * ladattu kuva. Ks. `api.planUrlBaseForJob` / `planUrlBaseForCrew`.
   */
  planUrlBase?: string;
  /**
   * Vaatiiko `planUrlBase` Bearer-tokenin. Adminin reitti vaatii, asiakkaan ja
   * tekijän julkiset reitit eivät (token on polussa). `<img>` ei voi lähettää
   * otsaketta, joten adminin kuva haetaan fetchillä ja näytetään object-URLina
   * — ilman tätä juuri ladattu pohjakuva näkyi rikkinäisen kuvan merkkinä.
   */
  planAuthed?: boolean;
  pricePerWindow: number;
  marks: ProjMarksData | null;
  statuses: Record<string, WindowStatus>;
  posOverrides: Record<string, { x: number; y: number }>;
  customMarks: Record<string, ProjCustomMark[]>;
  deleted: Record<string, boolean>;
  initialFloor: string;
  onStatusChange: (key: string, status: WindowStatus, washedById?: string) => void;
  onAddCustomMark: (floor: string, x: number, y: number, p: 1 | 2) => void;
  onDeleteMark: (key: string) => void;
  onMoveMark: (key: string, x: number, y: number) => void;
  onMoveMarkCommit: (key: string, x: number, y: number) => void;
  onResetFloor: (floor: string) => void;
  /** When false, hide the structural edit controls (move/add/delete) — workers
   *  can still set window status, but cannot restructure the map. Default true. */
  canEdit?: boolean;
  /** Allow adding/editing map notes (huomio, tikkaat, …) WITHOUT full edit rights.
   *  Lets workers leave simple markers while still not moving/deleting windows. */
  canAddNotes?: boolean;
  /** Hide all € figures on the map (worker view — they never see gig pricing). */
  hideMoney?: boolean;
  /** key → worker id who washed it (manager view). Enables the "who cleaned this"
   *  label in the status popover. Workers/customers don't pass this. */
  washedBy?: Record<string, string>;
  /** key → second washer id for a window done together (50/50 split). Manager view. */
  washedBy2?: Record<string, string>;
  /** Credit a washed window to a second worker (50/50), or clear it (null). Manager view. */
  onSetSplit?: (key: string, second: string | null) => void;
  /** key → worker id who marked it "kesken". */
  keskenBy?: Record<string, string>;
  /** worker id → display name, for the washedBy/keskenBy label. */
  workerNames?: Record<string, string>;
  /** This gig's pickable crew (id + name) for the washed-by picker. Manager view only. */
  workers?: { id: string; name: string }[];
  /** Logged-in user's worker id — default washer when marking a window washed. */
  currentWorkerId?: string;
  /** Navigation markers / notes per floor (ladders, entrances, hazards, …). */
  notes?: Record<string, ProjMapNote[]>;
  onAddNote?: (floor: string, x: number, y: number, kind: ProjNoteKind) => string | void;
  onUpdateNote?: (floor: string, key: string, text: string) => void;
  onDeleteNote?: (floor: string, key: string) => void;
  /** Per-window observations (text + optional photo), keyed by window key. */
  observations?: Record<string, ProjWindowObservation>;
  /** Allow leaving an observation on a window (worker/admin). */
  canObserve?: boolean;
  /** Persist an observation. Empty text + no image clears it. */
  onSetObservation?: (key: string, text: string, imageDataUrl?: string) => void;
  /**
   * Hae yhden havainnon kuva pyynnöstä. Palvelin lähettää havainnoista vain
   * tekstin ja `hasImage`-lipun, joten kuva ladataan vasta kun pistettä
   * napautetaan. Ilman tätä propia `hasImage`-havainnon kuvaa ei näytetä eikä
   * — tärkeämpää — voi vahingossa tyhjentää tallennettaessa.
   */
  onLoadObservationImage?: (key: string) => Promise<string | undefined>;
  /** The single "work happening here now" highlight (shown to the customer too). */
  activeZone?: ProjActiveZone | null;
  onSetActiveZone?: (floor: string, x: number, y: number) => void;
  onClearActiveZone?: () => void;
  /** When set, the price is a locked, signed deal (no editing, billable priority
   *  + agreed cap drive the figures). FR8 = €37.50/red window, €6300 cap. */
  deal?: FixedDeal | null;
  /** P2 (keltaiset ikkunat) — per-window pricing state. Admin view passes the
   *  full offers map; the worker view passes only lockedKeys + its OWN
   *  payoutByKey (customer prices never reach a worker). Null/absent = no P2. */
  p2?: {
    enabled: boolean;
    offers?: Record<string, P2Offer>;
    lockedKeys?: string[];
    payoutByKey?: Record<string, number>;
  } | null;
  /** Admin: bulk price proposal for selected yellow windows — enables the
   *  "€ Hinnoittele" multi-select mode. */
  onP2Propose?: (keys: string[], priceCents: number, note?: string) => void;
  /**
   * LAAJUUSKYSELYN VASTAUKSET (yhteisökeikka): ikkuna-avain → asiakkaan
   * "pestään" / "ei pestä".
   *
   * Tekijän on nähtävä tämä kartalta, muuten asiakkaan vastaus jää järjestelmän
   * sisään eikä ohjaa työtä — mikä on koko kyselyn ainoa tarkoitus. Vain merkki
   * pisteen päälle; itse pisteen väri ja toiminnot ovat ennallaan, koska tämä on
   * asiakkaan toive eikä ikkunan tila.
   */
  scopeVotes?: Record<string, "yes" | "no"> | null;
  /** Ohjattu eteneminen (guided): the open floor + which floors are locked + the
   *  single next window to wash. Drives the locked-floor tabs and the pulsing
   *  "next" ring. Null/absent = no guidance (map fully open). */
  guided?: {
    enabled: boolean;
    activeFloor: string | null;
    activeFloors?: string[];
    lockedFloors: string[];
    nextKey: string | null;
  } | null;
  /**
   * Kerroksen lukitus suoraan kartalta. Kun tämä on annettu, kerrosnapissa on
   * pieni lukkopainike: johtajan ei tarvitse poistua kartalta ja etsiä
   * dashin taittuvaa "KERROSTEN LUKITUS" -osiota vain avatakseen kerroksen.
   * Ilman tätä propia (tekijän näkymä) kerrosnappi käyttäytyy kuten ennen.
   */
  onToggleFloorLock?: (floor: string, locked: boolean) => void;
  /**
   * Yhden ikkunan lukitus suoraan kartalta (johtaja). Kun tämä on annettu,
   * ikkunan tietoikkunassa on "Piilota tekijöiltä". Tekijän näkymä ei anna
   * tätä propia — se vain saa `lockedWindowKeys`in ja piilottaa pisteet.
   */
  onToggleWindowLock?: (key: string, locked: boolean) => void;
  /** Tekijöiltä lukitut ikkunat. Tekijän kartalla nämä eivät näy lainkaan;
   *  johtajan kartalla ne näkyvät himmeinä ja lukkomerkillä. */
  lockedWindowKeys?: string[];
  /** Bump `nonce` to programmatically jump the map to `floor` (e.g. the worker's
   *  "Vie minut seuraavaan" button). */
  /** Hyppää kerrokselle; `key` avaa lisäksi juuri sen ikkunan tiedot. */
  floorFocus?: { floor: string; nonce: number; key?: string } | null;
  /** When set (non-empty), the floor selector shows ONLY these floors and hides
   *  the rest entirely — a discreet worker map that reveals just the opened
   *  floors. Founders pass null/undefined to see every floor. */
  restrictFloors?: string[] | null;
  /**
   * LAMPUT — sama merkintälogiikka kuin ikkunoilla, mutta EI rahaa: vapaasti
   * lisättäviä pisteitä, näkyvät tähtinä. `lamps` = kerroksen pisteet,
   * `lampStatuses`/`lampChangedBy` = tila ja kuka vaihtoi. Kaikki valinnaisia —
   * puuttuessaan lamppukerros ei piirry lainkaan (ei muutosta olemassa olevaan).
   */
  lamps?: Record<string, ProjLampMark[]>;
  lampStatuses?: Record<string, LampStatus>;
  /** Lampun avain → tekijän id joka merkitsi sen vaihdetuksi. */
  lampChangedBy?: Record<string, string>;
  /** Lisää uusi lamppu kartalle (johtaja). Puuttuessaan "+ Lamppu" -valintaa ei näytetä. */
  onAddLamp?: (floor: string, x: number, y: number) => void;
  /** Poista lamppu kartalta kokonaan (johtaja). */
  onDeleteLamp?: (key: string) => void;
  /** Merkitse lamppu vaihdetuksi/ei-vaihdetuksi, valinnaisesti kenen puolesta
   *  (johtaja voi valita tekijän — sama kuva kuin ikkunan "kuka pesi"). */
  onSetLampStatus?: (key: string, status: LampStatus, changedById?: string) => void;
  /** Lampun avain → toimiiko se. Puuttuva merkintä = ei tarkastettu. */
  lampConditions?: Record<string, LampCondition>;
  /** Lampun avain → huomautus. */
  lampNotes?: Record<string, ProjFixtureNote>;
  /** Aseta lampun kunto; `null` palauttaa "ei tarkastettu" -tilaan. */
  onSetLampCondition?: (key: string, condition: LampCondition | null) => void;
  /** Kirjoita/tyhjennä lampun huomautus. Tyhjä teksti poistaa huomautuksen. */
  onSetLampNote?: (key: string, text: string) => void;
  /**
   * OVET — sama kevyt malli kuin lampuilla, mutta piste on tehtävä: se on joko
   * tekemättä tai tehty, ja sillä voi olla lyhyt tehtävänimi. Kaikki
   * valinnaisia — ilman `doors`-proppia ovikerros ei piirry lainkaan.
   */
  doors?: Record<string, ProjDoorMark[]>;
  doorStatuses?: Record<string, DoorStatus>;
  /** Oven avain → tekijän id joka merkitsi sen tehdyksi. */
  doorDoneBy?: Record<string, string>;
  doorNotes?: Record<string, ProjFixtureNote>;
  /** Lisää uusi ovi kartalle (johtaja). Puuttuessaan "Ovi" ei näy lisäysvalikossa. */
  onAddDoor?: (floor: string, x: number, y: number) => void;
  onDeleteDoor?: (key: string) => void;
  onSetDoorStatus?: (key: string, status: DoorStatus, doneById?: string) => void;
  onSetDoorNote?: (key: string, text: string) => void;
  /** Oven lyhyt tehtävänimi, esim. "karmit + lasi". */
  onSetDoorLabel?: (key: string, label: string) => void;
}

/**
 * Huomautuslohko lamppu- ja ovipopovereihin.
 *
 * Sama pieni tilakone molemmille: katselutila näyttää tekstin, kirjoittajan ja
 * ajan; napautus avaa tekstikentän. `draft === null` on katselutila, jotta
 * tyhjäksi pyyhitty teksti (= poista huomautus) eroaa "ei muokkauksessa"
 * -tilasta.
 */
function FixtureNoteBlock({ note, draft, setDraft, onSave, canWrite, workerNames, placeholder }: {
  note?: ProjFixtureNote;
  draft: string | null;
  setDraft: (v: string | null) => void;
  onSave: () => void;
  canWrite: boolean;
  workerNames?: Record<string, string>;
  placeholder: string;
}) {
  const editing = draft !== null;
  return (
    <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Huomautus</div>
      {editing ? (
        <>
          <textarea
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_FIXTURE_NOTE_LEN))}
            placeholder={placeholder}
            autoFocus
            rows={3}
            style={{ width: "100%", resize: "none", padding: "8px 10px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "12.5px", outline: "none", fontFamily: "var(--font-onest, system-ui, sans-serif)", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: "7px", marginTop: "8px" }}>
            <button onClick={() => setDraft(null)} style={{ padding: "7px 11px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.7)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Peru</button>
            <button onClick={onSave} style={{ flex: 1, padding: "7px 11px", borderRadius: "9px", border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
              {draft!.trim() ? "Tallenna" : "Poista huomautus"}
            </button>
          </div>
        </>
      ) : note?.text ? (
        <div>
          <div style={{ fontSize: "12.5px", lineHeight: 1.45, color: "rgba(255,255,255,0.88)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{note.text}</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px", fontSize: "10.5px", color: "rgba(255,255,255,0.42)" }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {note.by ? (workerNames?.[note.by] ?? note.by) : "—"}{note.ts ? ` · ${fixtureAgo(note.ts)}` : ""}
            </span>
            {canWrite && (
              <button onClick={() => setDraft(note.text)} style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(156,193,255,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Muokkaa</button>
            )}
          </div>
        </div>
      ) : canWrite ? (
        <button className="status-opt-btn" onClick={() => setDraft("")} style={{ color: "rgba(255,255,255,0.78)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M12 5v14M5 12h14" /></svg>
          <span style={{ flex: 1, textAlign: "left" }}>Lisää huomautus</span>
        </button>
      ) : (
        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", padding: "0 4px" }}>Ei huomautusta.</div>
      )}
    </div>
  );
}

/** A minimal on-screen anchor (viewport coords) for positioning a fixed popover. */
interface Anchor { left: number; top: number; width: number; bottom: number; }
function rectToAnchor(r: DOMRect): Anchor { return { left: r.left, top: r.top, width: r.width, bottom: r.bottom }; }
function pointAnchor(x: number, y: number): Anchor { return { left: x - 8, top: y - 8, width: 16, bottom: y + 8 }; }

/** Position a fixed popover near an on-screen anchor rect, flipping above/below
 *  and clamping to the viewport so its buttons are always fully visible/tappable. */
function fixedPopoverStyle(anchor: Anchor | null, width: number, height: number): React.CSSProperties {
  if (typeof window === "undefined" || !anchor) {
    return { position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: 1200 };
  }
  const margin = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = anchor.left + anchor.width / 2 - width / 2;
  left = Math.max(margin, Math.min(vw - width - margin, left));
  // Prefer above the anchor; flip below if there isn't room.
  let top = anchor.top - height - 12;
  if (top < margin) top = Math.min(vh - height - margin, anchor.bottom + 12);
  top = Math.max(margin, top);
  return { position: "fixed", left: `${left}px`, top: `${top}px`, zIndex: 1200 };
}

function colorRgb(p: 1 | 2, status: WindowStatus) {
  if (status === "pesty") return p === 1 ? "255,72,72" : "255,205,40";
  if (status === "kesken") return "188,150,255";
  return p === 1 ? "255,140,178" : "240,226,150";
}

function fmt(n: number) { return Math.round(n).toLocaleString("fi-FI"); }
function euro(n: number) { return n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
/** Per-window price — keeps cents (e.g. "37,50 €") so 37.5 never rounds to 38. */
function euroUnit(n: number) {
  return n.toLocaleString("fi-FI", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + " €";
}

/** Count live (non-deleted) windows across every floor — the billable window
 *  count that drives the contract cap (count × price/window). */
function countAllLive(floors: string[], marks: ProjMarksData | null, customMarks: Record<string, ProjCustomMark[]>, deleted: Record<string, boolean>, onlyPriority?: 1 | 2): number {
  let n = 0;
  for (const f of floors) {
    (marks?.[f]?.marks || []).forEach((mk, idx) => { if (!deleted[`${f}#${idx}`] && (!onlyPriority || mk.p === onlyPriority)) n += 1; });
    (customMarks[f] || []).forEach((cm) => { if (!deleted[cm.key] && (!onlyPriority || cm.p === onlyPriority)) n += 1; });
  }
  return n;
}

function getPoints(floor: string, marks: ProjMarksData | null, posOverrides: Record<string, { x: number; y: number }>, customMarks: Record<string, ProjCustomMark[]>, deleted: Record<string, boolean>): Point[] {
  const out: Point[] = [];
  if (!marks) return out;
  (marks[floor]?.marks || []).forEach((mk, idx) => {
    const key = `${floor}#${idx}`;
    if (deleted[key]) return;
    const ov = posOverrides[key];
    out.push({ key, p: mk.p, x: ov ? ov.x : mk.x, y: ov ? ov.y : mk.y });
  });
  (customMarks[floor] || []).forEach((cm) => {
    if (deleted[cm.key]) return;
    const ov = posOverrides[cm.key];
    out.push({ key: cm.key, p: cm.p, x: ov ? ov.x : cm.x, y: ov ? ov.y : cm.y });
  });
  return out;
}

function floorBtnStyle(active: boolean): React.CSSProperties {
  return { minWidth: "34px", height: "34px", padding: "0 4px", borderRadius: "9px", border: "none", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "14px", fontWeight: active ? 700 : 600, background: active ? "#fff" : "transparent", color: active ? "#0a0a0c" : "rgba(255,255,255,0.55)", transition: "all .16s" };
}

/** Kerroksen pitkä nimi. Jaettu `floorLabel` hoitaa myös `unitWord`in, jotta
 *  yhden huoneen keikalla ei lue "1. kerros". */
function floorLongName(floor: string, building?: ProjBuilding | null): string {
  return floorLabel(building ?? null, floor);
}

function floorShortName(floor: string, building?: ProjBuilding | null): string {
  const word = building?.unitWord?.trim();
  if (word) return (building?.floors?.length ?? 0) > 1 ? `${word} ${floor}` : word;
  return floor === "K" ? "kellari" : `krs ${floor}`;
}

function filterBtnStyle(active: boolean): React.CSSProperties {
  return { padding: "7px 13px", borderRadius: "10px", border: "none", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: active ? 600 : 500, background: active ? "rgba(255,255,255,0.92)" : "transparent", color: active ? "#0a0a0c" : "rgba(255,255,255,0.55)", transition: "all .15s" };
}

const zoomBtnStyle: React.CSSProperties = {
  width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: "8px", border: "none", cursor: "pointer", background: "transparent",
  color: "rgba(255,255,255,0.75)", fontSize: "16px", fontWeight: 600, lineHeight: 1,
  fontFamily: "var(--font-onest, system-ui, sans-serif)",
};

const LEGEND = [
  { label: "P1 pesemättä", rgb: "255,140,178" }, { label: "P2 pesemättä", rgb: "240,226,150" },
  { label: "Kesken", rgb: "188,150,255" }, { label: "P1 pesty", rgb: "255,72,72" }, { label: "P2 pesty", rgb: "255,205,40" },
];

const FILTERS = [
  { id: "all", label: "Kaikki" }, { id: "unwashed", label: "Pesemättä" },
  { id: "progress", label: "Kesken" }, { id: "done", label: "Pesty" },
] as const;

type PlaceMode = 1 | 2 | "del";
const ADD_ITEMS: { id: PlaceMode; label: string; desc: string; dotBg: string; glyph: string }[] = [
  { id: 1, label: "Punainen piste", desc: "Prioriteetti 1", dotBg: "radial-gradient(circle at 35% 30%, #fff, rgb(255,140,178) 55%)", glyph: "" },
  { id: 2, label: "Keltainen piste", desc: "Prioriteetti 2", dotBg: "radial-gradient(circle at 35% 30%, #fff, rgb(240,226,150) 55%)", glyph: "" },
  { id: "del", label: "Poista piste", desc: "Klikkaa poistettavaa", dotBg: "rgba(255,90,90,0.16)", glyph: "✕" },
];

export default function FloorView({ floors, planBase, building, planUrlBase, planAuthed = false, pricePerWindow, marks, statuses, posOverrides, customMarks, deleted, initialFloor, onStatusChange, onAddCustomMark, onDeleteMark, onMoveMark, onMoveMarkCommit, onResetFloor, canEdit = true, canAddNotes = false, hideMoney = false, washedBy, washedBy2, onSetSplit, keskenBy, workerNames, workers, currentWorkerId, notes, onAddNote, onUpdateNote, onDeleteNote, observations, canObserve = false, onSetObservation, onLoadObservationImage, activeZone, onSetActiveZone, onClearActiveZone, deal, p2, onP2Propose, scopeVotes, guided, onToggleFloorLock, onToggleWindowLock, lockedWindowKeys, floorFocus, restrictFloors, lamps, lampStatuses, lampChangedBy, onAddLamp, onDeleteLamp, onSetLampStatus, lampConditions, lampNotes, onSetLampCondition, onSetLampNote, doors, doorStatuses, doorDoneBy, doorNotes, onAddDoor, onDeleteDoor, onSetDoorStatus, onSetDoorNote, onSetDoorLabel }: Props) {
  // Discreet worker map: when restrictFloors is set, show ONLY those floors and
  // hide the rest, so a regular worker sees exactly the opened floors and nothing
  // else. Founders (restrictFloors null) always see every floor.
  const shownFloors = (restrictFloors && restrictFloors.length)
    ? floors.filter((f) => restrictFloors.includes(f))
    : floors;
  // Pohjakuva: LADATTU kuva voittaa staattisen polun. `planImageUrl` on jaettu,
  // joten admin, tekijä ja asiakas päättelevät osoitteen samalla säännöllä.
  const planBuilding = building ?? { floors, planBase };
  // Valokuva/ruudunkaappaus näytetään sellaisenaan: FR8:n `invert(1)` ja 2 %
  // reunarajaus ovat oikein vain vaalealle viivapiirrokselle.
  const isPhoto = planRenderOf(planBuilding) === "photo";
  const planCrop = isPhoto ? "none" : PLAN_CROP;
  const [floor, setFloor] = useState(() =>
    (restrictFloors && restrictFloors.length && !restrictFloors.includes(initialFloor))
      ? (floors.find((f) => restrictFloors.includes(f)) ?? initialFloor)
      : initialFloor);

  /**
   * Kerroksen pohjakuvan osoite ja siitä johdettu näytettävä `src`.
   *
   * Adminin reitti on Bearer-tokenin takana, joten sen kuva haetaan fetchillä ja
   * näytetään object-URLina (`useAuthedImage`). Julkiset reitit ja staattinen
   * `planBase` menevät suoraan.
   */
  const planHref = planImageUrl(planBuilding, floor, planUrlBase);
  const authedPlan = useAuthedImage(planAuthed ? planHref : null);
  const planSrc = planAuthed ? authedPlan.src : planHref;
  const [filter, setFilter] = useState<"all" | "unwashed" | "progress" | "done">("all");
  /**
   * KERROKSET (näytettävät merkkilajit).
   *
   * Kartalla on nyt neljä merkkilajia päällekkäin, ja niiden yhteinen tiheys
   * on se mikä tekee uuden pisteen osumasta vaikeaa. Tämä on tavallinen
   * karttatasojen näkyvyys: valitse mitä katsot. EI suodatin tilan päälle —
   * `filter` hoitaa ikkunan pesutilan, tämä hoitaa merkkilajin.
   *
   * Ei tallenneta selaimeen: piilotettu taso jonka on unohtanut piilottaneensa
   * näyttää rikkinäiseltä kartalta seuraavalla käynnillä. Palkin nappi kertoo
   * aina kun jotain on piilossa.
   */
  const [layers, setLayers] = useState({ p1: true, p2: true, lamps: true, doors: true, notes: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const layersHidden = Object.values(layers).filter((v) => !v).length;
  const [editMode, setEditMode] = useState(false);
  const [placeMode, setPlaceMode] = useState<1 | 2 | "del" | "note" | "zone" | "lamp" | "door" | null>(null);
  const [noteKind, setNoteKind] = useState<ProjNoteKind>("ladder");
  const [dragging, setDragging] = useState<string | null>(null);
  const [activeOrb, setActiveOrb] = useState<string | null>(null);
  const [orbAnchor, setOrbAnchor] = useState<Anchor | null>(null);
  const [showWasherPicker, setShowWasherPicker] = useState(false);
  const [showSplitPicker, setShowSplitPicker] = useState(false);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [noteAnchor, setNoteAnchor] = useState<Anchor | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  // Lamppu-popover (tila + kuka vaihtoi + poisto) — sama malli kuin muistiinpanoilla.
  const [activeLamp, setActiveLamp] = useState<string | null>(null);
  const [lampAnchor, setLampAnchor] = useState<Anchor | null>(null);
  const [showLampChangerPicker, setShowLampChangerPicker] = useState(false);
  // Huomautusluonnos: `null` = katselutila, merkkijono = kirjoitustila. Tyhjä
  // merkkijono on siis eri asia kuin ei-muokkauksessa, joten null on oikea tyhjä.
  const [lampNoteDraft, setLampNoteDraft] = useState<string | null>(null);
  // Ovi-popover — sama malli kuin lampulla, plus tehtävänimen muokkaus.
  const [activeDoor, setActiveDoor] = useState<string | null>(null);
  const [doorAnchor, setDoorAnchor] = useState<Anchor | null>(null);
  const [showDoorDonePicker, setShowDoorDonePicker] = useState(false);
  const [doorNoteDraft, setDoorNoteDraft] = useState<string | null>(null);
  const [doorLabelDraft, setDoorLabelDraft] = useState<string | null>(null);
  // Per-window observation editor (text + optional photo) inside the status popover.
  const [obsDraft, setObsDraft] = useState("");
  const [obsImage, setObsImage] = useState<string | undefined>(undefined);
  // Onko kuva jo kädessä? "loading" = havainnossa on kuva mutta sitä vasta
  // haetaan. Tämä on eri asia kuin `obsImage === undefined`, joka tarkoittaa
  // myös "ei kuvaa" ja "käyttäjä poisti kuvan" — ilman erottelua tallennus
  // lähettäisi latauksen aikana `undefined`in ja PYYHKISI palvelimen kuvan.
  const [obsImageState, setObsImageState] = useState<"none" | "loading" | "ready">("none");
  // Viimeisimmän kuvapyynnön ikkuna — vanhentunut vastaus ei saa ylikirjoittaa
  // jo vaihdettua editoria.
  const obsReqRef = useRef<string | null>(null);
  // "Havainnossa on kuva" — myös silloin kun sitä vielä ladataan. Käyttöliittymä
  // ei siis tarjoa "+ Kuva" -nappia päälle latautuvan kuvan.
  const obsHasPhoto = !!obsImage || obsImageState === "loading";
  const [obsBusy, setObsBusy] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // P2 multi-select pricing (admin): tap yellow dots to select, then propose one
  // price for the whole selection.
  const [p2SelectMode, setP2SelectMode] = useState(false);
  const [p2Selected, setP2Selected] = useState<Set<string>>(new Set());
  const [p2Note, setP2Note] = useState("");
  // Ikkunakohtainen HINTAperustelu. Nimet erottuvat kartan omista
  // muistiinpanoista (noteDraft), jotka ovat eri asia: ne koskevat paikkaa,
  // tämä koskee hintaa ja näkyy asiakkaalle hyväksynnän yhteydessä.
  const [priceNoteFor, setPriceNoteFor] = useState<string | null>(null);
  const [priceNoteDraft, setPriceNoteDraft] = useState("");
  const [p2Price, setP2Price] = useState("");
  const planRef = useRef<HTMLImageElement>(null);
  const notesCanEdit = !!onAddNote;
  const zoneCanEdit = !!onSetActiveZone;
  const lampsCanEdit = !!onAddLamp;
  const doorsCanEdit = !!onAddDoor;
  const dragKeyRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const isMobile = useIsMobile();

  // Zoom & pan (so tiny dots are tappable on phones). The plan + orbs share one
  // transformed wrapper, so the dot %-coordinate math (which reads the image's
  // post-transform rect) stays correct at any zoom.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const sceneRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const pannedRef = useRef(false);
  const clampZoom = (z: number) => Math.min(5, Math.max(1, z));

  // Keep the plan from being dragged past its own edges, so the hard edge lines /
  // background gaps never appear at the sides when zoomed. Pan is bounded to the
  // overflow of the scaled image over the visible scene; when the image is not
  // larger than the scene it stays locked to centre.
  const clampPan = (p: { x: number; y: number }, z: number) => {
    const scene = sceneRef.current, img = planRef.current;
    if (!scene || !img) return p;
    const maxX = Math.max(0, (img.offsetWidth * z - scene.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * z - scene.clientHeight) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  };
  const zoomBy = (factor: number) => setZoom((z) => {
    const nz = clampZoom(z * factor);
    setPan((p) => (nz === 1 ? { x: 0, y: 0 } : clampPan(p, nz)));
    return nz;
  });
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Reset zoom/pan when switching floors.
  useEffect(() => { resetView(); }, [floor]);

  // Keep the viewed floor within the opened set for a restricted (worker) map —
  // if the founder changes which floors are open, snap to the first open floor.
  useEffect(() => {
    if (restrictFloors && restrictFloors.length && !restrictFloors.includes(floor)) {
      const first = floors.find((f) => restrictFloors.includes(f));
      if (first) setFloor(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restrictFloors?.join(",")]);

  // Ohjattu eteneminen: kun "Vie minut seuraavaan" -nappia painetaan (nonce
  // kasvaa), hypätään aktiiviselle kerrokselle ja suljetaan avoin popover.
  useEffect(() => {
    if (floorFocus && floorFocus.floor && floors.includes(floorFocus.floor)) {
      setFloor(floorFocus.floor);
      // Avaimella hypätään suoraan siihen ikkunaan: listasta klikattu rivi
      // avaa sen tiedot kartalla, jolloin sen voi tarkistaa paikan päältä.
      setActiveOrb(floorFocus.key ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorFocus?.nonce]);

  function touchDist(t: React.TouchList) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }
  function onSceneWheel(e: React.WheelEvent) {
    /**
     * LISÄYSTILASSAKIN SAA ZOOMATA JA LIIKUTTAA KARTTAA.
     *
     * Nämä käsittelijät palasivat ennen heti kun `editMode` oli päällä, joten
     * kartta jäätyi juuri silloin kun sitä eniten tarvitsee liikuttaa: pisteitä
     * lisätään huonetarkkuudella, eikä pientä huonetta voi osua tarkasti jos
     * siihen ei pääse lähemmäs. Asiakaskartalla tämä oli jo korjattu samasta
     * syystä (`CustomerFloorMap`), mutta adminin kartta jäi jälkeen.
     *
     * Vahinkopisteet estää `pannedRef`: veto on veto, ei napautus (ks.
     * `onPlanClick`).
     */
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }
  function onSceneTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) { pinchRef.current = touchDist(e.touches); panRef.current = null; }
    else if (e.touches.length === 1 && zoom > 1) {
      const p = e.touches[0];
      panRef.current = { x: p.clientX, y: p.clientY, px: pan.x, py: pan.y };
      pannedRef.current = false;
    }
  }
  function onSceneTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current != null) {
      e.preventDefault();
      const d = touchDist(e.touches);
      zoomBy(d / pinchRef.current);
      pinchRef.current = d;
    } else if (panRef.current && e.touches.length === 1) {
      e.preventDefault();
      const p = e.touches[0];
      setPan(clampPan({ x: panRef.current.px + (p.clientX - panRef.current.x), y: panRef.current.py + (p.clientY - panRef.current.y) }, zoom));
      pannedRef.current = true;
    }
  }
  function onSceneTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 0) { pinchRef.current = null; panRef.current = null; }
  }

  const lockedKeySet = useMemo(() => new Set(lockedWindowKeys ?? []), [lockedWindowKeys]);
  /** Piilotettuja TÄLLÄ kerroksella — kerrosrivin oma luku. */
  const lockedOnFloor = useMemo(
    () => getPoints(floor, marks, posOverrides, customMarks, deleted).filter((pt) => lockedKeySet.has(pt.key)).length,
    [floor, marks, posOverrides, customMarks, deleted, lockedKeySet],
  );
  const allFloorPoints = getPoints(floor, marks, posOverrides, customMarks, deleted);
  // TEKIJÄLTÄ LUKITTU IKKUNA EI OLE OLEMASSA. Johtaja näkee sen himmeänä ja
  // lukkomerkillä (hän on se joka sen lukitsi), tekijältä se katoaa kartalta
  // kokonaan — muuten se olisi piste jota ei voi painaa, ja se näyttäisi
  // rikkinäiseltä sovellukselta eikä päätökseltä.
  const points = onToggleWindowLock
    ? allFloorPoints
    : allFloorPoints.filter((pt) => !lockedKeySet.has(pt.key));
  /**
   * NÄKYVÄT pisteet. Kerrosvalinta (`layers`) koskee VAIN piirtoa: kaikki
   * laskurit alla käyttävät yhä `points`ia, joten palkin luvut eivät muutu kun
   * jokin taso piilotetaan. Piilotettu taso on katselusuodatin, ei tila.
   */
  const visiblePoints = points.filter((pt) => (pt.p === 1 ? layers.p1 : layers.p2));

  /**
   * PAIKANNUSFOKUS. Uuden pisteen osuminen oikeaan kohtaan on vaikeaa kun
   * kartalla on jo satoja merkkejä päällekkäin. Kun jotain lisätään, kaikki
   * MUUT merkkilajit himmenevät pois tieltä ja lakkaavat ottamasta
   * napautuksia vastaan — pohjapiirros jää näkyviin, merkit eivät ole tiellä.
   * Poistotila (`del`) on tarkoituksella ulkopuolella: siinä pitää nähdä ja
   * osua kaikkeen.
   */
  const placingLayer: "window" | "lamp" | "door" | "note" | null =
    placeMode === 1 || placeMode === 2 ? "window"
    : placeMode === "lamp" ? "lamp"
    : placeMode === "door" ? "door"
    : placeMode === "note" ? "note"
    : null;
  const dimOther = (layer: "window" | "lamp" | "door" | "note"): React.CSSProperties | null =>
    placingLayer && placingLayer !== layer
      ? { opacity: 0.1, pointerEvents: "none", transition: "opacity .18s" }
      : null;

  // Keltaisten numerot samasta funktiosta kuin asiakkaan näkymä ja laskun
  // erittely — kartta ei laske niitä omalla tavallaan.
  const p2Numbers = useMemo(
    () => p2NumbersByFloor({ building: { floors }, marks, customMarks, deleted, statuses, washedBy } as unknown as P2NumberingInput),
    [floors, marks, customMarks, deleted, statuses, washedBy],
  );
  // Ohjatun etenemisen ehdottama seuraava ikkuna, jos se on TÄLLÄ kerroksella.
  // `nextKey` on muotoa "<kerros>#<n>", joten kerrosvaihto piilottaa renkaan
  // itsestään eikä sitä tarvitse erikseen tyhjentää.
  const guidedNextPoint = guided?.nextKey
    ? points.find((p) => p.key === guided.nextKey) ?? null
    : null;

  // ── P2 (keltaiset ikkunat) helpers ──────────────────────────────────────────
  const p2OfferFor = (key: string): P2Offer | undefined => p2?.offers?.[key];
  /** Has the customer AGREED this yellow window's price? Admin resolves from the
   *  offers map, the worker from its lockedKeys list.
   *
   *  HUOM: tämä ei estä pesua. Kaikki keltaiset ovat pestävissä — hyväksyntä
   *  vaikuttaa vain väriin (hyväksytty = keltainen, odottava = sininen) ja rahaan. */
  const p2Agreed = (key: string): boolean => {
    if (!p2 || !p2.enabled) return false;
    if (p2.offers) return p2.offers[key]?.status === "locked";
    return (p2.lockedKeys || []).includes(key);
  };
  /** Keltainen jota asiakas ei ole vielä hyväksynyt → SININEN. Tekijän näkymässä
   *  kaikki keltaiset ovat keltaisia (hän pesee ne kaikki eikä näe hintoja). */
  const p2AwaitingCustomer = (pt: Point): boolean =>
    canEdit && !!p2?.enabled && pt.p === 2 && !p2Agreed(pt.key);
  const floorYellowUnpriced = points.filter((pt) => pt.p === 2 && !p2OfferFor(pt.key));
  const p2PriceCents = (() => {
    const v = Number(p2Price.replace(",", "."));
    return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  })();

  function toggleP2Select(key: string) {
    setP2Selected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleP2SelectMode() {
    setP2SelectMode((v) => !v);
    setP2Selected(new Set());
    setEditMode(false); setPlaceMode(null); setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null);
  }

  // KERROKSEN YMPYRÄ LASKEE KAIKKI PISTEET, EI VAIN PUNAISIA.
  // Rengas näytti "74/74 pesty · 100 %" kerroksessa jossa oli silminnähden
  // pesemättömiä keltaisia — koska se laski vain sopimuksen (punaiset). Kartta
  // on kuva siitä mitä kerroksessa on, joten sen mittarin on vastattava
  // pisteitä jotka samalla ruudulla näkyvät. Raha lasketaan yhä sopimuksesta.
  const floorWashed = points.filter((p) => (statuses[p.key] || "ei") === "pesty").length;
  const floorTotal = points.length;
  const floorPct = floorTotal > 0 ? (floorWashed / floorTotal) * 100 : 0;
  // Keltaiset erikseen: kokonaisluku ei kerro kumpaa väriä siinä on, ja kun
  // käsin laskettu määrä ei täsmää, ero etsitään nimenomaan keltaisista.
  const floorYellow = points.filter((p) => p.p === 2);
  const floorYellowWashed = floorYellow.filter((p) => (statuses[p.key] || "ei") === "pesty").length;
  // Rahaluku pysyy sopimuksen piirissä: € tulee punaisista, ei kaikista.
  const floorBillable = deal ? points.filter((p) => p.p === deal.billablePriority) : points;
  // Whole-contract billable window count (every floor) → drives the price cap.
  const totalLive = countAllLive(floors, marks, customMarks, deleted, deal?.billablePriority);
  // A signed deal has a fixed agreed cap; an open gig's cap is count × price.
  const capEur = deal ? deal.capCents / 100 : totalLive * pricePerWindow;
  const activePt = activeOrb ? points.find((p) => p.key === activeOrb) ?? null : null;
  const activeIdx = activePt ? points.indexOf(activePt) : -1;

  /**
   * IKKUNAN NIMI KARTALLA.
   *
   * Keltainen saa saman numeron kuin asiakkaan näkymässä ja laskun erittelyssä
   * (`p2NumbersByFloor`), eli kerroksen keltaisista juoksevan. Ennen kartta
   * laski kaikki pisteet, joten sama ikkuna oli listassa "ikkuna 7" ja kartalla
   * "ikkuna 41" — kahdella nimellä ei voi tarkistaa mitään.
   *
   * Punaisten numerointi jätetään ennalleen (kerroksen kaikkien pisteiden
   * juokseva numero), koska tekijät ovat tottuneet siihen. Väri on nyt
   * nimessä, joten kahta numerointia ei voi enää sekoittaa keskenään.
   */
  function labelFor(pt: { key: string; p: 1 | 2 }): string {
    if (pt.p === 2) return `Keltainen ${p2Numbers[pt.key] ?? "?"}`;
    return `Ikkuna ${points.findIndex((q) => q.key === pt.key) + 1}`;
  }
  const floorNotes = notes?.[floor] || [];
  const activeNoteObj = activeNote ? floorNotes.find((n) => n.key === activeNote) ?? null : null;
  const lampPts: ProjLampMark[] = lamps?.[floor] || [];
  const activeLampPt = activeLamp ? lampPts.find((l) => l.key === activeLamp) ?? null : null;
  /**
   * TÄMÄN KERROKSEN lamppujakauma. Sama neljän ämpärin sääntö kuin raportissa
   * (`lampBucket`), jottei kartta ja dash voi olla eri mieltä samasta
   * kerroksesta. Näkyy palkissa sirunä, koska "montako tästä kerroksesta vielä
   * puuttuu" on se kysymys joka syntyy juuri kun karttaa katsotaan.
   */
  const floorLamps = useMemo(() => {
    const pts = lamps?.[floor] || [];
    const tally = { total: pts.length, changed: 0, broken: 0, working: 0, unchecked: 0 };
    for (const l of pts) {
      const b = lampBucket({
        floor, key: l.key, x: l.x, y: l.y,
        status: lampStatuses?.[l.key] || "ei",
        condition: lampConditions?.[l.key],
      });
      if (b === "vaihdettu") tally.changed += 1;
      else if (b === "rikki") tally.broken += 1;
      else if (b === "toimiva") tally.working += 1;
      else tally.unchecked += 1;
    }
    return tally;
  }, [lamps, lampStatuses, lampConditions, floor]);

  const doorPts: ProjDoorMark[] = doors?.[floor] || [];
  const activeDoorPt = activeDoor ? doorPts.find((d) => d.key === activeDoor) ?? null : null;

  function matchFilter(status: WindowStatus) {
    if (filter === "all") return true;
    if (filter === "unwashed") return status === "ei";
    if (filter === "progress") return status === "kesken";
    if (filter === "done") return status === "pesty";
    return true;
  }

  function orbStyle(pt: Point, status: WindowStatus, isDragging: boolean): React.CSSProperties {
    // Perustajan kartalla keltainen, jota asiakas ei ole hyväksynyt, on SININEN —
    // näkee heti mikä on sovittua ja mikä ei. Silti pestävissä normaalisti.
    //
    // VÄRIPARIN PITÄÄ EROTTUA. Punaisella (255,140,178 → 255,72,72) ja
    // keltaisella (240,226,150 → 255,205,40) pesty on selvästi kylläisempi
    // kuin pesemätön. Sinisellä pari oli 150,175,255 → 120,150,255, eli
    // käytännössä sama väri hitusen tummempana: tekijä merkitsi ikkunan
    // pestyksi eikä nähnyt tapahtuiko mitään. Nyt sininen noudattaa samaa
    // sääntöä kuin muut — vaalea ja haalistunut kun pesemätön, kylläinen
    // kun pesty.
    const rgb = p2AwaitingCustomer(pt)
      ? (status === "pesty" ? "48,124,255" : "175,195,245")
      : colorRgb(pt.p, status);
    const washed = status === "pesty";
    const soft = status === "ei";
    const delMode = editMode && placeMode === "del";
    const addMode = editMode && (placeMode === 1 || placeMode === 2);
    const dim = editMode ? false : !matchFilter(status);
    // P2 select mode: red dots fade out, selected yellows get a white ring.
    const p2Selectable = p2SelectMode && pt.p === 2;
    const p2IsSelected = p2Selectable && p2Selected.has(pt.key);
    // Pesty on selvästi isompi. 10 vs 9 px oli ero jota ei huomannut
    // puhelimella lainkaan; 12 vs 9 näkyy vilkaisulla.
    const size = editMode ? (washed ? 14 : 12) : (washed ? 12 : 9);
    const base: React.CSSProperties = {
      position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
      transform: "translate(-50%,-50%)", width: `${size}px`, height: `${size}px`,
      borderRadius: "50%", padding: 0,
      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(${rgb},0.95) 45%, rgba(${rgb},0.72))`,
      border: editMode ? "1.5px solid rgba(255,255,255,0.9)" : "1px solid rgba(255,255,255,0.45)",
      color: `rgba(${rgb},0.9)`,
      cursor: delMode ? "pointer" : (editMode ? (isDragging ? "grabbing" : "grab") : "pointer"),
      zIndex: isDragging ? 35 : (dim ? 2 : 6),
      opacity: dim ? 0.08 : 1,
      pointerEvents: (dim || addMode) ? "none" : "auto",
      touchAction: "none",
      transition: isDragging ? "none" : "opacity .3s, transform .15s, box-shadow .2s",
    };
    // The pulsing glow is pretty on desktop but murders phone performance: an
    // FR8 floor has hundreds of unwashed dots, and that many infinite CSS
    // animations inside a scaled/panned layer makes the whole PWA stutter. On
    // mobile we use a static glow instead — smooth scrolling beats a pulse.
    if (soft && !editMode && !isMobile) {
      base.animation = "fr8-orbPulse 3.2s ease-in-out infinite";
    } else {
      // PESTYLLÄ ON VALKOINEN RENGAS. Väri yksin ei riitä: kartta on tumma,
      // pisteitä on satoja, ja osa väripareista on väistämättä lähellä
      // toisiaan. Rengas on väristä riippumaton merkki "tämä on tehty" — se
      // erottuu myös sinisellä, myös pienellä ruudulla ja myös silloin kun
      // katsoja ei erota värisävyjä.
      base.boxShadow = isDragging
        ? `0 0 0 3px rgba(255,255,255,0.35), 0 0 14px rgba(${rgb},0.9)`
        : washed
          ? `0 0 0 1.5px rgba(255,255,255,0.9), 0 0 7px rgba(${rgb},0.95), 0 0 14px rgba(${rgb},0.55)`
          : `0 0 5px rgba(${rgb},0.7), 0 0 11px rgba(${rgb},0.35)`;
    }
    // P2 select mode overrides: fade the non-selectable reds, ring the selection.
    if (p2SelectMode) {
      if (pt.p !== 2) {
        base.opacity = 0.12;
        base.pointerEvents = "none";
        base.animation = undefined;
      } else if (p2IsSelected) {
        base.boxShadow = `0 0 0 3.5px rgba(255,255,255,0.95), 0 0 14px rgba(${rgb},0.9)`;
        base.animation = undefined;
        base.zIndex = 12;
      }
    }
    return base;
  }

  function onOrbClick(pt: Point, e: React.MouseEvent) {
    e.stopPropagation();
    // Ignore the click that ends a pan gesture (so panning never toggles a dot).
    if (pannedRef.current) { pannedRef.current = false; return; }
    // P2 pricing mode: tapping a yellow dot toggles its selection (locked ones
    // are skipped — a locked price is renegotiated via unlock, not re-propose).
    if (p2SelectMode) {
      if (pt.p !== 2) return;
      if (p2OfferFor(pt.key)?.status === "locked") return;
      toggleP2Select(pt.key);
      return;
    }
    if (editMode && placeMode === "del") { onDeleteMark(pt.key); return; }
    if (!editMode) {
      const next = activeOrb === pt.key ? null : pt.key;
      // Capture the dot's on-screen position so the status popover renders as a
      // fixed overlay (never clipped by the zoom/pan scene) and stays tappable.
      setOrbAnchor(next ? rectToAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) : null);
      setActiveNote(null);
      setActiveLamp(null); setActiveDoor(null); setLampAnchor(null);
      setShowWasherPicker(false); // names stay hidden until "Vaihda" is tapped
      setShowSplitPicker(false);
      // Load any existing observation for this window into the editor. Kuva tulee
      // palvelimelta vasta pyynnöstä (`hasImage`), joten se haetaan tässä — vain
      // tälle yhdelle ikkunalle, ei koko kerrokselle.
      const ex = next ? observations?.[next] : undefined;
      obsReqRef.current = next;
      setObsDraft(ex?.text ?? "");
      setObsImage(ex?.imageDataUrl);
      if (ex?.imageDataUrl) setObsImageState("ready");
      else if (next && ex?.hasImage && onLoadObservationImage) {
        setObsImageState("loading");
        void onLoadObservationImage(next).then((url) => {
          // Ikkuna on voitu vaihtaa latauksen aikana — älä sotke uutta editoria.
          if (obsReqRef.current !== next) return;
          setObsImage(url);
          setObsImageState(url ? "ready" : "none");
        }).catch(() => { if (obsReqRef.current === next) setObsImageState("none"); });
      } else setObsImageState("none");
      setObsOpen(!!ex);
      setActiveOrb(next);
    }
  }

  // Downscale + compress a picked photo to a small data URL (kept inside the
  // project JSON). Targets ≤ ~0.5 MB so several photos never bloat the gig.
  async function pickObservationImage(file: File) {
    try {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, w, h);
      let q = 0.72;
      let url = canvas.toDataURL("image/jpeg", q);
      while (url.length > 650_000 && q > 0.4) { q -= 0.12; url = canvas.toDataURL("image/jpeg", q); }
      setObsImage(url);
    } catch {
      // Fallback: read as-is (rare; e.g. createImageBitmap unsupported).
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === "string") setObsImage(reader.result.slice(0, 650_000)); };
      reader.readAsDataURL(file);
    }
  }

  function saveObservation() {
    if (!activeOrb || !onSetObservation) return;
    // Kuva on vielä matkalla: `obsImage` olisi nyt `undefined` ja tallennus
    // pyyhkisi palvelimelta kuvan jota käyttäjä ei edes koskenut. Odota.
    if (obsImageState === "loading") return;
    setObsBusy(true);
    onSetObservation(activeOrb, obsDraft.trim(), obsImage);
    setObsBusy(false);
    setObsOpen(false);
  }

  function openNote(note: ProjMapNote, e: React.MouseEvent) {
    e.stopPropagation();
    if (pannedRef.current) { pannedRef.current = false; return; }
    if (editMode && placeMode === "del") { onDeleteNote?.(floor, note.key); return; }
    const next = activeNote === note.key ? null : note.key;
    setNoteAnchor(next ? rectToAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) : null);
    setNoteDraft(next ? (note.text || "") : "");
    setActiveOrb(null);
    setActiveLamp(null); setActiveDoor(null); setLampAnchor(null);
    setActiveNote(next);
  }

  function saveActiveNote() {
    if (activeNote) onUpdateNote?.(floor, activeNote, noteDraft.trim());
    setActiveNote(null); setNoteAnchor(null);
  }

  function deleteActiveNote() {
    if (activeNote) onDeleteNote?.(floor, activeNote);
    setActiveNote(null); setNoteAnchor(null);
  }

  /** Lampun napautus — avaa/sulkee sen popoverin. Sama ohitus kuin muillakin
   *  pisteillä: minkä tahansa lisäystilan aikana napautus ei tee mitään, jottei
   *  uuden pisteen paikannus mene tahattomasti olemassa olevan lampun päälle. */
  function onLampClick(lp: ProjLampMark, e: React.MouseEvent) {
    e.stopPropagation();
    if (pannedRef.current) { pannedRef.current = false; return; }
    if (editMode && placeMode) return;
    const next = activeLamp === lp.key ? null : lp.key;
    setLampAnchor(next ? rectToAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) : null);
    setActiveOrb(null); setOrbAnchor(null);
    setActiveNote(null); setNoteAnchor(null);
    setShowLampChangerPicker(false);
    setLampNoteDraft(null);
    setActiveDoor(null); setDoorAnchor(null);
    setActiveLamp(next);
  }

  /** Oven napautus — sama ohitussääntö kuin lampulla. */
  function onDoorClick(dr: ProjDoorMark, e: React.MouseEvent) {
    e.stopPropagation();
    if (pannedRef.current) { pannedRef.current = false; return; }
    if (editMode && placeMode) return;
    const next = activeDoor === dr.key ? null : dr.key;
    setDoorAnchor(next ? rectToAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()) : null);
    setActiveOrb(null); setOrbAnchor(null);
    setActiveNote(null); setNoteAnchor(null);
    setActiveLamp(null); setLampAnchor(null);
    setShowDoorDonePicker(false);
    setDoorNoteDraft(null); setDoorLabelDraft(null);
    setActiveDoor(next);
  }

  /** Kirjoita lampun huomautus talteen ja palaa katselutilaan. */
  function saveLampNote() {
    if (activeLamp && lampNoteDraft !== null) onSetLampNote?.(activeLamp, lampNoteDraft.slice(0, MAX_FIXTURE_NOTE_LEN));
    setLampNoteDraft(null);
  }

  function saveDoorNote() {
    if (activeDoor && doorNoteDraft !== null) onSetDoorNote?.(activeDoor, doorNoteDraft.slice(0, MAX_FIXTURE_NOTE_LEN));
    setDoorNoteDraft(null);
  }

  function saveDoorLabel() {
    if (activeDoor && doorLabelDraft !== null) onSetDoorLabel?.(activeDoor, doorLabelDraft.slice(0, MAX_DOOR_LABEL_LEN));
    setDoorLabelDraft(null);
  }

  function onOrbPointerDown(pt: Point, e: React.PointerEvent) {
    if (!canEdit || !editMode || placeMode) return;
    e.preventDefault(); e.stopPropagation();
    dragKeyRef.current = pt.key;
    movedRef.current = false; lastPosRef.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(pt.key); setActiveOrb(null);
  }

  function onOrbPointerMove(pt: Point, e: React.PointerEvent) {
    if (dragKeyRef.current !== pt.key) return;
    const img = planRef.current; if (!img) return;
    const r = img.getBoundingClientRect(); if (!r.width || !r.height) return;
    const x = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
    const y = Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100));
    const pos = { x: +x.toFixed(2), y: +y.toFixed(2) };
    movedRef.current = true; lastPosRef.current = pos;
    onMoveMark(pt.key, pos.x, pos.y);
  }

  function onOrbPointerUp(pt: Point, e: React.PointerEvent) {
    if (dragKeyRef.current !== pt.key) return;
    dragKeyRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const moved = movedRef.current; const last = lastPosRef.current;
    movedRef.current = false; lastPosRef.current = null;
    setDragging(null);
    if (moved && last) onMoveMarkCommit(pt.key, last.x, last.y);
  }

  function onPlanClick(e: React.MouseEvent) {
    // Kartan siirron päätteeksi ei synny pistettä: veto on veto. Ilman tätä
    // zoomin salliminen lisäystilassa tarkoittaisi että jokainen panorointi
    // jättää jälkeensä ylimääräisen ikkunan.
    if (pannedRef.current) { pannedRef.current = false; return; }
    const img = planRef.current; if (!img) return;
    const r = img.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 100;
    const y = (e.clientY - r.top) / r.height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    if (placeMode === "note") {
      const key = onAddNote?.(floor, +x.toFixed(2), +y.toFixed(2), noteKind);
      // Open the new note's editor immediately so the crew can type a label.
      if (typeof key === "string") {
        setActiveOrb(null);
        setNoteDraft("");
        setNoteAnchor(pointAnchor(e.clientX, e.clientY));
        setActiveNote(key);
      }
      return;
    }
    if (placeMode === "zone") {
      // One "work happening here now" highlight — placing it relocates the marker.
      onSetActiveZone?.(floor, +x.toFixed(2), +y.toFixed(2));
      setPlaceMode(null);
      return;
    }
    if (placeMode === "lamp") {
      onAddLamp?.(floor, +x.toFixed(2), +y.toFixed(2));
      return;
    }
    if (placeMode === "door") {
      onAddDoor?.(floor, +x.toFixed(2), +y.toFixed(2));
      return;
    }
    if (placeMode !== 1 && placeMode !== 2) return;
    onAddCustomMark(floor, +x.toFixed(2), +y.toFixed(2), placeMode as 1 | 2);
  }

  /** Sulje kaikki pistepopoverit. Käytössä siellä missä pisteet voivat kadota
   *  näkyvistä alta (tason piilotus) — auki jäänyt popover näyttäisi rikkinäiseltä. */
  function closeAllPopovers() {
    setActiveOrb(null); setOrbAnchor(null);
    setActiveNote(null); setNoteAnchor(null);
    setActiveLamp(null); setLampAnchor(null);
    setActiveDoor(null); setDoorAnchor(null);
  }

  function toggleEdit() {
    setEditMode((e) => !e);
    setPlaceMode(null); setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setActiveLamp(null); setActiveDoor(null); setDragging(null);
  }

  function chooseAdd(mode: 1 | 2 | "del") {
    setEditMode(true);
    setPlaceMode(placeMode === mode ? null : mode);
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setActiveLamp(null); setActiveDoor(null);
  }

  function chooseNoteKind(kind: ProjNoteKind) {
    setEditMode(true);
    setNoteKind(kind);
    setPlaceMode("note");
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setActiveLamp(null); setActiveDoor(null);
  }

  function chooseZone() {
    setEditMode(true);
    setPlaceMode("zone");
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setActiveLamp(null); setActiveDoor(null);
  }

  function chooseLamp() {
    setEditMode(true);
    setPlaceMode(placeMode === "lamp" ? null : "lamp");
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setActiveLamp(null); setActiveDoor(null);
  }

  function chooseDoor() {
    setEditMode(true);
    setPlaceMode(placeMode === "door" ? null : "door");
    setAddMenuOpen(false); setActiveOrb(null); setActiveNote(null); setActiveLamp(null); setActiveDoor(null);
  }

  // Onko juuri valittu kerros lukossa tekijöiltä? Ohjaa lukkonapin tekstin.
  const selectedFloorLocked = !!guided?.enabled && (guided.lockedFloors || []).includes(floor);

  const editBanner = placeMode === 1 ? "Lisää punaisia pisteitä — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === 2 ? "Lisää keltaisia pisteitä — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === "del" ? "Poistotila — klikkaa pisteitä tai merkintöjä jotka haluat poistaa."
    : placeMode === "note" ? `Lisää merkintä (${NOTE_KINDS[noteKind].label}) — klikkaa pohjapiirrosta. Voit kirjoittaa muistiinpanon heti.`
    : placeMode === "zone" ? "Merkitse työn alla -alue — klikkaa kohtaa, jossa juuri nyt työskennellään. Asiakas näkee tämän."
    : placeMode === "lamp" ? "Lisää lamppu — klikkaa pohjapiirrosta haluttuun kohtaan."
    : placeMode === "door" ? "Lisää ovi — klikkaa pohjapiirrosta. Ovi on tehtävä: sen voi nimetä ja kuitata tehdyksi."
    : "Muokkaustila — raahaa pisteet oikeille kohdille. Tallentuu automaattisesti.";

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>

      {/* Sub-navbar */}
      <div style={{ position: "relative", zIndex: 15, display: "flex", alignItems: "center", gap: isMobile ? "10px" : "18px", flexWrap: "wrap", padding: isMobile ? "10px 12px" : "14px 26px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: isMobile ? "rgba(10,10,12,0.96)" : "rgba(8,8,10,0.5)", backdropFilter: isMobile ? undefined : "blur(18px)", WebkitBackdropFilter: isMobile ? undefined : "blur(18px)" }}>

        {/* Kerrosvalitsin. Yksi rivi, aina — jos kerroksia on paljon, rivi
            vierii sivusuunnassa. Se ei taitu, koska taittuva pillerikehys
            kasvaa kaksinkertaiseksi ja näyttää rikkinäiseltä.

            Merkitään vain POIKKEUS: lukossa oleva kerros himmenee ja saa
            lukon. Auki oleminen on normaalitila eikä kaipaa koristetta — kun
            joka kerroksessa oli vihreä rengas, rivi ei kertonut mitään. */}
        <div data-fr8-tabs style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "13px", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", padding: "0 5px 0 7px", flexShrink: 0 }}>KRS</span>
          {shownFloors.map((f) => {
            const gLocked = !!guided?.enabled && (guided.lockedFloors || []).includes(f);
            const st = floorBtnStyle(f === floor);
            return (
              <button key={f} onClick={() => { setFloor(f); setActiveOrb(null); setActiveLamp(null); setActiveDoor(null); }}
                title={gLocked ? "Lukossa tekijöiltä — sinä näet sen silti" : undefined}
                style={{
                  ...st,
                  flexShrink: 0,
                  ...(gLocked && f !== floor ? { opacity: 0.45 } : {}),
                }}>
                {gLocked ? `🔒${f}` : f}
              </button>
            );
          })}
        </div>

        {/* Mini ring + stats + kerroksen lukko */}
        <div style={{ display: "flex", alignItems: "center", gap: "13px", flex: "1 1 240px", minWidth: "188px" }}>
          <div style={{ position: "relative", width: "42px", height: "42px", flexShrink: 0 }}>
            <svg width="42" height="42" viewBox="0 0 42 42" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="21" cy="21" r="17" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
              <circle cx="21" cy="21" r="17" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${((floorPct / 100) * CIRC_S).toFixed(1)} ${CIRC_S.toFixed(1)}`}
                style={{ transition: "stroke-dasharray .6s" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700 }}>
              {floor === "K" ? "K" : floor + "."}
            </div>
          </div>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: "15px", fontWeight: 700 }}>
              {floorWashed}<span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 500 }}> / {floorTotal}</span>{" "}
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>pesty</span>
            </div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
              {Math.round(floorPct)} %{hideMoney ? "" : ` · ${euro(floorWashed * pricePerWindow)}`}
            </div>
            {/* Keltaiset omana rivinään. Kokonaisluku ei kerro kumpaa väriä
                siinä on, ja kun käsin laskettu määrä ei täsmää, ero etsitään
                nimenomaan keltaisista — silloin luku pitää olla siinä
                kerroksessa jota katsoo, ei vain yhteenvedossa. */}
            {floorYellow.length > 0 && (
              <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,205,40,0.8)" }}>
                {floorYellowWashed} / {floorYellow.length} keltaista pesty
              </div>
            )}
            {/* PIILOTETUT NÄKYVIIN LUKUNA. Yksittäinen himmeä piste hukkuu
                kartalle: ilman tätä riviä johtaja ei tiedä piilottiko hän
                yhden vai kymmenen, eikä löydä niitä takaisin. */}
            {onToggleWindowLock && lockedOnFloor > 0 && (
              <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.55)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {lockedOnFloor} piilotettu tekijöiltä
              </div>
            )}
          </div>

          {/* Kerroksen lukko asuu tässä eikä kerrosrivillä: tämä rivi kertoo jo
              valitusta kerroksesta, ja tyhjä oikea laita on juuri sen kokoinen
              kuin nappi tarvitsee. Kerrosrivillä se joutui omalle rivilleen ja
              näytti irralliselta. Teksti kertoo teon, ei tilaa. */}
          {onToggleFloorLock && (
            <button
              onClick={() => onToggleFloorLock(floor, !selectedFloorLocked)}
              title={selectedFloorLocked
                ? `${floorLongName(floor, planBuilding)} on lukossa tekijöiltä — avaa se`
                : `Piilota ${floorLongName(floor, planBuilding).toLowerCase()} tekijöiltä`}
              style={{
                marginLeft: "auto", flexShrink: 0,
                display: "inline-flex", alignItems: "center", gap: 6,
                height: 32, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                whiteSpace: "nowrap", lineHeight: 1,
                fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: 12, fontWeight: 600,
                border: `1px solid ${selectedFloorLocked ? "rgba(255,206,40,0.45)" : "rgba(255,255,255,0.12)"}`,
                background: selectedFloorLocked ? "rgba(255,206,40,0.14)" : "transparent",
                color: selectedFloorLocked ? "#ffce28" : "rgba(255,255,255,0.55)",
                transition: "all .16s",
              }}
            >
              {selectedFloorLocked ? `Avaa ${floorShortName(floor, planBuilding)}` : `Lukitse ${floorShortName(floor, planBuilding)}`}
            </button>
          )}
        </div>

        {/* Filter */}
        <div style={{ display: "flex", gap: "5px", padding: "5px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "13px" }}>
          {FILTERS.map((fi) => (
            <button key={fi.id} onClick={() => { setFilter(fi.id); setActiveOrb(null); }} style={filterBtnStyle(filter === fi.id)}>{fi.label}</button>
          ))}
        </div>

        {/* NÄYTÄ — karttatasojen näkyvyys. Yksi nappi ja pieni lista, ei viittä
            lisäsirua palkkiin: oletustila on "kaikki näkyy", eikä oletusta
            tarvitse selittää joka kerta. Nappi kertoo aina kun jotain on
            piilossa, jottei kartta näytä tyhjentyneen itsestään. */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setLayersOpen((v) => !v)}
            title="Valitse mitkä merkit kartalla näkyvät"
            style={{
              display: "flex", alignItems: "center", gap: "7px", padding: "7px 11px", borderRadius: "11px", cursor: "pointer",
              border: `1px solid ${layersHidden ? "rgba(255,196,90,0.4)" : "rgba(255,255,255,0.12)"}`,
              background: layersHidden ? "rgba(255,196,90,0.12)" : "rgba(255,255,255,0.04)",
              color: layersHidden ? "#ffce28" : "rgba(255,255,255,0.62)",
              fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
            {layersHidden ? `Näytä · ${layersHidden} piilossa` : "Näytä"}
          </button>
          {layersOpen && (
            <>
              <div onClick={() => setLayersOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44 }} />
              <div data-fr8-pop="menu" style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 46, width: "196px", padding: "7px", background: "rgba(16,16,20,0.94)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "14px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", padding: "3px 8px 7px" }}>NÄYTÄ KARTALLA</div>
                {([
                  ["p1", "Punaiset ikkunat", "rgb(255,140,178)", "dot"],
                  ["p2", "Keltaiset ikkunat", "rgb(240,226,150)", "dot"],
                  ["lamps", "Lamput", "rgb(255,196,90)", "star"],
                  ["doors", "Ovet", "rgb(156,193,255)", "door"],
                  ["notes", "Merkinnät", "rgba(255,255,255,0.7)", "dot"],
                ] as [keyof typeof layers, string, string, "dot" | "star" | "door"][]).map(([id, label, color, shape]) => {
                  const on = layers[id];
                  return (
                    <button key={id} className="status-opt-btn"
                      onClick={() => {
                        // Piilotetun tason piste jättäisi popoverinsa auki
                        // tyhjän kohdan päälle — sulje ne kaikki tason mukana.
                        closeAllPopovers();
                        setLayers((cur) => ({ ...cur, [id]: !cur[id] }));
                      }}
                      style={{ opacity: on ? 1 : 0.45 }}>
                      {shape === "star" ? (
                        <span aria-hidden style={{ width: "11px", height: "11px", flexShrink: 0, display: "inline-block", clipPath: STAR_CLIP, background: color }} />
                      ) : shape === "door" ? (
                        <span style={{ width: "11px", flexShrink: 0, display: "flex", justifyContent: "center" }}><DoorGlyph rgb="156,193,255" size={11} glow={false} /></span>
                      ) : (
                        <span aria-hidden style={{ width: "11px", height: "11px", flexShrink: 0, borderRadius: "50%", background: color }} />
                      )}
                      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                      <span style={{ fontSize: "11px", color: on ? "#7CE0A6" : "rgba(255,255,255,0.3)" }}>{on ? "✓" : "○"}</span>
                    </button>
                  );
                })}
                {/* Yksi napautus takaisin oletukseen — tärkeämpi kuin miltä
                    kuulostaa: piiloon jäänyt taso on helppo unohtaa. */}
                <button className="status-opt-btn"
                  onClick={() => { closeAllPopovers(); setLayers({ p1: true, p2: true, lamps: true, doors: true, notes: true }); }}
                  style={{ marginTop: "4px", borderTop: "1px solid rgba(255,255,255,0.08)", borderRadius: 0, color: "rgba(255,255,255,0.7)" }}>
                  <span style={{ flex: 1, textAlign: "left" }}>Näytä kaikki</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* TÄMÄN KERROKSEN LAMPUT — kolme lukua siitä mitä tällä kerroksella on
            jäljellä. Vain kun kerroksella oikeasti on lamppuja ja taso on
            näkyvissä, joten lamputon keikka ei näe tätä lainkaan.
            Väri ei kanna merkitystä yksin: jokaisella luvulla on sana. */}
        {layers.lamps && floorLamps.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "6px 11px", borderRadius: "11px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px" }}>
            <span aria-hidden style={{ width: "11px", height: "11px", flexShrink: 0, display: "inline-block", clipPath: STAR_CLIP, background: "rgba(255,255,255,0.5)" }} />
            {([
              [floorLamps.broken, "ei toimi", "rgb(255,116,116)"],
              [floorLamps.unchecked, "tarkastamatta", "rgb(255,196,90)"],
              [floorLamps.changed + floorLamps.working, "kunnossa", "rgb(124,224,166)"],
            ] as [number, string, string][]).map(([n, label, color]) => (
              <span key={label} style={{ display: "inline-flex", alignItems: "baseline", gap: "4px", color: n > 0 ? color : "rgba(255,255,255,0.32)" }}>
                <b style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{n}</b>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Active work zone chip — jump to the floor where work is happening now. */}
        {activeZone && (
          <button onClick={() => { setFloor(activeZone.floor); setActiveOrb(null); }}
            title="Siirry kerrokseen, jossa työ on käynnissä"
            style={{ display: "flex", alignItems: "center", gap: "7px", padding: "6px 11px", borderRadius: "11px", border: "1px solid rgba(95,224,138,0.35)", background: "rgba(95,224,138,0.1)", color: "#9ff0bd", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600 }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#5fe08a", boxShadow: "0 0 8px rgba(95,224,138,0.9)", animation: "fr8-zonePulse 1.8s ease-in-out infinite" }} />
            Työn alla: krs {activeZone.floor}
          </button>
        )}

        {/* Right: legend + controls */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? "8px" : "14px" }}>
          {!isMobile && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center" }}>
                {LEGEND.map((l) => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${l.rgb})`, boxShadow: `0 0 7px rgba(${l.rgb},0.7)` }} />
                    <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>{l.label}</span>
                  </div>
                ))}
              </div>
              <div style={{ width: "1px", height: "26px", background: "rgba(255,255,255,0.1)" }} />
            </>
          )}

          {/* Zoom controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "11px" }}>
            <button onClick={() => zoomBy(1 / 1.3)} title="Loitonna" style={zoomBtnStyle}>−</button>
            <span style={{ minWidth: 34, textAlign: "center", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => zoomBy(1.3)} title="Lähennä" style={zoomBtnStyle}>+</button>
            <button onClick={resetView} title="Nollaa näkymä" style={{ ...zoomBtnStyle, fontSize: 13 }}>⟳</button>
          </div>

          {/* Edit / add controls — full editing for hosts (canEdit), notes-only for workers (canAddNotes) */}
          {(canEdit || canAddNotes) && <>
          {/* P2 pricing mode — multi-select yellow windows, propose one price.
              Available already in the preparation phase (server auto-inits p2
              on the first proposal), so pricing can be prepped before the
              phase is opened to the customer. */}
          {canEdit && onP2Propose && (
          <button onClick={toggleP2SelectMode} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 13px", borderRadius: "11px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 600, transition: "all .16s", border: `1px solid ${p2SelectMode ? "transparent" : "rgba(255,205,40,0.35)"}`, background: p2SelectMode ? "rgb(255,205,40)" : "rgba(255,205,40,0.08)", color: p2SelectMode ? "#0a0a0c" : "rgba(255,220,110,0.95)" }}>
            € {p2SelectMode ? "Valmis" : "Hinnoittele"}
          </button>
          )}
          {canEdit && (
          <button onClick={toggleEdit} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 13px", borderRadius: "11px", cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 600, transition: "all .16s", border: `1px solid ${editMode ? "transparent" : "rgba(255,255,255,0.12)"}`, background: editMode ? "#fff" : "rgba(255,255,255,0.04)", color: editMode ? "#0a0a0c" : "rgba(255,255,255,0.7)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={editMode ? "#0a0a0c" : "rgba(255,255,255,0.55)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            {editMode ? "Valmis" : "Siirrä pisteitä"}
          </button>
          )}

          {/* Add button + menu */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setAddMenuOpen((v) => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "34px", height: "34px", borderRadius: "11px", cursor: "pointer", transition: "all .16s", border: `1px solid ${(placeMode || addMenuOpen) ? "transparent" : "rgba(255,255,255,0.12)"}`, background: (placeMode || addMenuOpen) ? "#fff" : "rgba(255,255,255,0.04)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={(placeMode || addMenuOpen) ? "#0a0a0c" : "rgba(255,255,255,0.7)"} strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            {addMenuOpen && (
              <>
                <div onClick={() => setAddMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 44 }} />
                <div data-fr8-pop="menu" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 46, width: "212px", maxHeight: "min(70vh, 460px)", overflowY: "auto", padding: "7px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "14px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                  {canEdit && <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "5px 8px 7px" }}>
                    <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)" }}>LISÄÄ PISTE</span>
                    {pricePerWindow > 0 && <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9.5px", color: "rgba(95,224,138,0.85)" }}>{deal ? "punainen = " : "+1 = "}{euroUnit(pricePerWindow)}</span>}
                  </div>
                  {ADD_ITEMS.map((it) => (
                    <button key={String(it.id)} className="add-menu-btn" onClick={() => chooseAdd(it.id)} style={{ border: `1px solid ${placeMode === it.id ? "rgba(255,255,255,0.18)" : "transparent"}`, background: placeMode === it.id ? "rgba(255,255,255,0.09)" : "transparent" }}>
                      <span style={{ width: "17px", height: "17px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#ff6b6b", background: it.dotBg, border: it.id === "del" ? "1px solid rgba(255,90,90,0.5)" : "1px solid rgba(255,255,255,0.5)" }}>{it.glyph}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>{it.label}</span>
                        <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>{it.id === 2 && deal ? "Keltainen · ei kuulu sopimukseen" : it.desc}</span>
                      </span>
                    </button>
                  ))}
                  </>}

                  {/* LAMPUT — sama lisäystapa kuin ikkunapisteillä, mutta oma tähtimerkki
                      eikä hintaa. Vain johtajille (canEdit), koska tekijät eivät
                      rakenna karttaa — he vain merkitsevät vaihdetuksi pisteen popoverista. */}
                  {canEdit && (lampsCanEdit || doorsCanEdit) && (
                    <>
                      <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "6px 4px" }} />
                      <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", padding: "2px 8px 7px" }}>LAMPUT & OVET</div>
                      {lampsCanEdit && (
                        <button className="add-menu-btn" onClick={chooseLamp} style={{ border: `1px solid ${placeMode === "lamp" ? "rgba(255,196,90,0.4)" : "transparent"}`, background: placeMode === "lamp" ? "rgba(255,196,90,0.12)" : "transparent" }}>
                          <span aria-hidden style={{ width: "15px", height: "15px", flexShrink: 0, display: "inline-block", clipPath: STAR_CLIP, background: "rgb(255,196,90)" }} />
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>Lamppu</span>
                            <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>Kartoita — näkyy asiakkaalle vasta vaihdosta tai huomautuksesta</span>
                          </span>
                        </button>
                      )}
                      {doorsCanEdit && (
                        <button className="add-menu-btn" onClick={chooseDoor} style={{ border: `1px solid ${placeMode === "door" ? "rgba(156,193,255,0.4)" : "transparent"}`, background: placeMode === "door" ? "rgba(156,193,255,0.12)" : "transparent" }}>
                          <span style={{ width: "15px", flexShrink: 0, display: "flex", justifyContent: "center" }}><DoorGlyph rgb="156,193,255" size={15} glow={false} /></span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>Ovi</span>
                            <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>Tehtävä­piste — nimeä ja kuittaa tehdyksi</span>
                          </span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Navigation markers / notes — ladders, entrances, hazards, free notes. */}
                  {notesCanEdit && (
                    <>
                      {canEdit && <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "6px 4px" }} />}
                      <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9px", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", padding: "2px 8px 7px" }}>{canEdit ? "MERKINNÄT & HUOMIOT" : "LISÄÄ MERKINTÄ"}</div>
                      {(Object.keys(NOTE_KINDS) as ProjNoteKind[]).map((k) => (
                        <button key={k} className="add-menu-btn" onClick={() => chooseNoteKind(k)} style={{ border: `1px solid ${placeMode === "note" && noteKind === k ? "rgba(255,255,255,0.18)" : "transparent"}`, background: placeMode === "note" && noteKind === k ? "rgba(255,255,255,0.09)" : "transparent" }}>
                          <span style={{ width: "17px", height: "17px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>{NOTE_KINDS[k].glyph}</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>{NOTE_KINDS[k].label}</span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Active work zone — one coloured "work happening here now" marker. */}
                  {zoneCanEdit && (
                    <>
                      <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "6px 4px" }} />
                      <button className="add-menu-btn" onClick={chooseZone} style={{ border: `1px solid ${placeMode === "zone" ? "rgba(95,224,138,0.4)" : "transparent"}`, background: placeMode === "zone" ? "rgba(95,224,138,0.12)" : "transparent" }}>
                        <span style={{ width: "17px", height: "17px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>🎯</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#fff" }}>Työn alla nyt</span>
                          <span style={{ display: "block", fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>Näkyy asiakkaalle reaaliajassa</span>
                        </span>
                      </button>
                      {activeZone && (
                        <button className="add-menu-btn" onClick={() => { onClearActiveZone?.(); setAddMenuOpen(false); }} style={{ border: "1px solid transparent" }}>
                          <span style={{ width: "17px", height: "17px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "#ff9b9b" }}>✕</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>Poista työalue-merkintä</span>
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          </>}
        </div>
      </div>

      {/* Floor plan */}
      <div
        ref={sceneRef}
        onWheel={onSceneWheel}
        onTouchStart={onSceneTouchStart}
        onTouchMove={onSceneTouchMove}
        onTouchEnd={onSceneTouchEnd}
        style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? "10px" : "26px", minHeight: 0, overflow: "hidden", // Kartta ottaa eleet myös lisäystilassa, joten selain ei saa
            // kaapata niitä sivun vieritykseen.
            touchAction: "none", background: "radial-gradient(ellipse 72% 72% at 50% 47%, rgba(125,135,170,0.07), transparent 72%)" }}
      >

        {/* Edit banner */}
        {editMode && (
          // data-fr8-pop: kelluu kartan päällä, joten tausta ei saa
          // pudota 5,5 %:n valkoiseksi — teksti menisi ristiin pisteiden kanssa.
          <div data-fr8-pop style={{ position: "absolute", top: "14px", left: "50%", transform: "translateX(-50%)", zIndex: 20, display: "flex", alignItems: "center", gap: "12px", padding: "9px 9px 9px 16px", background: "rgba(16,16,20,0.82)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "13px", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 12px 34px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.8)" }}>{editBanner}</span>
            {/* Live price impact — each dot is worth one window, so adding/removing
                dots moves the contract cap in real time. */}
            {pricePerWindow > 0 && (
              <span
                title={deal
                  ? "Allekirjoitettu sopimus: punaiset ikkunat × 37,50 €, kiinteä kokonaiskatto. Keltaiset eivät kuulu tähän sopimukseen."
                  : "Koko sopimuksen ikkunamäärä × hinta/ikkuna — muuttuu kun lisäät tai poistat pisteitä"}
                style={{ display: "flex", alignItems: "center", gap: "7px", padding: "5px 11px", borderRadius: "9px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11.5px", color: "rgba(255,255,255,0.85)" }}
              >
                <span style={{ color: "rgba(255,255,255,0.5)" }}>{deal ? "SOPIMUS" : "KATTO"}</span>
                <strong style={{ fontWeight: 700 }}>{totalLive} {deal ? "punaista" : "ikkunaa"} · {euro(capEur)}</strong>
              </span>
            )}
            <button onClick={() => onResetFloor(floor)} style={{ padding: "6px 12px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Palauta tämä kerros
            </button>
          </div>
        )}

        {!hasAnyPlan(planBuilding) ? (
          <div style={{ maxWidth: "420px", textAlign: "center", padding: "30px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "15px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3Z" /><path d="M9 7v13M15 4v13" /></svg>
            </div>
            <div style={{ fontSize: "16px", fontWeight: 600 }}>Ei pohjakuvaa tälle keikalle</div>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
              Lisää rakennuksen kerrokset ja pohjakuvan polku — tai tuo omat ikkunamerkinnät — <strong style={{ color: "rgba(255,255,255,0.7)" }}>Pohjakartat &amp; asetukset</strong> -työkalussa. Sen jälkeen kartta näkyy tässä.
            </div>
          </div>
        ) : marks ? (
          <div style={{ position: "relative", display: "inline-block", lineHeight: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center", transition: panRef.current || pinchRef.current ? "none" : "transform .18s ease", willChange: "transform" }}>
            {/* TYHJÄÄ `src`:iä ei aseteta koskaan: `<img src="">` lataa nykyisen
                sivun ja piirtyy rikkinäisen kuvan merkkinä — se näytti
                kartalla siltä kuin kuva olisi rikki, vaikka kuvaa ei ollut. */}
            {planSrc ? (
              <img ref={planRef} src={planSrc} alt="pohjapiirros"
                style={{ display: "block", maxWidth: "100%", maxHeight: isMobile ? "calc(100vh - 210px)" : "calc(100vh - 240px)", width: "auto", height: "auto", userSelect: "none", WebkitClipPath: planCrop, clipPath: planCrop } as React.CSSProperties}
                draggable={false} />
            ) : (
              <div style={{ width: "min(78vw, 420px)", height: "min(62vh, 560px)", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "24px", borderRadius: "14px", border: "1px dashed rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.02)", color: "rgba(255,255,255,0.55)", fontSize: "13px", lineHeight: 1.6 }}>
                {authedPlan.error ?? (authedPlan.loading ? "Ladataan pohjakuvaa…" : "Pohjakuvaa ei ole vielä ladattu tälle kerrokselle.")}
              </div>
            )}

            {/* Orbs layer */}
            <div onClick={onPlanClick} style={{ position: "absolute", inset: 0, cursor: (placeMode === 1 || placeMode === 2 || placeMode === "note" || placeMode === "zone" || placeMode === "lamp" || placeMode === "door") ? "crosshair" : "default" }}>
              {/* Active work zone — pulsing coloured highlight of current work. */}
              {activeZone && activeZone.floor === floor && (
                <span aria-label="Työn alla nyt" title={activeZone.label ? `Työn alla: ${activeZone.label}` : "Työn alla nyt"}
                  style={{ position: "absolute", left: `${activeZone.x}%`, top: `${activeZone.y}%`, transform: "translate(-50%,-50%)", width: "30px", height: "30px", borderRadius: "50%", background: "rgba(95,224,138,0.18)", border: "2px solid #5fe08a", boxShadow: "0 0 0 6px rgba(95,224,138,0.12)", animation: "fr8-zonePulse 1.8s ease-in-out infinite", pointerEvents: "none", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>
                  🎯
                </span>
              )}
              {visiblePoints.map((pt) => {
                const status = statuses[pt.key] || "ei";
                const isDragging = dragging === pt.key;
                // Lukittu näkyy vain johtajalle (tekijältä se on jo suodatettu
                // pois): himmeä ja katkoviivainen, jotta yhdellä silmäyksellä
                // erottaa "piilotettu" tilasta "pesemättä".
                const locked = lockedKeySet.has(pt.key);
                return (
                  <button key={pt.key}
                    data-fr8-dot
                    style={{
                      ...orbStyle(pt, status, isDragging),
                      ...(locked ? { opacity: 0.34, filter: "grayscale(1)", borderStyle: "dashed" } : null),
                      ...dimOther("window"),
                    }}
                    onClick={(e) => onOrbClick(pt, e)}
                    onPointerDown={(e) => onOrbPointerDown(pt, e)}
                    onPointerMove={(e) => onOrbPointerMove(pt, e)}
                    onPointerUp={(e) => onOrbPointerUp(pt, e)}
                    title={editMode && placeMode === "del"
                      ? "Poista tämä piste"
                      : `${labelFor(pt)} · ${locked ? "PIILOTETTU tekijöiltä · " : ""}${status === "pesty" ? "Pesty" : status === "kesken" ? "Kesken" : "Ei pesty"}`}
                  />
                );
              })}

              {/* LUKKOMERKKI PIILOTETUN PISTEEN PÄÄLLE.
                  Pelkkä himmennys ei riitä: kartalla on muutenkin haaleita
                  pisteitä (pesemättömät, toisen prioriteetin), joten "onko tuo
                  piilotettu vai ei" jäi arvailuksi. Merkki on yksiselitteinen
                  ja näkyy vain johtajalle — tekijältä koko piste on poissa. */}
              {onToggleWindowLock && visiblePoints.filter((pt) => lockedKeySet.has(pt.key)).map((pt) => (
                <span
                  key={`lock-${pt.key}`}
                  aria-hidden
                  style={{
                    position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                    transform: "translate(-50%,-50%)",
                    width: 15, height: 15, borderRadius: "50%",
                    background: "rgba(10,10,12,0.92)", border: "1px solid rgba(255,255,255,0.5)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    pointerEvents: "none", zIndex: 7,
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
              ))}

              {/* LAAJUUSVASTAUKSET — asiakkaan "pestään" / "ei pestä" keltaisista.
                  Merkki pisteen päälle, ei uusi väri: tämä on asiakkaan toive,
                  ei ikkunan tila, ja ne kaksi eivät saa näyttää samalta. Ilman
                  tätä vastaus jäisi järjestelmän sisään eikä ohjaisi työtä. */}
              {scopeVotes && visiblePoints.map((pt) => {
                const v = pt.p === 2 ? scopeVotes[pt.key] : undefined;
                if (!v) return null;
                const yes = v === "yes";
                return (
                  <span key={`scope-${pt.key}`} aria-hidden
                    title={yes ? "Asiakas: pestään" : "Asiakas: ei pestä"}
                    style={{
                      position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                      transform: "translate(4px, -12px)", pointerEvents: "none",
                      minWidth: 14, height: 14, padding: "0 3px", borderRadius: 999,
                      background: yes ? "#1d3624" : "#1b1b1f",
                      border: `1.5px solid ${yes ? "#5FE08A" : "#6B6F76"}`,
                      color: yes ? "#5FE08A" : "#8A929C",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8.5, fontWeight: 800, lineHeight: 1, zIndex: 6,
                    }}>
                    {yes ? "✓" : "–"}
                  </span>
                );
              })}

              {/* SEURAAVA IKKUNA — ohjatun etenemisen opastin.
                  `computeGuided` on laskenut `nextKey`:n koko ajan (kesken-työt
                  ensin, sitten pyyhkäisy ylhäältä alas, ankkuroituna viimeksi
                  pestyyn) — sitä ei vain koskaan piirretty, joten tekijä ei
                  nähnyt ehdotusta mistään. Rengas ei estä mitään: kaikki avoimen
                  kerroksen pisteet ovat yhtä lailla painettavissa, tämä vain
                  kertoo mistä kannattaa jatkaa. */}
              {guided?.enabled && guidedNextPoint && (
                <span aria-hidden data-fr8-next
                  style={{
                    position: "absolute",
                    left: `${guidedNextPoint.x}%`, top: `${guidedNextPoint.y}%`,
                    transform: "translate(-50%,-50%)",
                    width: "30px", height: "30px", borderRadius: "50%",
                    border: "2px solid #5fe08a",
                    boxShadow: "0 0 0 5px rgba(95,224,138,0.14)",
                    animation: "fr8-zonePulse 1.8s ease-in-out infinite",
                    pointerEvents: "none", zIndex: 4,
                  }} />
              )}

              {/* Kartalla EI näytetä hintoja. Sadan pisteen hintakupla-sumppu teki
                  kartasta lukukelvottoman — hinta ja neuvottelutila näkyvät kun
                  pistettä napauttaa (popover alla). Väri kertoo tilan: keltainen =
                  asiakas hyväksynyt, sininen = odottaa hyväksyntää. */}

              {/* Observation badges — a small marker on windows that carry a note */}
              {visiblePoints.map((pt) => observations?.[pt.key] ? (
                <span key={`obs-${pt.key}`} aria-hidden
                  style={{ position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, transform: "translate(3px, -13px)", pointerEvents: "none", width: "13px", height: "13px", borderRadius: "50%", background: "#1b1b1f", border: "1.5px solid #7CE0A6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "7px", lineHeight: 1, zIndex: 5 }}>
                  💬
                </span>
              ) : null)}

              {/* Navigation markers / notes layer */}
              {(layers.notes ? floorNotes : []).map((n) => (
                <button key={n.key}
                  onClick={(e) => openNote(n, e)}
                  title={`${NOTE_KINDS[n.kind].label}${n.text ? " — " + n.text : ""}`}
                  style={{
                    position: "absolute", left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)",
                    width: "24px", height: "24px", borderRadius: "8px", padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px",
                    background: activeNote === n.key ? "rgba(255,255,255,0.95)" : "rgba(20,20,26,0.86)",
                    border: `1.5px solid ${n.kind === "warning" ? "rgba(255,176,72,0.9)" : "rgba(255,255,255,0.65)"}`,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.55)",
                    cursor: editMode && placeMode === "del" ? "pointer" : "pointer",
                    zIndex: 7, touchAction: "none",
                    ...dimOther("note"),
                  }}
                >
                  {NOTE_KINDS[n.kind].glyph}
                </button>
              ))}

              {/* Lamput — tähtinä, oma kerroksensa ikkunapisteiden yläpuolella.
                  Lisäystilan aikana ne ohittavat klikkaukset (pointerEvents: none),
                  jotta uuden lampun paikannus ei osu vahingossa vanhan päälle —
                  sama sääntö kuin ikkunapisteillä lisäystilassa. */}
              {(layers.lamps ? lampPts : []).map((lp) => {
                const changed = (lampStatuses?.[lp.key] || "ei") === "vaihdettu";
                const rgb = lampRgb(changed ? "vaihdettu" : "ei", lampConditions?.[lp.key]);
                return (
                  <button key={lp.key}
                    data-fr8-dot
                    onClick={(e) => onLampClick(lp, e)}
                    title={`Lamppu · ${lampStateLabel(changed ? "vaihdettu" : "ei", lampConditions?.[lp.key])}${lampNotes?.[lp.key]?.text ? ` · ${lampNotes[lp.key]!.text}` : ""}`}
                    style={{
                      position: "absolute", left: `${lp.x}%`, top: `${lp.y}%`,
                      transform: "translate(-50%,-50%)", width: "18px", height: "18px",
                      padding: 0, border: "none", background: "transparent", cursor: "pointer",
                      pointerEvents: (editMode && placeMode === "lamp") ? "none" : "auto",
                      zIndex: 6, touchAction: "none",
                      ...dimOther("lamp"),
                    }}
                  >
                    <span aria-hidden style={{
                      display: "block", width: "100%", height: "100%", clipPath: STAR_CLIP,
                      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(${rgb},0.95) 55%, rgba(${rgb},0.85))`,
                      filter: `drop-shadow(0 0 5px rgba(${rgb},${changed ? 0.85 : 0.6}))`,
                    }} />
                    {/* Huomautusmerkki — pieni piste tähden kulmassa, jotta
                        kartalta näkee ilman napautusta mistä on kirjoitettu. */}
                    {!!lampNotes?.[lp.key]?.text && (
                      <span aria-hidden style={{ position: "absolute", right: "-3px", top: "-3px", width: "7px", height: "7px", borderRadius: "50%", background: "#fff", border: "1.5px solid rgba(16,16,20,0.9)" }} />
                    )}
                  </button>
                );
              })}

              {/* Ovet — omana kerroksenaan lamppujen rinnalla. Sama
                  lisäystilan ohitus kuin muillakin merkeillä. */}
              {(layers.doors ? doorPts : []).map((dr) => {
                const st: DoorStatus = doorStatuses?.[dr.key] || "ei";
                const rgb = doorRgb(st);
                return (
                  <button key={dr.key}
                    data-fr8-dot
                    onClick={(e) => onDoorClick(dr, e)}
                    title={`Ovi${dr.label ? ` · ${dr.label}` : ""} · ${st === "tehty" ? "Tehty" : "Tekemättä"}`}
                    style={{
                      position: "absolute", left: `${dr.x}%`, top: `${dr.y}%`,
                      transform: "translate(-50%,-50%)", width: "18px", height: "18px",
                      padding: 0, border: "none", background: "transparent", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      pointerEvents: (editMode && placeMode === "door") ? "none" : "auto",
                      zIndex: 6, touchAction: "none",
                      ...dimOther("door"),
                    }}
                  >
                    <DoorGlyph rgb={rgb} size={18} />
                    {!!doorNotes?.[dr.key]?.text && (
                      <span aria-hidden style={{ position: "absolute", right: "0px", top: "-3px", width: "7px", height: "7px", borderRadius: "50%", background: "#fff", border: "1.5px solid rgba(16,16,20,0.9)" }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "14px" }}>Ladataan pohjapiirros…</div>
        )}
      </div>

      {/* P2 pricing bar — shown in select mode: pick yellows, set one price. */}
      {p2SelectMode && (
        // data-fr8-pop: sama kuin muokkauspalkki — kelluu kartan päällä.
        <div data-fr8-pop style={{ position: "fixed", left: "50%", bottom: "calc(14px + env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 1150, display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100vw - 24px)", padding: "10px 12px", background: "rgba(16,16,20,0.94)", border: "1px solid rgba(255,205,40,0.4)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 18px 50px rgba(0,0,0,0.7)" }}>
          {!p2?.enabled && (
            <span title="Vaihe 2 ei ole vielä auki asiakkaalle — hinnat menevät jonoon odottamaan" style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.06em", padding: "3px 7px", borderRadius: 999, border: "1px solid rgba(255,205,40,0.4)", background: "rgba(255,205,40,0.1)", color: "rgb(255,220,110)", whiteSpace: "nowrap" }}>
              VALMISTELU
            </span>
          )}
          <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
            {p2Selected.size} valittu
          </span>
          <button
            onClick={() => setP2Selected((prev) => {
              const next = new Set(prev);
              floorYellowUnpriced.forEach((pt) => next.add(pt.key));
              return next;
            })}
            disabled={floorYellowUnpriced.length === 0}
            style={{ padding: "7px 11px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.8)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", opacity: floorYellowUnpriced.length === 0 ? 0.4 : 1, whiteSpace: "nowrap" }}
          >
            + Kerroksen hinnoittelemattomat ({floorYellowUnpriced.length})
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            {P2_PRICE_PRESETS_CENTS.map((c) => (
              <button key={c} onClick={() => setP2Price(String(c / 100))}
                style={{ padding: "7px 9px", borderRadius: "9px", border: `1px solid ${p2PriceCents === c ? "rgba(255,205,40,0.7)" : "rgba(255,255,255,0.14)"}`, background: p2PriceCents === c ? "rgba(255,205,40,0.16)" : "rgba(255,255,255,0.04)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                {euroUnit(c / 100)}
              </button>
            ))}
            <input
              type="number" inputMode="decimal" min={1} step="0.5"
              value={p2Price}
              onChange={(e) => setP2Price(e.target.value)}
              placeholder="€ / ikkuna"
              style={{ width: "84px", padding: "7px 9px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", outline: "none" }}
            />
          </div>
          {/* HINTAHUOMIO. Asiakas näkee pelkän luvun eikä tiedä miksi juuri se —
              yksi rivi ("iso ikkuna, tikkaat") tekee hyväksymisestä helppoa.
              Kulkee tarjouksen mukana ja säilyy hinnan päivityksissä. */}
          <input
            value={p2Note}
            onChange={(e) => setP2Note(e.target.value.slice(0, MAX_P2_NOTE_LEN))}
            placeholder="Hintahuomio (valinnainen)"
            title="Näkyy asiakkaalle hinnan vieressä"
            style={{ width: "170px", padding: "7px 9px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", outline: "none" }}
          />
          <button
            disabled={p2Selected.size === 0 || !p2PriceCents}
            onClick={() => {
              if (!p2PriceCents || p2Selected.size === 0) return;
              onP2Propose?.(Array.from(p2Selected), p2PriceCents, p2Note.trim() || undefined);
              setP2Selected(new Set());
              setP2Note("");
            }}
            style={{ padding: "8px 15px", borderRadius: "10px", border: "none", background: (p2Selected.size && p2PriceCents) ? "rgb(255,205,40)" : "rgba(255,255,255,0.12)", color: (p2Selected.size && p2PriceCents) ? "#0a0a0c" : "rgba(255,255,255,0.4)", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Ehdota hintaa{p2Selected.size > 0 && p2PriceCents ? ` (${p2Selected.size} × ${euroUnit(p2PriceCents / 100)})` : ""}
          </button>
        </div>
      )}

      {/* Status popover — rendered as a fixed overlay (outside the zoom/pan scene)
          so its buttons are NEVER clipped and stay tappable at any zoom or edge. */}
      {activeOrb && !editMode && activePt && (
        <>
          <div onClick={() => { setActiveOrb(null); setOrbAnchor(null); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
          <div data-fr8-pop="menu" style={{ ...fixedPopoverStyle(orbAnchor, 210, canObserve ? 380 : 230), width: "210px", maxHeight: "min(78vh, 460px)", overflowY: "auto", padding: "11px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 4px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "7px" }}>
              <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${colorRgb(activePt.p, statuses[activeOrb] || "ei")})`, boxShadow: `0 0 7px rgba(${colorRgb(activePt.p, statuses[activeOrb] || "ei")},0.7)` }} />
              <span style={{ fontSize: "12px", fontWeight: 600 }}>{activePt ? labelFor(activePt) : `Ikkuna ${activeIdx + 1}`}</span>
              <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "9.5px", color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>{activePt.p === 2 && p2 ? "PRIORITY 2" : deal && activePt.p === 2 ? "EI SOPIMUKSESSA" : `PRIORITEETTI ${activePt.p}`}</span>
            </div>

            {/* Keltaisen hinta ja neuvottelutila — VAIN täällä, ei kartalla. Yksi
                rivi per tila, ei selityksiä. */}
            {canEdit && activePt.p === 2 && p2?.offers && (() => {
              const offer = p2.offers[activeOrb];
              if (!offer) return (
                <div style={{ padding: "2px 4px 8px", fontSize: "12px", color: "rgba(150,175,255,0.95)" }}>
                  Ei hintaa — hinnoittele € -tilassa
                </div>
              );
              const row = (label: string, value: string, color: string) => (
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "2px 4px 8px", fontSize: "12px" }}>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
                  <strong style={{ color, fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "13px" }}>{value}</strong>
                </div>
              );
              const statusRow =
                offer.status === "locked" ? row("Sovittu", euroUnit((offer.lockedCents ?? offer.priceCents) / 100), "#7CE0A6")
                : offer.status === "proposed" ? row("Odottaa asiakasta", euroUnit(offer.priceCents / 100), "rgb(150,175,255)")
                : offer.status === "countered" ? row("Vastatarjous", euroUnit((offer.counterCents ?? 0) / 100), "rgb(255,205,40)")
                : row("Hylätty", euroUnit(offer.priceCents / 100), "rgba(255,255,255,0.5)");

              // PERUSTELU TÄLLE IKKUNALLE, SUORAAN PISTEESTÄ.
              // Hintahuomion sai ennen antaa vain hinnoittelupalkista, eli
              // kaikille valituille ikkunoille kerralla. Perustelu on kuitenkin
              // ikkunakohtainen ("tämä on parvekkeen takana"), ja se on
              // hyödyllisin juuri silloin kun katsoo yhtä pistettä. Teksti
              // näkyy asiakkaalle siinä kohdassa jossa hän hyväksyy hinnan.
              const canNote = onP2Propose && offer.status !== "locked";
              return (
                <>
                  {statusRow}
                  {canNote && (
                    <div style={{ padding: "0 4px 8px" }}>
                      {priceNoteFor === activeOrb ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            autoFocus
                            value={priceNoteDraft}
                            onChange={(e) => setPriceNoteDraft(e.target.value.slice(0, MAX_P2_NOTE_LEN))}
                            placeholder="Perustelu asiakkaalle"
                            style={{ flex: 1, minWidth: 0, padding: "7px 9px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", outline: "none" }}
                          />
                          <button
                            onClick={() => {
                              onP2Propose!([activeOrb], offer.priceCents, priceNoteDraft.trim());
                              setPriceNoteFor(null);
                            }}
                            style={{ padding: "7px 11px", borderRadius: 9, border: "none", background: "rgb(255,205,40)", color: "#0a0a0c", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                            OK
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setPriceNoteFor(activeOrb); setPriceNoteDraft(offer.note ?? ""); }}
                          style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 4px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-onest, system-ui, sans-serif)", fontSize: "12px", color: offer.note ? "rgba(255,225,175,0.95)" : "rgba(255,255,255,0.45)" }}>
                          <span style={{ flexShrink: 0 }}>💬</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {offer.note || "Lisää perustelu asiakkaalle"}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {(["ei", "kesken", "pesty"] as WindowStatus[]).map((s) => {
              const cur = statuses[activeOrb] || "ei";
              const isActive = cur === s;
              const rgb = colorRgb(activePt.p, s);
              const hasCrew = s === "pesty" && !!workers && workers.length > 0;
              return (
                <button key={s} className="status-opt-btn"
                  onClick={() => {
                    if (hasCrew) {
                      // Mark washed and attribute to the default worker. Names stay
                      // hidden — change them only via "Vaihda" below. Keep open so
                      // the attribution row is visible.
                      onStatusChange(activeOrb, "pesty", washedBy?.[activeOrb] ?? currentWorkerId);
                      setShowWasherPicker(false);
                      return;
                    }
                    onStatusChange(activeOrb, s);
                    setActiveOrb(null); setOrbAnchor(null);
                  }}
                  style={{ border: `1px solid ${isActive ? "rgba(255,255,255,0.16)" : "transparent"}`, background: isActive ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: isActive ? 600 : 500 }}>
                  <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: `rgb(${rgb})`, boxShadow: `0 0 6px rgba(${rgb},0.7)`, flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: "left" }}>{s === "ei" ? "Ei pesty" : s === "kesken" ? "Kesken" : "Pesty"}</span>
                  {isActive && <span style={{ fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}

            {/* Tekijän OMA palkkio tästä keltaisesta (ei koskaan asiakashintaa).
                Näytetään myös kun hinta odottaa asiakkaan hyväksyntää — työ
                kannattaa tehdä, ja summa merkitään silloin arvioksi. */}
            {!canEdit && activePt.p === 2 && p2?.payoutByKey?.[activeOrb] != null && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", padding: "6px 4px 0", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                <span>Sinulle:</span>
                <strong style={{ color: p2Agreed(activeOrb) ? "#7CE0A6" : "rgb(255,205,40)", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                  {euroUnit((p2.payoutByKey[activeOrb]) / 100)}
                </strong>
                {!p2Agreed(activeOrb) && <span style={{ fontSize: "10.5px", color: "rgba(255,205,40,0.8)" }}>(arvio)</span>}
              </div>
            )}

            {/* Washer attribution — shows WHO washed this window. Hosts can change
                it via "Vaihda"; workers see it read-only. */}
            {(statuses[activeOrb] || "ei") === "pesty" && (washedBy?.[activeOrb] || (canEdit && workers && workers.length > 0)) && (
              showWasherPicker && canEdit && workers && workers.length > 0 ? (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Kuka pesi?</div>
                  {workers.map((w) => {
                    const picked = (washedBy?.[activeOrb] ?? currentWorkerId) === w.id;
                    return (
                      <button key={w.id} className="status-opt-btn"
                        onClick={() => { onStatusChange(activeOrb, "pesty", w.id); setShowWasherPicker(false); }}
                        style={{ border: `1px solid ${picked ? "rgba(255,255,255,0.16)" : "transparent"}`, background: picked ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: picked ? 600 : 500 }}>
                        <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, background: "rgba(124,224,166,0.16)", color: "rgba(124,224,166,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, textAlign: "left" }}>{w.name}</span>
                        {picked && <span style={{ fontSize: "11px" }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(124,224,166,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Pesi <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[washedBy?.[activeOrb] ?? currentWorkerId ?? ""] ?? (washedBy?.[activeOrb] ?? currentWorkerId)}</strong>
                  </span>
                  {canEdit && workers && workers.length > 0 && (
                    <button onClick={() => setShowWasherPicker(true)} style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(124,224,166,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Vaihda</button>
                  )}
                </div>
              )
            )}

            {/* 50/50 split — managers can credit a window done together to a
                second worker. The window stays one washed window; only the
                earnings/credit split half-and-half between the two. */}
            {canEdit && onSetSplit && (statuses[activeOrb] || "ei") === "pesty" && workers && workers.length > 1 && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                {washedBy2?.[activeOrb] ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Jaettu 50/50: <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[washedBy2[activeOrb]] ?? washedBy2[activeOrb]}</strong>
                    </span>
                    <button onClick={() => { onSetSplit(activeOrb, null); setShowSplitPicker(false); }}
                      style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(255,155,155,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Poista jako</button>
                  </div>
                ) : showSplitPicker ? (
                  <>
                    <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Kuka teki yhdessä? (50/50)</div>
                    {workers.filter((w) => w.id !== (washedBy?.[activeOrb] ?? currentWorkerId)).map((w) => (
                      <button key={w.id} className="status-opt-btn"
                        onClick={() => { onSetSplit(activeOrb, w.id); setShowSplitPicker(false); }}
                        style={{ border: "1px solid transparent", background: "transparent", fontWeight: 500 }}>
                        <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, background: "rgba(124,224,166,0.16)", color: "rgba(124,224,166,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, textAlign: "left" }}>{w.name}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <button className="status-opt-btn" onClick={() => setShowSplitPicker(true)} style={{ border: "1px solid transparent", background: "transparent" }}>
                    <span style={{ width: "13px", height: "13px", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(124,224,166,0.95)", fontSize: "15px", fontWeight: 700, flexShrink: 0 }}>+</span>
                    <span style={{ flex: 1, textAlign: "left" }}>Jaa 50/50 toiselle</span>
                  </button>
                )}
              </div>
            )}

            {/* Kesken attribution — shows WHO marked this window as "kesken". */}
            {(statuses[activeOrb] || "ei") === "kesken" && keskenBy?.[activeOrb] && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(188,150,255,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Kesken: <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[keskenBy[activeOrb]] ?? keskenBy[activeOrb]}</strong>
                </span>
              </div>
            )}

            {/* Per-window observation — text + optional photo. Shown to the
                customer as a small popup on this window. */}
            {canObserve && onSetObservation && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                {!obsOpen ? (
                  <button className="status-opt-btn" onClick={() => setObsOpen(true)}
                    style={{ border: "1px solid transparent" }}>
                    <span style={{ fontSize: "13px" }}>💬</span>
                    <span style={{ flex: 1, textAlign: "left" }}>{(obsDraft.trim() || obsHasPhoto) ? "Muokkaa huomiota" : "Lisää huomio"}</span>
                    {(obsDraft.trim() || obsHasPhoto) && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7CE0A6", flexShrink: 0 }} />}
                  </button>
                ) : (
                  <>
                    <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 2px 6px" }}>Huomio ikkunasta</div>
                    <textarea value={obsDraft} onChange={(e) => setObsDraft(e.target.value)} rows={2}
                      placeholder="Esim. rikkinäinen tiiviste, naarmu lasissa…" autoFocus
                      style={{ width: "100%", resize: "none", padding: "8px 10px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "12.5px", outline: "none", fontFamily: "var(--font-onest, system-ui, sans-serif)", boxSizing: "border-box" }} />
                    {obsImageState === "loading" && (
                      <div style={{ marginTop: "8px", padding: "14px 0", textAlign: "center", borderRadius: "9px", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", fontSize: "11.5px" }}>
                        Ladataan kuvaa…
                      </div>
                    )}
                    {obsImage && (
                      <div style={{ position: "relative", marginTop: "8px" }}>
                        <img src={obsImage} alt="huomio" style={{ width: "100%", maxHeight: "120px", objectFit: "cover", borderRadius: "9px", display: "block" }} />
                        <button onClick={() => { setObsImage(undefined); setObsImageState("none"); }} aria-label="Poista kuva"
                          style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "13px", cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "7px", marginTop: "8px" }}>
                      {!obsHasPhoto && (
                        <label style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 11px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.8)", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", whiteSpace: "nowrap" }}>
                          + Kuva
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickObservationImage(f); e.currentTarget.value = ""; }} />
                        </label>
                      )}
                      <button onClick={saveObservation} disabled={obsBusy || obsImageState === "loading"}
                        style={{ flex: 1, padding: "8px 12px", borderRadius: "10px", border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", opacity: (obsBusy || obsImageState === "loading") ? 0.6 : 1 }}>
                        {(obsDraft.trim() || obsHasPhoto) ? "Tallenna" : "Poista huomio"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* YHDEN IKKUNAN LUKITUS. Kerroslukitus on tylppä työkalu: joskus
                kerros on työn alla mutta yksi ikkuna ei ole (rikki, tavaraa
                edessä, ei kuulu tähän erään). Poistaminen olisi väärä keino —
                ikkuna on olemassa ja palaa työhön myöhemmin. Lukittu piste
                katoaa tekijän kartalta kokonaan eikä sitä voi merkitä pestyksi. */}
            {onToggleWindowLock && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button className="status-opt-btn"
                  onClick={() => { onToggleWindowLock(activeOrb, !lockedKeySet.has(activeOrb)); setActiveOrb(null); setOrbAnchor(null); }}
                  style={{ color: lockedKeySet.has(activeOrb) ? "#7CE0A6" : "rgba(255,255,255,0.82)" }}>
                  {lockedKeySet.has(activeOrb) ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7CE0A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  )}
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {lockedKeySet.has(activeOrb) ? "Avaa tekijöille" : "Piilota tekijöiltä"}
                  </span>
                </button>
              </div>
            )}

            {/* Delete this window — managers only. Removes the dot from the map
                (seeded dots are hidden, custom dots are removed entirely). */}
            {canEdit && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button className="status-opt-btn"
                  onClick={() => {
                    if (typeof window === "undefined" || window.confirm("Poistetaanko tämä ikkuna kartalta?")) {
                      onDeleteMark(activeOrb);
                      setActiveOrb(null); setOrbAnchor(null);
                    }
                  }}
                  style={{ color: "#ff9b9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff9b9b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  <span style={{ flex: 1, textAlign: "left" }}>Poista ikkuna kartalta</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Note popover — view / edit the marker's label, or delete it. Also fixed. */}
      {activeNote && activeNoteObj && (
        <>
          <div onClick={() => { saveActiveNote(); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
          <div data-fr8-pop="menu" style={{ ...fixedPopoverStyle(noteAnchor, 232, 180), width: "232px", padding: "12px", background: "rgba(16,16,20,0.94)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 2px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "9px" }}>
              <span style={{ fontSize: "16px" }}>{NOTE_KINDS[activeNoteObj.kind].glyph}</span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{NOTE_KINDS[activeNoteObj.kind].label}</span>
            </div>
            {notesCanEdit ? (
              <>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Kirjoita muistiinpano (esim. ”Tikkaat tässä, 3 m”)"
                  autoFocus
                  rows={3}
                  style={{ width: "100%", resize: "none", padding: "9px 11px", borderRadius: "11px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "13px", outline: "none", fontFamily: "var(--font-onest, system-ui, sans-serif)", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button onClick={deleteActiveNote} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid rgba(255,90,90,0.4)", background: "rgba(255,90,90,0.1)", color: "#ff9b9b", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Poista</button>
                  <button onClick={saveActiveNote} style={{ flex: 1, padding: "9px 12px", borderRadius: "10px", border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Valmis</button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.5, minHeight: "20px" }}>
                {activeNoteObj.text || <span style={{ color: "rgba(255,255,255,0.4)" }}>Ei muistiinpanoa.</span>}
              </div>
            )}
          </div>
        </>
      )}

      {/* Lamppu-popover — tila (ei/vaihdettu) + kuka vaihtoi + poisto. Sama
          rakenne kuin ikkunan status-popoverissa, mutta ei rahaa eikä
          prioriteettia: lampulla on vain kaksi tilaa. */}
      {activeLamp && activeLampPt && (
        <>
          {/* Taustan napautus tallentaa keskeneräisen huomautuksen — sama käytös
              kuin muistiinpanopopoverissa, jottei juuri kirjoitettu teksti katoa. */}
          <div onClick={() => { saveLampNote(); setActiveLamp(null); setActiveDoor(null); setLampAnchor(null); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
          <div data-fr8-pop="menu" style={{ ...fixedPopoverStyle(lampAnchor, 210, 230), width: "210px", maxHeight: "min(78vh, 420px)", overflowY: "auto", padding: "11px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 4px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "7px" }}>
              <span aria-hidden style={{ width: "10px", height: "10px", flexShrink: 0, display: "inline-block", clipPath: STAR_CLIP, background: `rgb(${lampRgb(lampStatuses?.[activeLamp] || "ei", lampConditions?.[activeLamp])})` }} />
              <span style={{ fontSize: "12px", fontWeight: 600 }}>Lamppu</span>
              {/* Näkyykö tämä asiakkaalle? Sama sääntö kuin `lampIsPublic`:
                  kartoitettu lamppu ei näy, vaihdettu/rikki/huomautettu näkyy. */}
              <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: "9.5px", letterSpacing: "0.05em", textTransform: "uppercase", color: ((lampStatuses?.[activeLamp] || "ei") === "vaihdettu" || lampConditions?.[activeLamp] === "rikki" || !!lampNotes?.[activeLamp]?.text) ? "rgba(124,224,166,0.9)" : "rgba(255,255,255,0.32)" }}>
                {((lampStatuses?.[activeLamp] || "ei") === "vaihdettu" || lampConditions?.[activeLamp] === "rikki" || !!lampNotes?.[activeLamp]?.text) ? "Näkyy asiakkaalle" : "Vain meille"}
              </span>
            </div>

            {(["ei", "vaihdettu"] as LampStatus[]).map((s) => {
              const cur = lampStatuses?.[activeLamp] || "ei";
              const isActive = cur === s;
              const rgb = s === "vaihdettu" ? "124,224,166" : "255,196,90";
              const hasCrew = s === "vaihdettu" && !!workers && workers.length > 0;
              return (
                <button key={s} className="status-opt-btn"
                  onClick={() => {
                    if (hasCrew) {
                      onSetLampStatus?.(activeLamp, "vaihdettu", lampChangedBy?.[activeLamp] ?? currentWorkerId);
                      setShowLampChangerPicker(false);
                      return;
                    }
                    onSetLampStatus?.(activeLamp, s);
                    setActiveLamp(null); setActiveDoor(null); setLampAnchor(null);
                  }}
                  style={{ border: `1px solid ${isActive ? "rgba(255,255,255,0.16)" : "transparent"}`, background: isActive ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: isActive ? 600 : 500 }}>
                  <span aria-hidden style={{ width: "9px", height: "9px", flexShrink: 0, display: "inline-block", clipPath: STAR_CLIP, background: `rgb(${rgb})` }} />
                  <span style={{ flex: 1, textAlign: "left" }}>{s === "vaihdettu" ? "Vaihdettu" : "Ei vaihdettu"}</span>
                  {isActive && <span style={{ fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}

            {/* TOIMIIKO LAMPPU. Oma kysymyksensä vaihtamisen rinnalla: rikkinäinen
                lamppu voi olla vaihtamatta, ja vaihdettu voi olla jo tarkastettu
                toimivaksi. Saman valinnan napautus peruu sen takaisin
                "ei tarkastettu" -tilaan. */}
            {onSetLampCondition && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Toimiiko?</div>
                {([["toimiva", "Toimii", "124,224,166"], ["rikki", "Ei toimi", "255,116,116"]] as [LampCondition, string, string][]).map(([c, label, rgb]) => {
                  const picked = lampConditions?.[activeLamp] === c;
                  return (
                    <button key={c} className="status-opt-btn"
                      onClick={() => onSetLampCondition(activeLamp, picked ? null : c)}
                      style={{ border: `1px solid ${picked ? `rgba(${rgb},0.4)` : "transparent"}`, background: picked ? `rgba(${rgb},0.12)` : "transparent", fontWeight: picked ? 600 : 500 }}>
                      <span aria-hidden style={{ width: "9px", height: "9px", flexShrink: 0, borderRadius: "50%", background: `rgb(${rgb})` }} />
                      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                      {picked && <span style={{ fontSize: "11px" }}>✓</span>}
                    </button>
                  );
                })}
                {!lampConditions?.[activeLamp] && (
                  <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", padding: "3px 4px 0" }}>Ei vielä tarkastettu.</div>
                )}
              </div>
            )}

            {/* Huomautus tästä lampusta — vapaa teksti, kirjoittaja ja aika. */}
            {(onSetLampNote || lampNotes?.[activeLamp]?.text) && (
              <FixtureNoteBlock
                note={lampNotes?.[activeLamp]}
                draft={lampNoteDraft}
                setDraft={setLampNoteDraft}
                onSave={saveLampNote}
                canWrite={!!onSetLampNote}
                workerNames={workerNames}
                placeholder="Esim. ”Kupu rikki, uusi tilattava”"
              />
            )}

            {/* Kuka vaihtoi — sama malli kuin ikkunan "kuka pesi". */}
            {(lampStatuses?.[activeLamp] || "ei") === "vaihdettu" && (lampChangedBy?.[activeLamp] || (canEdit && workers && workers.length > 0)) && (
              showLampChangerPicker && canEdit && workers && workers.length > 0 ? (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Kuka vaihtoi?</div>
                  {workers.map((w) => {
                    const picked = (lampChangedBy?.[activeLamp] ?? currentWorkerId) === w.id;
                    return (
                      <button key={w.id} className="status-opt-btn"
                        onClick={() => { onSetLampStatus?.(activeLamp, "vaihdettu", w.id); setShowLampChangerPicker(false); }}
                        style={{ border: `1px solid ${picked ? "rgba(255,255,255,0.16)" : "transparent"}`, background: picked ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: picked ? 600 : 500 }}>
                        <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, background: "rgba(124,224,166,0.16)", color: "rgba(124,224,166,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, textAlign: "left" }}>{w.name}</span>
                        {picked && <span style={{ fontSize: "11px" }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(124,224,166,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Vaihtoi <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[lampChangedBy?.[activeLamp] ?? currentWorkerId ?? ""] ?? (lampChangedBy?.[activeLamp] ?? currentWorkerId)}</strong>
                  </span>
                  {canEdit && workers && workers.length > 0 && (
                    <button onClick={() => setShowLampChangerPicker(true)} style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(124,224,166,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Vaihda</button>
                  )}
                </div>
              )
            )}

            {/* Poista lamppu — johtajat vain. */}
            {canEdit && onDeleteLamp && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button className="status-opt-btn"
                  onClick={() => {
                    if (typeof window === "undefined" || window.confirm("Poistetaanko tämä lamppu kartalta?")) {
                      onDeleteLamp(activeLamp);
                      setActiveLamp(null); setActiveDoor(null); setLampAnchor(null);
                    }
                  }}
                  style={{ color: "#ff9b9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff9b9b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  <span style={{ flex: 1, textAlign: "left" }}>Poista lamppu kartalta</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Ovi-popover — tehtävänimi, tila (tekemättä/tehty), kuka teki,
          huomautus ja poisto. Sama rakenne kuin lampulla; ero on että ovella
          on nimi, koska "ovi 3" ei kerro mitä sille pitää tehdä. */}
      {activeDoor && activeDoorPt && (
        <>
          <div onClick={() => { saveDoorNote(); saveDoorLabel(); setActiveDoor(null); setDoorAnchor(null); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }} />
          <div data-fr8-pop="menu" style={{ ...fixedPopoverStyle(doorAnchor, 218, 260), width: "218px", maxHeight: "min(78vh, 460px)", overflowY: "auto", padding: "11px", background: "rgba(16,16,20,0.92)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "15px", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 4px 9px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: "7px" }}>
              <DoorGlyph rgb={doorRgb(doorStatuses?.[activeDoor] || "ei")} size={13} glow={false} />
              <span style={{ fontSize: "12px", fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeDoorPt.label || "Ovi"}
              </span>
              <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: "9.5px", letterSpacing: "0.05em", textTransform: "uppercase", color: ((doorStatuses?.[activeDoor] || "ei") === "tehty" || !!doorNotes?.[activeDoor]?.text) ? "rgba(124,224,166,0.9)" : "rgba(255,255,255,0.32)" }}>
                {((doorStatuses?.[activeDoor] || "ei") === "tehty" || !!doorNotes?.[activeDoor]?.text) ? "Näkyy asiakkaalle" : "Vain meille"}
              </span>
            </div>

            {/* Tehtävänimi — mitä tälle ovelle pitää tehdä. */}
            {onSetDoorLabel && (
              doorLabelDraft !== null ? (
                <div style={{ marginBottom: "8px" }}>
                  <input
                    value={doorLabelDraft}
                    onChange={(e) => setDoorLabelDraft(e.target.value.slice(0, MAX_DOOR_LABEL_LEN))}
                    onKeyDown={(e) => { if (e.key === "Enter") saveDoorLabel(); }}
                    placeholder="Esim. ”Pääovi · karmit + lasi”"
                    autoFocus
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "12.5px", outline: "none", fontFamily: "var(--font-onest, system-ui, sans-serif)", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: "7px", marginTop: "7px" }}>
                    <button onClick={() => setDoorLabelDraft(null)} style={{ padding: "7px 11px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.7)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Peru</button>
                    <button onClick={saveDoorLabel} style={{ flex: 1, padding: "7px 11px", borderRadius: "9px", border: "none", background: "#fff", color: "#0a0a0c", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>Tallenna</button>
                  </div>
                </div>
              ) : (
                <button className="status-opt-btn" onClick={() => setDoorLabelDraft(activeDoorPt.label ?? "")} style={{ color: "rgba(255,255,255,0.72)", marginBottom: "3px" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  <span style={{ flex: 1, textAlign: "left" }}>{activeDoorPt.label ? "Muuta tehtävää" : "Nimeä tehtävä"}</span>
                </button>
              )
            )}

            {(["ei", "tehty"] as DoorStatus[]).map((st) => {
              const cur = doorStatuses?.[activeDoor] || "ei";
              const isActive = cur === st;
              const rgb = doorRgb(st);
              const hasCrew = st === "tehty" && !!workers && workers.length > 0;
              return (
                <button key={st} className="status-opt-btn"
                  onClick={() => {
                    if (hasCrew) {
                      onSetDoorStatus?.(activeDoor, "tehty", doorDoneBy?.[activeDoor] ?? currentWorkerId);
                      setShowDoorDonePicker(false);
                      return;
                    }
                    onSetDoorStatus?.(activeDoor, st);
                    if (st === "ei") setShowDoorDonePicker(false);
                  }}
                  style={{ border: `1px solid ${isActive ? "rgba(255,255,255,0.16)" : "transparent"}`, background: isActive ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: isActive ? 600 : 500 }}>
                  <span aria-hidden style={{ width: "9px", height: "9px", flexShrink: 0, borderRadius: "50%", background: `rgb(${rgb})` }} />
                  <span style={{ flex: 1, textAlign: "left" }}>{st === "tehty" ? "Tehty" : "Tekemättä"}</span>
                  {isActive && <span style={{ fontSize: "11px" }}>✓</span>}
                </button>
              );
            })}

            {/* Kuka teki — sama malli kuin lampun "kuka vaihtoi". */}
            {(doorStatuses?.[activeDoor] || "ei") === "tehty" && (doorDoneBy?.[activeDoor] || (canEdit && workers && workers.length > 0)) && (
              showDoorDonePicker && canEdit && workers && workers.length > 0 ? (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: "9.5px", letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", padding: "0 4px 6px" }}>Kuka teki?</div>
                  {workers.map((w) => {
                    const picked = (doorDoneBy?.[activeDoor] ?? currentWorkerId) === w.id;
                    return (
                      <button key={w.id} className="status-opt-btn"
                        onClick={() => { onSetDoorStatus?.(activeDoor, "tehty", w.id); setShowDoorDonePicker(false); }}
                        style={{ border: `1px solid ${picked ? "rgba(255,255,255,0.16)" : "transparent"}`, background: picked ? "rgba(255,255,255,0.08)" : "transparent", fontWeight: picked ? 600 : 500 }}>
                        <span style={{ width: "18px", height: "18px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, background: "rgba(124,224,166,0.16)", color: "rgba(124,224,166,0.95)", flexShrink: 0 }}>{w.name.charAt(0).toUpperCase()}</span>
                        <span style={{ flex: 1, textAlign: "left" }}>{w.name}</span>
                        {picked && <span style={{ fontSize: "11px" }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "11.5px", color: "rgba(255,255,255,0.7)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(124,224,166,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Teki <strong style={{ color: "#fff", fontWeight: 600 }}>{workerNames?.[doorDoneBy?.[activeDoor] ?? currentWorkerId ?? ""] ?? (doorDoneBy?.[activeDoor] ?? currentWorkerId)}</strong>
                  </span>
                  {canEdit && workers && workers.length > 0 && (
                    <button onClick={() => setShowDoorDonePicker(true)} style={{ marginLeft: "auto", flexShrink: 0, background: "transparent", border: "none", color: "rgba(124,224,166,0.95)", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-onest, system-ui, sans-serif)", padding: "2px 4px" }}>Vaihda</button>
                  )}
                </div>
              )
            )}

            {(onSetDoorNote || doorNotes?.[activeDoor]?.text) && (
              <FixtureNoteBlock
                note={doorNotes?.[activeDoor]}
                draft={doorNoteDraft}
                setDraft={setDoorNoteDraft}
                onSave={saveDoorNote}
                canWrite={!!onSetDoorNote}
                workerNames={workerNames}
                placeholder="Esim. ”Lukko jumittaa, ilmoitettu isännöitsijälle”"
              />
            )}

            {canEdit && onDeleteDoor && (
              <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button className="status-opt-btn"
                  onClick={() => {
                    if (typeof window === "undefined" || window.confirm("Poistetaanko tämä ovi kartalta?")) {
                      onDeleteDoor(activeDoor);
                      setActiveDoor(null); setDoorAnchor(null);
                    }
                  }}
                  style={{ color: "#ff9b9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff9b9b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  <span style={{ flex: 1, textAlign: "left" }}>Poista ovi kartalta</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
