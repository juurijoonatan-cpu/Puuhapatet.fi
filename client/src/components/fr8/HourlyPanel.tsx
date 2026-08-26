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
  computeShiftStats, dayKey, fmtDayLabel, fmtShiftHours, roundWorkHours, shiftHoursOf,
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
  /** Käsin lisäys/vähennys tälle päivälle. Puuttuessaan paneeli on
   *  lukunäkymä (ei perustaja). */
  onAdjustHours?: (workerId: string, delta: number) => void;
  /** Käsin kirjaus kenelle tahansa ja MILLE PÄIVÄLLE TAHANSA. */
  onAddHours?: (workerId: string, hours: number, day: string) => void;
  /** Kaikki kenelle tunteja voi kirjata — keikan tekijät ja johtajat. Laajempi
   *  kuin `crew`, koska kirjaaminen ei vaadi keikan tekijälistalla oloa. */
  people?: { id: string; name: string }[];
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

/**
 * Edellinen kalenteripäivä.
 *
 * Keskipäivän kautta eikä "miinus 24 tuntia": kellonsiirtoyönä vuorokausi on
 * 23 tai 25 tuntia, ja suora vähennys osuisi silloin väärään päivään.
 */
function prevDayKey(ms: number): string {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/** "maanantaina 25.8." — otsikon päivä, ilman vuotta (se on tänään). */
function todayLabel(now: number): string {
  return new Date(now).toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "numeric" });
}

