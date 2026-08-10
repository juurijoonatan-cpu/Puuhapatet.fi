/**
 * Asiakkaan seurantanäkymän pääkortti.
 *
 * Yksi luku, yksi palkki, ei selityksiä. Kaikki ohjeteksti asuu sivun alaosan
 * taittuvassa osiossa — tämä kortti on se mitä asiakas tulee katsomaan, ja se
 * pitää lukea kerralla puhelimen ruudulta käsivarren mitan päästä.
 *
 * Muotoilun periaatteet: iso ja lihava luku tiukalla kirjainvälillä, korkea
 * pyöristetty palkki jolla on oma hehku, ja reilusti ilmaa kaiken ympärillä.
 */

import { type CSSProperties, type ReactNode } from "react";
import { useEaseTo, EASE_MS } from "@/hooks/use-ease-to";
import { CT, CFONT, PROGRESS_GRADIENT, PROGRESS_GLOW, eyebrow, display, tileStyle } from "@/lib/customer-theme";

export interface HeroTile {
  label: string;
  value: ReactNode;
  /** Korostettu arvo (esim. odottaa sinua) — muuten hillitty musta. */
  tone?: "ink" | "green" | "amber" | "navy";
}

const TONE: Record<NonNullable<HeroTile["tone"]>, string> = {
  ink: CT.ink, green: CT.green, amber: "#8A6A00", navy: CT.navy,
};

// Nousun animaatio on jaettu tekijän näkymän kanssa (@/hooks/use-ease-to):
// kaksi kopiota samasta rAF-silmukasta ajautuisi ennen pitkää erilleen.

