/**
 * TYÖTAULU — keikan yhteinen tehtävä- ja viestilista.
 *
 * YKSI LISTA, KAKSI LAJIA. Tehtävä odottaa tekemistä ja sen voi kuitata;
 * merkintä on jotain joka on jo tehty tai sanottu. Ne ovat samassa listassa
 * koska ne ovat samaa keskustelua: "vaihtakaa kellarin lamput" ja "kellarin
 * lamput vaihdettu" kuuluvat vierekkäin, eivät kahteen näkymään joita pitää
 * lukea rinnakkain.
 *
 * SAMA KOMPONENTTI KOLMESSA NÄKYMÄSSÄ. Asiakas, tekijä ja johtaja katsovat
 * samaa taulua, joten se on yksi komponentti jolle teema ja oikeudet tulevat
 * propseina. Kolmena kopiona ne ehtisivät erkaantua ensimmäisessä
 * korjauksessa — ja taulu jonka kaksi osapuolta näkee eri tavalla ei ole
 * yhteinen taulu.
 *
 * KUITTAUS ON VÄITE TEHDYSTÄ TYÖSTÄ, joten sen tekee se joka työn teki:
 * `canComplete` on tekijällä ja johtajalla, ei asiakkaalla.
 */
import { useState } from "react";
import { openTaskCount, BOARD_CUSTOMER, MAX_BOARD_TEXT_LEN, type ProjBoardEntry } from "@shared/project";

export interface BoardTheme {
  font: string;
  ink: string;
  muted: string;
  faint: string;
  /** Rivin tausta. */
  fill: string;
  /** Kortin/kentän tausta. */
  card: string;
  hair: string;
  accent: string;
  /** Kuitatun rivin sävy. */
  done: string;
}

function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "juuri nyt";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} pv`;
}

interface Props {
  entries: ProjBoardEntry[];
  theme: BoardTheme;
  /** Saako lisätä rivejä? Ilman tätä taulu on lukunäkymä. */
  onAdd?: (kind: "task" | "note", text: string) => Promise<void> | void;
  /** Saako kuitata tehtäviä tehdyiksi? Asiakkaalla ei. */
  onToggle?: (id: string, done: boolean) => Promise<void> | void;
  /** Näkyykö "kuka kirjoitti" — asiakkaan näkymässä etunimet, kuten tunneissa. */
  showAuthors?: boolean;
  /** Otsikon alla oleva saate. */
  lead?: string;
}

export default function TaskBoard({ entries, theme: T, onAdd, onToggle, showAuthors = true, lead }: Props) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"task" | "note">("task");
  const [busy, setBusy] = useState(false);
  const open = openTaskCount(entries);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy || !onAdd) return;
    setBusy(true);
    await onAdd(kind, t);
    setBusy(false);
    setText("");
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "6px 13px", borderRadius: 999, cursor: "pointer",
    fontFamily: T.font, fontSize: 12.5, fontWeight: 600,
    border: `1px solid ${active ? T.accent : T.hair}`,
    background: active ? `${T.accent}1f` : "transparent",
    color: active ? T.accent : T.muted,
  });

  return (
    <div style={{ fontFamily: T.font, color: T.ink }}>
      {lead && (
        <p style={{ margin: "0 0 14px", fontSize: 13, color: T.muted, lineHeight: 1.6 }}>{lead}</p>
      )}

      {onAdd && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => setKind("task")} style={chip(kind === "task")}>Tehtävä</button>
            <button onClick={() => setKind("note")} style={chip(kind === "note")}>Merkintä</button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_BOARD_TEXT_LEN))}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }}
            rows={2}
            placeholder={kind === "task" ? "Mitä pitäisi tehdä?" : "Mitä tehtiin?"}
            style={{
              width: "100%", boxSizing: "border-box", resize: "vertical",
              padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.hair}`,
              background: T.card, color: T.ink, fontFamily: T.font, fontSize: 14, outline: "none",
            }}
          />
          <button
            onClick={submit} disabled={busy || !text.trim()}
            style={{
              marginTop: 8, padding: "9px 16px", borderRadius: 10, border: "none",
              background: text.trim() ? T.accent : T.fill,
              color: text.trim() ? "#fff" : T.faint,
              fontFamily: T.font, fontSize: 13, fontWeight: 700,
              cursor: busy || !text.trim() ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Lisätään…" : kind === "task" ? "Lisää tehtävä" : "Lisää merkintä"}
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: T.faint, lineHeight: 1.6 }}>
          Ei vielä tehtäviä eikä merkintöjä.
        </p>
      ) : (
        <>
          {open > 0 && (
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted, marginBottom: 8 }}>
              {open} tehtävää auki
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map((e) => {
              const isTask = e.kind === "task";
              const done = !!e.done;
              return (
                <div key={e.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "11px 12px", borderRadius: 10,
                  background: T.fill,
                  border: `1px solid ${isTask && !done ? T.hair : "transparent"}`,
                  opacity: done ? 0.62 : 1,
                }}>
                  {isTask && (
                    onToggle ? (
                      <button
                        onClick={() => void onToggle(e.id, !done)}
                        title={done ? "Poista kuittaus" : "Merkitse tehdyksi"}
                        aria-pressed={done}
                        style={{
                          flexShrink: 0, width: 22, height: 22, marginTop: 1, borderRadius: 6,
                          border: `1.5px solid ${done ? T.done : T.hair}`,
                          background: done ? T.done : "transparent",
                          color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: 1,
                          display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                        }}
                      >
                        {done ? "✓" : ""}
                      </button>
                    ) : (
                      <span aria-hidden style={{
                        flexShrink: 0, width: 22, height: 22, marginTop: 1, borderRadius: 6,
                        border: `1.5px solid ${done ? T.done : T.hair}`,
                        background: done ? T.done : "transparent", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                      }}>{done ? "✓" : ""}</span>
                    )
                  )}
                  {!isTask && (
                    <span aria-hidden style={{ flexShrink: 0, width: 22, marginTop: 3, textAlign: "center", color: T.faint, fontSize: 12 }}>·</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", textDecoration: done ? "line-through" : "none" }}>
                      {e.text}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.faint, marginTop: 3 }}>
                      {showAuthors && (e.byName || (e.by === BOARD_CUSTOMER ? "Asiakas" : e.by))}
                      {showAuthors && " · "}{ago(e.at)} sitten
                      {done && e.done && (
                        <> · tehty{showAuthors && e.done.byName ? ` — ${e.done.byName}` : ""}</>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