export default function HourlyPanel({
  shifts, crew, workerName, me, onStartShift, onStopShift, onAdjustHours, onAddHours, onRemoveShift, busy, people,
}: Props) {
  const m = useIsMobile();
  const [now, setNow] = useState(() => Date.now());
  const [diaryOpen, setDiaryOpen] = useState(false);

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

  /**
   * OMAT TUNNIT — oma kello ja oma luku, molemmat aina käytettävissä.
   *
   * Ensimmäinen versio näytti tämän kortin vain jos olin keikan tekijälistalla.
   * Se oli väärä ehto: johtaja on keikalla myös silloin kun häntä ei ole
   * listaan lisätty, ja silloin hän ei päässyt kirjaamaan omia tuntejaan
   * lainkaan — nappi vain puuttui, eikä mikään kertonut miksi.
   *
   * Käynnissä oleva vuoro talletetaan yhä tekijän omaan crew-riviin (sama
   * tieto jonka tekijän oma sovellus näkee, ei toista rinnakkaista totuutta),
   * mutta rivin luo nyt palvelin silloin kun johtaja käynnistää oman kellonsa.
   */
  const myShift = (me ? crew.find((c) => c.id === me)?.activeShiftAt : undefined) ?? null;
  const canTimeMyself = !!(me && onStartShift && onStopShift);
  const myHours = me ? shiftHoursOf(shifts, me) : 0;
  /** Oma työaika tälle päivälle — se luku jota katsotaan kesken päivän. */
  const myToday = me
    ? Math.max(0, (stats.byDay.find((d) => d.day === today)?.workers.find((w) => w.id === me)?.hours ?? 0))
    : 0;

  /**
   * Rivit: tunteja tehneet, juuri nyt töissä olevat, ja MINÄ aina kun saan
   * korjata tunteja. Oma nollarivi on tarkoituksellinen poikkeus sääntöön
   * "nollarivi ei ole tieto": ilman sitä ensimmäistä omaa tuntia ei olisi
   * mistä napauttaa.
   */
  const rows = useMemo(() => {
    const byId = new Map(stats.byWorker.map((r) => [r.id, r]));
    for (const c of running) if (!byId.has(c.id)) byId.set(c.id, { id: c.id, hours: 0, days: 0, lastAt: 0 });
    if (me && onAdjustHours && !byId.has(me)) byId.set(me, { id: me, hours: 0, days: 0, lastAt: 0 });
    return Array.from(byId.values()).sort((a, b) => {
      const ar = running.some((c) => c.id === a.id) ? 0 : 1;
      const br = running.some((c) => c.id === b.id) ? 0 : 1;
      return ar - br || b.hours - a.hours;
    });
  }, [stats.byWorker, running, me, onAdjustHours]);

  /**
   * KÄSIN KIRJAUKSEN VALITTAVAT. Keikan tekijät JA johtajat — kirjaaminen ei
   * vaadi keikan tekijälistalla oloa, koska vuororivi on vain tunnus, tunnit
   * ja päivä. Minä itse olen aina listalla, myös uudella keikalla.
   */
  const pickable = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const p of people ?? []) if (p.id) seen.set(p.id, { id: p.id, name: p.name || p.id });
    for (const c of crew) if (!seen.has(c.id)) seen.set(c.id, { id: c.id, name: workerName(c.id) });
    if (me && !seen.has(me)) seen.set(me, { id: me, name: workerName(me) });
    return Array.from(seen.values()).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name, "fi")));
  }, [people, crew, me, workerName]);

  const yesterday = prevDayKey(now);
  const [who, setWho] = useState(() => me ?? "");
  const [day, setDay] = useState(today);
  const [hrs, setHrs] = useState(1);
  // Ensimmäisellä latauksella `me` voi olla vielä tyhjä; älä jätä valintaa
  // tyhjäksi, koska silloin "Lisää" ei tekisi mitään eikä kertoisi miksi.
  useEffect(() => {
    if (!who && pickable.length > 0) setWho(me ?? pickable[0].id);
  }, [who, pickable, me]);

  const fieldStyle: React.CSSProperties = {
    height: 42, padding: `0 ${T.space.md}px`, borderRadius: T.radius.md,
    border: T.border.strong, background: T.surface.sunken, color: T.text.primary,
    fontFamily: T.font, fontSize: T.size.body, boxSizing: "border-box", width: "100%",
  };
  const chipStyle: React.CSSProperties = {
    height: 42, padding: `0 ${T.space.lg}px`, borderRadius: T.radius.md,
    border: T.border.strong, background: "transparent", color: T.text.secondary,
    fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, cursor: "pointer",
  };
  const chipOn: React.CSSProperties = {
    background: T.tone.goodBg, borderColor: T.tone.goodBorder, color: T.tone.goodSoft,
  };

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

      {/* 2. OMAT TUNNIT: paljonko minulla on, miten aloitan, ja miten lisään
          käsin. Sama kortti, koska ne ovat sama kysymys minun kannaltani. */}
      {me && (onAdjustHours || canTimeMyself) && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <div style={{ display: "flex", alignItems: "center", gap: T.space.md, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ ...mono, color: T.text.faint }}>OMAT TUNTINI</div>
              <div style={{ fontFamily: T.font, fontSize: T.size.display, fontWeight: 700, lineHeight: 1.15, marginTop: 2 }}>
                {fmtShiftHours(myHours)} <span style={{ fontSize: T.size.body, fontWeight: 500, color: T.text.faint }}>h</span>
              </div>
              <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 2 }}>
                {myToday > 0 ? `tänään ${fmtShiftHours(myToday)} h` : "tänään ei vielä tunteja"}
              </div>
            </div>
            {/* Käsin lisäys on tässä eikä pelkästään tekijälistalla: omien
                tuntien kirjaaminen on se mitä tällä kortilla tullaan tekemään. */}
            {onAdjustHours && (
              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexShrink: 0 }}>
                <button onClick={() => onAdjustHours(me, -HOUR_STEP)} disabled={busy || myHours <= 0}
                  title="Vähennä tunti"
                  style={{ ...adjustBtn, opacity: myHours <= 0 ? 0.35 : 1, cursor: myHours <= 0 ? "default" : "pointer" }}>−</button>
                <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, minWidth: 46, textAlign: "center" }}>
                  lisää<br />käsin
                </span>
                <button onClick={() => onAdjustHours(me, HOUR_STEP)} disabled={busy} title="Lisää tunti" style={adjustBtn}>+</button>
              </div>
            )}
          </div>

          {canTimeMyself && (
            <div style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
              {myShift ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, marginBottom: T.space.md }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.tone.good, flexShrink: 0 }} />
                    <span style={{ fontFamily: T.font, fontSize: T.size.title, fontWeight: 700 }}>
                      Käynnissä {fmtElapsed(myShift, now)}
                    </span>
                  </div>
                  <button onClick={() => onStopShift!(me)} disabled={busy}
                    style={{ width: "100%", height: 46, borderRadius: T.radius.md, border: T.border.strong, background: "transparent", color: T.text.primary, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
                    Päätä työtunti
                  </button>
                  {/* Pyöristys sanotaan ETUKÄTEEN eikä jälkikäteen: se on syy
                      siihen miksi 20 minuutin piipahdus ei kerrytä tuntia. */}
                  <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.55 }}>
                    Kirjautuu {fmtDayLabel(dayKey(myShift))} — pyöristetään lähimpään täyteen tuntiin.
                  </p>
                </>
              ) : (
                <>
                  <button onClick={() => onStartShift!(me)} disabled={busy}
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

        </div>
      )}

      {/* 3. KUKA ON TEHNYT MONTAKO. Töissä olevat ylimpänä. */}
      <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
        <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>TEKIJÄT</div>

        {rows.length === 0 ? (
          <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.6 }}>
            Tälle työlle ei ole vielä kirjattu tunteja.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
            {rows.map((r) => {
                const live = running.find((c) => c.id === r.id);
                return (
                  <div key={r.id} style={{ ...inset, padding: T.space.md, display: "flex", alignItems: "center", gap: T.space.md, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                        <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700 }}>{workerName(r.id)}</span>
                        {r.id === me && (
                          <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>sinä</span>
                        )}
                      </div>
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

        {/* KÄSIN KIRJAUS. Kenelle, minä päivänä, montako tuntia — kolme
            valintaa yhdellä rivillä.

            EILINEN ON YHTÄ TÄRKEÄ KUIN TÄNÄÄN. Ajastin unohtuu, työ tehdään
            ennen kuin linkki otetaan käyttöön, ja päivä kirjataan usein vasta
            seuraavana aamuna. Kirjaus ilman päivänvalintaa olisi siis usein
            väärällä päivällä — ja päivä on koko tämän kirjanpidon perusta. */}
        {onAddHours && pickable.length > 0 && (
          <div style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
            <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>LISÄÄ TUNTEJA KÄSIN</div>

            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
              <select value={who} onChange={(e) => setWho(e.target.value)} style={fieldStyle}>
                {pickable.map((p) => (
                  <option key={p.id} value={p.id} style={{ background: "#141416" }}>
                    {p.id === me ? `${p.name} (sinä)` : p.name}
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                {[{ k: today, label: "Tänään" }, { k: yesterday, label: "Eilen" }].map((d) => (
                  <button key={d.k} onClick={() => setDay(d.k)}
                    style={{ ...chipStyle, ...(day === d.k ? chipOn : null) }}>
                    {d.label}
                  </button>
                ))}
                {/* Muu päivä. Tulevaisuutta ei voi kirjata: tekemätöntä työtä
                    ei ole olemassa, ja väärä painallus jäisi näkymättömäksi
                    riviksi tulevalle viikolle. */}
                <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)}
                  style={{ ...fieldStyle, flex: 1, minWidth: 130, colorScheme: "dark" }} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
                <button onClick={() => setHrs((h) => Math.max(1, h - 1))} disabled={hrs <= 1} style={{ ...adjustBtn, opacity: hrs <= 1 ? 0.35 : 1 }}>−</button>
                <span style={{ minWidth: 54, textAlign: "center", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700 }}>
                  {hrs} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                </span>
                <button onClick={() => setHrs((h) => Math.min(24, h + 1))} disabled={hrs >= 24} style={adjustBtn}>+</button>
                <button
                  onClick={() => { onAddHours(who, hrs, day); setHrs(1); }}
                  disabled={busy || !who}
                  style={{ flex: 1, height: 42, borderRadius: T.radius.md, border: `1px solid ${T.tone.goodBorder}`, background: T.tone.goodBg, color: T.tone.goodSoft, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
                  Lisää {hrs} h {day === today ? "tälle päivälle" : fmtDayLabel(day)}
                </button>
              </div>
            </div>
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
