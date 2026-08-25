/**
 * KEIKAN LASKUTUSTILAN VALINTA — kaksi vaihtoehtoa, ei enempää.
 *
 * MIKSI TÄMÄ ON OMA RUUTUNSA. Kohdennettu ja tuntihinnoittelu eivät ole saman
 * näkymän asetus vaan kaksi eri tapaa tehdä keikkaa: toisessa lasketaan
 * ikkunoita, hintaa per kohde ja urakan eriä, toisessa vain tunteja. Jos ne
 * olisivat samassa dashissa, kummankin luvut olisivat toistensa seassa ja
 * kumpikin näyttäisi keskeneräiseltä. Valinta ensin, näkymä sitten.
 *
 * VALINTA EI OLE LUKKO. Se kirjoitetaan keikalle, jotta seuraava avaaminen
 * menee suoraan oikeaan näkymään — mutta sen voi vaihtaa, eikä vaihto hävitä
 * mitään: kartta, tunnit ja kulut ovat samassa paikassa kummassakin tilassa,
 * vain esitys vaihtuu.
 */
import { T, card } from "./tokens";
import { useIsMobile } from "@/hooks/use-mobile";
import type { BillingMode } from "@shared/project";

interface Props {
  /** Keikan nimi otsikkoon, jos tiedossa. */
  gigName?: string;
  /** Nykyinen tila, jos jo valittu — silloin tämä on vaihtonäkymä. */
  current?: BillingMode | null;
  onChoose: (mode: BillingMode) => void;
  /** Paluu ilman valintaa (vain kun tila on jo valittu). */
  onCancel?: () => void;
}

const CHOICES: {
  mode: BillingMode;
  title: string;
  lead: string;
  points: string[];
  accent: string;
  accentBg: string;
  accentBorder: string;
}[] = [
  {
    mode: "targeted",
    title: "Kohdennettu hinnoittelu",
    lead: "Hinta lasketaan kohteista: ikkunoista, lampuista, ovista.",
    points: [
      "Pohjapiirros ja pisteiden merkintä",
      "Urakkahinta, erälaskutus ja keltaisten neuvottelu",
      "Tekijäkohtaiset ansiot per kohde",
    ],
    accent: T.tone.info,
    accentBg: T.tone.infoBg,
    accentBorder: T.tone.infoBorder,
  },
  {
    mode: "hourly",
    title: "Tuntihinnoittelu",
    lead: "Hinta lasketaan tehdyistä tunneista. Ei kohdehintoja.",
    points: [
      "Tekijä käyttää ajastinta: aloita, tauko, päätä",
      "Työaika pyöristetään lähimpään täyteen tuntiin",
      "Johtaja näkee ja korjaa tunnit — tekijä ei näe omiaan",
    ],
    accent: T.tone.goodSoft,
    accentBg: T.tone.goodBg,
    accentBorder: T.tone.goodBorder,
  },
];

export default function ModeChooser({ gigName, current, onChoose, onCancel }: Props) {
  const m = useIsMobile();
  return (
    <div style={{ maxWidth: 940, margin: "0 auto", padding: m ? T.space.lg : T.space.xxl }}>
      <div style={{ marginBottom: m ? T.space.xl : T.space.xxl }}>
        <div style={{ ...{ fontFamily: T.mono, fontSize: T.size.label, letterSpacing: "0.12em" }, color: T.text.faint }}>
          {current ? "VAIHDA TILA" : "UUSI KEIKKA"}
        </div>
        <h1 style={{ margin: `${T.space.sm}px 0 0`, fontFamily: T.font, fontSize: m ? T.size.display : T.size.hero, fontWeight: 700, lineHeight: 1.15, color: T.text.primary }}>
          Miten tämä keikka hinnoitellaan?
        </h1>
        <p style={{ margin: `${T.space.md}px 0 0`, fontFamily: T.font, fontSize: T.size.body, color: T.text.muted, lineHeight: 1.6, maxWidth: 560 }}>
          {gigName ? <><b style={{ color: T.text.secondary, fontWeight: 600 }}>{gigName}</b> — v</> : "V"}alinta
          ratkaisee mitä hallintapaneelissa näkyy. Voit vaihtaa sen myöhemmin, eikä vaihto hävitä mitään.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: m ? "1fr" : "1fr 1fr", gap: m ? T.space.lg : T.space.xl }}>
        {CHOICES.map((c) => {
          const isCurrent = current === c.mode;
          return (
            <button key={c.mode} onClick={() => onChoose(c.mode)}
              style={{
                ...card,
                padding: m ? T.space.xl : T.space.xxl,
                textAlign: "left",
                cursor: "pointer",
                border: `1px solid ${isCurrent ? c.accentBorder : "rgba(255,255,255,0.09)"}`,
                background: isCurrent ? c.accentBg : T.surface.card,
                display: "flex", flexDirection: "column", gap: T.space.md,
                transition: "border-color .16s, background .16s",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
                <span style={{ fontFamily: T.font, fontSize: m ? T.size.title : T.size.display, fontWeight: 700, color: T.text.primary, lineHeight: 1.2 }}>
                  {c.title}
                </span>
                {isCurrent && (
                  <span style={{ padding: `2px ${T.space.sm}px`, borderRadius: T.radius.pill, background: c.accentBg, border: `1px solid ${c.accentBorder}`, color: c.accent, fontFamily: T.font, fontSize: T.size.xs, fontWeight: 700 }}>
                    käytössä
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontFamily: T.font, fontSize: T.size.body, color: T.text.secondary, lineHeight: 1.55 }}>
                {c.lead}
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {c.points.map((pt) => (
                  <li key={pt} style={{ display: "flex", gap: T.space.sm, fontFamily: T.font, fontSize: T.size.sm, color: T.text.muted, lineHeight: 1.5 }}>
                    <span aria-hidden style={{ color: c.accent, flexShrink: 0 }}>·</span>
                    {pt}
                  </li>
                ))}
              </ul>
              <span style={{ marginTop: "auto", paddingTop: T.space.sm, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 700, color: c.accent }}>
                {isCurrent ? "Jatka tähän →" : "Valitse →"}
              </span>
            </button>
          );
        })}
      </div>

      {onCancel && (
        <button onClick={onCancel}
          style={{ marginTop: T.space.xl, background: "transparent", border: "none", padding: 0, color: T.text.muted, fontFamily: T.font, fontSize: T.size.sm, fontWeight: 600, cursor: "pointer" }}>
          ← Takaisin
        </button>
      )}
    </div>
  );
}
