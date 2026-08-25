/**
 * KEIKAN OVI — kumpaa puolta katsot juuri nyt.
 *
 * KAKSI PUOLTA, EI KAHTA ASETUSTA. Projektipuoli kysyy MITÄ on tehty: kartta,
 * ikkunat, lamput, ovet, urakka, erät. Tuntipuoli kysyy PALJONKO on tehty
 * tunteja. Ne eivät ole saman näkymän välilehtiä, koska kummankin luvut
 * näyttäisivät toisen seassa keskeneräisiltä — ja koska ne EIVÄT LASKE SAMAA
 * ASIAA. Projektipuolen tuntisumma on vuosien varrelta kertynyt seurantaluku;
 * tuntipuolen tunnit ovat tämän työn palkka ja lasku.
 *
 * VALINTA EI OLE LUKKO. Se ei muuta mitään keikalla eikä hävitä mitään: sama
 * kartta ja samat tunnit ovat tallessa kummassakin tapauksessa. Takaisin tänne
 * pääsee yhdellä napautuksella kummalta puolelta tahansa, ja tänne tullaan
 * joka kerta kun keikka avataan — juuri siksi että kumpaan mennään on päätös
 * eikä asetus.
 *
 * TÄMÄ EI MITOITA ITSEÄÄN KUOREEN. Edellinen versio piirsi itsensä suoraan
 * `.fr8-root`iin omalla paddingillaan, jolloin otsikko jäi iOS:n tilapalkin ja
 * Dynamic Islandin alle. Nyt tämä on tavallista sisältöä `main`in sisällä,
 * kuten dash ja kartta — turva-alueet hoituvat siellä missä ne muillakin.
 */
import { T, card, mono } from "./tokens";
import { useIsMobile } from "@/hooks/use-mobile";

export type GigSide = "targeted" | "hourly";

interface Props {
  gigName?: string;
  address?: string;
  /** Kumpi puoli on keikan oletus (asiakkaan laskutustila). Vain korostus. */
  suggested?: GigSide;
  onChoose: (side: GigSide) => void;
  /** Ulos keikalta. */
  onBack?: () => void;
  /** Tuntipuolen lyhyt tilannerivi: "12 h tänään · 2 töissä nyt". */
  hourlyHint?: string;
  /** Projektipuolen lyhyt tilannerivi: "184 / 220 pesty". */
  targetedHint?: string;
}

const CHOICES: {
  side: GigSide;
  title: string;
  lead: string;
  points: string[];
  accent: string;
  accentBg: string;
  accentBorder: string;
}[] = [
  {
    side: "hourly",
    title: "Tuntityö",
    lead: "Työtunnit: aloita tunti, päätä tunti, katso kuka on tehnyt mitäkin.",
    points: [
      "Ajastin — jatkuu vaikka puhelin menisi kiinni",
      "Tunnit päivittäin, päivämäärä näkyvissä",
      "Käsin lisäys ja korjaus (vain Joonatan ja Matias)",
    ],
    accent: T.tone.goodSoft,
    accentBg: T.tone.goodBg,
    accentBorder: T.tone.goodBorder,
  },
  {
    side: "targeted",
    title: "Projekti",
    lead: "Vanha näkymä: pohjapiirros, ikkunat, lamput, ovet ja urakkahinta.",
    points: [
      "Kartta ja pisteiden merkintä kerroksittain",
      "Urakka, erälaskutus ja keltaisten neuvottelu",
      "Kohdehinnat ja tekijäkohtaiset ansiot",
    ],
    accent: T.tone.info,
    accentBg: T.tone.infoBg,
    accentBorder: T.tone.infoBorder,
  },
];

export default function ModeChooser({ gigName, address, suggested, onChoose, onBack, hourlyHint, targetedHint }: Props) {
  const m = useIsMobile();
  const hint = (s: GigSide) => (s === "hourly" ? hourlyHint : targetedHint);
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {onBack && (
        <button onClick={onBack}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: T.space.lg, padding: 0, background: "transparent", border: "none", color: T.text.muted, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, cursor: "pointer" }}>
          ← Keikat
        </button>
      )}

      <div style={{ marginBottom: m ? T.space.lg : T.space.xl }}>
        <div style={{ ...mono, color: T.text.faint }}>{gigName ? gigName.toUpperCase() : "KEIKKA"}</div>
        <h1 style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: m ? T.size.hero - 6 : T.size.hero, fontWeight: 700, lineHeight: 1.12, color: T.text.primary }}>
          Kumpaan mennään?
        </h1>
        <p style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.6, maxWidth: 520 }}>
          {address ? `${address} — v` : "V"}alinta ei muuta keikalla mitään. Takaisin tänne pääsee milloin vain.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: m ? T.space.md : T.space.lg }}>
        {CHOICES.map((c) => {
          const isDefault = suggested === c.side;
          const h = hint(c.side);
          return (
            <button key={c.side} onClick={() => onChoose(c.side)}
              style={{
                ...card,
                padding: m ? T.space.lg : T.space.xl,
                textAlign: "left",
                cursor: "pointer",
                border: `1px solid ${isDefault ? c.accentBorder : "rgba(255,255,255,0.09)"}`,
                background: isDefault ? c.accentBg : T.surface.card,
                display: "flex", flexDirection: "column", gap: T.space.sm,
                transition: "border-color .16s, background .16s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
                <span style={{ fontFamily: T.font, fontSize: m ? T.size.title : T.size.display, fontWeight: 700, color: T.text.primary, lineHeight: 1.2 }}>
                  {c.title}
                </span>
                {isDefault && (
                  <span style={{ padding: `2px ${T.space.sm}px`, borderRadius: T.radius.pill, background: c.accentBg, border: `1px solid ${c.accentBorder}`, color: c.accent, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700 }}>
                    tämän keikan tapa
                  </span>
                )}
              </div>

              {/* Tilannerivi kertoo mitä oven takana on juuri nyt, jottei
                  valintaa tarvitse tehdä muistin varassa. */}
              {h && (
                <div style={{ fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, color: c.accent }}>{h}</div>
              )}

              <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.sm, color: T.text.secondary, lineHeight: 1.55 }}>
                {c.lead}
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {c.points.map((pt) => (
                  <li key={pt} style={{ display: "flex", gap: T.space.sm, fontFamily: T.font, fontSize: T.size.xs, color: T.text.muted, lineHeight: 1.5 }}>
                    <span aria-hidden style={{ color: c.accent, flexShrink: 0 }}>·</span>
                    {pt}
                  </li>
                ))}
              </ul>
              <span style={{ marginTop: "auto", paddingTop: T.space.sm, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: c.accent }}>
                Avaa →
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
