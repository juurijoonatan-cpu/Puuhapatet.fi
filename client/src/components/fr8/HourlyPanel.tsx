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
  computeShiftStats, dayKey, fmtDayLabel, fmtShiftHours, shiftHoursOf,
  shiftDay, weekOf, weekdayLetter, dayOfMonth, monthLabel,
  type ProjShift,
} from "@shared/project";
import type { CrewMember } from "@shared/crew";
import type { HourlyMoney } from "@shared/hourly-money";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, card, inset, mono, eur } from "./tokens";

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
  /**
   * TUNTITILAN RAHA — laskettuna kerran `computeHourlyMoney`illa, ei täällä.
   *
   * Puuttuessaan rahakorttia ei näytetä lainkaan: tuntipalkat, kate ja sen
   * jako ovat perustajien tietoa, joten kutsuja antaa tämän vain heille.
   * Paneeli ei itse päättele kuka saa nähdä mitä — pääsy on yhdessä paikassa.
   */
  money?: HourlyMoney | null;
  /**
   * Tämän keikan tuntihinnat. Puuttuessaan hinnat ovat lukemia eikä niitä voi
   * muuttaa — sama porras kuin rahakortilla: vain perustaja saa koskea.
   */
  onSetRates?: (hourRateCents: number, workerHourCents: number) => void;
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

