/**
 * Gig tool — "Pohjakartat & asetukset" (floor maps & setup).
 *
 * Makes the FR8 floor-plan toolkit reusable for any gig: edit the building name
 * & address, manage the floor list, set the price per window and the plan-image
 * base path, and import your own floor mappings by pasting a marks JSON. Changes
 * persist through the same project API the projektinäkymä uses, so the maps,
 * dashboard and billing all pick them up.
 *
 * Tämä on myös se paikka jossa keikka SANOO millainen se on, sen sijaan että se
 * pitäisi arvata:
 *   - pohjakuva LADATAAN tästä (ei enää committaamalla PNG `client/public`iin),
 *   - liikkuuko keikasta rahaa (yhteisökeikka = aidosti 0 €, ei liikevaihtoa),
 *   - paljonko yksi ikkuna arvioidaan vievän aikaa (suunnittelutieto),
 *   - onko kuva viivapiirros vai valokuva (asiakaskartan esitystapa),
 *   - mikä sana korvaa "kerroksen" kun keikka on yksi huone.
 */
import { useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, Save, Upload, RotateCcw, Check, AlertCircle, ImagePlus, X, Loader2,
} from "lucide-react";
import {
  fixedDealFor, isCommunityGig, planRenderOf, planImageUrl, floorLabel, allPoints,
  DEFAULT_PRICE_PER_WINDOW,
  type ProjectData, type ProjMarksData, type ProjMark,
  type GigCompensation, type PlanRender,
} from "@shared/project";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuthedImage } from "@/lib/authed-image";

interface Props {
  project: ProjectData;
  saving: boolean;
  onSave: (next: ProjectData) => void;
  /**
   * Keikan id — VALINNAINEN tarkoituksella.
   *
   * Vain pohjakuvan lataus tarvitsee sen (`/api/jobs/:id/plan/:floor`); kaikki
   * muu tässä työkalussa kulkee `onSave`n kautta. Ilman id:tä työkalu toimii
   * siis täsmälleen kuten ennen ja pelkkä latausosio jää pois — yksi rivi
   * kertoo miksi, sen sijaan että nappi näyttäisi rikkinäiseltä.
   */
  jobId?: number;
}

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
};
const mono: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  fontSize: "11px",
  letterSpacing: "0.14em",
  color: "rgba(255,255,255,0.4)",
};
const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono, monospace)",
  fontSize: "9.5px",
  letterSpacing: "0.12em",
  color: "rgba(255,255,255,0.4)",
  marginBottom: "7px",
  display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  color: "#fff",
  fontSize: "14px",
  outline: "none",
  fontFamily: "var(--font-onest, system-ui, sans-serif)",
};
/** Selittävä apurivi, sama sävy kaikkialla tässä työkalussa. */
const hintStyle: React.CSSProperties = {
  fontSize: "10.5px",
  color: "rgba(255,255,255,0.35)",
  marginTop: "6px",
  lineHeight: 1.5,
};

/**
 * Suurin data URL jonka palvelin ottaa vastaan (`MAX_PLAN_IMAGE_LEN`,
 * server/assets.ts). Luku on tässä kopiona, koska raja asuu palvelinpuolen
 * moduulissa jota selain ei voi tuoda. Tarkoitus: käyttäjä saa selvän suomen-
 * kielisen virheen ENNEN lähetystä eikä paljasta 413:a verkosta.
 */
const MAX_PLAN_DATAURL_LEN = 3_500_000;

/** Pisin sivu johon pohjakuva pienennetään ennen lähetystä. */
const PLAN_MAX_DIM = 1600;

/**
 * Tätä pienempi PNG lähetetään sellaisenaan. Pohjapiirros on ohutta viivaa,
 * jonka JPEG-pakkaus sotkisi artefakteilla — pieni PNG mahtuu rajaan kevyesti,
 * joten sitä ei kannata heikentää.
 */
const PLAN_KEEP_PNG_LEN = 900_000;

/** Count total marks in a marks map. */
function countMarks(marks: ProjMarksData): number {
  return Object.values(marks).reduce((a, f) => a + (Array.isArray(f?.marks) ? f.marks.length : 0), 0);
}

/**
 * Vakaa JSON: avaimet järjestetään ennen sarjallistusta.
 *
 * MIKSI: luonnos–talletettu-vertailu katsoo sisältöä, ei kirjoitusjärjestystä.
 * Uusi kenttä (esim. `compensation`) syntyy luonnokseen viimeiseksi, mutta
 * palvelimen sanitoija palauttaa sen omalla paikallaan. Järjestykseen nojaava
 * vertailu jäisi siis ikuisesti "tallentamattomiin muutoksiin" heti onnistuneen
 * tallennuksen jälkeen, eikä Tallenna-nappi sammuisi koskaan.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const src = val as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = src[k];
      return out;
    }
    return val;
  });
}

/**
 * Valitun pohjakuvan pienennys ennen lähetystä.
 *
 * MIKSI SELAIMESSA: puhelimen kamerakuva on helposti 4–8 MB, ja palvelin
 * hylkää yli `MAX_PLAN_DATAURL_LEN`:n data URLin. Pienennys tehdään siis
 * täällä, jossa kuva jo on, eikä jätetä käyttäjän arvattavaksi.
 */