export default function CustomerProgressHero({
  pct, done, total, awaiting = 0, label = "Työn edistyminen", chip, tiles = [], note,
}: {
  pct: number;
  /** Pestyt ikkunat. Jätä pois jos keikalla ei ole karttaa — silloin vain %. */
  done?: number;
  total?: number;
  awaiting?: number;
  label?: string;
  chip?: { text: string; tone: "green" | "amber" | "navy" } | null;
  tiles?: HeroTile[];
  note?: string;
}) {
  const shown = Math.max(0, Math.min(100, pct));
  const hasCounts = typeof done === "number" && typeof total === "number" && total > 0;
  // Elävä arvo: numero ja palkki nousevat yhdessä nollasta lukemaan.
  const live = useEaseTo(shown);
  const grown = shown > 0 ? Math.min(1, live / shown) : 0;   // 0…1, nousun eteneminen

  return (
    <section
      style={{
        fontFamily: CFONT, color: CT.ink,
        background: CT.card, border: `1px solid ${CT.hair}`, borderRadius: 26,
        padding: "26px 22px 24px", marginBottom: 16,
      }}
    >
      <style>{`
        /* Valonhäivähdys pyyhkäisee täytön yli tasaisin väliajoin. Se kertoo
           yhdellä silmäyksellä että näkymä on elossa — mikään muu tällä
           sivulla ei liiku. */
        @keyframes cphSheen{0%{transform:translateX(-140%) skewX(-18deg)}100%{transform:translateX(320%) skewX(-18deg)}}
        /* Kärjen hento syke: sama pulssi kuin LIVE-merkissä, hiljaisempana. */
        @keyframes cphTip{0%,100%{opacity:.85}50%{opacity:.35}}
        @media (prefers-reduced-motion: reduce){
          [data-cph-anim]{animation:none !important}
        }
      `}</style>

      {/* Yläotsikko + tilamerkki */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <p style={eyebrow}>{label}</p>
        {chip && <Chip text={chip.text} tone={chip.tone} />}
      </div>

      {/* Luku. Prosenttimerkki on pienempi ja hiljaisempi kuin luku itse —
          numero on se mitä katsotaan, yksikkö vain kertoo mistä on kyse. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 12 }}>
        <span style={{ ...display(64), fontSize: "clamp(56px, 17vw, 78px)" }}>{Math.round(live)}</span>
        <span style={{ fontSize: "clamp(26px, 7.5vw, 36px)", fontWeight: 700, color: CT.muted, letterSpacing: "-0.02em" }}>%</span>
      </div>

      {/* Kappalemäärä omalla rivillään luvun alla. Se oli ensin palkin sisällä,
          mutta täytön reuna liikkuu prosentin mukana ja teksti jäi sen alle
          juuri kun työ oli pitkällä. Oma rivi ei voi törmätä mihinkään. */}
      {hasCounts && (
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: CT.muted, fontVariantNumeric: "tabular-nums" }}>
          <b style={{ color: CT.ink, fontWeight: 700 }}>{done} / {total}</b> ikkunaa pesty
        </p>
      )}

      {/* Palkki. Täyttö on oma pyöristetty pilleri jolla on hehku, aivan kuten
          jäljellä oleva osuus on omansa — siksi kehystä EI leikata
          (`overflow: hidden` söisi hehkun). Leveys tulee samasta elävästä
          arvosta kuin numero, joten CSS-siirtymää ei ole: kaksi eri kiihdytystä
          samalle liikkeelle näyttäisi siltä että ne kilpailevat keskenään. */}
      <div
        role="progressbar"
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        style={{
          position: "relative", marginTop: 16,
          height: "clamp(38px, 10vw, 46px)", borderRadius: 999, background: "#EDEAE2",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${live}%`,
            // Vähimmäisleveys kasvaa nousun mukana: valmis pilleri on aina
            // vähintään 40 px leveä, mutta nousu alkaa silti nollasta eikä
            // hyppää heti leveäksi.
            minWidth: 40 * grown,
            borderRadius: 999, background: PROGRESS_GRADIENT,
            boxShadow: PROGRESS_GLOW,
          }}
        >
          {/* Sisäkehys leikkaa häivähdyksen pillerin muotoon. Hehku jää
              ulomman elementin päälle, joten sitä tämä ei syö. */}
          <div style={{ position: "absolute", inset: 0, borderRadius: 999, overflow: "hidden" }}>
            <div
              data-cph-anim=""
              style={{
                position: "absolute", top: 0, bottom: 0, left: 0, width: "34%",
                background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)",
                animation: `cphSheen 2.6s cubic-bezier(.45,0,.2,1) ${EASE_MS}ms infinite`,
                pointerEvents: "none",
              }}
            />
            {/* Kärjen valo: pilleri näyttää päättyvän valoon eikä leikkaukseen. */}
            <div
              data-cph-anim=""
              style={{
                position: "absolute", top: 0, bottom: 0, right: 0, width: 44,
                background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 100%)",
                animation: "cphTip 2.8s ease-in-out infinite",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>

      {awaiting > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 14, fontSize: 13, color: CT.muted, lineHeight: 1.5 }}>
          <span style={{ width: 8, height: 8, marginTop: 5, borderRadius: "50%", background: CT.amber, flexShrink: 0 }} />
          <span><b style={{ color: CT.ink, fontVariantNumeric: "tabular-nums" }}>{awaiting}</b> pestyä lisätyöikkunaa odottaa hinnan hyväksyntääsi</span>
        </div>
      )}

      {note && (
        <p style={{ margin: "14px 0 0", fontSize: 13, color: CT.muted, lineHeight: 1.6 }}>{note}</p>
      )}

      {tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))", gap: 10, marginTop: 20 }}>
          {/* Ruudut venyvät ruudukossa samankorkuisiksi, ja arvo painetaan
              pohjaan — silloin kaksiriviselle otsikolle jää tilaa ilman että
              naapuriruudun arvo jää eri viivalle. */}
          {tiles.map((t) => (
            <div key={t.label} style={{ ...tileStyle, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: CT.muted }}>{t.label}</div>
              <div style={{ marginTop: "auto", paddingTop: 5, fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: TONE[t.tone ?? "ink"], fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
                {t.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const CHIP_TONE: Record<"green" | "amber" | "navy", CSSProperties> = {
  green: { color: CT.green, background: "rgba(62,124,89,0.10)", borderColor: "rgba(62,124,89,0.28)" },
  amber: { color: "#8A6A00", background: "rgba(224,168,0,0.14)", borderColor: "rgba(224,168,0,0.38)" },
  navy: { color: CT.navy, background: "rgba(31,59,87,0.08)", borderColor: "rgba(31,59,87,0.24)" },
};

function Chip({ text, tone }: { text: string; tone: "green" | "amber" | "navy" }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto",
        padding: "5px 12px", borderRadius: 999, border: "1px solid",
        fontSize: 11.5, fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap",
        ...CHIP_TONE[tone],
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
      {text}
    </span>
  );
}
