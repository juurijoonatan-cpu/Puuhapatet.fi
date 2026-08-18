/**
 * Read-only floor-plan map for the customer live view (/seuranta/:token).
 *
 * Deliberately a separate, lightweight component from the worker/admin
 * FloorView (which is dark-themed and fully editable). This one is read-only
 * — no drag, no add/delete, no status popovers — so the customer can only
 * watch which windows have been washed. It shares the exact same dot
 * coordinate scheme as FloorView so the markers line up identically.
 *
 * TEEMA. Ympäröivä kromi — työkalurivi, kortit, päätöslista, selite ja kuplat —
 * seuraa `theme`-propia, joten sama kartta istuu sekä vaalealle paperille että
 * tekniselle tummalle pinnalle. Oletus on `CT`, eli ilman propia näkymä on
 * täsmälleen entinen. Itse pohjapiirroksen pinta on tästä tietoinen poikkeus:
 * ks. `PLAN_SURFACE_DARK`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GigPublicView, P2PublicOffer, P2PublicView } from "@/lib/api";
import { NOTE_KINDS, planImageUrl, planRenderOf, floorLabel as sharedFloorLabel } from "@shared/project";
import { eur } from "@shared/gig";
import { p2NumbersByFloor, type P2NumberingInput } from "@shared/p2";
import { getPoints, inCustomerScope, type CustomerPoint } from "@/lib/customer-progress";
import { CT, CFONT, type CustomerTheme } from "@/lib/customer-theme";

/** Position a fixed popup near an on-screen anchor rect, flipping above/below and
 *  clamping to the viewport so it's never clipped (mobile-friendly). */
function popupStyle(rect: DOMRect | null, width: number, height: number): React.CSSProperties {
  if (typeof window === "undefined" || !rect) {
    return { position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: 60 };
  }
  const margin = 10, vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(vw - width - margin, left));
  let top = rect.top - height - 10;
  if (top < margin) top = Math.min(vh - height - margin, rect.bottom + 10);
  top = Math.max(margin, top);
  return { position: "fixed", left: `${left}px`, top: `${top}px`, zIndex: 60 };
}

const FONT = CFONT;

/** `#RRGGBB` → kanavat. Yhteinen jäsennys alla oleville kahdelle apurille. */
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Vesileima teeman omasta sävystä.
 *
 * Korostukset (ambran hehku listarivillä, vihreä laatikko, navyn vihje) olivat
 * kovakoodattuja `rgba(...)`-merkkijonoja, jotka on laskettu VAALEAN paletin
 * sävyistä. Tummalla pinnalla ne katoavat, koska sävy on väärä eikä peitto.
 * Kun sama peitto lasketaan teeman sävystä, korostus säilyy molemmilla
 * pinnoilla — ja vaalealla se osuu tavuilleen entisiin arvoihin.
 */