/**
 * VALKOISEN PAPERIN POISTO — reunoista sisäänpäin.
 *
 * Talon pohjakuvat (FR8) ovat vaaleaa viivaa LÄPINÄKYVÄLLÄ pohjalla, ja koko
 * ketju on rakennettu sille: adminin tumma kartta näyttää kuvan sellaisenaan ja
 * asiakkaan vaalea kartta kääntää sen (`invert(1)`, joka ei koske
 * läpinäkyvyyteen). Puhelimella kaapattu tai skannattu pohjapiirros on
 * päinvastainen: tummaa viivaa VALKOISELLA paperilla. Sellaisenaan se on tumman
 * kartan päällä iso kirkas arkki — juuri se mistä valkoinen tausta valitettiin.
 *
 * Tausta poistetaan LEVITTÄMÄLLÄ REUNOISTA, ei "kaikki valkoinen pois":
 * jälkimmäinen söisi huoneiden sisällä olevat vaaleat tekstit ja mitat. Reunasta
 * levitessä vain se yhtenäinen paperialue joka koskettaa kuvan reunaa muuttuu
 * läpinäkyväksi; kaikki sisäpuolinen säilyy.
 *
 * Kynnys on korkea (238), jotta harmaa seinäviiva ja rasterointi jäävät jäljelle.
 */
function dropBorderPaper(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const NEAR_WHITE = 238;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i]) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop()!;
    const p = i * 4;
    if (d[p] < NEAR_WHITE || d[p + 1] < NEAR_WHITE || d[p + 2] < NEAR_WHITE) continue;
    d[p + 3] = 0;
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  ctx.putImageData(img, 0, 0);
}

async function fileToPlanDataUrl(file: File, dropPaper = false): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Kuvan luku epäonnistui"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Kuvaa ei voitu avata"));
    i.src = dataUrl;
  });
  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > 0 ? Math.min(1, PLAN_MAX_DIM / longEdge) : 1;
  if (!dropPaper && scale === 1 && dataUrl.startsWith("data:image/png") && dataUrl.length <= PLAN_KEEP_PNG_LEN) {
    return dataUrl;
  }
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  if (dropPaper) {
    // Läpinäkyvä pohja: EI valkoista täyttöä, ja ulostulo PNG:nä koska JPEG ei
    // kanna alfakanavaa (läpinäkyvä alue muuttuisi siinä mustaksi laatikoksi).
    ctx.drawImage(img, 0, 0, w, h);
    dropBorderPaper(ctx, w, h);
    return canvas.toDataURL("image/png");
  }
  // Valkoinen pohja ensin: läpinäkyvä PNG muuttuisi JPEGissä mustaksi, ja
  // pohjapiirros on valkoisella paperilla.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  // Jo valmiiksi pienen kuvan kohdalla JPEG voi olla isompi kuin lähde —
  // silloin pidetään pienempi.
  return scale === 1 && dataUrl.length < out.length ? dataUrl : out;
}

/** Parse a pasted marks JSON into a normalised ProjMarksData (loose, tolerant). */
function parseMarksJson(text: string): { marks: ProjMarksData; floors: string[]; count: number } {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JSON ei ole kerros-objekti");
  const out: ProjMarksData = {};
  for (const floor of Object.keys(raw)) {
    const v = raw[floor];
    // Accept either { marks: [...] } or a bare array of marks.
    const arr = Array.isArray(v) ? v : Array.isArray(v?.marks) ? v.marks : null;
    if (!arr) continue;
    const marks: ProjMark[] = arr
      .map((mk: any): ProjMark => ({
        p: Number(mk?.p) === 2 ? 2 : 1,
        x: Math.max(0, Math.min(100, Number(mk?.x))),
        y: Math.max(0, Math.min(100, Number(mk?.y))),
      }))
      .filter((mk: ProjMark) => Number.isFinite(mk.x) && Number.isFinite(mk.y));
    out[String(floor).slice(0, 8)] = { marks };
  }
  const floors = Object.keys(out);
  if (floors.length === 0) throw new Error("Ei löytynyt yhtään merkintää");
  return { marks: out, floors, count: countMarks(out) };
}

/**
 * Kahden valinnan valitsin.
 *
 * Oma pikku komponentti koska sama kuvio toistuu (korvaus, pohjakuvan
 * esitystapa) — ei kirjastoa, samat tyylit kuin muualla tässä työkalussa.
 * Valittu vaihtoehto on valkoinen kuten Tallenna-nappi; reunus on aina 1 px,
 * jottei nappi hypähdä kokoa vaihtaessa.
 */
