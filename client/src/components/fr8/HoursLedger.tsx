/**
 * TUNTILISTA — KAIKKI PÄIVÄT ALLEKKAIN, JOHTAJAN TÄYSI MUOKKAUS.
 *
 * Kysymys jota tämä vastaa: "mitä tunteja tähän keikkaan on kirjattu, päivä
 * päivältä, kenen nimiin — ja saanko korjata sen?" Kalenteri (HourlyPanel)
 * vastaa siihen viikko kerrallaan ja korjaa yhden päivän +/− -napeilla; tämä
 * lista näyttää koko historian yhtenä pinona ja antaa jokaiselle riville:
 *
 *   · tuntien muokkauksen (puolen tunnin askel tai suoraan kirjoittamalla),
 *   · rivin poiston kokonaan,
 *   · tekijän lisäämisen päivälle, ja
 *   · kokonaan uuden päivän kirjaamisen — myös päivälle jolla ei ollut
 *     yhtään tuntia.
 *
 * TÄMÄ ON LISÄNÄKYMÄ, EI KORVAAJA. Tämä ei kirjoita mitään omaa: jokainen
 * muutos kulkee samaa `onAddHours(tekijä, delta, päivä)` -reittiä kuin
 * kalenterin napit, joten kaikki palvelimen säännöt pätevät sellaisenaan
 * (laskutettuun riviin ei yhdistetä, päivä ei mene miinukselle, tekijän
 * kokonaisluku ei katoa). Muokkaus "asetetaan tähän lukuun" lasketaan tässä
 * erotuksena nykyiseen: lista ei koskaan tallenna lukua vaan muutoksen.
 *
 * LUVUT TULEVAT `computeShiftStats`ILTA, samasta laskennasta kuin kaikki muu.
 * Lista ei summaa tunteja itse, joten se ei voi näyttää eri lukua kuin
 * kalenteri tai lasku.
 *
 * Paneeli ei päätä kuka saa muokata: kutsuja antaa `onAddHours`in vain
 * johtajille (ks. `canAdjustHours` project.tsx:ssä).
 */
import { useEffect, useMemo, useState } from "react";
import {
  computeShiftStats, dayKey, isDayKey, fmtDayLabel, fmtShiftHours, parseHoursInput,
  type ProjShift,
} from "@shared/project";
import type { HoursPeriod } from "@shared/hours-period";
import { useIsMobile } from "@/hooks/use-mobile";
import { T, inset, mono } from "./tokens";

interface Props {
  shifts: ProjShift[] | undefined;
  /** Kaikki kenelle tunteja voi kirjata. */
  people: { id: string; name: string }[];
  workerName: (id: string) => string;
  me?: string;
  /** Sama reitti kuin kalenterin napeilla: tekijä, MUUTOS tunteina, päivä. */
  onAddHours: (workerId: string, delta: number, day: string) => void;
  /** Laskutuskausi — vain siihen, että laskutetut päivät erottuvat. */
  period?: HoursPeriod | null;
  busy?: boolean;
}

/** Kuinka monta päivää näytetään kerralla — pitkä keikka ei renderöi satoja kortteja. */
const PAGE = 30;
/** Askel +/− -napeille. Sama puoli tuntia kuin kalenterissa. */
const STEP = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "7,5" — kenttään sopiva muoto ilman yksikköä. */
const toField = (h: number) => String(round2(h)).replace(".", ",");

/**
 * Yhden rivin tuntikenttä. Teksti eikä luku: "7,5" kirjoitetaan pilkulla ja
 * puolivalmis "7," ei saa hetkeksi muuttua tallennetuksi arvoksi. Arvo luetaan
 * vasta kun kenttä jätetään tai painetaan Enter; kelvoton syöte palauttaa
 * entisen luvun eikä tallenna mitään.
 */
