/**
 * LAMPUT & OVET — dashin ylälaidan paneeli.
 *
 * KAKSI TASOA, EI YHTÄ MUURIA. Paneeli oli kasvanut niin että se mitä piti
 * TEHDÄ oli kolmen taustatietolohkon takana. Yhdellä ruudulla luetaan yksi
 * asia, joten näkyvissä on vain se:
 *
 *   1. LUVUT     — montako ei toimi, montako on korjattu, mikä on kunnossa.
 *   2. HUOMIOTA  — rivit jotka vaativat toimenpiteen, huomautus kirjoitettavissa
 *                  suoraan riviltä ilman kartalle menoa.
 *
 * Painalluksen takana odottavat harvemmin tarvittavat: kerroskuvio (missä
 * rikkinäiset ovat), lamppumallit (mitä ostetaan) ja työlomake hintoineen.
 *
 * MIKSI PANEELI ON DASHIN ALUSSA. Huomautus kirjoitetaan pisteen popoverista —
 * oikea paikka merkitä työtä sitä tehdessä, väärä paikka lukea sitä: johtaja
 * joutuisi kiertämään kartan kerros kerrokselta löytääkseen mistä on
 * huomautettu. Tämä on sama tieto toisin päin.
 *
 * Paneeli piirtyy tyhjänä (null) kun keikalla ei ole lamppuja eikä ovia, joten
 * kalusteettomalla keikalla dash on tavu tavulta entinen.
 */
import { useMemo, useState } from "react";
import {
  fixtureAttentionRows, computeLampInventory, computeDoorTotals,
  resolveFixtureOrder, computeLampModelStats, floorLabel, eurFromCents, MAX_LAMP_MODELS,
  MAX_FIXTURE_NOTE_LEN, MAX_FIXTURE_MODEL_LEN, MAX_FIXTURE_ORDER_NOTE_LEN,
  type ProjectData, type FixtureAttentionRow, type FixtureOrder, type LampModel,
  type LampStatus, type LampCondition, type DoorStatus,
} from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";
import Section from "./Section";
import LampFloorChart, { type LampChartTheme } from "@/components/LampFloorChart";
import { STAR_CLIP } from "@/lib/fixture-marks";
import { T, inset, mono } from "./tokens";


/**
 * Kuvion sävyt FR8:n tummalle kortille (#141416).
 *
 * MITATTU, ei valittu silmällä: CVD-erottelu 14,1 ΔE ja normaalinäön erottelu
 * 19,6 ΔE pahimmalla vierekkäisellä parilla, kaikki neljä yli 3:1 pintaa
 * vasten. "Toimii" on harmaa tarkoituksella — se tarkoittaa "ei tehtävää", ja
 * kuvion pitää nostaa esiin se mikä vaatii työtä.
 */
const CHART_DARK: LampChartTheme = {
  broken: "#ff7474",
  unchecked: "#ffc45a",
  working: "#969baa",
  changed: "#7ce0a6",
  surface: "rgba(255,255,255,0.07)",
  text: T.text.primary,
  muted: T.text.faint,
  font: T.font,
};