function rgba(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Onko teeman pinta tumma?
 *
 * Komponentti saa vain paletin, ei teeman tunnusta — eikä sen kuulukaan tietää
 * teemojen nimiä. Tummuus luetaan siis paletista, jolloin mahdollinen kolmas
 * teema toimii ilman muutosta tänne. Kaava on tavallinen havaittu kirkkaus;
 * tarkempi WCAG-luminanssi antaisi näillä paleteilla saman vastauksen.
 */
function isDarkSurface(hex: string): boolean {
  const [r, g, b] = rgbOf(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/**
 * POHJAPIIRROKSEN PINTA PYSYY VAALEANA MYÖS TUMMASSA TEEMASSA.
 *
 * Kaksi syytä, kumpikin sitova:
 *
 * 1. KUVA. Viivapiirros on vaaleaa viivaa LÄPINÄKYVÄLLÄ pohjalla, ja se
 *    käännetään (`invert(1)`) mustaksi viivaksi. Käännös ei koske
 *    läpinäkyvyyttä, joten tummalla alustalla tuloksena olisi mustaa viivaa
 *    mustalla — kartta katoaisi kokonaan. Valokuvapohja taas on lähes aina
 *    vaalea ruudunkaappaus, joten sekin haluaa vaalean alustan ympärilleen.
 *    Vaihtoehto olisi jättää käännös tekemättä tummassa teemassa (kuten
 *    tekijän näkymässä tehdään), mutta silloin `planRender`in merkitys
 *    muuttuisi ehdosta "millainen kuva" ehdoksi "millainen kuva ja teema" —
 *    eikä se auttaisi valokuvapohjaa lainkaan.
 *
 * 2. MERKIT. Pisteiden värit (pesty / kesken / pesemättä sekä 1. ja 2.
 *    prioriteetti) on valittu ja tarkistettu värinäön häiriöiden kannalta
 *    NIMENOMAAN vaaleaa vasten: vaalea roosa ja khaki eivät erotu toisistaan
 *    lähes mustalla. Sama koskee valkoisia renkaita, kuplia ja zoomausnappeja.
 *    Kun alusta pysyy vaaleana, koko merkkikerros säilyy sellaisena kuin se on
 *    tarkistettu — eikä sitä tarvitse teemata lainkaan.
 *
 * Tummassa teemassa pinta himmennetään lämpimäksi paperiksi: lähes mustan
 * sivun vieressä puhdas valkoinen häikäisee. Himmennettynäkin se kantaa mustan
 * viivan yli 16:1 kontrastilla, joten piirros ei kärsi.
 */
const PLAN_SURFACE_DARK = "#E8E5DD";

/** Kartan pinnan päällä olevat merkit ja ohjaimet käyttävät AINA vaaleaa
 *  palettia — pinta on vaalea kummassakin teemassa, ks. yllä. */
const PLAN = CT;

const MIN_SCALE = 1, MAX_SCALE = 5;
const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

type WindowStatus = "ei" | "kesken" | "pesty";
type Point = CustomerPoint;

type MapData = NonNullable<GigPublicView["map"]>;

// Same colour scheme as FloorView, tuned to read on a light background.
function dotColor(p: 1 | 2, status: WindowStatus): string {
  if (status === "pesty") return p === 1 ? "#E03B3B" : "#E0A800";
  if (status === "kesken") return "#7C5CD6";
  return p === 1 ? "#F4A6C0" : "#D9C97E";
}

const LEGEND: { label: string; color: string }[] = [
  { label: "Pesemättä", color: "#F4A6C0" },
  { label: "Kesken", color: "#7C5CD6" },
  { label: "Pesty", color: "#E03B3B" },
  { label: "Ei tässä sopimuksessa", color: "#D9C97E" },
];

// Phase-2 legend describes the NUMBERED badge colours (map shows numbers, not
// prices — the euros live in the list below).
const LEGEND_P2: { label: string; color: string }[] = [
  { label: "Hintaehdotus odottaa sinua", color: "#1F3B57" },
  { label: "Vastatarjouksesi", color: "#E0A800" },
  { label: "Sovittu ✓", color: "#3E7C59" },
  { label: "Ehdottamasi (odottaa hintaa)", color: "#FFFFFF" },
];

/** P2 numbered-badge colors by negotiation state ("none" = priced not yet).
 *  Merkit istuvat pohjapiirroksen vaalealla alustalla, joten ne käyttävät
 *  `PLAN`-palettia eivätkä teemaa: teeman tumma navy on VAALEA aksentti, ja
 *  siitä tulisi vaalealle alustalle valkoinen numero vaalealla pohjalla. */
type P2BadgeState = P2PublicOffer["status"] | "none";
function p2BadgeStyle(state: P2BadgeState): { bg: string; fg: string; border: string } {
  switch (state) {
    case "proposed":  return { bg: PLAN.navy, fg: "#fff",     border: "#fff" };
    case "countered": return { bg: "#E0A800", fg: "#1A1A1A",  border: "#fff" };
    case "locked":    return { bg: "#3E7C59", fg: "#fff",     border: "#fff" };
    case "declined":  return { bg: "#EDEBE4", fg: "#9A988F",  border: "#fff" };
    default:          return { bg: "#FFFFFF", fg: PLAN.navy,  border: PLAN.navy }; // not priced yet
  }
}

/** Actions the customer can take on P2 offers — wired to the API by the parent.
 *  Each returns an error message to show inline, or null on success. */
export interface P2CustomerActions {
  accept: (items: { key: string; priceCents: number; version: number }[]) => Promise<string | null>;
  counter: (key: string, counterCents: number, version: number) => Promise<string | null>;
  decline: (key: string, version: number) => Promise<string | null>;
  /** Palauttaa lisätyn ikkunan avaimen — sitä tarvitaan toiveen kirjaamiseen
   *  ja siihen että juuri lisätty piste erottuu kartalla muista. */
  addPoint: (floor: string, x: number, y: number) => Promise<{ key: string } | { error: string }>;
  removePoint: (key: string) => Promise<string | null>;
  /** Asiakkaan toive omasta ehdotuksestaan: hinta-arvio ja/tai viesti. */
  setWish: (key: string, cents: number | null, note: string) => Promise<string | null>;
  /** Terms not accepted yet → the parent opens the terms dialog. */
  requireTerms: () => void;
}

export default function CustomerFloorMap({ map, p2, p2Actions, onLoadObservationImage, planUrlBase, theme = CT }: {
  map: MapData;
  /**
   * Asiakasnäkymän paletti. Oletus `CT` = entinen vaalea paperi, joten ilman
   * tätä propia mikään ei muutu. Seurantasivu antaa keikan oman teeman.
   */
  theme?: CustomerTheme;
  /**
   * Pohjakuvareitin etuliite tälle seurantalinkille
   * (`/api/gig/:token/plan/`). Tarvitaan vain kun kerroksella on LADATTU kuva;
   * staattinen `planBase` toimii ilman. Ks. `api.planUrlBaseForGig`.
   */
  planUrlBase?: string;
  /** P2 negotiation state — pills + offer popups render only when enabled. */
  p2?: P2PublicView | null;
  p2Actions?: P2CustomerActions;
  /**
   * Hae yhden havainnon kuva pyynnöstä. Seurantasivu pollaa itseään, joten kuvat
   * eivät tule mukana joka kierroksella — vain `hasImage`-lippu. Ilman tätä
   * propia teksti näkyy normaalisti, kuva ei.
   */
  onLoadObservationImage?: (key: string) => Promise<string | undefined>;
}) {
  // `T` on tämän tiedoston vakiintunut lyhenne paletille; se osoittaa nyt
  // propiin moduulitason vakion sijaan, joten kaikki alla oleva kromi seuraa
  // teemaa ilman että jokaista käyttöä tarvitsi nimetä uudelleen.
  const T = theme;
  /**
   * TEEMAN JOHDANNAISET.
   *
   * Nämä ovat kohtia joissa pelkkä poletin vaihto ei riitä, koska sävyn ROOLI
   * kääntyy pinnan mukana. Jokainen arvo on vaalealla teemalla täsmälleen se
   * merkkijono joka tiedostossa ennen luki, joten paperiteema ei muutu.
   */
  const dark = isDarkSurface(T.paper);
  /**
   * Teksti täytetyn aksenttinapin päällä. Vaalean teeman navy ja vihreä ovat
   * TUMMIA täyttöjä (valkoinen teksti); tumman teeman samat poletit ovat
   * VAALEITA aksentteja, joilla valkoinen teksti jäisi lukukelvottomaksi —
   * niiden päällä teksti on lähes musta (kontrasti ~10:1).
   */
  const onAccent = dark ? T.paper : "#fff";
  /** Kohotettu pinta: kupla ei saa olla samaa sävyä kuin sen alla oleva sivu. */
  const raisedBg = dark ? T.fill : T.card;
  /** Valitun kerrosvälilehden pinta. Vaalealla kortti NOUSEE täytöstä; tummalla
   *  nouseminen tarkoittaa vaaleampaa askelta, joten valinta on `hair`. */
  const tabActiveBg = dark ? T.hair : T.card;
  const tabActiveShadow = dark ? "0 1px 3px rgba(0,0,0,0.5)" : "0 1px 3px rgba(0,0,0,0.10)";
  const popupShadow = dark ? "0 18px 50px rgba(0,0,0,0.72)" : "0 14px 40px rgba(0,0,0,0.22)";
  /** Vahvistusta odottavan vihreän napin toinen askel: vaalealla tummempi,
   *  tummalla vaaleampi — kummallakin "painettu" erottuu perustilasta. */
  const greenArmed = dark ? "#7CE8A4" : "#2f6347";
  /** Ambran teksti. Vaalean teeman tumma oliivi katoaisi mustalle. */
  const amberText = dark ? T.amber : "#8A6A00";
  /** Vihreä ilmoituspinta (työn alla nyt / sovitut). Vaalealla opaakki minttu
   *  kuten ennen; tummalla läpikuultava vihreä, koska minttu olisi valolaikku. */
  const greenBg = dark ? rgba(T.green, 0.12) : "#EAF6EE";
  const greenEdge = dark ? rgba(T.green, 0.32) : "#BFE3CC";
  const greenText = dark ? T.green : "#1F5B36";
  /** Virheteksti. Vaalean teeman syvä punainen jää tummalla kortilla 2,9:1 —
   *  virheilmoitus on juuri se teksti jota ei saa joutua arvaamaan. */
  const danger = dark ? "#FF8A80" : "#B4231F";
  /**
   * Lomakekentän pinta tummassa teemassa. Vaalealla teemalla tämä on tyhjä,
   * jolloin kentät piirtyvät täsmälleen kuten ennen (osa niistä nojaa selaimen
   * oletukseen). Levitetään kentän omien tyylien JÄLKEEN.
   */
  const darkField: React.CSSProperties = dark ? { background: T.fill, color: T.ink } : {};

  const floors = map.building.floors.length ? map.building.floors : ["1"];
  const activeZone = map.activeZone ?? null;
  // Open on the floor where work is happening now, if any.
  const [floor, setFloor] = useState(() =>
    activeZone && floors.includes(activeZone.floor) ? activeZone.floor : floors[0]);

  const points = useMemo(() => getPoints(floor, map), [floor, map]);
  const floorNotes = map.notes?.[floor] ?? [];
  const observations = map.observations ?? {};
  // The window whose observation popup is open (+ the badge rect to anchor it).
  const [openObs, setOpenObs] = useState<{ key: string; rect: DOMRect } | null>(null);
  const openObservation = openObs ? observations[openObs.key] : undefined;
  // Havaintokuvat ladataan yksitellen pyynnöstä ja pidetään muistissa, jotta
  // saman kuplan avaaminen uudestaan ei hae kuvaa uudestaan.
  const [obsImages, setObsImages] = useState<Record<string, string>>({});
  const obsFetched = useRef<Set<string>>(new Set());
  const wantObservationImage = useCallback((key: string | null | undefined) => {
    if (!key || !onLoadObservationImage) return;
    if (obsFetched.current.has(key)) return;
    obsFetched.current.add(key);
    void onLoadObservationImage(key)
      .then((url) => { if (url) setObsImages((cur) => ({ ...cur, [key]: url })); })
      .catch(() => { obsFetched.current.delete(key); }); // salli uusi yritys
  }, [onLoadObservationImage]);
  /** Havainnon kuva: suoraan mukana tullut, jo haettu, tai undefined. */
  const obsImageFor = (key: string) =>
    observations[key]?.imageDataUrl ?? obsImages[key];
  // Kerroksen oma luku lasketaan samalla laajuussäännöllä kuin sivun
  // kokonaisluku (`inCustomerScope`), jotteivät ne voi olla eri mieltä samalla
  // ruudulla: keltaiset ovat mukana vasta kun vaihe 2 on auki.
  const scoped = points.filter((pt) => inCustomerScope(pt, p2, map.statuses[pt.key] === "pesty"));
  const washed = scoped.filter((p) => map.statuses[p.key] === "pesty").length;
  const total = scoped.length;
  const pct = total > 0 ? Math.round((washed / total) * 100) : 0;

  // ── P2 negotiation state ──────────────────────────────────────────────────
  const p2On = !!(p2?.enabled && p2Actions);
  const [openOffer, setOpenOffer] = useState<{ key: string; rect: DOMRect } | null>(null);
  // Sekä 💬-kupla että hintakupla näyttävät saman havainnon, joten kuva haetaan
  // aina kun jompikumpi avautuu — ei koskaan etukäteen.
  useEffect(() => { wantObservationImage(openObs?.key); }, [openObs?.key, wantObservationImage]);
  useEffect(() => { wantObservationImage(openOffer?.key); }, [openOffer?.key, wantObservationImage]);
  const [p2Busy, setP2Busy] = useState(false);
  const [p2Error, setP2Error] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  /** Tässä lisäysistunnossa merkityt avaimet. Ne pysyvät kirkkaina kun muut
   *  himmenevät, ja niistä lasketaan kuittaus ("Lisätty 3 ikkunaa"). */
  const [sessionKeys, setSessionKeys] = useState<string[]>([]);
  const addedCount = sessionKeys.length;
  /** Mille juuri lisätylle ikkunalle kirjoitetaan toivetta. */
  const [wishFor, setWishFor] = useState<string | null>(null);
  const [wishPrice, setWishPrice] = useState("");
  const [wishNote, setWishNote] = useState("");
  const [wishBusy, setWishBusy] = useState(false);

  /**
   * Yksi napautus = yksi ikkuna + heti mahdollisuus kertoa siitä.
   *
   * Ennen napautus loi pisteen ja siihen se jäi: asiakas ei voinut kertoa mitä
   * hän olisi valmis maksamaan eikä mistä ikkunasta on kyse. Meille tuli
   * pelkkä koordinaatti ja hinnoittelu alkoi arvauksella. Lomake on
   * VAPAAEHTOINEN — pisteen voi jättää sellaisenaan ja napauttaa seuraavaa.
   */
  async function addOneWindow(f: string, x: number, y: number) {
    if (!p2Actions) return;
    setP2Busy(true); setP2Error(null);
    const res = await p2Actions.addPoint(f, x, y);
    setP2Busy(false);
    if ("error" in res) { setP2Error(res.error); return; }
    setSessionKeys((ks) => [...ks, res.key]);
    setWishFor(res.key);
    setWishPrice(""); setWishNote("");
  }

  async function saveWish(skip = false) {
    const key = wishFor;
    if (!key || !p2Actions) { setWishFor(null); return; }
    if (skip) { setWishFor(null); setWishPrice(""); setWishNote(""); return; }
    const n = Number(wishPrice.replace(",", "."));
    const cents = Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
    setWishBusy(true);
    const err = await p2Actions.setWish(key, cents, wishNote.trim());
    setWishBusy(false);
    if (err) { setP2Error(err); return; }
    setWishFor(null); setWishPrice(""); setWishNote("");
  }
  // Phase-2 opens focused on just the extra (yellow) windows — the reds are done,
  // so the map starts clean and only the numbered Priority 2 points carry it.
  const [onlyYellow, setOnlyYellow] = useState(p2On);
  // Map ↔ list bridge: scroll the map into view / pulse a badge ("Kartalla"),
  // and scroll a list row into view / pulse it ("Näytä listassa").
  const mapRef = useRef<HTMLDivElement | null>(null);
  const listRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [hiRow, setHiRow] = useState<string | null>(null);

  // ── Map zoom + pan ─────────────────────────────────────────────────────────
  // The building has a lot of windows; on a desktop especially the customer
  // needs to zoom into a wing and pan around. Pinch (touch), wheel (mouse) and
  // +/−/reset buttons all drive one transform on the plan layer.
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ startDist: number; startS: number } | null>(null);
  const pan = useRef<{ x0: number; y0: number; ox: number; oy: number; id: number; active: boolean } | null>(null);
  /** Liikkuiko sormi tarpeeksi, että ele oli veto eikä napautus? Estää
   *  lisäämästä ikkunaa kartan siirron päätteeksi. */
  const dragMoved = useRef(false);
  const zoomed = view.s > 1.01 || Math.abs(view.x) > 1 || Math.abs(view.y) > 1;
  const resetView = () => setView({ s: 1, x: 0, y: 0 });
  const zoomBy = (f: number) => setView((v) => ({ ...v, s: clampScale(v.s * f) }));
  // Reset the view whenever the floor changes so a new plan opens fitted.
  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [floor]);
  // Wheel zoom needs a non-passive native listener to call preventDefault.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, s: clampScale(v.s * (e.deltaY < 0 ? 1.12 : 0.89)) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [addMode]);

  function onPtrDown(e: React.PointerEvent) {
    // LISÄYSTILASSAKIN SAA LIIKUTTAA KARTTAA. Nämä käsittelijät palasivat
    // ennen heti kun `addMode` oli päällä, joten kartta jäätyi juuri silloin
    // kun sitä eniten tarvitsee liikuttaa: ikkunaa ei voinut merkitä jos se ei
    // sattunut olemaan näkyvissä. Vedon ja napautuksen erottaa jo olemassa
    // oleva 5 pikselin kynnys alla — sama ele toimii molemmissa tiloissa.
    dragMoved.current = false;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      const [a, b] = Array.from(ptrs.current.values());
      pinch.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startS: view.s };
      pan.current = null;
    } else if (ptrs.current.size === 1) {
      pan.current = { x0: e.clientX, y0: e.clientY, ox: view.x, oy: view.y, id: e.pointerId, active: false };
    }
  }
  function onPtrMove(e: React.PointerEvent) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2 && pinch.current) {
      const [a, b] = Array.from(ptrs.current.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      // KAATUMISEN JUURISYY: `setView`in päivitysfunktio suoritetaan VASTA
      // myöhemmin, ei tässä. Ehto yllä tarkisti `pinch.current`in nyt, mutta
      // funktion sisällä luettiin `pinch.current!` uudestaan — ja siihen
      // mennessä `onPtrUp` oli ehtinyt nollata sen. Tulos:
      // "null is not an object (evaluating 'pinch.current.startS')", koko sivu
      // kaatui virherajaan kesken nipistyszoomin.
      //
      // Arvot luetaan nyt talteen ENNEN päivitysfunktiota, jolloin sen sisällä
      // ei ole yhtään refiä johon aika voisi vaikuttaa.
      const { startS, startDist } = pinch.current;
      setView((v) => ({ ...v, s: clampScale(startS * (d / (startDist || 1))) }));
      return;
    }
    const p = pan.current;
    if (p && p.id === e.pointerId) {
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      if (!p.active) {
        if (Math.hypot(dx, dy) < 5) return; // a tap, not a drag → let badge clicks through
        p.active = true;
        dragMoved.current = true;
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      setView((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
    }
  }
  function onPtrUp(e: React.PointerEvent) {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (pan.current && pan.current.id === e.pointerId) pan.current = null;
    if (ptrs.current.size === 0) setDragging(false);
  }
  const openOfferData = openOffer && p2 ? p2.offers[openOffer.key] ?? null : null;
  const customerAdded = p2On ? new Set(p2!.customerAddedKeys) : new Set<string>();
  const openOfferIsMine = openOffer ? customerAdded.has(openOffer.key) : false;

  // ── Organized proposal list (across ALL floors) ─────────────────────────────
  // With every yellow priced, tapping tiny dots among overlapping pills is fiddly.
  // A clean grouped list — proposals to answer, your counter-offers, and the
  // agreed windows — is the primary way to review and respond. The map stays for
  // spatial context. Per-key counter input lives here.
  const [listCounterKey, setListCounterKey] = useState<string | null>(null);
  const [listCounterVal, setListCounterVal] = useState("");
  // Avoimet kerrosryhmät päätöslistassa. Sadan avoimen hintaehdotuksen lista on
  // loputon vieritys, joten kerrokset ovat oletuksena kiinni ja aukeavat
  // otsikosta. "Hyväksy kerros" toimii silti ilman avaamista.
  const [openFloors, setOpenFloors] = useState<Record<string, boolean>>({});
  const allYellow = useMemo(() => {
    if (!p2On) return [] as { key: string; floor: string; idx: number; offer: P2PublicOffer }[];
    const out: { key: string; floor: string; idx: number; offer: P2PublicOffer }[] = [];
    for (const f of floors) {
      getPoints(f, map).forEach((pt, i) => {
        if (pt.p !== 2) return;
        const offer = p2!.offers[pt.key];
        if (offer && offer.status !== "declined") out.push({ key: pt.key, floor: f, idx: i, offer });
      });
    }
    return out;
  }, [p2On, floors, map, p2]);
  const proposedList = allYellow.filter((o) => o.offer.status === "proposed");
  const counteredList = allYellow.filter((o) => o.offer.status === "countered");
  const lockedList = allYellow.filter((o) => o.offer.status === "locked");
  const allProposedSum = proposedList.reduce((s, o) => s + o.offer.priceCents, 0);
  const lockedSum = lockedList.reduce((s, o) => s + (o.offer.lockedCents ?? o.offer.priceCents), 0);
  // Tilan nimi tulee keikalta: yhden huoneen keikalla "1. kerros" on väärä sana.
  const floorLabel = (f: string) => sharedFloorLabel(map.building as any, f);
  const isPhotoPlan = planRenderOf(map.building as any) === "photo";
  // Group the open proposals BY FLOOR so the customer can review and accept
  // floor by floor (a whole floor's price at once), not scroll one flat list.
  const proposedFloors = floors
    .map((f) => ({ floor: f, items: proposedList.filter((o) => o.floor === f) }))
    .filter((g) => g.items.length > 0);
  // Stable per-floor Priority 2 numbering so the map badges and the list rows
  // always agree ("ikkuna 10" on the map = "ikkuna 10" in the list).
  // Numerointi tulee jaetusta funktiosta, samasta jota perustajien kartta ja
  // laskun erittely käyttävät — kolme näkymää ei voi antaa samalle ikkunalle
  // kolmea eri numeroa.
  const p2Number = useMemo(
    () => p2NumbersByFloor({
      building: { floors }, marks: map.marks, customMarks: map.customMarks,
      deleted: map.deleted, statuses: map.statuses, washedBy: {},
    } as unknown as P2NumberingInput),
    [floors, map],
  );
  // Has the customer engaged with phase-2 yet (any yellow priced or added)?
  // Drives an inviting empty-state nudge that expects them to add windows.
  const yellowCount = p2On ? points.filter((pt) => pt.p === 2).length : 0;
  const anyYellowActivity = p2On && points.some((pt) => pt.p === 2 && p2!.offers[pt.key]);

  const closeOffer = () => { setOpenOffer(null); setP2Error(null); };

  // "Kartalla" → jump to the window's floor, scroll the map into view and pulse
  // its numbered badge so the customer can locate it among many.
  function jumpToMap(key: string, f: string) {
    setFloor(f);
    setOnlyYellow(true);
    resetView();
    closeOffer();
    setFocusKey(key);
    requestAnimationFrame(() => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    window.setTimeout(() => setFocusKey((k) => (k === key ? null : k)), 2600);
  }
  // Map badge popup → scroll down to that window's row in the decision list,
  // where accept / counter / decline live (the map itself stays planning-only).
  function jumpToList(key: string) {
    closeOffer();
    // Rivi voi olla kiinni olevan kerrosryhmän sisällä, jolloin sitä ei ole
    // edes piirretty. Avataan ryhmä ensin ja vieritetään vasta kun rivi on
    // olemassa — muuten "Näytä listassa" ei tekisi mitään.
    const f = allYellow.find((o) => o.key === key)?.floor ?? key.split("#")[0];
    setOpenFloors((s) => (s[f] ? s : { ...s, [f]: true }));
    setHiRow(key);
    window.setTimeout(() => listRowRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    window.setTimeout(() => setHiRow((k) => (k === key ? null : k)), 2600);
  }

  // Terms-gated actions = PRICE COMMITMENTS (accept / counter). These lock or
  // negotiate an order, so the customer accepts the light terms first.
  async function runP2<A extends unknown[]>(fn: (...args: A) => Promise<string | null>, ...args: A) {
    if (!p2Actions) return;
    if (!p2?.termsAccepted) { p2Actions.requireTerms(); return; }
    await runP2Free(fn, ...args);
  }
  // Free actions = PLANNING (add / remove own window, decline). No commitment, so
  // the customer can explore and prepare the map before any terms — a logical order.
  /** Palauttaa `true` kun toiminto onnistui — kutsuja voi luottaa tulokseen. */
  async function runP2Free<A extends unknown[]>(fn: (...args: A) => Promise<string | null>, ...args: A): Promise<boolean> {
    if (!p2Actions) return false;
    setP2Busy(true); setP2Error(null);
    const err = await fn(...args);
    setP2Busy(false);
    if (err) { setP2Error(err); return false; }
    closeOffer();
    return true;
  }

  // One open-proposal row (accept / counter / decline). Extracted so the floor
  // groups below stay readable.
  const renderProposedRow = (o: { key: string; floor: string; idx: number; offer: P2PublicOffer }) => (
    <div key={o.key} ref={(el) => { listRowRefs.current[o.key] = el; }} style={{ padding: "10px 12px", borderRadius: 11, background: hiRow === o.key ? rgba(T.amber, 0.16) : T.paper, border: `1px solid ${hiRow === o.key ? T.amber : T.hair}`, transition: "background .4s, border-color .4s", scrollMarginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: "50%", background: T.navy, color: onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{p2Number[o.key] ?? o.idx + 1}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Ikkuna {p2Number[o.key] ?? o.idx + 1}{customerAdded.has(o.key) ? " · sinun" : ""}</div>
          <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{eur(o.offer.priceCents)}<span style={{ fontSize: 11.5, color: T.muted, fontWeight: 500 }}> / ikkuna</span></div>
        </div>
        <button onClick={() => jumpToMap(o.key, o.floor)} title="Näytä kartalla" style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.navy, fontFamily: FONT, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Kartalla</button>
      </div>
      {listCounterKey === o.key ? (
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          <input type="number" inputMode="decimal" min={1} step="0.5" autoFocus value={listCounterVal} onChange={(e) => setListCounterVal(e.target.value)} placeholder="€ / ikkuna" data-cfm-field=""
            style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, fontFamily: FONT, fontSize: 14, fontVariantNumeric: "tabular-nums", ...darkField }} />
          <button disabled={p2Busy || !(Number(listCounterVal.replace(",", ".")) > 0)}
            onClick={() => { const v = Number(listCounterVal.replace(",", ".")); if (!(v > 0)) return; void runP2(p2Actions!.counter, o.key, Math.round(v * 100), o.offer.version).then(() => { setListCounterKey(null); setListCounterVal(""); }); }}
            style={{ padding: "9px 13px", borderRadius: 9, border: "none", background: T.navy, color: onAccent, fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}>Lähetä</button>
          <button disabled={p2Busy} onClick={() => { setListCounterKey(null); setListCounterVal(""); }} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.muted, fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✕</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          <button disabled={p2Busy} onClick={() => void runP2(p2Actions!.accept, [{ key: o.key, priceCents: o.offer.priceCents, version: o.offer.version }])}
            style={{ flex: 2, padding: "9px", borderRadius: 9, border: "none", background: T.green, color: onAccent, fontFamily: FONT, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}>Hyväksy</button>
          <button disabled={p2Busy} onClick={() => { if (!p2!.termsAccepted) { p2Actions!.requireTerms(); return; } setListCounterKey(o.key); setListCounterVal(""); }}
            style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.ink, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Vastatarjous</button>
          <button disabled={p2Busy} onClick={() => void runP2Free(p2Actions!.decline, o.key, o.offer.version)}
            style={{ padding: "9px 11px", borderRadius: 9, border: "none", background: "transparent", color: T.muted, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Ei</button>
        </div>
      )}
    </div>
  );

  /**
   * PIKAHYVÄKSYNTÄ — "hyväksy nämä".
   *
   * MIKSI: hinnat hyväksyttiin yksi ikkuna kerrallaan, kolmella napautuksella
   * per ikkuna (avaa piste → Hyväksy → vahvistus). Sadan pestyn keltaisen
   * kohdalla se on satoja napautuksia, eikä kukaan tee sitä loppuun. Palvelin
   * on osannut joukkohyväksynnän koko ajan (`/p2/accept` ottaa taulukon), joten
   * puuttui vain tapa käyttää sitä.
   *
   * MITÄ EHDOTETAAN: vain PESTYT keltaiset joilla on avoin hintaehdotus. Työ on
   * jo tehty, joten hinnan hyväksyminen on se ainoa jäljellä oleva askel — ja
   * juuri se joukko jonka asiakas haluaa kuitata kerralla. Pesemättömät jäävät
   * pois: niistä sopiminen etukäteen on eri päätös, ja ne hoituvat kartalta
   * yksi kerrallaan kuten ennenkin.
   *
   * MITÄ EI EHDOTETA: poistetut pisteet putoavat pois jo `getPoints`issa, ja
   * palvelin tarkistaa lisäksi jokaisen avaimen (`pointPriority !== 2`), joten
   * kartalta poistettu tai punaiseksi vaihdettu ikkuna ei voi tulla
   * hyväksytyksi vaikka se olisi ollut listalla näkymän latautuessa.
   */
  const quickAccept = useMemo(() => {
    if (!p2?.enabled) return { rows: [], totalCents: 0 };
    const rows: { key: string; floor: string; priceCents: number; version: number; note?: string }[] = [];
    for (const f of floors) {
      for (const pt of getPoints(f, map)) {
        if (pt.p !== 2) continue;
        if (map.statuses[pt.key] !== "pesty") continue;
        const o = p2.offers[pt.key];
        if (!o || !o.priceCents) continue;
        // AIEMMIN HYLÄTYT OVAT MUKANA TAVALLISINA RIVEINÄ. "Ei" on tässä
        // näkymässä hyväksyntänapin vieressä ja osuu vahingossa, ja ikkuna on
        // jo pesty. Erillinen merkintä olisi vain kohinaa: asiakkaan kannalta
        // tilanne on sama kuin muillakin — työ on tehty, hinta odottaa.
        if (o.status !== "proposed" && o.status !== "declined") continue;
        rows.push({ key: pt.key, floor: f, priceCents: o.priceCents, version: o.version, note: o.note ?? undefined });
      }
    }
    return { rows, totalCents: rows.reduce((n, r) => n + r.priceCents, 0) };
  }, [floors, map, p2]);

  // Kaksivaiheinen nappi: ensimmäinen painallus näyttää mitä ollaan
  // hyväksymässä, toinen tekee sen. Sadan ikkunan hyväksyntä on iso päätös
  // eikä se saa lähteä vahingossa — mutta se ei myöskään ansaitse dialogia.
  const [armed, setArmed] = useState<string | null>(null);   // null | "all" | floor
  const [showList, setShowList] = useState(false);

  async function acceptGroup(scope: string) {
    // Vain "all" on jäljellä: kerroskohtainen hyväksyntä pilkkoi yhden
    // päätöksen useaksi napiksi kertomatta mitään olennaista.
    const items = (scope === "all" ? quickAccept.rows : quickAccept.rows.filter((r) => r.floor === scope))
      .map((r) => ({ key: r.key, priceCents: r.priceCents, version: r.version }));
    if (!items.length) return;
    setArmed(null);
    await runP2(p2Actions!.accept, items);
  }

  const quickAcceptPanel = p2?.enabled && p2Actions && quickAccept.rows.length > 0 ? (
    <div style={{
      marginBottom: 16, padding: "18px 18px 16px", borderRadius: 20,
      background: rgba(T.green, 0.07), border: `1px solid ${rgba(T.green, 0.28)}`,
    }}>
      {/* Yksi selkeä laatikko: montako ikkunaa ja mitä ne maksavat. Tämän
          ylin rivi kertoo että työ on JO TEHTY — muuten hylkääminen näyttää
          yhtä luontevalta vaihtoehdolta kuin hyväksyminen, vaikka ikkuna on
          jo pesty. Kerroskohtaiset pillerit poistettiin: ne pilkkoivat yhden
          päätöksen viideksi eivätkä kertoneet mitään olennaista. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16, letterSpacing: "-0.02em" }}>Jo pesty — odottaa hyväksyntääsi</strong>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
          {quickAccept.rows.length}
        </span>
        <span style={{ fontSize: 14, color: T.muted }}>ikkunaa ·</span>
        <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{eur(quickAccept.totalCents)}</span>
      </div>
      <p style={{ margin: "8px 0 13px", fontSize: 13, color: T.muted, lineHeight: 1.55 }}>
        Nämä ikkunat on jo pesty. Hyväksy hinnat, niin ne siirtyvät laskutukseen.
      </p>


      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          disabled={p2Busy}
          onClick={() => { if (!p2.termsAccepted) { p2Actions.requireTerms(); return; } armed === "all" ? void acceptGroup("all") : setArmed("all"); }}
          style={{
            padding: "10px 15px", borderRadius: 10, border: "none",
            background: armed === "all" ? greenArmed : T.green, color: onAccent,
            fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1,
          }}
        >
          {armed === "all"
            ? `Vahvista — hyväksy ${quickAccept.rows.length} kpl (${eur(quickAccept.totalCents)})`
            : "Hyväksy kaikki"}
        </button>
        {armed === "all" && (
          <button onClick={() => setArmed(null)}
            style={{ padding: "10px 13px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.card, color: T.muted, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            Peru
          </button>
        )}
        <button onClick={() => setShowList((v) => !v)}
          style={{ padding: "10px 13px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.card, color: T.ink, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          {showList ? "Piilota" : "Katso mitkä"}
        </button>
      </div>

      {showList && (
        <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {quickAccept.rows.map((r) => (
            <button key={r.key} onClick={() => jumpToMap(r.key, r.floor)}
              style={{ display: "flex", flexDirection: "column", gap: 2, padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.hair}`, background: T.card, cursor: "pointer", fontFamily: FONT, fontSize: 12.5, textAlign: "left" }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%" }}>
                <span style={{ color: T.muted }}>Krs {r.floor}</span>
                <b>{eur(r.priceCents)}</b>
              </span>
              {/* Perustaja voi kirjoittaa ikkunalle perustelun kartalta; se
                  näkyy tässä, siinä kohdassa jossa hinta hyväksytään. */}
              {r.note && <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.4 }}>{r.note}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div style={{ fontFamily: FONT, color: T.ink }}>
      <style>{`
        @keyframes cfmZone{0%,100%{box-shadow:0 0 0 4px rgba(62,124,89,0.16)}50%{box-shadow:0 0 0 9px rgba(62,124,89,0.04)}}
        @keyframes cfmPillPop{0%{transform:translate(-50%,9px) scale(0.4);opacity:0}60%{transform:translate(-50%,9px) scale(1.18)}100%{transform:translate(-50%,9px) scale(1);opacity:1}}
        @keyframes cfmLockPulse{0%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 0 rgba(62,124,89,0.5)}70%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 10px rgba(62,124,89,0)}100%{box-shadow:0 1px 4px rgba(0,0,0,0.28),0 0 0 0 rgba(62,124,89,0)}}
        @keyframes cfmAddNudge{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
        @keyframes cfmMineHalo{0%,100%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(31,59,87,0.35)}50%{box-shadow:0 0 0 2px #fff,0 0 0 7px rgba(31,59,87,0.08)}}
        @keyframes cfmFocus{0%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(31,59,87,0.9)}70%{box-shadow:0 0 0 2px #fff,0 0 0 15px rgba(31,59,87,0)}100%{box-shadow:0 0 0 2px #fff,0 0 0 0 rgba(31,59,87,0)}}
        @media (prefers-reduced-motion: reduce){
          [data-cfm-anim]{animation:none !important}
        }
        /* Selaimen oletusvihjeteksti on laskettu vaaleaa kenttää varten ja jää
           tummalla pinnalla alle 4:1. Sitä ei voi asettaa tyylimääreenä, joten
           se tulee tästä — ja vain tummassa teemassa, jotta vaalea pysyy
           ennallaan. */
        ${dark ? `[data-cfm-field]::placeholder{color:${T.muted};opacity:1}` : ""}
      `}</style>

      {/* Kokonaisluku ei ole enää täällä: se on sivun pääkortissa (yksi luku,
          yksi paikka). Kartta kertoo vain tämän kerroksen tilanteen. */}
      {quickAcceptPanel}

      {/* "Work happening here now" banner */}
      {activeZone && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, padding: "9px 13px", borderRadius: 11, background: greenBg, border: `1px solid ${greenEdge}`, color: greenText, fontSize: 13 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: T.green, animation: "ppPulse 1.8s ease-in-out infinite", flexShrink: 0 }} />
          <span>Työn alla juuri nyt{activeZone.label ? `: ${activeZone.label}` : ""} — <strong>kerros {activeZone.floor}</strong></span>
          {floor !== activeZone.floor && (
            <button onClick={() => setFloor(activeZone.floor)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: greenText, fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline", fontFamily: FONT }}>
              Näytä
            </button>
          )}
        </div>
      )}

      {/* Toolbar — a clean, always-aligned two-row layout so it never wraps into
          an awkward shape on mobile: the floor tabs scroll horizontally on their
          own row, and the filter + progress sit on a tidy second row. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: 5, background: T.fill, borderRadius: 14, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: T.muted, padding: "0 6px 0 9px", flexShrink: 0 }}>KRS</span>
          {floors.map((f) => {
            const active = f === floor;
            return (
              <button
                key={f}
                onClick={() => setFloor(f)}
                style={{ minWidth: 38, height: 34, padding: "0 10px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: active ? 700 : 600, letterSpacing: "-0.01em", background: active ? tabActiveBg : "transparent", color: active ? T.ink : T.muted, boxShadow: active ? tabActiveShadow : "none", transition: "all .15s", flexShrink: 0 }}
              >
                {f}
              </button>
            );
          })}
        </div>
        {/* Kerroksen oma luku. Kokonaisedistyminen on sivun pääkortissa — tässä
            kerrotaan vain se mitä juuri tämä pohjapiirros näyttää. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {p2On && yellowCount > 0 ? (
            <button
              onClick={() => setOnlyYellow((v) => !v)}
              title="Näytä kartalla vain Priority 2 -ikkunat (keltaiset)"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600, border: `1px solid ${onlyYellow ? T.amber : T.hair}`, background: onlyYellow ? rgba(T.amber, 0.14) : T.card, color: onlyYellow ? amberText : T.muted, flexShrink: 0 }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: T.amber }} />
              {onlyYellow ? "Näytä kaikki" : "Vain Priority 2"}
            </button>
          ) : <span />}
          <div style={{ fontSize: 13, color: T.muted, textAlign: "right" }}>
            Tässä kerroksessa pesty <strong style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{pct} %</strong>
          </div>
        </div>
      </div>

      {/* Plan + dots — light background, black walls. The plan PNG is a light
          line drawing on a transparent background (built to read on the dark
          worker view), so on this view we invert it to draw the walls in
          black on light for clear contrast.

          Alusta pysyy vaaleana myös tummassa teemassa (himmennettynä), ja sen
          päällä olevat merkit ja ohjaimet käyttävät siksi `PLAN`-palettia
          teeman sijaan. Perustelut: ks. `PLAN_SURFACE_DARK`. */}
      <div
        ref={mapRef}
        onPointerDown={onPtrDown}
        onPointerMove={onPtrMove}
        onPointerUp={onPtrUp}
        onPointerCancel={onPtrUp}
        style={{ position: "relative", borderRadius: 12, border: `1px solid ${T.hair}`, background: dark ? PLAN_SURFACE_DARK : "#FFFFFF", padding: 12, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", scrollMarginTop: 12, touchAction: "none", cursor: addMode ? undefined : dragging ? "grabbing" : "grab" }}
      >
        {/* LISÄYSTILAN OHJAIN KARTAN PÄÄLLÄ. Ohje ja lopetus ovat siellä missä
            katse on — kartalla — eivätkä sen alapuolella, jonne piti vierittää
            jokaisen pisteen jälkeen. Laskuri kuittaa että napautus meni perille;
            ilman sitä ainoa palaute oli uusi pieni pallo pohjapiirroksessa. */}
        {p2On && addMode && (
          // `pointerEvents: none` on olennainen: palkki leijuu pohjapiirroksen
          // PÄÄLLÄ, ja ilman tätä sen alle jäävät ikkunat olisivat lisäystilassa
          // tavoittamattomissa — juuri ne ylimmän rivin ikkunat. Napautus menee
          // palkin läpi kartalle; vain "Valmis" ottaa painalluksen vastaan.
          //
          // Värit eivät seuraa teemaa: palkki leijuu pohjapiirroksen päällä, ja
          // se pinta on vaalea kummassakin teemassa. Tumma navy + valkoinen
          // teksti on siis oikein molemmilla; teeman `navy` on tummassa
          // paletissa vaalea aksentti, jolla valkoinen teksti katoaisi.
          <div style={{ position: "absolute", top: 10, left: 10, right: 56, zIndex: 21, display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 11, background: "rgba(31,59,87,0.94)", color: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,0.28)", pointerEvents: "none" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, minWidth: 0 }}>
              {addedCount > 0
                ? <>Lisätty <b style={{ fontVariantNumeric: "tabular-nums" }}>{addedCount}</b> {addedCount === 1 ? "ikkuna" : "ikkunaa"} — napauta lisää</>
                : <>Napauta ikkunan kohtaa kartalla</>}
            </span>
            <button
              disabled={p2Busy}
              onClick={() => { setAddMode(false); setSessionKeys([]); }}
              style={{ marginLeft: "auto", flexShrink: 0, padding: "7px 14px", borderRadius: 9, border: "none", background: "#fff", color: "#1F3B57", fontFamily: FONT, fontSize: 12.5, fontWeight: 800, cursor: "pointer", pointerEvents: "auto" }}
            >
              Valmis
            </button>
          </div>
        )}

        {/* Zoom controls — pinch/wheel also work; these are the always-visible fallback. */}
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={() => zoomBy(1.35)} aria-label="Lähennä" title="Lähennä" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${PLAN.hair}`, background: "rgba(255,255,255,0.95)", color: PLAN.ink, fontSize: 19, fontWeight: 700, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>+</button>
          <button onClick={() => zoomBy(1 / 1.35)} aria-label="Loitonna" title="Loitonna" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${PLAN.hair}`, background: "rgba(255,255,255,0.95)", color: PLAN.ink, fontSize: 19, fontWeight: 700, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>−</button>
          {zoomed && (
            <button onClick={resetView} aria-label="Palauta" title="Palauta näkymä" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${PLAN.hair}`, background: "rgba(255,255,255,0.95)", color: PLAN.muted, fontSize: 15, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>⟲</button>
          )}
        </div>
        <div style={{ position: "relative", display: "inline-block", lineHeight: 0, maxWidth: "100%", transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "center center", transition: dragging ? "none" : "transform .15s ease-out", willChange: "transform" }}>
          <img
            src={planImageUrl(map.building as any, floor, planUrlBase) ?? ""}
            alt={`Pohjakuva — ${floorLabel(floor)}`}
            style={{
              display: "block", maxWidth: "100%", maxHeight: 560, width: "auto", height: "auto",
              userSelect: "none", pointerEvents: "none",
              /**
               * VIIVAPIIRROS vs VALOKUVA.
               *
               * FR8:n pohjakuvat ovat vaaleaa viivapiirrosta läpinäkyvällä
               * pohjalla, joten `invert(1)` tekee niistä siistin vaalean kartan
               * ja 2 % rajaus siistii reunat. Ruudunkaappaukselle tai valokuvalle
               * molemmat ovat väärin: kuva näkyisi negatiivina ja sen reunoista
               * leikkautuisi sisältöä. `planRender` kertoo kummasta on kyse.
               */
              ...(isPhotoPlan
                ? {}
                : { clipPath: "inset(2%)", WebkitClipPath: "inset(2%)", filter: "invert(1)" }),
            } as React.CSSProperties}
            draggable={false}
          />
          <div
            style={{ position: "absolute", inset: 0, cursor: p2On && addMode ? "crosshair" : undefined }}
            onClick={p2On && addMode ? (e) => {
              // Kartan siirron päätteeksi ei synny ikkunaa: veto on veto.
              if (dragMoved.current) { dragMoved.current = false; return; }
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
              // LISÄYSTILA JÄÄ PÄÄLLE. Ennen tämä sammui heti ensimmäisestä
              // pisteestä, ja koska lisäysnappi on kartan ALAPUOLELLA, viiden
              // ikkunan merkitseminen tarkoitti: vieritä alas, paina, vieritä
              // ylös, napauta — viisi kertaa. Nyt jokainen seuraava ikkuna on
              // yksi napautus, ja tilasta poistutaan kartan päällä olevasta
              // "Valmis"-painikkeesta.
              void addOneWindow(floor, x, y);
            } : undefined}
          >
            {points.map((pt) => {
              const status = map.statuses[pt.key] || "ei";
              const isYellow = pt.p === 2;
              if (p2On && onlyYellow && !isYellow) return null;

              // ── Priority 2 windows in phase-2: a clean NUMBERED badge, colour-
              //    coded by negotiation state. No price pills — the euro amounts
              //    live in the decision list below (the map just locates a window
              //    by its number and shows its state at a glance).
              if (p2On && isYellow) {
                const offer = p2!.offers[pt.key];
                const state: P2BadgeState = offer && offer.status !== "declined"
                  ? offer.status
                  : offer ? "declined" : "none";
                const num = p2Number[pt.key];
                const mine = customerAdded.has(pt.key);
                const { bg, fg, border } = p2BadgeStyle(state);
                const focused = focusKey === pt.key;
                // LISÄYSTILASSA VANHAT VÄISTYVÄT. Kartta oli täynnä samanarvoisia
                // palloja, eikä juuri lisätty erottunut niistä mitenkään — piti
                // arvata mikä niistä oli oma. Nyt istunnossa lisätyt palavat
                // kirkkaina ja muut himmenevät taustaksi. Himmennetyt eivät ota
                // napautusta vastaan, jotta niiden päälle voi merkitä uuden.
                const fresh = sessionKeys.includes(pt.key);
                const dimmed = addMode && !fresh;
                return (
                  <button
                    key={pt.key}
                    data-cfm-anim={focused || (mine && state === "none") ? "" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      // Lisäystilassa oman tuoreen pisteen napautus avaa sen
                      // toiveen, ei neuvottelukuplaa — hintaa ei ole vielä.
                      if (addMode && fresh) { setWishFor(pt.key); return; }
                      setOpenOffer({ key: pt.key, rect: r });
                      setP2Error(null);
                    }}
                    title={`Ikkuna ${num}${mine ? " · ehdottamasi" : ""} — napauta`}
                    style={{
                      position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                      transform: "translate(-50%, -50%)",
                      minWidth: 20, height: 20, padding: "0 4px", borderRadius: 999,
                      background: bg, color: fg, border: `2px solid ${border}`,
                      fontFamily: FONT, fontSize: 11, fontWeight: 800, lineHeight: 1,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontVariantNumeric: "tabular-nums",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                      zIndex: fresh ? 10 : focused ? 9 : state === "locked" ? 4 : 6,
                      opacity: dimmed ? 0.2 : 1,
                      pointerEvents: dimmed ? "none" : "auto",
                      transition: "opacity .25s ease",
                      animation: focused
                        ? "cfmFocus 1.3s ease-out 2"
                        : mine && state === "none" ? "cfmMineHalo 2.4s ease-in-out infinite" : undefined,
                    }}
                  >
                    {state === "locked" ? "✓" : num}
                  </button>
                );
              }

              // ── Priority 1 (red) windows — plain status dot; faded right back
              //    during phase-2 so the numbered extra windows carry the map.
              const color = dotColor(pt.p, status);
              const done = status === "pesty";
              return (
                <span
                  key={pt.key}
                  title={`Ikkuna · ${done ? "Pesty" : status === "kesken" ? "Kesken" : "Pesemättä"}`}
                  style={{
                    position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: 13, height: 13, borderRadius: "50%", background: color,
                    border: "2px solid #fff",
                    boxShadow: done ? `0 0 0 1px ${color}, 0 1px 3px rgba(0,0,0,0.25)` : "0 1px 2px rgba(0,0,0,0.18)",
                    opacity: addMode ? 0.1 : p2On ? 0.3 : status === "ei" ? 0.8 : 1,
                    transition: "opacity .3s",
                  }}
                />
              );
            })}

            {/* Observation badges — tappable marker on windows the crew noted.
                Näkyvät MYÖS 2. vaiheen aikana: jos ikkunasta on huomautettavaa
                (esim. vaikea pääsy, rikkinäinen tiiviste), asiakkaan pitää nähdä
                se juuri kun hän päättää hinnasta. Teksti näkyy myös hintakuplassa. */}
            {!addMode && points.map((pt) => observations[pt.key] ? (
              <button
                key={`obs-${pt.key}`}
                onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); wantObservationImage(pt.key); setOpenObs({ key: pt.key, rect: r }); }}
                title="Huomio tästä ikkunasta"
                aria-label="Näytä huomio"
                style={{
                  position: "absolute", left: `${pt.x}%`, top: `${pt.y}%`, transform: "translate(2px, -14px)",
                  width: 16, height: 16, borderRadius: "50%", padding: 0, cursor: "pointer",
                  background: "#fff", border: `1.5px solid ${PLAN.navy}`, color: PLAN.navy,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, lineHeight: 1,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.25)", zIndex: 4,
                }}
              >
                💬
              </button>
            ) : null)}

            {/* Navigation markers / notes (ladders, entrances, hazards, …) —
                also hidden in Priority 2 planning to keep the map uncluttered. */}
            {!p2On && floorNotes.map((n) => (
              <span
                key={n.key}
                title={`${NOTE_KINDS[n.kind].label}${n.text ? " — " + n.text : ""}`}
                style={{
                  position: "absolute", left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)",
                  width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, background: "#FFFFFF", border: `1.5px solid ${n.kind === "warning" ? PLAN.amber : PLAN.hair}`,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                }}
              >
                {NOTE_KINDS[n.kind].glyph}
              </span>
            ))}

            {/* Active work zone — pulsing highlight of where work is happening now */}
            {activeZone && activeZone.floor === floor && (
              <span
                title={activeZone.label ? `Työn alla: ${activeZone.label}` : "Työn alla nyt"}
                style={{
                  position: "absolute", left: `${activeZone.x}%`, top: `${activeZone.y}%`, transform: "translate(-50%,-50%)",
                  width: 26, height: 26, borderRadius: "50%", background: "rgba(62,124,89,0.16)", border: "2px solid #3E7C59",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, animation: "cfmZone 1.8s ease-in-out infinite",
                }}
              >
                🎯
              </span>
            )}
          </div>
        </div>
      </div>

      {/* TOIVELOMAKE juuri lisätylle ikkunalle — kartan ALLA, ei sen päällä.
        Kokeilin ensin kelluvaa paneelia kartan päällä: se peitti puolet
        pohjapiirroksesta juuri kun seuraavaa ikkunaa piti etsiä. Lomake on
        täysin vapaaehtoinen, ja seuraavan ikkunan voi napauttaa kartalta
        koskematta tähän lainkaan. */}
        {p2On && addMode && wishFor && (
        <div style={{
        marginTop: 10, padding: "11px 12px", borderRadius: 13, background: T.card,
        border: `1.5px solid ${T.navy}44`, boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: "50%", background: T.navy, color: onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 800 }}>
              {p2Number[wishFor] ?? "•"}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Ikkuna lisätty</span>
            <button
              type="button"
              onClick={() => void saveWish(true)}
              style={{ marginLeft: "auto", background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: T.muted, fontFamily: FONT, fontSize: 11.5 }}
            >
              Ohita
            </button>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <input
              value={wishPrice}
              onChange={(e) => setWishPrice(e.target.value)}
              inputMode="decimal"
              placeholder="Hinta-arvio"
              aria-label="Hinta-arvio euroina (valinnainen)"
              data-cfm-field=""
              style={{ width: 96, flexShrink: 0, padding: "9px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, background: "#fff", color: T.ink, fontFamily: FONT, fontSize: 13, outline: "none", ...darkField }}
            />
            <span style={{ fontSize: 13, color: T.muted, flexShrink: 0 }}>€</span>
            <input
              value={wishNote}
              onChange={(e) => setWishNote(e.target.value)}
              placeholder="Viesti (valinnainen)"
              aria-label="Viesti tästä ikkunasta (valinnainen)"
              maxLength={500}
              data-cfm-field=""
              style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, background: "#fff", color: T.ink, fontFamily: FONT, fontSize: 13, outline: "none", ...darkField }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 10.5, color: T.muted, lineHeight: 1.4, minWidth: 0 }}>
              Arvio ei sido kumpaakaan — lähetämme lopullisen hinnan.
            </span>
            <button
              type="button"
              disabled={wishBusy || (!wishPrice.trim() && !wishNote.trim())}
              onClick={() => void saveWish()}
              style={{
                marginLeft: "auto", flexShrink: 0, padding: "8px 15px", borderRadius: 9, border: "none",
                background: (!wishPrice.trim() && !wishNote.trim()) ? T.fill : T.navy,
                color: (!wishPrice.trim() && !wishNote.trim()) ? T.muted : onAccent,
                fontFamily: FONT, fontSize: 12.5, fontWeight: 800,
                cursor: (wishBusy || (!wishPrice.trim() && !wishNote.trim())) ? "default" : "pointer",
              }}
            >
              {wishBusy ? "Tallennetaan…" : "Tallenna"}
            </button>
          </div>
        </div>
        )}

      {/* Organized Priority 2 list — the clean way to review + respond to every
          window across all floors, grouped by what needs your attention. */}
      {p2On && (proposedList.length + counteredList.length + lockedList.length) > 0 && (
        <div style={{ marginTop: 16, borderRadius: 14, border: `1px solid ${T.hair}`, background: T.card, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 15px", borderBottom: `1px solid ${T.hair}`, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Priority 2 -ikkunat</span>
            {lockedList.length > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 12.5, color: T.green, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {lockedList.length} sovittu · {eur(lockedSum)}
              </span>
            )}
          </div>

          {/* Odottaa sinua — avoimet hintaehdotukset, RYHMITELTY KERROKSITTAIN.
              Asiakas voi hyväksyä kerroksen kerrallaan (kerroskohtainen nappi)
              tai kaikki yhdellä. */}
          {proposedList.length > 0 && (
            <div style={{ padding: "12px 15px", borderBottom: (counteredList.length || lockedList.length) ? `1px solid ${T.hair}` : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.navy }} /> Odottaa sinua · {proposedList.length}
                </span>
                {proposedFloors.length > 1 && (
                  <button
                    disabled={p2Busy}
                    onClick={() => void runP2(p2Actions!.accept, proposedList.map((o) => ({ key: o.key, priceCents: o.offer.priceCents, version: o.offer.version })))}
                    style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.green, fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                  >
                    Hyväksy kaikki ({proposedList.length} · {eur(allProposedSum)})
                  </button>
                )}
              </div>

              {proposedFloors.map((g) => {
                const floorSum = g.items.reduce((s, o) => s + o.offer.priceCents, 0);
                // Yhden kerroksen keikalla ryhmittely ei auta mitään, joten se
                // on auki oletuksena.
                const open = openFloors[g.floor] ?? proposedFloors.length === 1;
                return (
                    <div key={g.floor} style={{ marginBottom: 10, borderRadius: 13, border: `1px solid ${T.hair}`, background: open ? T.card : T.paper, overflow: "hidden" }}>
                      {/* Kerroksen otsikkorivi. Kerros aukeaa ja sulkeutuu
                          tästä; "Hyväksy kerros" toimii avaamattakin, joten
                          koko kerroksen voi kuitata sitä avaamatta. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
                        <button
                          onClick={() => setOpenFloors((s) => ({ ...s, [g.floor]: !s[g.floor] }))}
                          aria-expanded={open}
                          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: T.ink, textAlign: "left" }}
                        >
                          <span aria-hidden style={{ display: "inline-block", width: 10, color: T.muted, fontSize: 10, transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}>▶</span>
                          <span style={{ minWidth: 30, height: 22, padding: "0 7px", borderRadius: 7, background: T.fill, border: `1px solid ${T.hair}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: T.navy }}>{g.floor}</span>
                          <span>{floorLabel(g.floor)} · {g.items.length} ikkunaa</span>
                        </button>
                        <button
                          disabled={p2Busy}
                          onClick={() => void runP2(p2Actions!.accept, g.items.map((o) => ({ key: o.key, priceCents: o.offer.priceCents, version: o.offer.version })))}
                          style={{ marginLeft: "auto", padding: "7px 12px", borderRadius: 9, border: "none", background: T.green, color: onAccent, fontFamily: FONT, fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: p2Busy ? 0.6 : 1, whiteSpace: "nowrap" }}
                        >
                          Hyväksy kerros ({g.items.length} · {eur(floorSum)})
                        </button>
                      </div>
                      {open && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px" }}>
                          {g.items.map(renderProposedRow)}
                        </div>
                      )}
                    </div>
                  );
              })}
            </div>
          )}

          {/* Vastatarjouksesi — odottaa meidän vastausta */}
          {counteredList.length > 0 && (
            <div style={{ padding: "12px 15px", borderBottom: lockedList.length ? `1px solid ${T.hair}` : "none" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: amberText, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.amber }} /> Vastatarjouksesi · {counteredList.length}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {counteredList.map((o) => (
                  <div key={o.key} ref={(el) => { listRowRefs.current[o.key] = el; }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 11, background: hiRow === o.key ? rgba(T.amber, 0.16) : T.paper, border: `1px solid ${hiRow === o.key ? T.amber : T.hair}`, flexWrap: "wrap", transition: "background .4s, border-color .4s", scrollMarginTop: 12 }}>
                    {/* Ambran päällä teksti on tumma kummassakin teemassa: ambra
                        on vaalea täyttö myös tummassa paletissa, joten `onAccent`
                        olisi tässä väärä. */}
                    <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: "50%", background: T.amber, color: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{p2Number[o.key] ?? o.idx + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{floorLabel(o.floor)} · ikkuna {p2Number[o.key] ?? o.idx + 1}</div>
                      <div style={{ fontSize: 12.5, color: T.muted, fontVariantNumeric: "tabular-nums" }}>Ehdotus {eur(o.offer.priceCents)} · sinun {eur(o.offer.counterCents ?? 0)}</div>
                    </div>
                    <button onClick={() => jumpToMap(o.key, o.floor)} title="Näytä kartalla" style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 9, border: `1px solid ${T.hair}`, background: T.card, color: T.navy, fontFamily: FONT, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Kartalla</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sovitut — lukitut hinnat (tiivis yhteenveto) */}
          {lockedList.length > 0 && (
            <div style={{ padding: "12px 15px", display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: greenBg, border: `1px solid ${greenEdge}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.green, fontSize: 13, fontWeight: 800 }}>✓</span>
              <span style={{ fontSize: 13, color: T.ink }}>
                <strong>{lockedList.length}</strong> sovittua Priority 2 -ikkunaa · yhteensä <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(lockedSum)}</strong>
              </span>
            </div>
          )}
          {/* Virheet listatoiminnoista (esim. hinta ehti muuttua) — näkyy vain
              kun offer-popup ei ole auki (muuten virhe näkyy siellä). */}
          {p2Error && !openOffer && (
            <div style={{ padding: "0 15px 12px", fontSize: 12.5, color: danger, lineHeight: 1.5 }}>{p2Error}</div>
          )}
        </div>
      )}

      {/* P2 quick actions: a prominent "add a window" nudge that openly invites
          the customer to bring more windows into scope. */}
      {p2On && (
        <div style={{ marginTop: 12 }}>
          {/* The add-window CTA: a warm, obvious invitation. When the customer
              hasn't engaged at all yet, it grows into an empty-state that
              actively expects them to add windows. */}
          {/* Lisäystilassa ohjain on kartan päällä, joten tähän ei tarvita
              toista nappia — se olisi vain sama toiminto kahdessa paikassa. */}
          {!addMode && (
            <div style={{ borderRadius: 12, border: `1.5px dashed ${T.navy}55`, background: `linear-gradient(160deg, ${rgba(T.navy, 0.05)}, ${rgba(T.amber, 0.06)})`, padding: 14 }}>
              <p style={{ margin: "0 0 10px", fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
                Merkitse kartalta ikkunat jotka haluat mukaan — hinnoittelemme jokaisen erikseen.
                Voit merkitä niin monta kuin haluat peräkkäin.
              </p>
              <button
                disabled={p2Busy}
                data-cfm-anim=""
                onClick={() => { setAddMode(true); setSessionKeys([]); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 11, border: "none", background: T.navy, color: onAccent, fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer", animation: anyYellowActivity ? undefined : "cfmAddNudge 2.4s ease-in-out infinite" }}
              >
                <span style={{ fontSize: 17, lineHeight: 1 }}>➕</span> Lisää ikkunoita
              </button>
            </div>
          )}
        </div>
      )}

      {/* Selite taittuvana: väriselitys on hyödyllinen kerran, ei joka kerta.
          Sama periaate kuin muuallakin — ohje on saatavilla, ei tiellä. */}
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, color: T.muted, listStyle: "none", padding: "6px 0" }}>
          Mitä värit tarkoittavat?
        </summary>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 8, alignItems: "center" }}>
        {(p2On ? LEGEND_P2 : LEGEND).map((l) => (
          // Selitteen pallo jäljittelee merkkiä sellaisena kuin se kartalla on,
          // valkoinen rengas mukaan lukien — muuten selite kuvaisi jotain muuta
          // kuin mitä ruudulla näkyy. Vain teksti seuraa teemaa.
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: T.muted }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: l.color, border: "2px solid #fff", boxShadow: `0 0 0 1px ${T.hair}` }} />
            {l.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.muted }}>Päivittyy automaattisesti</span>
      </div>
      </details>

      {/* P2 window popup — PLANNING ONLY. Tapping a numbered badge tells you which
          window it is and its current state; the actual price decisions (accept /
          counter / decline) live in the list below, reached via "Näytä listassa".
          This keeps the map a clean planning surface. */}
      {p2On && openOffer && (
        <>
          <div onClick={closeOffer} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          {/* Kupla käyttää kohotettua pintaa: tummassa teemassa kortin sävy on
              lähes sama kuin sivun, jolloin leijuva laatikko ei erottuisi
              taustastaan — varjot eivät tummalla tee sitä työtä. */}
          <div style={{ ...popupStyle(openOffer.rect, 260, 170), width: 260, background: raisedBg, border: `1px solid ${T.hair}`, borderRadius: 14, boxShadow: popupShadow, padding: 16, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.navy, color: onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{p2Number[openOffer.key] ?? "?"}</span>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>{floorLabel(openOffer.key.split("#")[0])} · ikkuna {p2Number[openOffer.key] ?? "?"}</span>
              <button onClick={closeOffer} aria-label="Sulje" style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            {!openOfferData && (
              <>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.muted }}>
                  {openOfferIsMine
                    ? "Kiitos ehdotuksesta! Hinnoittelemme tämän ikkunan pian — saat hintaehdotuksen tähän."
                    : "Ei vielä hinnoiteltu — saat hintaehdotuksen tähän ikkunaan pian."}
                </p>
                {openOfferIsMine && (
                  <button
                    disabled={p2Busy}
                    onClick={() => void runP2Free(p2Actions!.removePoint, openOffer.key)}
                    style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.muted, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: p2Busy ? 0.6 : 1 }}
                  >
                    Poista ehdottamani ikkuna
                  </button>
                )}
              </>
            )}

            {/* Hintahuomio: perustajan lyhyt perustelu. Näytetään ENNEN
                nappeja, jotta se on luettu ennen kuin hinnasta päätetään. */}
            {openOfferData?.note && (
              <p style={{
                margin: "0 0 10px", padding: "8px 10px", borderRadius: 9,
                background: rgba(T.navy, 0.06), border: `1px solid ${T.hair}`,
                fontSize: 12.5, lineHeight: 1.5, color: T.ink,
              }}>
                {openOfferData.note}
              </p>
            )}

            {openOfferData?.status === "locked" && (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                Sovittu hinta <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.lockedCents ?? openOfferData.priceCents)}</strong>
                <span style={{ color: T.green, fontWeight: 700 }}> ✓</span><br />
                <span style={{ fontSize: 12.5, color: T.muted }}>
                  {map.statuses[openOffer.key] === "pesty" ? "Ikkuna on pesty." : "Ikkuna on työjonossa."}
                </span>
              </p>
            )}

            {openOfferData?.status === "declined" && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.muted }}>
                Ei tilattu. Jos muutat mieltäsi, laita meille viestiä — teemme uuden ehdotuksen.
              </p>
            )}

            {openOfferData?.status === "countered" && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6 }}>
                  Ehdotuksemme: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.priceCents)}</strong><br />
                  Sinun tarjouksesi: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.counterCents ?? 0)}</strong><br />
                  <span style={{ fontSize: 12.5, color: T.muted }}>Odottaa vastaustamme.</span>
                </p>
                <button
                  onClick={() => jumpToList(openOffer.key)}
                  style={{ width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${T.hair}`, background: T.paper, color: T.navy, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Näytä listassa ↓
                </button>
              </>
            )}

            {openOfferData?.status === "proposed" && (
              <>
                <p style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 }}>
                  Hintaehdotus: <strong style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{eur(openOfferData.priceCents)}</strong>
                  <span style={{ fontSize: 12, color: T.muted }}> / ikkuna</span><br />
                  <span style={{ fontSize: 12.5, color: T.muted }}>Voit hyväksyä tai tehdä vastatarjouksen listassa.</span>
                </p>
                <button
                  onClick={() => jumpToList(openOffer.key)}
                  style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: T.navy, color: onAccent, fontFamily: FONT, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Näytä listassa ↓
                </button>
              </>
            )}

            {/* Tekijän huomio tästä ikkunasta — samassa kuplassa kuin hinta, jotta
                asiakas näkee sen päättäessään. Näkyy vain jos joku on kirjoittanut. */}
            {(() => {
              const obs = observations[openOffer.key];
              if (!obs || (!obs.text?.trim() && !obs.imageDataUrl && !obs.hasImage)) return null;
              return (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.hair}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12 }}>💬</span>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.muted }}>Huomio ikkunasta</span>
                  </div>
                  {obs.text?.trim() && (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: T.navy, whiteSpace: "pre-wrap" }}>{obs.text.trim()}</p>
                  )}
                  {obsImageFor(openOffer.key) ? (
                    <img src={obsImageFor(openOffer.key)} alt="Huomion kuva" style={{ display: "block", width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 10, marginTop: obs.text?.trim() ? 8 : 0, border: `1px solid ${T.hair}` }} />
                  ) : obs.hasImage ? (
                    <div style={{ marginTop: obs.text?.trim() ? 8 : 0, padding: "22px 0", textAlign: "center", borderRadius: 10, background: T.paper, color: T.muted, fontSize: 12 }}>Ladataan kuvaa…</div>
                  ) : null}
                </div>
              );
            })()}

            {p2Error && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: danger, lineHeight: 1.5 }}>{p2Error}</p>
            )}
          </div>
        </>
      )}

      {/* Window observation popup — small, dismissible, anchored over the dot */}
      {openObs && openObservation && (
        <>
          <div onClick={() => setOpenObs(null)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ ...popupStyle(openObs.rect, 250, (openObservation.imageDataUrl || openObservation.hasImage) ? 280 : 130), width: 250, background: raisedBg, border: `1px solid ${T.hair}`, borderRadius: 14, boxShadow: popupShadow, padding: 14, fontFamily: FONT }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15 }}>💬</span>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: T.navy }}>Huomio ikkunasta</span>
              <button onClick={() => setOpenObs(null)} aria-label="Sulje" style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: "50%", border: "none", background: T.paper, color: T.muted, fontSize: 13, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
            {openObservation.text && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.ink, whiteSpace: "pre-wrap" }}>{openObservation.text}</p>
            )}
            {obsImageFor(openObs.key) ? (
              <img src={obsImageFor(openObs.key)} alt="Huomion kuva" style={{ display: "block", width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 10, marginTop: openObservation.text ? 10 : 0, border: `1px solid ${T.hair}` }} />
            ) : openObservation.hasImage ? (
              <div style={{ marginTop: openObservation.text ? 10 : 0, padding: "26px 0", textAlign: "center", borderRadius: 10, background: T.paper, color: T.muted, fontSize: 12 }}>Ladataan kuvaa…</div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
