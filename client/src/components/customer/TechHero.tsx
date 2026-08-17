/**
 * Asiakkaan seurantanäkymän pääkortti — TEKNINEN (tumma) variantti.
 *
 * Sama tieto kuin `CustomerProgressHero`, eri muoto: rengasmittari ja tarkka
 * avain–arvo-luenta palkin ja ilmavan paperin sijaan. Tarkoitettu asiakkaalle
 * jolle mittalaite on tutumpi kieli kuin esite.
 *
 * MIKSI ERI KOMPONENTTI EIKÄ LIPPU VANHASSA: kaksi ulkoasua yhdessä
 * komponentissa tarkoittaisi että jokainen tuleva muutos pitää testata
 * molemmilla, ja vaalea variantti on käytössä elävällä sopimusasiakkaalla.
 * Erillinen tiedosto pitää sen koskemattomana; jaettu on `RadialMeter` ja
 * teemapoletit.
 *
 * MUOTOVALINNAT (dataviz):
 *  - Edistyminen on **mittari** (yksi suhde rajaa vasten), ei kaavio.
 *  - Tunnusluvut ovat **tilastoruutuja**, eivät pylväitä: muutama otsikkoluku
 *    ei ole kaavion arvoinen.
 *  - Tilamerkillä on AINA teksti. Vihreä ja keltainen ovat CVD-erottelultaan
 *    rajatapaus (protan ΔE 7,9), joten väri yksin ei saa kantaa merkitystä.
 *  - Ruutujen arvot ovat `tabular-nums` (ne ovat sarakkeessa allekkain);
 *    mittarin iso luku ei ole — ks. `RadialMeter`.
 */

import { type CSSProperties, type ReactNode } from "react";
import RadialMeter from "./RadialMeter";
import { CFONT, type CustomerTheme } from "@/lib/customer-theme";

export interface TechTile {
  label: string;
  value: ReactNode;
  tone?: "ink" | "green" | "amber" | "navy";
  /** Valinnainen aputeksti arvon alla (esim. "arvio"). */
  sub?: string;
}

