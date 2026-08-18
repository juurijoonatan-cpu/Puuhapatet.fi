/**
 * ADMIN-ETUSIVUN YLEISNÄKYMÄ — yksi paneeli, ei tekstiä.
 *
 * MITÄ TÄSSÄ ON: yksi iso luku, sen koostumus, kolme mittalukua ja laskutuksen
 * kehitys kuukausittain. Siinä kaikki. Ei selityksiä, ei varoituskappaleita, ei
 * toimintoja — ne asuvat omilla sivuillaan.
 *
 * MIKSI NÄIN: etusivu oli neljä samannäköistä pikkukorttia + kaksi
 * kappaletekstillä varustettua rahakorttia, joissa samat luvut toistuivat
 * kahdesti ja kokonaislaskutus puuttui silti kokonaan. Käyttäjän ohje oli
 * yksiselitteinen: "mahdollisimman vähän mitään tekstiä, vaan visuaaleja ja
 * numeroita — mutta vain tärkeitä tietoja."
 *
 * ── MUOTOVALINNAT (dataviz-menetelmä, ks. docs/talous-kirjanpito.md) ─────────
 *
 * YKSI ISO LUKU per näkymä. Kaksi 40 px:n lukua rinnakkain oli kaksi
 * kilpailevaa otsikkoa eikä kärkeä; nyt kärki on laskutus ja oma tulo on
 * ensimmäinen mittaluku.
 *
 * YKSI SÄVY. Koko paneeli piirretään yhdellä vihreällä rampilla
 * (L 0,813 → 0,565 → 0,332, sävy 152–156°, eli aito sekventiaalinen ramppi) ja
 * neutraaleilla. Kaksi eri sävyä (vihreä + sininen) ei läpäissyt tummalla
 * pinnalla vaaleusvyötä ja tritan-erottelu jäi 7,4:ään — rajatapaus. Sama sävy
 * kahdessa askeleessa on sekä yksinkertaisempi että mitattavasti turvallisempi,
 * ja osuus lukee luontevammin "osa kokonaisuudesta" kun se on saman värin
 * kylläisempi pää.
 *
 * KONTRASTIT pintaa (#08090A) vasten, mitattu: aksentti 11,9:1, toinen askel
 * 4,6:1 (molemmat ≥ 3:1 datamerkille), ura 1,7:1 — ura EI ole dataa vaan
 * saman rampin sammunut askel, kuten mittarin ura kuuluu olla.
 *
 * VÄRI EI OLE KOSKAAN AINOA EROTTAJA: kummallakin osuudella on selitteessä
 * nimi ja summa, ja jokaisella pylväällä koneluettava arvo.
 *
 * TUMMA PINTA ON TARKOITUKSELLINEN, ei teemavirhe. Yksi kiinteäsävyinen
 * paneeli sivun yläreunassa, samasta paletista kuin asiakkaan tekninen teema
 * (`CT_TECH`), jottei järjestelmässä ole kahta eri tummaa.
 */

import { Link } from "wouter";
import { CFONT } from "@/lib/customer-theme";

/**
 * Paneelin paletti. Vihreä ramppi + neutraalit; keltainen VAIN aidolle
 * huomiolle, ei koskaan sarjan värinä.
 */
const P = {
  surface: "#08090A",
  card: "#101215",
  hair: "#1B1F24",
  ink: "#FFFFFF",
  muted: "#8A929C",
  /** Aksentti — 11,9:1. Kärkiluku, osuuden kylläisempi pää, tuorein kuukausi. */
  accent: "#5FE08A",
  /** Sama sävy, tummempi askel — 3,4:1. Toinen osuus, aiemmat kuukaudet.
   *  Askel tummennettiin 4,6:1:stä, koska nauhassa se luki lähes samana kuin
   *  aksentti eikä osuuden vaihtumiskohtaa nähnyt. */
  accent2: "#27714A",
  /** Sammunut askel samasta rampista — mittarin ura, ei dataa. */
  track: "#173F28",
  warn: "#FFCE28",
} as const;

export interface OverviewFigure {
  label: string;
  value: string;
  /** `accent` korostaa yhden luvun; `warn` vain kun luku vaatii toimenpiteen. */
  tone?: "ink" | "accent" | "warn";
}

export interface OverviewShare {
  label: string;
  cents: number;
  /** Valmiiksi muotoiltu summa selitteeseen. */
  text: string;
}

export interface OverviewMonth {
  /** "YYYY-MM" */
  key: string;
  cents: number;
}

