/**
 * KEIKAN OVI — kaksi nappia, ei mitään muuta.
 *
 * KAKSI PUOLTA, EI KAHTA ASETUSTA. Projektipuoli kysyy MITÄ on tehty: kartta,
 * ikkunat, lamput, ovet, urakka, erät. Tuntipuoli kysyy PALJONKO on tehty
 * tunteja. Ne eivät ole saman näkymän välilehtiä, koska ne EIVÄT LASKE SAMAA
 * ASIAA. Valinta ei muuta keikalla mitään, ja takaisin tänne pääsee yhdellä
 * napautuksella kummalta puolelta tahansa.
 *
 * MIKSI VAIN KAKSI NAPPIA. Edellinen versio selitti valinnan: otsikko,
 * alaotsikko, osoite, kummallekin napille johdanto, kolme ranskalaista viivaa,
 * tilannerivi ja "Avaa →". Kaikki se luettiin joka kerta kun keikka avattiin,
 * vaikka valinta on aina sama kaksi sanaa. Selitys työnsi napit pieniksi
 * ruudun yläosaan, ja ylä- ja alalaitaan jäi leveä musta kaista.
 *
 * NAPIT OVAT KOKO RUUTU, REUNASTA REUNAAN. Pystyssä päällekkäin,
 * vaakatasossa rinnakkain (`.fr8-door` index.css:ssä). Napin TAUSTA jatkuu
 * kellon ja kotipalkin alle, mutta sen SISÄLTÖ pysyy turva-alueiden
 * sisäpuolella: kello, Dynamic Island ja kotipalkki eivät peitä tekstiä
 * eivätkä takaisin-nappia. Siksi tämä komponentti hoitaa turva-alueet itse
 * (`env(safe-area-inset-*)` index.css:ssä) eikä `main` lisää omaa
 * reunustaan — reunus oli juuri se musta kaista.
 */
import { ArrowLeft, Building2, Clock } from "lucide-react";
import { T } from "./tokens";

export type GigSide = "targeted" | "hourly";

interface Props {
  /** Keikan nimi takaisin-napissa: kertoo missä ollaan ja minne nappi vie. */
  gigName?: string;
  onChoose: (side: GigSide) => void;
  /** Ulos keikalta. */
  onBack?: () => void;
}

const DOORS: {
  side: GigSide;
  title: string;
  Icon: typeof Clock;
  color: string;
  bg: string;
}[] = [
  { side: "hourly", title: "Tuntityö", Icon: Clock, color: T.tone.goodSoft, bg: "rgba(95,224,138,0.11)" },
  { side: "targeted", title: "Projekti", Icon: Building2, color: T.tone.info, bg: "rgba(120,150,255,0.11)" },
];

export default function ModeChooser({ gigName, onChoose, onBack }: Props) {
  return (
    <div className="fr8-door">
      {DOORS.map(({ side, title, Icon, color, bg }) => (
        <button
          key={side}
          className="fr8-door-btn"
          onClick={() => onChoose(side)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: T.space.lg, width: "100%", height: "100%", minHeight: 0, boxSizing: "border-box",
            border: "none", borderRadius: 0, background: bg, color, cursor: "pointer", fontFamily: T.font,
          }}
        >
          <Icon size={52} strokeWidth={1.6} aria-hidden />
          <span style={{ fontSize: "clamp(32px, 9vmin, 56px)", fontWeight: 700, lineHeight: 1.1, color: T.text.primary }}>
            {title}
          </span>
        </button>
      ))}

      {/* Takaisin keikalle. Napin päällä eikä oman palkkinsa sisällä — palkki
          olisi taas se kaista joka vie tilaa napeilta. Ensimmäisen napin
          sisältö on siirretty sen alapuolelle (index.css), joten tämä ei
          peitä mitään. */}
      {onBack && (
        <button
          className="fr8-door-back"
          onClick={onBack}
          aria-label="Takaisin keikalle"
          style={{
            display: "inline-flex", alignItems: "center", gap: T.space.sm,
            height: 40, padding: `0 ${T.space.md}px 0 ${T.space.sm + 2}px`,
            borderRadius: T.radius.pill, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.45)",
            color: T.text.secondary, fontFamily: T.font, fontSize: T.size.body, fontWeight: 600, cursor: "pointer",
          }}
        >
          <ArrowLeft size={18} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {gigName || "Keikka"}
          </span>
        </button>
      )}
    </div>
  );
}