function Choice<T extends string>({ value, options, onChange, mobile, disabled }: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  mobile: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="group" style={{ display: "flex", flexDirection: mobile ? "column" : "row", gap: "8px" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              textAlign: "left",
              padding: "11px 14px",
              borderRadius: "12px",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
              border: on ? "1px solid #fff" : "1px solid rgba(255,255,255,0.12)",
              background: on ? "#fff" : "rgba(255,255,255,0.05)",
              color: on ? "#0a0a0c" : "rgba(255,255,255,0.8)",
              fontWeight: on ? 700 : 600,
              fontSize: "13.5px",
              fontFamily: "var(--font-onest, system-ui, sans-serif)",
            }}
          >
            {o.label}
            {o.hint && (
              <span style={{
                display: "block", marginTop: "3px", fontSize: "10.5px", fontWeight: 500, lineHeight: 1.45,
                color: on ? "rgba(10,10,12,0.6)" : "rgba(255,255,255,0.4)",
              }}>
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pohjakuvan pikkukuva.
 *
 * Omana komponenttinaan, koska kuva haetaan hookilla eikä hookia voi kutsua
 * `.map()`-silmukan sisällä. Adminin kuvareitti on Bearer-tokenin takana, joten
 * `<img src>` ei voi hakea sitä suoraan — se palautti 401:n ja pikkukuva näkyi
 * rikkinäisen kuvan merkkinä.
 */
function PlanThumb({ url, alt }: { url: string; alt: string }) {
  const img = useAuthedImage(url);
  const box: React.CSSProperties = {
    width: "58px", height: "42px", flexShrink: 0, borderRadius: "9px",
    border: "1px solid rgba(255,255,255,0.14)",
  };
  if (img.src) {
    return <img src={img.src} alt={alt} style={{ ...box, objectFit: "cover", background: "rgba(255,255,255,0.9)" }} />;
  }
  return (
    <span
      title={img.error ?? undefined}
      style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.45)", fontSize: "9px", textAlign: "center", lineHeight: 1.2, padding: "2px" }}
    >
      {img.loading ? "…" : "ei näy"}
    </span>
  );
}

export default function FloorSetupTool({ project, saving, onSave, jobId }: Props) {
  const m = useIsMobile();
  const [draft, setDraft] = useState<ProjectData>(() => JSON.parse(JSON.stringify(project)));
  const [newFloor, setNewFloor] = useState("");
  const [marksText, setMarksText] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  /**
   * Tuntiarvion RAAKA teksti. Numerokentän arvoa ei voi lukea suoraan
   * luonnoksesta, koska kesken kirjoitusta "1," / "1." ei ole vielä luku —
   * pelkkä johdettu arvo pyyhkisi juuri kirjoitetun desimaalipilkun.
   */
  const [hoursText, setHoursText] = useState(() =>
    project.estimatedHoursPerWindow ? String(project.estimatedHoursPerWindow) : "");
  // Pohjakuvien lataus on kerroskohtainen: yhden kerroksen odotus tai virhe ei
  // saa lukita muita, koska kuvat ladataan yksi kerrallaan.
  const [planBusy, setPlanBusy] = useState<Record<string, boolean>>({});
  const [planErr, setPlanErr] = useState<Record<string, string>>({});
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);

  // A signed, fixed-price deal (FR8) locks the price field.
  const priceLocked = !!fixedDealFor(draft);
  const community = isCommunityGig(draft);
  // "kerros" → keikan oma sana. Suomen monikkoa ei yritetä taivuttaa: oletus-
  // otsikko on "KERROKSET", ja oman sanan kanssa käytetään sanaa sellaisenaan
  // ("TILA") — väärin taivutettu monikko näyttäisi pahemmalta kuin yksikkö.
  const unitWord = draft.building.unitWord?.trim() || "";
  const word = unitWord || "kerros";
  const wordCap = word.charAt(0).toUpperCase() + word.slice(1);
  const floorsHeading = unitWord ? unitWord.toUpperCase() : "KERROKSET";
  const planUrlBase = jobId != null ? api.planUrlBaseForJob(jobId) : null;
  /**
   * Poistetaanko valkoinen paperitausta latauksen yhteydessä.
   *
   * Oletus PÄÄLLÄ, koska talon kuvat ovat läpinäkyväpohjaisia ja koko ketju on
   * rakennettu sille: adminin tumma kartta näyttää kuvan sellaisenaan, asiakkaan
   * vaalea kartta kääntää sen. Puhelimella kaapattu pohjapiirros on valkoisella
   * paperilla, ja sellaisenaan se on tumman kartan päällä iso kirkas arkki.
   */
  const [dropPaper, setDropPaper] = useState(true);

  // Compare against the persisted project (ignoring the timestamp) to know if
  // there is anything to save.
  const dirty = useMemo(() => {
    // `building.planImages` jätetään vertailun ulkopuolelle: se on PALVELIMEN
    // omistama kenttä, joka muuttuu vain /plan-reittien kautta ja on jo
    // talletettu latauksen hetkellä. Jos se olisi mukana, juuri ladattu kuva
    // näyttäisi ikuisesti "tallentamattomalta muutokselta" — ja Tallenna
    // lähettäisi luonnoksen kentän palvelimen oman päälle.
    const strip = (p: ProjectData) => stableJson({
      ...p,
      updatedAt: 0,
      building: { ...p.building, planImages: undefined },
    });
    return strip(draft) !== strip(project);
  }, [draft, project]);

  const patch = (fn: (d: ProjectData) => void) => {
    setDraft((cur) => {
      const next = JSON.parse(JSON.stringify(cur)) as ProjectData;
      fn(next);
      return next;
    });
    setJustSaved(false);
  };

  const renameFloor = (idx: number, value: string) => {
    const clean = value.replace(/[^a-zA-Z0-9åäöÅÄÖ _-]/g, "").slice(0, 8);
    patch((d) => { d.building.floors[idx] = clean; });
  };
  const removeFloor = (idx: number) => patch((d) => { d.building.floors.splice(idx, 1); });
  const addFloor = () => {
    const clean = newFloor.replace(/[^a-zA-Z0-9åäöÅÄÖ _-]/g, "").slice(0, 8).trim();
    if (!clean) return;
    if (draft.building.floors.includes(clean)) { setNotice({ kind: "err", text: `${wordCap} "${clean}" on jo listalla` }); return; }
    patch((d) => { d.building.floors.push(clean); });
    setNewFloor("");
    setNotice(null);
  };

  // ─── Korvaus / hinta ────────────────────────────────────────────────────────

  const setCompensation = (next: GigCompensation) => patch((d) => {
    if (next === "community") {
      d.compensation = "community";
      // Yhteisökeikalla nolla on OIKEA hinta: sanitoija ei sovella oletushintaa
      // kun `compensation` on "community", joten 0 € säilyy sellaisenaan.
      d.pricePerWindow = 0;
    } else {
      d.compensation = "money";
      // Sama varakäytäntö kuin sanitoijassa: maksullisella keikalla nolla
      // palautuisi joka tapauksessa oletushintaan, joten tehdään se tässä —
      // muuten luonnos ja talletettu arvo eroaisivat pysyvästi.
      if (!(d.pricePerWindow > 0)) d.pricePerWindow = DEFAULT_PRICE_PER_WINDOW;
    }
  });

  // ─── Tuntiarvio ─────────────────────────────────────────────────────────────

  const setHours = (raw: string) => {
    setHoursText(raw);
    // Desimaalipilkku hyväksytään (suomalainen näppäimistö). Tyhjä tai nolla =
    // ei arviota lainkaan, jottei mikään näkymä keksi lukua tyhjästä.
    const n = Number(raw.replace(",", "."));
    // Sama rajaus kuin sanitoijassa (0 < x ≤ 24, kaksi desimaalia) — ja pyöristys
    // TARKISTETAAN vasta pyöristyksen jälkeen, jottei "0,001" jäisi luonnokseen
    // nollaksi jonka palvelin pudottaa pois: ero jäisi ikuiseksi "muutokseksi".
    const rounded = Math.min(24, Math.round(n * 100) / 100);
    patch((d) => {
      d.estimatedHoursPerWindow = Number.isFinite(rounded) && rounded > 0 ? rounded : undefined;
    });
  };

  // ─── Pohjakuvat (palvelimen omistama kenttä) ────────────────────────────────

  const setPlanFlag = (floor: string, busy: boolean) =>
    setPlanBusy((cur) => ({ ...cur, [floor]: busy }));
  const setPlanError = (floor: string, msg: string | null) =>
    setPlanErr((cur) => {
      const next = { ...cur };
      if (msg) next[floor] = msg; else delete next[floor];
      return next;
    });

  /**
   * Ottaa palvelimen `planImages` käyttöön luonnoksessa, jotta esikatselu
   * ilmestyy heti eikä vaadi Tallenna-nappia — kuva on jo talletettu.
   *
   * MIKSI EI `patch`: `patch` merkitsee luonnoksen muuttuneeksi (nollaa
   * "Tallennettu"-tilan). Pohjakuvan lataus ei ole tallentamaton muutos vaan
   * jo tapahtunut tallennus, joten se ei kuulu sinne. Palvelimen arvo on tässä
   * kentässä aina totuus.
   */
  const adoptServerPlans = (server: ProjectData) => {
    const plans = server.building?.planImages;
    setDraft((cur) => {
      const next = JSON.parse(JSON.stringify(cur)) as ProjectData;
      if (plans && Object.keys(plans).length) next.building.planImages = { ...plans };
      else delete next.building.planImages;
      return next;
    });
  };

  const uploadPlan = async (floor: string, file: File) => {
    if (jobId == null) return;
    // Palvelin hylkää tuntemattoman kerroksen ("Tuntematon kerros"), jottei
    // kuvaviite jäisi roikkumaan olemattomaan kerrokseen. Juuri lisätty kerros
    // on siis tallennettava ensin — kerrotaan se suoraan.
    if (!project.building.floors.includes(floor)) {
      setPlanError(floor, `Tallenna uusi ${word} ensin, sitten lataa kuva`);
      return;
    }
    setPlanError(floor, null);
    setPlanFlag(floor, true);
    try {
      const dataUrl = await fileToPlanDataUrl(file, dropPaper);
      if (!dataUrl.startsWith("data:image/")) {
        setPlanError(floor, "Tiedosto ei ole kuva");
        return;
      }
      if (dataUrl.length > MAX_PLAN_DATAURL_LEN) {
        setPlanError(floor, "Kuva on pienennyksen jälkeenkin liian suuri — rajaa kuvaa tai tallenna se JPEG-muodossa");
        return;
      }
      const res = await api.uploadPlanImage(jobId, floor, dataUrl);
      if (!res.ok || !res.data?.project) {
        setPlanError(floor, res.error || "Lataus epäonnistui");
        return;
      }
      adoptServerPlans(res.data.project);
    } catch (err) {
      setPlanError(floor, err instanceof Error ? err.message : "Lataus epäonnistui");
    } finally {
      setPlanFlag(floor, false);
    }
  };

  const removePlan = async (floor: string) => {
    if (jobId == null) return;
    setPlanError(floor, null);
    setPlanFlag(floor, true);
    try {
      const res = await api.deletePlanImage(jobId, floor);
      if (!res.ok || !res.data?.project) {
        setPlanError(floor, res.error || "Poisto epäonnistui");
        return;
      }
      adoptServerPlans(res.data.project);
    } catch (err) {
      setPlanError(floor, err instanceof Error ? err.message : "Poisto epäonnistui");
    } finally {
      setPlanFlag(floor, false);
    }
  };

  // ─── Merkinnät ──────────────────────────────────────────────────────────────

  const importMarks = () => {
    const text = marksText.trim();
    if (!text) return;
    try {
      const { marks, floors, count } = parseMarksJson(text);
      patch((d) => {
        d.marks = marks;
        // Add any imported floors that aren't already in the list (keep order).
        for (const f of floors) if (!d.building.floors.includes(f)) d.building.floors.push(f);
        // Imported maps replace stale per-window state so counts start clean.
        d.statuses = {};
        d.washedBy = {};
        d.posOverrides = {};
        d.deleted = {};
        d.customMarks = {};
      });
      setNotice({ kind: "ok", text: `Tuotiin ${count} merkintää · ${floors.length} kerrosta` });
      setMarksText("");
    } catch (err) {
      setNotice({ kind: "err", text: `Tuonti epäonnistui: ${err instanceof Error ? err.message : "virheellinen JSON"}` });
    }
  };

  const clearMarks = () => {
    if (!confirm("Tyhjennä kaikki ikkunamerkinnät tästä keikasta? Toimintoa ei voi perua.")) return;
    patch((d) => {
      d.marks = {}; d.statuses = {}; d.washedBy = {};
      d.posOverrides = {}; d.deleted = {}; d.customMarks = {};
    });
    setNotice({ kind: "ok", text: "Merkinnät tyhjennetty — muista tallentaa" });
  };

  const save = () => {
    onSave({ ...draft, updatedAt: Date.now() });
    setJustSaved(true);
    setNotice(null);
  };

  const liveMarks = countMarks(draft.marks);
  // Arvion pohja: kaikki elävät ikkunat (poistetut pois luettuna), sama luku
  // jota kartta ja laskenta käyttävät.
  const windowCount = useMemo(() => allPoints(draft).length, [draft]);
  const estPerWindow = draft.estimatedHoursPerWindow;
  const estTotal = estPerWindow && windowCount
    ? Math.round(windowCount * estPerWindow * 10) / 10
    : null;
  const fiNum = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 2 });

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: m ? "18px 12px 120px" : "26px 30px 120px" }}>
      <div style={{ maxWidth: "820px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: m ? "16px" : "22px" }}>
          <div style={{ ...mono, letterSpacing: "0.18em", marginBottom: "7px" }}>POHJAKARTAT &amp; ASETUKSET</div>
          <h1 style={{ margin: 0, fontSize: m ? "22px" : "30px", fontWeight: 700, letterSpacing: "-0.01em" }}>Mukauta keikan työkalu</h1>
        </div>

        {/* Building + pricing */}
        <div className="anim-fadeUp-0" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>RAKENNUS</div>
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: "14px" }}>
            <div>
              <label style={labelStyle}>NIMI</label>
              <input style={inputStyle} value={draft.building.name || ""} placeholder="esim. Toimisto — Bulevardi 1"
                onChange={(ev) => patch((d) => { d.building.name = ev.target.value.slice(0, 120); })} />
            </div>
            <div>
              <label style={labelStyle}>OSOITE</label>
              <input style={inputStyle} value={draft.building.address || ""} placeholder="Katuosoite"
                onChange={(ev) => patch((d) => { d.building.address = ev.target.value.slice(0, 200); })} />
            </div>
            {/* Korvaus. EI tarjolla lukitulla hinnalla: FR8 on allekirjoitettu
                maksullinen urakka, eikä sitä voi muuttaa vastikkeettomaksi
                täältä. */}
            {!priceLocked && (
              <div style={{ gridColumn: m ? "auto" : "1 / -1" }}>
                <label style={labelStyle}>KORVAUS</label>
                <Choice<GigCompensation>
                  mobile={m}
                  value={community ? "community" : "money"}
                  onChange={setCompensation}
                  options={[
                    { value: "money", label: "Maksullinen keikka", hint: "Ikkunahinta kertyy laskutukseen ja liikevaihtoon" },
                    { value: "community", label: "Yhteisökeikka — ei rahaa", hint: "Korvaus on jotain muuta kuin euroja" },
                  ]}
                />
              </div>
            )}
            <div>
              <label style={labelStyle}>HINTA / IKKUNA (€)</label>
              {community ? (
                <>
                  {/* Kenttää ei näytetä lainkaan: hinta on aidosti 0 €, eikä
                      muokattava kenttä kertoisi sitä. */}
                  <div style={{ ...inputStyle, opacity: 0.6, display: "flex", alignItems: "center" }}>0 €</div>
                  <p style={{ fontSize: "10.5px", color: "rgba(150,205,255,0.8)", marginTop: "6px", lineHeight: 1.5 }}>
                    Yhteisökeikka: euroja ei laskuteta eikä näytetä asiakkaalle, eikä keikka näy liikevaihdossa.
                  </p>
                </>
              ) : (
                <input style={{ ...inputStyle, opacity: priceLocked ? 0.6 : 1, cursor: priceLocked ? "not-allowed" : "auto" }} type="number" min={0} step={1}
                  value={priceLocked ? 37.5 : draft.pricePerWindow} disabled={priceLocked} readOnly={priceLocked}
                  onChange={(ev) => patch((d) => { d.pricePerWindow = Math.max(0, Number(ev.target.value) || 0); })} />
              )}
              {priceLocked && (
                <p style={{ fontSize: "10.5px", color: "rgba(95,224,138,0.8)", marginTop: "6px", lineHeight: 1.5 }}>
                  🔒 Sovittu sopimuksessa: 37,50 € / punainen ikkuna, katto 6300 €. Ei muokattavissa.
                </p>
              )}
              {draft.p2?.enabled && (
                <p style={{ fontSize: "10.5px", color: "rgba(255,220,110,0.75)", marginTop: "6px", lineHeight: 1.5 }}>
                  P2: keltaiset ikkunat hinnoitellaan ikkunakohtaisesti projektinäkymässä (€ Hinnoittele).
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>POHJAKUVAN POLKU (planBase)</label>
              <input style={inputStyle} value={draft.building.planBase || ""} placeholder="/fr8/plans/bp-"
                onChange={(ev) => patch((d) => { d.building.planBase = ev.target.value.slice(0, 200); })} />
              <p style={hintStyle}>
                Kerroksen kuva haetaan muodossa <code style={{ color: "rgba(255,255,255,0.55)" }}>{(draft.building.planBase || "/fr8/plans/bp-") + "<kerros>.png"}</code>
              </p>
            </div>
          </div>
        </div>

        {/* Time estimate (planning only) */}
        <div className="anim-fadeUp-1" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>TYÖMÄÄRÄN ARVIO</div>
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: "14px", alignItems: "start" }}>
            <div>
              <label style={labelStyle} htmlFor="est-hours-per-window">TUNTIA / IKKUNA</label>
              <input id="est-hours-per-window" style={inputStyle} type="number" min={0} step={0.5} placeholder="1.5"
                value={hoursText} onChange={(ev) => setHours(ev.target.value)} />
              <p style={hintStyle}>Tyhjä tai 0 = ei arviota. Iso monilohkoinen ikkuna voi viedä 1,5 h.</p>
            </div>
            <div>
              <label style={labelStyle}>KOKO KEIKAN ARVIO</label>
              <div style={{ ...inputStyle, display: "flex", alignItems: "center", background: "rgba(0,0,0,0.2)" }}>
                {estTotal !== null && estPerWindow
                  ? `${fiNum(windowCount)} × ${fiNum(estPerWindow)} ≈ ${fiNum(estTotal)} h`
                  : "—"}
              </div>
              <p style={hintStyle}>
                Pelkkä suunnittelun arvio: ei vaikuta hintaan, palkkoihin eikä kirjattuihin tunteihin.
              </p>
            </div>
          </div>
        </div>

        {/* Plan presentation + unit word */}
        <div className="anim-fadeUp-2" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ ...mono, marginBottom: "16px" }}>POHJAKUVAN ESITYS</div>
          <Choice<PlanRender>
            mobile={m}
            value={planRenderOf(draft.building)}
            onChange={(v) => patch((d) => {
              // "plan" on oletus, joten sitä EI kirjoiteta blobiin: FR8:n
              // talletettu data pysyy identtisenä eikä turhaa kenttää synny.
              if (v === "photo") d.building.planRender = "photo"; else delete d.building.planRender;
            })}
            options={[
              { value: "plan", label: "Viivapiirros (pohjakuva)", hint: "Vaalea piirros tummalla kartalla" },
              { value: "photo", label: "Valokuva / ruudunkaappaus", hint: "Kuva sellaisenaan" },
            ]}
          />
          <p style={hintStyle}>
            Valokuva näytetään asiakkaalle sellaisenaan; viivapiirroksen värit käännetään ja reunoista rajataan 2 % pois.
          </p>
          <div style={{ marginTop: "16px", maxWidth: m ? "100%" : "340px" }}>
            <label style={labelStyle} htmlFor="unit-word">SANA &quot;KERROKSEN&quot; TILALLE</label>
            <input id="unit-word" style={inputStyle} value={draft.building.unitWord || ""} placeholder="kerros"
              onChange={(ev) => patch((d) => {
                const v = ev.target.value.slice(0, 24);
                if (v) d.building.unitWord = v; else delete d.building.unitWord;
              })} />
            <p style={hintStyle}>
              Tyhjä = &quot;kerros&quot;. Yhden huoneen keikalla esim. &quot;tila&quot;, jottei kartalla lue &quot;1. kerros&quot;.
              {" "}Näyttää nyt: <strong style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{floorLabel(draft.building, draft.building.floors[0] ?? "1")}</strong>
            </p>
          </div>
        </div>

        {/* Floors + per-floor plan images */}
        <div className="anim-fadeUp-3" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <span style={mono}>{floorsHeading}</span>
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{draft.building.floors.length} kpl</span>
          </div>
          {jobId != null && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "14px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={dropPaper}
                onChange={(ev) => setDropPaper(ev.target.checked)}
                style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1, accentColor: "#5fe08a" }}
              />
              <span>
                <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.86)", fontWeight: 600 }}>Poista valkoinen tausta</span>
                <span style={{ ...hintStyle, display: "block", marginTop: "3px" }}>
                  Kartta on tumma, joten valkoisella paperilla oleva pohjapiirros on siinä iso kirkas
                  arkki. Tämä tekee paperista läpinäkyvän reunoista sisäänpäin — huoneiden sisällä
                  olevat tekstit ja mitat säilyvät. Ota pois päältä jos kuva on jo läpinäkyvä tai
                  valokuva.
                </span>
              </span>
            </label>
          )}
          {jobId == null && (
            <p style={{ ...hintStyle, marginTop: 0, marginBottom: "12px" }}>
              Kuvien lataus ei ole käytettävissä täällä: tämä näkymä ei saanut keikan tunnistetta.
              {" "}Kuvat haetaan toistaiseksi yllä olevasta pohjakuvan polusta.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px" }}>
            {draft.building.floors.map((f, i) => {
              const hasPlan = !!draft.building.planImages?.[f];
              const thumb = hasPlan ? planImageUrl(draft.building, f, planUrlBase) : null;
              const busy = !!planBusy[f];
              const err = planErr[f];
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: "9px", padding: jobId == null ? 0 : "10px", borderRadius: "14px", background: jobId == null ? "none" : "rgba(255,255,255,0.02)", border: jobId == null ? "none" : "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                    <span style={{ width: "30px", height: "30px", flexShrink: 0, borderRadius: "8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>{i + 1}</span>
                    <input style={{ ...inputStyle, flex: 1 }} value={f} aria-label={`${wordCap} ${i + 1}`} onChange={(ev) => renameFloor(i, ev.target.value)} />
                    <button onClick={() => removeFloor(i)} title={`Poista ${word}`} aria-label={`Poista ${word} ${f}`}
                      style={{ flexShrink: 0, width: "42px", height: "42px", borderRadius: "12px", border: "1px solid rgba(255,120,120,0.2)", background: "rgba(255,80,80,0.08)", color: "rgb(255,150,150)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Trash2 style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                  {jobId != null && (
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap", paddingLeft: m ? 0 : "39px" }}>
                      {thumb ? (
                        <PlanThumb url={thumb} alt={`Pohjakuva — ${floorLabel(draft.building, f)}`} />
                      ) : (
                        <span style={{ ...mono, fontSize: "9.5px" }}>EI LADATTUA KUVAA</span>
                      )}
                      {/* Piilotettu valitsin + oikea nappi: nappi on
                          näppäimistöllä saavutettava, pelkkä <label> ei olisi. */}
                      <input
                        ref={(el) => { fileInputs.current[i] = el; }}
                        type="file" accept="image/*" style={{ display: "none" }} tabIndex={-1}
                        onChange={(ev) => {
                          const file = ev.target.files?.[0];
                          // Nollataan heti, jotta saman tiedoston voi valita
                          // uudelleen (esim. epäonnistuneen latauksen jälkeen).
                          ev.target.value = "";
                          if (file) void uploadPlan(f, file);
                        }}
                      />
                      <button type="button" disabled={busy} onClick={() => fileInputs.current[i]?.click()}
                        title={`${hasPlan ? "Vaihda" : "Lataa"} pohjakuva — ${floorLabel(draft.building, f)}`}
                        style={{ padding: "8px 12px", borderRadius: "11px", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: busy ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.85)", cursor: busy ? "wait" : "pointer", fontWeight: 600, fontSize: "12.5px", display: "flex", alignItems: "center", gap: "7px", fontFamily: "var(--font-onest, system-ui, sans-serif)" }}>
                        {busy
                          ? <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
                          : <ImagePlus style={{ width: 14, height: 14 }} />}
                        {busy ? "Ladataan…" : hasPlan ? "Vaihda kuva" : "Lataa kuva"}
                      </button>
                      {hasPlan && (
                        <button type="button" disabled={busy} onClick={() => void removePlan(f)}
                          title={`Poista pohjakuva — ${floorLabel(draft.building, f)}`}
                          aria-label={`Poista pohjakuva — ${floorLabel(draft.building, f)}`}
                          style={{ width: "34px", height: "34px", flexShrink: 0, borderRadius: "11px", border: "1px solid rgba(255,120,120,0.2)", background: "rgba(255,80,80,0.08)", color: "rgb(255,150,150)", cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <X style={{ width: 14, height: 14 }} />
                        </button>
                      )}
                      {err && (
                        <span style={{ flexBasis: "100%", fontSize: "10.5px", color: "rgba(255,185,185,0.9)", lineHeight: 1.5 }}>{err}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "9px" }}>
            <input style={{ ...inputStyle, flex: 1 }} value={newFloor} placeholder={`Lisää ${word} (esim. 6 tai K)`}
              onChange={(ev) => setNewFloor(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") addFloor(); }} />
            <button onClick={addFloor}
              style={{ flexShrink: 0, padding: "0 18px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "7px" }}>
              <Plus style={{ width: 16, height: 16 }} /> Lisää
            </button>
          </div>
          {jobId != null && (
            <p style={hintStyle}>
              Ladattu kuva tallentuu heti eikä odota Tallenna-nappia: se korvaa polusta haetun kuvan omalla rivillään,
              {" "}ja poistamalla kuvan palataan polkuun. Kuva pienennetään automaattisesti ennen lähetystä.
            </p>
          )}
        </div>

        {/* Import floor mappings */}
        <div className="anim-fadeUp-4" style={{ ...card, padding: m ? "18px" : "22px 24px", marginBottom: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={mono}>OMAT POHJAKARTAT (MERKINNÄT)</span>
            <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{liveMarks} merkintää</span>
          </div>
          <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", marginBottom: "12px", lineHeight: 1.55 }}>
            Liitä ikkunamerkinnät JSON-muodossa: kerros → merkinnät, joista jokaisella on prioriteetti (p: 1/2) ja sijainti (x, y prosentteina 0–100).
          </p>
          <textarea
            value={marksText}
            onChange={(ev) => setMarksText(ev.target.value)}
            placeholder={`{\n  "K": { "marks": [{ "p": 1, "x": 24.5, "y": 60.1 }] },\n  "1": { "marks": [{ "p": 2, "x": 70, "y": 33 }] }\n}`}
            spellCheck={false}
            style={{ ...inputStyle, minHeight: "150px", resize: "vertical", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "9px", marginTop: "12px" }}>
            <button onClick={importMarks} disabled={!marksText.trim()}
              style={{ padding: "11px 18px", borderRadius: "12px", border: "none", background: marksText.trim() ? "#fff" : "rgba(255,255,255,0.1)", color: marksText.trim() ? "#0a0a0c" : "rgba(255,255,255,0.4)", cursor: marksText.trim() ? "pointer" : "default", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Upload style={{ width: 16, height: 16 }} /> Tuo merkinnät
            </button>
            <button onClick={clearMarks}
              style={{ padding: "11px 18px", borderRadius: "12px", border: "1px solid rgba(255,120,120,0.22)", background: "rgba(255,80,80,0.07)", color: "rgb(255,150,150)", cursor: "pointer", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <RotateCcw style={{ width: 16, height: 16 }} /> Tyhjennä merkinnät
            </button>
          </div>
        </div>

        {notice && (
          <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "12px 16px", borderRadius: "13px", marginBottom: "14px",
            background: notice.kind === "ok" ? "rgba(40,90,55,0.5)" : "rgba(90,45,45,0.5)",
            border: `1px solid ${notice.kind === "ok" ? "rgba(120,235,160,0.3)" : "rgba(255,140,140,0.3)"}`,
            color: notice.kind === "ok" ? "rgba(190,245,210,0.95)" : "rgba(255,200,200,0.95)", fontSize: "13px" }}>
            {notice.kind === "ok" ? <Check style={{ width: 16, height: 16, flexShrink: 0 }} /> : <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />}
            {notice.text}
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: m ? "14px 12px" : "16px 30px", background: "linear-gradient(0deg, rgba(6,6,7,0.95), rgba(6,6,7,0.0))", display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: "820px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", pointerEvents: "auto" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
            {saving ? "Tallennetaan…" : justSaved && !dirty ? "Tallennettu" : dirty ? "Tallentamattomia muutoksia" : "Ei muutoksia"}
          </span>
          <button onClick={save} disabled={!dirty || saving}
            style={{ padding: "12px 24px", borderRadius: "13px", border: "none", background: dirty && !saving ? "#fff" : "rgba(255,255,255,0.12)", color: dirty && !saving ? "#0a0a0c" : "rgba(255,255,255,0.4)", cursor: dirty && !saving ? "pointer" : "default", fontWeight: 700, fontSize: "14px", display: "flex", alignItems: "center", gap: "8px", boxShadow: dirty && !saving ? "0 8px 24px rgba(0,0,0,0.4)" : "none" }}>
            {justSaved && !dirty ? <Check style={{ width: 16, height: 16 }} /> : <Save style={{ width: 16, height: 16 }} />}
            {justSaved && !dirty ? "Tallennettu" : "Tallenna"}
          </button>
        </div>
      </div>
    </div>
  );
}
