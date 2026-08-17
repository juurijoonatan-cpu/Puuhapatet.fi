/**
 * Segmentoitu rengasmittari — yksi suhdeluku rajaa vasten.
 *
 * MIKSI RENGAS EIKÄ PIIRAS: tämä on **mittari**, ei osuuskaavio. Piirakassa
 * kaksi lohkoa on aina väärä muoto, ja palkki taas hukkuu tiheään näkymään.
 * Rengas antaa isolle luvulle oman keskuksensa ja kertoo silti asteikon.
 *
 * MIKSI SEGMENTIT EIKÄ YHTENÄINEN KAARI: yhtenäisestä kaaresta lukee vain
 * "aika paljon". Segmentit tekevät asteikon luettavaksi — ne ovat sama asia
 * kuin akselin viivat, ja niistä voi laskea. Ne ovat myös se yksityiskohta joka
 * saa näkymän näyttämään mittalaitteelta eikä koristeelta.
 *
 * VÄRISÄÄNNÖT (dataviz):
 *  - Täyttö kantaa merkityksen; **rata on saman sävyn tummempi askel**, ei
 *    harmaa. Näin tila luetaan koko renkaasta eikä vain täytetystä osasta.
 *  - Numerot keskellä ovat SUHTEELLISIA (ei `tabular-nums`): tabular antaa
 *    joka numerolle nollan levyisen ruudun, jolloin iso luku näyttää löysältä.
 *    `tabular-nums` on sarakkeita varten.
 *  - Prosenttimerkki on hiljaisempi kuin luku: numero on se mitä katsotaan.
 *
 * SAAVUTETTAVUUS: koko mittari on yksi `role="meter"`, jolla on `aria-valuenow`
 * ja tekstivastine — segmentit ovat `aria-hidden`, koska ne ovat asteikon
 * piirros eivätkä 24 erillistä tietoa.
 */

import { useEaseTo } from "@/hooks/use-ease-to";

export interface RadialMeterProps {
  /** 0–100. Arvo rajataan, joten kutsujan ei tarvitse siivota sitä. */
  pct: number;
  /** Täytön väri — kantaa merkityksen (esim. pesty). */
  color: string;
  /** Radan väri: saman sävyn tummempi/vaaleampi askel, EI harmaa. */
  trackColor: string;
  /** Keskusluvun ja yksikön väri. */
  ink: string;
  mutedInk: string;
  /** Ulkohalkaisija px. Kutsuja säätää ruudun mukaan. */
  size?: number;
  /** Segmenttien määrä. 24 = yksi joka 15°, luettava mutta ei rauhaton. */
  segments?: number;
  /** Tekstivastine ruudunlukijalle, esim. "Työn edistyminen". */
  label: string;
  /** Valinnainen rivi luvun alla (esim. "37 / 60 ikkunaa"). */
  caption?: string;
}

export default function RadialMeter({
  pct, color, trackColor, ink, mutedInk,
  size = 208, segments = 24, label, caption,
}: RadialMeterProps) {
  const target = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  // Sama nousuanimaatio kuin muualla asiakkaan näkymässä: luku ja rengas
  // liikkuvat yhdestä arvosta, joten ne eivät voi ajautua eri tahtiin.
  const live = useEaseTo(target);

  // Segmentin geometria. Piirretään kaarina, joiden väliin jää rako — rako on
  // pintaa, ei viivaa: mittarin osia ei eroteta reunuksella (dataviz).
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(9, Math.round(size * 0.075));
  const r = cx - stroke / 2 - 2;
  const stepDeg = 360 / segments;
  /**
   * Rako mitataan PIKSELEINÄ kaaren pituudella ja muunnetaan asteiksi.
   *
   * Vakioasteikko (esim. "aina 4°") antaa eri levyisen raon eri kokoisille
   * renkaille, koska sama kulma on isommalla säteellä pidempi matka. Pikseliraosta
   * segmentit näyttävät samalta koosta riippumatta.
   */
  const gapPx = Math.max(3, Math.round(size * 0.022));
  const gapDeg = (gapPx / (2 * Math.PI * r)) * 360;
  const arcDeg = Math.max(1, stepDeg - gapDeg);

  // Kuinka moni segmentti on täynnä. Pyöristys ylöspäin vasta kun arvo on
  // aidosti yli nollan, jottei 0 % näytä yhdeltä täydeltä segmentiltä.
  const filled = live <= 0 ? 0 : Math.max(1, Math.round((live / 100) * segments));

  const polar = (deg: number) => {
    // -90° = kello 12. Mittari kasvaa myötäpäivään, kuten mittarit lukee.
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const arcPath = (startDeg: number, endDeg: number) => {
    const a = polar(startDeg);
    const b = polar(endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      <div
        role="meter"
        aria-valuenow={Math.round(target)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        aria-valuetext={`${Math.round(target)} % — ${label}${caption ? `, ${caption}` : ""}`}
        style={{ position: "relative", width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
          {Array.from({ length: segments }, (_, i) => {
            const start = i * stepDeg;
            const on = i < filled;
            return (
              <path
                key={i}
                d={arcPath(start, start + arcDeg)}
                stroke={on ? color : trackColor}
                strokeWidth={stroke}
                // BUTT eikä round: pyöreä pää jatkaa segmenttiä `stroke/2`
                // verran MOLEMMISTA päistä, mikä tällä paksuudella on ~5,6° per
                // pää — enemmän kuin koko rako. Segmentit sulautuivat yhdeksi
                // kaareksi ja mittarin asteikko katosi. Tämä näkyi vasta kun
                // mittari piirrettiin ja katsottiin.
                strokeLinecap="butt"
                fill="none"
              />
            );
          })}
        </svg>

        {/* Keskusluku. Absoluuttinen keskitys, jotta rengas ei venytä laatikkoa. */}
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span
              style={{
                fontSize: Math.round(size * 0.28),
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: "-0.045em",
                color: ink,
              }}
            >
              {Math.round(live)}
            </span>
            <span
              style={{
                fontSize: Math.round(size * 0.11),
                fontWeight: 700,
                color: mutedInk,
                letterSpacing: "-0.02em",
              }}
            >
              %
            </span>
          </div>
          {caption && (
            <span
              style={{
                fontSize: Math.max(11, Math.round(size * 0.062)),
                color: mutedInk,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {caption}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
