/**
 * TUNTITILAN NÄKYMÄ — kolme kysymystä, ei enempää.
 *
 *   1. MIKÄ PÄIVÄ ON JA PALJONKO SILLE ON TEHTY.
 *   2. OLENKO MINÄ TÖISSÄ JUURI NYT (ja jos en, miten aloitan).
 *   3. KUKA ON TEHNYT MONTAKO TUNTIA.
 *
 * Kaikki muu kuuluu projektipuolelle. Sinne pääsee ovelta yhdellä
 * napautuksella, joten mitään ei tarvitse kopioida tänne varmuuden vuoksi.
 *
 * LUVUT TULEVAT `shifts`ISTÄ, EIVÄT `hours`ISTA. Tämä on koko näkymän tärkein
 * sääntö ja sen syy on ikävä: aiempi versio luki vanhan projektityökalun
 * `hours`-summaa, joten se avautui näyttäen 255 tuntia joita kukaan ei ollut
 * tehnyt tälle työlle. Tuntitilassa tuntiluku on asiakkaan lasku ja tekijän
 * palkka, joten väärä luku ei ole kosmeettinen vika. Ks. `ProjShift`.
 *
 * PÄIVÄMÄÄRÄ ON AINA NÄKYVISSÄ — otsikossa ja jokaisella päiväkirjan rivillä.
 * Tuntikirjanpito jossa lukee vain "38 h" ei kestä yhtäkään kysymystä siitä
 * milloin ne tunnit tehtiin.
 */
import { useEffect, useMemo, useState } from "react";
import {
  computeShiftStats, dayKey, fmtDayLabel, fmtShiftHours, roundWorkHours,
  type ProjShift,
} from "@shared/project";
import type { CrewMember } from "@shared/crew";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, card, inset, mono } from "./tokens";

interface Props {
  shifts: ProjShift[] | undefined;
  crew: CrewMember[];
  workerName: (id: string) => string;
  /** Kirjautuneen id — hänelle näytetään oma ajastin. */
  me?: string;
  /** Käynnistä/päätä työtunti. Puuttuessaan ajastinta ei näytetä. */
  onStartShift?: (workerId: string) => void;
  onStopShift?: (workerId: string) => void;
  /** Käsin lisäys/vähennys. Puuttuessaan paneeli on lukunäkymä (ei perustaja). */
  onAdjustHours?: (workerId: string, delta: number) => void;
  /** Poista väärin kirjattu rivi päiväkirjasta. */
  onRemoveShift?: (id: string) => void;
  busy?: boolean;
}

