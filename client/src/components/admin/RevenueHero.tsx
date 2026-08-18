/**
 * ADMIN-ETUSIVUN AVAUSKUVA — laskutettu ja oma tulo, yhdellä silmäyksellä.
 *
 * MIKSI: ylläpidon avatessa ensimmäinen näkymä oli tervehdys ja neljä
 * samannäköistä pientä korttia, joista rahan kokonaiskuvaa ei saanut lainkaan —
 * kokonaislaskutus oli hajallaan kahdessa eri kortissa (pikkukeikat
 * `/api/stats`issa, urakat `gigData`-blobeissa) eikä niitä ollut missään
 * yhteenlaskettu.
 *
 * MITÄ TÄSSÄ ON JA MITÄ EI: kaksi lukua (laskutettu, oma tulo), niiden
 * koostumus, ja laskutuksen aikasarja kuukausittain. Ei toimintoja, ei
 * varoituksia, ei kolmatta lukua — kaikki muu on jo alempana omissa
 * korteissaan. Avauskuvan tehtävä on kertoa tilanne, ei hoitaa asioita.
 *
 * KAIKKI LUVUT OVAT AITOJA. Sarja tulee `monthlyInvoicedCents`ista (erämaksujen
 * aikaleimoista) ja pikkukeikkojen keikkapäivistä; jos kuukaudessa ei ole
 * mitään, pylväs on tyhjä. Tässä ei ole demodataa eikä tasoitusta.
 *
 * TUMMA PINTA ON TARKOITUKSELLINEN, EI TEEMAVIRHE. Avauskuva on yksi
 * kiinteäsävyinen kaistale sivun yläreunassa (kuten mittarinäkymä asiakkaan
 * teknisessä teemassa), joten se näyttää samalta vaaleassa ja tummassa tilassa.
 * Värit tulevat samasta paletista kuin asiakkaan tekninen teema (`CT_TECH`),
 * jottei järjestelmässä ole kahta eri tummaa.
 *
 * VÄREISTÄ: kaksi sarjaa (urakat / pikkukeikat) erottuvat sekä värillä että
 * TEKSTILLÄ. Vihreä–keltainen-pari on CVD-rajatapaus, joten väri ei koskaan ole
 * ainoa erottava tekijä; tässä parina on vihreä ja vaalea sininen, ja
 * selitteessä on molempien nimi ja summa.
 */

import { useMemo } from "react";
import { CT_TECH, CFONT } from "@/lib/customer-theme";

/** Kuukausi kaistaleessa: avain "2026-08" ja sentit. */
export interface HeroMonth {
  key: string;
  cents: number;
}

/** Pylvään korkeus pisteinä. Seitsemän riittää muodon näyttämiseen ja pysyy
 *  matalana puhelimessa; enemmän tekisi tästä kuvaajan, ja tämä ei ole kuvaaja. */
const ROWS = 7;

const eur0 = (cents: number) =>
  Math.round(cents / 100).toLocaleString("fi-FI") + " €";

const eur2 = (cents: number) =>
  (cents / 100).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** "2026-08" → "08". Kuukauden numero riittää: vuosi on otsikossa. */
const monthTick = (key: string) => key.slice(5, 7);

function Dot({ on, color, size = 5 }: { on: boolean; color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        // Sammunut piste on saman rampin tummempi askel, ei harmaa: harmaa
        // lukisi omana sarjana. Ks. dataviz — mittarin ura on saman värin askel.
        background: on ? color : CT_TECH.hair,
        display: "block",
        flex: "0 0 auto",
      }}
    />
  );
}

/**
 * Osuusnauha: yksi pisterivi, jossa alkuosa on urakat ja loppuosa pikkukeikat.
 * Kertoo mistä iso luku koostuu ilman toista lukua tai kuvaajaa.
 */
function ShareStrip({ gigCents, smallCents, dots = 22 }: { gigCents: number; smallCents: number; dots?: number }) {
  const total = gigCents + smallCents;
  // Nollatilanne: kaikki pisteet sammuksissa, ei jakoa keksitä.
  const gigDots = total > 0 ? Math.min(dots, Math.max(gigCents > 0 ? 1 : 0, Math.round((gigCents / total) * dots))) : 0;
  return (
    // 22 pistettä × 7 px + 21 × 3 px = 217 px, eli nauha mahtuu kapeimmalle
    // puhelimelle (320 px) ilman vieritystä ja levenee `space-between`illä koko
    // kaistaleen leveyteen. Pisteet EIVÄT kutistu (`flex: 0 0 auto`), joten
    // määrä on se mikä ratkaisee mahtuuko nauha — ei tyyli.
    <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "space-between" }}>
      {Array.from({ length: dots }, (_, i) => (
        <Dot key={i} on={total > 0} color={i < gigDots ? CT_TECH.green : CT_TECH.navy} size={7} />
      ))}
    </div>
  );
}