function ago(ts?: number): string {
  if (!ts) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "juuri nyt";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} pv`;
}

/** Kaipaako rivi huomiota? Sama kolmikko kuin `attentionRank`in kärjessä. */
function needsAttention(r: FixtureAttentionRow): boolean {
  return r.condition === "rikki" || !!r.note?.text || r.status === "ei";
}

const fieldStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: T.radius.sm,
  border: T.border.strong, background: T.surface.sunken, color: T.text.primary,
  fontFamily: T.font, fontSize: T.size.sm, outline: "none",
};

interface Props {
  project: ProjectData;
  workerName: (id: string) => string;
  onGoToFloor: (floor: string) => void;
  onSetLampStatus?: (key: string, status: LampStatus) => void;
  onSetLampCondition?: (key: string, condition: LampCondition | null) => void;
  onSetLampNote?: (key: string, text: string) => void;
  onSetDoorStatus?: (key: string, status: DoorStatus) => void;
  onSetDoorNote?: (key: string, text: string) => void;
  /** Ostotieto (malli, määrä). Ilman tätä ostoslohko on lukunäkymä. */
  onSetFixtureOrder?: (patch: Partial<FixtureOrder>) => void;
  /** Lisää keikalle lamppumalli. Palauttaa uuden mallin id:n. */
  onAddLampModel?: (name: string) => void;
  /** Poista malli. Sitä käyttävät lamput palaavat "ei mallia" -tilaan. */
  onRemoveLampModel?: (id: string) => void;
}

export default function FixturePanel({
  project, workerName, onGoToFloor,
  onSetLampStatus, onSetLampCondition, onSetLampNote, onSetDoorStatus, onSetDoorNote,
  onSetFixtureOrder, onAddLampModel, onRemoveLampModel,
}: Props) {
  const m = useIsMobile();
  const rows = useMemo(() => fixtureAttentionRows(project), [project]);
  const inv = useMemo(() => computeLampInventory(project), [project]);
  const order = useMemo(() => resolveFixtureOrder(project), [project]);
  const doorT = useMemo(() => computeDoorTotals(project), [project]);
  const modelStats = useMemo(() => computeLampModelStats(project), [project]);
  const [newModel, setNewModel] = useState("");
  // Huomautusten määrä luetaan `rows`ista eikä omalla kierroksellaan: rows on jo
  // laskettu ja sisältää täsmälleen samat pisteet.
  const notedCount = useMemo(() => rows.filter((r) => !!r.note?.text).length, [rows]);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (rows.length === 0) return null;

  const attention = rows.filter(needsAttention);
  const shown = showAll ? rows : attention;

  function startEdit(r: FixtureAttentionRow) { setEditing(r.key); setDraft(r.note?.text ?? ""); }
  function saveEdit(r: FixtureAttentionRow) {
    const text = draft.slice(0, MAX_FIXTURE_NOTE_LEN);
    if (r.kind === "lamp") onSetLampNote?.(r.key, text); else onSetDoorNote?.(r.key, text);
    setEditing(null); setDraft("");
  }

  // Palkin tiivistelmä kertoo mikä kaipaa huomiota, ei mikä on tehty.
  const summary = [
    inv.needsBulbs > 0 ? `${inv.needsBulbs} lamppua ei toimi` : null,
    doorT.open > 0 ? `${doorT.open} ovea kesken` : null,
    notedCount > 0 ? `${notedCount} huomautusta` : null,
  ].filter(Boolean).join(" · ") || `${inv.fixed}/${inv.total} lamppua vaihdettu`;

  return (
    <Section id="fixtures" label="LAMPUT & OVET" summary={summary} animClass="anim-fadeUp-2" defaultOpen={attention.length > 0}>
      {/* 1. LUVUT. "Ostettava" on ensimmäisenä koska se on se luku jonka takia
          tätä paneelia katsotaan — siitä tehdään kauppalista. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: m ? T.space.sm : T.space.md, marginBottom: T.space.lg }}>
        {([
          ["Ei toimi", `${inv.needsBulbs}`, "vaihtoa tehtävänä", inv.needsBulbs > 0 ? T.tone.bad : T.text.muted],
          ["Vaihdettu", `${inv.fixed}`, "tähän mennessä", T.tone.goodSoft],
          ["Kunnossa", `${inv.functional}/${inv.checked}`, `tarkastetuista · ${Math.round(inv.functionalPct)} %`, T.text.primary],
          ["Tarkastamatta", `${inv.unchecked}`, `${inv.total} merkitystä lampusta`, inv.unchecked > 0 ? T.tone.warn : T.text.muted],
        ] as [string, string, string, string][]).map(([label, val, sub, tone]) => (
          <div key={label} style={inset}>
            <div style={{ ...mono, color: T.text.faint }}>{label}</div>
            <div style={{ fontFamily: T.font, fontSize: m ? T.size.lg : T.size.title, fontWeight: 700, color: tone }}>{val}</div>
            <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* MITÄ LUVUT KOSKEVAT. Merkitsemätön lamppu on tälle laskennalle
          olematon — ei "tarkastamaton" vaan tuntematon. Ilman tätä lausetta
          "5 lamppua" luetaan "talossa on 5 lamppua", ja se lupaus menee
          sellaisenaan myös asiakkaan sivulle. */}
      <p style={{ margin: `0 0 ${T.space.lg}px`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.6 }}>
        Luvut koskevat vain kartalle merkittyjä lamppuja ({inv.total} kpl) — eivät kiinteistön kaikkia lamppuja.
        Sama teksti näkyy asiakkaalle.
      </p>

      {/* 2. MIKÄ KAIPAA HUOMIOTA. Tämä on se lista jonka takia paneeli
          avataan, joten se tulee heti lukujen jälkeen — ei kolmen lohkon
          takaa kuten ennen. Kerroskuvio, mallit ja työt ovat tarpeellisia
          mutta harvemmin, joten ne odottavat painalluksen takana alla. */}
      {shown.length === 0 ? (
        <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>
          Ei huomiota kaipaavia lamppuja tai ovia.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          {shown.map((r) => {
            const lamp = r.kind === "lamp";
            const done = lamp ? r.status === "vaihdettu" : r.status === "tehty";
            const rgb = r.condition === "rikki" ? "255,116,116" : done ? "124,224,166" : lamp ? "255,196,90" : "156,193,255";
            const isEditing = editing === r.key;
            return (
              <div key={r.key} style={{ ...inset, padding: T.space.md, display: "flex", flexDirection: "column", gap: T.space.sm }}>
                <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
                  {lamp ? (
                    <span aria-hidden style={{ width: 13, height: 13, flexShrink: 0, display: "inline-block", clipPath: STAR_CLIP, background: `rgb(${rgb})` }} />
                  ) : (
                    <span aria-hidden style={{ width: 10, height: 14, flexShrink: 0, borderRadius: "3px 3px 1px 1px", background: `rgb(${rgb})` }} />
                  )}
                  <button
                    onClick={() => onGoToFloor(r.floor)}
                    title="Näytä kartalla"
                    style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: T.text.primary, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, textAlign: "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {r.label || (lamp ? "Lamppu" : "Ovi")} <span style={{ color: T.text.faint, fontWeight: 500 }}>· {floorLabel(project.building, r.floor)}</span>
                  </button>

                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: T.space.xs + 2, flexWrap: "wrap" }}>
                    <button
                      onClick={() => (lamp
                        ? onSetLampStatus?.(r.key, done ? "ei" : "vaihdettu")
                        : onSetDoorStatus?.(r.key, done ? "ei" : "tehty"))}
                      disabled={lamp ? !onSetLampStatus : !onSetDoorStatus}
                      style={{
                        padding: `${T.space.xs}px ${T.space.sm + 2}px`, borderRadius: T.radius.pill,
                        cursor: (lamp ? onSetLampStatus : onSetDoorStatus) ? "pointer" : "default",
                        border: `1px solid ${done ? T.tone.goodBorder : "rgba(255,255,255,0.14)"}`,
                        background: done ? T.tone.goodBg : "transparent",
                        color: done ? T.tone.goodSoft : T.text.muted,
                        fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600,
                      }}
                    >
                      {lamp ? (done ? "Vaihdettu" : "Ei vaihdettu") : (done ? "Tehty" : "Tekemättä")}
                    </button>
                    {lamp && onSetLampCondition && (
                      <button
                        onClick={() => onSetLampCondition(r.key, r.condition === "rikki" ? null : "rikki")}
                        title={r.condition === "rikki" ? "Poista rikki-merkintä" : "Merkitse rikkinäiseksi"}
                        style={{
                          padding: `${T.space.xs}px ${T.space.sm + 2}px`, borderRadius: T.radius.pill, cursor: "pointer",
                          border: `1px solid ${r.condition === "rikki" ? T.tone.badBorder : "rgba(255,255,255,0.14)"}`,
                          background: r.condition === "rikki" ? T.tone.badBg : "transparent",
                          color: r.condition === "rikki" ? T.tone.bad : T.text.muted,
                          fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600,
                        }}
                      >
                        {r.condition === "rikki" ? "Ei toimi" : r.condition === "toimiva" ? "Toimii" : "Toimiiko?"}
                      </button>
                    )}
                  </span>
                </div>

                {done && r.by && (
                  <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>
                    {lamp ? "Vaihtoi" : "Teki"} <b style={{ color: T.text.secondary, fontWeight: 600 }}>{workerName(r.by)}</b>{r.at ? ` · ${ago(r.at)} sitten` : ""}
                  </div>
                )}

                {isEditing ? (
                  <div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.slice(0, MAX_FIXTURE_NOTE_LEN))}
                      placeholder={lamp ? "Esim. ”Kupu rikki, uusi tilattava”" : "Esim. ”Lukko jumittaa”"}
                      autoFocus rows={2}
                      style={{ ...fieldStyle, resize: "none" }}
                    />
                    <div style={{ display: "flex", gap: T.space.sm, marginTop: T.space.sm }}>
                      <button onClick={() => { setEditing(null); setDraft(""); }}
                        style={{ padding: `${T.space.sm - 1}px ${T.space.md}px`, borderRadius: T.radius.sm, border: T.border.strong, background: "transparent", color: T.text.secondary, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                        Peru
                      </button>
                      <button onClick={() => saveEdit(r)}
                        style={{ flex: 1, padding: `${T.space.sm - 1}px ${T.space.md}px`, borderRadius: T.radius.sm, border: "none", background: "#fff", color: "#0a0a0c", fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700, cursor: "pointer" }}>
                        {draft.trim() ? "Tallenna huomautus" : "Poista huomautus"}
                      </button>
                    </div>
                  </div>
                ) : r.note?.text ? (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: T.space.sm, padding: `${T.space.sm}px ${T.space.md - 2}px`, borderRadius: T.radius.sm, background: T.tone.warnBg, border: `1px solid ${T.tone.warnBorder}` }}>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.secondary, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {r.note.text}
                      <span style={{ display: "block", marginTop: 2, fontSize: T.size.xs, color: T.text.faint }}>
                        {r.note.by ? workerName(r.note.by) : "—"}{r.note.ts ? ` · ${ago(r.note.ts)} sitten` : ""}
                      </span>
                    </span>
                    {(lamp ? onSetLampNote : onSetDoorNote) && (
                      <button onClick={() => startEdit(r)}
                        style={{ flexShrink: 0, background: "transparent", border: "none", padding: `2px ${T.space.xs}px`, color: T.tone.info, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                        Muokkaa
                      </button>
                    )}
                  </div>
                ) : (lamp ? onSetLampNote : onSetDoorNote) ? (
                  <button onClick={() => startEdit(r)}
                    style={{ alignSelf: "flex-start", background: "transparent", border: "none", padding: 0, color: T.tone.info, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                    + Lisää huomautus
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {rows.length > attention.length && (
        <button onClick={() => setShowAll((v) => !v)}
          style={{ marginTop: T.space.md, background: "transparent", border: "none", padding: 0, color: T.text.muted, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
          {showAll ? "Näytä vain huomiota kaipaavat" : `Näytä kaikki (${rows.length})`}
        </button>
      )}

      {/* LOPUT PAINALLUKSEN TAAKSE.

          Paneeli oli kasvanut muuriksi: neljä tiiltä, saate, kerroskuvio,
          mallilista, työlomake ja vasta sitten se mitä piti tehdä. Kaikki
          tarpeellista, mutta ei yhtä aikaa — yhdellä ruudulla luetaan yksi
          asia. Natiivi <details> on sama kuvio kuin asiakkaan kartan
          selitteessä, eikä se tuo uutta komponenttia mukanaan. */}
      <details style={{ marginTop: T.space.lg }}>
        <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: T.space.sm, padding: `${T.space.sm}px 0`, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, color: T.text.muted }}>
          <span aria-hidden style={{ fontSize: T.size.xs }}>▸</span>
          Kerrokset, mallit ja työt
        </summary>
        <div style={{ marginTop: T.space.md }}>
        {/* KERROKSITTAIN — missä työ on. */}
        {/* Kortti vain kun kuviolla on vertailtavaa (≥ 2 kerrosta) — sama raja
            kuin `LampFloorChart`issa, jottei tyhjä laatikko jää jäljelle. */}
        {inv.byFloor.length > 1 && (
          <div style={{ ...inset, padding: T.space.lg, marginBottom: T.space.lg }}>
            <LampFloorChart
              rows={inv.byFloor}
              theme={CHART_DARK}
              title="Merkityt lamput kerroksittain"
              floorLabel={(f) => floorLabel(project.building, f)}
              onFloorClick={onGoToFloor}
            />
          </div>
        )}

        {/* LAMPPUMALLIT. Kaikki lamput eivät ole samaa mallia, ja kokonaismäärä
            ei kelpaa ostoksiin: seitsemän rikkinäistä voi olla neljä E27:ää ja
            kolme G9:ää. Johtaja ylläpitää listaa tässä; malli osoitetaan
            lampulle kartalta sen popoverista.

            Mallittomat näkyvät omana rivinään eivätkä katoa summaan — ne ovat se
            osa listaa jota ei voi vielä ostaa. */}
        {inv.total > 0 && (onAddLampModel || modelStats.length > 0) && (
          <div style={{ ...inset, padding: T.space.lg, marginBottom: T.space.lg }}>
            <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>LAMPPUMALLIT</div>

            {modelStats.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, marginBottom: T.space.md }}>
                {modelStats.map((mdl) => (
                  <div key={mdl.id ?? "none"} style={{ display: "flex", alignItems: "center", gap: T.space.sm, padding: `${T.space.sm}px ${T.space.md - 2}px`, borderRadius: T.radius.sm, background: T.surface.raised, border: mdl.id ? T.border.subtle : `1px dashed ${T.tone.warnBorder}` }}>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, color: mdl.id ? T.text.primary : T.tone.warn, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {mdl.name}
                    </span>
                    <span style={{ flexShrink: 0, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, fontVariantNumeric: "tabular-nums" }}>
                      {mdl.total} lamppua
                    </span>
                    <span style={{ flexShrink: 0, minWidth: 76, textAlign: "right", fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: mdl.needsBulb > 0 ? T.tone.bad : T.text.faint }}>
                      {mdl.needsBulb > 0 ? `${mdl.needsBulb} ostettava` : "—"}
                    </span>
                    {mdl.id && onRemoveLampModel && (
                      <button
                        onClick={() => {
                          if (typeof window === "undefined" || window.confirm(`Poistetaanko malli "${mdl.name}"? Sitä käyttävät lamput jäävät ilman mallia.`)) {
                            onRemoveLampModel(mdl.id!);
                          }
                        }}
                        title="Poista malli"
                        style={{ flexShrink: 0, background: "transparent", border: "none", padding: `2px ${T.space.xs}px`, color: T.tone.bad, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: `0 0 ${T.space.md}px`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.6 }}>
                Ei malleja. Lisää ne tähän, niin voit osoittaa kullekin lampulle oman mallinsa
                kartalta — ostoslista eritellään mallin mukaan.
              </p>
            )}

            {onAddLampModel && (modelStats.filter((m) => m.id).length < MAX_LAMP_MODELS) && (
              <div style={{ display: "flex", gap: T.space.sm }}>
                <input
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newModel.trim()) { onAddLampModel(newModel.trim()); setNewModel(""); }
                  }}
                  placeholder="Lisää malli, esim. E27 LED 9W 2700K"
                  maxLength={80}
                  style={{ ...fieldStyle, flex: 1 }}
                />
                <button
                  onClick={() => { if (newModel.trim()) { onAddLampModel(newModel.trim()); setNewModel(""); } }}
                  disabled={!newModel.trim()}
                  style={{ flexShrink: 0, padding: `0 ${T.space.lg}px`, borderRadius: T.radius.sm, border: "none", background: newModel.trim() ? "#fff" : T.surface.raised, color: newModel.trim() ? "#0a0a0c" : T.text.faint, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700, cursor: newModel.trim() ? "pointer" : "default" }}
                >
                  Lisää
                </button>
              </div>
            )}
          </div>
        )}

        {/* TYÖT JA TARVIKKEET. Määrä on LASKETTU oletuksena: käsin ylläpidetty luku
            vanhenisi joka kerta kun tekijä merkitsee uuden rikkinäisen. Johtaja
            voi silti korjata sen (varalamput, pakkauskoko), ja silloin näkymä
            sanoo että luku on hänen. */}
        <div style={{ ...inset, padding: T.space.lg, marginBottom: T.space.lg }}>
          <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>TEHTÄVÄT TYÖT JA TARVIKKEET</div>
          {/* Sama luku on samaan aikaan ostettavien tarvikkeiden määrä JA
              vaihtotöiden määrä — jokainen rikkinäinen lamppu on yksi polttimo ja
              yksi vaihto. Asiakkaan hinta koskee VAIHTOA, ei tarviketta. */}
          <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr auto", gap: T.space.md, alignItems: "end" }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginBottom: T.space.xs }}>Lampun malli — mitä kohteeseen menee</span>
              <input
                defaultValue={order.lampModel ?? ""}
                key={`lm-${order.lampModel ?? ""}`}
                placeholder="Esim. E27 LED 9W 2700K"
                maxLength={MAX_FIXTURE_MODEL_LEN}
                disabled={!onSetFixtureOrder}
                onBlur={(e) => onSetFixtureOrder?.({ lampModel: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={fieldStyle}
              />
            </label>
            <div style={{ minWidth: 132 }}>
              <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginBottom: T.space.xs }}>Vaihtoa</span>
              <input
                type="number" min={0}
                defaultValue={order.bulbs}
                key={`lb-${order.bulbs}-${order.bulbsManual}`}
                disabled={!onSetFixtureOrder}
                onBlur={(e) => onSetFixtureOrder?.({ bulbsNeeded: e.target.value === "" ? undefined : Number(e.target.value) })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
              />
              <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: T.space.xs }}>
                {order.bulbsManual ? (
                  <>käsin · kartalta {order.bulbsAuto}{onSetFixtureOrder && (
                    <button onClick={() => onSetFixtureOrder({ bulbsNeeded: undefined })}
                      style={{ marginLeft: 6, background: "transparent", border: "none", padding: 0, color: T.tone.info, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                      palauta
                    </button>
                  )}</>
                ) : "laskettu kartalta"}
              </div>
            </div>
          </div>

          {doorT.total > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr auto", gap: T.space.md, alignItems: "end", marginTop: T.space.md }}>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginBottom: T.space.xs }}>Oven tiiviste — mitä kohteeseen menee</span>
                <input
                  defaultValue={order.doorMaterial ?? ""}
                  key={`dm-${order.doorMaterial ?? ""}`}
                  placeholder="Esim. EPDM D-tiiviste, valkoinen"
                  maxLength={MAX_FIXTURE_MODEL_LEN}
                  disabled={!onSetFixtureOrder}
                  onBlur={(e) => onSetFixtureOrder?.({ doorMaterial: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  style={fieldStyle}
                />
              </label>
              <div style={{ minWidth: 132 }}>
                <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginBottom: T.space.xs }}>Vaihtoa</span>
                <input
                  type="number" min={0}
                  defaultValue={order.doorCount}
                  key={`dc-${order.doorCount}-${order.doorCountManual}`}
                  disabled={!onSetFixtureOrder}
                  onBlur={(e) => onSetFixtureOrder?.({ doorsNeeded: e.target.value === "" ? undefined : Number(e.target.value) })}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
                />
                <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: T.space.xs }}>
                  {order.doorCountManual ? `käsin · kartalta ${order.doorCountAuto}` : "tekemättömät ovet"}
                </div>
              </div>
            </div>
          )}

          <label style={{ display: "block", marginTop: T.space.md }}>
            <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginBottom: T.space.xs }}>Huomio tilauksesta — näkyy asiakkaalle</span>
            <input
              defaultValue={order.note ?? ""}
              key={`on-${order.note ?? ""}`}
              placeholder="Esim. ”Tilataan kun asiakas vahvistaa hinnan”"
              maxLength={MAX_FIXTURE_ORDER_NOTE_LEN}
              disabled={!onSetFixtureOrder}
              onBlur={(e) => onSetFixtureOrder?.({ note: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={fieldStyle}
            />
          </label>

          {/* Asiakkaan hintaehdotus. Luettavaa, ei muokattavaa: se on hänen
              sanansa, ja johtajan muokkaamana se ei enää olisi sitä. */}
          {order.quote ? (
            <div style={{ marginTop: T.space.md, padding: `${T.space.sm + 2}px ${T.space.md}px`, borderRadius: T.radius.sm, background: T.tone.infoBg, border: `1px solid ${T.tone.infoBorder}` }}>
              <div style={{ ...mono, color: "rgba(190,205,255,0.85)", marginBottom: T.space.xs }}>ASIAKKAAN HINTAEHDOTUS · {ago(order.quote.at)} sitten</div>
              <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.secondary }}>
                {order.quote.lampWorkPriceCents != null && <>Lampun vaihto <b style={{ color: T.text.primary, fontWeight: 700 }}>{eurFromCents(order.quote.lampWorkPriceCents)}</b>/kpl</>}
                {order.quote.lampWorkPriceCents != null && order.quote.doorWorkPriceCents != null && " · "}
                {order.quote.doorWorkPriceCents != null && <>Tiivisteen vaihto <b style={{ color: T.text.primary, fontWeight: 700 }}>{eurFromCents(order.quote.doorWorkPriceCents)}</b>/kpl</>}
                {order.quotedTotalCents != null && (
                  <span style={{ display: "block", marginTop: 2, color: T.tone.info }}>
                    Työt yhteensä tällä hinnalla <b style={{ fontWeight: 700 }}>{eurFromCents(order.quotedTotalCents)}</b>
                  </span>
                )}
              </div>
              {order.quote.note && (
                <div style={{ marginTop: T.space.sm, fontFamily: T.font, fontSize: T.size.sm, color: T.text.secondary, whiteSpace: "pre-wrap" }}>{order.quote.note}</div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: T.space.md, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>
              Asiakas ei ole vielä ehdottanut hintaa. Lomake on hänen seurantasivullaan.
            </div>
          )}
        </div>

        </div>
      </details>
    </Section>
  );
}