/** "1 h 12 min" — käynnissä olevan vuoron karkea kesto. */
function fmtElapsed(sinceMs: number, now: number): string {
  const min = Math.max(0, Math.floor((now - sinceMs) / 60000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/** "maanantaina 25.8." — otsikon päivä, ilman vuotta (se on tänään). */
function todayLabel(now: number): string {
  return new Date(now).toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "numeric" });
}

export default function HourlyPanel({
  shifts, crew, workerName, me, onStartShift, onStopShift, onAdjustHours, onRemoveShift, busy,
}: Props) {
  const m = useIsMobile();
  const [now, setNow] = useState(() => Date.now());
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const running = useMemo(() => crew.filter((c) => c.activeShiftAt), [crew]);

  // Kello käy vain kun joku on töissä. Muuten tämä olisi pelkkä uudelleenpiirto
  // minuutin välein ilman että mikään ruudulla muuttuu.
  useEffect(() => {
    if (running.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [running.length]);

  const today = dayKey(now);
  const stats = useMemo(() => computeShiftStats(shifts, today), [shifts, today]);

  const mine = me ? crew.find((c) => c.id === me) : undefined;
  const myShift = mine?.activeShiftAt ?? null;

  /** Tekijät joilla ei ole vielä yhtään tuntia — käsin lisäyksen valikko. */
  const idle = crew.filter((c) => !stats.byWorker.some((r) => r.id === c.id) && !c.activeShiftAt);

  const adjustBtn: React.CSSProperties = {
    width: 32, height: 32, flexShrink: 0, borderRadius: T.radius.sm,
    border: T.border.strong, background: "transparent", color: T.text.secondary,
    fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: "pointer", lineHeight: 1,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: m ? T.space.md : T.space.lg }}>
      {/* 1. PÄIVÄ JA PÄIVÄN TUNNIT. Päivämäärä on otsikko eikä alaviite. */}
      <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
        <div style={{ ...mono, color: T.text.faint }}>{todayLabel(now).toUpperCase()}</div>
        <div style={{ fontFamily: T.font, fontSize: m ? T.size.hero - 6 : T.size.hero, fontWeight: 700, lineHeight: 1.1, marginTop: 2 }}>
          {fmtShiftHours(stats.todayHours)} <span style={{ fontSize: T.size.title, fontWeight: 500, color: T.text.faint }}>h tänään</span>
        </div>
        <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, marginTop: T.space.xs }}>
          Yhteensä {fmtShiftHours(stats.totalHours)} h
          {stats.byWorker.length > 0 && ` · ${stats.byWorker.length} tekijää`}
          {running.length > 0 && ` · ${running.length} töissä nyt`}
        </div>
      </div>

      {/* 2. OMA AJASTIN. Yksi nappi, ja se kertoo suoraan mitä se tekee. */}
      {mine && onStartShift && onStopShift && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.sm }}>OMA TYÖTUNTI</div>
          {myShift ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, marginBottom: T.space.md }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.tone.good, flexShrink: 0 }} />
                <span style={{ fontFamily: T.font, fontSize: T.size.title, fontWeight: 700 }}>
                  Käynnissä {fmtElapsed(myShift, now)}
                </span>
              </div>
              <button onClick={() => onStopShift(mine.id)} disabled={busy}
                style={{ width: "100%", height: 46, borderRadius: T.radius.md, border: T.border.strong, background: "transparent", color: T.text.primary, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
                Päätä työtunti
              </button>
              {/* Pyöristys sanotaan ETUKÄTEEN eikä jälkikäteen: se on syy siihen
                  miksi 20 minuutin piipahdus ei kerrytä tuntia. */}
              <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.55 }}>
                Kirjautuu {fmtDayLabel(dayKey(myShift))} — pyöristetään lähimpään täyteen tuntiin.
              </p>
            </>
          ) : (
            <>
              <button onClick={() => onStartShift(mine.id)} disabled={busy}
                style={{ width: "100%", height: 46, borderRadius: T.radius.md, border: `1px solid ${T.tone.goodBorder}`, background: T.tone.goodBg, color: T.tone.goodSoft, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
                Aloita työtunti
              </button>
              <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.55 }}>
                Kello käy palvelimella — puhelimen voi laittaa taskuun ja sivun sulkea.
              </p>
            </>
          )}
        </div>
      )}

      {/* 3. KUKA ON TEHNYT MONTAKO. Töissä olevat ylimpänä. */}
      <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
        <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>TEKIJÄT</div>

        {stats.byWorker.length === 0 && running.length === 0 ? (
          <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.6 }}>
            Tälle työlle ei ole vielä kirjattu tunteja. Aloita työtunti yltä tai lisää tunnit käsin alta.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
            {[...stats.byWorker, ...running.filter((c) => !stats.byWorker.some((r) => r.id === c.id)).map((c) => ({ id: c.id, hours: 0, days: 0, lastAt: 0 }))]
              .sort((a, b) => {
                const ar = running.some((c) => c.id === a.id) ? 0 : 1;
                const br = running.some((c) => c.id === b.id) ? 0 : 1;
                return ar - br || b.hours - a.hours;
              })
              .map((r) => {
                const live = running.find((c) => c.id === r.id);
                return (
                  <div key={r.id} style={{ ...inset, padding: T.space.md, display: "flex", alignItems: "center", gap: T.space.md, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700 }}>{workerName(r.id)}</div>
                      {live ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 3, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, color: T.tone.goodSoft }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.tone.good }} />
                          töissä {fmtElapsed(live.activeShiftAt!, now)}
                          {onStopShift && (
                            <button onClick={() => onStopShift(r.id)} disabled={busy}
                              style={{ marginLeft: T.space.sm, padding: `1px ${T.space.sm}px`, borderRadius: T.radius.pill, border: T.border.strong, background: "transparent", color: T.text.muted, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                              päätä
                            </button>
                          )}
                        </div>
                      ) : r.days > 0 ? (
                        <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 3 }}>
                          {r.days} {r.days === 1 ? "työpäivä" : "työpäivää"}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexShrink: 0 }}>
                      {onAdjustHours && (
                        <button onClick={() => onAdjustHours(r.id, -HOUR_STEP)} disabled={busy || r.hours <= 0} title="Vähennä tunti"
                          style={{ ...adjustBtn, opacity: r.hours <= 0 ? 0.35 : 1, cursor: r.hours <= 0 ? "default" : "pointer" }}>−</button>
                      )}
                      <span style={{ minWidth: 58, textAlign: "center", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {fmtShiftHours(r.hours)} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                      </span>
                      {onAdjustHours && (
                        <button onClick={() => onAdjustHours(r.id, HOUR_STEP)} disabled={busy} title="Lisää tunti" style={adjustBtn}>+</button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {onAdjustHours && (
          <p style={{ margin: `${T.space.md}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.6 }}>
            Tekijä ei näe omia tuntejaan. Korjaus kirjautuu tälle päivälle ja näkyy päiväkirjassa.
          </p>
        )}

        {/* Tunnit tekijälle joka ei ole käyttänyt ajastinta lainkaan. */}
        {onAdjustHours && idle.length > 0 && (
          <div style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
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
                    {onStartShift && (
                      <button onClick={() => onStartShift(c.id)} disabled={busy}
                        style={{ padding: `5px ${T.space.md}px`, borderRadius: T.radius.pill, border: T.border.strong, background: "transparent", color: T.text.muted, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                        aloita
                      </button>
                    )}
                    <button onClick={() => onAdjustHours(c.id, HOUR_STEP)} disabled={busy} style={adjustBtn}>+</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. PÄIVÄKIRJA. Milloin tunnit on tehty — sama lista josta virheen
          löytää ja jolta sen voi poistaa. Suljettuna oletuksena, koska päivän
          luku on jo ylhäällä ja tämä on se johon palataan vasta kysyttäessä. */}
      {stats.byDay.length > 0 && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <button onClick={() => setDiaryOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: T.space.sm, width: "100%", padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
            <span aria-hidden style={{ color: T.text.muted, fontSize: T.size.xs }}>{diaryOpen ? "▾" : "▸"}</span>
            <span style={{ ...mono, color: T.text.faint }}>
              PÄIVÄKIRJA · {stats.byDay.length} {stats.byDay.length === 1 ? "PÄIVÄ" : "PÄIVÄÄ"}
            </span>
          </button>

          {diaryOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, marginTop: T.space.md }}>
              {stats.byDay.map((d) => (
                <div key={d.day} style={{ ...inset, padding: T.space.md }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                    <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, textTransform: "capitalize" }}>
                      {fmtDayLabel(d.day)}
                    </span>
                    {d.day === today && (
                      <span style={{ fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700, color: T.tone.goodSoft }}>tänään</span>
                    )}
                    <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtShiftHours(d.hours)} h
                    </span>
                  </div>
                  <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginTop: 4, lineHeight: 1.6 }}>
                    {d.workers.map((w) => `${workerName(w.id)} ${fmtShiftHours(w.hours)} h`).join(" · ")}
                  </div>
                  {onRemoveShift && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: T.space.sm }}>
                      {(shifts ?? []).filter((s) => s.day === d.day).sort((a, b) => b.at - a.at).map((s) => (
                        <button key={s.id} onClick={() => onRemoveShift(s.id)} disabled={busy}
                          title="Poista tämä kirjaus"
                          style={{ padding: `3px ${T.space.sm}px`, borderRadius: T.radius.pill, border: T.border.subtle, background: "transparent", color: T.text.faint, fontFamily: T.font, fontSize: T.size.xs, cursor: "pointer" }}>
                          {workerName(s.worker)} {s.hours > 0 ? "+" : "−"}{fmtShiftHours(Math.abs(s.hours))} h ✕
                        </button>
                      ))}
                    </div>
                  )}
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
