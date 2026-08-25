/**
 * TUNTITILAN HALLINTAPANEELI — johtajan koko näkymä tuntikeikalle.
 *
 * Tarkoituksella pieni. Kohdennetun tilan dash vastaa kymmeneen kysymykseen
 * (urakka, erät, keltaisten neuvottelu, kate, kartta, kulut); tuntikeikalla on
 * yksi: KUKA ON TEHNYT MONTAKO TUNTIA. Kaikki muu tässä näkymässä olisi sitä
 * sekaannusta jota tämän tilan on määrä välttää.
 *
 * KAKSI SÄÄNTÖÄ JOTKA NÄKYVÄT SUORAAN RUUDULLA:
 *
 *   1. VAIN TUNTEJA TEHNEET NÄKYVÄT. Nollarivi ei ole tieto: se on nimi jolla
 *      ei ole tälle keikalle tekemistä. Lista pysyy lyhyenä ja luettavana myös
 *      silloin kun keikkalistalla on kymmenen tekijää.
 *   2. KÄSIN KORJAUS ON VAIN PERUSTAJILLA. Tunnit ovat palkka, ja pyöristys
 *      (`roundWorkHours`) on lähtökohta eikä viimeinen sana — mutta korjaus on
 *      johtajan päätös, ei tekijän.
 */
import { useMemo, useState } from "react";
import { roundWorkHours, type ProjectData } from "@shared/project";
import type { CrewMember } from "@shared/crew";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, card, inset, mono } from "./tokens";

/** Yksi rivi listalla. */
interface Row {
  id: string;
  name: string;
  hours: number;
  /** Vuoro käynnissä — alkuhetki, tai null. */
  activeSince: number | null;
  /** Tekijän itselleen asettama tavoite tälle vuorolle. */
  targetHours: number | null;
}

function fmtHours(h: number): string {
  return h.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
}

/** "2 h 15 min" käynnissä olevalle vuorolle. Tauot eivät ole tiedossa
 *  palvelimella, joten tämä on karkea kesto — ja se on merkitty sellaiseksi. */
