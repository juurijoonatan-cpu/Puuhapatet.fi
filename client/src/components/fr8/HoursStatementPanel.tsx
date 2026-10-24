/**
 * ERITTELY ASIAKKAALLE — tuntilaskun liite kahden laskun jaosta.
 *
 * Kysymys jota tämä vastaa: "paljonko kenenkin tunteja on kummallakin laskulla,
 * ja täsmäävätkö ne yhteen seuraavan laskun summan kanssa?" Johtaja kertoo
 * jokaiselle tekijälle montako tuntia on laskulla 1/2 (loput ovat 2/2), ja
 * paneeli näyttää heti summat sekä sen täsmäävätkö ne järjestelmän
 * "seuraavalle laskulle" -lukuun. "Avaa erittely" tekee tulostettavan sivun:
 * jako, kaikki päivät tekijöineen ja muut kulut.
 *
 * TÄMÄ EI KIRJOITA MITÄÄN. Ei laskuja, ei tunteja, ei kulumerkintöjä — se vain
 * lukee jakson (`computeHoursPeriod`) ja muotoilee sen. Luvut tulevat samasta
 * funktiosta kuin seuraavan laskun summa.
 */
import { useEffect, useMemo, useState } from "react";
import { fmtShiftHours, parseHoursInput, type ProjectData } from "@shared/project";
import type { HoursPeriod } from "@shared/hours-period";
import { buildHoursStatement } from "@shared/invoice-statement";
import { BRAND_BILLERS } from "@shared/billers";
import { renderStatementHtml } from "@/lib/hours-statement-html";
import { T, inset, mono } from "./tokens";

interface Props {
  project: ProjectData;
  period: HoursPeriod;
  workerName: (id: string) => string;
  /** Keikan nimi otsikkoon. */
  title: string;
  /** Muistiavain (keikan id), jotta jako säilyy sivun latausten yli. */
  storeKey: string;
}