/** Osuusnauhan pisteet. 22 × 7 px + 21 × 3 px = 217 px, eli nauha mahtuu
 *  kapeimmalle puhelimelle (320 px) ilman vieritystä. Pisteet eivät kutistu. */
const STRIP_DOTS = 22;

/** Pylväikön korkeus. Matala tarkoituksella: tämä on rytmi, ei kuvaaja. */
const TREND_H = 56;

const eyebrowStyle = {
  margin: 0,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.16em",
  textTransform: "uppercase" as const,
  color: P.muted,
};

/** "2026-08" → "08" */
const tick = (key: string) => key.slice(5, 7);

export default function AdminOverview({
  eyebrow,
  heroLabel,
  heroValue,
  shares,
  figures,
  months,
  fmt,
  fmtExact,
  alert,
  loading = false,
}: {
  /** Kuka katsoo — yksi sana, ei tervehdyslausetta. */
  eyebrow: string;
  heroLabel: string;
  heroValue: string;
  /** Kärkiluvun koostumus, enintään kaksi osuutta. Tyhjä = ei nauhaa. */
  shares?: OverviewShare[];
  /** Enintään kolme mittalukua. */
  figures: OverviewFigure[];
  /** Aikasarja vanhimmasta uusimpaan; tyhjä = ei pylväikköä. */
  months: OverviewMonth[];
  /** NÄYTTÖmuotoilu — pyöristetty. Iso luku ei kanna senttejä. */
  fmt: (cents: number) => string;
  /** TARKKA muotoilu ruudunlukijalle. Puuttuva = sama kuin `fmt`. Sentit eivät
   *  katoa, ne siirtyvät pois näkyvistä. */
  fmtExact?: (cents: number) => string;
  /** Yksi rivi silloin kun jokin oikeasti vaatii toimenpiteen. */
  alert?: { text: string; href: string } | null;
  loading?: boolean;
}) {
  const exact = fmtExact ?? fmt;
  const shareTotal = (shares ?? []).reduce((s, x) => s + Math.max(0, x.cents), 0);
  // Ensimmäisen osuuden pisteet. Positiivinen osuus saa aina vähintään yhden
  // pisteen, jottei olemassa oleva raha näytä nollalta.
  const firstDots = shareTotal > 0 && shares?.length
    ? Math.min(STRIP_DOTS, Math.max(shares[0].cents > 0 ? 1 : 0, Math.round((shares[0].cents / shareTotal) * STRIP_DOTS)))
    : 0;

  const max = months.reduce((m, x) => Math.max(m, x.cents), 0);
  const peakKey = months.reduce<string | null>((best, m) => (m.cents > 0 && m.cents === max ? m.key : best), null);

  return (
    <section
      aria-label="Yleisnäkymä"
      style={{
        background: P.surface,
        borderRadius: 24,
        padding: "20px 20px 18px",
        fontFamily: CFONT,
        color: P.ink,
        marginBottom: 20,
      }}
    >
      {/* Yläreuna: kaksi pientä merkintää, ei otsikkoa. */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <p style={eyebrowStyle}>{eyebrow}</p>
        {months.length > 0 && <p style={eyebrowStyle}>{months.length} kk</p>}
      </div>

      {/* Kärkiluku. Suhteelliset numerot: tabular antaa jokaiselle numerolle
          nollan levyisen ruudun, mikä näyttää display-koossa löysältä. */}
      <p style={{ ...eyebrowStyle, marginBottom: 8 }}>{heroLabel}</p>
      <p style={{ margin: 0, fontSize: 52, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.045em" }}>
        {loading ? "—" : heroValue}
      </p>

      {/* Koostumus: kärkiluvun osat samalla sävyllä, kylläisempi pää edellä. */}
      {shares && shares.length > 0 && (
        <>
          {/* LEVEYS ON KATOLLA: levealla ruudulla `space-between` venytti 22
              pistettä koko paneelin mitalle, jolloin askeleen vaihtumiskohta oli
              30 px:n välien takana eikä sitä nähnyt. Osuus luetaan tiiviistä
              nauhasta. 22 × 7 px + 21 × 3 px = 217 px, eli nauha mahtuu myös
              kapeimmalle puhelimelle (320 px). Pisteet eivät kutistu. */}
          <div style={{ display: "flex", gap: 3, justifyContent: "space-between", margin: "18px 0 9px", maxWidth: 300 }}>
            {Array.from({ length: STRIP_DOTS }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flex: "0 0 auto",
                  background: shareTotal <= 0 ? P.track : i < firstDots ? P.accent : P.accent2,
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 16px" }}>
            {shares.map((s, i) => (
              <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: P.muted }}>
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", flex: "0 0 auto", background: i === 0 ? P.accent : P.accent2 }} />
                {s.label}
                <b style={{ color: P.ink, fontWeight: 700 }}>{s.text}</b>
              </span>
            ))}
          </div>
        </>
      )}

      {/* Mittaluvut: luku ja kolmen sanan mittainen nimi, ei muuta. */}
      {figures.length > 0 && (
        // `auto-fit` + `minmax(118px)`: kolme tiiliä levealla ruudulla, kaksi
        // kapealla. Kiinteä kolmen sarakkeen ruudukko puristi arvon 66 px:iin
        // 390 px:n puhelimella, jolloin "3 637 €" katkesi kolmeen pisteeseen.
        // 118 px on mitattu alaraja jolla nelinumeroinen euroluku mahtuu 20 px:n
        // leikkauksella myös 320 px:n ruudulla. Sarakemäärä lasketaan
        // MINIMISTÄ, joten yläraja on ruudukon `maxWidth`issä eikä `minmax`issa:
        // `minmax(118px, 220px)` olisi laskenut mahtuvat sarakkeet maksimista ja
        // pudottanut puhelimen yhteen sarakkeeseen.
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8, marginTop: 20, maxWidth: 452 }}>
          {figures.map((f) => (
            <div key={f.label} style={{ background: P.card, borderRadius: 14, padding: "11px 12px", minWidth: 0 }}>
              <p style={{ ...eyebrowStyle, fontSize: 9, marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.label}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: "-0.02em",
                  color: f.tone === "accent" ? P.accent : f.tone === "warn" ? P.warn : P.ink,
                  // Luku ei katkea kahdelle riville: kolme tiiliä 320 px:n
                  // ruudulla on n. 90 px kappale, eikä "3 636,50 €" mahdu
                  // sinne. Sentit jätetään pois jo muotoilijassa (`eur0`);
                  // tämä on varmistus jottei pitkä luku hajota ruudukkoa.
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {loading ? "—" : f.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Kehitys. Pylväät eivätkä pisterivit: kuusi pisterivistöä oli sekava
          eikä muoto lukenut kertaakaan ensi silmäyksellä. Yksi arvo on suoraan
          merkitty (korkein) — luku joka pylväällä olisi kaaos ja jäisi lukematta. */}
      {months.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: TREND_H + 16 }}>
            {months.map((m) => {
              // Nolla ei saa piirtää pylvästä; pienin positiivinen saa 3 px,
              // jottei olemassa oleva laskutus näytä tyhjältä kuukaudelta.
              const h = m.cents <= 0 || max <= 0 ? 0 : Math.max(3, Math.round((m.cents / max) * TREND_H));
              const isPeak = m.key === peakKey;
              return (
                <div key={m.key} style={{ flex: "1 1 0", minWidth: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  {isPeak && (
                    <span style={{ fontSize: 10, color: P.muted, marginBottom: 4, whiteSpace: "nowrap" }}>
                      {fmt(m.cents)}
                    </span>
                  )}
                  <span
                    role="img"
                    aria-label={`${tick(m.key)}/${m.key.slice(0, 4)}: ${exact(m.cents)}`}
                    style={{
                      width: "100%",
                      maxWidth: 24,
                      height: h,
                      // 3 px pyöristys datan päässä, suora perusviivalla.
                      borderRadius: "3px 3px 0 0",
                      background: isPeak ? P.accent : P.accent2,
                      display: "block",
                    }}
                  />
                </div>
              );
            })}
          </div>
          {/* Perusviiva: yksi hiusviiva, josta pylväät kasvavat. */}
          <div style={{ height: 1, background: P.hair, marginTop: 3 }} />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {months.map((m) => (
              <span key={m.key} style={{ flex: "1 1 0", minWidth: 14, textAlign: "center", fontSize: 10, color: P.muted, fontVariantNumeric: "tabular-nums" }}>
                {tick(m.key)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Huomiorivi. Näkyy VAIN kun jotain on oikeasti tekemättä, ja se on
          linkki sinne missä se tehdään — luku ilman polkua on umpikuja. */}
      {alert && (
        <Link
          href={alert.href}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 18,
            paddingTop: 14,
            borderTop: `1px solid ${P.hair}`,
            fontSize: 12,
            color: P.warn,
            textDecoration: "none",
          }}
        >
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: P.warn, flex: "0 0 auto" }} />
          <span>{alert.text}</span>
          <span aria-hidden="true" style={{ marginLeft: "auto" }}>→</span>
        </Link>
      )}
    </section>
  );
}