export default function RevenueHero({
  invoicedCents,
  gigCents,
  smallCents,
  myIncomeCents,
  myName,
  months,
  loading = false,
}: {
  /** Laskutettu yhteensä = urakat + pikkukeikat. */
  invoicedCents: number;
  /** Urakkakeikkojen laskutus (erämaksut). */
  gigCents: number;
  /** Pikkukeikkojen valmistunut laskutus. */
  smallCents: number;
  /** Kirjautuneen oma tulo — sama luku kuin "Oma tulo" -kortissa. */
  myIncomeCents: number;
  myName: string;
  /** Aikasarja vanhimmasta uusimpaan. Tyhjä = ei vielä laskutusta. */
  months: HeroMonth[];
  loading?: boolean;
}) {
  const max = useMemo(() => Math.max(1, ...months.map((m) => m.cents)), [months]);
  const peak = useMemo(
    () => months.reduce<HeroMonth | null>((best, m) => (!best || m.cents > best.cents ? m : best), null),
    [months],
  );

  return (
    <section
      aria-label="Laskutus ja oma tulo"
      style={{
        background: CT_TECH.paper,
        border: `1px solid ${CT_TECH.hair}`,
        borderRadius: 22,
        padding: "22px 22px 18px",
        fontFamily: CFONT,
        color: CT_TECH.ink,
        marginBottom: 24,
        overflow: "hidden",
      }}
    >
      {/* Yläkulma: kenen luvut ja miltä ajalta. Ilman tätä isot luvut olisivat
          ilman kontekstia — "12 480 €" mistä ja milloin. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: CT_TECH.muted }}>
          Puuhapatet · koko historia
        </p>
        {(loading || months.length > 0) && (
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: CT_TECH.muted, fontVariantNumeric: "tabular-nums" }}>
            {loading ? "LADATAAN" : `${months.length} KK`}
          </p>
        )}
      </div>

      {/* Kaksi lukua. Suhteelliset numerot (ei tabular): iso yksittäinen luku
          näyttää tabularilla löysältä — sarakkeissa on toisin. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 18, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: CT_TECH.muted }}>
            Laskutettu
          </p>
          <p style={{ margin: 0, fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.045em" }}>
            {loading ? "—" : eur0(invoicedCents)}
          </p>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: CT_TECH.muted }}>
            {myName} · oma tulo
          </p>
          <p style={{ margin: 0, fontSize: 40, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.045em", color: CT_TECH.green }}>
            {loading ? "—" : eur0(myIncomeCents)}
          </p>
        </div>
      </div>

      {/* Koostumus: nauha + selite, jossa molemmilla sarjoilla on nimi ja summa.
          Otsikko on tässä siksi, että nauha on koko kaistaleen levyinen ja
          asettuu molempien lukujen alle — ilman otsikkoa se lukisi yhtä hyvin
          "oman tulon" jakaumana, jota se ei ole. */}
      <p style={{ margin: "22px 0 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: CT_TECH.muted }}>
        Laskutuksen koostumus
      </p>
      <ShareStrip gigCents={gigCents} smallCents={smallCents} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 10, marginBottom: 20 }}>
        {[
          { label: "Urakat", cents: gigCents, color: CT_TECH.green },
          { label: "Pikkukeikat", cents: smallCents, color: CT_TECH.navy },
        ].map((s) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: CT_TECH.muted }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flex: "0 0 auto" }} />
            {s.label}
            <b style={{ color: CT_TECH.ink, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{eur2(s.cents)}</b>
          </span>
        ))}
      </div>

      {/* Aikasarja. Pisteitä eikä palkkeja, koska tämä ei ole kuvaaja vaan
          rytmi: näkyy mitkä kuukaudet olivat isoja ja mitkä tyhjiä. */}
      <div style={{ borderTop: `1px solid ${CT_TECH.hair}`, paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: CT_TECH.muted }}>
            Laskutus / kk
          </p>
          {peak && peak.cents > 0 && (
            <p style={{ margin: 0, fontSize: 11, color: CT_TECH.muted, fontVariantNumeric: "tabular-nums" }}>
              huippu {monthTick(peak.key)}/{peak.key.slice(0, 4)} · {eur0(peak.cents)}
            </p>
          )}
        </div>

        {months.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: CT_TECH.muted }}>
            Ei vielä laskutusta — sarja piirtyy ensimmäisestä maksusta.
          </p>
        ) : (
          // Sarakkeet jakavat leveyden (`flex: 1`), jotta sarja täyttää kaistaleen
          // eikä kyhjötä vasempaan reunaan. `minWidth` pitää pisteet erillään
          // puhelimessa: kun tila loppuu, rivi vierii.
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", overflowX: "auto", paddingBottom: 2 }}>
            {months.map((m) => {
              // Nolla on nolla: yksikään piste ei syty. Muuten vähintään yksi,
              // jottei pieni mutta oikea kuukausi näytä tyhjältä.
              const filled = m.cents <= 0 ? 0 : Math.max(1, Math.round((m.cents / max) * ROWS));
              return (
                <div key={m.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: "1 1 0", minWidth: 18 }}>
                  <span
                    // Sarja on saavutettava myös ilman pisteitä: jokaisella
                    // pylväällä on koneluettava arvo.
                    role="img"
                    aria-label={`${monthTick(m.key)}/${m.key.slice(0, 4)}: ${eur2(m.cents)}`}
                    style={{ display: "flex", flexDirection: "column-reverse", gap: 5, alignItems: "center" }}
                  >
                    {Array.from({ length: ROWS }, (_, r) => (
                      <Dot key={r} on={r < filled} color={CT_TECH.green} size={7} />
                    ))}
                  </span>
                  <span style={{ fontSize: 10, color: CT_TECH.muted, fontVariantNumeric: "tabular-nums" }}>
                    {monthTick(m.key)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