const STORE = "fr8.statement.";
const eur = (c: number) => `${(c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const toField = (h: number) => String(Math.round(h * 100) / 100).replace(".", ",");

function readStore(key: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORE + key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function writeStore(key: string, v: Record<string, string>) {
  try { window.localStorage.setItem(STORE + key, JSON.stringify(v)); } catch { /* ei säilytystä */ }
}

export default function HoursStatementPanel({ project, period, workerName, title, storeKey }: Props) {
  const [b1, setB1] = useState(BRAND_BILLERS[0].id);
  const [b2, setB2] = useState(BRAND_BILLERS[1]?.id ?? BRAND_BILLERS[0].id);
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => { setFields(readStore(storeKey)); }, [storeKey]);

  const people = period.openByWorker;

  /** Kentän arvo tunteina; tyhjä tai kelvoton = 0. */
  const firstHours = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of people) out[p.id] = Math.max(0, parseHoursInput(fields[p.id] ?? "") ?? 0);
    return out;
  }, [people, fields]);

  const statement = useMemo(
    () => buildHoursStatement(project, period, { billers: [b1, b2], firstHours }),
    [project, period, b1, b2, firstHours],
  );

  const setField = (id: string, v: string) => {
    const next = { ...fields, [id]: v };
    setFields(next);
    writeStore(storeKey, next);
  };

  const open = () => {
    const html = renderStatementHtml(statement, {
      title: title || "Keikka",
      nameOf: workerName,
      issuedOn: new Date().toLocaleDateString("fi-FI"),
    });
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const download = () => {
    const html = renderStatementHtml(statement, { title: title || "Keikka", nameOf: workerName, issuedOn: new Date().toLocaleDateString("fi-FI") });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `erittely-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const fieldStyle: React.CSSProperties = {
    height: 36, padding: `0 ${T.space.md}px`, borderRadius: T.radius.sm, border: T.border.strong,
    background: T.surface.sunken, color: T.text.primary, fontFamily: T.font, fontSize: T.size.body,
    boxSizing: "border-box", minWidth: 0,
  };
  const btn: React.CSSProperties = {
    height: 40, padding: `0 ${T.space.lg}px`, borderRadius: T.radius.md, border: `1px solid ${T.tone.goodBorder}`,
    background: T.tone.goodBg, color: T.tone.goodSoft, fontFamily: T.font, fontSize: T.size.body, fontWeight: 700,
    cursor: "pointer", whiteSpace: "nowrap",
  };
  const ghost: React.CSSProperties = { ...btn, border: T.border.strong, background: "transparent", color: T.text.secondary, fontWeight: 600 };

  if (people.length === 0) {
    return (
      <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.6 }}>
        Edellisen laskun jälkeen ei ole kirjattuja tunteja, joten erittelyä ei ole mistä tehdä.
      </p>
    );
  }

  const [i1, i2] = statement.invoices;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
      <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.6 }}>
        Kerro jokaisen tekijän kohdalla montako tuntia on laskulla 1/2. Loput menevät laskulle 2/2. Kulut menevät sille laskulle,
        jonka laskuttaja ne maksoi. Tunnit kohdistetaan päiville vanhimmasta alkaen.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center" }}>
        <span style={mono}>LASKU 1/2</span>
        <select value={b1} onChange={(e) => setB1(e.target.value)} aria-label="Lasku 1/2 laskuttaja" style={fieldStyle}>
          {BRAND_BILLERS.map((b) => <option key={b.id} value={b.id} style={{ background: "#141416" }}>{b.name}</option>)}
        </select>
        <span style={{ ...mono, marginLeft: T.space.md }}>LASKU 2/2</span>
        <select value={b2} onChange={(e) => setB2(e.target.value)} aria-label="Lasku 2/2 laskuttaja" style={fieldStyle}>
          {BRAND_BILLERS.map((b) => <option key={b.id} value={b.id} style={{ background: "#141416" }}>{b.name}</option>)}
        </select>
      </div>

      <div style={{ ...inset, padding: T.space.md, display: "flex", flexDirection: "column", gap: T.space.sm }}>
        {people.map((p) => {
          const asked = firstHours[p.id] ?? 0;
          const over = asked > p.hours;
          const rest = Math.max(0, Math.round((p.hours - Math.min(asked, p.hours)) * 100) / 100);
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 110px", fontFamily: T.font, fontSize: T.size.body, fontWeight: 600 }}>
                {workerName(p.id)} <span style={{ fontWeight: 400, color: T.text.faint }}>· {fmtShiftHours(p.hours)} h</span>
              </span>
              <input
                value={fields[p.id] ?? ""} placeholder="0" inputMode="decimal"
                aria-label={`${workerName(p.id)} — tunnit laskulla 1/2`}
                onChange={(e) => setField(p.id, e.target.value)}
                style={{ ...fieldStyle, width: 72, textAlign: "center", fontWeight: 700, ...(over ? { borderColor: T.tone.badBorder } : null) }}
              />
              <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: T.text.faint }}>h laskulla 1/2</span>
              <span style={{ fontFamily: T.font, fontSize: T.size.sm, color: over ? T.tone.bad : T.text.muted, minWidth: 96, textAlign: "right" }}>
                {over ? "yli tuntimäärän" : `${fmtShiftHours(rest)} h laskulla 2/2`}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ ...inset, padding: T.space.md, fontFamily: T.font, fontSize: T.size.sm, lineHeight: 1.7, fontVariantNumeric: "tabular-nums" }}>
        {[i1, i2].map((inv) => (
          <div key={inv.no} style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap" }}>
            <span>
              Lasku {inv.no}/2 · {inv.billerName}
              <span style={{ color: T.text.faint }}> · {fmtShiftHours(inv.hours)} h = {eur(inv.hoursCents)} + kulut {eur(inv.expensesCents + inv.otherCents)}</span>
            </span>
            <strong>{eur(inv.totalCents)}</strong>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, marginTop: 6, paddingTop: 6, borderTop: T.border.divider }}>
          <span>Yhteensä · järjestelmän seuraava lasku {eur(statement.nextInvoiceCents)}</span>
          <strong style={{ color: statement.reconciles ? T.tone.goodSoft : T.tone.bad }}>
            {eur(statement.totalCents)} {statement.reconciles ? "✓ täsmää" : "✗ ei täsmää"}
          </strong>
        </div>
      </div>

      {statement.warnings.map((w, i) => (
        <div key={i} style={{ fontFamily: T.font, fontSize: T.size.xs, color: T.tone.warn, lineHeight: 1.5 }}>⚠ {w}</div>
      ))}

      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <button type="button" onClick={open} style={btn}>Avaa erittely</button>
        <button type="button" onClick={download} style={ghost}>Lataa HTML-tiedostona</button>
      </div>
    </div>
  );
}
