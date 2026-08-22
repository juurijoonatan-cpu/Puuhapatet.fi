/**
 * LAMPUT & OVET — dashin ylälaidan huomautuspaneeli.
 *
 * MIKÄ ONGELMA TÄMÄ RATKAISEE. Lamppu- ja ovipisteet elävät pohjapiirroksella,
 * ja huomautus kirjoitetaan pisteen popoverista. Se on oikea paikka merkitä
 * työtä sitä tehdessä, mutta väärä paikka lukea sitä: johtaja joutuisi
 * kiertämään kartan kerros kerrokselta löytääkseen mistä on huomautettu. Tämä
 * paneeli on sama tieto toisin päin — yksi lista siitä mikä kaipaa huomiota,
 * heti keltaisten vieressä dashin alussa, ja huomautuksen voi kirjoittaa
 * suoraan riviltä ilman kartalle menoa.
 *
 * JÄRJESTYS ON KIIREELLISYYS, ei kerros: rikki → huomautettu → tekemättä →
 * valmis (`fixtureAttentionRows`). Oletuksena näkyvät vain huomiota kaipaavat
 * rivit; "Näytä kaikki" avaa loput.
 *
 * Paneeli piirtyy vain kun keikalla on lamppuja tai ovia, joten kalusteettomalla
 * keikalla dash on tavu tavulta entinen.
 */
import { useMemo, useState } from "react";
import {
  fixtureAttentionRows, computeLampTotals, computeDoorTotals, floorLabel,
  MAX_FIXTURE_NOTE_LEN,
  type ProjectData, type FixtureAttentionRow, type LampStatus, type LampCondition, type DoorStatus,
} from "@shared/project";
import { useIsMobile } from "@/hooks/use-mobile";
import Section from "./Section";
import { T, inset, mono } from "./tokens";

/** Viisisakarainen tähti — sama merkki kuin kartalla, jotta rivi ja piste
 *  tunnistaa toisikseen ilman selitystä. */
const STAR_CLIP = "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";

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

interface Props {
  project: ProjectData;
  workerName: (id: string) => string;
  /** Hyppy kartalle oikeaan kerrokseen. */
  onGoToFloor: (floor: string) => void;
  onSetLampStatus?: (key: string, status: LampStatus) => void;
  onSetLampCondition?: (key: string, condition: LampCondition | null) => void;
  onSetLampNote?: (key: string, text: string) => void;
  onSetDoorStatus?: (key: string, status: DoorStatus) => void;
  onSetDoorNote?: (key: string, text: string) => void;
}

export default function FixturePanel({
  project, workerName, onGoToFloor,
  onSetLampStatus, onSetLampCondition, onSetLampNote, onSetDoorStatus, onSetDoorNote,
}: Props) {
  const m = useIsMobile();
  const rows = useMemo(() => fixtureAttentionRows(project), [project]);
  const lampT = computeLampTotals(project);
  const doorT = computeDoorTotals(project);
  const [showAll, setShowAll] = useState(false);
  /** Avoin huomautuskenttä: `null` = ei mikään, muuten pisteen avain. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (rows.length === 0) return null;

  const attention = rows.filter(needsAttention);
  const shown = showAll ? rows : attention;

  function startEdit(r: FixtureAttentionRow) {
    setEditing(r.key);
    setDraft(r.note?.text ?? "");
  }

  function saveEdit(r: FixtureAttentionRow) {
    const text = draft.slice(0, MAX_FIXTURE_NOTE_LEN);
    if (r.kind === "lamp") onSetLampNote?.(r.key, text);
    else onSetDoorNote?.(r.key, text);
    setEditing(null);
    setDraft("");
  }

  // Tiivistelmä palkkiin: mikä kaipaa huomiota, ei mikä on tehty.
  const summary = [
    lampT.broken > 0 ? `${lampT.broken} rikki` : null,
    doorT.open > 0 ? `${doorT.open} ovea kesken` : null,
    lampT.noted + doorT.noted > 0 ? `${lampT.noted + doorT.noted} huomautusta` : null,
  ].filter(Boolean).join(" · ") || `${lampT.changed}/${lampT.total} lamppua vaihdettu`;

  return (
    <Section
      id="fixtures"
      label="LAMPUT & OVET"
      summary={summary}
      animClass="anim-fadeUp-2"
      defaultOpen={attention.length > 0}
    >
      {/* Yläriville se mitä asiakas näkee. Ilman tätä lukua "näkyykö tämä
          asiakkaalle" jäisi pisteen popoverin sisään, eikä johtaja tietäisi
          mitä seurantasivu juuri nyt kertoo. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: m ? T.space.sm : T.space.md, marginBottom: T.space.lg }}>
        {([
          ["Lamppuja", `${lampT.total}`, `${lampT.changed} vaihdettu · ${lampT.broken} rikki`],
          ["Ovia", `${doorT.total}`, `${doorT.done} tehty · ${doorT.open} kesken`],
          ["Huomautuksia", `${lampT.noted + doorT.noted}`, "kaikilta tekijöiltä"],
          ["Asiakas näkee", `${lampT.visible + doorT.visible}`, "vaihdetut, rikki & huomautetut"],
        ] as [string, string, string][]).map(([label, val, sub]) => (
          <div key={label} style={inset}>
            <div style={{ ...mono, color: T.text.faint }}>{label}</div>
            <div style={{ fontFamily: T.font, fontSize: m ? T.size.lg : T.size.title, fontWeight: 700 }}>{val}</div>
            <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>{sub}</div>
          </div>
        ))}
      </div>

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
                    {/* Tila yhtenä napautuksena — sama merkintä kuin kartalla. */}
                    <button
                      onClick={() => (lamp
                        ? onSetLampStatus?.(r.key, done ? "ei" : "vaihdettu")
                        : onSetDoorStatus?.(r.key, done ? "ei" : "tehty"))}
                      disabled={lamp ? !onSetLampStatus : !onSetDoorStatus}
                      style={{
                        padding: `${T.space.xs}px ${T.space.sm + 2}px`, borderRadius: T.radius.pill, cursor: (lamp ? onSetLampStatus : onSetDoorStatus) ? "pointer" : "default",
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
                      autoFocus
                      rows={2}
                      style={{ width: "100%", boxSizing: "border-box", resize: "none", padding: `${T.space.sm}px ${T.space.md - 2}px`, borderRadius: T.radius.sm, border: T.border.strong, background: T.surface.sunken, color: T.text.primary, fontFamily: T.font, fontSize: T.size.sm, outline: "none" }}
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
    </Section>
  );
}