export default function HourlyPanel({
  shifts, crew, workerName, me, onStartShift, onStopShift, onAdjustHours, onAddHours, onRemoveShift, money, onSetRates, busy, people,
}: Props) {
  const m = useIsMobile();
  const [now, setNow] = useState(() => Date.now());
  /**
   * PÄIVÄKIRJA ON NYT SULJETTU OLETUKSENA — ja vasta nyt se saa olla.
   *
   * Se avattiin aikanaan siksi, että kirjaus näytti siltä ettei se tehnyt
   * mitään: rivi syntyi, mutta ainoa paikka jossa sen näki oli taitteen
   * takana. Kalenteri hoitaa sen tehtävän paremmin — kirjaus näkyy heti sen
   * päivän ruudussa johon se meni. Tämä lista jää koko historian selaamiseen,
   * eli siihen mitä tehdään harvoin ja tarkoituksella.
   */
  const [diaryOpen, setDiaryOpen] = useState(false);
  /**
   * HINTOJEN MUOKKAUS on oma taitteensa eikä aina auki oleva lomake.
   *
   * Hinta on keikan sopimusasia joka asetetaan kerran; jatkuvasti näkyvät
   * kentät houkuttelisivat naputtelemaan sitä kesken laskutuksen. Kentät ovat
   * tekstiä eivätkä lukuja, koska "26,5" kirjoitetaan pilkulla ja puolivalmis
   * "2" ei saa hetkeksi muuttua keikan hinnaksi — arvo luetaan vasta kun
   * muokkaus vahvistetaan.
   */
  const [ratesOpen, setRatesOpen] = useState(false);
  const [rateDraft, setRateDraft] = useState("");
  const [wageDraft, setWageDraft] = useState("");

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
  /** Saako tunteja ylipäätään säätää — kumpi tahansa kirjausreitti riittää. */
  const canEditRows = !!(onAddHours || onAdjustHours);
  const rows = useMemo(() => {
    const byId = new Map(stats.byWorker.map((r) => [r.id, r]));
    for (const c of running) if (!byId.has(c.id)) byId.set(c.id, { id: c.id, hours: 0, days: 0, lastAt: 0 });
    if (me && canEditRows && !byId.has(me)) byId.set(me, { id: me, hours: 0, days: 0, lastAt: 0 });
    return Array.from(byId.values()).sort((a, b) => {
      const ar = running.some((c) => c.id === a.id) ? 0 : 1;
      const br = running.some((c) => c.id === b.id) ? 0 : 1;
      return ar - br || b.hours - a.hours;
    });
  }, [stats.byWorker, running, me, canEditRows]);

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
  /**
   * VALITTU PÄIVÄ — YKSI VALINTA KOKO NÄKYMÄLLE.
   *
   * Ennen näitä oli kaksi: kalenteria ei ollut lainkaan, ja kirjauslomakkeella
   * oli oma päivävalitsimensa. Katsottu päivä ja kirjattu päivä olivat siis eri
   * asioita, eikä mikään kertonut kumpaa mikin luku koski. Nyt sama `day` ohjaa
   * kalenteria, päivän lukuja ja kirjausta — mitä katsot, sinne kirjaat.
   */
  const [day, setDay] = useState(today);
  /**
   * TEKIJÄSUODATIN. `null` = kaikki. Tämä on se mitä pomo kysyy kalenterilta:
   * ei "paljonko tiistaina tehtiin" vaan "paljonko Petrus teki tiistaina".
   * Suodatin muuttaa kalenterin luvut, ei vain alla olevaa listaa — muuten
   * ruudut kertoisivat eri asiaa kuin otsikko niiden alla.
   */
  const [only, setOnly] = useState<string | null>(null);
  const [hrs, setHrs] = useState(1);

  /**
   * VALITUN HENKILÖN LUVUT NÄKYVÄT SIINÄ MISSÄ VALINTA TEHDÄÄN.
   *
   * Ilman näitä lomake oli sokea: kun tekijää vaihtoi, mikään ruudulla ei
   * kertonut paljonko hänellä on tunteja — ja kun tunnin lisäsi, muuttuva luku
   * oli ylhäällä kortin ulkopuolella, usein ruudun ulkopuolella. Kirjaus näytti
   * siltä ettei se tehnyt mitään, vaikka rivi syntyi joka kerta.
   */
  const whoTotal = who ? shiftHoursOf(shifts, who) : 0;
  const whoOnDay = who
    ? (stats.byDay.find((d) => d.day === day)?.workers.find((w) => w.id === who)?.hours ?? 0)
    : 0;
  // Ensimmäisellä latauksella `me` voi olla vielä tyhjä; älä jätä valintaa
  // tyhjäksi, koska silloin "Lisää" ei tekisi mitään eikä kertoisi miksi.
  useEffect(() => {
    if (!who && pickable.length > 0) setWho(me ?? pickable[0].id);
  }, [who, pickable, me]);

  /**
   * KALENTERIN LUVUT. `byDay` tulee `computeShiftStats`ilta, eli samasta
   * laskennasta kuin kaikki muukin tällä sivulla — kalenteri ei laske tunteja
   * uudelleen omalla tavallaan.
   */
  const dayIndex = useMemo(() => {
    const map = new Map<string, { hours: number; workers: { id: string; hours: number }[] }>();
    for (const d of stats.byDay) map.set(d.day, { hours: d.hours, workers: d.workers });
    return map;
  }, [stats.byDay]);

  /** Yhden tekijän tunnit yhtenä päivänä — säädön rajaksi, ettei − ole no-op. */
  const workerHoursOn = (id: string, d: string): number =>
    dayIndex.get(d)?.workers.find((w) => w.id === id)?.hours ?? 0;

  /** Päivän tunnit — suodattimen läpi, jotta ruutu ja otsikko kertovat saman. */
  const hoursOn = (d: string): number => {
    const row = dayIndex.get(d);
    if (!row) return 0;
    if (!only) return row.hours;
    return row.workers.find((w) => w.id === only)?.hours ?? 0;
  };

  /** Omat tunnit VALITULLE päivälle — oman säädön raja ja kortin alarivi. */
  const myOnSelected = me ? workerHoursOn(me, day) : 0;

  const week = useMemo(() => weekOf(day), [day]);
  /** Tulevaa viikkoa ei selata: tekemätöntä työtä ei ole olemassa. */
  const canGoForward = !week.includes(today) && week[6] < today;
  const selRow = dayIndex.get(day);
  const selWorkers = (selRow?.workers ?? []).filter((w) => !only || w.id === only);
  const selHours = hoursOn(day);
  /** Viikon summa — sama suodatin, koska se on vastaus samaan kysymykseen. */
  const weekHours = Math.round(week.reduce((n, d) => n + hoursOn(d), 0) * 100) / 100;

  /**
   * SUODATTIMEN VALITTAVAT: ne joilla on tunteja. Nollarivi suodattimessa
   * tarjoaisi näkymän jossa ei ole mitään nähtävää.
   */
  const filterable = stats.byWorker;

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

  /** "26,00" — kenttään sopiva muoto, ilman euromerkkiä. */
  const centsToField = (c: number) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const openRates = () => {
    if (!money) return;
    setRateDraft(centsToField(money.hourRateCents));
    setWageDraft(centsToField(money.workerHourCents));
    setRatesOpen(true);
  };
  /**
   * Tyhjä tai kelvoton kenttä EI tallenna nollaa — se pyyhkisi keikan hinnan
   * hiljaa. Kelvoton arvo palauttaa nykyisen hinnan, eli muokkaus ei tehnyt
   * mitään, ja se on oikea lopputulos: hinta on liian iso asia arvattavaksi.
   */
  const parseRate = (text: string, fallbackCents: number): number => {
    const n = parseFloat(text.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return fallbackCents;
    return Math.round(n * 100);
  };
  const saveRates = () => {
    if (!money || !onSetRates) return;
    onSetRates(parseRate(rateDraft, money.hourRateCents), parseRate(wageDraft, money.workerHourCents));
    setRatesOpen(false);
  };

  /**
   * KAIKKI KÄSIN SÄÄTÖ OSUU VALITTUUN PÄIVÄÄN.
   *
   * `onAdjustHours` kirjaa aina TÄLLE päivälle. Kun kalenteri tuli, se
   * tarkoitti ansaa: ruudulla auki viime tiistai, ja +/− kasvatti tämän
   * päivän lukua — korjaus meni eri päivälle kuin se luku jota korjattiin,
   * eikä mikään kertonut sitä. `onAddHours` osaa minkä tahansa päivän (myös
   * miinuksen, joka rajautuu sen päivän saldoon), joten se on ensisijainen ja
   * vanha jää vain varalle jos kutsuja ei sitä anna.
   */
  const bump = (id: string, delta: number) => {
    if (onAddHours) onAddHours(id, delta, day);
    else onAdjustHours?.(id, delta);
  };
  const canEdit = !!(onAddHours || onAdjustHours);
  /** Päivä napin selitteeseen, jotta säätö ei ole koskaan arvailua. */
  const bumpTitle = (dir: string) => `${dir} puoli tuntia — ${fmtDayLabel(day)}${day === today ? " (tänään)" : ""}`;

  const adjustBtn: React.CSSProperties = {
    width: 32, height: 32, flexShrink: 0, borderRadius: T.radius.sm,
    border: T.border.strong, background: "transparent", color: T.text.secondary,
    fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: "pointer", lineHeight: 1,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: m ? T.space.md : T.space.lg }}>
      {/* 1. KALENTERI — MIKÄ PÄIVÄ, PALJONKO SILLE ON TEHTY, KENEN TOIMESTA.

          Tämä oli näkymän suurin puute. Tunnit kirjautuivat oikein, mutta
          niiden SELAAMISEEN ei ollut mitään: yksi luku tälle päivälle ja
          taitteen takana litteä lista kaikista päivistä. Kysymykseen
          "paljonko Petrus teki viime tiistaina" ei ollut vastausta jota olisi
          voinut osoittaa sormella.

          Viikkonauha vastaa siihen yhdellä silmäyksellä, ja koska sama `day`
          ohjaa myös kirjausta, katsottu päivä ja kirjattu päivä eivät voi
          erota. Tekijäsuodatin muuttaa nauhan luvut eikä vain alla olevaa
          listaa — muuten ruudut kertoisivat eri asiaa kuin otsikko. */}
      <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, marginBottom: T.space.md }}>
          <span style={{ ...mono, color: T.text.faint, textTransform: "uppercase" }}>{monthLabel(week)}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setDay(shiftDay(day, -7))} title="Edellinen viikko" aria-label="Edellinen viikko"
              style={{ ...adjustBtn, width: 30, height: 30 }}>‹</button>
            <button onClick={() => setDay(today)} disabled={day === today} title="Tähän päivään"
              style={{ height: 30, padding: `0 ${T.space.md}px`, borderRadius: T.radius.sm, border: T.border.strong,
                background: "transparent", color: day === today ? T.text.faint : T.text.secondary,
                fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: day === today ? "default" : "pointer" }}>
              Tänään
            </button>
            <button onClick={() => canGoForward && setDay(shiftDay(day, 7))} disabled={!canGoForward}
              title="Seuraava viikko" aria-label="Seuraava viikko"
              style={{ ...adjustBtn, width: 30, height: 30, opacity: canGoForward ? 1 : 0.3, cursor: canGoForward ? "pointer" : "default" }}>›</button>
          </div>
        </div>

        {/* VIIKKONAUHA. Seitsemän ruutua, ja jokainen kertoo heti onko sille
            päivälle kirjattu jotain — tyhjä ruutu on yhtä tärkeä tieto kuin
            täysi. Tulevat päivät ovat himmeitä eivätkä valittavissa. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: m ? 4 : 6 }}>
          {week.map((d) => {
            const h = hoursOn(d);
            const isSel = d === day;
            const isToday = d === today;
            const future = d > today;
            return (
              <button
                key={d}
                onClick={() => !future && setDay(d)}
                disabled={future}
                aria-current={isSel ? "date" : undefined}
                title={fmtDayLabel(d)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  padding: `${T.space.sm}px 0`, borderRadius: T.radius.md,
                  border: isSel ? `1px solid ${T.tone.goodBorder}` : isToday ? T.border.strong : "1px solid transparent",
                  background: isSel ? T.tone.goodBg : h > 0 ? T.surface.sunken : "transparent",
                  color: future ? T.text.faint : isSel ? T.tone.goodSoft : T.text.primary,
                  opacity: future ? 0.35 : 1,
                  cursor: future ? "default" : "pointer", fontFamily: T.font, minWidth: 0,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: isSel ? T.tone.goodSoft : T.text.faint }}>
                  {weekdayLetter(d)}
                </span>
                <span style={{ fontSize: m ? T.size.body : T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                  {dayOfMonth(d)}
                </span>
                {/* Tunnit ruudussa, ei pelkkä piste: "montako" on se kysymys
                    jonka takia kalenteria katsotaan. */}
                <span style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: h > 0 ? (isSel ? T.tone.goodSoft : T.text.muted) : "transparent" }}>
                  {h > 0 ? `${fmtShiftHours(h)} h` : "·"}
                </span>
              </button>
            );
          })}
        </div>

        {/* VALITUN PÄIVÄN LUKU. Iso, koska se on tämän kortin vastaus. */}
        <div style={{ marginTop: T.space.lg }}>
          <div style={{ ...mono, color: T.text.faint, textTransform: "uppercase" }}>
            {fmtDayLabel(day)}{day === today ? " · tänään" : ""}{only ? ` · ${workerName(only)}` : ""}
          </div>
          <div style={{ fontFamily: T.font, fontSize: m ? T.size.hero - 6 : T.size.hero, fontWeight: 700, lineHeight: 1.1, marginTop: 2 }}>
            {fmtShiftHours(selHours)} <span style={{ fontSize: T.size.title, fontWeight: 500, color: T.text.faint }}>h</span>
          </div>
          <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, marginTop: T.space.xs }}>
            Viikko {fmtShiftHours(weekHours)} h · yhteensä {fmtShiftHours(only ? shiftHoursOf(shifts, only) : stats.totalHours)} h
            {running.length > 0 && ` · ${running.length} töissä nyt`}
          </div>
        </div>

        {/* KENEN TUNNIT. Suodatin on tässä eikä erillisessä valikossa, koska
            se on osa samaa kysymystä kuin päivä. */}
        {filterable.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: T.space.md }}>
            {[{ id: null as string | null, name: "Kaikki" }, ...filterable.map((r) => ({ id: r.id as string | null, name: workerName(r.id) }))].map((f) => {
              const on = only === f.id;
              return (
                <button key={f.id ?? "all"} onClick={() => setOnly(f.id)}
                  style={{ height: 32, padding: `0 ${T.space.md}px`, borderRadius: T.radius.pill,
                    border: on ? `1px solid ${T.tone.goodBorder}` : T.border.subtle,
                    background: on ? T.tone.goodBg : "transparent", color: on ? T.tone.goodSoft : T.text.muted,
                    fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                  {f.name}{f.id === me ? " (sinä)" : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* PÄIVÄN TEKIJÄT — ja säätö SILLE PÄIVÄLLE jota katsotaan.
            Vanha +/− kirjasi aina tälle päivälle, myös silloin kun ruudulla
            oli auki viime tiistai: korjaus meni eri päivälle kuin se luku jota
            korjattiin, eikä mikään kertonut sitä. */}
        {selWorkers.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
            {selWorkers.map((w) => (
              <div key={w.id} style={{ ...inset, padding: `${T.space.sm}px ${T.space.md}px`, display: "flex", alignItems: "center", gap: T.space.sm }}>
                <span style={{ flex: 1, minWidth: 0, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {workerName(w.id)}{w.id === me ? " (sinä)" : ""}
                </span>
                {onAddHours && (
                  <button onClick={() => onAddHours(w.id, -HOUR_STEP, day)} disabled={busy || w.hours <= 0}
                    title={`Vähennä puoli tuntia — ${fmtDayLabel(day)}`}
                    style={{ ...adjustBtn, width: 28, height: 28, opacity: w.hours <= 0 ? 0.35 : 1 }}>−</button>
                )}
                <span style={{ minWidth: 52, textAlign: "right", fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {fmtShiftHours(w.hours)} h
                </span>
                {onAddHours && (
                  <button onClick={() => onAddHours(w.id, HOUR_STEP, day)} disabled={busy}
                    title={`Lisää puoli tuntia — ${fmtDayLabel(day)}`}
                    style={{ ...adjustBtn, width: 28, height: 28 }}>+</button>
                )}
              </div>
            ))}
            {/* Yksittäiset kirjaukset: tästä virheellisen rivin näkee ja
                poistaa ilman että koko päivää tarvitsee laskea uudelleen. */}
            {onRemoveShift && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                {(shifts ?? []).filter((s) => s.day === day && (!only || s.worker === only))
                  .sort((a, b) => b.at - a.at).map((s) => (
                  <button key={s.id} onClick={() => onRemoveShift(s.id)} disabled={busy}
                    title={s.note ? `${s.note} — poista tämä kirjaus` : "Poista tämä kirjaus"}
                    style={{ padding: `3px ${T.space.sm}px`, borderRadius: T.radius.pill,
                      border: s.note ? `1px solid ${T.tone.warnBorder}` : T.border.subtle,
                      background: s.note ? T.tone.warnBg : "transparent", color: s.note ? T.tone.warn : T.text.faint,
                      fontFamily: T.font, fontSize: T.size.xs, cursor: "pointer" }}>
                    {selWorkers.length > 1 ? `${workerName(s.worker)} ` : ""}
                    {s.hours > 0 ? "+" : "−"}{fmtShiftHours(Math.abs(s.hours))} h{s.note ? " ⚠" : ""} ✕
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p style={{ margin: `${T.space.md}px 0 0`, paddingTop: T.space.md, borderTop: T.border.divider,
            fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>
            {only ? `${workerName(only)} ei ole kirjannut tunteja tälle päivälle.` : "Tälle päivälle ei ole kirjattu tunteja."}
          </p>
        )}
      </div>

      {/* 2. OMAT TUNNIT: paljonko minulla on, miten aloitan, ja miten lisään
          käsin. Sama kortti, koska ne ovat sama kysymys minun kannaltani. */}
      {me && (canEdit || canTimeMyself) && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <div style={{ display: "flex", alignItems: "center", gap: T.space.md, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ ...mono, color: T.text.faint }}>OMAT TUNTINI</div>
              <div style={{ fontFamily: T.font, fontSize: T.size.display, fontWeight: 700, lineHeight: 1.15, marginTop: 2 }}>
                {fmtShiftHours(myHours)} <span style={{ fontSize: T.size.body, fontWeight: 500, color: T.text.faint }}>h</span>
              </div>
              {/* Alarivi kertoo VALITUN päivän, koska viereinen +/− kirjaa
                  sinne. Kiinteä "tänään" olisi väittänyt eri päivää kuin mihin
                  nappi osuu heti kun kalenterista valitsee toisen päivän. */}
              <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 2 }}>
                {day === today
                  ? (myToday > 0 ? `tänään ${fmtShiftHours(myToday)} h` : "tänään ei vielä tunteja")
                  : `${fmtDayLabel(day)} ${fmtShiftHours(myOnSelected)} h`}
              </div>
            </div>
            {/* Käsin lisäys on tässä eikä pelkästään tekijälistalla: omien
                tuntien kirjaaminen on se mitä tällä kortilla tullaan tekemään. */}
            {canEdit && (
              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexShrink: 0 }}>
                {/* Rajana VALITUN PÄIVÄN saldo, ei koko keikan: miinus rajautuu
                    palvelimella sen päivän tunteihin, joten nollapäivänä nappi
                    olisi käytettävissä mutta ei tekisi mitään — hiljainen
                    ei-mitään on pahempi kuin harmaa nappi. */}
                <button onClick={() => bump(me, -HOUR_STEP)} disabled={busy || myOnSelected <= 0} title={bumpTitle("Vähennä")}
                  style={{ ...adjustBtn, opacity: myOnSelected <= 0 ? 0.35 : 1, cursor: myOnSelected <= 0 ? "default" : "pointer" }}>−</button>
                <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, minWidth: 46, textAlign: "center" }}>
                  lisää<br />käsin
                </span>
                <button onClick={() => bump(me, HOUR_STEP)} disabled={busy} title={bumpTitle("Lisää")} style={adjustBtn}>+</button>
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

      {/* 2.5 RAHA. Yksi kortti johon mahtuu koko kysymys: mitä asiakas maksaa,
          mitä siitä menee tekijöille ja mitä jää meille — ja miten se jää
          jaetaan. Luvut tulevat `computeHourlyMoney`ilta samasta laskennasta
          jolla lasku muodostetaan, joten tässä näkyvä summa ON laskun summa.

          PERUSTAJAN TUNNISTA EI OTETA KATETTA. Se on oma työ ja tuottaa koko
          tuntihinnan tekijälleen; kate syntyy vain työntekijätunneista. Siksi
          "oma työ" ja "kate" ovat kortilla erillisinä riveinä eivätkä yhtenä
          summana — muuten kukaan ei näkisi kummasta raha tuli. */}
      {money && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <div style={{ ...mono, color: T.text.faint }}>ASIAKKAALTA</div>
          <div style={{ fontFamily: T.font, fontSize: m ? T.size.hero - 6 : T.size.hero, fontWeight: 700, lineHeight: 1.1, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {eur(money.customerTotalCents)}
          </div>
          <div style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, marginTop: T.space.xs }}>
            {fmtShiftHours(money.totalHours)} h × {eur(money.hourRateCents)}/h
            {money.customerCostCents > 0 && ` · tarvikkeet ${eur(money.customerCostCents)}`}
            {money.subcontractCostCents > 0 && ` · alihankinta ${eur(money.subcontractCostCents + money.subcontractMarginCents)}`}
            {money.windowsCents > 0 && ` · ikkunat ${eur(money.windowsCents)}`}
          </div>

          {/* Väärinpäin kirjatut hinnat sanotaan ääneen. Ilman tätä kate vain
              katoaisi nollaan eikä mikään kertoisi miksi. */}
          {money.rateInverted && (
            <p style={{ margin: `${T.space.md}px 0 0`, padding: T.space.md, borderRadius: T.radius.md, border: `1px solid ${T.tone.warnBorder}`, background: T.tone.warnBg, fontFamily: T.font, fontSize: T.size.xs, color: T.tone.warn, lineHeight: 1.55 }}>
              Tuntipalkka ({eur(money.workerHourCents)}/h) on suurempi kuin asiakkaan tuntihinta ({eur(money.hourRateCents)}/h).
              Kate on nolla — tarkista hinnat keikan asetuksista.
            </p>
          )}

          {/* TÄMÄN KEIKAN HINNAT. Oletukset ovat 26,00 € ja 15,00 €, mutta ne
              ovat oletuksia eivätkä lakia: hinta sovitaan keikkakohtaisesti.
              Muutos koskee vain tätä keikkaa ja vaikuttaa taannehtivasti jo
              kirjattuihin tunteihin — se sanotaan ääneen, koska kesken keikan
              tehty hinnanmuutos muuttaa myös eilisen palkan. */}
          {onSetRates && (
            <div style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
              {!ratesOpen ? (
                <button onClick={openRates}
                  style={{ display: "flex", alignItems: "center", gap: T.space.sm, width: "100%", padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ ...mono, color: T.text.faint }}>HINNAT</span>
                  <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, fontVariantNumeric: "tabular-nums" }}>
                    asiakas {eur(money.hourRateCents)}/h · tekijä {eur(money.workerHourCents)}/h
                  </span>
                  <span aria-hidden style={{ color: T.text.faint, fontSize: T.size.xs }}>muuta</span>
                </button>
              ) : (
                <div>
                  <div style={{ ...mono, color: T.text.faint, marginBottom: T.space.md }}>TÄMÄN KEIKAN HINNAT</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.space.sm }}>
                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginBottom: 4 }}>Asiakkaalta €/h</span>
                      <input value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRates()}
                        inputMode="decimal" style={{ ...fieldStyle, textAlign: "right" }} />
                    </label>
                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginBottom: 4 }}>Tekijälle €/h</span>
                      <input value={wageDraft} onChange={(e) => setWageDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveRates()}
                        inputMode="decimal" style={{ ...fieldStyle, textAlign: "right" }} />
                    </label>
                  </div>
                  <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.55 }}>
                    Koskee vain tätä keikkaa ja myös jo kirjattuja tunteja. Pomon tunnista ei oteta katetta:
                    hän saa koko asiakashinnan.
                  </p>
                  <div style={{ display: "flex", gap: T.space.sm, marginTop: T.space.md }}>
                    <button onClick={() => setRatesOpen(false)} disabled={busy}
                      style={{ ...chipStyle, flex: 1 }}>Peruuta</button>
                    <button onClick={saveRates} disabled={busy}
                      style={{ ...chipStyle, ...chipOn, flex: 1, opacity: busy ? 0.5 : 1 }}>Tallenna hinnat</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, marginTop: T.space.md }}>
            {/* MENEE TEKIJÖILLE. Tämä ei ole meidän rahaamme missään vaiheessa,
                joten se on omana rivinään eikä vähennyksenä katteesta. */}
            {money.workerCostCents > 0 && (
              <div style={{ ...inset, padding: T.space.md }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>Tekijöille tuntipalkkaa</span>
                  <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {eur(money.workerCostCents)}
                  </span>
                </div>
                <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 3 }}>
                  {fmtShiftHours(money.workerHours)} h × {eur(money.workerHourCents)}/h
                </div>
              </div>
            )}

            {/* MEILLE. Oma työ ja kate erikseen, sitten kummallekin nimelle
                oma rivi — "meidän tuottomme" ilman nimiä ei kerro kenelle. */}
            <div style={{ ...inset, padding: T.space.md }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>Meille</span>
                <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, color: T.tone.goodSoft, fontVariantNumeric: "tabular-nums" }}>
                  {eur(money.founderTotalCents)}
                </span>
              </div>
              <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 3, lineHeight: 1.6 }}>
                {money.founderWageCents > 0 && `oma työ ${fmtShiftHours(money.founderHours)} h = ${eur(money.founderWageCents)}`}
                {money.founderWageCents > 0 && money.marginCents > 0 && " · "}
                {money.marginCents > 0 && `kate työntekijätunneista ${eur(money.marginCents)}`}
                {money.subcontractMarginCents > 0 && ` · sis. alihankinnan kate ${eur(money.subcontractMarginCents)}`}
                {money.founderTotalCents === 0 && "ei vielä kertymää"}
              </div>

              {money.byFounder.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
                  {money.byFounder.map((f) => (
                    <div key={f.id} style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                      <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600 }}>
                        {workerName(f.id)}{f.id === me ? " (sinä)" : ""}
                      </span>
                      <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>
                        {f.wageCents > 0 ? `oma työ ${eur(f.wageCents)}` : ""}
                        {f.wageCents > 0 && f.marginCents > 0 ? " + " : ""}
                        {f.marginCents > 0 ? `kate ${eur(f.marginCents)}` : ""}
                      </span>
                      <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {eur(f.totalCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* IKKUNATYÖ. Oma veloituksensa tuntien rinnalla: ikkunat on pesty
                ikkunahinnalla eikä niistä ole kirjattu tunteja, joten sama työ
                ei ole laskulla kahdesti. Tässä se näkyy nimi kerrallaan, koska
                ikkuna kuuluu sille joka sen pesi — ja perustajan ikkuna on
                kokonaan hänen, kuten hänen tuntinsakin. */}
            {money.windows && money.windows.washedTotal > 0 && (
              <div style={{ ...inset, padding: T.space.md }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>Ikkunatyö</span>
                  <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {eur(money.windows.uninvoicedCents)}
                  </span>
                </div>
                <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 3, lineHeight: 1.6 }}>
                  {money.windows.uninvoicedWindows > 0
                    ? `${money.windows.uninvoicedWindows} ikkunaa laskuttamatta × ${eur(money.windows.pricePerWindowCents)}`
                    : "kaikki pestyt ikkunat on laskutettu"}
                  {Math.round(money.windows.washedTotal) > money.windows.uninvoicedWindows
                    && ` · pesty yhteensä ${Math.round(money.windows.washedTotal)}`}
                </div>
                {/* Kuka on pessyt ja mitä siitä kuuluu. Luvut ovat koko keikan
                    ajalta, eivät vain tämän laskun osuudelta — se on se mitä
                    kukin on ansainnut, ja se on eri kysymys kuin mitä juuri nyt
                    laskutetaan. Sanotaan se, ettei lukuja lueta väärin. */}
                {money.windows.byWasher.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: T.space.md, paddingTop: T.space.md, borderTop: T.border.divider }}>
                    {money.windows.byWasher.map((r) => (
                      <div key={r.id} style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                        <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600 }}>
                          {workerName(r.id)}{r.id === me ? " (sinä)" : ""}
                        </span>
                        <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>
                          {fmtShiftHours(r.windows)} ikkunaa × {eur(r.perWindowCents)}
                          {r.isFounder ? " (oma työ, koko hinta)" : ""}
                        </span>
                        <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {eur(r.earnedCents)}
                        </span>
                      </div>
                    ))}
                    <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 2, lineHeight: 1.55 }}>
                      Ansio koko keikan ajalta. Laskulle menee vain laskuttamaton osuus.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAKAISIN MAKSAJALLE. Ilman tätä riviä kortti ei mene tasan:
                asiakkaalta 1000, tekijöille 300, meille 400 — ja 300 jäisi
                selittämättä. Se on kulu jonka joku maksoi omasta pussistaan,
                eikä se ole kenenkään tuottoa. Kohdentamatonta ei arvata:
                maksaja luetaan kuluriviltä, ja tuntematon jää nimeämättä. */}
            {money.reimbursementCents > 0 && (
              <div style={{ ...inset, padding: T.space.md }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>Takaisin kulujen maksajalle</span>
                  <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {eur(money.reimbursementCents)}
                  </span>
                </div>
                <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, marginTop: 3, lineHeight: 1.6 }}>
                  {money.byPayer.length > 0
                    ? money.byPayer.map((pp) => `${workerName(pp.id)} ${eur(pp.cents)}`).join(" · ")
                    : "maksajaa ei ole kirjattu kuluriville"}
                </div>
              </div>
            )}
          </div>
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
                      {canEdit && (
                        <button onClick={() => bump(r.id, -HOUR_STEP)} disabled={busy || workerHoursOn(r.id, day) <= 0} title={bumpTitle("Vähennä")}
                          style={{ ...adjustBtn, opacity: workerHoursOn(r.id, day) <= 0 ? 0.35 : 1, cursor: workerHoursOn(r.id, day) <= 0 ? "default" : "pointer" }}>−</button>
                      )}
                      <span style={{ minWidth: 58, textAlign: "center", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {fmtShiftHours(r.hours)} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                      </span>
                      {canEdit && (
                        <button onClick={() => bump(r.id, HOUR_STEP)} disabled={busy} title={bumpTitle("Lisää")} style={adjustBtn}>+</button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {canEdit && (
          <p style={{ margin: `${T.space.md}px 0 0`, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.6 }}>
            Tekijä näkee omat tuntinsa ja niistä kertyneen palkkansa — ei muiden eikä asiakkaan hintaa.
            Korjaus kirjautuu kalenterissa valitulle päivälle{day === today ? "" : ` (${fmtDayLabel(day)})`}.
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

              {/* Valitun henkilön luvut: kokonaismäärä ja valitun päivän tunnit.
                  Nämä päivittyvät heti kirjauksen jälkeen, joten kirjauksen
                  vaikutuksen näkee siinä missä se tehtiin. */}
              {who && (
                <div style={{ ...inset, padding: T.space.md, display: "flex", alignItems: "baseline", gap: T.space.md, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted }}>
                    {workerName(who)} yhteensä
                  </span>
                  <span style={{ fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {fmtShiftHours(whoTotal)} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.sm, color: whoOnDay > 0 ? T.tone.goodSoft : T.text.faint }}>
                    {fmtDayLabel(day)} {fmtShiftHours(whoOnDay)} h
                  </span>
                </div>
              )}

              {/* PÄIVÄ VALITAAN KALENTERISTA, EI TÄSTÄ.

                  Tässä oli oma valitsimensa — Tänään / Eilen / päivämääräkenttä
                  — ja kalenterin tultua niitä olisi ollut kaksi. Kaksi
                  valitsinta samalle asialle on kahden totuuden vaara: ruudulla
                  auki viime tiistai, lomakkeessa "Tänään", ja kirjaus menee
                  sinne minne käyttäjä ei katso. Nyt valinta on yksi, ja tämä
                  rivi kertoo sen ääneen sekä vie takaisin kalenteriin.
                  Pikavalinnat jäivät, koska eilen kirjataan usein. */}
              <div style={{ ...inset, padding: `${T.space.sm}px ${T.space.md}px`, display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
                <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>Kirjataan päivälle</span>
                <span style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, textTransform: "capitalize" }}>
                  {fmtDayLabel(day)}{day === today ? " (tänään)" : ""}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {[{ k: today, label: "Tänään" }, { k: yesterday, label: "Eilen" }]
                    .filter((d) => d.k !== day)
                    .map((d) => (
                      <button key={d.k} onClick={() => setDay(d.k)}
                        style={{ height: 28, padding: `0 ${T.space.md}px`, borderRadius: T.radius.pill, border: T.border.subtle,
                          background: "transparent", color: T.text.muted, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, cursor: "pointer" }}>
                        {d.label}
                      </button>
                    ))}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
                <button onClick={() => setHrs((h) => Math.max(HOUR_STEP, round2(h - HOUR_STEP)))} disabled={hrs <= HOUR_STEP}
                  style={{ ...adjustBtn, opacity: hrs <= HOUR_STEP ? 0.35 : 1 }}>−</button>
                <span style={{ minWidth: 62, textAlign: "center", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700 }}>
                  {fmtShiftHours(hrs)} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                </span>
                <button onClick={() => setHrs((h) => Math.min(24, round2(h + HOUR_STEP)))} disabled={hrs >= 24} style={adjustBtn}>+</button>
                <button
                  onClick={() => { onAddHours(who, hrs, day); setHrs(1); }}
                  disabled={busy || !who}
                  style={{ flex: 1, height: 42, borderRadius: T.radius.md, border: `1px solid ${T.tone.goodBorder}`, background: T.tone.goodBg, color: T.tone.goodSoft, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
                  Lisää {fmtShiftHours(hrs)} h {day === today ? "tälle päivälle" : fmtDayLabel(day)}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. KAIKKI PÄIVÄT — HYPPYLISTA KALENTERIIN.

          Kalenteri näyttää viikon kerrallaan, ja kuukauden takaiseen päivään
          olisi neljä nuolenpainallusta. Tämä lista on se oikotie: yksi
          napautus valitsee päivän kalenteriin, jolloin sen tekijät, säädöt ja
          yksittäiset kirjaukset ovat siellä missä ne muutenkin ovat.

          Poistonapit olivat ennen tässä; ne ovat nyt kalenterissa valitun
          päivän kohdalla. Kaksi paikkaa samalle toiminnolle tarkoittaisi kaksi
          paikkaa jotka voivat erota toisistaan. */}
      {stats.byDay.length > 0 && (
        <div style={{ ...card, padding: m ? T.space.lg : T.space.xl }}>
          <button onClick={() => setDiaryOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: T.space.sm, width: "100%", padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
            <span aria-hidden style={{ color: T.text.muted, fontSize: T.size.xs }}>{diaryOpen ? "▾" : "▸"}</span>
            <span style={{ ...mono, color: T.text.faint }}>
              KAIKKI PÄIVÄT · {stats.byDay.length} {stats.byDay.length === 1 ? "PÄIVÄ" : "PÄIVÄÄ"}
            </span>
          </button>

          {diaryOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, marginTop: T.space.md }}>
              {stats.byDay
                // Suodatin koskee myös tätä: kun katsotaan yhtä tekijää, lista
                // ei saa tarjota päiviä joilla hän ei ole tehnyt mitään.
                .filter((d) => !only || d.workers.some((w) => w.id === only))
                .map((d) => {
                  const shown = only ? (d.workers.find((w) => w.id === only)?.hours ?? 0) : d.hours;
                  const isSel = d.day === day;
                  return (
                    <button key={d.day} onClick={() => setDay(d.day)}
                      title={`Näytä ${fmtDayLabel(d.day)} kalenterissa`}
                      style={{ ...inset, padding: T.space.md, width: "100%", textAlign: "left", cursor: "pointer",
                        border: isSel ? `1px solid ${T.tone.goodBorder}` : T.border.subtle,
                        background: isSel ? T.tone.goodBg : undefined }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                        <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, textTransform: "capitalize", color: isSel ? T.tone.goodSoft : T.text.primary }}>
                          {fmtDayLabel(d.day)}
                        </span>
                        {d.day === today && (
                          <span style={{ fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700, color: T.tone.goodSoft }}>tänään</span>
                        )}
                        <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isSel ? T.tone.goodSoft : T.text.primary }}>
                          {fmtShiftHours(shown)} h
                        </span>
                      </div>
                      <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, marginTop: 4, lineHeight: 1.6 }}>
                        {d.workers
                          .filter((w) => !only || w.id === only)
                          .map((w) => `${workerName(w.id)} ${fmtShiftHours(w.hours)} h`).join(" · ")}
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Yksi tunti kerrallaan — sama pyöristysyksikkö kuin ajastimella, jottei
 *  käsin korjaus tuota puolikkaita joita mikään muu ei tuota. */
/**
 * SÄÄTÖASKEL — puoli tuntia.
 *
 * Ajastin pyöristää yhä täysiin tunteihin (`roundWorkHours`), koska se on
 * mittaus eikä päätös. KÄSIN kirjattu aika on päätös: pomo tietää tehneensä
 * puoli tuntia, ja ennen tätä hänen ainoa vaihtoehtonsa oli kirjata tunti tai
 * ei mitään. Kumpikin on väärä luku laskulla ja palkassa.
 *
 * Palvelin on hyväksynyt kahden desimaalin tunnit koko ajan (`sanitizeShifts`
 * ja manuaalireitin validointi) — vain käyttöliittymä oli sidottu kokonaisiin.
 */
export const HOUR_STEP = 0.5;

/** Kaksi desimaalia — sama tarkkuus kuin `sanitizeShifts`illa, ei liukulukuroskaa. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