function fmtElapsed(sinceMs: number, now: number): string {
  const min = Math.max(0, Math.floor((now - sinceMs) / 60000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

interface Props {
  project: ProjectData;
  workerName: (id: string) => string;
  /** Käsin lisäys/vähennys. Puuttuessaan paneeli on lukunäkymä (ei perustaja). */
  onAdjustHours?: (workerId: string, delta: number) => void;
  /** Kaikki keikan tekijät, myös ne joilla ei vielä ole tunteja — käsin
   *  lisäystä varten. */
  crew?: CrewMember[];
}

export default function HourlyPanel({ project, workerName, onAdjustHours, crew }: Props) {
  const m = useIsMobile();
  const now = Date.now();
  const [addOpen, setAddOpen] = useState(false);

  const rows: Row[] = useMemo(() => {
    const byId = new Map<string, CrewMember>((crew ?? project.crew ?? []).map((c) => [c.id, c]));
    const ids = new Set<string>([
      ...Object.keys(project.hours ?? {}),
      // Käynnissä oleva vuoro kuuluu listalle vaikka tunteja ei vielä olisi:
      // "kuka on nyt töissä" on sama kysymys kuin "kuka on tehnyt tunteja".
      ...Array.from(byId.values()).filter((c) => c.activeShiftAt).map((c) => c.id),
    ]);
    return Array.from(ids)
      .map((id): Row => {
        const c = byId.get(id);
        return {
          id,
          name: workerName(id),
          hours: project.hours?.[id] ?? 0,
          activeSince: c?.activeShiftAt ?? null,
          targetHours: c?.shiftTargetHours ?? null,
        };
      })
      .filter((r) => r.hours > 0 || r.activeSince)
      .sort((a, b) => (b.activeSince ? 1 : 0) - (a.activeSince ? 1 : 0) || b.hours - a.hours);
  }, [project.hours, project.crew, crew, workerName]);

  const totalHours = rows.reduce((n, r) => n + r.hours, 0);
  const running = rows.filter((r) => r.activeSince);
  /** Tekijät joilla ei ole vielä tunteja — käsin lisäyksen valikko. */
  const idle = (crew ?? project.crew ?? []).filter((c) => !rows.some((r) => r.id === c.id));

  const adjustBtn: React.CSSProperties = {
    width: 30, height: 30, flexShrink: 0, borderRadius: T.radius.sm,
    border: T.border.strong, background: "transparent", color: T.text.secondary,
    fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: "pointer", lineHeight: 1,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: m ? T.space.md : T.space.lg }}>
      {/* Yksi luku ylös: paljonko keikalle on tehty tunteja yhteensä. */}
      <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
        <div style={{ ...mono, color: T.text.faint }}>TUNNIT YHTEENSÄ</div>
        <div style={{ fontFamily: T.font, fontSize: m ? T.size.hero - 8 : T.size.hero, fontWeight: 700, lineHeight: 1.1 }}>
          {fmtHours(totalHours)} <span style={{ fontSize: T.size.title, fontWeight: 500, color: T.text.faint }}>h</span>
        </div>
        <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, marginTop: T.space.xs }}>
          {rows.length === 0
            ? "Kukaan ei ole vielä kirjannut tunteja."
            : `${rows.length} tekijää${running.length > 0 ? ` · ${running.length} töissä juuri nyt` : ""}`}
        </div>
      </div>

      {/* Kuka on tehnyt montako. Käynnissä olevat ylimpänä. */}
      {rows.length > 0 && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>TEKIJÄT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
            {rows.map((r) => {
              // Tavoite täynnä? Karkea arvio ilman taukoja — merkitty sellaiseksi
              // rivin tekstissä, jottei sitä lueta tarkaksi työajaksi.
              const reached = r.activeSince && r.targetHours
                ? now - r.activeSince >= r.targetHours * 3_600_000
                : false;
              return (
                <div key={r.id} style={{ ...inset, padding: T.space.md, display: "flex", alignItems: "center", gap: T.space.md, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700 }}>{r.name}</span>
                      {r.activeSince && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: `2px ${T.space.sm}px`, borderRadius: T.radius.pill, background: T.tone.goodBg, border: `1px solid ${T.tone.goodBorder}`, color: T.tone.goodSoft, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.tone.good }} />
                          töissä {fmtElapsed(r.activeSince, now)}
                        </span>
                      )}
                    </div>
                    {r.activeSince && r.targetHours && (
                      <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: reached ? T.tone.goodSoft : T.text.faint, marginTop: 3 }}>
                        {reached ? `✓ Tavoite ${r.targetHours} h saavutettu` : `Tavoite ${r.targetHours} h · noin ${fmtElapsed(r.activeSince, now)} (tauot eivät mukana)`}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexShrink: 0 }}>
                    {onAdjustHours && (
                      <button onClick={() => onAdjustHours(r.id, -1)} disabled={r.hours <= 0} title="Vähennä tunti"
                        style={{ ...adjustBtn, opacity: r.hours <= 0 ? 0.35 : 1, cursor: r.hours <= 0 ? "default" : "pointer" }}>−</button>
                    )}
                    <span style={{ minWidth: 62, textAlign: "center", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtHours(r.hours)} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                    </span>
                    {onAdjustHours && (
                      <button onClick={() => onAdjustHours(r.id, 1)} title="Lisää tunti" style={adjustBtn}>+</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {onAdjustHours && (
            <p style={{ margin: `${T.space.md}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.6 }}>
              Työaika pyöristetään lähimpään täyteen tuntiin, kun tekijä päättää vuoron.
              Korjaa luku tästä jos se meni väärin — tekijä ei näe omia tuntejaan.
            </p>
          )}
        </div>
      )}

      {/* Tunteja voi lisätä myös tekijälle joka ei ole käyttänyt ajastinta —
          esimerkiksi kun työ on tehty ennen kuin linkki otettiin käyttöön. */}
      {onAdjustHours && idle.length > 0 && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <button onClick={() => setAddOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: T.space.sm, width: "100%", padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
            <span aria-hidden style={{ color: T.text.muted, fontSize: T.size.xs }}>{addOpen ? "▾" : "▸"}</span>
            <span style={{ ...mono, color: T.text.faint }}>LISÄÄ TUNNIT TEKIJÄLLE JOKA EI OLE KIRJANNUT</span>
          </button>
          {addOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, marginTop: T.space.md }}>
              {idle.map((c) => (
                <div key={c.id} style={{ ...inset, padding: T.space.md, display: "flex", alignItems: "center", gap: T.space.md }}>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {workerName(c.id)}
                  </span>
                  <button onClick={() => onAdjustHours(c.id, 1)} style={adjustBtn}>+</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Yksi tunti kerrallaan — sama pyöristysyksikkö kuin ajastimella, jottei
 *  käsin korjaus tuota puolikkaita joita mikään muu ei tuota. */
export const HOUR_STEP = roundWorkHours(1);
