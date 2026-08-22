/**
 * LAMPUT KERROKSITTAIN — pinopalkki, yksi rivi per kerros.
 *
 * MIKÄ KYSYMYS TÄHÄN VASTATAAN. "Montako polttimoa pitää ostaa, ja mihin
 * kerrokseen." Siksi rikkinäiset ovat pinon VASEMMASSA päässä, kiinni
 * perusviivassa: silmä lukee yhden pystysuoran reunan alas ja näkee heti missä
 * työ on. Jos vaihdetut olisivat ensin, sama tieto pitäisi etsiä joka riviltä
 * eri kohdasta.
 *
 * VÄRI EI KANNA MERKITYSTÄ YKSIN. Talon tilavärit ovat CVD-erottelultaan
 * rajatapaus (vihreä↔keltainen protan ΔE 7,9 tummalla pinnalla) ja asiakkaan
 * amber jää alle 3:1 valkoista vasten. Kumpikin on sallittu vain toissijaisen
 * koodauksen kanssa, joten tässä on AINA selite, jokaisella osalla `title`
 * (tarkka luku) ja rivin päässä suora luku siitä mikä vaatii toimenpiteen.
 * Lisäksi "Luvut" vaihtaa koko kuvion numerotaulukoksi.
 *
 * Suoraa lukua EI kirjoiteta joka osalle: numero jokaisen pinon päällä on
 * kohinaa eikä sitä lueta. Rivin päässä on se yksi luku josta ostos tehdään.
 *
 * Teema tulee propseina, koska tämä sama kuvio piirretään sekä FR8:n tummaan
 * dashiin että asiakkaan vaalealle paperille. Kumpikin syöttää omat mitatut
 * sävynsä; komponentti ei tunne kumpaakaan palettia.
 */
import { useState } from "react";
import type { LampFloorStat } from "@shared/project";

export interface LampChartTheme {
  /** Rikki, vaihtamatta — ostettava. */
  broken: string;
  /** Ei vielä tarkastettu. */
  unchecked: string;
  /** Tarkastettu toimivaksi — ei tehtävää, siksi neutraali. */
  working: string;
  /** Vaihdettu — me korjasimme. */
  changed: string;
  /** Palkin alusta (tyhjä rata) ja osien väliin jäävä rako. */
  surface: string;
  text: string;
  muted: string;
  font: string;
}

/** Pinon järjestys ja selitteen järjestys ovat SAMA lista — muuten selite
 *  kuvaisi eri kuviota kuin ruudulla on. */
const SEGMENTS = [
  { key: "needsBulb", label: "Ei toimi", tone: "broken" },
  { key: "unchecked", label: "Tarkastamatta", tone: "unchecked" },
  { key: "working", label: "Toimii", tone: "working" },
  { key: "changed", label: "Vaihdettu", tone: "changed" },
] as const;

interface Props {
  rows: LampFloorStat[];
  theme: LampChartTheme;
  /** Kerroksen pitkä nimi ("2. kerros"), jotta yhden huoneen keikalla ei lue väärin. */
  floorLabel: (floor: string) => string;
  /** Kerroksen napautus vie kartalle. Ilman tätä rivi ei ole nappi. */
  onFloorClick?: (floor: string) => void;
  /** Ylimääräinen otsikkorivi kuvion päälle. */
  title?: string;
}

export default function LampFloorChart({ rows, theme, floorLabel, onFloorClick, title }: Props) {
  const [asTable, setAsTable] = useState(false);
  if (rows.length === 0) return null;

  // Yhteinen asteikko kaikille kerroksille: rivit ovat vertailukelpoisia vain
  // jos 10 lampun kerros on kaksi kertaa 5 lampun kerroksen levyinen.
  const max = Math.max(...rows.map((r) => r.total), 1);
  const t = theme;

  const legend = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginBottom: 12 }}>
      {SEGMENTS.map((seg) => (
        <span key={seg.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: t.font, fontSize: 11.5, color: t.muted }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: t[seg.tone], flexShrink: 0 }} />
          {seg.label}
        </span>
      ))}
      <button
        onClick={() => setAsTable((v) => !v)}
        style={{ marginLeft: "auto", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: t.font, fontSize: 11.5, fontWeight: 600, color: t.muted }}
      >
        {asTable ? "Näytä kuvio" : "Luvut"}
      </button>
    </div>
  );

  return (
    <div>
      {title && (
        <div style={{ fontFamily: t.font, fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 10 }}>{title}</div>
      )}
      {legend}

      {asTable ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: t.font, fontSize: 12.5, color: t.text }}>
            <thead>
              <tr>
                {["Kerros", "Ei toimi", "Tarkastamatta", "Toimii", "Vaihdettu", "Yht."].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "4px 8px 6px", fontWeight: 600, fontSize: 11, color: t.muted, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.floor}>
                  <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{floorLabel(r.floor)}</td>
                  {[r.needsBulb, r.unchecked, r.working, r.changed, r.total].map((n, i) => (
                    <td key={i} style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => {
            const parts = SEGMENTS.map((seg) => ({ ...seg, n: r[seg.key] })).filter((x) => x.n > 0);
            return (
              <div key={r.floor} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Kerroksen nimi vie kartalle — sama hyppy kuin muualla dashissa. */}
                {onFloorClick ? (
                  <button
                    onClick={() => onFloorClick(r.floor)}
                    title="Näytä kartalla"
                    style={{ width: 62, flexShrink: 0, textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: t.font, fontSize: 12, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {floorLabel(r.floor)}
                  </button>
                ) : (
                  <span style={{ width: 62, flexShrink: 0, fontFamily: t.font, fontSize: 12, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {floorLabel(r.floor)}
                  </span>
                )}

                {/* Palkki. Leveys suhteessa suurimpaan kerrokseen, ei 100 %:iin —
                    muuten kaikki rivit olisivat samanpituisia ja kokoero katoaisi. */}
                <div
                  role="img"
                  aria-label={`${floorLabel(r.floor)}: ${parts.map((x) => `${x.n} ${x.label.toLowerCase()}`).join(", ")}`}
                  style={{ flex: 1, minWidth: 60, display: "flex", height: 10, borderRadius: 4, background: t.surface, overflow: "hidden" }}
                >
                  <div style={{ display: "flex", width: `${(r.total / max) * 100}%`, gap: 2 }}>
                    {parts.map((x, i) => (
                      <span
                        key={x.key}
                        title={`${x.label}: ${x.n}`}
                        style={{
                          flex: x.n, minWidth: 3, background: t[x.tone],
                          borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0,
                          borderTopRightRadius: i === parts.length - 1 ? 4 : 0, borderBottomRightRadius: i === parts.length - 1 ? 4 : 0,
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Suora luku vain siitä mikä vaatii toimenpiteen. */}
                <span style={{ width: 74, flexShrink: 0, textAlign: "right", fontFamily: t.font, fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.needsBulb > 0 ? t.broken : t.muted }}>
                  {r.needsBulb > 0 ? `${r.needsBulb} ei toimi` : "kunnossa"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