function HoursCell({ value, onCommit, disabled, label }: {
  value: number;
  onCommit: (hours: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState(toField(value));
  // Palvelimen vastaus voi muuttaa lukua (esim. yhdistäminen) — pidä kenttä samassa.
  useEffect(() => { setDraft(toField(value)); }, [value]);

  const commit = (text: string) => {
    const n = parseHoursInput(text);
    // Nolla ei kelpaa tähän: tunnit poistetaan nimenomaisella poistonapilla.
    if (n === null || n <= 0 || n === value) { setDraft(toField(value)); return; }
    onCommit(n);
  };

  const stepBtn: React.CSSProperties = {
    width: 36, height: 36, flexShrink: 0, borderRadius: T.radius.sm,
    border: T.border.strong, background: "transparent", color: T.text.secondary,
    fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, cursor: "pointer", lineHeight: 1,
  };
  const atMin = value - STEP < STEP;
  const atMax = value + STEP > 24;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <button type="button" aria-label={`Vähennä puoli tuntia — ${label}`} disabled={disabled || atMin}
        onClick={() => onCommit(round2(value - STEP))}
        style={{ ...stepBtn, opacity: disabled || atMin ? 0.35 : 1, cursor: disabled || atMin ? "default" : "pointer" }}>−</button>
      <input
        value={draft}
        inputMode="decimal"
        aria-label={`Tunnit — ${label}`}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ width: 56, height: 36, boxSizing: "border-box", textAlign: "center", borderRadius: T.radius.sm,
          border: T.border.strong, background: T.surface.sunken, color: T.text.primary,
          fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
      />
      <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>h</span>
      <button type="button" aria-label={`Lisää puoli tuntia — ${label}`} disabled={disabled || atMax}
        onClick={() => onCommit(round2(value + STEP))}
        style={{ ...stepBtn, opacity: disabled || atMax ? 0.35 : 1, cursor: disabled || atMax ? "default" : "pointer" }}>+</button>
    </div>
  );
}

export default function HoursLedger({ shifts, people, workerName, me, onAddHours, period, busy }: Props) {
  const m = useIsMobile();
  const today = dayKey();
  const stats = useMemo(() => computeShiftStats(shifts, today), [shifts, today]);
  const invoiced = !!period?.last;

  const [limit, setLimit] = useState(PAGE);
  /** Päivä jonka "lisää tekijä" -lomake on auki. */
  const [addingDay, setAddingDay] = useState<string | null>(null);
  /** `päivä|tekijä` jonka poistoa kysytään vahvistukseksi. */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const [addWho, setAddWho] = useState("");
  const [addHrs, setAddHrs] = useState("8");

  // Uusi päivä -lomake (ylhäällä).
  const [newDay, setNewDay] = useState(today);
  const [newWho, setNewWho] = useState(me ?? "");
  const [newHrs, setNewHrs] = useState("8");

  const pickable = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const p of people) if (p.id) seen.set(p.id, { id: p.id, name: p.name || p.id });
    if (me && !seen.has(me)) seen.set(me, { id: me, name: workerName(me) });
    // Myös ne joilla on jo tunteja mutta jotka eivät ole listalla (poistettu tekijä).
    for (const w of stats.byWorker) if (!seen.has(w.id)) seen.set(w.id, { id: w.id, name: workerName(w.id) });
    return Array.from(seen.values()).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name, "fi")));
  }, [people, me, workerName, stats.byWorker]);

  useEffect(() => {
    if (!newWho && pickable.length > 0) setNewWho(me ?? pickable[0].id);
  }, [newWho, pickable, me]);

  /** Tekijän nykyiset tunnit päivälle (samasta laskennasta kuin lista). */
  const hoursOf = (worker: string, day: string): number =>
    stats.byDay.find((d) => d.day === day)?.workers.find((w) => w.id === worker)?.hours ?? 0;

  /** Aseta tekijän päivän tunnit TÄHÄN lukuun — lähetetään erotuksena. */
  const setHours = (worker: string, day: string, target: number) => {
    const delta = round2(target - hoursOf(worker, day));
    if (delta !== 0) onAddHours(worker, delta, day);
  };

  const removeRow = (worker: string, day: string) => {
    const cur = hoursOf(worker, day);
    if (cur > 0) onAddHours(worker, -cur, day);
    setConfirmDel(null);
  };

  const submitAdd = (worker: string, day: string, text: string): boolean => {
    const n = parseHoursInput(text);
    if (!worker || !isDayKey(day) || day > today || n === null || n <= 0) return false;
    // Lisäys menee nykyisen päälle: jos tekijällä on jo tunteja, tämä kasvattaa niitä.
    onAddHours(worker, n, day);
    return true;
  };

  const fieldStyle: React.CSSProperties = {
    height: 40, padding: `0 ${T.space.md}px`, borderRadius: T.radius.md, border: T.border.strong,
    background: T.surface.sunken, color: T.text.primary, fontFamily: T.font, fontSize: T.size.body,
    boxSizing: "border-box", minWidth: 0,
  };
  const primaryBtn: React.CSSProperties = {
    height: 40, padding: `0 ${T.space.lg}px`, borderRadius: T.radius.md, border: `1px solid ${T.tone.goodBorder}`,
    background: T.tone.goodBg, color: T.tone.goodSoft, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700,
    cursor: "pointer", whiteSpace: "nowrap",
  };
  const ghostBtn: React.CSSProperties = {
    height: 40, padding: `0 ${T.space.md}px`, borderRadius: T.radius.md, border: T.border.strong,
    background: "transparent", color: T.text.secondary, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap",
  };

  const newDayValid = !!newWho && isDayKey(newDay) && newDay <= today && (parseHoursInput(newHrs) ?? 0) > 0;
  const days = stats.byDay.slice(0, limit);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
      {/* LISÄÄ KIRJAUS MILLE PÄIVÄLLE TAHANSA — myös päivälle jolla ei ole
          vielä yhtään tuntia. Tämä on se tapa jolla "unohtunut" päivä saadaan
          listalle: listassa ovat vain päivät joille on jo kirjattu jotain. */}
      <div style={{ ...inset, padding: T.space.md }}>
        <div style={{ ...mono, marginBottom: T.space.sm }}>KIRJAA TUNNIT PÄIVÄLLE</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center" }}>
          <input type="date" value={newDay} max={today} aria-label="Päivä"
            onChange={(e) => { if (isDayKey(e.target.value)) setNewDay(e.target.value); }}
            style={{ ...fieldStyle, colorScheme: "dark", flex: m ? "1 1 140px" : "0 0 auto" }} />
          <select value={newWho} onChange={(e) => setNewWho(e.target.value)} aria-label="Tekijä"
            style={{ ...fieldStyle, flex: "1 1 140px" }}>
            {pickable.map((p) => (
              <option key={p.id} value={p.id} style={{ background: "#141416" }}>{p.id === me ? `${p.name} (sinä)` : p.name}</option>
            ))}
          </select>
          <input value={newHrs} onChange={(e) => setNewHrs(e.target.value)} inputMode="decimal" aria-label="Tunnit"
            style={{ ...fieldStyle, width: 72, textAlign: "center", fontWeight: 700 }} />
          <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>h</span>
          <button type="button" disabled={busy || !newDayValid}
            onClick={() => { if (submitAdd(newWho, newDay, newHrs)) setNewHrs("8"); }}
            style={{ ...primaryBtn, opacity: busy || !newDayValid ? 0.45 : 1, cursor: busy || !newDayValid ? "default" : "pointer", flex: m ? "1 1 100%" : "0 0 auto" }}>
            Kirjaa {isDayKey(newDay) ? fmtDayLabel(newDay) : ""}
          </button>
        </div>
        {hoursOf(newWho, newDay) > 0 && (
          <div style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.tone.warn, marginTop: T.space.sm, lineHeight: 1.5 }}>
            {workerName(newWho)} on jo kirjattu {fmtDayLabel(newDay)} {fmtShiftHours(hoursOf(newWho, newDay))} h — tämä lisätään niiden päälle.
            Korjaa luku suoraan alla olevasta listasta.
          </div>
        )}
      </div>

      {days.length === 0 ? (
        <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.6 }}>
          Tälle työlle ei ole vielä kirjattu tunteja. Kirjaa ensimmäinen yllä.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          {days.map((d) => {
            const open = period?.openByDay.find((x) => x.day === d.day)?.hours ?? 0;
            const billed = invoiced ? (open <= 0 ? "all" : open < d.hours ? "part" : "none") : "none";
            const onDay = new Set(d.workers.map((w) => w.id));
            const freePeople = pickable.filter((p) => !onDay.has(p.id));
            const adding = addingDay === d.day;
            return (
              <div key={d.day} style={{ ...inset, padding: T.space.md }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: T.font, fontSize: T.size.body, fontWeight: 700, textTransform: "capitalize" }}>
                    {fmtDayLabel(d.day)}
                  </span>
                  <span style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint }}>{d.day.split("-")[0]}</span>
                  {d.day === today && (
                    <span style={{ fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700, color: T.tone.goodSoft }}>tänään</span>
                  )}
                  {billed !== "none" && (
                    <span style={{ fontFamily: T.font, fontSize: T.size.xs, fontWeight: 600, color: billed === "all" ? T.text.faint : T.tone.warn }}>
                      {billed === "all" ? "✓ laskutettu" : "osin laskutettu"}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontFamily: T.font, fontSize: T.size.title, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {fmtShiftHours(d.hours)} <span style={{ fontSize: T.size.sm, fontWeight: 500, color: T.text.faint }}>h</span>
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, marginTop: T.space.sm, paddingTop: T.space.sm, borderTop: T.border.divider }}>
                  {d.workers.map((w) => {
                    const key = `${d.day}|${w.id}`;
                    const nm = workerName(w.id);
                    return (
                      <div key={w.id} style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
                        <span style={{ flex: "1 1 110px", minWidth: 0, fontFamily: T.font, fontSize: T.size.body, fontWeight: 600,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {nm}{w.id === me ? <span style={{ fontWeight: 400, color: T.text.faint }}> · sinä</span> : null}
                        </span>
                        {confirmDel === key ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.tone.bad }}>
                              Poistetaanko {fmtShiftHours(w.hours)} h?
                            </span>
                            <button type="button" disabled={busy} onClick={() => removeRow(w.id, d.day)}
                              style={{ ...ghostBtn, height: 36, color: T.tone.bad, borderColor: T.tone.badBorder, background: T.tone.badBg }}>Poista</button>
                            <button type="button" onClick={() => setConfirmDel(null)} style={{ ...ghostBtn, height: 36 }}>Peruuta</button>
                          </div>
                        ) : (
                          <>
                            <HoursCell value={w.hours} disabled={busy} label={`${nm} ${fmtDayLabel(d.day)}`}
                              onCommit={(h) => setHours(w.id, d.day, h)} />
                            <button type="button" disabled={busy} onClick={() => setConfirmDel(key)}
                              aria-label={`Poista ${nm} ${fmtDayLabel(d.day)}`} title="Poista tämän päivän tunnit"
                              style={{ width: 36, height: 36, flexShrink: 0, borderRadius: T.radius.sm, border: T.border.subtle,
                                background: "transparent", color: T.text.muted, fontSize: T.size.body, cursor: "pointer", lineHeight: 1 }}>✕</button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {freePeople.length > 0 && (
                  adding ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center", marginTop: T.space.md }}>
                      <select value={addWho} onChange={(e) => setAddWho(e.target.value)} aria-label="Tekijä"
                        style={{ ...fieldStyle, flex: "1 1 140px" }}>
                        <option value="" style={{ background: "#141416" }}>Valitse tekijä…</option>
                        {freePeople.map((p) => (
                          <option key={p.id} value={p.id} style={{ background: "#141416" }}>{p.id === me ? `${p.name} (sinä)` : p.name}</option>
                        ))}
                      </select>
                      <input value={addHrs} onChange={(e) => setAddHrs(e.target.value)} inputMode="decimal" aria-label="Tunnit"
                        style={{ ...fieldStyle, width: 72, textAlign: "center", fontWeight: 700 }} />
                      <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>h</span>
                      <button type="button" disabled={busy || !addWho || !((parseHoursInput(addHrs) ?? 0) > 0)}
                        onClick={() => { if (submitAdd(addWho, d.day, addHrs)) { setAddingDay(null); setAddWho(""); setAddHrs("8"); } }}
                        style={{ ...primaryBtn, opacity: busy || !addWho || !((parseHoursInput(addHrs) ?? 0) > 0) ? 0.45 : 1 }}>Lisää</button>
                      <button type="button" onClick={() => setAddingDay(null)} style={ghostBtn}>Peruuta</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setAddingDay(d.day); setAddWho(""); setAddHrs("8"); }}
                      style={{ ...ghostBtn, height: 36, marginTop: T.space.md, fontSize: T.size.xs }}>
                      + Lisää tekijä päivälle
                    </button>
                  )
                )}
              </div>
            );
          })}

          {stats.byDay.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} style={{ ...ghostBtn, width: "100%" }}>
              Näytä vanhemmat ({stats.byDay.length - limit} päivää)
            </button>
          )}
        </div>
      )}

      <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.xs, color: T.text.faint, lineHeight: 1.6 }}>
        Luku asetetaan sellaisenaan: kirjoita uusi määrä tai käytä puolen tunnin nappeja. Tekijä näkee muutoksen omissa tunneissaan.
        {invoiced && " Jo laskutettujen tuntien muutos huomioidaan seuraavalla laskulla."}
      </p>
    </div>
  );
}
