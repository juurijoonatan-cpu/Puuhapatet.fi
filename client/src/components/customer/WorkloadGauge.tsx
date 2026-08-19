/**
 * TYÖMÄÄRÄMITTARI — keikan tuntiarvio asiakkaan näkymässä.
 *
 * MIKSI TÄMÄ EI OLE TOINEN PROSENTTIRENGAS. Sivun pääkortissa on jo mittari,
 * joka vastaa kysymykseen "kuinka pitkällä työ on". Jos tämä näyttäisi saman
 * suhdeluvun toisessa muodossa, se ei kertoisi mitään uutta — kaksi mittaria
 * samasta luvusta on juuri se koriste jota tässä näkymässä ei haluta.
 *
 * Uutta tietoa on ASTEIKKO: ikkunamäärä muutetaan tunneiksi. Siksi tässä
 * mittarissa ei ole prosenttilukua lainkaan. Sen asteikko on 0 h → koko keikan
 * arvio, osoitin on nykyhetki sillä asteikolla, ja iso luku on se mitä asiakas
 * oikeasti haluaa tietää: montako tuntia työtä on vielä jäljellä.
 *
 * MUOTO. Kaari (240°), ei täysi rengas — jo silmämääräisesti eri soitin kuin
 * pääkortin rengas, joten kahta mittaria ei lue samaksi asiaksi. Segmentit ovat
 * sama kieli kuin `RadialMeter`issa: ne ovat asteikon viivat, ja niistä voi
 * laskea. Kaaren alle jäävä aukko ei ole hukkatilaa vaan mittarin asteikkokehä:
 * siinä ovat pääteluvut 0 h ja kokonaisarvio.
 *
 * VÄRISÄÄNNÖT (dataviz):
 *  - Täyttö kantaa merkityksen (tehty työ). Rata on SAMAN sävyn askel, ei
 *    harmaa, jotta koko asteikko luetaan kaaresta eikä vain täytetystä osasta.
 *  - Osoitin on kirkkaampi askel samasta sävystä — ei uusi väri. Uusi väri
 *    tarkoittaisi uutta merkitystä, ja osoitin on sama tieto tarkemmin.
 *  - Iso luku on SUHTEELLISILLA numeroilla (ei `tabular-nums`); pääteluvut ja
 *    avain–arvo-rivit ovat tabular, koska ne ladotaan allekkain.
 *
 * REHELLISYYS. Tämä on arvio (mitoitus × ikkunat), ei kirjattu toteuma.
 * Toteutuneita työtunteja ei näytetä asiakkaalle koskaan — ne ovat tekijän
 * palkan peruste. Siksi joka luvun vieressä lukee "arvio", eikä mittari lupaa
 * aikataulua.
 *
 * SAAVUTETTAVUUS: koko kaari on yksi `role="meter"`, jonka `aria-valuetext`
 * kertoo tunnit sanoin. Segmentit ovat `aria-hidden` — ne ovat asteikon piirros
 * eivätkä 24 erillistä tietoa.
 */

import { useEaseTo } from "@/hooks/use-ease-to";
import { CFONT, type CustomerTheme } from "@/lib/customer-theme";

/**
 * Tunnit suomeksi. Desimaalit vain kun ne kertovat jotain: "22 h", "1,5 h",
 * "0,75 h".
 *
 * KAKSI DESIMAALIA EIKÄ YKSI: mitoitus annetaan tunneissa per ikkuna, ja 0,75 h
 * (45 min) on tavallinen arvo. Yhdellä desimaalilla se luki "0,8 h", eli näkymä
 * näytti eri luvun kuin se joka keikalle oli annettu.
 */
export function fmtHours(h: number): string {
  const r = Math.round(h * 100) / 100;
  return `${r.toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`;
}

const SWEEP = 240;          // kaaren kulma-ala; loput 120° on asteikkokehä
const START = -SWEEP / 2;   // 0° = kello 12, joten kaari on symmetrinen