export default function TechHero({
  theme, pct, done, total, awaiting = 0,
  label = "Työn edistyminen", chip, tiles = [], note,
}: {
  theme: CustomerTheme;
  pct: number;
  done?: number;
  total?: number;
  awaiting?: number;
  label?: string;
  chip?: { text: string; tone: "green" | "amber" | "navy" } | null;
  tiles?: TechTile[];
  note?: string;
}) {
  const shown = Math.max(0, Math.min(100, pct));
  const hasCounts = typeof done === "number" && typeof total === "number" && total > 0;

  const TONE: Record<NonNullable<TechTile["tone"]>, string> = {
    ink: theme.ink, green: theme.green, amber: theme.amber, navy: theme.navy,
  };

  // Mono-etiketti: sama kieli kuin FR8:n työkaluissa. Se on se yksityiskohta
  // joka erottaa mittalaitteen esitteestä.
  const monoLabel: CSSProperties = {
    margin: 0,
    fontFamily: "var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: 10,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: theme.muted,
  };

  return (
    <section
      style={{
        fontFamily: CFONT, color: theme.ink,
        background: theme.card, border: `1px solid ${theme.hair}`, borderRadius: 24,
        padding: "22px 20px 20px", marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <p style={monoLabel}>{label}</p>
        {chip && <Chip text={chip.text} tone={chip.tone} theme={theme} />}
      </div>

      {/* Mittari + luenta. Kapealla ruudulla allekkain, leveällä rinnakkain —
          rengas ei saa kutistua luettavuuden alle mahtuakseen viereen. */}
      <div
        style={{
          display: "flex", flexWrap: "wrap", alignItems: "center",
          gap: 22, marginTop: 14,
        }}
      >
        <div style={{ flex: "0 0 auto", margin: "0 auto" }}>
          <RadialMeter
            pct={shown}
            color={theme.green}
            // Rata on saman sävyn tummempi askel — ei harmaa. Näin tila luetaan
            // koko renkaasta eikä vain täytetystä osasta.
            trackColor="rgba(95,224,138,0.16)"
            ink={theme.ink}
            mutedInk={theme.muted}
            size={196}
            label={label}
            caption={hasCounts ? `${done} / ${total} ikkunaa` : undefined}
          />
        </div>

        {/* Avain–arvo-luenta. Tämä on se osa joka tekee näkymästä tarkan:
            jokainen rivi on yksi vastaus, ei kappale tekstiä. */}
        <dl
          style={{
            flex: "1 1 220px", minWidth: 200, margin: 0,
            display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 10, columnGap: 14,
            alignContent: "center",
          }}
        >
          <Row k="Tila" theme={theme}>
            <StatusText theme={theme} pct={shown} />
          </Row>
          {hasCounts && (
            <Row k="Pesty" theme={theme}>
              <b style={{ color: theme.ink, fontVariantNumeric: "tabular-nums" }}>{done}</b>
              <span style={{ color: theme.muted }}> / {total} ikkunaa</span>
            </Row>
          )}
          {hasCounts && (
            <Row k="Jäljellä" theme={theme}>
              <b style={{ color: theme.ink, fontVariantNumeric: "tabular-nums" }}>
                {Math.max(0, (total ?? 0) - (done ?? 0))}
              </b>
              <span style={{ color: theme.muted }}> ikkunaa</span>
            </Row>
          )}
          {awaiting > 0 && (
            <Row k="Odottaa" theme={theme}>
              <b style={{ color: theme.amber, fontVariantNumeric: "tabular-nums" }}>{awaiting}</b>
              <span style={{ color: theme.muted }}> hyväksyntääsi</span>
            </Row>
          )}
        </dl>
      </div>

      {note && (
        <p style={{ margin: "16px 0 0", fontSize: 13, color: theme.muted, lineHeight: 1.6 }}>{note}</p>
      )}

      {tiles.length > 0 && (
        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8, marginTop: 18,
          }}
        >
          {tiles.map((t) => (
            <div
              key={t.label}
              style={{
                background: theme.fill, border: `1px solid ${theme.hair}`,
                borderRadius: 14, padding: "11px 13px",
                display: "flex", flexDirection: "column", minWidth: 0,
              }}
            >
              <div style={{ ...monoLabel, fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.label}
              </div>
              <div
                style={{
                  marginTop: "auto", paddingTop: 6,
                  fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em",
                  color: TONE[t.tone ?? "ink"],
                  fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere",
                }}
              >
                {t.value}
              </div>
              {t.sub && (
                <div style={{ marginTop: 2, fontSize: 11, color: theme.muted }}>{t.sub}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ k, theme, children }: { k: string; theme: CustomerTheme; children: ReactNode }) {
  return (
    <>
      <dt
        style={{
          fontFamily: "var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
          fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
          color: theme.muted, whiteSpace: "nowrap", alignSelf: "center",
        }}
      >
        {k}
      </dt>
      <dd style={{ margin: 0, fontSize: 14, lineHeight: 1.35, alignSelf: "center" }}>{children}</dd>
    </>
  );
}

/**
 * Tila sanoina JA värillä — ei koskaan pelkkänä värinä. Vihreä ja keltainen
 * ovat CVD-erottelultaan rajatapaus, joten teksti kantaa merkityksen ja väri
 * vahvistaa sitä.
 */
function StatusText({ theme, pct }: { theme: CustomerTheme; pct: number }) {
  const s = pct >= 100
    ? { text: "Valmis", color: theme.green }
    : pct > 0
      ? { text: "Käynnissä", color: theme.green }
      : { text: "Ei aloitettu", color: theme.muted };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600, color: s.color }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
      {s.text}
    </span>
  );
}

function Chip({ text, tone, theme }: { text: string; tone: "green" | "amber" | "navy"; theme: CustomerTheme }) {
  const c = tone === "green" ? theme.green : tone === "amber" ? theme.amber : theme.navy;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto",
        padding: "4px 11px", borderRadius: 999,
        border: `1px solid ${c}44`, background: `${c}14`, color: c,
        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      {text}
    </span>
  );
}