export default function WorkloadGauge({
  theme, hoursPerWindow, totalWindows, doneWindows, size = 178, segments = 24,
}: {
  theme: CustomerTheme;
  hoursPerWindow: number;
  totalWindows: number;
  doneWindows: number;
  size?: number;
  segments?: number;
}) {
  const totalHours = hoursPerWindow * Math.max(0, totalWindows);
  const doneHours = hoursPerWindow * Math.max(0, Math.min(totalWindows, doneWindows));
  const remainingHours = Math.max(0, totalHours - doneHours);
  const ratio = totalHours > 0 ? doneHours / totalHours : 0;

  // Sama nousuanimaatio kuin pääkortissa, ja osoitin + iso luku ajetaan
  // SAMASTA arvosta, joten ne eivät voi olla eri kohdassa kesken animaation.
  const live = useEaseTo(Math.max(0, Math.min(1, ratio)) * 100) / 100;
  const liveRemaining = totalHours - live * totalHours;

  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(10, Math.round(size * 0.078));
  const r = cx - stroke / 2 - 2;
  const stepDeg = SWEEP / segments;
  // Rako mitataan pikseleinä kaaren pituudella: vakioasteikko antaisi eri
  // levyisen raon eri kokoisille mittareille.
  const gapPx = Math.max(3, Math.round(size * 0.021));
  const gapDeg = (gapPx / (2 * Math.PI * r)) * 360;
  const arcDeg = Math.max(1, stepDeg - gapDeg);
  const filled = live <= 0 ? 0 : Math.max(1, Math.round(live * segments));

  const polar = (deg: number, radius = r) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const arcPath = (a0: number, a1: number) => {
    const a = polar(a0);
    const b = polar(a1);
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };

  // Osoitin: lyhyt sädeviiva kaaren päällä, ei keskiöstä lähtevä neula.
  // Neula kulkisi ison luvun päältä ja pakottaisi luvun pois keskeltä.
  const pointerDeg = START + live * SWEEP;
  const pIn = polar(pointerDeg, r - stroke / 2 - 3);
  const pOut = polar(pointerDeg, r + stroke / 2 + 3);

  const track = theme.meterTrack;
  const mono = {
    fontFamily: "var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: theme.muted,
  };

  /**
   * KESKUSLUVUN KOKO SOVITETAAN MERKKIMÄÄRÄÄN.
   *
   * Kiinteä koko riitti "22,5":lle mutta ei "109,4":lle: iso luku levisi
   * renkaan ulkopuolelle ja meni kaaren päälle — ja leveällä ruudulla vielä
   * viereisen luentataulukon päälle, koska keskitys on absoluuttinen eikä
   * rajoita leveyttä. Tämä näkyi vasta kun mittari piirrettiin ja katsottiin.
   *
   * Budjetti on renkaan SISÄhalkaisija. Leveysarvio on karkea (numero ~0,6 em,
   * pilkku ~0,3 em) mutta se on aina liian iso eikä liian pieni, joten luku
   * mahtuu myös kirjasimella jota tässä ei ole mitattu.
   */
  const numText = (Math.round(Math.max(0, liveRemaining) * 100) / 100)
    .toLocaleString("fi-FI", { maximumFractionDigits: 2 });
  const innerWidth = 2 * (r - stroke / 2) - 8;
  const numEms = Array.from(numText).reduce((w, ch) => w + (ch === "," || ch === " " ? 0.3 : 0.6), 0);
  let numSize = Math.round(size * 0.235);
  const unitOf = (n: number) => Math.round(n * 0.42);
  while (numSize > 17 && numEms * numSize + unitOf(numSize) + 5 > innerWidth) numSize -= 1;

  return (
    <div style={{ fontFamily: CFONT, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 }}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalHours * 10) / 10}
        aria-valuenow={Math.round(doneHours * 10) / 10}
        aria-label="Työmäärän arvio"
        aria-valuetext={`Arvio: ${fmtHours(remainingHours)} työtä jäljellä, tehty ${fmtHours(doneHours)} arvioidusta ${fmtHours(totalHours)}`}
        style={{ position: "relative", width: size, height: size, flex: "0 0 auto", margin: "0 auto" }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
          {Array.from({ length: segments }, (_, i) => {
            const a0 = START + i * stepDeg;
            return (
              <path
                key={i}
                d={arcPath(a0, a0 + arcDeg)}
                stroke={i < filled ? theme.green : track}
                strokeWidth={stroke}
                /* BUTT eikä round: pyöreä pää jatkaa segmenttiä stroke/2 verran
                   molemmista päistä, mikä on tällä paksuudella enemmän kuin koko
                   rako — segmentit sulautuisivat yhdeksi kaareksi ja asteikko
                   katoaisi. Sama havainto kuin `RadialMeter`issa. */
                strokeLinecap="butt"
                fill="none"
              />
            );
          })}
          <line
            x1={pIn.x} y1={pIn.y} x2={pOut.x} y2={pOut.y}
            stroke={theme.ink} strokeWidth={3} strokeLinecap="round"
          />
        </svg>

        {/* Iso luku kaaren optisessa keskiössä. Absoluuttinen keskitys, jottei
            se venytä mittarin laatikkoa. */}
        <div
          style={{
            position: "absolute", left: 0, right: 0, top: "38%",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 3, maxWidth: innerWidth }}>
            <span style={{ fontSize: numSize, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.045em", color: theme.ink }}>
              {numText}
            </span>
            <span style={{ fontSize: unitOf(numSize), fontWeight: 700, color: theme.muted, letterSpacing: "-0.02em" }}>h</span>
          </div>
          <span style={{ ...mono, fontSize: 9 }}>jäljellä · arvio</span>
        </div>

        {/* Asteikon pääteluvut kaaren alle jäävään aukkoon — ne tekevät tästä
            tuntiasteikon eivätkä toista prosenttilukua. */}
        {/* Versaalimuunnos EI koske näitä: se teki yksiköstä "22,5 H". */}
        <span style={{ position: "absolute", left: 2, bottom: "13%", ...mono, textTransform: "none", fontVariantNumeric: "tabular-nums" }}>0 h</span>
        <span style={{ position: "absolute", right: 2, bottom: "13%", ...mono, textTransform: "none", fontVariantNumeric: "tabular-nums" }}>{fmtHours(totalHours)}</span>
      </div>

      <dl style={{ flex: "1 1 190px", minWidth: 175, margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 9, columnGap: 14, alignContent: "center" }}>
        <Row k="Koko keikka" theme={theme}>
          <b style={{ color: theme.ink, fontVariantNumeric: "tabular-nums" }}>{fmtHours(totalHours)}</b>
          <span style={{ color: theme.muted }}> arviolta</span>
        </Row>
        <Row k="Tehty" theme={theme}>
          <b style={{ color: theme.green, fontVariantNumeric: "tabular-nums" }}>{fmtHours(doneHours)}</b>
          <span style={{ color: theme.muted }}> arviolta</span>
        </Row>
        <Row k="Per ikkuna" theme={theme}>
          <b style={{ color: theme.ink, fontVariantNumeric: "tabular-nums" }}>{fmtHours(hoursPerWindow)}</b>
          <span style={{ color: theme.muted }}> mitoitus</span>
        </Row>
      </dl>
    </div>
  );
}

function Row({ k, theme, children }: { k: string; theme: CustomerTheme; children: React.ReactNode }) {
  return (
    <>
      <dt style={{ fontFamily: "var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.muted, whiteSpace: "nowrap", alignSelf: "center" }}>{k}</dt>
      <dd style={{ margin: 0, fontSize: 14, lineHeight: 1.35, alignSelf: "center" }}>{children}</dd>
    </>
  );
}
